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
import type { FeishuFieldMapping } from '@/lib/feishu-mapping';
import {
  getGmailThreadContact,
  isIgnoredGmailThreadSender,
} from '@/lib/gmail-thread-contact';
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
  readChannelAvatarCache,
  resolveChannelAvatar,
  type ChannelAvatarState,
} from '@/lib/youtube-channel-avatar';
import { YouTubeChannelAvatar } from './youtube-channel-avatar';

const GMAIL_PAGE_SIZE = 50;
const GMAIL_DETAIL_BATCH_SIZE = 16;
const GMAIL_AUTO_REFRESH_MS = 60_000;
const GMAIL_CACHE_STALE_MS = 60_000;
const SUBJECT_TRANSLATION_BATCH_SIZE = 12;
const CHANNEL_AVATAR_PREFETCH_CONCURRENCY = 3;

interface GmailInboxProps {
  active?: boolean;
  onSelectThread: (thread: GmailThread) => void;
  onThreadUpdated?: (thread: GmailThread) => void;
  onCategoryChange: (category: GmailCategory) => void;
  updatedThread?: GmailThread | null;
  selectedThreadId?: string;
  mailbox: GmailMailbox;
  category: GmailCategory;
  refreshKey?: number;
  compact?: boolean;
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

function readableGmailAuthError(message?: string) {
  if (message?.includes('尚未连接 Gmail')) {
    return 'Gmail 连接记录不完整，请到“设置 > Gmail 邮件”断开后重新连接。';
  }
  return message || 'Gmail 授权已过期，请重新连接。';
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

  const participantCount = new Set(messages.map((message) => message.from).filter(Boolean)).size;
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

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
) {
  for (let index = 0; index < items.length; index += limit) {
    await Promise.all(items.slice(index, index + limit).map(worker));
  }
}

export function GmailInbox({
  active = true,
  onSelectThread,
  onThreadUpdated,
  onCategoryChange,
  updatedThread,
  selectedThreadId,
  mailbox,
  category,
  refreshKey = 0,
  compact = true,
}: GmailInboxProps) {
  const { auth, connect, disconnect } = useGmailAuth();
  const { settings } = useSettings();
  const latestFetchIdRef = useRef(0);
  const activeFetchKeyRef = useRef<string | null>(null);
  const wasActiveRef = useRef(active);
  const subjectTranslationRunRef = useRef(0);
  const avatarPrefetchRunRef = useRef(0);
  const openingThreadRef = useRef<string | null>(null);
  const manuallyPreservedUnreadThreadIdsRef = useRef<Set<string>>(new Set());
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [translatingSubjects, setTranslatingSubjects] = useState(false);
  const [actionThreadId, setActionThreadId] = useState<string | null>(null);
  const [openingThreadId, setOpeningThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subjectTranslationError, setSubjectTranslationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showTranslatedSubjects, setShowTranslatedSubjects] = useState(false);
  const [subjectTranslations, setSubjectTranslations] = useState<Record<string, string>>({});
  const [threadAvatars, setThreadAvatars] = useState<Record<string, ChannelAvatarState>>({});
  const [authProcessing, setAuthProcessing] = useState(false);
  const paginationKey = `${mailbox}:${category}:${refreshKey}`;
  const [activePaginationKey, setActivePaginationKey] = useState(paginationKey);
  const [pageTokens, setPageTokens] = useState<string[]>(['']);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [normalUnreadCount, setNormalUnreadCount] = useState<number | null>(null);

  useEffect(() => {
    setActivePaginationKey(paginationKey);
    setPageTokens(['']);
    setPageIndex(0);
    setNextPageToken(null);
    setThreads([]);
    setNormalUnreadCount(null);
  }, [paginationKey]);

  useEffect(() => {
    if (!updatedThread) return;
    if (updatedThread.hasUnread && isLatestMessageFromEmail(updatedThread, auth?.email)) {
      manuallyPreservedUnreadThreadIdsRef.current.add(updatedThread.id);
    } else if (!updatedThread.hasUnread) {
      manuallyPreservedUnreadThreadIdsRef.current.delete(updatedThread.id);
    }
    setThreads((current) => {
      if (mailbox === 'unread' && !updatedThread.hasUnread) {
        return current.filter((thread) => thread.id !== updatedThread.id);
      }
      return sortThreadsByLatest(
        current.map((thread) => thread.id === updatedThread.id ? updatedThread : thread),
        mailbox,
      );
    });
  }, [auth?.email, mailbox, updatedThread]);

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
      fetch('/api/auth/session')
        .then((response) => response.json())
        .then((result) => {
          if (result.success && result.data?.accessToken) connect(result.data);
          else setError(result.error || '\u65e0\u6cd5\u4fdd\u5b58 Gmail \u6388\u6743\u4fe1\u606f\u3002');
        })
        .catch((caughtError: Error) => setError(`Gmail \u8fde\u63a5\u5931\u8d25\uff1a${caughtError.message}`))
        .finally(() => {
          setAuthProcessing(false);
          window.history.replaceState({}, '', window.location.pathname);
        });
    }
  }, [connect]);

  const getAccessToken = useCallback(async (options: { force?: boolean } = {}) => {
    if (!auth?.isConnected) throw new Error('请重新连接 Gmail。');
    if (!options.force && auth.accessToken && auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
      return auth.accessToken;
    }

    const response = await fetch(options.force ? '/api/auth/refresh?force=1' : '/api/auth/refresh', {
      method: 'POST',
    });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) {
      throw new Error(readableGmailAuthError(result.error));
    }

    connect({
      ...auth,
      isConnected: true,
      email: result.data.email || auth.email,
      accessToken: result.data.accessToken,
      expiresAt: result.data.expiresAt,
    });
    return result.data.accessToken as string;
  }, [auth, connect]);

  const fetchThreads = useCallback(async () => {
    if (!auth?.accessToken) return;
    if (activePaginationKey !== paginationKey) return;
    const fetchKey = `${paginationKey}:${pageIndex}`;
    if (activeFetchKeyRef.current === fetchKey) return;
    activeFetchKeyRef.current = fetchKey;
    const fetchId = latestFetchIdRef.current + 1;
    latestFetchIdRef.current = fetchId;
    setLoading(true);
    setError(null);

    try {
      let accessToken = await getAccessToken();
      let headers = { Authorization: `Bearer ${accessToken}` };
      const pageToken = pageTokens[pageIndex] || '';
      const params = new URLSearchParams({ maxResults: String(GMAIL_PAGE_SIZE) });
      const requestLabelIds = [...MAILBOX_API_LABELS[mailbox]];
      const categoryLabelId = mailbox === 'inbox' ? CATEGORY_LABEL_IDS[category] : undefined;
      if (categoryLabelId) requestLabelIds.push(categoryLabelId);
      requestLabelIds.forEach((label) => params.append('labelIds', label));
      if (pageToken) params.set('pageToken', pageToken);

      const unreadCountParams = new URLSearchParams({
        maxResults: '1',
        q: NORMAL_UNREAD_QUERY,
      });
      const unreadCountRequest = mailbox === 'inbox' || mailbox === 'unread'
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
      if (fetchId !== latestFetchIdRef.current) return;

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
            mailbox === 'inbox' || mailbox === 'unread'
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
          if (fetchId !== latestFetchIdRef.current) return;
        }
      }

      if (unreadCount !== null) setNormalUnreadCount(unreadCount);

      if (!listResponse.ok) {
        const result = await listResponse.json().catch(() => ({}));
        throw new Error(result.error?.message || '\u83b7\u53d6\u90ae\u4ef6\u5217\u8868\u5931\u8d25');
      }

      const listResult = await listResponse.json() as GmailThreadListResult;
      if (fetchId !== latestFetchIdRef.current) return;
      const threadRefs = listResult.threads || [];
      setNextPageToken(listResult.nextPageToken || null);
      if (threadRefs.length === 0) {
        setThreads([]);
        setLastSyncedAt(new Date().toISOString());
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
        if (fetchId !== latestFetchIdRef.current) return;

        const parsedBatch = await Promise.all(
          batchResults
            .filter((thread): thread is Record<string, unknown> => Boolean(thread))
            .map((thread) => parseGmailThread(thread, accessToken, false)),
        );
        const visibleBatch = parsedBatch.filter((thread) => shouldShowThreadInMailbox(thread, mailbox, category));
        if (fetchId !== latestFetchIdRef.current) return;
        nextThreads.push(...visibleBatch);
      }
      setThreads(sortThreadsByLatest(nextThreads, mailbox));
      setLastSyncedAt(new Date().toISOString());
    } catch (caughtError) {
      if (fetchId === latestFetchIdRef.current) {
        setError((caughtError as Error).message);
      }
    } finally {
      if (activeFetchKeyRef.current === fetchKey) {
        activeFetchKeyRef.current = null;
      }
      if (fetchId === latestFetchIdRef.current) {
        setLoading(false);
      }
    }
  }, [
    activePaginationKey,
    auth?.accessToken,
    category,
    getAccessToken,
    mailbox,
    pageIndex,
    pageTokens,
    paginationKey,
  ]);

  useEffect(() => {
    if (auth?.isConnected && auth.accessToken) fetchThreads();
  }, [auth?.isConnected, auth?.accessToken, fetchThreads, refreshKey]);

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
            matchedEmails.forEach((matchedEmail) => {
              profileByEmail.set(matchedEmail, {
                channelName: getMappedFeishuValue(record, mapping, 'channelName'),
                channelUrl: getMappedFeishuValue(record, mapping, 'channelUrl'),
                channelId: getMappedFeishuValue(record, mapping, 'channelId'),
              });
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
            if (!profile) return;
            const lookup = buildChannelAvatarLookup(profile);
            if (!lookup) return;
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

          setThreadAvatars((current) => ({ ...current, ...nextAvatars }));

          await runWithConcurrency(
            Array.from(pendingByLookup.values()),
            CHANNEL_AVATAR_PREFETCH_CONCURRENCY,
            async (item) => {
              const avatar = await resolveChannelAvatar(item.lookup, {
                regionCode: settings.youtubeDefaultRegion || '',
                relevanceLanguage: settings.youtubeDefaultLanguage || '',
              });
              if (runId !== avatarPrefetchRunRef.current) return;
              setThreadAvatars((current) => {
                const next = { ...current };
                item.threadIds.forEach((threadId) => {
                  next[threadId] = {
                    ...avatar,
                    title: avatar.title || item.title,
                  };
                });
                return next;
              });
            },
          );
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

  const modifyThread = async (
    thread: GmailThread,
    addLabelIds: string[] = [],
    removeLabelIds: string[] = [],
  ) => {
    setActionThreadId(thread.id);
    setError(null);

    try {
      const accessToken = await getAccessToken();
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

      if (addLabelIds.includes('UNREAD')) {
        manuallyPreservedUnreadThreadIdsRef.current.add(thread.id);
      }
      if (removeLabelIds.includes('UNREAD')) {
        manuallyPreservedUnreadThreadIdsRef.current.delete(thread.id);
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
      onThreadUpdated?.(nextThread);
      return nextThread;
    } catch (caughtError) {
      setError((caughtError as Error).message);
      return thread;
    } finally {
      setActionThreadId(null);
    }
  };

  const handleOpenThread = async (thread: GmailThread) => {
    if (openingThreadRef.current) return;
    openingThreadRef.current = thread.id;
    setOpeningThreadId(thread.id);
    let nextThread = thread;

    try {
      const accessToken = await getAccessToken();
      const response = await fetchWithTimeout(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        20_000,
      );
      if (response.ok) {
        nextThread = await parseGmailThread(await response.json(), accessToken, true);
      }
    } catch {
      // The lightweight list data is still usable if full content loading fails.
    } finally {
      openingThreadRef.current = null;
      setOpeningThreadId(null);
    }

    const shouldPreserveUnread = nextThread.hasUnread
      && (
        manuallyPreservedUnreadThreadIdsRef.current.has(nextThread.id)
        || isLatestMessageFromEmail(nextThread, auth?.email)
      );

    if (nextThread.hasUnread && !shouldPreserveUnread) {
      nextThread = await modifyThread(nextThread, [], ['UNREAD']);
    } else {
      setThreads((current) =>
        sortThreadsByLatest(
          current.map((item) => item.id === nextThread.id ? nextThread : item),
          mailbox,
        ),
      );
    }
    onSelectThread(nextThread);
  };

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

  const filteredThreads = sortThreadsByLatest(
    threads.filter((thread) => {
      const normalizedQuery = searchQuery.trim().toLowerCase();
      const matchesSearch = !normalizedQuery
        || thread.subject.toLowerCase().includes(normalizedQuery)
        || thread.snippet.toLowerCase().includes(normalizedQuery)
        || thread.messages.some((message) => message.from.toLowerCase().includes(normalizedQuery));
      return matchesSearch && (!showUnreadOnly || thread.hasUnread);
    }),
    mailbox,
  );

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

  if (authProcessing) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-primary" />
        <h3 className="mb-2 text-lg font-semibold">{'\u6b63\u5728\u8fde\u63a5 Gmail...'}</h3>
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
        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        <Button onClick={() => { window.location.href = '/api/auth/google'; }}>
          {'\u8fde\u63a5 Gmail'}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-white/55 bg-white/62 px-4 py-3 backdrop-blur-xl">
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="section-title truncate">{MAILBOX_LABELS[mailbox]}</h2>
            {(mailbox === 'inbox' || mailbox === 'unread') && (
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
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="shrink-0 border-b border-white/55 bg-white/45 px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={'\u641c\u7d22\u90ae\u4ef6...'}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="glass-control h-10 border-0 pl-9"
          />
        </div>
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

      {mailbox === 'inbox' && (
        <div className="grid shrink-0 grid-cols-3 border-b border-white/55 bg-white/38">
          {CATEGORY_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`flex h-11 cursor-pointer items-center justify-center gap-2 border-b-2 text-sm transition-all duration-200 ease-out active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100 ${
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

      <ScrollArea className="min-h-0 flex-1">
        {loading && threads.length === 0 ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="p-6 text-center">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-destructive" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={fetchThreads}>
              {'\u91cd\u8bd5'}
            </Button>
          </div>
        ) : filteredThreads.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {searchQuery ? '\u6ca1\u6709\u627e\u5230\u5339\u914d\u7684\u90ae\u4ef6' : '\u8fd9\u91cc\u6682\u65f6\u6ca1\u6709\u90ae\u4ef6'}
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const latestMessage = thread.messages[thread.messages.length - 1];
            const listMessage = getThreadListMessage(thread, mailbox);
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
                className={`glass-list-row group cursor-pointer border-b border-white/55 px-3 py-2.5 outline-none transition-all duration-200 ease-out hover:bg-white/72 hover:shadow-sm active:bg-white/85 focus-visible:ring-2 focus-visible:ring-ring/40 motion-reduce:transition-none ${
                  selectedThreadId === thread.id ? 'bg-white/85 shadow-[inset_3px_0_0_var(--primary)]' : ''
                } ${thread.hasUnread ? 'bg-primary/[0.055]' : ''} ${threadOpening ? 'cursor-wait bg-white/85' : ''}`}
                onClick={() => handleOpenThread(thread)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleOpenThread(thread);
                }}
              >
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
              </div>
            );
          })
        )}
      </ScrollArea>

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
          <span>第 {pageIndex + 1} 页</span>
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
    </div>
  );
}
