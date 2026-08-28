import { ACCOUNT_SCOPE_CHANGED_EVENT, getAccountCacheScope } from '@/lib/account-cache-scope';
import { resolveMailMessageReadableText } from '@/lib/email-text';
import { isIgnoredGmailThreadSender } from '@/lib/gmail-thread-contact';
import type { MailProvider } from '@/lib/mail-accounts';
import type { GmailThread } from '@/lib/types';

export type GmailAIHistoryMessage = {
  id?: string;
  threadId?: string;
  provider?: MailProvider;
  mailAccountId?: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  replyTo?: string;
  date?: string;
  body?: string;
  htmlBody?: string;
  snippet?: string;
};

export type GmailAIConversation = {
  text: string;
  inputCharacters: number;
  outputCharacters: number;
  messageCount: number;
};

export type MailAIThreadContextIdentity = {
  version: typeof MAIL_AI_THREAD_CONTEXT_VERSION;
  provider: MailProvider;
  mailAccountId: string;
  threadId: string;
  targetMessageId: string;
};

export type ValidatedMailAIThreadContext = {
  identity: MailAIThreadContextIdentity;
  messages: GmailAIHistoryMessage[];
};

export const GMAIL_AI_HISTORY_LIMIT = 10;
export const GMAIL_AI_CACHE_MS = 5 * 60_000;
export const GMAIL_AI_CACHE_MAX_ENTRIES = 100;
export const GMAIL_AI_MAX_CONVERSATION_CHARACTERS = 30_000;
export const GMAIL_AI_MAX_MESSAGE_CHARACTERS = 3_500;
export const GMAIL_AI_DRAFT_HISTORY_LIMIT = 6;
export const MAIL_AI_THREAD_CONTEXT_VERSION = 2 as const;

export function buildGmailAIThreadMessages(
  thread: GmailThread,
  targetMessageId = '',
  targetMessageDate?: string,
  mailContext?: { provider: MailProvider; mailAccountId: string },
) {
  const messages = thread.messages
    .filter((message) => !isIgnoredGmailThreadSender(message.from))
    .map((message) => ({
      id: message.id,
      threadId: message.threadId,
      provider: mailContext?.provider || message.provider,
      mailAccountId: mailContext?.mailAccountId || message.mailAccountId,
      subject: message.subject || thread.subject,
      from: message.from,
      to: message.to,
      cc: message.cc,
      replyTo: message.replyTo,
      date: message.date,
      body: resolveMailMessageReadableText({
        body: message.body,
        htmlBody: message.htmlBody,
        snippet: message.snippet || thread.snippet,
      }),
    }));
  return targetMessageId
    ? scopeGmailAIMessagesToReplyTarget(messages, targetMessageId, targetMessageDate)
    : messages;
}

const QUOTED_HISTORY_MARKERS = [
  /^\s*-{2,}\s*original message\s*-{2,}\s*$/im,
  /^\s*-{2,}\s*forwarded message\s*-{2,}\s*$/im,
  /^\s*on .{0,240} wrote:\s*$/im,
  /^\s*el .{0,240} escribió:\s*$/im,
  /^\s*le .{0,240} a écrit\s*:\s*$/im,
  /^\s*am .{0,240} schrieb .{0,120}:\s*$/im,
  /^\s*op .{0,240} schreef .{0,120}:\s*$/im,
  /^\s*den .{0,240} skrev .{0,120}:\s*$/im,
] as const;

const BUSINESS_DETAIL_PATTERN = /(?:[$€£¥]|\b\d+(?:[.,]\d+)?\s*(?:usd|eur|gbp|cny|rmb|sek|nok|dkk|pln|%|days?|weeks?)\b|\b\d{1,4}[./-]\d{1,2}(?:[./-]\d{1,4})?\b|price|budget|fee|quote|cost|publish|date|deadline|ship|tracking|deliver|address|product|discount|affiliate|commission|报价|预算|费用|价格|发布|日期|发货|物流|地址|产品|折扣|佣金)/i;

type CacheEntry<T> = {
  fetchedAt: number;
  value: T;
};

const historyCache = new Map<string, CacheEntry<GmailAIHistoryMessage[]>>();
const historyRequests = new Map<string, Promise<GmailAIHistoryMessage[]>>();
const analysisCache = new Map<string, CacheEntry<unknown>>();
const analysisRequests = new Map<string, Promise<unknown>>();

if (typeof window !== 'undefined') {
  window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, () => {
    historyCache.clear();
    historyRequests.clear();
    analysisCache.clear();
    analysisRequests.clear();
  });
}

function parseMessageTime(value?: string) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function messageKey(message: GmailAIHistoryMessage, index: number) {
  return message.id || `${message.date || ''}:${message.from || ''}:${message.to || ''}:${index}`;
}

function touchCacheEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > GMAIL_AI_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function readCacheEntry<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  now = Date.now(),
) {
  const entry = cache.get(key);
  if (!entry || now - entry.fetchedAt >= GMAIL_AI_CACHE_MS) {
    if (entry) cache.delete(key);
    return null;
  }
  touchCacheEntry(cache, key, entry);
  return entry.value;
}

function hashCachePart(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function buildMailAIThreadContextIdentity(input: {
  provider: MailProvider;
  mailAccountId: string;
  threadId: string;
  targetMessageId: string;
}): MailAIThreadContextIdentity {
  return {
    version: MAIL_AI_THREAD_CONTEXT_VERSION,
    provider: input.provider,
    mailAccountId: input.mailAccountId.trim(),
    threadId: input.threadId.trim(),
    targetMessageId: input.targetMessageId.trim(),
  };
}

export function buildMailAIThreadContextCacheKey(
  identity: MailAIThreadContextIdentity,
  messages: GmailAIHistoryMessage[],
) {
  const messageFingerprint = messages.map((message) => [
    message.id || '',
    message.threadId || '',
    message.date || '',
    hashCachePart(resolveMailMessageReadableText(message)),
  ].join(':')).join('|');
  return [
    `thread-context-v${identity.version}`,
    identity.provider,
    identity.mailAccountId,
    identity.threadId,
    identity.targetMessageId,
    hashCachePart(messageFingerprint),
  ].join('|');
}

export function validateMailAIThreadContext(input: {
  identity: unknown;
  messages: unknown;
}): ValidatedMailAIThreadContext {
  const rawIdentity = input.identity && typeof input.identity === 'object'
    ? input.identity as Record<string, unknown>
    : {};
  if (rawIdentity.provider !== 'gmail' && rawIdentity.provider !== 'tencent_exmail') {
    throw new Error('邮件来源类型无效，请重新打开邮件后重试。');
  }
  const identity = buildMailAIThreadContextIdentity({
    provider: rawIdentity.provider,
    mailAccountId: String(rawIdentity.mailAccountId || ''),
    threadId: String(rawIdentity.threadId || ''),
    targetMessageId: String(rawIdentity.targetMessageId || ''),
  });

  if (rawIdentity.version !== MAIL_AI_THREAD_CONTEXT_VERSION) {
    throw new Error('邮件上下文版本已过期，请刷新邮件后重试。');
  }
  if (!identity.mailAccountId || !identity.threadId || !identity.targetMessageId) {
    throw new Error('邮件账号、会话或回复目标不完整，请重新打开邮件后重试。');
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new Error('当前会话没有可供 AI 分析的邮件。');
  }

  const messages = (input.messages as GmailAIHistoryMessage[]).map((message) => ({
    id: String(message?.id || ''),
    threadId: String(message?.threadId || ''),
    provider: message?.provider,
    mailAccountId: String(message?.mailAccountId || ''),
    subject: String(message?.subject || ''),
    from: String(message?.from || ''),
    to: String(message?.to || ''),
    cc: String(message?.cc || ''),
    replyTo: String(message?.replyTo || ''),
    date: String(message?.date || ''),
    body: resolveMailMessageReadableText({
      body: String(message?.body || ''),
      htmlBody: String(message?.htmlBody || ''),
      snippet: String(message?.snippet || ''),
    }),
  }));
  if (messages.some((message) => (
    !message.id
    || message.threadId !== identity.threadId
    || message.provider !== identity.provider
    || message.mailAccountId !== identity.mailAccountId
  ))) {
    throw new Error('检测到其他邮件会话混入，AI 已停止生成。请刷新当前邮件后重试。');
  }
  const target = messages.find((message) => message.id === identity.targetMessageId);
  if (!target) {
    throw new Error('当前回复目标不在已加载会话中，请重新打开邮件后重试。');
  }

  return {
    identity,
    messages: scopeGmailAIMessagesToReplyTarget(
      messages,
      identity.targetMessageId,
      target.date,
    ),
  };
}

function stripQuotedHistory(value: string) {
  let cutoff = value.length;
  for (const pattern of QUOTED_HISTORY_MARKERS) {
    const match = pattern.exec(value);
    if (match?.index !== undefined) cutoff = Math.min(cutoff, match.index);
  }

  const withoutQuotedBlock = value.slice(0, cutoff);
  const withoutQuotedLines = withoutQuotedBlock
    .split('\n')
    .filter((line) => !/^\s*>/.test(line))
    .join('\n');

  return withoutQuotedLines.trim() || value.trim();
}

export function compactGmailAIMessageBody(
  body: string,
  maxCharacters = GMAIL_AI_MAX_MESSAGE_CHARACTERS,
) {
  const normalized = String(body || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li|blockquote|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const compacted = stripQuotedHistory(normalized);
  if (compacted.length <= maxCharacters) return compacted;

  const tailCharacters = Math.min(1_000, Math.floor(maxCharacters / 3));
  const headCharacters = maxCharacters - tailCharacters - 20;
  return `${compacted.slice(0, headCharacters).trimEnd()}\n\n[…省略…]\n\n${compacted.slice(-tailCharacters).trimStart()}`;
}

export function mergeRecentGmailAIMessages(
  fetched: GmailAIHistoryMessage[],
  currentThread: GmailAIHistoryMessage[],
  limit = GMAIL_AI_HISTORY_LIMIT,
) {
  const byId = new Map<string, GmailAIHistoryMessage>();
  [...fetched, ...currentThread].forEach((message, index) => {
    byId.set(messageKey(message, index), message);
  });
  return [...byId.values()]
    .sort((a, b) => parseMessageTime(a.date) - parseMessageTime(b.date))
    .slice(-limit);
}

export function buildCompactGmailAIConversation(
  messages: GmailAIHistoryMessage[],
  options: {
    maxCharacters?: number;
    maxMessageCharacters?: number;
  } = {},
): GmailAIConversation {
  const maxCharacters = options.maxCharacters ?? GMAIL_AI_MAX_CONVERSATION_CHARACTERS;
  const maxMessageCharacters = options.maxMessageCharacters ?? GMAIL_AI_MAX_MESSAGE_CHARACTERS;
  const selectedMessages = [...messages]
    .sort((a, b) => parseMessageTime(a.date) - parseMessageTime(b.date))
    .slice(-GMAIL_AI_HISTORY_LIMIT);
  const inputCharacters = selectedMessages.reduce(
    (total, message) => total + resolveMailMessageReadableText(message).length,
    0,
  );
  let remaining = maxCharacters;
  const sections: string[] = [];

  selectedMessages.forEach((message, index) => {
    if (remaining <= 0) return;
    const header = `--- 邮件 ${index + 1} ---
主题：${message.subject || '无主题'}
时间：${message.date || '未知'}
发件人：${message.from || '未知'}
收件人：${message.to || '未知'}
抄送：${message.cc || '无'}
正文：`;
    const bodyLimit = Math.max(300, Math.min(maxMessageCharacters, remaining - header.length));
    const body = compactGmailAIMessageBody(resolveMailMessageReadableText(message), bodyLimit);
    const section = `${header}${body}`.slice(0, remaining);
    sections.push(section);
    remaining -= section.length + 2;
  });

  const text = sections.join('\n\n');
  return {
    text,
    inputCharacters,
    outputCharacters: text.length,
    messageCount: selectedMessages.length,
  };
}

export function selectRelevantGmailAIDraftMessages(
  messages: GmailAIHistoryMessage[],
  gmailAccountEmail = '',
  limit = GMAIL_AI_DRAFT_HISTORY_LIMIT,
  targetMessageId = '',
) {
  const chronological = [...messages]
    .sort((a, b) => parseMessageTime(a.date) - parseMessageTime(b.date));
  const targetMessage = targetMessageId
    ? chronological.find((message) => message.id === targetMessageId)
    : undefined;
  const recent = chronological.slice(-GMAIL_AI_HISTORY_LIMIT);
  const sorted = targetMessage && !recent.some((message) => message.id === targetMessageId)
    ? [targetMessage, ...recent.slice(-(GMAIL_AI_HISTORY_LIMIT - 1))]
        .sort((a, b) => parseMessageTime(a.date) - parseMessageTime(b.date))
    : recent;
  if (sorted.length <= limit) return sorted;

  const normalizedAccount = gmailAccountEmail.trim().toLowerCase();
  const selected = new Set<number>();
  const targetIndex = targetMessageId
    ? sorted.findIndex((message) => message.id === targetMessageId)
    : -1;
  selected.add(targetIndex >= 0 ? targetIndex : sorted.length - 1);

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const from = String(sorted[index].from || '').toLowerCase();
    const isFromAccount = normalizedAccount && from.includes(normalizedAccount);
    if (!isFromAccount) {
      selected.add(index);
      break;
    }
  }
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const from = String(sorted[index].from || '').toLowerCase();
    if (normalizedAccount && from.includes(normalizedAccount)) {
      selected.add(index);
      break;
    }
  }
  for (let index = sorted.length - 1; index >= 0 && selected.size < limit; index -= 1) {
    if (BUSINESS_DETAIL_PATTERN.test(resolveMailMessageReadableText(sorted[index]))) selected.add(index);
  }
  for (let index = sorted.length - 1; index >= 0 && selected.size < limit; index -= 1) {
    selected.add(index);
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => sorted[index]);
}

export function scopeGmailAIMessagesToReplyTarget(
  messages: GmailAIHistoryMessage[],
  targetMessageId: string,
  targetDate?: string,
) {
  const targetTime = parseMessageTime(targetDate);
  const scoped = messages.filter((message) => (
    message.id === targetMessageId
    || !targetTime
    || parseMessageTime(message.date) <= targetTime
  ));
  const hasTarget = scoped.some((message) => message.id === targetMessageId);
  const target = hasTarget ? undefined : messages.find((message) => message.id === targetMessageId);
  return [...scoped, ...(target ? [target] : [])]
    .sort((a, b) => parseMessageTime(a.date) - parseMessageTime(b.date))
    .slice(-GMAIL_AI_HISTORY_LIMIT);
}

export function buildGmailAIHistoryCacheKey(parts: {
  accountEmail?: string;
  threadId?: string;
  contactEmail: string;
  latestMessageId?: string;
  latestMessageDate?: string;
  targetMessageId?: string;
}) {
  return [
    parts.accountEmail?.trim().toLowerCase() || 'unknown-account',
    parts.threadId || 'unknown-thread',
    parts.contactEmail.trim().toLowerCase(),
    parts.targetMessageId || parts.latestMessageId || 'unknown-message',
    parts.latestMessageDate || 'unknown-date',
  ].join('|');
}

export function buildGmailAIAnalysisCacheKey(
  historyKey: string,
  settings: {
    modelProvider?: string;
    customApiUrl?: string;
    customModelName?: string;
    analysisPrompt?: string;
  },
) {
  return [
    historyKey,
    settings.modelProvider || 'builtin',
    hashCachePart(settings.customApiUrl || ''),
    settings.customModelName || '',
    hashCachePart(settings.analysisPrompt || ''),
  ].join('|');
}

export async function getOrLoadGmailAIHistory(
  key: string,
  loader: () => Promise<GmailAIHistoryMessage[]>,
  force = false,
) {
  const scopedKey = `${getAccountCacheScope()}::${key}`;
  if (!force) {
    const cached = readCacheEntry(historyCache, scopedKey);
    if (cached) return { value: cached, cacheHit: true };
    const pending = historyRequests.get(scopedKey);
    if (pending) return { value: await pending, cacheHit: true };
  }

  const request = loader();
  historyRequests.set(scopedKey, request);
  try {
    const value = await request;
    touchCacheEntry(historyCache, scopedKey, { fetchedAt: Date.now(), value });
    return { value, cacheHit: false };
  } finally {
    if (historyRequests.get(scopedKey) === request) historyRequests.delete(scopedKey);
  }
}

export async function loadGmailAIContactHistory(options: {
  accountEmail?: string;
  thread: GmailThread;
  contactEmail: string;
  targetMessageId?: string;
  targetMessageDate?: string;
  force?: boolean;
}) {
  const {
    accountEmail,
    thread,
    contactEmail,
    targetMessageId = '',
    targetMessageDate,
    force = false,
  } = options;
  const threadMessages = buildGmailAIThreadMessages(
    thread,
    targetMessageId,
    targetMessageDate,
  );
  const historyKey = buildGmailAIHistoryCacheKey({
    accountEmail,
    threadId: thread.id,
    contactEmail: contactEmail || 'no-recipient',
    targetMessageId,
    latestMessageDate: targetMessageDate,
  });
  const startedAt = performance.now();
  const loaded = await getOrLoadGmailAIHistory(historyKey, async () => {
    if (!contactEmail || !targetMessageId) return threadMessages;
    const response = await fetch('/api/gmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'contactHistory',
        contactEmail,
        maxResults: GMAIL_AI_HISTORY_LIMIT,
        knownMessageIds: thread.messages.map((message) => message.id).filter(Boolean),
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || '读取联系人历史邮件失败');
    }
    console.info('[Gmail AI server history timing]', result.meta || {});
    const scopedFetched = scopeGmailAIMessagesToReplyTarget(
      (result.data || []) as GmailAIHistoryMessage[],
      targetMessageId,
      targetMessageDate,
    );
    const merged = mergeRecentGmailAIMessages(scopedFetched, threadMessages);
    return scopeGmailAIMessagesToReplyTarget(merged, targetMessageId, targetMessageDate);
  }, force);

  const totalMs = Math.round(performance.now() - startedAt);
  console.info('[Gmail AI client history timing]', {
    cacheHit: loaded.cacheHit,
    messages: loaded.value.length,
    totalMs,
  });
  return {
    messages: loaded.value,
    historyKey,
    cacheHit: loaded.cacheHit,
    totalMs,
  };
}

export async function getOrLoadGmailAIAnalysis<T>(
  key: string,
  loader: () => Promise<T>,
  force = false,
) {
  const scopedKey = `${getAccountCacheScope()}::${key}`;
  if (!force) {
    const cached = readCacheEntry(analysisCache, scopedKey) as T | null;
    if (cached) return { value: cached, cacheHit: true };
    const pending = analysisRequests.get(scopedKey);
    if (pending) return { value: await pending as T, cacheHit: true };
  }

  const request = loader();
  analysisRequests.set(scopedKey, request);
  try {
    const value = await request;
    touchCacheEntry(analysisCache, scopedKey, { fetchedAt: Date.now(), value });
    return { value, cacheHit: false };
  } finally {
    if (analysisRequests.get(scopedKey) === request) analysisRequests.delete(scopedKey);
  }
}

export function clearGmailAIReplyCaches() {
  historyCache.clear();
  historyRequests.clear();
  analysisCache.clear();
  analysisRequests.clear();
}
