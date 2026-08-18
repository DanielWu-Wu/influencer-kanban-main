'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Languages,
  Loader2,
  LogOut,
  Mail,
  MailOpen,
  RefreshCw,
  Reply,
  Search,
  Star,
  Tag,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useGmailAuth, useSettings } from '@/lib/data';
import { repairTextEncoding } from '@/lib/email-text';
import { extractMappedFeishuChannelUrl } from '@/lib/feishu-field-value';
import type { FeishuFieldMapping } from '@/lib/feishu-mapping';
import {
  getGmailThreadContact,
  isIgnoredGmailThreadSender,
} from '@/lib/gmail-thread-contact';
import {
  clearGmailInboxCache,
  createGmailInboxCacheKey,
  isGmailInboxCacheFresh,
  isGmailInboxCacheKeyCurrent,
  readGmailInboxCache,
  writeGmailInboxCache,
} from '@/lib/gmail-inbox-cache';
import { loadGmailAIContactHistory } from '@/lib/gmail-ai-reply';
import { collectGmailThreadParticipants, resolveGmailReplyTarget } from '@/lib/gmail-reply-target';
import {
  fetchFeishuRecordsCached,
  type CachedFeishuRecord as FeishuRecord,
} from '@/lib/feishu-record-cache';
import {
  GmailAttachment,
  GmailCategory,
  GmailMailbox,
  GmailMessage,
  GmailThread,
} from '@/lib/types';
import {
  buildChannelAvatarLookup,
  channelAvatarLookupPriority,
  readChannelAvatarCache,
  resolveChannelAvatars,
  type ChannelAvatarState,
} from '@/lib/youtube-channel-avatar';
import { YouTubeChannelAvatar } from './youtube-channel-avatar';
import { GMAIL_AUTH_CACHE_RESET_EVENT } from './gmail-auth-provider';
import { ACCOUNT_SCOPE_CHANGED_EVENT, getAccountCacheScope } from '@/lib/account-cache-scope';
import { GMAIL_PRIMARY_INBOX_REFRESHED_EVENT } from '@/lib/gmail-translation-prefetch';
import {
  beginGmailReadStateOperation,
  clearGmailReadStateRuntime,
  copyGmailThreadReadState,
  getAutomaticGmailReadRequest,
  getGmailReadScopeKey,
  getGmailReadStateOperationVersion,
  hasManualGmailUnreadPreference,
  registerAutomaticGmailReadRequest,
  setGmailThreadReadState,
  setManualGmailUnreadPreference,
  shouldAutoMarkGmailThreadRead,
  shouldRollbackAutomaticGmailRead,
  waitForAutomaticGmailRead,
} from '@/lib/gmail-read-state';

const GMAIL_PAGE_SIZE = 50;
const GMAIL_DETAIL_BATCH_SIZE = 16;
const GMAIL_AUTO_REFRESH_MS = 60_000;
const GMAIL_CACHE_STALE_MS = 60_000;
const GMAIL_THREAD_DETAIL_CACHE_MS = 5 * 60_000;
const GMAIL_THREAD_PREFETCH_DELAY_MS = 180;
const GMAIL_SEARCH_DEBOUNCE_MS = 400;
const SUBJECT_TRANSLATION_BATCH_SIZE = 12;

function notifyPrimaryInboxRefreshed(mailbox: GmailMailbox, category: GmailCategory, isGlobalSearch: boolean) {
  if (mailbox !== 'inbox' || category !== 'primary' || isGlobalSearch) return;
  window.dispatchEvent(new Event(GMAIL_PRIMARY_INBOX_REFRESHED_EVENT));
}

type GmailThreadLoadState = {
  loading: boolean;
  error?: string;
};

interface GmailInboxProps {
  active?: boolean;
  onSelectThread: (thread: GmailThread) => void;
  onThreadLoadStateChange?: (threadId: string, state: GmailThreadLoadState) => void;
  onThreadUpdated?: (thread: GmailThread) => void;
  onCategoryChange: (category: GmailCategory) => void;
  updatedThread?: GmailThread | null;
  selectedThreadId?: string;
  threadDetailVisible?: boolean;
  mailbox: GmailMailbox;
  category: GmailCategory;
  refreshKey?: number;
  compact?: boolean;
  avatarOnly?: boolean;
  openThreadRequest?: { threadId: string; requestId: number };
}

type GmailThreadDetailCacheEntry = {
  thread: GmailThread;
  fetchedAt: number;
};

const gmailThreadDetailCache = new Map<string, GmailThreadDetailCacheEntry>();
const gmailThreadDetailRequests = new Map<string, Promise<GmailThread>>();

function gmailThreadCacheKey(threadId: string, scope = getAccountCacheScope()) {
  return `${scope}::${threadId}`;
}

if (typeof window !== 'undefined') {
  const clearGmailCaches = () => {
    gmailThreadDetailCache.clear();
    gmailThreadDetailRequests.clear();
    clearGmailInboxCache();
  };
  window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, clearGmailCaches);
  window.addEventListener(GMAIL_AUTH_CACHE_RESET_EVENT, clearGmailCaches);
}

const MAILBOX_LABELS: Record<GmailMailbox, string> = {
  inbox: '\u6536\u4ef6\u7bb1',
  unread: '\u672a\u8bfb\u90ae\u4ef6',
  starred: '\u5df2\u6807\u661f',
  sent: '\u5df2\u53d1\u9001',
  drafts: '\u8349\u7a3f',
};

const CATEGORY_TABS: Array<{
  id: GmailCategory;
  label: string;
  icon: typeof Inbox;
}> = [
  { id: 'primary', label: '\u4e3b\u8981', icon: Inbox },
  { id: 'promotions', label: '\u63a8\u5e7f', icon: Tag },
  { id: 'social', label: '\u793e\u4ea4', icon: Users },
];

const CATEGORY_LABEL_IDS: Partial<Record<GmailCategory, string>> = {
  promotions: 'CATEGORY_PROMOTIONS',
  social: 'CATEGORY_SOCIAL',
};

const NORMAL_INBOX_EXCLUDED_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL']);

const MAILBOX_API_LABELS: Record<GmailMailbox, string[]> = {
  inbox: ['INBOX'],
  unread: ['INBOX', 'UNREAD'],
  starred: ['STARRED'],
  sent: ['SENT'],
  drafts: ['DRAFT'],
};

const NORMAL_UNREAD_QUERY = 'in:inbox is:unread -category:promotions -category:social';

function getHeader(headers: { name: string; value: string }[], name: string): string {
  return headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function getDateTimestamp(dateString: string | undefined): number {
  const timestamp = Date.parse(dateString || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getApiMessageTimestamp(message: Record<string, unknown>): number {
  const internalDate = Number(message.internalDate);
  if (Number.isFinite(internalDate) && internalDate > 0) return internalDate;

  const payload = (message.payload || {}) as Record<string, unknown>;
  const headers = (payload.headers as { name: string; value: string }[]) || [];
  return getDateTimestamp(getHeader(headers, 'Date'));
}

function usesLatestIncomingMessage(mailbox: GmailMailbox): boolean {
  return mailbox === 'inbox' || mailbox === 'unread';
}

function getThreadListMessage(thread: GmailThread, mailbox: GmailMailbox): GmailMessage | undefined {
  if (usesLatestIncomingMessage(mailbox)) {
    let latestIncomingMessage: GmailMessage | undefined;
    for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
      const message = thread.messages[index];
      if (!message.labels.includes('INBOX')) continue;
      latestIncomingMessage ??= message;
      if (!isIgnoredGmailThreadSender(message.from)) return message;
    }
    return latestIncomingMessage;
  }

  return thread.messages[thread.messages.length - 1];
}

function getThreadTimestamp(thread: GmailThread, mailbox: GmailMailbox): number {
  const listMessage = getThreadListMessage(thread, mailbox);
  return getDateTimestamp(listMessage?.date || thread.lastMessageDate);
}

function sortThreadsByLatest(threads: GmailThread[], mailbox: GmailMailbox): GmailThread[] {
  return [...threads].sort(
    (left, right) => {
      const timestampDifference = getThreadTimestamp(right, mailbox) - getThreadTimestamp(left, mailbox);
      return timestampDifference || left.id.localeCompare(right.id);
    },
  );
}

function isGmailAuthError(status: number, details: unknown) {
  const message = typeof details === 'string'
    ? details
    : details && typeof details === 'object'
      ? JSON.stringify(details)
      : '';
  return status === 401 || [
    'unauthenticated',
    'invalid authentication credentials',
    'invalid credentials',
    'oauth',
    'access token',
    'autherror',
  ].some((keyword) => message.toLowerCase().includes(keyword));
}

function hasThreadLabel(thread: GmailThread, label: string): boolean {
  return thread.labels.includes(label);
}

function isNormalInboxThread(thread: GmailThread): boolean {
  return hasThreadLabel(thread, 'INBOX')
    && !thread.labels.some((label) => NORMAL_INBOX_EXCLUDED_LABELS.has(label));
}

function shouldShowThreadInMailbox(thread: GmailThread, mailbox: GmailMailbox, category: GmailCategory): boolean {
  if (mailbox === 'inbox' && category === 'primary') return isNormalInboxThread(thread);
  if (mailbox === 'unread') return thread.hasUnread && isNormalInboxThread(thread);
  return true;
}

function detectSubjectLanguage(text: string): string {
  if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
  if (/[\u3040-\u30ff]/.test(text)) return 'ja';
  if (/[\u0400-\u04ff]/.test(text)) return 'ru';
  if (/[áéíóúñ¿¡ãõçàèìòùäöüß]/i.test(text)) return 'auto';
  return 'auto';
}

function parseSubjectTranslations(rawText: string, expectedCount: number): string[] {
  const trimmed = rawText.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean);
    }
  } catch {
    // Fall through to line-based parsing for models that wrap or format JSON.
  }

  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      }
    } catch {
      // Fall through to line-based parsing.
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/^\s*[-*]\s*/, '')
        .replace(/^\s*\d+[\).\uff09:：-]\s*/, '')
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter(Boolean);

  return lines.slice(0, expectedCount);
}

function normalizeEmailAddress(value?: string): string {
  const email = value?.match(/<([^>]+)>/)?.[1] || value || '';
  return email.trim().replace(/^mailto:/i, '').toLowerCase();
}

function stringifyFeishuValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyFeishuValue).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = ['text', 'name', 'email', 'link', 'url', 'value']
      .map((key) => stringifyFeishuValue(record[key]))
      .filter(Boolean);
    if (preferred.length) return preferred.join(' ');
    return Object.values(record).map(stringifyFeishuValue).filter(Boolean).join(' ');
  }
  return '';
}

function getMappedFeishuValue(
  record: FeishuRecord,
  mapping: FeishuFieldMapping,
  key: keyof FeishuFieldMapping,
) {
  const fieldName = mapping[key];
  if (!fieldName) return '';
  return stringifyFeishuValue(record.fields[fieldName]).trim();
}

function extractEmails(value?: string) {
  const raw = value || '';
  const emailMatches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (emailMatches?.length) {
    return emailMatches.map((item) => normalizeEmailAddress(item)).filter(Boolean);
  }
  return raw
    .split(',')
    .map((item) => normalizeEmailAddress(item))
    .filter(Boolean);
}

function isLatestMessageFromEmail(thread: GmailThread, email?: string): boolean {
  const latestMessage = thread.messages[thread.messages.length - 1];
  if (!latestMessage || !email) return false;
  return normalizeEmailAddress(latestMessage.from) === normalizeEmailAddress(email);
}

function normalizeBase64(data: string) {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
}

function decodeBase64Url(data: string, charset = 'utf-8'): string {
  const binary = atob(normalizeBase64(data));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  try {
    return repairTextEncoding(new TextDecoder(charset).decode(bytes));
  } catch {
    return repairTextEncoding(new TextDecoder('utf-8').decode(bytes));
  }
}

function getCharset(headers: { name: string; value: string }[]): string {
  const contentType = getHeader(headers, 'Content-Type');
  return contentType.match(/charset=["']?([^;"'\s]+)/i)?.[1] || 'utf-8';
}

function getContentId(headers: { name: string; value: string }[]): string | undefined {
  return getHeader(headers, 'Content-ID').replace(/[<>]/g, '') || undefined;
}

type ParsedMimeContent = {
  textParts: string[];
  htmlParts: string[];
  attachments: GmailAttachment[];
};

type GmailThreadListResult = {
  threads?: { id: string }[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

type CreatorAvatarProfile = {
  channelName: string;
  channelUrl: string;
  channelId: string;
};

function parseMimeParts(payload: Record<string, unknown>, result: ParsedMimeContent) {
  const mimeType = String(payload.mimeType || '');
  const filename = String(payload.filename || '');
  const headers = (payload.headers as { name: string; value: string }[]) || [];
  const body = (payload.body as Record<string, unknown>) || {};
  const data = typeof body.data === 'string' ? body.data : undefined;
  const attachmentId = typeof body.attachmentId === 'string' ? body.attachmentId : undefined;
  const size = typeof body.size === 'number' ? body.size : 0;
  const contentId = getContentId(headers);
  const disposition = getHeader(headers, 'Content-Disposition').toLowerCase();

  if (mimeType === 'text/plain' && data) {
    result.textParts.push(decodeBase64Url(data, getCharset(headers)));
  } else if (mimeType === 'text/html' && data) {
    result.htmlParts.push(decodeBase64Url(data, getCharset(headers)));
  } else if (filename || attachmentId || contentId) {
    result.attachments.push({
      id: attachmentId || contentId || filename,
      filename: filename || `inline-${result.attachments.length + 1}`,
      mimeType: mimeType || 'application/octet-stream',
      size,
      contentId,
      inline: Boolean(contentId) || disposition.includes('inline'),
      dataUrl: data ? `data:${mimeType};base64,${normalizeBase64(data)}` : undefined,
    });
  }

  const parts = payload.parts as Record<string, unknown>[] | undefined;
  parts?.forEach((part) => parseMimeParts(part, result));
}

async function loadAttachmentData(
  messageId: string,
  attachment: GmailAttachment,
  accessToken: string,
): Promise<GmailAttachment> {
  if (attachment.dataUrl || !attachment.id) return attachment;

  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachment.id}`,
    { cache: 'no-store', headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return attachment;

  const result = await response.json();
  if (!result.data) return attachment;

  return {
    ...attachment,
    dataUrl: `data:${attachment.mimeType};base64,${normalizeBase64(String(result.data))}`,
  };
}

function replaceInlineContentIds(html: string, attachments: GmailAttachment[]): string {
  return attachments.reduce((content, attachment) => {
    if (!attachment.contentId || !attachment.dataUrl) return content;
    return content.replaceAll(`cid:${attachment.contentId}`, attachment.dataUrl);
  }, html);
}

async function parseGmailThread(
  apiThread: Record<string, unknown>,
  accessToken: string,
  loadAttachmentBodies = false,
): Promise<GmailThread> {
  const apiMessages = [...((apiThread.messages || []) as Record<string, unknown>[])]
    .sort((left, right) => getApiMessageTimestamp(left) - getApiMessageTimestamp(right));
  const firstPayload = (apiMessages[0]?.payload || {}) as Record<string, unknown>;
  const lastPayload = (apiMessages[apiMessages.length - 1]?.payload || {}) as Record<string, unknown>;
  const firstHeaders = (firstPayload.headers as { name: string; value: string }[]) || [];
  const lastHeaders = (lastPayload.headers as { name: string; value: string }[]) || [];
  const allLabels = Array.from(new Set(apiMessages.flatMap((message) => (message.labelIds as string[]) || [])));

  const messages = await Promise.all(apiMessages.map(async (message): Promise<GmailMessage> => {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const headers = (payload.headers as { name: string; value: string }[]) || [];
    const labels = (message.labelIds as string[]) || [];
    const parsed: ParsedMimeContent = { textParts: [], htmlParts: [], attachments: [] };
    parseMimeParts(payload, parsed);
    const attachments = loadAttachmentBodies
      ? await Promise.all(
          parsed.attachments.map((attachment) =>
            loadAttachmentData(String(message.id), attachment, accessToken),
          ),
        )
      : parsed.attachments;
    const htmlBody = repairTextEncoding(replaceInlineContentIds(parsed.htmlParts.join('\n'), attachments));
    const body = repairTextEncoding(parsed.textParts.join('\n\n') || htmlBody.replace(/<[^>]+>/g, ' '));
    const rawDate = getHeader(headers, 'Date');
    const internalDate = Number(message.internalDate);
    const date = Number.isFinite(internalDate)
      ? new Date(internalDate).toISOString()
      : rawDate
        ? new Date(rawDate).toISOString()
        : '';

    return {
      id: String(message.id),
      threadId: String(message.threadId),
      from: getHeader(headers, 'From'),
      to: getHeader(headers, 'To'),
      cc: getHeader(headers, 'Cc'),
      bcc: getHeader(headers, 'Bcc'),
      replyTo: getHeader(headers, 'Reply-To'),
      subject: getHeader(headers, 'Subject'),
      snippet: String(message.snippet || ''),
      body,
      htmlBody,
      attachments,
      date,
      isRead: !labels.includes('UNREAD'),
      labels,
      hasAttachments: attachments.some((attachment) => !attachment.inline),
      rfcMessageId: getHeader(headers, 'Message-ID'),
      references: getHeader(headers, 'References'),
    };
  }));

  const participantCount = collectGmailThreadParticipants({ messages }).length;
  const rawDate = getHeader(lastHeaders, 'Date');
  const lastInternalDate = Number(apiMessages[apiMessages.length - 1]?.internalDate);
  const lastMessageDate = Number.isFinite(lastInternalDate)
    ? new Date(lastInternalDate).toISOString()
    : rawDate
      ? new Date(rawDate).toISOString()
      : new Date().toISOString();

  return {
    id: String(apiThread.id),
    subject: getHeader(lastHeaders, 'Subject') || getHeader(firstHeaders, 'Subject') || '\u65e0\u4e3b\u9898',
    snippet: String(apiThread.snippet || ''),
    messages,
    participantCount,
    lastMessageDate,
    hasUnread: allLabels.includes('UNREAD'),
    labels: allLabels,
    isStarred: allLabels.includes('STARRED'),
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { cache: 'no-store', ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function readCachedThreadDetail(thread: GmailThread) {
  const cacheKey = gmailThreadCacheKey(thread.id);
  const cached = gmailThreadDetailCache.get(cacheKey);
  if (
    !cached
    || Date.now() - cached.fetchedAt >= GMAIL_THREAD_DETAIL_CACHE_MS
    || cached.thread.lastMessageDate !== thread.lastMessageDate
  ) {
    if (cached) gmailThreadDetailCache.delete(cacheKey);
    return null;
  }

  return {
    ...cached.thread,
    hasUnread: thread.hasUnread,
    isStarred: thread.isStarred,
    labels: thread.labels,
  };
}

function cacheThreadDetail(thread: GmailThread, cacheKey = gmailThreadCacheKey(thread.id)) {
  if (!gmailThreadDetailCache.has(cacheKey) && gmailThreadDetailCache.size >= 100) {
    const oldestThreadId = gmailThreadDetailCache.keys().next().value;
    if (oldestThreadId) gmailThreadDetailCache.delete(oldestThreadId);
  }
  gmailThreadDetailCache.delete(cacheKey);
  gmailThreadDetailCache.set(cacheKey, {
    thread,
    fetchedAt: Date.now(),
  });
}

async function fetchThreadDetailById(threadId: string, accessToken: string) {
  const cacheKey = gmailThreadCacheKey(threadId);
  const cached = gmailThreadDetailCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < GMAIL_THREAD_DETAIL_CACHE_MS) return cached.thread;
  if (cached) gmailThreadDetailCache.delete(cacheKey);

  const pending = gmailThreadDetailRequests.get(cacheKey);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetchWithTimeout(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
      20_000,
    );
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      const message = typeof result?.error?.message === 'string'
        ? result.error.message
        : '读取邮件正文失败';
      throw new Error(message);
    }

    const parsed = await parseGmailThread(
      await response.json() as Record<string, unknown>,
      accessToken,
      false,
    );
    cacheThreadDetail(parsed, cacheKey);
    return parsed;
  })();

  gmailThreadDetailRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    gmailThreadDetailRequests.delete(cacheKey);
  }
}

async function fetchThreadDetail(thread: GmailThread, accessToken: string) {
  const cached = readCachedThreadDetail(thread);
  if (cached) return cached;
  return fetchThreadDetailById(thread.id, accessToken);
}

async function hydrateInlineAttachments(thread: GmailThread, accessToken: string) {
  let changed = false;
  const messages = await Promise.all(thread.messages.map(async (message) => {
    const inlineAttachments = (message.attachments || []).filter(
      (attachment) => attachment.inline && !attachment.dataUrl && attachment.id,
    );
    if (inlineAttachments.length === 0) return message;

    const loadedInlineAttachments = await Promise.all(
      inlineAttachments.map((attachment) => loadAttachmentData(message.id, attachment, accessToken)),
    );
    const loadedById = new Map(
      loadedInlineAttachments.map((attachment) => [attachment.id, attachment]),
    );
    const attachments = (message.attachments || []).map(
      (attachment) => loadedById.get(attachment.id) || attachment,
    );
    const htmlBody = message.htmlBody
      ? replaceInlineContentIds(message.htmlBody, attachments)
      : message.htmlBody;
    changed = changed || loadedInlineAttachments.some((attachment) => Boolean(attachment.dataUrl));
    return {
      ...message,
      attachments,
      htmlBody,
    };
  }));

  return changed ? { ...thread, messages } : thread;
}

export function GmailInbox({
  active = true,
  onSelectThread,
  onThreadLoadStateChange,
  onThreadUpdated,
  onCategoryChange,
  updatedThread,
  selectedThreadId,
  threadDetailVisible = false,
  mailbox,
  category,
  refreshKey = 0,
  compact = true,
  avatarOnly = false,
  openThreadRequest,
}: GmailInboxProps) {
  const {
    auth,
    status: authStatus,
    loading: authLoading,
    error: gmailAuthError,
    disconnect,
    refreshSession,
    getAccessToken,
  } = useGmailAuth();
  const { settings } = useSettings();
  const latestFetchIdRef = useRef(0);
  const activeFetchKeyRef = useRef<string | null>(null);
  const wasActiveRef = useRef(active);
  const subjectTranslationRunRef = useRef(0);
  const avatarPrefetchRunRef = useRef(0);
  const openingThreadRef = useRef<string | null>(null);
  const openingThreadRunRef = useRef(0);
  const handledOpenThreadRequestRef = useRef(0);
  const handleOpenThreadRef = useRef<(thread: GmailThread) => Promise<void>>(async () => undefined);
  const accountCacheScopeRef = useRef(getAccountCacheScope());
  const currentInboxCacheKeyRef = useRef<string | null>(null);
  const threadPrefetchTimerRef = useRef<number | null>(null);
  const selectedThreadIdRef = useRef(selectedThreadId);
  const threadDetailVisibleRef = useRef(threadDetailVisible);
  const authEmailRef = useRef(auth?.email);
  const internallyAppliedThreadRef = useRef<GmailThread | null>(null);
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const threadsRef = useRef(threads);
  const [loading, setLoading] = useState(false);
  const [translatingSubjects, setTranslatingSubjects] = useState(false);
  const [actionThreadId, setActionThreadId] = useState<string | null>(null);
  const [openingThreadId, setOpeningThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subjectTranslationError, setSubjectTranslationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showTranslatedSubjects, setShowTranslatedSubjects] = useState(false);
  const [subjectTranslations, setSubjectTranslations] = useState<Record<string, string>>({});
  const [threadAvatars, setThreadAvatars] = useState<Record<string, ChannelAvatarState>>({});
  const [authProcessing, setAuthProcessing] = useState(false);
  selectedThreadIdRef.current = selectedThreadId;
  threadDetailVisibleRef.current = threadDetailVisible;
  authEmailRef.current = auth?.email;
  const normalizedSearchQuery = debouncedSearchQuery.trim();
  const isGlobalSearch = normalizedSearchQuery.length > 0;
  const hasSearchInput = searchQuery.trim().length > 0;
  const searchInputPending = searchQuery.trim() !== normalizedSearchQuery;
  const gmailSearchQuery = isGlobalSearch && showUnreadOnly
    ? `(${normalizedSearchQuery}) is:unread`
    : normalizedSearchQuery;
  const paginationKey = isGlobalSearch
    ? `search:${gmailSearchQuery}:${refreshKey}`
    : `${mailbox}:${category}:${refreshKey}`;
  const [activePaginationKey, setActivePaginationKey] = useState(paginationKey);
  const [pageTokens, setPageTokens] = useState<string[]>(['']);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [normalUnreadCount, setNormalUnreadCount] = useState<number | null>(null);
  const [displayedInboxCacheKey, setDisplayedInboxCacheKey] = useState<string | null>(null);
  const inboxCacheKey = auth?.isConnected
    ? createGmailInboxCacheKey({
        accountScope: accountCacheScopeRef.current,
        gmailEmail: auth.email,
        viewKey: paginationKey,
        pageIndex,
      })
    : null;
  currentInboxCacheKeyRef.current = inboxCacheKey;

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    const handleAccountScopeChange = () => {
      accountCacheScopeRef.current = getAccountCacheScope();
      clearGmailReadStateRuntime();
    };
    window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, handleAccountScopeChange);
    return () => window.removeEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, handleAccountScopeChange);
  }, []);

  useEffect(() => {
    const nextSearchQuery = searchQuery.trim();
    if (!nextSearchQuery) {
      setDebouncedSearchQuery('');
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(nextSearchQuery);
    }, GMAIL_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const mailboxViewKey = `${mailbox}:${category}`;
  const previousMailboxViewKeyRef = useRef(mailboxViewKey);
  useEffect(() => {
    if (previousMailboxViewKeyRef.current !== mailboxViewKey) {
      setSearchQuery('');
      setDebouncedSearchQuery('');
    }
    previousMailboxViewKeyRef.current = mailboxViewKey;
  }, [mailboxViewKey]);

  useEffect(() => () => {
    if (threadPrefetchTimerRef.current !== null) {
      window.clearTimeout(threadPrefetchTimerRef.current);
    }
  }, []);

  useEffect(() => {
    latestFetchIdRef.current += 1;
    activeFetchKeyRef.current = null;
    setActivePaginationKey(paginationKey);
    setPageTokens(['']);
    setPageIndex(0);
    setError(null);
  }, [paginationKey]);

  useEffect(() => {
    if (!inboxCacheKey || activePaginationKey !== paginationKey) return;
    const cached = readGmailInboxCache(inboxCacheKey);
    if (!cached) {
      setDisplayedInboxCacheKey(inboxCacheKey);
      setNextPageToken(null);
      setThreads([]);
      setLastSyncedAt(null);
      setNormalUnreadCount(null);
      setLoading(false);
      return;
    }

    setDisplayedInboxCacheKey(inboxCacheKey);
    setThreads(cached.threads);
    setNextPageToken(cached.nextPageToken);
    setLastSyncedAt(cached.lastSyncedAt);
    setNormalUnreadCount(cached.normalUnreadCount);
    setLoading(false);
  }, [activePaginationKey, inboxCacheKey, paginationKey]);

  useEffect(() => {
    if (
      !isGmailInboxCacheKeyCurrent(displayedInboxCacheKey, inboxCacheKey)
      || activePaginationKey !== paginationKey
      || !lastSyncedAt
    ) return;
    writeGmailInboxCache(displayedInboxCacheKey, {
      threads,
      nextPageToken,
      normalUnreadCount,
      lastSyncedAt,
      fetchedAt: Date.parse(lastSyncedAt),
    });
  }, [
    activePaginationKey,
    displayedInboxCacheKey,
    inboxCacheKey,
    lastSyncedAt,
    nextPageToken,
    normalUnreadCount,
    paginationKey,
    threads,
  ]);

  useEffect(() => {
    if (!updatedThread) return;
    const internallyApplied = internallyAppliedThreadRef.current === updatedThread;
    if (internallyApplied) internallyAppliedThreadRef.current = null;
    if (!updatedThread.hasUnread) {
      setManualGmailUnreadPreference(
        getGmailReadScopeKey(auth?.email, accountCacheScopeRef.current),
        updatedThread.id,
        false,
      );
    }
    const updatedThreadCacheKey = gmailThreadCacheKey(updatedThread.id, accountCacheScopeRef.current);
    const cachedThread = gmailThreadDetailCache.get(updatedThreadCacheKey)?.thread;
    const previousThread = threadsRef.current.find((thread) => thread.id === updatedThread.id)
      || cachedThread;
    if (
      cachedThread
      || updatedThread.messages.some((message) => Boolean(message.body || message.htmlBody))
    ) {
      cacheThreadDetail(updatedThread, updatedThreadCacheKey);
    }
    if (previousThread && !internallyApplied) {
      const wasCountedAsNormalUnread = previousThread.hasUnread && isNormalInboxThread(previousThread);
      const isCountedAsNormalUnread = updatedThread.hasUnread && isNormalInboxThread(updatedThread);
      if (wasCountedAsNormalUnread !== isCountedAsNormalUnread) {
        setNormalUnreadCount((current) => {
          if (current === null) return current;
          return isCountedAsNormalUnread ? current + 1 : Math.max(0, current - 1);
        });
      }
    }
    setThreads((current) => {
      if ((mailbox === 'unread' || (isGlobalSearch && showUnreadOnly)) && !updatedThread.hasUnread) {
        return current.filter((thread) => thread.id !== updatedThread.id);
      }
      return sortThreadsByLatest(
        current.map((thread) => thread.id === updatedThread.id ? updatedThread : thread),
        mailbox,
      );
    });
  }, [auth?.email, isGlobalSearch, mailbox, showUnreadOnly, updatedThread]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmailConnected = params.get('gmail_connected');
    const authError = params.get('auth_error');

    if (authError) {
      const errorMessages: Record<string, string> = {
        access_denied: '\u4f60\u53d6\u6d88\u4e86 Gmail \u6388\u6743\u3002',
        missing_google_client_id: 'Vercel \u5c1a\u672a\u914d\u7f6e GOOGLE_CLIENT_ID\u3002',
        missing_google_oauth_env: 'Vercel \u5c1a\u672a\u5b8c\u6574\u914d\u7f6e Google OAuth \u73af\u5883\u53d8\u91cf\u3002',
        token_exchange_failed: 'Google \u6388\u6743\u7801\u4ea4\u6362\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 OAuth \u914d\u7f6e\u3002',
        callback_failed: 'Gmail \u6388\u6743\u56de\u8c03\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002',
        no_code: 'Google \u6ca1\u6709\u8fd4\u56de\u6388\u6743\u7801\u3002',
        invalid_state: 'Gmail \u6388\u6743\u6821\u9a8c\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5\u3002',
      };
      setError(errorMessages[authError] || `Gmail \u6388\u6743\u5931\u8d25\uff1a${authError}`);
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (gmailConnected) {
      setAuthProcessing(true);
      refreshSession()
        .then((nextAuth) => {
          if (!nextAuth?.accessToken) setError('\u65e0\u6cd5\u4fdd\u5b58 Gmail \u6388\u6743\u4fe1\u606f\u3002');
        })
        .catch((caughtError: Error) => setError(`Gmail \u8fde\u63a5\u5931\u8d25\uff1a${caughtError.message}`))
        .finally(() => {
          setAuthProcessing(false);
          window.history.replaceState({}, '', window.location.pathname);
        });
    }
  }, [refreshSession]);

  const fetchThreads = useCallback(async () => {
    if (!auth?.accessToken) return;
    if (activePaginationKey !== paginationKey) return;
    const requestCacheKey = inboxCacheKey;
    if (!requestCacheKey) return;
    const fetchKey = requestCacheKey;
    if (activeFetchKeyRef.current === fetchKey) return;
    activeFetchKeyRef.current = fetchKey;
    const fetchId = latestFetchIdRef.current + 1;
    latestFetchIdRef.current = fetchId;
    const isCurrentRequest = () => (
      fetchId === latestFetchIdRef.current
      && isGmailInboxCacheKeyCurrent(requestCacheKey, currentInboxCacheKeyRef.current)
    );
    setLoading(true);
    setError(null);

    try {
      let accessToken = await getAccessToken();
      let headers = { Authorization: `Bearer ${accessToken}` };
      const pageToken = pageTokens[pageIndex] || '';
      const params = new URLSearchParams({ maxResults: String(GMAIL_PAGE_SIZE) });
      if (isGlobalSearch) {
        params.set('q', gmailSearchQuery);
      } else {
        const requestLabelIds = [...MAILBOX_API_LABELS[mailbox]];
        const categoryLabelId = mailbox === 'inbox' ? CATEGORY_LABEL_IDS[category] : undefined;
        if (categoryLabelId) requestLabelIds.push(categoryLabelId);
        requestLabelIds.forEach((label) => params.append('labelIds', label));
      }
      if (pageToken) params.set('pageToken', pageToken);

      const unreadCountParams = new URLSearchParams({
        maxResults: '1',
        q: NORMAL_UNREAD_QUERY,
      });
      const unreadCountRequest = !isGlobalSearch && (mailbox === 'inbox' || mailbox === 'unread')
        ? fetchWithTimeout(
            `https://gmail.googleapis.com/gmail/v1/users/me/threads?${unreadCountParams.toString()}`,
            { headers },
            8_000,
          )
            .then(async (response) => {
              if (!response.ok) return null;
              const result = await response.json() as GmailThreadListResult;
              return typeof result.resultSizeEstimate === 'number' ? result.resultSizeEstimate : null;
            })
            .catch(() => null)
        : Promise.resolve(null);
      let [listResponse, unreadCount] = await Promise.all([
        fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params.toString()}`,
          { headers },
        ),
        unreadCountRequest,
      ]);
      if (!isCurrentRequest()) return;

      if (!listResponse.ok) {
        const result = await listResponse.json().catch(() => ({}));
        if (isGmailAuthError(listResponse.status, result)) {
          accessToken = await getAccessToken({ force: true });
          headers = { Authorization: `Bearer ${accessToken}` };
          [listResponse, unreadCount] = await Promise.all([
            fetchWithTimeout(
              `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params.toString()}`,
              { headers },
            ),
            !isGlobalSearch && (mailbox === 'inbox' || mailbox === 'unread')
              ? fetchWithTimeout(
                  `https://gmail.googleapis.com/gmail/v1/users/me/threads?${unreadCountParams.toString()}`,
                  { headers },
                  8_000,
                )
                  .then(async (response) => {
                    if (!response.ok) return null;
                    const retryResult = await response.json() as GmailThreadListResult;
                    return typeof retryResult.resultSizeEstimate === 'number' ? retryResult.resultSizeEstimate : null;
                  })
                  .catch(() => null)
              : Promise.resolve(null),
          ]);
          if (!isCurrentRequest()) return;
        }
      }

      if (!listResponse.ok) {
        const result = await listResponse.json().catch(() => ({}));
        throw new Error(result.error?.message || '\u83b7\u53d6\u90ae\u4ef6\u5217\u8868\u5931\u8d25');
      }

      const listResult = await listResponse.json() as GmailThreadListResult;
      if (!isCurrentRequest()) return;
      const threadRefs = listResult.threads || [];
      if (threadRefs.length === 0) {
        setDisplayedInboxCacheKey(requestCacheKey);
        setNextPageToken(listResult.nextPageToken || null);
        setThreads([]);
        if (unreadCount !== null) setNormalUnreadCount(unreadCount);
        setLastSyncedAt(new Date().toISOString());
        notifyPrimaryInboxRefreshed(mailbox, category, isGlobalSearch);
        return;
      }

      const nextThreads: GmailThread[] = [];
      for (let index = 0; index < threadRefs.length; index += GMAIL_DETAIL_BATCH_SIZE) {
        const batch = threadRefs.slice(index, index + GMAIL_DETAIL_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (thread) => {
            try {
              const response = await fetchWithTimeout(
                `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
                { headers },
                12_000,
              );
              return response.ok ? response.json() : null;
            } catch {
              return null;
            }
          }),
        );
        if (!isCurrentRequest()) return;

        const parsedBatch = await Promise.all(
          batchResults
            .filter((thread): thread is Record<string, unknown> => Boolean(thread))
            .map((thread) => parseGmailThread(thread, accessToken, false)),
        );
        const visibleBatch = isGlobalSearch
          ? parsedBatch
          : parsedBatch.filter((thread) => shouldShowThreadInMailbox(thread, mailbox, category));
        if (!isCurrentRequest()) return;
        nextThreads.push(...visibleBatch);
      }
      setDisplayedInboxCacheKey(requestCacheKey);
      setNextPageToken(listResult.nextPageToken || null);
      setThreads(isGlobalSearch
        ? [...nextThreads].sort((left, right) => getDateTimestamp(right.lastMessageDate) - getDateTimestamp(left.lastMessageDate))
        : sortThreadsByLatest(nextThreads, mailbox));
      if (unreadCount !== null) setNormalUnreadCount(unreadCount);
      setLastSyncedAt(new Date().toISOString());
      notifyPrimaryInboxRefreshed(mailbox, category, isGlobalSearch);
    } catch (caughtError) {
      if (isCurrentRequest()) {
        setError((caughtError as Error).message);
      }
    } finally {
      if (activeFetchKeyRef.current === fetchKey) {
        activeFetchKeyRef.current = null;
      }
      if (isCurrentRequest()) {
        setLoading(false);
      }
    }
  }, [
    activePaginationKey,
    auth?.accessToken,
    category,
    gmailSearchQuery,
    getAccessToken,
    isGlobalSearch,
    inboxCacheKey,
    mailbox,
    pageIndex,
    pageTokens,
    paginationKey,
  ]);

  useEffect(() => {
    if (!auth?.isConnected || !auth.accessToken) return;
    const cached = inboxCacheKey ? readGmailInboxCache(inboxCacheKey) : null;
    if (!cached || !isGmailInboxCacheFresh(cached)) void fetchThreads();
  }, [auth?.isConnected, auth?.accessToken, fetchThreads, inboxCacheKey, refreshKey]);

  useEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (
      !becameActive
      || !auth?.isConnected
      || !auth.accessToken
      || loading
      || actionThreadId
      || openingThreadId
    ) return;

    const lastSyncTimestamp = Date.parse(lastSyncedAt || '');
    const cacheIsFresh = Number.isFinite(lastSyncTimestamp)
      && Date.now() - lastSyncTimestamp < GMAIL_CACHE_STALE_MS;
    if (!cacheIsFresh) void fetchThreads();
  }, [
    actionThreadId,
    active,
    auth?.accessToken,
    auth?.isConnected,
    fetchThreads,
    lastSyncedAt,
    loading,
    openingThreadId,
  ]);

  useEffect(() => {
    if (!active || !auth?.isConnected || !auth.accessToken) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !loading && !actionThreadId && !openingThreadId) {
        void fetchThreads();
      }
    }, GMAIL_AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [active, actionThreadId, auth?.accessToken, auth?.isConnected, fetchThreads, loading, openingThreadId]);

  useEffect(() => {
    const runId = avatarPrefetchRunRef.current + 1;
    avatarPrefetchRunRef.current = runId;
    const timer = window.setTimeout(() => {
      async function prefetchCurrentPageAvatars() {
        const mapping = settings.feishuFieldMapping || {};
        const emailField = mapping.email;
        if (!settings.feishuUrl || !emailField || !threads.length) {
          setThreadAvatars({});
          return;
        }

        const threadContacts = threads
          .map((thread) => ({
            threadId: thread.id,
            emails: getGmailThreadContact(thread, auth?.email).emails,
          }))
          .filter((item) => item.emails.length);
        if (!threadContacts.length) {
          setThreadAvatars({});
          return;
        }

        const targetEmails = new Set(threadContacts.flatMap((item) => item.emails));

        try {
          const records = await fetchFeishuRecordsCached(settings.feishuUrl);
          if (runId !== avatarPrefetchRunRef.current) return;

          const profileByEmail = new Map<string, CreatorAvatarProfile>();
          records.forEach((record) => {
            const emails = extractEmails(stringifyFeishuValue(record.fields[emailField]));
            const matchedEmails = emails.filter((email) => targetEmails.has(email));
            const candidate = {
              channelName: getMappedFeishuValue(record, mapping, 'channelName'),
              channelUrl: extractMappedFeishuChannelUrl(record.fields, mapping),
              channelId: getMappedFeishuValue(record, mapping, 'channelId'),
            };
            matchedEmails.forEach((matchedEmail) => {
              const current = profileByEmail.get(matchedEmail);
              if (
                !current
                || channelAvatarLookupPriority(candidate) > channelAvatarLookupPriority(current)
              ) {
                profileByEmail.set(matchedEmail, candidate);
              }
            });
          });

          const nextAvatars: Record<string, ChannelAvatarState> = {};
          const pendingByLookup = new Map<string, {
            lookup: NonNullable<ReturnType<typeof buildChannelAvatarLookup>>;
            threadIds: string[];
            title: string;
          }>();

          threadContacts.forEach(({ threadId, emails }) => {
            const matchedEmail = emails.find((email) => profileByEmail.has(email));
            const profile = matchedEmail ? profileByEmail.get(matchedEmail) : undefined;
            if (!profile) {
              nextAvatars[threadId] = {
                status: 'failed',
                error: '未在红人信息数据库中匹配到该邮箱。',
              };
              return;
            }
            const lookup = buildChannelAvatarLookup(profile);
            if (!lookup) {
              nextAvatars[threadId] = {
                status: 'failed',
                error: '已匹配飞书记录，但未能从频道链接或红人频道名字段提取有效的 YouTube 链接。',
              };
              return;
            }
            const cached = readChannelAvatarCache(lookup.key);
            if (cached) {
              nextAvatars[threadId] = {
                ...cached,
                title: cached.title || profile.channelName,
              };
              return;
            }

            nextAvatars[threadId] = { status: 'loading' };
            const pending = pendingByLookup.get(lookup.key);
            if (pending) {
              pending.threadIds.push(threadId);
            } else {
              pendingByLookup.set(lookup.key, {
                lookup,
                threadIds: [threadId],
                title: profile.channelName,
              });
            }
          });

          setThreadAvatars(nextAvatars);

          const pendingItems = Array.from(pendingByLookup.values());
          const resolved = await resolveChannelAvatars(
            pendingItems.map((item) => item.lookup),
            {
              regionCode: settings.youtubeDefaultRegion || '',
              relevanceLanguage: settings.youtubeDefaultLanguage || '',
            },
          );
          if (runId !== avatarPrefetchRunRef.current) return;
          setThreadAvatars((current) => {
            const next = { ...current };
            pendingItems.forEach((item) => {
              const avatar = resolved.get(item.lookup.key) || {
                status: 'failed' as const,
                cacheKey: item.lookup.key,
                error: '频道头像读取失败。',
              };
              item.threadIds.forEach((threadId) => {
                next[threadId] = {
                  ...avatar,
                  title: avatar.title || item.title,
                };
              });
            });
            return next;
          });
        } catch {
          // Avatar prefetch is an optional UI enhancement; Gmail list should stay usable.
        }
      }

      void prefetchCurrentPageAvatars();
    }, 300);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    auth?.email,
    settings.feishuFieldMapping,
    settings.feishuUrl,
    settings.youtubeDefaultLanguage,
    settings.youtubeDefaultRegion,
    threads,
  ]);

  useEffect(() => {
    if (!active || !auth?.isConnected || !auth.accessToken) return undefined;

    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible' && !loading && !actionThreadId && !openingThreadId) {
        void fetchThreads();
      }
    };

    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);

    return () => {
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [active, actionThreadId, auth?.accessToken, auth?.isConnected, fetchThreads, loading, openingThreadId]);

  const goToPreviousPage = () => {
    if (loading || pageIndex === 0) return;
    setThreads([]);
    setNextPageToken(null);
    setPageIndex((current) => Math.max(0, current - 1));
  };

  const goToNextPage = () => {
    if (loading || !nextPageToken) return;
    setThreads([]);
    setPageTokens((current) => {
      const next = [...current];
      next[pageIndex + 1] = nextPageToken;
      return next;
    });
    setPageIndex((current) => current + 1);
  };

  const applyThreadStateLocally = (
    previousThread: GmailThread,
    nextThread: GmailThread,
    options: { allowInsert?: boolean } = {},
  ) => {
    const cacheKey = gmailThreadCacheKey(nextThread.id, accountCacheScopeRef.current);
    cacheThreadDetail(nextThread, cacheKey);

    const wasCountedAsNormalUnread = previousThread.hasUnread && isNormalInboxThread(previousThread);
    const isCountedAsNormalUnread = nextThread.hasUnread && isNormalInboxThread(nextThread);
    if (wasCountedAsNormalUnread !== isCountedAsNormalUnread) {
      setNormalUnreadCount((current) => {
        if (current === null) return current;
        return isCountedAsNormalUnread ? current + 1 : Math.max(0, current - 1);
      });
    }

    setThreads((current) => {
      const exists = current.some((item) => item.id === previousThread.id);
      if ((mailbox === 'unread' || (isGlobalSearch && showUnreadOnly)) && !nextThread.hasUnread) {
        return current.filter((item) => item.id !== previousThread.id);
      }
      if (!exists && !options.allowInsert) return current;
      return sortThreadsByLatest(
        exists
          ? current.map((item) => item.id === previousThread.id ? nextThread : item)
          : [nextThread, ...current],
        mailbox,
      );
    });
    internallyAppliedThreadRef.current = nextThread;
    onThreadUpdated?.(nextThread);
    return nextThread;
  };

  const markThreadReadAfterContentReady = (
    thread: GmailThread,
    runId: number,
    accessTokenOverride?: string,
  ) => {
    const scopeKey = getGmailReadScopeKey(authEmailRef.current, accountCacheScopeRef.current);
    const stillViewing = openingThreadRunRef.current === runId
      && selectedThreadIdRef.current === thread.id
      && threadDetailVisibleRef.current;
    if (!shouldAutoMarkGmailThreadRead({
      hasUnread: thread.hasUnread,
      contentReady: true,
      stillViewing,
      manuallyPreservedUnread: hasManualGmailUnreadPreference(scopeKey, thread.id),
      latestMessageFromOwnAccount: isLatestMessageFromEmail(thread, authEmailRef.current),
    })) return thread;
    if (getAutomaticGmailReadRequest(scopeKey, thread.id)) {
      return setGmailThreadReadState(thread, true);
    }

    const requestVersion = beginGmailReadStateOperation(scopeKey, thread.id);
    const wasListed = threadsRef.current.some((item) => item.id === thread.id);
    const readThread = setGmailThreadReadState(thread, true);
    applyThreadStateLocally(thread, readThread);
    let unregister: () => void = () => undefined;
    const request = (async () => {
      const accessToken = accessTokenOverride || await getAccessToken();
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ addLabelIds: [], removeLabelIds: ['UNREAD'] }),
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error?.message || '自动标记已读失败');
      }
    })()
      .catch((caughtError) => {
        const currentScope = getGmailReadScopeKey(authEmailRef.current, accountCacheScopeRef.current);
        const currentVersion = getGmailReadStateOperationVersion(scopeKey, thread.id);
        if (
          shouldRollbackAutomaticGmailRead(requestVersion, currentVersion, scopeKey, currentScope)
          && !hasManualGmailUnreadPreference(scopeKey, thread.id)
        ) {
          applyThreadStateLocally(readThread, thread, { allowInsert: wasListed });
          setError(`标记已读失败，可点击信封按钮重试：${(caughtError as Error).message}`);
        }
      })
      .finally(() => unregister());
    unregister = registerAutomaticGmailReadRequest(scopeKey, thread.id, request);
    return readThread;
  };

  const modifyThread = async (
    thread: GmailThread,
    addLabelIds: string[] = [],
    removeLabelIds: string[] = [],
    accessTokenOverride?: string,
  ) => {
    const changesUnreadState = addLabelIds.includes('UNREAD') || removeLabelIds.includes('UNREAD');
    const readScopeKey = getGmailReadScopeKey(auth?.email, accountCacheScopeRef.current);
    const hadManualUnreadPreference = changesUnreadState
      ? hasManualGmailUnreadPreference(readScopeKey, thread.id)
      : false;
    if (changesUnreadState) {
      beginGmailReadStateOperation(readScopeKey, thread.id);
      setManualGmailUnreadPreference(readScopeKey, thread.id, addLabelIds.includes('UNREAD'));
    }
    setActionThreadId(thread.id);
    setError(null);

    try {
      if (changesUnreadState) await waitForAutomaticGmailRead(readScopeKey, thread.id);
      const accessToken = accessTokenOverride || await getAccessToken();
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ addLabelIds, removeLabelIds }),
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error?.message || '\u66f4\u65b0\u90ae\u4ef6\u72b6\u6001\u5931\u8d25');
      }

      const nextLabels = Array.from(new Set([
        ...thread.labels.filter((label) => !removeLabelIds.includes(label)),
        ...addLabelIds,
      ]));
      const nextThread: GmailThread = {
        ...thread,
        labels: nextLabels,
        hasUnread: nextLabels.includes('UNREAD'),
        isStarred: nextLabels.includes('STARRED'),
        messages: thread.messages.map((message) => ({
          ...message,
          labels: Array.from(new Set([
            ...message.labels.filter((label) => !removeLabelIds.includes(label)),
            ...addLabelIds,
          ])),
          isRead: removeLabelIds.includes('UNREAD')
            ? true
            : addLabelIds.includes('UNREAD')
              ? false
              : message.isRead,
        })),
      };
      const cacheKey = gmailThreadCacheKey(nextThread.id, accountCacheScopeRef.current);
      const cached = gmailThreadDetailCache.get(cacheKey);
      if (cached) {
        cacheThreadDetail({
          ...cached.thread,
          hasUnread: nextThread.hasUnread,
          isStarred: nextThread.isStarred,
          labels: nextThread.labels,
          messages: cached.thread.messages.map((message) => ({
            ...message,
            labels: Array.from(new Set([
              ...message.labels.filter((label) => !removeLabelIds.includes(label)),
              ...addLabelIds,
            ])),
            isRead: removeLabelIds.includes('UNREAD')
              ? true
              : addLabelIds.includes('UNREAD')
                ? false
                : message.isRead,
          })),
        }, cacheKey);
      }
      const wasCountedAsNormalUnread = thread.hasUnread && isNormalInboxThread(thread);
      const isCountedAsNormalUnread = nextThread.hasUnread && isNormalInboxThread(nextThread);
      if (wasCountedAsNormalUnread !== isCountedAsNormalUnread) {
        setNormalUnreadCount((current) => {
          if (current === null) return current;
          return isCountedAsNormalUnread ? current + 1 : Math.max(0, current - 1);
        });
      }

      if (
        (mailbox === 'starred' && removeLabelIds.includes('STARRED'))
        || (mailbox === 'unread' && removeLabelIds.includes('UNREAD'))
      ) {
        setThreads((current) => current.filter((item) => item.id !== thread.id));
      } else {
        setThreads((current) =>
          sortThreadsByLatest(
            current.map((item) => item.id === thread.id ? nextThread : item),
            mailbox,
          ),
        );
      }
      internallyAppliedThreadRef.current = nextThread;
      onThreadUpdated?.(nextThread);
      return nextThread;
    } catch (caughtError) {
      if (changesUnreadState) {
        setManualGmailUnreadPreference(readScopeKey, thread.id, hadManualUnreadPreference);
      }
      setError((caughtError as Error).message);
      return thread;
    } finally {
      setActionThreadId(null);
    }
  };

  const prefetchThread = (thread: GmailThread) => {
    if (readCachedThreadDetail(thread) || gmailThreadDetailRequests.has(gmailThreadCacheKey(thread.id))) return;
    if (threadPrefetchTimerRef.current !== null) {
      window.clearTimeout(threadPrefetchTimerRef.current);
    }
    threadPrefetchTimerRef.current = window.setTimeout(() => {
      threadPrefetchTimerRef.current = null;
      void getAccessToken()
        .then((accessToken) => fetchThreadDetail(thread, accessToken))
        .catch(() => {
          // Prefetch is opportunistic; a normal click will retry and report failures.
        });
    }, GMAIL_THREAD_PREFETCH_DELAY_MS);
  };

  const cancelThreadPrefetch = () => {
    if (threadPrefetchTimerRef.current === null) return;
    window.clearTimeout(threadPrefetchTimerRef.current);
    threadPrefetchTimerRef.current = null;
  };

  const prefetchGmailAIHistory = (thread: GmailThread) => {
    const target = resolveGmailReplyTarget({ thread, ownEmail: auth?.email });
    if (!target?.recipientEmail) return;
    void loadGmailAIContactHistory({
      accountEmail: auth?.email,
      thread,
      contactEmail: target.recipientEmail,
      targetMessageId: target.messageId,
      targetMessageDate: target.date,
    }).catch(() => {
      // This read-only prefetch is opportunistic; opening AI assistant will retry visibly.
    });
  };

  const handleOpenThread = async (thread: GmailThread) => {
    const runId = openingThreadRunRef.current + 1;
    const cachedThread = readCachedThreadDetail(thread);
    openingThreadRunRef.current = runId;
    openingThreadRef.current = thread.id;
    selectedThreadIdRef.current = thread.id;
    threadDetailVisibleRef.current = true;
    setOpeningThreadId(thread.id);
    onSelectThread(cachedThread || thread);
    onThreadLoadStateChange?.(thread.id, { loading: !cachedThread });
    let nextThread = cachedThread || thread;
    let accessToken: string | null = null;

    if (cachedThread) {
      nextThread = markThreadReadAfterContentReady(cachedThread, runId);
    }

    try {
      accessToken = await getAccessToken();
      if (!cachedThread) {
        nextThread = await fetchThreadDetail(thread, accessToken);
      }
      const stillViewing = openingThreadRunRef.current === runId
        && selectedThreadIdRef.current === thread.id
        && threadDetailVisibleRef.current;
      if (stillViewing) {
        onSelectThread(nextThread);
        onThreadLoadStateChange?.(thread.id, { loading: false });
        setThreads((current) => sortThreadsByLatest(
          current.map((item) => item.id === nextThread.id ? nextThread : item),
          mailbox,
        ));
        if (!cachedThread) {
          nextThread = markThreadReadAfterContentReady(nextThread, runId, accessToken);
        }
        prefetchGmailAIHistory(nextThread);
      }
    } catch (caughtError) {
      if (openingThreadRunRef.current === runId) {
        onThreadLoadStateChange?.(thread.id, {
          loading: false,
          error: caughtError instanceof Error ? caughtError.message : '读取邮件正文失败',
        });
      }
    } finally {
      if (openingThreadRunRef.current === runId) {
        openingThreadRef.current = null;
        setOpeningThreadId(null);
      }
    }

    if (
      accessToken
      && openingThreadRunRef.current === runId
      && selectedThreadIdRef.current === thread.id
      && threadDetailVisibleRef.current
    ) {
      void hydrateInlineAttachments(nextThread, accessToken).then((hydratedThread) => {
        if (hydratedThread === nextThread) return;
        const cacheKey = gmailThreadCacheKey(hydratedThread.id, accountCacheScopeRef.current);
        const latestState = gmailThreadDetailCache.get(cacheKey)?.thread || nextThread;
        const synchronizedThread = copyGmailThreadReadState(hydratedThread, latestState);
        cacheThreadDetail(
          synchronizedThread,
          cacheKey,
        );
        if (
          openingThreadRunRef.current === runId
          && selectedThreadIdRef.current === thread.id
          && threadDetailVisibleRef.current
        ) onSelectThread(synchronizedThread);
      }).catch(() => {
        // Inline images are optional and must never delay or hide the email body.
      });
    }
  };

  useEffect(() => {
    handleOpenThreadRef.current = handleOpenThread;
  });

  useEffect(() => {
    if (
      !active
      || !auth?.isConnected
      || !openThreadRequest
      || handledOpenThreadRequestRef.current === openThreadRequest.requestId
    ) return;

    const { threadId, requestId } = openThreadRequest;
    handledOpenThreadRequestRef.current = requestId;
    const listedThread = threadsRef.current.find((thread) => thread.id === threadId);
    if (listedThread) {
      void handleOpenThreadRef.current(listedThread);
      return;
    }

    void getAccessToken()
      .then((accessToken) => fetchThreadDetailById(threadId, accessToken))
      .then((thread) => {
        if (handledOpenThreadRequestRef.current !== requestId) return;
        return handleOpenThreadRef.current(thread);
      })
      .catch((caughtError) => {
        if (handledOpenThreadRequestRef.current !== requestId) return;
        setError(caughtError instanceof Error ? caughtError.message : '打开邮件线程失败');
      });
  }, [active, auth?.isConnected, getAccessToken, openThreadRequest]);

  const translateThreadSubjects = useCallback(async (targetThreads: GmailThread[]) => {
    const missingThreads = targetThreads.filter((thread) => {
      const subject = repairTextEncoding(thread.subject || '').trim();
      return subject && !subjectTranslations[thread.id];
    });
    if (missingThreads.length === 0) return;

    const runId = subjectTranslationRunRef.current + 1;
    subjectTranslationRunRef.current = runId;
    setTranslatingSubjects(true);
    setSubjectTranslationError(null);

    try {
      for (let index = 0; index < missingThreads.length; index += SUBJECT_TRANSLATION_BATCH_SIZE) {
        if (runId !== subjectTranslationRunRef.current) return;

        const batch = missingThreads.slice(index, index + SUBJECT_TRANSLATION_BATCH_SIZE);
        const subjects = batch.map((thread) => repairTextEncoding(thread.subject || '').trim());
        const titlePrompt = [
          '\u4f60\u662f\u90ae\u4ef6\u6807\u9898\u7ffb\u8bd1\u52a9\u624b\u3002',
          '\u8bf7\u628a\u7528\u6237\u63d0\u4f9b\u7684\u90ae\u4ef6\u6807\u9898\u9010\u6761\u7ffb\u8bd1\u6210\u81ea\u7136\u3001\u7b80\u6d01\u7684\u4e2d\u6587\u3002',
          '\u4fdd\u7559\u54c1\u724c\u540d\u3001\u4ea7\u54c1\u578b\u53f7\u3001\u4eba\u540d\u3001\u94fe\u63a5\u3001\u8d27\u5e01\u548c\u6570\u5b57\u3002',
          '\u53ea\u8fd4\u56de\u4e25\u683c JSON \u6570\u7ec4\uff0c\u6570\u7ec4\u957f\u5ea6\u5fc5\u987b\u7b49\u4e8e\u8f93\u5165\u6807\u9898\u6570\u91cf\uff0c\u4e0d\u8981 Markdown\uff0c\u4e0d\u8981\u89e3\u91ca\u3002',
          settings.translatePrompt
            ? `\u53ef\u53c2\u8003\u8fd9\u4e2a\u7ffb\u8bd1\u98ce\u683c\u8981\u6c42\uff1a${settings.translatePrompt}`
            : '',
        ].filter(Boolean).join('\n');

        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: JSON.stringify(subjects),
            sourceLang: detectSubjectLanguage(subjects.join('\n')),
            customPrompt: titlePrompt,
            modelProvider: settings.modelProvider || 'builtin',
            customApiUrl: settings.customApiUrl || '',
            customModelName: settings.customModelName || '',
          }),
        });
        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || '\u6807\u9898\u7ffb\u8bd1\u5931\u8d25');
        }

        const translatedSubjects = parseSubjectTranslations(
          String(result.data?.translatedText || ''),
          subjects.length,
        );
        const nextTranslations = batch.reduce<Record<string, string>>((accumulator, thread, batchIndex) => {
          const translated = repairTextEncoding(translatedSubjects[batchIndex] || '').trim();
          if (translated) accumulator[thread.id] = translated;
          return accumulator;
        }, {});

        if (runId !== subjectTranslationRunRef.current) return;
        setSubjectTranslations((current) => ({ ...current, ...nextTranslations }));
      }
    } catch (caughtError) {
      if (runId === subjectTranslationRunRef.current) {
        setSubjectTranslationError(
          caughtError instanceof Error ? caughtError.message : '\u6807\u9898\u7ffb\u8bd1\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
        );
      }
    } finally {
      if (runId === subjectTranslationRunRef.current) {
        setTranslatingSubjects(false);
      }
    }
  }, [
    settings.customApiUrl,
    settings.customModelName,
    settings.modelProvider,
    settings.translatePrompt,
    subjectTranslations,
  ]);

  const visibleThreads = threads.filter((thread) => !showUnreadOnly || thread.hasUnread);
  const filteredThreads = isGlobalSearch
    ? [...visibleThreads].sort(
        (left, right) => getDateTimestamp(right.lastMessageDate) - getDateTimestamp(left.lastMessageDate),
      )
    : sortThreadsByLatest(visibleThreads, mailbox);

  useEffect(() => {
    if (!showTranslatedSubjects || translatingSubjects) return;
    void translateThreadSubjects(filteredThreads);
  }, [filteredThreads, showTranslatedSubjects, translateThreadSubjects, translatingSubjects]);

  const handleToggleSubjectTranslations = () => {
    setSubjectTranslationError(null);

    if (showTranslatedSubjects) {
      subjectTranslationRunRef.current += 1;
      setShowTranslatedSubjects(false);
      setTranslatingSubjects(false);
      return;
    }

    setShowTranslatedSubjects(true);
    void translateThreadSubjects(filteredThreads);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  };

  const formatSyncTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const unreadBadgeCount = normalUnreadCount ?? threads.filter((thread) => thread.hasUnread).length;
  const visibleError = error || gmailAuthError;

  if (authProcessing || authLoading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
        <h3 className="mb-2 text-lg font-semibold">正在恢复 Gmail 登录状态…</h3>
        <p className="text-sm text-muted-foreground">已有授权不会因为页面切换而失效。</p>
      </div>
    );
  }

  if (authStatus === 'error' && !auth?.isConnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <AlertCircle className="mb-4 h-9 w-9 text-amber-500" />
        <h3 className="mb-2 text-lg font-semibold">暂时无法检查 Gmail 状态</h3>
        <p className="mb-4 max-w-sm text-sm text-muted-foreground">
          {gmailAuthError || '网络或账号服务暂时不可用，系统不会把这次失败当作退出登录。'}
        </p>
        <Button variant="outline" onClick={() => void refreshSession().catch(() => undefined)}>
          重新检查
        </Button>
      </div>
    );
  }

  if (!auth?.isConnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg border border-white/70 bg-white/75 shadow-apple">
          <Mail className="h-7 w-7 text-red-500" />
        </div>
        <h3 className="mb-2 text-lg font-semibold">{'\u8fde\u63a5 Gmail'}</h3>
        <p className="mb-4 max-w-xs text-sm text-muted-foreground">
          {'\u5b8c\u6210 Google \u6388\u6743\u540e\uff0c\u5373\u53ef\u5728\u5de5\u4f5c\u53f0\u5185\u7ba1\u7406\u90ae\u4ef6\u3002'}
        </p>
        {visibleError && <p className="mb-4 text-sm text-destructive">{visibleError}</p>}
        <Button onClick={() => { window.location.href = '/api/auth/google'; }}>
          {'\u8fde\u63a5 Gmail'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {!avatarOnly && (
      <div className="material-toolbar flex shrink-0 items-center justify-between border-b border-border/55 px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="section-title truncate">
              {hasSearchInput ? '全邮箱搜索' : MAILBOX_LABELS[mailbox]}
            </h2>
            {hasSearchInput ? (
              <Badge variant="secondary" className="rounded-md bg-blue-50 text-blue-700">
                全邮箱
              </Badge>
            ) : (mailbox === 'inbox' || mailbox === 'unread') && (
              <Badge variant="secondary" className="rounded-md bg-white/80">
                {unreadBadgeCount} {'\u672a\u8bfb'}
              </Badge>
            )}
          </div>
          {lastSyncedAt && (
            <span className="mt-0.5 text-[11px] text-muted-foreground">
              {'\u4e0a\u6b21\u540c\u6b65'} {formatSyncTime(lastSyncedAt)}
            </span>
          )}
          {subjectTranslationError && (
            <span className="mt-0.5 text-[11px] text-destructive">
              {subjectTranslationError}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant={showTranslatedSubjects ? 'secondary' : 'ghost'}
            size="icon"
            className="h-9 w-9 rounded-lg hover:bg-white/70"
            title={showTranslatedSubjects ? '\u6062\u590d\u539f\u6807\u9898' : '\u7ffb\u8bd1\u90ae\u4ef6\u6807\u9898'}
            onClick={handleToggleSubjectTranslations}
            disabled={translatingSubjects && !showTranslatedSubjects}
          >
            {translatingSubjects ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Languages className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg hover:bg-white/70"
            title={'\u5237\u65b0'}
            onClick={fetchThreads}
            disabled={loading || searchInputPending}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
      )}

      {!avatarOnly && (
      <div className="material-toolbar shrink-0 border-b border-border/55 px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索整个 Gmail（邮箱、主题或关键词）"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="glass-control h-10 border-0 pl-9"
          />
        </div>
        {hasSearchInput && (
          <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
            {searchInputPending ? '正在准备搜索…' : '正在搜索收件箱、已发送和归档邮件（不含垃圾邮件与垃圾箱）'}
          </p>
        )}
        {mailbox !== 'unread' && (
          <Button
            variant={showUnreadOnly ? 'secondary' : 'ghost'}
            size="sm"
            className="mt-2 h-7 rounded-md px-2 text-xs"
            onClick={() => setShowUnreadOnly((current) => !current)}
          >
            {showUnreadOnly ? '\u663e\u793a\u5168\u90e8' : '\u53ea\u770b\u672a\u8bfb'}
          </Button>
        )}
      </div>
      )}

      {!avatarOnly && mailbox === 'inbox' && !hasSearchInput && (
        <div className="material-toolbar grid shrink-0 grid-cols-3 border-b border-border/55">
          {CATEGORY_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`flex h-11 cursor-pointer items-center justify-center gap-2 border-b-2 text-sm transition-[color,background-color,border-color] duration-200 ease-out active:bg-white/75 motion-reduce:transition-none ${
                category === id
                  ? 'border-primary bg-white/55 font-medium text-primary shadow-[inset_0_-1px_0_var(--primary)] hover:bg-white/70'
                  : 'border-transparent text-muted-foreground hover:bg-white/65 hover:text-foreground'
              }`}
              onClick={() => onCategoryChange(id)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      )}

      {visibleError && threads.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs text-amber-800">
          <span className="truncate">同步暂时失败，继续显示上次邮件：{visibleError}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs text-amber-900 hover:bg-amber-100"
            onClick={() => void fetchThreads()}
          >
            重试
          </Button>
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        {(loading && threads.length === 0) || searchInputPending ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibleError && threads.length === 0 ? (
          <div className="p-6 text-center">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">{visibleError}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchThreads}>
              {'\u91cd\u8bd5'}
            </Button>
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {hasSearchInput
              ? '整个 Gmail 中没有找到匹配邮件（不含垃圾邮件与垃圾箱）'
              : '\u8fd9\u91cc\u6682\u65f6\u6ca1\u6709\u90ae\u4ef6'}
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const latestMessage = thread.messages[thread.messages.length - 1];
            const listMessage = isGlobalSearch
              ? thread.messages[thread.messages.length - 1]
              : getThreadListMessage(thread, mailbox);
            const contactMessage = getGmailThreadContact(thread, auth.email).message;
            const senderMessage = contactMessage || listMessage;
            const sender = senderMessage?.from?.split('<')[0]?.replaceAll('"', '').trim()
              || '\u672a\u77e5\u53d1\u4ef6\u4eba';
            const hasReplied = Boolean(
              auth.email
              && latestMessage?.from
              && normalizeEmailAddress(latestMessage.from) === normalizeEmailAddress(auth.email),
            );
            const displaySubject = showTranslatedSubjects && subjectTranslations[thread.id]
              ? subjectTranslations[thread.id]
              : thread.subject;
            const actionLoading = actionThreadId === thread.id;
            const threadOpening = openingThreadId === thread.id;
            const avatar = threadAvatars[thread.id] || { status: 'idle' as const };

            return (
              <div
                key={thread.id}
                role="button"
                tabIndex={0}
                aria-busy={threadOpening}
                aria-label={avatarOnly ? `${sender}：${displaySubject || '(无主题)'}` : undefined}
                title={avatarOnly ? `${sender}\n${displaySubject || '(无主题)'}` : undefined}
                className={`glass-list-row group cursor-pointer border-b border-border/45 py-2.5 outline-none transition-[background-color,box-shadow] duration-200 ease-out hover:bg-white/82 active:bg-white/90 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 motion-reduce:transition-none ${
                  avatarOnly ? 'px-2' : 'px-3'
                } ${
                  selectedThreadId === thread.id ? 'bg-primary/[0.07] shadow-[inset_2px_0_0_var(--primary)]' : ''
                } ${thread.hasUnread ? 'bg-primary/[0.055]' : ''} ${threadOpening ? 'cursor-wait bg-white/85' : ''}`}
                onClick={() => handleOpenThread(thread)}
                onMouseEnter={() => prefetchThread(thread)}
                onMouseLeave={cancelThreadPrefetch}
                onFocus={() => prefetchThread(thread)}
                onBlur={cancelThreadPrefetch}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleOpenThread(thread);
                  }
                }}
              >
                {avatarOnly ? (
                  <div className="relative flex w-full justify-center">
                    <div className="relative">
                      <YouTubeChannelAvatar
                        avatar={avatar}
                        fallback={sender}
                        label={avatar.title || sender}
                        size="sm"
                        clickable={false}
                      />
                      {thread.hasUnread && (
                        <span
                          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-primary"
                          aria-label="未读"
                        />
                      )}
                      {threadOpening && (
                        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-white/65">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                <div className={`flex gap-2 ${compact ? 'items-start' : 'items-center'}`}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-0.5 h-8 w-8 shrink-0 rounded-lg hover:bg-white/70"
                    title={thread.isStarred ? '\u53d6\u6d88\u6807\u661f' : '\u6807\u661f'}
                    disabled={actionLoading}
                    onClick={(event) => {
                      event.stopPropagation();
                      modifyThread(
                        thread,
                        thread.isStarred ? [] : ['STARRED'],
                        thread.isStarred ? ['STARRED'] : [],
                      );
                    }}
                  >
                    <Star className={`h-4 w-4 ${thread.isStarred ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
                  </Button>
                  <YouTubeChannelAvatar
                    avatar={avatar}
                    fallback={sender}
                    label={avatar.title || sender}
                    size="xs"
                  />

                  {compact ? (
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`flex min-w-0 flex-1 items-center gap-1.5 text-sm ${
                            thread.hasUnread ? 'font-semibold' : 'text-muted-foreground'
                          }`}
                        >
                          {hasReplied && (
                            <Reply
                              className="h-3.5 w-3.5 shrink-0 text-emerald-600"
                              aria-label={'\u5df2\u56de\u590d'}
                            />
                          )}
                          <span className="min-w-0 truncate">{sender}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatDate(listMessage?.date || thread.lastMessageDate)}
                        </span>
                      </div>
                      <p
                        className={`mt-0.5 truncate text-sm ${thread.hasUnread ? 'font-semibold' : ''}`}
                        title={showTranslatedSubjects && subjectTranslations[thread.id] ? thread.subject : undefined}
                      >
                        {displaySubject}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {listMessage?.snippet || thread.snippet}
                      </p>
                    </div>
                  ) : (
                    <div className="grid min-w-0 flex-1 grid-cols-[minmax(150px,240px)_minmax(0,1fr)_72px] items-center gap-4">
                      <span
                        className={`flex min-w-0 items-center gap-1.5 text-sm ${
                          thread.hasUnread ? 'font-semibold' : 'text-muted-foreground'
                        }`}
                      >
                        {hasReplied && (
                          <Reply
                            className="h-3.5 w-3.5 shrink-0 text-emerald-600"
                            aria-label={'\u5df2\u56de\u590d'}
                          />
                        )}
                        <span className="min-w-0 truncate">{sender}</span>
                      </span>
                      <div className="min-w-0 truncate text-sm">
                        <span
                          className={thread.hasUnread ? 'font-semibold' : ''}
                          title={showTranslatedSubjects && subjectTranslations[thread.id] ? thread.subject : undefined}
                        >
                          {displaySubject}
                        </span>
                        {(listMessage?.snippet || thread.snippet) && (
                          <span className="text-muted-foreground">
                            {' - '}{listMessage?.snippet || thread.snippet}
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        {formatDate(listMessage?.date || thread.lastMessageDate)}
                      </span>
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 rounded-lg opacity-70 hover:bg-white/70 group-hover:opacity-100"
                    title={thread.hasUnread ? '\u6807\u8bb0\u4e3a\u5df2\u8bfb' : '\u6807\u8bb0\u4e3a\u672a\u8bfb'}
                    disabled={actionLoading || Boolean(openingThreadId)}
                    onClick={(event) => {
                      event.stopPropagation();
                      modifyThread(
                        thread,
                        thread.hasUnread ? [] : ['UNREAD'],
                        thread.hasUnread ? ['UNREAD'] : [],
                      );
                    }}
                  >
                    {actionLoading || threadOpening ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : thread.hasUnread ? (
                      <MailOpen className="h-4 w-4" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                )}
              </div>
            );
          })
        )}
      </ScrollArea>

      {!avatarOnly && (
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/55 bg-white/55 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 rounded-lg bg-white/70 px-2 text-xs"
          onClick={goToPreviousPage}
          disabled={loading || pageIndex === 0}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          上一页
        </Button>
        <div className="flex min-w-0 flex-col items-center text-center leading-tight">
          <span>{hasSearchInput ? '全邮箱搜索' : `第 ${pageIndex + 1} 页`}</span>
          {hasSearchInput && <span className="text-[11px]">第 {pageIndex + 1} 页</span>}
          <span className="text-[11px]">每页最多 {GMAIL_PAGE_SIZE} 封</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 rounded-lg bg-white/70 px-2 text-xs"
          onClick={goToNextPage}
          disabled={loading || !nextPageToken}
        >
          下一页
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      )}

      {!avatarOnly && (
      <div className="flex shrink-0 items-center justify-between border-t border-white/55 bg-white/45 px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">{auth.email || 'Gmail'}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 rounded-lg px-2 text-xs hover:bg-white/70"
          onClick={disconnect}
        >
          <LogOut className="h-3.5 w-3.5" />
          {'\u65ad\u5f00'}
        </Button>
      </div>
      )}
    </div>
  );
}
