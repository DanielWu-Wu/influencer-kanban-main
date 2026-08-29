import type { AppSettings } from '@/lib/data';
import { getAccountCacheScope } from '@/lib/account-cache-scope';
import { detectEmailLanguage } from '@/lib/email-language';
import type { MailProvider } from '@/lib/mail-accounts';
import { repairTextEncoding, splitEmailForTranslation } from '@/lib/email-text';

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
  settings: Pick<
    AppSettings,
    'translatePrompt' | 'modelProvider' | 'customApiUrl' | 'customModelName'
  >;
  onProgress?: (translatedText: string) => void;
};

const inFlightTranslations = new Map<string, Promise<GmailTranslationRequestResult>>();
const recentTranslations = new Map<string, { result: GmailTranslationRequestResult; expiresAt: number }>();
const scopeTranslationTails = new Map<string, Promise<void>>();
const registeredQueues = new Map<string, GmailTranslationPrefetchQueue>();
const TRANSLATION_FAILURE_COOLDOWN_MS = 30 * 60_000;

function createTranslationRequestKey(scopeKey: string, messageId: string, text: string) {
  return `${scopeKey}::${messageId}::${text}`;
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

export function requestGmailTranslation(options: GmailTranslationRequestOptions) {
  const key = createTranslationRequestKey(options.scopeKey, options.messageId, options.text);
  const recent = recentTranslations.get(key);
  if (recent && recent.expiresAt > Date.now()) {
    options.onProgress?.(recent.result.translatedText);
    return Promise.resolve(recent.result);
  }
  if (recent) recentTranslations.delete(key);
  const existing = inFlightTranslations.get(key);
  if (existing) {
    existing.then((result) => options.onProgress?.(result.translatedText)).catch(() => undefined);
    return existing;
  }

  const previous = scopeTranslationTails.get(options.scopeKey) || Promise.resolve();
  const request = previous
    .catch(() => undefined)
    .then(() => executeTranslationRequest(options))
    .then((result) => {
      recentTranslations.set(key, { result, expiresAt: Date.now() + 60_000 });
      return result;
    })
    .finally(() => {
      if (inFlightTranslations.get(key) === request) inFlightTranslations.delete(key);
    });
  inFlightTranslations.set(key, request);
  const tail = request.then(() => undefined, () => undefined).finally(() => {
    if (scopeTranslationTails.get(options.scopeKey) === tail) {
      scopeTranslationTails.delete(options.scopeKey);
    }
  });
  scopeTranslationTails.set(options.scopeKey, tail);
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
      const originalText = repairTextEncoding(candidate.body);
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
  private readonly failedUntil = new Map<string, number>();
  private readonly processed = new Set<string>();
  private running = false;
  private runningMessageId: string | null = null;
  private runningCandidateKey: string | null = null;
  private stopped = false;

  constructor(
    private readonly process: (candidate: MailTranslationPrefetchCandidate) => Promise<void>,
  ) {}

  private candidateKey(candidate: Pick<MailTranslationPrefetchCandidate, 'provider' | 'mailAccountId' | 'messageId' | 'body'>) {
    return `${candidate.provider}::${candidate.mailAccountId}::${candidate.messageId}::${candidate.body}`;
  }

  enqueue(candidates: MailTranslationPrefetchCandidate[]) {
    if (this.stopped) return;
    candidates.forEach((candidate) => {
      const key = this.candidateKey(candidate);
      const retryAt = this.failedUntil.get(key) || 0;
      if (retryAt && retryAt <= Date.now()) this.failedUntil.delete(key);
      if (
        candidate.messageId
        && !this.pending.has(key)
        && this.runningCandidateKey !== key
        && retryAt <= Date.now()
        && !this.processed.has(key)
      ) {
        this.pending.set(key, candidate);
      }
    });
    void this.drain();
  }

  synchronize(candidates: MailTranslationPrefetchCandidate[]) {
    const desired = new Set(candidates.map((candidate) => this.candidateKey(candidate)));
    this.pending.forEach((_candidate, key) => {
      if (!desired.has(key)) this.pending.delete(key);
    });
    this.enqueue(candidates);
  }

  prioritize(messageId: string, scopeKey?: string) {
    const entry = [...this.pending.entries()].find(([, candidate]) => (
      candidate.messageId === messageId
      && (!scopeKey || getMailTranslationScopeKey(candidate.mailAccountId) === scopeKey)
    ));
    if (!entry) return;
    const [key, candidate] = entry;
    const reordered = [[key, candidate] as const, ...this.pending.entries()];
    this.pending.clear();
    reordered.forEach(([id, item]) => this.pending.set(id, item));
    if (!this.running) void this.drain();
  }

  stop() {
    this.stopped = true;
    this.pending.clear();
  }

  getPendingMessageIds() {
    return [...this.pending.values()].map((candidate) => candidate.messageId);
  }

  private async drain() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped && this.pending.size > 0) {
        const [candidateKey, candidate] = this.pending.entries().next().value as [
          string,
          MailTranslationPrefetchCandidate,
        ];
        this.pending.delete(candidateKey);
        this.runningMessageId = candidate.messageId;
        this.runningCandidateKey = candidateKey;
        try {
          await this.process(candidate);
          this.processed.add(candidateKey);
        } catch {
          this.failedUntil.set(candidateKey, Date.now() + TRANSLATION_FAILURE_COOLDOWN_MS);
        } finally {
          this.runningMessageId = null;
          this.runningCandidateKey = null;
        }
      }
    } finally {
      this.running = false;
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

export function clearGmailTranslationRequests() {
  inFlightTranslations.clear();
  recentTranslations.clear();
  scopeTranslationTails.clear();
  registeredQueues.forEach((queue) => queue.stop());
  registeredQueues.clear();
}
