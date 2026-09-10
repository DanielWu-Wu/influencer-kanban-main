'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FilePenLine,
  FileText,
  Inbox,
  LoaderCircle,
  Mail,
  MailOpen,
  RefreshCw,
  Search,
  Send,
  Settings,
  Star,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { MailAccount } from '@/lib/mail-accounts';
import type { GmailMailbox, GmailMessage, GmailThread } from '@/lib/types';
import { publishInboxMailSnapshot } from '@/lib/inbox-new-mail';
import {
  clampGmailThreadListWidth,
  getGmailThreadListDoubleClickWidth,
  getGmailThreadListMaxWidth,
  GMAIL_THREAD_LIST_DEFAULT_WIDTH,
  GMAIL_THREAD_LIST_MAX_WIDTH,
  GMAIL_THREAD_LIST_MIN_WIDTH,
  isGmailThreadListAvatarOnly,
  parseStoredGmailThreadListWidth,
} from '@/lib/gmail-pane-layout';
import {
  ACCOUNT_SCOPE_CHANGED_EVENT,
  getAccountCacheScope,
  scopedLocalStorageKey,
} from '@/lib/account-cache-scope';
import { EmailDetail } from '@/components/email-detail';
import { GmailSignatureSettings } from '@/components/gmail-signature-settings';
import { MailAccountSwitcher } from '@/components/mail-account-switcher';
import { NewEmailComposer } from '@/components/new-email-composer';
import { getEditableMailDraft, type EditableMailDraft } from '@/lib/mail-draft-edit';
import {
  collectUnreadMailTargets,
  copyMailThreadReadState,
  getMailThreadRowVisualState,
  setMailMessagesReadState,
  type MailMessageReadTarget,
} from '@/lib/mail-read-state';

const MAILBOXES: Array<{ id: GmailMailbox; label: string; icon: typeof Inbox }> = [
  { id: 'inbox', label: '收件箱', icon: Inbox },
  { id: 'unread', label: '未读邮件', icon: MailOpen },
  { id: 'starred', label: '已标星', icon: Star },
  { id: 'sent', label: '已发送', icon: Send },
  { id: 'drafts', label: '草稿', icon: FileText },
];

const PAGE_SIZE = 50;

type TencentThreadListData = {
  threads: GmailThread[];
  page: number;
  hasNextPage: boolean;
  total: number;
};

type TencentThreadListCacheEntry = {
  data: TencentThreadListData;
  cachedAt: number;
};

const tencentThreadListCache = new Map<string, TencentThreadListCacheEntry>();

if (typeof window !== 'undefined') {
  window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, () => {
    tencentThreadListCache.clear();
  });
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function displaySender(value: string) {
  return value.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim() || value || '未知发件人';
}

function getThreadMessage(thread: GmailThread) {
  return [...thread.messages].sort(
    (left, right) => Date.parse(right.date || '') - Date.parse(left.date || ''),
  )[0];
}

function updateThreadMessage(
  thread: GmailThread,
  targetMessage: GmailMessage,
  update: { read?: boolean; starred?: boolean },
) {
  const messages = thread.messages.map((message) => {
    if (message.id !== targetMessage.id || update.read === undefined) return message;
    return {
      ...message,
      isRead: update.read,
      labels: update.read
        ? message.labels.filter((label) => label !== 'UNREAD')
        : Array.from(new Set([...message.labels, 'UNREAD'])),
    };
  });
  const hasUnread = messages.some((message) => !message.isRead);
  return {
    ...thread,
    messages,
    hasUnread,
    labels: hasUnread
      ? Array.from(new Set([...thread.labels, 'UNREAD']))
      : thread.labels.filter((label) => label !== 'UNREAD'),
    isStarred: update.starred === undefined ? thread.isStarred : update.starred,
  };
}

function threadContainsAnyMessage(thread: GmailThread, messageIds: ReadonlySet<string>) {
  return thread.messages.some((message) => messageIds.has(message.id));
}

function getCacheKey(accountId: string, mailbox: GmailMailbox, search: string, page: number) {
  return `${getAccountCacheScope()}:${accountId}:${mailbox}:${search.toLowerCase()}:${page}`;
}

function invalidateTencentThreadListCaches(accountId: string) {
  const prefix = `${getAccountCacheScope()}:${accountId}:`;
  for (const key of tencentThreadListCache.keys()) {
    if (key.startsWith(prefix)) tencentThreadListCache.delete(key);
  }
}

async function markTencentMessageRead(
  mailAccountId: string,
  target: MailMessageReadTarget,
) {
  const response = await fetch('/api/mail/tencent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'flags',
      mailAccountId,
      folder: target.folderRef,
      uid: target.providerMessageRef,
      read: true,
    }),
  });
  const result = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
  if (!response.ok || !result.success) {
    throw new Error(result.error || '标记邮件为已读失败。');
  }
}

export type TencentExmailOpenRequest = {
  mailAccountId: string;
  requestId: number;
  folderRef: string;
  providerMessageRef: string;
  rfcMessageId?: string;
  taskId?: string;
  composerMode?: 'ai' | 'template';
  retryRequested?: boolean;
  retryInput?: unknown;
  autoShowTranslation?: boolean;
  previewThread?: GmailThread;
};

export function TencentExmailPage({
  account,
  active = true,
  openMessageRequest,
  onManageMailAccounts,
}: {
  account: MailAccount;
  active?: boolean;
  openMessageRequest?: TencentExmailOpenRequest;
  onManageMailAccounts?: () => void;
}) {
  const [mailbox, setMailbox] = useState<GmailMailbox>('inbox');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [selectedThread, setSelectedThread] = useState<GmailThread | null>(null);
  const [selection, setSelection] = useState<{ id: number; request?: TencentExmailOpenRequest }>({ id: 0 });
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();
  const [actionThreadId, setActionThreadId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showingCachedData, setShowingCachedData] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewEmail, setShowNewEmail] = useState(false);
  const [editDraft, setEditDraft] = useState<EditableMailDraft | null>(null);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [threadListWidth, setThreadListWidth] = useState(GMAIL_THREAD_LIST_DEFAULT_WIDTH);
  const [threadListMaxWidth, setThreadListMaxWidth] = useState(GMAIL_THREAD_LIST_DEFAULT_WIDTH);
  const [threadListAvatarOnly, setThreadListAvatarOnly] = useState(false);
  const [resizingThreadList, setResizingThreadList] = useState(false);
  const runIdRef = useRef(0);
  const detailRunIdRef = useRef(0);
  const detailAbortControllerRef = useRef<AbortController | null>(null);
  const automaticReadRequestsRef = useRef(new Map<string, Promise<void>>());
  const accountIdRef = useRef(account.mailAccountId);
  const mailboxRef = useRef(mailbox);
  const threadsRef = useRef(threads);
  const handledOpenRequestRef = useRef(0);
  const pendingNavigationRequestRef = useRef(false);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const threadListRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const resizingPointerIdRef = useRef<number | null>(null);
  const threadListWidthRef = useRef(GMAIL_THREAD_LIST_DEFAULT_WIDTH);
  const threadListAvatarOnlyRef = useRef(false);
  const bodyCursorRef = useRef('');
  const bodyUserSelectRef = useRef('');
  const widthStorageKey = scopedLocalStorageKey(
    `tencent-thread-list-width-v1:${account.mailAccountId}`,
  );
  accountIdRef.current = account.mailAccountId;
  mailboxRef.current = mailbox;
  threadsRef.current = threads;

  const getAvailablePaneWidth = useCallback(() => {
    const workbench = workbenchRef.current;
    const threadList = threadListRef.current;
    if (!workbench || !threadList) {
      return typeof window === 'undefined' ? GMAIL_THREAD_LIST_MAX_WIDTH : window.innerWidth;
    }
    return Math.max(0, workbench.getBoundingClientRect().right - threadList.getBoundingClientRect().left);
  }, []);

  const applyThreadListWidth = useCallback((requestedWidth: number, options: {
    persist?: boolean;
    syncState?: boolean;
  } = {}) => {
    const availableWidth = getAvailablePaneWidth();
    const nextWidth = clampGmailThreadListWidth(requestedWidth, availableWidth);
    const nextMaxWidth = getGmailThreadListMaxWidth(availableWidth);
    const nextAvatarOnly = isGmailThreadListAvatarOnly(nextWidth);
    threadListWidthRef.current = nextWidth;
    workbenchRef.current?.style.setProperty('--gmail-thread-list-width', `${nextWidth}px`);
    resizeHandleRef.current?.setAttribute('aria-valuenow', String(nextWidth));
    resizeHandleRef.current?.setAttribute('aria-valuemax', String(nextMaxWidth));
    if (threadListAvatarOnlyRef.current !== nextAvatarOnly) {
      threadListAvatarOnlyRef.current = nextAvatarOnly;
      setThreadListAvatarOnly(nextAvatarOnly);
    }
    if (options.syncState) {
      setThreadListWidth(nextWidth);
      setThreadListMaxWidth(nextMaxWidth);
    }
    if (options.persist) window.localStorage.setItem(widthStorageKey, String(nextWidth));
    return nextWidth;
  }, [getAvailablePaneWidth, widthStorageKey]);

  useEffect(() => {
    applyThreadListWidth(
      parseStoredGmailThreadListWidth(window.localStorage.getItem(widthStorageKey)),
      { syncState: true },
    );
  }, [applyThreadListWidth, widthStorageKey]);

  useEffect(() => {
    const workbench = workbenchRef.current;
    if (!workbench || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      applyThreadListWidth(threadListWidthRef.current, { syncState: true });
    });
    observer.observe(workbench);
    return () => observer.disconnect();
  }, [applyThreadListWidth]);

  const finishThreadListResize = useCallback((pointerId?: number) => {
    if (pointerId !== undefined && resizingPointerIdRef.current !== pointerId) return;
    resizingPointerIdRef.current = null;
    setResizingThreadList(false);
    setThreadListWidth(threadListWidthRef.current);
    window.localStorage.setItem(widthStorageKey, String(threadListWidthRef.current));
    document.body.style.cursor = bodyCursorRef.current;
    document.body.style.userSelect = bodyUserSelectRef.current;
  }, [widthStorageKey]);

  useEffect(() => () => {
    if (resizingPointerIdRef.current !== null) finishThreadListResize();
  }, [finishThreadListResize]);

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    resizingPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    bodyCursorRef.current = document.body.style.cursor;
    bodyUserSelectRef.current = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setResizingThreadList(true);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizingPointerIdRef.current !== event.pointerId || !threadListRef.current) return;
    applyThreadListWidth(event.clientX - threadListRef.current.getBoundingClientRect().left);
  };

  const handleResizePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizingPointerIdRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    finishThreadListResize(event.pointerId);
  };

  const toggleThreadListWidth = () => {
    applyThreadListWidth(
      getGmailThreadListDoubleClickWidth(threadListWidthRef.current),
      { persist: true, syncState: true },
    );
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const nextWidth = event.key === 'ArrowLeft'
      ? threadListWidthRef.current - step
      : event.key === 'ArrowRight'
        ? threadListWidthRef.current + step
        : event.key === 'Home'
          ? GMAIL_THREAD_LIST_MIN_WIDTH
          : event.key === 'Enter'
            ? GMAIL_THREAD_LIST_DEFAULT_WIDTH
            : null;
    if (nextWidth === null) return;
    event.preventDefault();
    applyThreadListWidth(nextWidth, { persist: true, syncState: true });
  };

  const loadThreads = useCallback(async () => {
    const requestAccountScope = getAccountCacheScope();
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    const cacheKey = getCacheKey(account.mailAccountId, mailbox, search, page);
    const cached = tencentThreadListCache.get(cacheKey);
    if (cached) {
      setThreads(cached.data.threads);
      setTotal(cached.data.total);
      setHasNextPage(cached.data.hasNextPage);
      setShowingCachedData(true);
    } else {
      setThreads([]);
      setTotal(0);
      setHasNextPage(false);
      setShowingCachedData(false);
    }
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        mailAccountId: account.mailAccountId,
        view: mailbox,
        q: search,
        page: String(page),
        maxResults: String(PAGE_SIZE),
      });
      const response = await fetch(`/api/mail/tencent?${params.toString()}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({})) as {
        success?: boolean;
        data?: Partial<TencentThreadListData>;
        error?: string;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '读取腾讯企业邮箱失败。');
      }
      if (runId !== runIdRef.current) return;
      const data: TencentThreadListData = {
        threads: result.data?.threads || [],
        page: result.data?.page ?? page,
        hasNextPage: Boolean(result.data?.hasNextPage),
        total: result.data?.total || 0,
      };
      tencentThreadListCache.set(cacheKey, { data, cachedAt: Date.now() });
      setThreads(data.threads);
      if (page === 0 && !search.trim() && (mailbox === 'inbox' || mailbox === 'unread')) {
        publishInboxMailSnapshot({
          accountScope: requestAccountScope, provider: 'tencent_exmail',
          mailAccountId: account.mailAccountId, mailAddress: account.email, threads: data.threads,
          loadThread: async (_thread, message) => {
            if (!message?.folderRef || !message.providerMessageRef) throw new Error('缺少邮件定位信息。');
            const params = new URLSearchParams({ action: 'thread', mailAccountId: account.mailAccountId,
              folder: message.folderRef, uid: message.providerMessageRef });
            const response = await fetch(`/api/mail/tencent?${params}`, { cache: 'no-store' });
            const result = await response.json();
            if (!response.ok || !result.success || !result.data) throw new Error('预翻译读取正文失败。');
            return result.data as GmailThread;
          },
        });
      }
      setTotal(data.total);
      setHasNextPage(data.hasNextPage);
      setShowingCachedData(false);
    } catch (caughtError) {
      if (runId !== runIdRef.current) return;
      setError(caughtError instanceof Error ? caughtError.message : '读取腾讯企业邮箱失败。');
      setShowingCachedData(Boolean(cached));
    } finally {
      if (runId === runIdRef.current) setLoading(false);
    }
  }, [account.mailAccountId, account.email, mailbox, page, search]);

  useEffect(() => {
    if (!active) return undefined;
    void loadThreads();
    return () => {
      runIdRef.current += 1;
    };
  }, [active, loadThreads]);

  useEffect(() => {
    if (!active) setShowNewEmail(false);
  }, [active]);

  const beginThreadDetailRequest = useCallback(() => {
    detailAbortControllerRef.current?.abort();
    const controller = new AbortController();
    const runId = detailRunIdRef.current + 1;
    detailRunIdRef.current = runId;
    detailAbortControllerRef.current = controller;
    return { controller, runId };
  }, []);

  const cancelThreadDetailRequest = useCallback(() => {
    if (detailAbortControllerRef.current && pendingNavigationRequestRef.current) handledOpenRequestRef.current = 0;
    detailAbortControllerRef.current?.abort();
    detailAbortControllerRef.current = null;
    detailRunIdRef.current += 1;
    setDetailLoading(false);
  }, []);

  useEffect(() => {
    if (active && detailExpanded && !showSettings) return;
    cancelThreadDetailRequest();
  }, [active, cancelThreadDetailRequest, detailExpanded, showSettings]);

  useEffect(() => () => {
    handledOpenRequestRef.current = 0;
    detailAbortControllerRef.current?.abort();
    detailAbortControllerRef.current = null;
    detailRunIdRef.current += 1;
  }, []);

  const loadThreadDetail = useCallback(async (
    folderRef: string,
    providerMessageRef: string,
    options: { forceRefresh?: boolean; rfcMessageId?: string; signal?: AbortSignal } = {},
  ) => {
    const params = new URLSearchParams({
      action: 'thread',
      mailAccountId: account.mailAccountId,
      folder: folderRef,
      uid: providerMessageRef,
    });
    if (options.forceRefresh) params.set('forceRefresh', '1');
    if (options.rfcMessageId) params.set('rfcMessageId', options.rfcMessageId);
    const response = await fetch(`/api/mail/tencent?${params.toString()}`, {
      cache: 'no-store',
      signal: options.signal,
    });
    const result = await response.json().catch(() => ({})) as {
      success?: boolean;
      data?: GmailThread;
      error?: string;
    };
    if (!response.ok || !result.success || !result.data) {
      throw new Error(result.error || '读取邮件会话失败。');
    }
    return result.data;
  }, [account.mailAccountId]);

  const applyTencentReadResultsLocally = useCallback((
    sourceThread: GmailThread,
    succeededMessageIds: string[],
  ) => {
    const sourceAccountId = sourceThread.mailAccountId || account.mailAccountId;
    if (accountIdRef.current !== sourceAccountId || !succeededMessageIds.length) return;
    const messageIds = new Set(succeededMessageIds);
    const matchesThread = (thread: GmailThread) => (
      thread.mailAccountId === sourceAccountId
      && (thread.id === sourceThread.id || threadContainsAnyMessage(thread, messageIds))
    );
    const currentListThread = threadsRef.current.find(matchesThread);
    const removeFromUnread = Boolean(
      currentListThread
      && mailboxRef.current === 'unread'
      && !setMailMessagesReadState(currentListThread, messageIds, true).hasUnread,
    );

    setThreads((current) => {
      const updated = current.map((thread) => matchesThread(thread)
        ? setMailMessagesReadState(thread, messageIds, true)
        : thread);
      const next = mailboxRef.current === 'unread'
        ? updated.filter((thread) => !matchesThread(thread) || thread.hasUnread)
        : updated;
      threadsRef.current = next;
      return next;
    });
    if (removeFromUnread) setTotal((current) => Math.max(0, current - 1));
    setSelectedThread((current) => {
      if (!current || !matchesThread(current)) return current;
      return setMailMessagesReadState(current, messageIds, true);
    });
    invalidateTencentThreadListCaches(sourceAccountId);
  }, [account.mailAccountId]);

  const markTencentThreadReadAfterContentReady = useCallback((
    thread: GmailThread,
    runId: number,
    controller: AbortController,
  ) => {
    const sourceAccountId = thread.mailAccountId || account.mailAccountId;
    if (
      controller.signal.aborted
      || detailRunIdRef.current !== runId
      || accountIdRef.current !== sourceAccountId
    ) {
      return Promise.resolve();
    }
    const { targets, unresolvedMessageIds } = collectUnreadMailTargets(thread);
    if (!targets.length) {
      if (unresolvedMessageIds.length) {
        setError('部分邮件缺少定位信息，暂时无法自动标记为已读。');
      }
      return Promise.resolve();
    }
    const requestKey = `${sourceAccountId}:${thread.id}`;
    const existing = automaticReadRequestsRef.current.get(requestKey);
    if (existing) return existing;

    const request = (async () => {
      const results = await Promise.allSettled(
        targets.map((target) => markTencentMessageRead(sourceAccountId, target)),
      );
      if (accountIdRef.current !== sourceAccountId) return;
      const succeededMessageIds = targets
        .filter((_, index) => results[index]?.status === 'fulfilled')
        .map((target) => target.messageId);
      applyTencentReadResultsLocally(thread, succeededMessageIds);
      const failedCount = results.length - succeededMessageIds.length + unresolvedMessageIds.length;
      if (failedCount > 0) {
        setError('部分邮件未能标记为已读，可点击信封按钮重试。');
      }
    })();
    automaticReadRequestsRef.current.set(requestKey, request);
    void request.finally(() => {
      if (automaticReadRequestsRef.current.get(requestKey) === request) {
        automaticReadRequestsRef.current.delete(requestKey);
      }
    });
    return request;
  }, [account.mailAccountId, applyTencentReadResultsLocally]);

  const openThread = useCallback(async (thread: GmailThread) => {
    pendingNavigationRequestRef.current = false;
    const message = getThreadMessage(thread);
    if (!message?.folderRef || !message.providerMessageRef) return;
    const { controller, runId } = beginThreadDetailRequest();
    setSelection((current) => ({ id: current.id + 1 }));
    setSelectedThread(thread);
    setShowSettings(false);
    setDetailExpanded(true);
    setDetailLoading(true);
    setDetailError(undefined);
    try {
      const detailedThread = await loadThreadDetail(message.folderRef, message.providerMessageRef, {
        rfcMessageId: message.rfcMessageId,
        signal: controller.signal,
      });
      if (controller.signal.aborted || detailRunIdRef.current !== runId) return;
      const editableDraft = getEditableMailDraft(
        detailedThread,
        'tencent_exmail',
        account.mailAccountId,
      );
      if (editableDraft) {
        setEditDraft(editableDraft);
        setShowNewEmail(true);
        setSelectedThread(null);
        setDetailExpanded(false);
      } else {
        setSelectedThread(detailedThread);
        void markTencentThreadReadAfterContentReady(detailedThread, runId, controller);
      }
    } catch (caughtError) {
      if (controller.signal.aborted || detailRunIdRef.current !== runId) return;
      setDetailError(caughtError instanceof Error ? caughtError.message : '读取邮件会话失败。');
    } finally {
      if (detailRunIdRef.current === runId) {
        detailAbortControllerRef.current = null;
        setDetailLoading(false);
      }
    }
  }, [account.mailAccountId, beginThreadDetailRequest, loadThreadDetail, markTencentThreadReadAfterContentReady]);

  useEffect(() => {
    if (!active || !openMessageRequest || openMessageRequest.mailAccountId !== account.mailAccountId
      || handledOpenRequestRef.current === openMessageRequest.requestId) return;
    pendingNavigationRequestRef.current = true;
    handledOpenRequestRef.current = openMessageRequest.requestId;
    setSelection((current) => ({ id: current.id + 1, request: openMessageRequest }));
    const preview = openMessageRequest.previewThread;
    setSelectedThread(preview?.provider === 'tencent_exmail' && preview.mailAccountId === account.mailAccountId
      && preview.messages.some((message) => message.folderRef === openMessageRequest.folderRef
        && message.providerMessageRef === openMessageRequest.providerMessageRef) ? preview : null);
    const { controller, runId } = beginThreadDetailRequest();
    setShowSettings(false);
    setDetailExpanded(true);
    setDetailLoading(true);
    setDetailError(undefined);
    void loadThreadDetail(openMessageRequest.folderRef, openMessageRequest.providerMessageRef, {
      rfcMessageId: openMessageRequest.rfcMessageId,
      signal: controller.signal,
    })
      .then((detailedThread) => {
        if (controller.signal.aborted || detailRunIdRef.current !== runId) return;
        const editableDraft = getEditableMailDraft(
          detailedThread,
          'tencent_exmail',
          account.mailAccountId,
        );
        if (editableDraft) {
          setEditDraft(editableDraft);
          setShowNewEmail(true);
          setSelectedThread(null);
          setDetailExpanded(false);
          return;
        }
        setSelectedThread(detailedThread);
        void markTencentThreadReadAfterContentReady(detailedThread, runId, controller);
      })
      .catch((caughtError) => {
        if (controller.signal.aborted || detailRunIdRef.current !== runId) return;
        setDetailError(caughtError instanceof Error ? caughtError.message : '读取邮件会话失败。');
      })
      .finally(() => {
        if (detailRunIdRef.current === runId) {
          detailAbortControllerRef.current = null;
          setDetailLoading(false);
        }
      });
  }, [account.mailAccountId, active, beginThreadDetailRequest, loadThreadDetail, markTencentThreadReadAfterContentReady, openMessageRequest]);

  const refreshMailbox = useCallback(() => {
    void loadThreads();
    const message = selectedThread ? getThreadMessage(selectedThread) : null;
    if (!message?.folderRef || !message.providerMessageRef) return;
    const { controller, runId } = beginThreadDetailRequest();
    setDetailLoading(true);
    setDetailError(undefined);
    void loadThreadDetail(message.folderRef, message.providerMessageRef, {
      forceRefresh: true,
      rfcMessageId: message.rfcMessageId,
      signal: controller.signal,
    })
      .then((thread) => {
        if (controller.signal.aborted || detailRunIdRef.current !== runId) return;
        setSelectedThread(thread);
      })
      .catch((caughtError) => {
        if (controller.signal.aborted || detailRunIdRef.current !== runId) return;
        setDetailError(caughtError instanceof Error ? caughtError.message : '刷新邮件会话失败。');
      })
      .finally(() => {
        if (detailRunIdRef.current === runId) {
          detailAbortControllerRef.current = null;
          setDetailLoading(false);
        }
      });
  }, [beginThreadDetailRequest, loadThreadDetail, loadThreads, selectedThread]);

  const updateFlags = async (thread: GmailThread, update: { read?: boolean; starred?: boolean }) => {
    const message = getThreadMessage(thread);
    if (!message?.folderRef || !message.providerMessageRef) return;
    setActionThreadId(thread.id);
    setError('');
    try {
      if (update.read !== undefined) {
        const accountPrefix = `${account.mailAccountId}:`;
        const pendingReadRequests = Array.from(automaticReadRequestsRef.current.entries())
          .filter(([key]) => key.startsWith(accountPrefix))
          .map(([, request]) => request);
        await Promise.allSettled(pendingReadRequests);
      }
      const response = await fetch('/api/mail/tencent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'flags',
          mailAccountId: account.mailAccountId,
          folder: message.folderRef,
          uid: message.providerMessageRef,
          ...update,
        }),
      });
      const result = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
      if (!response.ok || !result.success) throw new Error(result.error || '更新邮件状态失败。');
      const targetMessageIds = new Set([message.id]);
      const matchesThread = (item: GmailThread) => (
        item.mailAccountId === account.mailAccountId
        && (item.id === thread.id || threadContainsAnyMessage(item, targetMessageIds))
      );
      const currentListThread = threadsRef.current.find(matchesThread);
      const removeFromUnread = Boolean(
        currentListThread
        && mailboxRef.current === 'unread'
        && !updateThreadMessage(currentListThread, message, update).hasUnread,
      );
      setThreads((current) => {
        const updated = current.map((item) => matchesThread(item)
          ? updateThreadMessage(item, message, update)
          : item);
        const next = mailboxRef.current === 'unread'
          ? updated.filter((item) => !matchesThread(item) || item.hasUnread)
          : updated;
        threadsRef.current = next;
        return next;
      });
      if (removeFromUnread) setTotal((current) => Math.max(0, current - 1));
      setSelectedThread((current) => {
        if (!current || !matchesThread(current)) return current;
        const currentMessage = current.messages.find((item) => item.id === message.id);
        if (!currentMessage) return current;
        return updateThreadMessage(current, currentMessage, update);
      });
      invalidateTencentThreadListCaches(account.mailAccountId);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '更新邮件状态失败。');
    } finally {
      setActionThreadId(null);
    }
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(0);
    setSearch(query.trim());
    setSelectedThread(null);
    setDetailExpanded(false);
  };

  const handleMailboxChange = (nextMailbox: GmailMailbox) => {
    setMailbox(nextMailbox);
    setPage(0);
    setSearch('');
    setQuery('');
    setSelectedThread(null);
    setDetailExpanded(false);
    setShowSettings(false);
  };

  const openComposerRequest = useMemo(() => {
    const openMessageRequest = selection.request;
    if (!openMessageRequest || !selectedThread) return undefined;
    const targetMessage = selectedThread.messages.find((message) => (
      message.folderRef === openMessageRequest.folderRef
      && message.providerMessageRef === openMessageRequest.providerMessageRef
    ));
    if (!targetMessage) return undefined;
    return {
      requestId: openMessageRequest.requestId,
      taskId: openMessageRequest.taskId,
      retryRequested: openMessageRequest.retryRequested,
      retryInput: openMessageRequest.retryInput,
      composerMode: openMessageRequest.composerMode,
      messageId: targetMessage.id,
      autoShowTranslation: openMessageRequest.autoShowTranslation,
    };
  }, [selection.request, selectedThread]);

  const unreadCount = threads.filter((thread) => thread.hasUnread).length;

  return (
    <div ref={workbenchRef} className="app-workbench flex h-full min-h-0 overflow-hidden rounded-xl [--gmail-thread-list-width:460px]">
      <aside className={`material-navigation hidden shrink-0 flex-col overflow-hidden py-3 transition-[width,opacity,padding,border-color] duration-[240ms] ease-out motion-reduce:transition-none md:flex ${detailExpanded ? 'w-0 border-r-0 border-transparent px-0 opacity-0 xl:w-44 xl:border-r xl:border-white/55 xl:px-3 xl:opacity-100' : 'w-44 border-r border-white/55 px-3 opacity-100'}`}>
        <div className="mb-3"><MailAccountSwitcher placement="mailbox-sidebar" onManage={onManageMailAccounts} /></div>
        <Button className="mb-3 h-11 w-full justify-start gap-3 rounded-lg px-3 shadow-apple" onClick={() => { setEditDraft(null); setShowNewEmail(true); }}>
          <FilePenLine className="h-4 w-4" />写信
        </Button>
        <nav className="space-y-1">
          {MAILBOXES.map(({ id, label, icon: Icon }) => (
            <Button key={id} variant={!showSettings && mailbox === id ? 'secondary' : 'ghost'} className={`h-10 w-full justify-start gap-3 rounded-lg px-3 font-normal ${!showSettings && mailbox === id ? 'bg-primary/[0.08] text-primary shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-white/72'}`} onClick={() => handleMailboxChange(id)}>
              <Icon className="h-4 w-4" />{label}
            </Button>
          ))}
        </nav>
        <div className="my-3 border-t border-white/60" />
        <Button variant={showSettings ? 'secondary' : 'ghost'} className={`h-10 w-full justify-start gap-3 rounded-lg px-3 font-normal ${showSettings ? 'bg-primary/[0.08] text-primary shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-white/72'}`} onClick={() => { setShowSettings(true); setDetailExpanded(false); setSelectedThread(null); }}>
          <Settings className="h-4 w-4" />设置
        </Button>
      </aside>

      {!showSettings && (
        <div ref={threadListRef} data-testid="tencent-thread-list-pane" data-avatar-only={detailExpanded && threadListAvatarOnly ? 'true' : 'false'} className={`material-content flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/55 motion-reduce:transition-none ${resizingThreadList ? 'transition-none' : 'transition-[flex-grow,flex-basis,opacity] duration-[240ms] ease-out'} ${detailExpanded ? 'pointer-events-none flex-[0_1_0%] opacity-0 lg:pointer-events-auto lg:flex-[0_0_var(--gmail-thread-list-width)] lg:opacity-100' : 'flex-[1_1_0%] opacity-100'}`}>
          <div className="material-toolbar flex shrink-0 gap-1 overflow-x-auto border-b border-border/55 p-2 md:hidden">
            <Button size="sm" className="shrink-0 gap-2 rounded-lg" onClick={() => { setEditDraft(null); setShowNewEmail(true); }}><FilePenLine className="h-4 w-4" />写信</Button>
            {MAILBOXES.map(({ id, label, icon: Icon }) => <Button key={id} variant={mailbox === id ? 'secondary' : 'ghost'} size="sm" className="shrink-0 gap-2 rounded-lg" onClick={() => handleMailboxChange(id)}><Icon className="h-4 w-4" />{label}</Button>)}
            <Button variant="ghost" size="sm" className="shrink-0 gap-2 rounded-lg" onClick={() => { setShowSettings(true); setDetailExpanded(false); setSelectedThread(null); }}><Settings className="h-4 w-4" />设置</Button>
          </div>

          {!threadListAvatarOnly && (
            <>
              <div className="material-toolbar flex shrink-0 items-center justify-between border-b border-border/55 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="section-title truncate">{search ? '全邮箱搜索结果' : MAILBOXES.find((item) => item.id === mailbox)?.label}</h2>
                    {(mailbox === 'inbox' || mailbox === 'unread') && <span className="rounded-md bg-white/80 px-2 py-0.5 text-xs text-muted-foreground">{unreadCount} 未读</span>}
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">腾讯企业邮箱 · {account.email}{showingCachedData ? ' · 当前显示安全缓存' : ''}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={refreshMailbox} disabled={loading || detailLoading} title="刷新"><RefreshCw className={`h-4 w-4 ${loading || detailLoading ? 'animate-spin' : ''}`} /></Button>
              </div>
              <form onSubmit={handleSearch} className="material-toolbar shrink-0 border-b border-border/55 px-3 py-2">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="搜索全部邮件（发件人、收件人、主题或正文）" value={query} onChange={(event) => setQuery(event.target.value)} className="glass-control h-10 border-0 pl-9 pr-20" />
                  {query && <button type="button" onClick={() => { setQuery(''); setSearch(''); setPage(0); }} className="absolute right-2 top-2 h-6 rounded px-2 text-xs text-muted-foreground hover:bg-white/80">清空</button>}
                </div>
                <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
                  <span>{search ? `正在搜索“${search}”` : '搜索覆盖收件箱、已发送和草稿'}</span>
                  <Button type="submit" size="sm" className="h-7 rounded-md px-3 text-xs"><Search className="mr-1 h-3.5 w-3.5" />搜索</Button>
                </div>
              </form>
            </>
          )}

          {error && <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs text-amber-800"><span className="min-w-0 truncate">{error}{showingCachedData ? '；已保留这个邮箱上次成功读取的内容。' : ''}</span><Button variant="ghost" size="sm" className="h-6 shrink-0 px-2 text-xs" onClick={() => void loadThreads()}>重试</Button></div>}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && !threads.length && <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取邮件…</div>}
            {!loading && !threads.length && !error && <div className="p-8 text-center text-sm text-muted-foreground">{search ? '没有找到匹配邮件' : '当前文件夹没有邮件'}</div>}
            {threads.map((thread) => {
              const message = getThreadMessage(thread);
              const sender = displaySender(message?.from || '');
              const actionLoading = actionThreadId === thread.id;
              const selected = selectedThread?.id === thread.id
                || Boolean(selectedThread && thread.messages.some((item) => (
                  selectedThread.messages.some((selectedMessage) => selectedMessage.id === item.id)
                )));
              const {
                visuallyUnread,
                showSelectedIndicator,
                showSelectedReadBackground,
              } = getMailThreadRowVisualState(thread.hasUnread, selected);
              const rowBackgroundClass = visuallyUnread
                ? 'bg-primary/[0.055] hover:bg-primary/[0.075]'
                : `${showSelectedReadBackground ? '!bg-white ' : ''}hover:bg-white/82`;
              if (threadListAvatarOnly) {
                return <button key={thread.id} type="button" title={`${sender} · ${thread.subject || '(无主题)'}`} onClick={() => void openThread(thread)} className={`flex w-full items-center justify-center border-b border-border/45 py-3 outline-none ${showSelectedIndicator ? 'shadow-[inset_2px_0_0_var(--primary)]' : ''} ${rowBackgroundClass}`}><span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${visuallyUnread ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{sender.slice(0, 1).toUpperCase()}</span></button>;
              }
              return (
                <div key={thread.id} role="button" tabIndex={0} onClick={() => void openThread(thread)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void openThread(thread); } }} className={`glass-list-row group cursor-pointer border-b border-border/45 px-3 py-2.5 outline-none transition-colors ${showSelectedIndicator ? 'shadow-[inset_2px_0_0_var(--primary)]' : ''} ${rowBackgroundClass}`}>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="icon" className="mt-0.5 h-8 w-8 shrink-0 rounded-lg" title={thread.isStarred ? '取消星标' : '标星'} disabled={actionLoading} onClick={(event) => { event.stopPropagation(); void updateFlags(thread, { starred: !thread.isStarred }); }}><Star className={`h-4 w-4 ${thread.isStarred ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} /></Button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2"><span className={`min-w-0 truncate text-sm ${visuallyUnread ? 'font-semibold' : 'text-muted-foreground'}`}>{sender}</span><span className="shrink-0 text-xs text-muted-foreground">{formatDate(message?.date || thread.lastMessageDate)}</span></div>
                      <p className={`mt-0.5 truncate text-sm ${visuallyUnread ? 'font-semibold' : ''}`}>{thread.subject || '(无主题)'}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{message?.snippet || thread.snippet || '打开查看正文'}</p>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg opacity-70 group-hover:opacity-100" title={thread.hasUnread ? '标记为已读' : '标记为未读'} disabled={actionLoading} onClick={(event) => { event.stopPropagation(); void updateFlags(thread, { read: thread.hasUnread }); }}>{actionLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : thread.hasUnread ? <MailOpen className="h-4 w-4" /> : <Mail className="h-4 w-4" />}</Button>
                  </div>
                </div>
              );
            })}
          </div>

          {!threadListAvatarOnly && <div className="flex shrink-0 items-center justify-between border-t border-white/55 bg-white/55 px-3 py-2 text-xs text-muted-foreground"><Button variant="outline" size="sm" className="h-8 gap-1 rounded-lg px-2 text-xs" disabled={loading || page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft className="h-3.5 w-3.5" />上一页</Button><span>第 {page + 1} 页 · 共 {total} 封</span><Button variant="outline" size="sm" className="h-8 gap-1 rounded-lg px-2 text-xs" disabled={loading || !hasNextPage} onClick={() => setPage((current) => current + 1)}>下一页<ChevronRight className="h-3.5 w-3.5" /></Button></div>}
        </div>
      )}

      {!showSettings && selectedThread && detailExpanded && <div ref={resizeHandleRef} role="separator" aria-label="调整邮件线程列表宽度，双击收缩，再次双击恢复默认宽度" aria-orientation="vertical" aria-valuemin={GMAIL_THREAD_LIST_MIN_WIDTH} aria-valuemax={threadListMaxWidth} aria-valuenow={threadListWidth} tabIndex={0} title="拖动调整邮件列表宽度；双击收缩，再次双击恢复默认宽度" data-testid="tencent-thread-list-resize-handle" className={`group relative z-20 -mx-1 hidden w-2 shrink-0 cursor-col-resize items-stretch justify-center outline-none lg:flex ${resizingThreadList ? 'bg-primary/10' : ''}`} onPointerDown={handleResizePointerDown} onPointerMove={handleResizePointerMove} onPointerUp={handleResizePointerEnd} onPointerCancel={handleResizePointerEnd} onDoubleClick={toggleThreadListWidth} onKeyDown={handleResizeKeyDown}><span className="w-px bg-border/70 transition-colors group-hover:bg-primary/70" /></div>}

      <div className={`material-reading min-h-0 min-w-0 flex-col overflow-hidden ${showSettings ? 'flex flex-[1_1_0%]' : selectedThread ? 'flex flex-[1_1_0%]' : 'hidden'}`}>
        {showSettings ? <GmailSignatureSettings onBack={() => setShowSettings(false)} mailAccount={account} /> : selectedThread ? <EmailDetail key={`${account.mailAccountId}:${selection.id}`} thread={selectedThread} loading={detailLoading} loadError={detailError} onBack={() => { setDetailExpanded(false); setSelectedThread(null); setDetailError(undefined); }} onThreadUpdated={(updatedThread) => { const updatedMessageIds = new Set(updatedThread.messages.map((message) => message.id)); setSelectedThread(updatedThread); setThreads((current) => current.map((thread) => thread.mailAccountId === updatedThread.mailAccountId && (thread.id === updatedThread.id || threadContainsAnyMessage(thread, updatedMessageIds)) ? copyMailThreadReadState(thread, updatedThread) : thread)); }} openComposerRequest={openComposerRequest} mailAccount={account} /> : null}
      </div>

      <NewEmailComposer
        open={showNewEmail}
        onOpenChange={(nextOpen) => {
          setShowNewEmail(nextOpen);
          if (!nextOpen) setEditDraft(null);
        }}
        onDraftSaved={() => { setMailbox('drafts'); setPage(0); setSearch(''); setQuery(''); setShowSettings(false); setDetailExpanded(false); setSelectedThread(null); tencentThreadListCache.delete(getCacheKey(account.mailAccountId, 'drafts', '', 0)); }}
        mailAccount={account}
        initialSubject={editDraft?.subject}
        initialContent={editDraft?.content}
        editDraft={editDraft}
        title={editDraft ? '编辑腾讯企业邮箱草稿' : '通过腾讯企业邮箱写信'}
        description={editDraft ? `修改后会更新 ${account.email} 中的原草稿，不会另建一封` : `发件邮箱：${account.email}。发送前会再次确认。`}
      />
    </div>
  );
}
