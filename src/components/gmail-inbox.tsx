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
import {
  GmailAttachment,
  GmailCategory,
  GmailMailbox,
  GmailMessage,
  GmailThread,
} from '@/lib/types';

const GMAIL_PAGE_SIZE = 50;
const GMAIL_DETAIL_BATCH_SIZE = 16;
const GMAIL_AUTO_REFRESH_MS = 60_000;
const SUBJECT_TRANSLATION_BATCH_SIZE = 12;

interface GmailInboxProps {
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

function getThreadTimestamp(thread: GmailThread): number {
  return getDateTimestamp(thread.lastMessageDate);
}

function sortThreadsByLatest(threads: GmailThread[]): GmailThread[] {
  return [...threads].sort((left, right) => getThreadTimestamp(right) - getThreadTimestamp(left));
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

export function GmailInbox({
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
  const subjectTranslationRunRef = useRef(0);
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [translatingSubjects, setTranslatingSubjects] = useState(false);
  const [actionThreadId, setActionThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subjectTranslationError, setSubjectTranslationError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showTranslatedSubjects, setShowTranslatedSubjects] = useState(false);
  const [subjectTranslations, setSubjectTranslations] = useState<Record<string, string>>({});
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
    setThreads((current) => {
      if (mailbox === 'unread' && !updatedThread.hasUnread) {
        return current.filter((thread) => thread.id !== updatedThread.id);
      }
      return sortThreadsByLatest(
        current.map((thread) => thread.id === updatedThread.id ? updatedThread : thread),
      );
    });
  }, [mailbox, updatedThread]);

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

  const getAccessToken = useCallback(async () => {
    if (!auth?.accessToken) throw new Error('\u8bf7\u91cd\u65b0\u8fde\u63a5 Gmail\u3002');
    if (auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
      return auth.accessToken;
    }

    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
    });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) {
      throw new Error(result.error || 'Gmail \u6388\u6743\u5df2\u8fc7\u671f\uff0c\u8bf7\u91cd\u65b0\u8fde\u63a5\u3002');
    }

    connect({
      ...auth,
      accessToken: result.data.accessToken,
      expiresAt: result.data.expiresAt,
    });
    return result.data.accessToken as string;
  }, [auth, connect]);

  const fetchThreads = useCallback(async () => {
    if (!auth?.accessToken) return;
    if (activePaginationKey !== paginationKey) return;
    const fetchId = latestFetchIdRef.current + 1;
    latestFetchIdRef.current = fetchId;
    setLoading(true);
    setError(null);

    try {
      const accessToken = await getAccessToken();
      const headers = { Authorization: `Bearer ${accessToken}` };
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
      const [listResponse, unreadCount] = await Promise.all([
        fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/threads?${params.toString()}`,
          { headers },
        ),
        unreadCountRequest,
      ]);
      if (fetchId !== latestFetchIdRef.current) return;
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

        setThreads((current) => sortThreadsByLatest(index === 0 ? visibleBatch : [...current, ...visibleBatch]));
      }
      setLastSyncedAt(new Date().toISOString());
    } catch (caughtError) {
      if (fetchId === latestFetchIdRef.current) {
        setError((caughtError as Error).message);
      }
    } finally {
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
    if (!auth?.isConnected || !auth.accessToken) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !loading && !actionThreadId) {
        void fetchThreads();
      }
    }, GMAIL_AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [actionThreadId, auth?.accessToken, auth?.isConnected, fetchThreads, loading]);

  useEffect(() => {
    if (!auth?.isConnected || !auth.accessToken) return undefined;

    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible' && !loading && !actionThreadId) {
        void fetchThreads();
      }
    };

    window.addEventListener('focus', refreshWhenActive);
    document.addEventListener('visibilitychange', refreshWhenActive);

    return () => {
      window.removeEventListener('focus', refreshWhenActive);
      document.removeEventListener('visibilitychange', refreshWhenActive);
    };
  }, [actionThreadId, auth?.accessToken, auth?.isConnected, fetchThreads, loading]);

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
          sortThreadsByLatest(current.map((item) => item.id === thread.id ? nextThread : item)),
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
    setActionThreadId(thread.id);
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
      setActionThreadId(null);
    }

    if (nextThread.hasUnread) {
      nextThread = await modifyThread(nextThread, [], ['UNREAD']);
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
        <Mail className="mb-4 h-10 w-10 text-red-500" />
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
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div className="flex min-w-0 flex-col">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate font-semibold">{MAILBOX_LABELS[mailbox]}</h2>
            {(mailbox === 'inbox' || mailbox === 'unread') && (
              <Badge variant="secondary">
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
            className="h-8 w-8"
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
            className="h-8 w-8"
            title={'\u5237\u65b0'}
            onClick={fetchThreads}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="shrink-0 border-b px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={'\u641c\u7d22\u90ae\u4ef6...'}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-9 pl-9"
          />
        </div>
        {mailbox !== 'unread' && (
          <Button
            variant={showUnreadOnly ? 'secondary' : 'ghost'}
            size="sm"
            className="mt-1 h-7 px-2 text-xs"
            onClick={() => setShowUnreadOnly((current) => !current)}
          >
            {showUnreadOnly ? '\u663e\u793a\u5168\u90e8' : '\u53ea\u770b\u672a\u8bfb'}
          </Button>
        )}
      </div>

      {mailbox === 'inbox' && (
        <div className="grid shrink-0 grid-cols-3 border-b">
          {CATEGORY_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`flex h-11 items-center justify-center gap-2 border-b-2 text-sm transition-colors ${
                category === id
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-muted-foreground hover:bg-muted/50'
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
            const sender = latestMessage?.from?.split('<')[0]?.replaceAll('"', '').trim()
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

            return (
              <div
                key={thread.id}
                role="button"
                tabIndex={0}
                className={`group border-b px-3 py-2.5 transition-colors hover:bg-muted/50 ${
                  selectedThreadId === thread.id ? 'bg-muted' : ''
                } ${thread.hasUnread ? 'bg-primary/[0.04]' : ''}`}
                onClick={() => handleOpenThread(thread)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleOpenThread(thread);
                }}
              >
                <div className={`flex gap-2 ${compact ? 'items-start' : 'items-center'}`}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="mt-0.5 h-7 w-7 shrink-0"
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
                          {formatDate(thread.lastMessageDate)}
                        </span>
                      </div>
                      <p
                        className={`mt-0.5 truncate text-sm ${thread.hasUnread ? 'font-semibold' : ''}`}
                        title={showTranslatedSubjects && subjectTranslations[thread.id] ? thread.subject : undefined}
                      >
                        {displaySubject}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{thread.snippet}</p>
                    </div>
                  ) : (
                    <div className="grid min-w-0 flex-1 grid-cols-[minmax(120px,220px)_minmax(0,1fr)_auto] items-center gap-3">
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
                        {thread.snippet && (
                          <span className="text-muted-foreground"> - {thread.snippet}</span>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatDate(thread.lastMessageDate)}
                      </span>
                    </div>
                  )}

                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 opacity-70 group-hover:opacity-100"
                    title={thread.hasUnread ? '\u6807\u8bb0\u4e3a\u5df2\u8bfb' : '\u6807\u8bb0\u4e3a\u672a\u8bfb'}
                    disabled={actionLoading}
                    onClick={(event) => {
                      event.stopPropagation();
                      modifyThread(
                        thread,
                        thread.hasUnread ? [] : ['UNREAD'],
                        thread.hasUnread ? ['UNREAD'] : [],
                      );
                    }}
                  >
                    {actionLoading ? (
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

      <div className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
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
          className="h-7 gap-1 px-2 text-xs"
          onClick={goToNextPage}
          disabled={loading || !nextPageToken}
        >
          下一页
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
        <span className="truncate">{auth.email || 'Gmail'}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={disconnect}
        >
          <LogOut className="h-3.5 w-3.5" />
          {'\u65ad\u5f00'}
        </Button>
      </div>
    </div>
  );
}
