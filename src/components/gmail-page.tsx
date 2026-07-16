'use client';

import { useEffect, useRef, useState } from 'react';
import { FilePenLine, FileText, Inbox, Mail, MailOpen, Send, Settings, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GmailCategory, GmailMailbox, GmailThread } from '@/lib/types';
import { EmailDetail } from './email-detail';
import { GmailInbox } from './gmail-inbox';
import { GmailSignatureSettings } from './gmail-signature-settings';
import { NewEmailComposer } from './new-email-composer';

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

export function GmailPage({ active = true }: { active?: boolean }) {
  const [selectedThread, setSelectedThread] = useState<GmailThread | null>(null);
  const [mailbox, setMailbox] = useState<GmailMailbox>('inbox');
  const [category, setCategory] = useState<GmailCategory>('primary');
  const [showSettings, setShowSettings] = useState(false);
  const [showNewEmail, setShowNewEmail] = useState(false);
  const [mailboxRefreshKey, setMailboxRefreshKey] = useState(0);
  const [detailExpanded, setDetailExpanded] = useState(false);
  const closeDetailTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) setShowNewEmail(false);
  }, [active]);

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
  };

  const handleCloseThread = () => {
    if (!selectedThread || closeDetailTimerRef.current !== null) return;
    setDetailExpanded(false);
    closeDetailTimerRef.current = window.setTimeout(() => {
      setSelectedThread(null);
      closeDetailTimerRef.current = null;
    }, DETAIL_TRANSITION_MS);
  };

  const handleMailboxChange = (nextMailbox: GmailMailbox) => {
    setMailbox(nextMailbox);
    setDetailExpanded(false);
    setSelectedThread(null);
    setShowSettings(false);
  };

  return (
    <div className="glass-panel-strong flex h-full min-h-0 overflow-hidden rounded-lg">
      <aside className={`hidden shrink-0 flex-col overflow-hidden bg-white/45 py-3 backdrop-blur-xl transition-[width,opacity,padding,border-color] duration-[240ms] ease-out motion-reduce:transition-none md:flex ${
        detailExpanded
          ? 'w-0 border-r-0 border-transparent px-0 opacity-0 xl:w-44 xl:border-r xl:border-white/55 xl:px-3 xl:opacity-100'
          : 'w-44 border-r border-white/55 px-3 opacity-100'
      }`}>
        <div className="mb-3 flex items-center gap-2 px-2 text-sm font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 text-red-600">
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
                mailbox === id ? 'bg-white/80 shadow-sm' : 'hover:bg-white/70'
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
            showSettings ? 'bg-white/80 shadow-sm' : 'hover:bg-white/70'
          }`}
          onClick={() => {
            setShowSettings(true);
            setDetailExpanded(false);
            setSelectedThread(null);
          }}
        >
          <Settings className="h-4 w-4" />
          设置
        </Button>
      </aside>

      {!showSettings && (
      <div
        className={`flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-white/55 bg-white/50 transition-[flex-grow,flex-basis,opacity] duration-[240ms] ease-out motion-reduce:transition-none ${
          detailExpanded
            ? 'pointer-events-none flex-[0_1_0%] opacity-0 lg:pointer-events-auto lg:flex-[0_0_420px] lg:opacity-100 xl:flex-[0_0_460px]'
            : 'flex-[1_1_0%] opacity-100'
        }`}
      >
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/55 bg-white/55 p-2 md:hidden">
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
            }}
          >
            <Settings className="h-4 w-4" />
            设置
          </Button>
        </div>
        <GmailInbox
          active={active}
          onSelectThread={handleSelectThread}
          selectedThreadId={selectedThread?.id}
          mailbox={mailbox}
          category={category}
          refreshKey={mailboxRefreshKey}
          compact={detailExpanded}
          onCategoryChange={setCategory}
          updatedThread={selectedThread}
          onThreadUpdated={(thread) => {
            if (selectedThread?.id === thread.id) setSelectedThread(thread);
          }}
        />
      </div>
      )}

      <div className={`min-h-0 min-w-0 flex-col overflow-hidden bg-white/35 ${
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
            onBack={handleCloseThread}
            onThreadUpdated={setSelectedThread}
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
