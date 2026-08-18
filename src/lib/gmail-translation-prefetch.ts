import type { AppSettings } from '@/lib/data';
import { getAccountCacheScope } from '@/lib/account-cache-scope';
import { detectEmailLanguage } from '@/lib/email-language';

export const GMAIL_PRIMARY_INBOX_REFRESHED_EVENT = 'gmail-primary-inbox-refreshed';

export type GmailTranslationPrefetchCandidate = {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  date: string;
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

export function getGmailTranslationScopeKey(gmailEmail?: string, accountScope = getAccountCacheScope()) {
  return `${accountScope}::${gmailEmail?.trim().toLowerCase() || 'unknown-gmail'}`;
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

export class GmailTranslationPrefetchQueue {
  private static readonly MAX_QUEUE_SIZE = 3;
  private readonly pending = new Map<string, GmailTranslationPrefetchCandidate>();
  private readonly failed = new Set<string>();
  private readonly processed = new Set<string>();
  private running = false;
  private runningMessageId: string | null = null;
  private stopped = false;

  constructor(
    private readonly process: (candidate: GmailTranslationPrefetchCandidate) => Promise<void>,
  ) {}

  enqueue(candidates: GmailTranslationPrefetchCandidate[]) {
    if (this.stopped) return;
    candidates.forEach((candidate) => {
      if (
        candidate.messageId
        && this.pending.size + (this.runningMessageId ? 1 : 0) < GmailTranslationPrefetchQueue.MAX_QUEUE_SIZE
        && !this.pending.has(candidate.messageId)
        && !this.failed.has(candidate.messageId)
        && !this.processed.has(candidate.messageId)
      ) {
        this.pending.set(candidate.messageId, candidate);
      }
    });
    void this.drain();
  }

  prioritize(messageId: string) {
    const candidate = this.pending.get(messageId);
    if (!candidate) return;
    const reordered = [[messageId, candidate] as const, ...this.pending.entries()];
    this.pending.clear();
    reordered.forEach(([id, item]) => this.pending.set(id, item));
    if (!this.running) void this.drain();
  }

  stop() {
    this.stopped = true;
    this.pending.clear();
  }

  getPendingMessageIds() {
    return [...this.pending.keys()];
  }

  private async drain() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped && this.pending.size > 0) {
        const [messageId, candidate] = this.pending.entries().next().value as [
          string,
          GmailTranslationPrefetchCandidate,
        ];
        this.pending.delete(messageId);
        this.processed.add(messageId);
        this.runningMessageId = messageId;
        try {
          await this.process(candidate);
        } catch {
          this.failed.add(messageId);
        } finally {
          this.runningMessageId = null;
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
  registeredQueues.get(scopeKey)?.prioritize(messageId);
}

export function clearGmailTranslationRequests() {
  inFlightTranslations.clear();
  recentTranslations.clear();
  scopeTranslationTails.clear();
  registeredQueues.forEach((queue) => queue.stop());
  registeredQueues.clear();
}
