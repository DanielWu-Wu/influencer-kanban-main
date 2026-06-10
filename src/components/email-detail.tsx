'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GmailThread, GmailMessage } from '@/lib/types';
import { useEmailTranslations, useSettings } from '@/lib/data';
import { 
  ArrowLeft, Reply, ReplyAll, Forward, Trash2, 
  MoreHorizontal, Star, Clock, Globe, Languages,
  Copy, Check, AlertCircle, Sparkles, ChevronDown, Loader2
} from 'lucide-react';
import { EmailComposer } from './email-composer';

interface EmailDetailProps {
  thread: GmailThread;
  onBack: () => void;
  onAIReply: (thread: GmailThread) => void;
}

export function EmailDetail({ thread, onBack, onAIReply }: EmailDetailProps) {
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set([thread.messages[thread.messages.length - 1].id]));
  const [showComposer, setShowComposer] = useState(false);
  const [replyMode, setReplyMode] = useState<'compose' | 'ai'>('compose');
  const { translations, addTranslation, getTranslation } = useEmailTranslations();

  const toggleMessage = (messageId: string) => {
    const newExpanded = new Set(expandedMessages);
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId);
    } else {
      newExpanded.add(messageId);
    }
    setExpandedMessages(newExpanded);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDisplayEmail = (from: string) => {
    const match = from.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      return { name: match[1], email: match[2] };
    }
    return { name: from, email: from };
  };

  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [translateErrors, setTranslateErrors] = useState<Record<string, string>>({});
  const { settings } = useSettings();

  const handleTranslate = async (message: GmailMessage) => {
    setTranslatingIds(prev => new Set(prev).add(message.id));
    setTranslateErrors(prev => { const next = { ...prev }; delete next[message.id]; return next; });
    
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message.body,
          sourceLang: detectLanguage(message.body),
          customPrompt: settings.translatePrompt || '',
          modelProvider: settings.modelProvider || 'builtin',
          customApiUrl: settings.customApiUrl || '',
          customApiKey: settings.customApiKey || '',
          customModelName: settings.customModelName || '',
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || '翻译失败');
      }

      addTranslation({
        messageId: message.id,
        originalText: message.body,
        translatedText: result.data.translatedText,
        sourceLang: result.data.sourceLang,
        targetLang: 'zh',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '翻译失败，请稍后重试';
      setTranslateErrors(prev => ({ ...prev, [message.id]: msg }));
    } finally {
      setTranslatingIds(prev => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  };

  // 语言检测
  const detectLanguage = (text: string): string => {
    if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';
    return 'en';
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{thread.subject || '(无主题)'}</h2>
            <p className="text-xs text-muted-foreground">
              {thread.messages.length} 封邮件 · {thread.participantCount} 位参与者
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onAIReply(thread)}>
            <Sparkles className="w-4 h-4 text-primary" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <Reply className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 邮件对话 */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4 space-y-4">
          {thread.messages.map((message, index) => {
            const sender = getDisplayEmail(message.from);
            const translation = getTranslation(message.id);
            const isExpanded = expandedMessages.has(message.id);
            const isLast = index === thread.messages.length - 1;

            return (
              <div key={message.id} className="space-y-3">
                {/* 邮件头 */}
                <div 
                  className={`
                    rounded-2xl border p-4 transition-all cursor-pointer
                    ${isLast ? 'bg-primary/5 border-primary/20' : 'bg-card'}
                  `}
                  onClick={() => toggleMessage(message.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      {/* 头像 */}
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-medium text-blue-600">
                          {sender.name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      
                      {/* 发件人信息 */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-medium">{sender.name}</span>
                          <span className="text-xs text-muted-foreground">&lt;{sender.email}&gt;</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(message.date)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {message.hasAttachments && (
                        <Badge variant="secondary" className="text-xs">有附件</Badge>
                      )}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTranslate(message);
                        }}
                      >
                        <Globe className="w-4 h-4" />
                      </Button>
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>

                  {/* 展开的邮件内容 */}
                  {isExpanded && (
                    <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                      <Tabs defaultValue="original" className="w-full">
                        <TabsList className="h-8">
                          <TabsTrigger value="original" className="text-xs h-7 px-3">
                            原文
                          </TabsTrigger>
                          {translation && (
                            <TabsTrigger value="translated" className="text-xs h-7 px-3">
                              中文
                            </TabsTrigger>
                          )}
                        </TabsList>
                        
                        <TabsContent value="original" className="mt-3">
                          <div className="prose prose-sm max-w-none">
                            <pre className="max-w-full whitespace-pre-wrap break-words font-sans text-sm bg-accent/30 rounded-xl p-4">
                              {message.body}
                            </pre>
                          </div>
                        </TabsContent>

                        {translation && (
                          <TabsContent value="translated" className="mt-3">
                            <div className="prose prose-sm max-w-none">
                              <pre className="max-w-full whitespace-pre-wrap break-words font-sans text-sm bg-blue-50 rounded-xl p-4">
                                {translation.translatedText}
                              </pre>
                            </div>
                          </TabsContent>
                        )}
                      </Tabs>

                      {/* 操作按钮 */}
                      <div className="flex items-center gap-2 pt-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-8"
                          onClick={() => copyToClipboard(message.body)}
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          复制
                        </Button>
                        {!translation && (
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-8"
                            onClick={() => handleTranslate(message)}
                            disabled={translatingIds.has(message.id)}
                          >
                            {translatingIds.has(message.id) ? (
                              <>
                                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                翻译中...
                              </>
                            ) : (
                              <>
                                <Languages className="w-3 h-3 mr-1" />
                                翻译
                              </>
                            )}
                          </Button>
                        )}
                        {translateErrors[message.id] && (
                          <span className="text-xs text-destructive">{translateErrors[message.id]}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* 底部回复区域 */}
      <div className="border-t bg-background p-4">
        {!showComposer ? (
          <div className="flex items-center justify-center gap-3">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={() => {
                setReplyMode('compose');
                setShowComposer(true);
              }}
            >
              <Reply className="w-4 h-4 mr-2" />
              回复
            </Button>
            <Button 
              className="flex-1"
              onClick={() => {
                setReplyMode('ai');
                setShowComposer(true);
              }}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              AI 辅助回复
            </Button>
          </div>
        ) : (
          <EmailComposer
            thread={thread}
            mode={replyMode}
            onClose={() => setShowComposer(false)}
          />
        )}
      </div>
    </div>
  );
}
