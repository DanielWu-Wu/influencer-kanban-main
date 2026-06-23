'use client';

import { useState } from 'react';
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

export function GmailPage() {
  const [selectedThread, setSelectedThread] = useState<GmailThread | null>(null);
  const [mailbox, setMailbox] = useState<GmailMailbox>('inbox');
  const [category, setCategory] = useState<GmailCategory>('primary');
  const [showSettings, setShowSettings] = useState(false);
  const [showNewEmail, setShowNewEmail] = useState(false);
  const [mailboxRefreshKey, setMailboxRefreshKey] = useState(0);

  const handleMailboxChange = (nextMailbox: GmailMailbox) => {
    setMailbox(nextMailbox);
    setSelectedThread(null);
    setShowSettings(false);
  };

  return (
    <div className="glass-panel-strong flex h-full min-h-0 overflow-hidden rounded-lg">
      <aside className={`${selectedThread ? 'hidden xl:flex' : 'hidden md:flex'} w-44 shrink-0 flex-col border-r border-white/55 bg-white/45 px-3 py-3 backdrop-blur-xl`}>
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
            setSelectedThread(null);
          }}
        >
          <Settings className="h-4 w-4" />
          设置
        </Button>
      </aside>

      {!showSettings && (
      <div
        className={`${selectedThread ? 'hidden lg:flex lg:w-[420px] xl:w-[460px] lg:flex-none' : 'flex flex-1'} min-h-0 flex-col overflow-hidden border-r border-white/55 bg-white/50 transition-[width,opacity] duration-300 ease-out`}
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
              setSelectedThread(null);
            }}
          >
            <Settings className="h-4 w-4" />
            设置
          </Button>
        </div>
        <GmailInbox
          onSelectThread={setSelectedThread}
          selectedThreadId={selectedThread?.id}
          mailbox={mailbox}
          category={category}
          refreshKey={mailboxRefreshKey}
          compact={Boolean(selectedThread)}
          onCategoryChange={setCategory}
          updatedThread={selectedThread}
          onThreadUpdated={(thread) => {
            if (selectedThread?.id === thread.id) setSelectedThread(thread);
          }}
        />
      </div>
      )}

      <div className={`min-h-0 min-w-0 flex-1 ${selectedThread || showSettings ? 'flex' : 'hidden'} flex-col overflow-hidden bg-white/35`}>
        {showSettings ? (
          <GmailSignatureSettings onBack={() => setShowSettings(false)} />
        ) : selectedThread ? (
          <EmailDetail
            thread={selectedThread}
            onBack={() => setSelectedThread(null)}
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
          setSelectedThread(null);
          setShowSettings(false);
          setMailboxRefreshKey((current) => current + 1);
        }}
      />
    </div>
  );
}
