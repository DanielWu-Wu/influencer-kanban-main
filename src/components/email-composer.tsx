'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Globe,
  Loader2,
  Paperclip,
  RefreshCw,
  Save,
  Sparkles,
  Send,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useEmailAISuggestions, useEmailDrafts, useGmailAuth, useSettings } from '@/lib/data';
import {
  appendEmailSignature,
  buildRichRawEmail,
  emailHtmlToText,
  isEmailContentEmpty,
  toBase64Url,
} from '@/lib/email-content';
import { GmailThread } from '@/lib/types';
import { RichEmailEditor } from './rich-email-editor';

interface EmailComposerProps {
  thread: GmailThread;
  mode: 'compose' | 'ai';
  onClose: () => void;
  initialMessage?: string;
  onDraftSaved?: (content: string) => void;
}

type CollaborationAnalysis = {
  latestSummary: string;
  creatorIntent: string;
  stage: string;
  attitude: string;
  communicationStyle?: string;
  currentEmotion?: string;
  statedPosition?: string;
  coreInterests?: string;
  communicationRisks?: string[];
  leverageOptions?: string[];
  confirmedItems: string[];
  openQuestions: string[];
  risks: string[];
  replyStrategy: string[];
  language: string;
  languageName: string;
};

type AISuggestion = {
  suggestedReply: string;
  translatedReply: string;
  tone: 'formal' | 'casual' | 'friendly';
  keyPoints: string[];
};

type AIHistoryMessage = {
  id?: string;
  threadId?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  body?: string;
};

const LANGUAGE_OPTIONS = [
  ['en', '英语'],
  ['nl', '荷兰语'],
  ['de', '德语'],
  ['fr', '法语'],
  ['es', '西班牙语'],
  ['it', '意大利语'],
  ['pt', '葡萄牙语'],
  ['ja', '日语'],
  ['ko', '韩语'],
  ['zh', '中文'],
] as const;

const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

function extractEmail(value: string) {
  return value.match(/<([^>]+)>/)?.[1] || value.split(',')[0]?.trim() || value;
}

function buildThreadMessages(thread: GmailThread) {
  return thread.messages.map((message) => ({
    id: message.id,
    threadId: message.threadId,
    subject: message.subject || thread.subject,
    from: message.from,
    to: message.to,
    date: message.date,
    body: message.body,
  }));
}

export function EmailComposer({
  thread,
  mode,
  onClose,
  initialMessage,
  onDraftSaved,
}: EmailComposerProps) {
  const { addSuggestion } = useEmailAISuggestions();
  const { addDraft } = useEmailDrafts();
  const { auth, connect } = useGmailAuth();
  const { settings, loading: settingsLoading } = useSettings();
  const [replyContent, setReplyContent] = useState(initialMessage || '');
  const [userIdeas, setUserIdeas] = useState('');
  const [analysis, setAnalysis] = useState<CollaborationAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(mode === 'ai');
  const [analysisError, setAnalysisError] = useState('');
  const [historyMessages, setHistoryMessages] = useState<AIHistoryMessage[]>([]);
  const [targetLang, setTargetLang] = useState('en');
  const [targetLangName, setTargetLangName] = useState('英语');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [completion, setCompletion] = useState<'draft' | 'sent' | null>(null);
  const [copied, setCopied] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const threadMessages = useMemo(() => buildThreadMessages(thread), [thread]);
  const lastMessage = thread.messages[thread.messages.length - 1];

  const externalMessage = useMemo(() => {
    const ownEmail = auth?.email?.toLowerCase();
    return [...thread.messages].reverse().find((message) => {
      const sender = extractEmail(message.from).toLowerCase();
      return !ownEmail || sender !== ownEmail;
    }) || lastMessage;
  }, [auth?.email, lastMessage, thread.messages]);

  const invokeAI = async (
    payload: Record<string, unknown>,
    messages: AIHistoryMessage[] = historyMessages.length ? historyMessages : threadMessages,
  ) => {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        threadSubject: thread.subject,
        threadMessages: messages,
        analysisPrompt: settings.aiAnalysisPrompt || '',
        draftPrompt: settings.aiDraftPrompt || settings.aiEmailPrompt || '',
        modelProvider: settings.modelProvider || 'builtin',
        customApiUrl: settings.customApiUrl || '',
        customApiKey: settings.customApiKey || '',
        customModelName: settings.customModelName || '',
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'AI 处理失败');
    return result.data;
  };

  const loadContactHistory = async () => {
    const accessToken = await getAccessToken();
    const contactEmail = extractEmail(externalMessage.from);
    const response = await fetch('/api/gmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'contactHistory',
        accessToken,
        contactEmail,
        maxResults: 50,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error || '读取联系人历史邮件失败');
    }

    const fetched = (result.data || []) as AIHistoryMessage[];
    const byId = new Map<string, AIHistoryMessage>();
    [...fetched, ...threadMessages].forEach((message, index) => {
      const key = message.id || `${message.date}-${message.from}-${index}`;
      byId.set(key, message);
    });
    return [...byId.values()]
      .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
      .slice(-50);
  };

  const analyzeThread = async () => {
    setAnalysisLoading(true);
    setAnalysisError('');
    setSuggestion(null);

    try {
      const contactHistory = await loadContactHistory();
      setHistoryMessages(contactHistory);
      const result = await invokeAI({ action: 'analyze' }, contactHistory) as CollaborationAnalysis;
      const language = result.language || 'en';
      const knownLanguage = LANGUAGE_OPTIONS.find(([code]) => code === language);
      setAnalysis(result);
      setTargetLang(language);
      setTargetLangName(result.languageName || knownLanguage?.[1] || language);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '邮件分析失败，请稍后重试');
    } finally {
      setAnalysisLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'ai' && !settingsLoading) analyzeThread();
    // The analysis should run once when the AI composer opens for this thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, thread.id, settingsLoading]);

  const generateReply = async () => {
    if (!userIdeas.trim() || !analysis) return;
    setAiLoading(true);
    setAiError('');

    try {
      const result = await invokeAI({
        action: 'draft',
        analysis,
        userIdeas,
        targetLang,
        targetLangName,
      }, historyMessages) as AISuggestion;
      setSuggestion(result);
      setReplyContent(result.suggestedReply);
      addSuggestion({
        threadId: thread.id,
        messageId: externalMessage.id,
        suggestedReply: result.suggestedReply,
        translatedReply: result.translatedReply,
        tone: result.tone || 'friendly',
        keyPoints: result.keyPoints || [],
        status: 'pending',
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI 生成失败，请稍后重试');
    } finally {
      setAiLoading(false);
    }
  };

  const getAccessToken = async () => {
    if (!auth?.accessToken) throw new Error('请重新连接 Gmail。');
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
      throw new Error(result.error || 'Gmail 授权已过期，请重新连接。');
    }

    connect({
      ...auth,
      accessToken: result.data.accessToken,
      expiresAt: Date.now() + result.data.expiresIn * 1000,
    });
    return result.data.accessToken as string;
  };

  const createOutgoingEmail = async () => {
    if (isEmailContentEmpty(replyContent)) throw new Error('请先填写回复内容。');
    const finalReply = appendEmailSignature(replyContent, settings.emailSignature);
    const accessToken = await getAccessToken();
    const references = [externalMessage.references, externalMessage.rfcMessageId]
      .filter(Boolean)
      .join(' ');
    const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
    const rawEmail = await buildRichRawEmail({
      to: extractEmail(externalMessage.from),
      subject,
      htmlBody: finalReply,
      inReplyTo: externalMessage.rfcMessageId,
      references,
      attachments,
    });
    return { accessToken, finalReply, rawEmail, subject };
  };

  const saveToGmailDrafts = async () => {
    setSavingDraft(true);
    setAiError('');

    try {
      const { accessToken, finalReply, rawEmail, subject } = await createOutgoingEmail();
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            raw: toBase64Url(rawEmail),
            threadId: thread.id,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message || '保存 Gmail 草稿失败');
      }

      addDraft({
        to: extractEmail(externalMessage.from),
        subject,
        body: emailHtmlToText(finalReply),
      });
      onDraftSaved?.(finalReply);
      setCompletion('draft');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : '保存 Gmail 草稿失败');
    } finally {
      setSavingDraft(false);
    }
  };

  const sendEmail = async () => {
    if (isEmailContentEmpty(replyContent)) return;
    const recipient = extractEmail(externalMessage.from);
    const confirmed = window.confirm(
      `确定要直接发送给 ${recipient} 吗？发送后将无法撤回。`,
    );
    if (!confirmed) return;

    setSending(true);
    setAiError('');
    try {
      const { accessToken, rawEmail } = await createOutgoingEmail();
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: toBase64Url(rawEmail),
          threadId: thread.id,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message || '邮件发送失败');
      }
      setCompletion('sent');
      onDraftSaved?.('');
    } catch (error) {
      setAiError(error instanceof Error ? error.message : '邮件发送失败');
    } finally {
      setSending(false);
    }
  };

  const handleAttachmentSelection = (files: FileList | null) => {
    if (!files?.length) return;
    const nextFiles = [...attachments, ...Array.from(files)];
    const totalSize = nextFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_ATTACHMENT_BYTES) {
      setAttachmentError('附件总大小不能超过 18 MB。');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setAttachments(nextFiles);
    setAttachmentError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const copyToClipboard = async () => {
    if (!suggestion) return;
    await navigator.clipboard.writeText(suggestion.suggestedReply);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (completion) {
    return (
      <div className="space-y-4 py-2 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
          <Check className="h-5 w-5 text-green-700" />
        </div>
        <div>
          <p className="font-medium">
            {completion === 'draft' ? '已保存到 Gmail 官方草稿箱' : '邮件已发送'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {completion === 'draft'
              ? '关闭助手后，手动回复框也会保留这份草稿。'
              : `邮件已直接发送给 ${extractEmail(externalMessage.from)}。`}
          </p>
        </div>
        <Button variant="outline" className="w-full" onClick={onClose}>关闭</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="gap-1">
            {mode === 'ai' ? <Sparkles className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
            {mode === 'ai' ? 'AI 合作助手' : '手动回复'}
          </Badge>
          {analysis && <Badge variant="outline">{analysis.languageName || targetLangName}</Badge>}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {mode === 'ai' && (analysisLoading || settingsLoading) && (
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">正在读取联系人历史并分析合作情况</p>
            <p className="text-xs text-muted-foreground">
              将读取与该邮箱最近最多 50 封邮件，不限于当前线程。
            </p>
          </div>
        </div>
      )}

      {analysisError && (
        <ErrorMessage message={analysisError}>
          <Button variant="outline" size="sm" onClick={analyzeThread}>重新分析</Button>
        </ErrorMessage>
      )}

      <div className="space-y-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => handleAttachmentSelection(event.target.files)}
        />
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">附件</label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-3.5 w-3.5" />
            添加附件
          </Button>
        </div>
        {attachments.length > 0 && (
          <div className="space-y-2 rounded-lg border p-2">
            {attachments.map((file, index) => (
              <div
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="移除附件"
                  onClick={() => {
                    setAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index));
                    setAttachmentError('');
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          支持图片、PDF、文档等常见文件，附件总大小上限为 18 MB。
        </p>
        {attachmentError && <p className="text-xs text-destructive">{attachmentError}</p>}
      </div>

      {mode === 'ai' && analysis && !suggestion && (
        <>
          <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>本次分析已合并当前线程和联系人历史邮件</span>
            <Badge variant="outline">{historyMessages.length} 封</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <AnalysisItem title="最新邮件意思梗概" content={analysis.latestSummary} />
            <AnalysisItem title="红人的意图" content={analysis.creatorIntent} />
            <AnalysisItem title="当前合作进度" content={analysis.stage} />
            <AnalysisItem title="红人的态度" content={analysis.attitude} />
            <AnalysisItem
              title="沟通风格与当前情绪"
              content={[
                analysis.communicationStyle && `沟通风格：${analysis.communicationStyle}`,
                analysis.currentEmotion && `当前情绪：${analysis.currentEmotion}`,
              ].filter(Boolean).join('\n')}
            />
            <AnalysisItem title="表面立场" content={analysis.statedPosition || ''} />
            <AnalysisItem title="核心利益" content={analysis.coreInterests || ''} />
          </div>

          <AnalysisList title="已确认事项" items={analysis.confirmedItems} />
          <AnalysisList title="待解决事项" items={analysis.openQuestions} />
          <AnalysisList title="沟通雷区" items={analysis.communicationRisks} />
          <AnalysisList title="破局筹码" items={analysis.leverageOptions} />
          <AnalysisList title="风险提醒" items={analysis.risks} />
          <AnalysisList title="回复建议" items={analysis.replyStrategy} />

          <div className="space-y-2 border-t pt-4">
            <label className="text-sm font-medium">你是怎么想的？</label>
            <p className="text-xs text-muted-foreground">
              用中文告诉 AI 你的判断、预算、底线、产品安排或想向对方确认的问题。
            </p>
            <Textarea
              value={userIdeas}
              onChange={(event) => setUserIdeas(event.target.value)}
              placeholder="例如：价格可以接受，但需要确认视频发布时间；请礼貌询问能否在月底前发布..."
              className="min-h-24 resize-none"
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="shrink-0 text-sm text-muted-foreground">回复语言</label>
            <select
              value={targetLang}
              className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
              onChange={(event) => {
                const language = LANGUAGE_OPTIONS.find(([code]) => code === event.target.value);
                setTargetLang(event.target.value);
                setTargetLangName(language?.[1] || event.target.value);
              }}
            >
              {LANGUAGE_OPTIONS.map(([code, name]) => (
                <option key={code} value={code}>{name}</option>
              ))}
            </select>
          </div>

          {aiError && <ErrorMessage message={aiError} />}
          <Button className="w-full" onClick={generateReply} disabled={!userIdeas.trim() || aiLoading}>
            {aiLoading ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在起草回复...</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" />根据我的想法起草邮件</>
            )}
          </Button>
        </>
      )}

      {suggestion && (
        <div className="space-y-4">
          <AnalysisList title="本次回复要点" items={suggestion.keyPoints} />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">{targetLangName}回复</label>
              <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={copyToClipboard}>
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
            <RichEmailEditor
              value={replyContent}
              onChange={setReplyContent}
              placeholder="编辑 AI 起草的邮件..."
              minHeight="11rem"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">中文对照</label>
            <div className="whitespace-pre-wrap rounded-lg bg-muted/50 p-4 text-sm">
              {suggestion.translatedReply}
            </div>
          </div>
          {aiError && <ErrorMessage message={aiError} />}
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setSuggestion(null);
                setAiError('');
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              调整想法
            </Button>
            <Button
              variant="outline"
              onClick={sendEmail}
              disabled={sending || savingDraft || isEmailContentEmpty(replyContent)}
            >
              {sending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              直接发送
            </Button>
            <Button onClick={saveToGmailDrafts} disabled={savingDraft || sending || isEmailContentEmpty(replyContent)}>
              {savingDraft ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存为草稿
            </Button>
          </div>
        </div>
      )}

      {mode === 'compose' && (
        <div className="space-y-4">
          <RichEmailEditor
            value={replyContent}
            onChange={setReplyContent}
            placeholder="输入回复内容..."
            minHeight="12rem"
          />
          {aiError && <ErrorMessage message={aiError} />}
          <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={sendEmail}
            disabled={sending || savingDraft || isEmailContentEmpty(replyContent)}
          >
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            直接发送
          </Button>
          <Button onClick={saveToGmailDrafts} disabled={savingDraft || sending || isEmailContentEmpty(replyContent)}>
            {savingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
            保存为草稿
          </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisItem({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-1 whitespace-pre-line text-sm leading-6">{content || '暂无明确结论'}</p>
    </div>
  );
}

function AnalysisList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2 text-sm text-muted-foreground">
            <span className="text-primary">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorMessage({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-destructive/10 p-3">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <p className="text-sm text-destructive">{message}</p>
      </div>
      {children}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
