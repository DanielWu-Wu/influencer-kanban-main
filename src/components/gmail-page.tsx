'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { FilePenLine, FileText, Inbox, Mail, MailOpen, Send, Settings, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GmailCategory, GmailMailbox, GmailThread } from '@/lib/types';
import { EmailDetail } from './email-detail';
import { GmailInbox } from './gmail-inbox';
import { GmailSignatureSettings } from './gmail-signature-settings';
import { NewEmailComposer } from './new-email-composer';
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
  scopedLocalStorageKey,
} from '@/lib/account-cache-scope';

const MAILBOXES: Array<{
  id: GmailMailbox;
  label: string;
  icon: typeof Inbox;
}> = [
  { id: 'inbox', label: '\u6536\u4ef6\u7bb1', icon: Inbox },
  { id: 'unread', label: '\u672a\u8bfb\u90ae\u4ef6', icon: MailOpen },
  { id: 'starred', label: '\u5df2\u6807\u661f', icon: Star },
  { id: 'sent', label: '\u5df2\u53d1\u9001', icon: Send },
  { id: 'drafts', label: '\u8349\u7a3f', icon: FileText },
];

const DETAIL_TRANSITION_MS = 240;
const GMAIL_THREAD_LIST_WIDTH_STORAGE_KEY = 'gmail-thread-list-width-v1';

export type GmailThreadOpenRequest = {
  threadId: string;
  requestId: number;
  taskId?: string;
  retryRequested?: boolean;
  retryInput?: unknown;
  messageId?: string;
  composerMode?: 'ai' | 'template';
};

export function GmailPage({
  active = true,
  openThreadRequest,
}: {
  active?: boolean;
  openThreadRequest?: GmailThreadOpenRequest;
}) {
  const [selectedThread, setSelectedThread] = useState<GmailThread | null>(null);
  const [mailbox, setMailbox] = useState<GmailMailbox>('inbox');
  const [category, setCategory] = useState<GmailCategory>('primary');
  const [showSettings, setShowSettings] = useState(false);
  const [showNewEmail, setShowNewEmail] = useState(false);
  const [mailboxRefreshKey, setMailboxRefreshKey] = useState(0);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [threadLoadState, setThreadLoadState] = useState<{
    threadId: string;
    loading: boolean;
    error?: string;
  } | null>(null);
  const closeDetailTimerRef = useRef<number | null>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const threadListRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const resizingPointerIdRef = useRef<number | null>(null);
  const threadListWidthRef = useRef(GMAIL_THREAD_LIST_DEFAULT_WIDTH);
  const threadListAvatarOnlyRef = useRef(false);
  const bodyCursorRef = useRef('');
  const bodyUserSelectRef = useRef('');
  const [threadListWidth, setThreadListWidth] = useState(GMAIL_THREAD_LIST_DEFAULT_WIDTH);
  const [threadListMaxWidth, setThreadListMaxWidth] = useState(GMAIL_THREAD_LIST_DEFAULT_WIDTH);
  const [threadListAvatarOnly, setThreadListAvatarOnly] = useState(false);
  const [resizingThreadList, setResizingThreadList] = useState(false);

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
    if (options.persist) {
      window.localStorage.setItem(
        scopedLocalStorageKey(GMAIL_THREAD_LIST_WIDTH_STORAGE_KEY),
        String(nextWidth),
      );
    }
    return nextWidth;
  }, [getAvailablePaneWidth]);

  const finishThreadListResize = useCallback((pointerId?: number) => {
    if (pointerId !== undefined && resizingPointerIdRef.current !== pointerId) return;
    resizingPointerIdRef.current = null;
    setResizingThreadList(false);
    setThreadListWidth(threadListWidthRef.current);
    window.localStorage.setItem(
      scopedLocalStorageKey(GMAIL_THREAD_LIST_WIDTH_STORAGE_KEY),
      String(threadListWidthRef.current),
    );
    document.body.style.cursor = bodyCursorRef.current;
    document.body.style.userSelect = bodyUserSelectRef.current;
  }, []);

  useEffect(() => {
    const restoreSavedWidth = () => {
      const savedWidth = parseStoredGmailThreadListWidth(
        window.localStorage.getItem(scopedLocalStorageKey(GMAIL_THREAD_LIST_WIDTH_STORAGE_KEY)),
      );
      applyThreadListWidth(savedWidth, { syncState: true });
    };
    restoreSavedWidth();
    window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, restoreSavedWidth);
    return () => window.removeEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, restoreSavedWidth);
  }, [applyThreadListWidth]);

  useEffect(() => {
    const workbench = workbenchRef.current;
    if (!workbench || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      applyThreadListWidth(threadListWidthRef.current, { syncState: true });
    });
    observer.observe(workbench);
    return () => observer.disconnect();
  }, [applyThreadListWidth]);

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
    const left = threadListRef.current.getBoundingClientRect().left;
    applyThreadListWidth(event.clientX - left);
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
    let nextWidth: number | null = null;
    if (event.key === 'ArrowLeft') nextWidth = threadListWidthRef.current - step;
    if (event.key === 'ArrowRight') nextWidth = threadListWidthRef.current + step;
    if (event.key === 'Home') nextWidth = GMAIL_THREAD_LIST_MIN_WIDTH;
    if (event.key === 'Enter') nextWidth = GMAIL_THREAD_LIST_DEFAULT_WIDTH;
    if (nextWidth === null) return;
    event.preventDefault();
    applyThreadListWidth(nextWidth, { persist: true, syncState: true });
  };

  useEffect(() => {
    if (!active) setShowNewEmail(false);
  }, [active]);

  useEffect(() => {
    if (!active || !openThreadRequest) return;
    setMailbox('inbox');
    setCategory('primary');
    setShowSettings(false);
    setShowNewEmail(false);
  }, [active, openThreadRequest]);

  useEffect(() => () => {
    if (closeDetailTimerRef.current !== null) {
      window.clearTimeout(closeDetailTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (
      !selectedThread
      || showSettings
      || detailExpanded
      || closeDetailTimerRef.current !== null
    ) return undefined;
    const frame = window.requestAnimationFrame(() => setDetailExpanded(true));
    return () => window.cancelAnimationFrame(frame);
  }, [detailExpanded, selectedThread, showSettings]);

  const handleSelectThread = (thread: GmailThread) => {
    if (closeDetailTimerRef.current !== null) {
      window.clearTimeout(closeDetailTimerRef.current);
      closeDetailTimerRef.current = null;
    }
    setSelectedThread(thread);
    setShowSettings(false);
    setDetailExpanded(true);
  };

  const handleCloseThread = () => {
    if (!selectedThread || closeDetailTimerRef.current !== null) return;
    setDetailExpanded(false);
    closeDetailTimerRef.current = window.setTimeout(() => {
      setSelectedThread(null);
      setThreadLoadState(null);
      closeDetailTimerRef.current = null;
    }, DETAIL_TRANSITION_MS);
  };

  const handleMailboxChange = (nextMailbox: GmailMailbox) => {
    setMailbox(nextMailbox);
    setDetailExpanded(false);
    setSelectedThread(null);
    setThreadLoadState(null);
    setShowSettings(false);
  };

  return (
    <div
      ref={workbenchRef}
      className="app-workbench flex h-full min-h-0 overflow-hidden rounded-xl [--gmail-thread-list-width:460px]"
    >
      <aside className={`material-navigation hidden shrink-0 flex-col overflow-hidden py-3 transition-[width,opacity,padding,border-color] duration-[240ms] ease-out motion-reduce:transition-none md:flex ${
        detailExpanded
          ? 'w-0 border-r-0 border-transparent px-0 opacity-0 xl:w-44 xl:border-r xl:border-white/55 xl:px-3 xl:opacity-100'
          : 'w-44 border-r border-white/55 px-3 opacity-100'
      }`}>
        <div className="mb-3 flex items-center gap-2 px-2 text-sm font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-red-100/80 bg-red-50/85 text-red-600 shadow-sm">
            <Mail className="h-4 w-4" />
          </span>
          <span>Gmail</span>
        </div>
        <Button
          className="mb-3 h-11 w-full justify-start gap-3 rounded-lg px-3 shadow-apple"
          onClick={() => setShowNewEmail(true)}
        >
          <FilePenLine className="h-4 w-4" />
          写信
        </Button>
        <nav className="space-y-1">
          {MAILBOXES.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={mailbox === id ? 'secondary' : 'ghost'}
              className={`h-10 w-full justify-start gap-3 rounded-lg px-3 font-normal ${
                mailbox === id ? 'bg-primary/[0.08] text-primary shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-white/72'
              }`}
              onClick={() => handleMailboxChange(id)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </nav>
        <div className="my-3 border-t border-white/60" />
        <Button
          variant={showSettings ? 'secondary' : 'ghost'}
          className={`h-10 w-full justify-start gap-3 rounded-lg px-3 font-normal ${
            showSettings ? 'bg-primary/[0.08] text-primary shadow-[inset_2px_0_0_var(--primary)]' : 'hover:bg-white/72'
          }`}
          onClick={() => {
            setShowSettings(true);
            setDetailExpanded(false);
            setSelectedThread(null);
            setThreadLoadState(null);
          }}
        >
          <Settings className="h-4 w-4" />
          设置
        </Button>
      </aside>

      {!showSettings && (
      <div
        ref={threadListRef}
        data-testid="gmail-thread-list-pane"
        data-avatar-only={detailExpanded && threadListAvatarOnly ? 'true' : 'false'}
        className={`material-content flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/55 motion-reduce:transition-none ${
          resizingThreadList
            ? 'transition-none'
            : 'transition-[flex-grow,flex-basis,opacity] duration-[240ms] ease-out'
        } ${
          detailExpanded
            ? 'pointer-events-none flex-[0_1_0%] opacity-0 lg:pointer-events-auto lg:flex-[0_0_var(--gmail-thread-list-width)] lg:opacity-100'
            : 'flex-[1_1_0%] opacity-100'
        }`}
      >
        <div className="material-toolbar flex shrink-0 gap-1 overflow-x-auto border-b border-border/55 p-2 md:hidden">
          <Button
            size="sm"
            className="shrink-0 gap-2 rounded-lg"
            onClick={() => setShowNewEmail(true)}
          >
            <FilePenLine className="h-4 w-4" />
            写信
          </Button>
          {MAILBOXES.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={mailbox === id ? 'secondary' : 'ghost'}
              size="sm"
              className="shrink-0 gap-2 rounded-lg"
              onClick={() => handleMailboxChange(id)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
          <Button
            variant={showSettings ? 'secondary' : 'ghost'}
            size="sm"
            className="shrink-0 gap-2 rounded-lg"
            onClick={() => {
              setShowSettings(true);
              setDetailExpanded(false);
              setSelectedThread(null);
              setThreadLoadState(null);
            }}
          >
            <Settings className="h-4 w-4" />
            设置
          </Button>
        </div>
        <GmailInbox
          active={active}
          onSelectThread={handleSelectThread}
          onThreadLoadStateChange={(threadId, state) => {
            setThreadLoadState({ threadId, ...state });
          }}
          selectedThreadId={selectedThread?.id}
          threadDetailVisible={!showSettings && Boolean(selectedThread) && detailExpanded}
          mailbox={mailbox}
          category={category}
          refreshKey={mailboxRefreshKey}
          compact={detailExpanded}
          avatarOnly={detailExpanded && threadListAvatarOnly}
          onCategoryChange={setCategory}
          updatedThread={selectedThread}
          openThreadRequest={mailbox === 'inbox' && category === 'primary' && !showSettings
            ? openThreadRequest
            : undefined}
          onThreadUpdated={(thread) => {
            setSelectedThread((current) => current?.id === thread.id ? thread : current);
          }}
        />
      </div>
      )}

      {!showSettings && selectedThread && detailExpanded && (
        <div
          ref={resizeHandleRef}
          role="separator"
          aria-label="调整邮件线程列表宽度，双击收缩，再次双击恢复默认宽度"
          aria-orientation="vertical"
          aria-valuemin={GMAIL_THREAD_LIST_MIN_WIDTH}
          aria-valuemax={threadListMaxWidth}
          aria-valuenow={threadListWidth}
          tabIndex={0}
          title="拖动调整邮件列表宽度；双击收缩，再次双击恢复默认宽度"
          data-testid="gmail-thread-list-resize-handle"
          className={`group relative z-20 -mx-1 hidden w-2 shrink-0 cursor-col-resize items-stretch justify-center outline-none lg:flex ${
            resizingThreadList ? 'bg-primary/10' : ''
          }`}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onDoubleClick={toggleThreadListWidth}
          onKeyDown={handleResizeKeyDown}
        >
          <span className="w-px bg-border/70 transition-colors duration-150 group-hover:bg-primary/70 group-focus-visible:w-0.5 group-focus-visible:bg-primary motion-reduce:transition-none" />
        </div>
      )}

      <div className={`material-reading min-h-0 min-w-0 flex-col overflow-hidden ${
        showSettings
          ? 'flex flex-[1_1_0%]'
          : selectedThread
            ? `flex transition-[flex-grow,flex-basis,opacity,transform] duration-[240ms] ease-out motion-reduce:transition-none ${
                detailExpanded
                  ? 'flex-[1_1_0%] translate-x-0 opacity-100'
                  : 'pointer-events-none flex-[0_1_0%] translate-x-5 opacity-0'
              }`
            : 'hidden'
      }`}>
        {showSettings ? (
          <GmailSignatureSettings onBack={() => setShowSettings(false)} />
        ) : selectedThread ? (
          <EmailDetail
            key={selectedThread.id}
            thread={selectedThread}
            loading={threadLoadState?.threadId === selectedThread.id && threadLoadState.loading}
            loadError={threadLoadState?.threadId === selectedThread.id
              ? threadLoadState.error
              : undefined}
            onBack={handleCloseThread}
            onThreadUpdated={setSelectedThread}
            openComposerRequest={openThreadRequest?.threadId === selectedThread.id
              ? openThreadRequest
              : undefined}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-lg border border-white/70 bg-white/70 shadow-apple">
              <Mail className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">{'\u9009\u62e9\u4e00\u5c01\u90ae\u4ef6'}</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {'\u4ece\u5de6\u4fa7\u9009\u62e9\u90ae\u4ef6\u5bf9\u8bdd\uff0c\u67e5\u770b\u8be6\u60c5\u6216\u4f7f\u7528 AI \u8f85\u52a9\u56de\u590d'}
            </p>
          </div>
        )}
      </div>
      <NewEmailComposer
        open={showNewEmail}
        onOpenChange={setShowNewEmail}
        onDraftSaved={() => {
          setMailbox('drafts');
          setDetailExpanded(false);
          setSelectedThread(null);
          setShowSettings(false);
          setMailboxRefreshKey((current) => current + 1);
        }}
      />
    </div>
  );
}
