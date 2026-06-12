'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GmailAttachment, GmailThread, GmailMessage } from '@/lib/types';
import { useEmailTranslations, useGmailAuth, useSettings } from '@/lib/data';
import { 
  ArrowLeft, Reply, MoreHorizontal, Globe, Languages,
  Copy, Sparkles, ChevronDown, Loader2,
  Paperclip, Download, Forward, Mail, MailOpen
} from 'lucide-react';
import { EmailComposer } from './email-composer';
import { NewEmailComposer } from './new-email-composer';
import { textToEmailHtml } from '@/lib/email-content';

interface EmailDetailProps {
  thread: GmailThread;
  onBack: () => void;
  onThreadUpdated?: (thread: GmailThread) => void;
}

export function EmailDetail({ thread, onBack, onThreadUpdated }: EmailDetailProps) {
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set([thread.messages[thread.messages.length - 1].id]));
  const [showComposer, setShowComposer] = useState(false);
  const [replyMode, setReplyMode] = useState<'compose' | 'ai'>('compose');
  const [savedReplyDraft, setSavedReplyDraft] = useState('');
  const [changingReadStateId, setChangingReadStateId] = useState<string | null>(null);
  const [messageActionError, setMessageActionError] = useState<string | null>(null);
  const [forwardDraft, setForwardDraft] = useState<{
    subject: string;
    content: string;
    attachments: File[];
  } | null>(null);
  const { addTranslation, getTranslation } = useEmailTranslations();
  const { auth, connect } = useGmailAuth();

  const toggleMessage = (messageId: string) => {
    const newExpanded = new Set(expandedMessages);
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId);
    } else {
      newExpanded.add(messageId);
    }
    setExpandedMessages(newExpanded);
  };

  const getAccessToken = async () => {
    if (!auth?.accessToken) throw new Error('\u8bf7\u91cd\u65b0\u8fde\u63a5 Gmail\u3002');
    if (!auth.refreshToken || !auth.expiresAt || auth.expiresAt > Date.now() + 60_000) {
      return auth.accessToken;
    }

    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) {
      throw new Error(result.error || 'Gmail \u6388\u6743\u5df2\u8fc7\u671f\u3002');
    }

    connect({
      ...auth,
      accessToken: result.data.accessToken,
      expiresAt: Date.now() + result.data.expiresIn * 1000,
    });
    return result.data.accessToken as string;
  };

  const toggleMessageReadState = async (message: GmailMessage) => {
    if (changingReadStateId) return;
    const markAsUnread = message.isRead;
    setChangingReadStateId(message.id);
    setMessageActionError(null);

    try {
      const accessToken = await getAccessToken();
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            addLabelIds: markAsUnread ? ['UNREAD'] : [],
            removeLabelIds: markAsUnread ? [] : ['UNREAD'],
          }),
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.error?.message || (markAsUnread ? '\u6807\u8bb0\u672a\u8bfb\u5931\u8d25' : '\u6807\u8bb0\u5df2\u8bfb\u5931\u8d25'),
        );
      }

      const updatedMessages = thread.messages.map((item) => item.id === message.id
        ? {
            ...item,
            isRead: !markAsUnread,
            labels: markAsUnread
              ? Array.from(new Set([...item.labels, 'UNREAD']))
              : item.labels.filter((label) => label !== 'UNREAD'),
          }
        : item);
      const hasUnread = updatedMessages.some((item) => !item.isRead);
      const updatedThread: GmailThread = {
        ...thread,
        hasUnread,
        labels: hasUnread
          ? Array.from(new Set([...thread.labels, 'UNREAD']))
          : thread.labels.filter((label) => label !== 'UNREAD'),
        messages: updatedMessages,
      };
      onThreadUpdated?.(updatedThread);
    } catch (error) {
      setMessageActionError(
        error instanceof Error
          ? error.message
          : markAsUnread
            ? '\u6807\u8bb0\u672a\u8bfb\u5931\u8d25'
            : '\u6807\u8bb0\u5df2\u8bfb\u5931\u8d25',
      );
    } finally {
      setChangingReadStateId(null);
    }
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
  const [showingTranslationIds, setShowingTranslationIds] = useState<Set<string>>(new Set());
  const [translateErrors, setTranslateErrors] = useState<Record<string, string>>({});
  const { settings } = useSettings();

  const handleTranslate = async (message: GmailMessage) => {
    if (showingTranslationIds.has(message.id)) {
      setShowingTranslationIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
      return;
    }

    if (getTranslation(message.id)) {
      setShowingTranslationIds((current) => new Set(current).add(message.id));
      return;
    }

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
      setShowingTranslationIds((current) => new Set(current).add(message.id));
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

  const escapeForwardHeader = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const dataUrlToFile = async (attachment: GmailAttachment) => {
    if (!attachment.dataUrl) return null;
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    return new File([blob], attachment.filename, {
      type: attachment.mimeType || blob.type || 'application/octet-stream',
    });
  };

  const handleForward = async (message: GmailMessage) => {
    setMessageActionError(null);
    try {
      const originalSubject = message.subject || thread.subject || '无主题';
      const forwardSubject = /^(fwd?|转发):/i.test(originalSubject)
        ? originalSubject
        : `Fwd: ${originalSubject}`;
      const originalBody = message.htmlBody
        ? sanitizeEmailHtml(message.htmlBody)
        : textToEmailHtml(message.body);
      const forwardedHeader = [
        '<br><br>',
        '<div style="border-top:1px solid #dadce0;margin-top:12px;padding-top:12px;color:#5f6368">',
        '<div><strong>---------- Forwarded message ---------</strong></div>',
        `<div><strong>From:</strong> ${escapeForwardHeader(message.from)}</div>`,
        `<div><strong>Date:</strong> ${escapeForwardHeader(formatDate(message.date))}</div>`,
        `<div><strong>Subject:</strong> ${escapeForwardHeader(originalSubject)}</div>`,
        `<div><strong>To:</strong> ${escapeForwardHeader(message.to)}</div>`,
        '</div>',
        '<br>',
        originalBody,
      ].join('');
      const attachmentFiles = (await Promise.all(
        (message.attachments || [])
          .filter((attachment) => !attachment.inline)
          .map(dataUrlToFile),
      )).filter((file): file is File => Boolean(file));

      setForwardDraft({
        subject: forwardSubject,
        content: forwardedHeader,
        attachments: attachmentFiles,
      });
    } catch (error) {
      setMessageActionError(
        error instanceof Error ? error.message : '准备转发邮件失败，请稍后重试。',
      );
    }
  };

  const sanitizeEmailHtml = (html: string) => {
    if (typeof window === 'undefined') return '';

    const documentNode = new DOMParser().parseFromString(html, 'text/html');
    documentNode
      .querySelectorAll('script, iframe, object, embed, form, input, button, meta, base')
      .forEach((element) => element.remove());

    documentNode.querySelectorAll<HTMLElement>('*').forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        if (attribute.name.toLowerCase().startsWith('on')) {
          element.removeAttribute(attribute.name);
        }
      });

      const style = element.getAttribute('style');
      if (style) {
        element.setAttribute(
          'style',
          style
            .replace(/position\s*:\s*(fixed|sticky)/gi, 'position: static')
            .replace(/z-index\s*:[^;]+;?/gi, ''),
        );
      }
    });

    documentNode.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (!/^(https?:|mailto:)/i.test(href)) {
        link.removeAttribute('href');
      } else {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });

    documentNode.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      const source = image.getAttribute('src') || '';
      if (!/^(https?:|data:image\/|blob:)/i.test(source)) {
        image.remove();
        return;
      }
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
    });

    return documentNode.body.innerHTML;
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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="AI 辅助回复"
            onClick={() => {
              setReplyMode('ai');
              setShowComposer(true);
            }}
          >
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
      {messageActionError && (
        <div className="shrink-0 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {messageActionError}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4 space-y-4">
          {thread.messages.map((message, index) => {
            const sender = getDisplayEmail(message.from);
            const translation = getTranslation(message.id);
            const isExpanded = expandedMessages.has(message.id);
            const isLast = index === thread.messages.length - 1;
            const visibleAttachments = (message.attachments || []).filter(
              (attachment) => !attachment.inline,
            );

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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="转发这封邮件"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleForward(message);
                        }}
                      >
                        <Forward className="h-4 w-4" />
                        <span className="sr-only">转发这封邮件</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={message.isRead ? '\u6807\u8bb0\u4e3a\u672a\u8bfb' : '\u6807\u8bb0\u4e3a\u5df2\u8bfb'}
                        disabled={changingReadStateId !== null}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMessageReadState(message);
                        }}
                      >
                        {changingReadStateId === message.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : message.isRead ? (
                          <Mail className="h-4 w-4" />
                        ) : (
                          <MailOpen className="h-4 w-4 text-primary" />
                        )}
                        <span className="sr-only">
                          {message.isRead ? '\u6807\u8bb0\u4e3a\u672a\u8bfb' : '\u6807\u8bb0\u4e3a\u5df2\u8bfb'}
                        </span>
                      </Button>
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
                        disabled={translatingIds.has(message.id)}
                        title={showingTranslationIds.has(message.id) ? '显示原文' : '翻译成中文'}
                      >
                        {translatingIds.has(message.id) ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : showingTranslationIds.has(message.id) ? (
                          <Languages className="h-4 w-4 text-primary" />
                        ) : (
                          <Globe className="h-4 w-4" />
                        )}
                      </Button>
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>

                  {/* 展开的邮件内容 */}
                  {isExpanded && (
                    <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {showingTranslationIds.has(message.id) ? '中文翻译' : '原文'}
                        </Badge>
                      </div>

                      {showingTranslationIds.has(message.id) && translation ? (
                        <div className="prose prose-sm max-w-none">
                          <pre className="max-w-full whitespace-pre-wrap break-words rounded-xl bg-blue-50 p-4 font-sans text-sm">
                            {translation.translatedText}
                          </pre>
                        </div>
                      ) : message.htmlBody ? (
                        <div
                          className="email-html-content max-w-full overflow-hidden rounded-xl bg-white p-4 text-sm"
                          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(message.htmlBody) }}
                        />
                      ) : (
                        <div className="prose prose-sm max-w-none">
                          <pre className="max-w-full whitespace-pre-wrap break-words rounded-xl bg-accent/30 p-4 font-sans text-sm">
                            {message.body}
                          </pre>
                        </div>
                      )}

                      {visibleAttachments.length > 0 && (
                        <AttachmentList attachments={visibleAttachments} />
                      )}

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
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => handleTranslate(message)}
                          disabled={translatingIds.has(message.id)}
                        >
                          {translatingIds.has(message.id) ? (
                            <>
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              翻译中...
                            </>
                          ) : (
                            <>
                              <Languages className="mr-1 h-3 w-3" />
                              {showingTranslationIds.has(message.id) ? '恢复原文' : '翻译成中文'}
                            </>
                          )}
                        </Button>
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
      <div className={`${showComposer ? 'max-h-[72%] overflow-y-auto' : ''} shrink-0 border-t bg-background p-4`}>
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
            initialMessage={replyMode === 'compose' ? savedReplyDraft : undefined}
            onDraftSaved={setSavedReplyDraft}
          />
        )}
      </div>
      <NewEmailComposer
        open={Boolean(forwardDraft)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setForwardDraft(null);
        }}
        title="转发邮件"
        description="填写新的收件人后转发这封邮件"
        initialSubject={forwardDraft?.subject || ''}
        initialContent={forwardDraft?.content || ''}
        initialAttachments={forwardDraft?.attachments || []}
      />
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: GmailAttachment[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="w-4 h-4" />
        附件（{attachments.length}）
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {attachments.map((attachment) => (
          <a
            key={`${attachment.id}-${attachment.filename}`}
            href={attachment.dataUrl}
            download={attachment.filename}
            className="flex min-w-0 items-center gap-3 rounded-lg border bg-background p-3 hover:bg-muted/50"
          >
            {attachment.mimeType.startsWith('image/') && attachment.dataUrl ? (
              <img
                src={attachment.dataUrl}
                alt={attachment.filename}
                className="h-12 w-12 flex-shrink-0 rounded object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded bg-muted">
                <Paperclip className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{attachment.filename}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(attachment.size)}
              </p>
            </div>
            <Download className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          </a>
        ))}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (!bytes) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
