'use client';

import { useState } from 'react';
import { FileText, Inbox, Mail, Send, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GmailCategory, GmailMailbox, GmailThread } from '@/lib/types';
import { EmailDetail } from './email-detail';
import { GmailInbox } from './gmail-inbox';

const MAILBOXES: Array<{
  id: GmailMailbox;
  label: string;
  icon: typeof Inbox;
}> = [
  { id: 'inbox', label: '\u6536\u4ef6\u7bb1', icon: Inbox },
  { id: 'starred', label: '\u5df2\u6807\u661f', icon: Star },
  { id: 'sent', label: '\u5df2\u53d1\u9001', icon: Send },
  { id: 'drafts', label: '\u8349\u7a3f', icon: FileText },
];

export function GmailPage() {
  const [selectedThread, setSelectedThread] = useState<GmailThread | null>(null);
  const [mailbox, setMailbox] = useState<GmailMailbox>('inbox');
  const [category, setCategory] = useState<GmailCategory>('primary');

  const handleMailboxChange = (nextMailbox: GmailMailbox) => {
    setMailbox(nextMailbox);
    setSelectedThread(null);
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background">
      <aside className={`${selectedThread ? 'hidden xl:flex' : 'hidden md:flex'} w-40 shrink-0 flex-col border-r bg-card px-2 py-3`}>
        <div className="mb-3 flex items-center gap-2 px-2 text-sm font-semibold">
          <Mail className="h-4 w-4 text-red-500" />
          Gmail
        </div>
        <nav className="space-y-1">
          {MAILBOXES.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={mailbox === id ? 'secondary' : 'ghost'}
              className="h-9 w-full justify-start gap-3 px-3 font-normal"
              onClick={() => handleMailboxChange(id)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </nav>
      </aside>

      <div className={`${selectedThread ? 'hidden lg:flex' : 'flex'} min-h-0 w-full flex-col overflow-hidden border-r bg-card lg:w-[420px]`}>
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:hidden">
          {MAILBOXES.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={mailbox === id ? 'secondary' : 'ghost'}
              size="sm"
              className="shrink-0 gap-2"
              onClick={() => handleMailboxChange(id)}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </div>
        <GmailInbox
          onSelectThread={setSelectedThread}
          selectedThreadId={selectedThread?.id}
          mailbox={mailbox}
          category={category}
          onCategoryChange={setCategory}
          updatedThread={selectedThread}
          onThreadUpdated={(thread) => {
            if (selectedThread?.id === thread.id) setSelectedThread(thread);
          }}
        />
      </div>

      <div className={`min-h-0 min-w-0 flex-1 ${selectedThread ? 'flex' : 'hidden lg:flex'} flex-col overflow-hidden bg-background`}>
        {selectedThread ? (
          <EmailDetail
            thread={selectedThread}
            onBack={() => setSelectedThread(null)}
            onAIReply={setSelectedThread}
            onThreadUpdated={setSelectedThread}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
              <Mail className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="mb-2 text-lg font-semibold">{'\u9009\u62e9\u4e00\u5c01\u90ae\u4ef6'}</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              {'\u4ece\u5de6\u4fa7\u9009\u62e9\u90ae\u4ef6\u5bf9\u8bdd\uff0c\u67e5\u770b\u8be6\u60c5\u6216\u4f7f\u7528 AI \u8f85\u52a9\u56de\u590d'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
