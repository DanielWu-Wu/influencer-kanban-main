import type { AppSettings } from '@/lib/data';
import { ACCOUNT_SCOPE_CHANGED_EVENT, getAccountCacheScope } from '@/lib/account-cache-scope';
import { detectEmailLanguage } from '@/lib/email-language';
import type { MailProvider } from '@/lib/mail-accounts';
import { splitEmailForTranslation } from '@/lib/email-text';
import { isUsableMailTranslation, normalizeMailTranslationText } from '@/lib/mail-translation-body';

export const GMAIL_PRIMARY_INBOX_REFRESHED_EVENT = 'gmail-primary-inbox-refreshed';

export type GmailTranslationPrefetchCandidate = {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  date: string;
};

export type MailTranslationPrefetchCandidate = GmailTranslationPrefetchCandidate & {
  provider: MailProvider;
  mailAccountId: string;
  mailAddress: string;
  folderRef?: string;
  providerMessageRef?: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string;
};

export type GmailTranslationRequestResult = {
  translatedText: string;
  sourceLang: string;
};

type GmailTranslationRequestOptions = {
  scopeKey: string;
  messageId: string;
  text: string;
  sourceText?: string;
  priority?: 'background' | 'foreground';
  settings: Pick<
    AppSettings,
    'translatePrompt' | 'modelProvider' | 'customApiUrl' | 'customModelName'
  >;
  onProgress?: (translatedText: string) => void;
};

const inFlightTranslations = new Map<string, Promise<GmailTranslationRequestResult>>();
type TranslationJob = {
  options: GmailTranslationRequestOptions;
  resolve: (result: GmailTranslationRequestResult) => void;
  reject: (error: unknown) => void;
};
const waitingTranslations = new Map<string, TranslationJob>();
let activeBackground = 0;
let activeForeground = 0;
let requestGeneration = 0;
const recentTranslations = new Map<string, { result: GmailTranslationRequestResult; expiresAt: number }>();
const registeredQueues = new Map<string, GmailTranslationPrefetchQueue>();
const translationStatusListeners = new Set<(update: MailTranslationPrefetchStatusUpdate) => void>();

export type MailTranslationPrefetchStatus = 'queued' | 'translating' | 'retrying' | 'ready' | 'failed';

export type MailTranslationPrefetchStatusInfo = {
  status: MailTranslationPrefetchStatus;
  error?: string;
  originalText: string;
};

export type MailTranslationPrefetchStatusUpdate = MailTranslationPrefetchStatusInfo & {
  scopeKey: string;
  messageId: string;
};

export const MAIL_TRANSLATION_BACKGROUND_CONCURRENCY = 2;
export const MAIL_TRANSLATION_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;

function createTranslationRequestKey(options: GmailTranslationRequestOptions) {
  return JSON.stringify([options.scopeKey, options.messageId,
    normalizeMailTranslationText(options.sourceText ?? options.text),
    normalizeMailTranslationText(options.text)]);
}

function drainTranslationRequests() {
  for (const [key, job] of waitingTranslations) {
    const background = job.options.priority === 'background';
    if (background ? activeBackground >= MAIL_TRANSLATION_BACKGROUND_CONCURRENCY : activeForeground >= 1) continue;
    waitingTranslations.delete(key);
    if (background) activeBackground += 1;
    else activeForeground += 1;
    void executeTranslationRequest(job.options).then((result) => {
      if (!isUsableMailTranslation(job.options.text, result.translatedText)) {
        throw new Error('翻译服务没有返回有效中文，请重试。');
      }
      job.resolve(result);
    }).catch(job.reject).finally(() => {
      if (background) activeBackground -= 1;
      else activeForeground -= 1;
      drainTranslationRequests();
    });
  }
}

function parseTranslationStreamBlock(
  block: string,
  state: { translatedText: string; sourceLang: string; streamError: string },
  onProgress?: (translatedText: string) => void,
) {
  const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message';
  const dataText = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s?/, ''))
    .join('\n');
  if (!dataText) return;
  try {
    const data = JSON.parse(dataText) as Record<string, unknown>;
    if (event === 'delta' && typeof data.text === 'string') {
      state.translatedText += data.text;
      onProgress?.(state.translatedText);
    } else if (event === 'final') {
      state.translatedText = String(data.translatedText || state.translatedText).trim();
      state.sourceLang = String(data.sourceLang || state.sourceLang);
      onProgress?.(state.translatedText);
    } else if (event === 'error') {
      state.streamError = String(data.message || '翻译失败');
    }
  } catch {
    // 忽略不完整的 SSE 保活块，继续读取后续内容。
  }
}

async function executeTranslationRequest(
  options: GmailTranslationRequestOptions,
): Promise<GmailTranslationRequestResult> {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: options.text,
      sourceLang: detectEmailLanguage(options.text),
      customPrompt: options.settings.translatePrompt || '',
      modelProvider: options.settings.modelProvider || 'builtin',
      customApiUrl: options.settings.customApiUrl || '',
      customModelName: options.settings.customModelName || '',
      stream: true,
    }),
  });

  const contentType = response.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.includes('text/event-stream')) {
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || '翻译失败');
    const translatedText = String(result.data.translatedText || '').trim();
    options.onProgress?.(translatedText);
    return {
      translatedText,
      sourceLang: String(result.data.sourceLang || 'auto'),
    };
  }

  if (!response.ok || !response.body) throw new Error('翻译服务没有返回可读取的结果。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { translatedText: '', sourceLang: 'auto', streamError: '' };
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    blocks.forEach((block) => parseTranslationStreamBlock(block, state, options.onProgress));
  }
  buffer += decoder.decode();
  if (buffer.trim()) parseTranslationStreamBlock(buffer, state, options.onProgress);
  if (state.streamError) throw new Error(state.streamError);
  if (!state.translatedText.trim()) throw new Error('翻译服务没有返回可用译文。');
  return { translatedText: state.translatedText.trim(), sourceLang: state.sourceLang };
}

export function getMailTranslationScopeKey(mailAccountId?: string, accountScope = getAccountCacheScope()) {
  return `${accountScope}::${mailAccountId?.trim().toLowerCase() || 'unknown-mail-account'}`;
}

export function getGmailTranslationScopeKey(mailAccountId?: string, accountScope = getAccountCacheScope()) {
  return getMailTranslationScopeKey(mailAccountId, accountScope);
}

export function getLegacyGmailTranslationScopeKey(gmailEmail?: string, accountScope = getAccountCacheScope()) {
  return `${accountScope}::${gmailEmail?.trim().toLowerCase() || 'unknown-gmail'}`;
}

export function getMailTranslationStorageMessageId(scopeKey: string, messageId: string) {
  return `${scopeKey}::${messageId}`;
}

export function getMailTranslationStatusKey(scopeKey: string, messageId: string) {
  return `${scopeKey}::${messageId}`;
}

export function publishMailTranslationPrefetchStatus(update: MailTranslationPrefetchStatusUpdate) {
  translationStatusListeners.forEach((listener) => listener(update));
}

export function subscribeMailTranslationPrefetchStatus(
  listener: (update: MailTranslationPrefetchStatusUpdate) => void,
) {
  translationStatusListeners.add(listener);
  return () => {
    translationStatusListeners.delete(listener);
  };
}

export function requestGmailTranslation(options: GmailTranslationRequestOptions) {
  const key = createTranslationRequestKey(options);
  const recent = recentTranslations.get(key);
  if (recent && recent.expiresAt > Date.now()) {
    options.onProgress?.(recent.result.translatedText);
    return Promise.resolve(recent.result);
  }
  if (recent) recentTranslations.delete(key);
  const existing = inFlightTranslations.get(key);
  if (existing) {
    const waiting = waitingTranslations.get(key);
    if (waiting && options.priority !== 'background') {
      waiting.options.priority = 'foreground';
      drainTranslationRequests();
    }
    existing.then((result) => options.onProgress?.(result.translatedText)).catch(() => undefined);
    return existing;
  }

  const generation = requestGeneration;
  const request = new Promise<GmailTranslationRequestResult>((resolve, reject) => {
    waitingTranslations.set(key, { options: { ...options }, resolve, reject });
  })
    .then((result) => {
      if (generation === requestGeneration) recentTranslations.set(key, { result, expiresAt: Date.now() + 60_000 });
      return result;
    })
    .finally(() => {
      if (inFlightTranslations.get(key) === request) inFlightTranslations.delete(key);
    });
  inFlightTranslations.set(key, request);
  drainTranslationRequests();
  return request;
}

export function selectGmailTranslationPrefetchCandidates(
  candidates: GmailTranslationPrefetchCandidate[],
  cachedMessageIds: Iterable<string>,
  limit = 3,
) {
  const cached = new Set(cachedMessageIds);
  const seen = new Set<string>();
  return [...candidates]
    .filter((candidate) => {
      if (!candidate.messageId || seen.has(candidate.messageId) || cached.has(candidate.messageId)) return false;
      seen.add(candidate.messageId);
      return true;
    })
    .sort((left, right) => {
      const dateDifference = Date.parse(right.date) - Date.parse(left.date);
      return dateDifference || right.messageId.localeCompare(left.messageId);
    })
    .slice(0, Math.max(0, limit));
}

export function selectDailyMailTranslationPrefetchCandidates<
  T extends MailTranslationPrefetchCandidate & { answeredAt?: string; completedAt?: string },
>(candidates: T[], options: { includeCompleted?: boolean } = {}) {
  const seen = new Set<string>();
  return [...candidates]
    .filter((candidate) => {
      const identity = `${candidate.provider}::${candidate.mailAccountId}::${candidate.messageId}`;
      if (!candidate.messageId || seen.has(identity)) return false;
      if (!options.includeCompleted && candidate.completedAt) return false;
      const incomingAt = Date.parse(candidate.date);
      const answeredAt = Date.parse(candidate.answeredAt || '');
      if (Number.isFinite(incomingAt) && Number.isFinite(answeredAt) && answeredAt > incomingAt) return false;
      const originalText = normalizeMailTranslationText(candidate.body);
      const currentText = splitEmailForTranslation(originalText).currentText || originalText;
      if (!currentText.trim()) return false;
      seen.add(identity);
      return true;
    })
    .sort((left, right) => {
      const dateDifference = Date.parse(right.date) - Date.parse(left.date);
      return dateDifference || right.messageId.localeCompare(left.messageId);
    });
}

export class GmailTranslationPrefetchQueue {
  private readonly pending = new Map<string, MailTranslationPrefetchCandidate>();
  private readonly processed = new Set<string>();
  private readonly knownCandidates = new Map<string, MailTranslationPrefetchCandidate>();
  private readonly failureCounts = new Map<string, number>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly runningCandidateKeys = new Set<string>();
  private desiredCandidateKeys = new Set<string>();
  private activeCount = 0;
  private stopped = false;

  constructor(
    private readonly process: (candidate: MailTranslationPrefetchCandidate) => Promise<void>,
    private readonly options: {
      concurrency?: number;
      retryDelaysMs?: readonly number[];
      accountScope?: string;
    } = {},
  ) {}

  private candidateKey(candidate: Pick<MailTranslationPrefetchCandidate, 'provider' | 'mailAccountId' | 'messageId' | 'body'>) {
    return JSON.stringify([candidate.provider, candidate.mailAccountId, candidate.messageId, normalizeMailTranslationText(candidate.body)]);
  }

  private emitStatus(
    candidate: MailTranslationPrefetchCandidate,
    status: MailTranslationPrefetchStatus,
    error?: string,
  ) {
    publishMailTranslationPrefetchStatus({
      scopeKey: getMailTranslationScopeKey(candidate.mailAccountId, this.options.accountScope),
      messageId: candidate.messageId,
      originalText: normalizeMailTranslationText(candidate.body),
      status,
      error,
    });
  }

  private addPendingFirst(key: string, candidate: MailTranslationPrefetchCandidate) {
    const reordered = [[key, candidate] as const, ...this.pending.entries()];
    this.pending.clear();
    reordered.forEach(([candidateKey, item]) => this.pending.set(candidateKey, item));
  }

  enqueue(candidates: MailTranslationPrefetchCandidate[]) {
    if (this.stopped) return;
    candidates.forEach((candidate) => {
      const key = this.candidateKey(candidate);
      this.knownCandidates.set(key, candidate);
      this.desiredCandidateKeys.add(key);
      if (
        candidate.messageId
        && !this.pending.has(key)
        && !this.runningCandidateKeys.has(key)
        && !this.retryTimers.has(key)
        && !this.processed.has(key)
      ) {
        this.pending.set(key, candidate);
        this.emitStatus(candidate, 'queued');
      }
    });
    this.drain();
  }

  synchronize(candidates: MailTranslationPrefetchCandidate[]) {
    const desired = new Set(candidates.map((candidate) => this.candidateKey(candidate)));
    this.desiredCandidateKeys = desired;
    candidates.forEach((candidate) => this.knownCandidates.set(this.candidateKey(candidate), candidate));
    this.pending.forEach((_candidate, key) => {
      if (!desired.has(key)) this.pending.delete(key);
    });
    this.retryTimers.forEach((timer, key) => {
      if (desired.has(key)) return;
      clearTimeout(timer);
      this.retryTimers.delete(key);
      this.failureCounts.delete(key);
    });
    this.knownCandidates.forEach((_candidate, key) => {
      if (!desired.has(key) && !this.runningCandidateKeys.has(key)) this.knownCandidates.delete(key);
    });
    this.enqueue(candidates);
  }

  prioritize(messageId: string, scopeKey?: string) {
    const entry = [...this.pending.entries()].find(([, candidate]) => (
      candidate.messageId === messageId
      && (!scopeKey || getMailTranslationScopeKey(candidate.mailAccountId, this.options.accountScope) === scopeKey)
    ));
    if (entry) {
      const [key, candidate] = entry;
      this.pending.delete(key);
      this.addPendingFirst(key, candidate);
      this.drain();
      return;
    }
    this.retry(messageId, scopeKey);
  }

  retry(messageId: string, scopeKey?: string) {
    const entry = [...this.knownCandidates.entries()].find(([, candidate]) => (
      candidate.messageId === messageId
      && (!scopeKey || getMailTranslationScopeKey(candidate.mailAccountId, this.options.accountScope) === scopeKey)
    ));
    if (!entry) return;
    const [key, candidate] = entry;
    const timer = this.retryTimers.get(key);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(key);
    this.failureCounts.delete(key);
    this.processed.delete(key);
    if (!this.runningCandidateKeys.has(key)) {
      this.pending.delete(key);
      this.addPendingFirst(key, candidate);
      this.emitStatus(candidate, 'queued');
      this.drain();
    }
  }

  stop() {
    this.stopped = true;
    this.pending.clear();
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers.clear();
    this.knownCandidates.clear();
    this.desiredCandidateKeys.clear();
  }

  getPendingMessageIds() {
    return [...this.pending.values()].map((candidate) => candidate.messageId);
  }

  private drain() {
    const concurrency = Math.max(1, this.options.concurrency || MAIL_TRANSLATION_BACKGROUND_CONCURRENCY);
    while (!this.stopped && this.activeCount < concurrency && this.pending.size > 0) {
      const [candidateKey, candidate] = this.pending.entries().next().value as [
        string,
        MailTranslationPrefetchCandidate,
      ];
      this.pending.delete(candidateKey);
      this.activeCount += 1;
      this.runningCandidateKeys.add(candidateKey);
      this.emitStatus(candidate, 'translating');
      void this.process(candidate)
        .then(() => {
          if (this.stopped || !this.desiredCandidateKeys.has(candidateKey)) return;
          this.processed.add(candidateKey);
          this.failureCounts.delete(candidateKey);
          this.emitStatus(candidate, 'ready');
        })
        .catch((error) => {
          if (this.stopped || !this.desiredCandidateKeys.has(candidateKey)) return;
          const failureCount = (this.failureCounts.get(candidateKey) || 0) + 1;
          this.failureCounts.set(candidateKey, failureCount);
          const retryDelays = this.options.retryDelaysMs || MAIL_TRANSLATION_RETRY_DELAYS_MS;
          const retryDelay = retryDelays[failureCount - 1];
          const errorMessage = error instanceof Error ? error.message : '翻译失败，请稍后重试';
          if (retryDelay === undefined) {
            this.processed.add(candidateKey);
            this.emitStatus(candidate, 'failed', errorMessage);
            return;
          }
          this.emitStatus(candidate, 'retrying', errorMessage);
          const timer = setTimeout(() => {
            this.retryTimers.delete(candidateKey);
            if (this.stopped || this.processed.has(candidateKey)) return;
            this.pending.set(candidateKey, candidate);
            this.emitStatus(candidate, 'queued');
            this.drain();
          }, retryDelay);
          this.retryTimers.set(candidateKey, timer);
        })
        .finally(() => {
          this.activeCount = Math.max(0, this.activeCount - 1);
          this.runningCandidateKeys.delete(candidateKey);
          this.drain();
        });
    }
  }
}

export function registerGmailTranslationPrefetchQueue(scopeKey: string, queue: GmailTranslationPrefetchQueue) {
  registeredQueues.set(scopeKey, queue);
  return () => {
    if (registeredQueues.get(scopeKey) === queue) registeredQueues.delete(scopeKey);
  };
}

export function prioritizeGmailTranslationPrefetch(messageId: string, scopeKey: string) {
  registeredQueues.get(scopeKey)?.prioritize(messageId, scopeKey);
}

export function retryMailTranslationPrefetch(messageId: string, scopeKey: string) {
  registeredQueues.get(scopeKey)?.retry(messageId, scopeKey);
}

export function clearGmailTranslationRequests() {
  requestGeneration += 1;
  waitingTranslations.forEach((job) => job.reject(new Error('账号已切换，请重新打开邮件。')));
  waitingTranslations.clear();
  inFlightTranslations.clear();
  recentTranslations.clear();
  registeredQueues.forEach((queue) => queue.stop());
  registeredQueues.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, clearGmailTranslationRequests);
}
