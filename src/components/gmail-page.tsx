'use client';

import { useState } from 'react';
import { GmailInbox } from './gmail-inbox';
import { EmailDetail } from './email-detail';
import { GmailThread } from '@/lib/types';

export function GmailPage() {
  const [selectedThread, setSelectedThread] = useState<GmailThread | null>(null);

  const handleSelectThread = (thread: GmailThread) => {
    setSelectedThread(thread);
  };

  const handleBack = () => {
    setSelectedThread(null);
  };

  const handleAIReply = (thread: GmailThread) => {
    // 如果当前不在详情页，先选中这个对话
    if (!selectedThread || selectedThread.id !== thread.id) {
      setSelectedThread(thread);
    }
  };

  return (
    <div className="h-full min-h-0 flex overflow-hidden bg-background">
      {/* 左侧：收件箱列表 */}
      <div className={`${selectedThread ? 'hidden lg:flex' : 'flex'} min-h-0 w-full lg:w-96 border-r flex-col overflow-hidden bg-card`}>
        <GmailInbox 
          onSelectThread={handleSelectThread}
          selectedThreadId={selectedThread?.id}
        />
      </div>

      {/* 右侧：邮件详情 */}
      <div className={`min-h-0 min-w-0 flex-1 ${selectedThread ? 'flex' : 'hidden lg:flex'} flex-col overflow-hidden bg-background`}>
        {selectedThread ? (
          <EmailDetail 
            thread={selectedThread}
            onBack={handleBack}
            onAIReply={handleAIReply}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center mb-4">
              <svg className="w-10 h-10 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold mb-2">选择一封邮件</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              从左侧选择一个邮件对话，查看详情或使用 AI 辅助回复
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
