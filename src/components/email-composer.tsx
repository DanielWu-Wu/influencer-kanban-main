'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Globe,
  Languages,
  Loader2,
  Minimize2,
  Paperclip,
  RefreshCw,
  Save,
  Sparkles,
  Send,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useEmailAISuggestions, useEmailDrafts, useGmailAuth, useSettings } from '@/lib/data';
import {
  appendEmailSignature,
  buildRichRawEmail,
  emailHtmlToText,
  isEmailContentEmpty,
  stripConfiguredEmailSignature,
  toBase64Url,
} from '@/lib/email-content';
import {
  getGmailThreadContact,
  isIgnoredGmailThreadSender,
} from '@/lib/gmail-thread-contact';
import { GmailThread } from '@/lib/types';
import { RichEmailEditor } from './rich-email-editor';
import { useDelayedEmailSender } from './delayed-email-provider';
import { useRecordAssistant } from './record-assistant-provider';

interface EmailComposerProps {
  thread: GmailThread;
  mode: 'compose' | 'ai';
  onMinimize?: () => void;
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

type TranslatedDraftResult = {
  suggestedReply: string;
};

type ReplyTone = AISuggestion['tone'];

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
  ['es', '西班牙语'],
  ['nl', '荷兰语'],
  ['de', '德语'],
  ['fr', '法语'],
  ['pt', '葡萄牙语'],
  ['pl', '波兰语'],
  ['it', '意大利语'],
  ['sv', '瑞典语'],
  ['da', '丹麦语'],
  ['no', '挪威语'],
  ['fi', '芬兰语'],
  ['is', '冰岛语'],
  ['cs', '捷克语'],
  ['sk', '斯洛伐克语'],
  ['hu', '匈牙利语'],
  ['ro', '罗马尼亚语'],
  ['bg', '保加利亚语'],
  ['el', '希腊语'],
  ['hr', '克罗地亚语'],
  ['sl', '斯洛文尼亚语'],
  ['sr', '塞尔维亚语'],
  ['bs', '波斯尼亚语'],
  ['mk', '马其顿语'],
  ['sq', '阿尔巴尼亚语'],
  ['et', '爱沙尼亚语'],
  ['lv', '拉脱维亚语'],
  ['lt', '立陶宛语'],
  ['uk', '乌克兰语'],
  ['ru', '俄语'],
  ['be', '白俄罗斯语'],
  ['ga', '爱尔兰语'],
  ['cy', '威尔士语'],
  ['mt', '马耳他语'],
  ['ca', '加泰罗尼亚语'],
  ['eu', '巴斯克语'],
  ['gl', '加利西亚语'],
  ['lb', '卢森堡语'],
] as const;

const REPLY_TONE_OPTIONS: ReadonlyArray<{
  value: ReplyTone;
  label: string;
}> = [
  { value: 'friendly', label: '自然友好' },
  { value: 'formal', label: '正式专业' },
  { value: 'casual', label: '轻松亲切' },
];

const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const GMAIL_AI_HISTORY_LIMIT = 15;
const QUICK_REPLY_IDEAS = [
  ['接受报价', '可以接受对方的报价和合作条件。'],
  ['需要降价', '当前报价超出预算，请礼貌协商更合适的价格。'],
  ['确认发布时间', '请确认视频预计发布时间和交付安排。'],
  ['询问数据', '请询问频道近期视频表现和受众数据。'],
] as const;

function buildThreadMessages(thread: GmailThread) {
  return thread.messages
    .filter((message) => !isIgnoredGmailThreadSender(message.from))
    .map((message) => ({
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
  onMinimize,
  onClose,
  initialMessage,
  onDraftSaved,
}: EmailComposerProps) {
  const { addSuggestion } = useEmailAISuggestions();
  const { addDraft } = useEmailDrafts();
  const { auth, connect } = useGmailAuth();
  const { settings, loading: settingsLoading } = useSettings();
  const { scheduleEmail } = useDelayedEmailSender();
  const { captureEvent } = useRecordAssistant();
  const [replyContent, setReplyContent] = useState(initialMessage || '');
  const [userIdeas, setUserIdeas] = useState('');
  const [analysis, setAnalysis] = useState<CollaborationAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(mode === 'ai');
  const [analysisError, setAnalysisError] = useState('');
  const [historyMessages, setHistoryMessages] = useState<AIHistoryMessage[]>([]);
  const [targetLang, setTargetLang] = useState('en');
  const [targetLangName, setTargetLangName] = useState('英语');
  const [replyTone, setReplyTone] = useState<ReplyTone>('friendly');
  const [generatedLangName, setGeneratedLangName] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [sending, setSending] = useState(false);
  const [completion, setCompletion] = useState<'draft' | 'scheduled' | 'sent' | null>(null);
  const [copied, setCopied] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [translationExpanded, setTranslationExpanded] = useState(false);
  const [translationEditing, setTranslationEditing] = useState(false);
  const [editedChineseReply, setEditedChineseReply] = useState('');
  const [translatingEditedReply, setTranslatingEditedReply] = useState(false);
  const [translationUpdated, setTranslationUpdated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const threadMessages = useMemo(() => buildThreadMessages(thread), [thread]);
  const lastConversationMessage = useMemo(
    () => [...thread.messages]
      .reverse()
      .find((message) => !isIgnoredGmailThreadSender(message.from)),
    [thread.messages],
  );
  const threadContact = useMemo(
    () => getGmailThreadContact(thread, auth?.email),
    [auth?.email, thread],
  );
  const externalMessage = threadContact.message || lastConversationMessage;
  const recipientEmail = threadContact.emails[0] || '';

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
        customModelName: settings.customModelName || '',
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'AI 处理失败');
    return result.data;
  };

  const loadContactHistory = async () => {
    if (!recipientEmail) {
      throw new Error('未找到可用的红人邮箱；Mailsuite 等系统通知邮箱不会作为回复收件人。');
    }
    const accessToken = await getAccessToken();
    const response = await fetch('/api/gmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'contactHistory',
        accessToken,
        contactEmail: recipientEmail,
        maxResults: GMAIL_AI_HISTORY_LIMIT,
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
      .slice(-GMAIL_AI_HISTORY_LIMIT);
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
        replyTone,
      }, historyMessages) as AISuggestion;
      const cleanSuggestedReply = stripConfiguredEmailSignature(
        result.suggestedReply,
        settings.emailSignature,
      );
      const cleanSuggestion = { ...result, suggestedReply: cleanSuggestedReply };
      setSuggestion(cleanSuggestion);
      setReplyContent(cleanSuggestedReply);
      setEditedChineseReply(result.translatedReply);
      setTranslationExpanded(true);
      setTranslationEditing(false);
      setTranslationUpdated(false);
      setGeneratedLangName(targetLangName);
      addSuggestion({
        threadId: thread.id,
        messageId: externalMessage?.id || thread.id,
        suggestedReply: cleanSuggestedReply,
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

  const updateDraftFromChinese = async () => {
    const confirmedChineseReply = editedChineseReply.trim();
    if (!confirmedChineseReply || !suggestion) return;
    setTranslatingEditedReply(true);
    setAiError('');
    setTranslationUpdated(false);

    try {
      const result = await invokeAI({
        action: 'translateEditedReply',
        editedChineseReply: confirmedChineseReply,
        targetLang,
        targetLangName,
      }, []) as TranslatedDraftResult;
      const cleanSuggestedReply = stripConfiguredEmailSignature(
        result.suggestedReply,
        settings.emailSignature,
      );
      setReplyContent(cleanSuggestedReply);
      setSuggestion((current) => current ? {
        ...current,
        suggestedReply: cleanSuggestedReply,
        translatedReply: confirmedChineseReply,
        keyPoints: [],
      } : current);
      setEditedChineseReply(confirmedChineseReply);
      setGeneratedLangName(targetLangName);
      setTranslationEditing(false);
      setTranslationUpdated(true);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : '根据中文更新外文草稿失败，请稍后重试');
    } finally {
      setTranslatingEditedReply(false);
    }
  };

  const getAccessToken = async () => {
    if (!auth?.accessToken) throw new Error('请重新连接 Gmail。');
    if (auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
      return auth.accessToken;
    }

    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
    });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) {
      throw new Error(result.error || 'Gmail 授权已过期，请重新连接。');
    }

    connect({
      ...auth,
      accessToken: result.data.accessToken,
      expiresAt: result.data.expiresAt,
    });
    return result.data.accessToken as string;
  };

  const createOutgoingEmail = async () => {
    if (isEmailContentEmpty(replyContent)) throw new Error('请先填写回复内容。');
    if (!recipientEmail) {
      throw new Error('未找到可用的红人邮箱；已排除 Mailsuite 等系统通知邮箱。');
    }
    const finalReply = appendEmailSignature(replyContent, settings.emailSignature);
    const accessToken = await getAccessToken();
    const references = [externalMessage?.references, externalMessage?.rfcMessageId]
      .filter(Boolean)
      .join(' ');
    const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
    const rawEmail = await buildRichRawEmail({
      to: recipientEmail,
      subject,
      htmlBody: finalReply,
      inReplyTo: externalMessage?.rfcMessageId,
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
        to: recipientEmail,
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
    if (!recipientEmail) {
      setAiError('未找到可用的红人邮箱；已排除 Mailsuite 等系统通知邮箱。');
      return;
    }
    const recipient = recipientEmail;
    const delaySeconds = Math.min(60, Math.max(0, settings.emailSendDelaySeconds ?? 0));
    const confirmed = window.confirm(
      delaySeconds > 0
        ? `确定发送给 ${recipient} 吗？邮件将在 ${delaySeconds} 秒后实际发出，倒计时结束前可以取消。`
        : `确定要直接发送给 ${recipient} 吗？邮件将立即发出。`,
    );
    if (!confirmed) return;

    setSending(true);
    setAiError('');
    try {
      const { accessToken, finalReply, rawEmail, subject } = await createOutgoingEmail();
      scheduleEmail({
        accessToken,
        raw: toBase64Url(rawEmail),
        threadId: thread.id,
        recipient,
        delaySeconds,
        onSent: () => {
          captureEvent({
            type: 'email_sent',
            source: 'gmail',
            title: `已发送回复给 ${recipient}`,
            summary: `主题：${subject}`,
            email: {
              to: recipient,
              subject,
              body: emailHtmlToText(finalReply),
            },
          });
          setCompletion('sent');
          onDraftSaved?.('');
        },
        onCancel: () => {
          setCompletion(null);
          setAiError('已取消发送，邮件内容仍保留在编辑器中。');
        },
        onError: (message) => {
          setCompletion(null);
          setAiError(message);
        },
      });
      setCompletion('scheduled');
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
            {completion === 'draft'
              ? '已保存到 Gmail 官方草稿箱'
              : completion === 'scheduled'
                ? '邮件已进入发送倒计时'
                : '邮件已发送'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {completion === 'draft'
              ? '关闭助手后，手动回复框也会保留这份草稿。'
              : completion === 'scheduled'
                ? '你可以在右下角查看真实倒计时，或在倒计时结束前取消发送。'
                : `邮件已直接发送给 ${recipientEmail}。`}
          </p>
        </div>
        {completion !== 'scheduled' && (
          <Button variant="outline" className="w-full" onClick={onClose}>关闭</Button>
        )}
      </div>
    );
  }

  const attachmentList = attachments.length > 0 ? (
    <div className={mode === 'ai'
      ? 'flex flex-wrap gap-2 rounded-lg border border-gray-200 bg-white p-2'
      : 'flex flex-col gap-2 rounded-md border bg-muted/20 p-2'}
    >
      {attachments.map((file, index) => (
        <div
          key={`${file.name}-${file.size}-${index}`}
          className={mode === 'ai'
            ? 'flex min-w-56 flex-1 items-center gap-2 rounded-md bg-gray-50 px-3 py-2'
            : 'flex items-center gap-2 rounded-md bg-background px-3 py-2'}
        >
          <Paperclip className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            title="移除附件"
            aria-label={`移除附件 ${file.name}`}
            onClick={() => {
              setAttachments((current) => current.filter((_, fileIndex) => fileIndex !== index));
              setAttachmentError('');
            }}
          >
            <X />
          </Button>
        </div>
      ))}
    </div>
  ) : null;

  const header = (
    <div className="flex h-12 shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          {mode === 'ai' ? <Sparkles className="size-4" /> : <Globe className="size-4" />}
        </span>
        <p className="truncate text-sm font-semibold">{mode === 'ai' ? 'AI 邮件助手' : '手动回复'}</p>
        {mode === 'ai' && analysis && (
          <Badge variant="outline" className="hidden border-gray-200 bg-white font-normal text-gray-600 sm:inline-flex">
            已分析 {historyMessages.length} 封邮件
          </Badge>
        )}
        {analysis && (
          <Badge variant="secondary" className="hidden bg-gray-100 font-normal text-gray-700 sm:inline-flex">
            来信：{analysis.languageName || targetLangName}
          </Badge>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => handleAttachmentSelection(event.target.files)}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
        title="添加附件"
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip data-icon="inline-start" />
        附件{attachments.length > 0 ? ` ${attachments.length}` : ''}
      </Button>
      {mode === 'ai' && onMinimize && (
        <Button variant="ghost" size="icon" className="size-8" title="缩小 AI 邮件助手" aria-label="缩小 AI 邮件助手" onClick={onMinimize}>
          <Minimize2 />
        </Button>
      )}
      <Button variant="ghost" size="icon" className="size-8" title="关闭回复助手" aria-label="关闭回复助手" onClick={onClose}>
        <X />
      </Button>
    </div>
  );

  const generationSettings = analysis ? (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
        <span className="shrink-0">回复语言</span>
        <select
          value={targetLang}
          className="h-9 min-w-36 rounded-md border border-gray-300 bg-white px-3 text-sm font-normal text-gray-900 outline-none transition hover:border-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={aiLoading || translatingEditedReply}
          onChange={(event) => {
            const language = LANGUAGE_OPTIONS.find(([code]) => code === event.target.value);
            setTargetLang(event.target.value);
            setTargetLangName(language?.[1] || event.target.value);
            setTranslationUpdated(false);
          }}
        >
          {LANGUAGE_OPTIONS.map(([code, name]) => (
            <option key={code} value={code}>
              {code === analysis.language ? `${name}（来信语言）` : name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
        <span className="shrink-0">回复语气</span>
        <select
          value={replyTone}
          className="h-9 min-w-28 rounded-md border border-gray-300 bg-white px-3 text-sm font-normal text-gray-900 outline-none transition hover:border-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={aiLoading || translatingEditedReply}
          onChange={(event) => setReplyTone(event.target.value as ReplyTone)}
        >
          {REPLY_TONE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
    </div>
  ) : null;

  const aiBody = (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      {(analysisLoading || settingsLoading) && (
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <Loader2 className="size-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">正在快速分析最近往来</p>
            <p className="text-xs text-muted-foreground">
              默认读取与该邮箱最近最多 {GMAIL_AI_HISTORY_LIMIT} 封邮件，不限于当前线程。
            </p>
          </div>
        </div>
      )}

      {analysisError && (
        <ErrorMessage message={analysisError}>
          <Button variant="outline" size="sm" onClick={analyzeThread}>重新分析</Button>
        </ErrorMessage>
      )}

      {attachmentList}
      {attachmentError && <p className="text-xs text-destructive">{attachmentError}</p>}

      {analysis && !suggestion && (
        <>
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">核心分析</h3>
                {analysis.stage && (
                  <Badge variant="secondary" className="bg-gray-100 font-normal text-gray-700">
                    {analysis.stage}
                  </Badge>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-gray-600">
                {analysis.latestSummary || '暂无明确摘要'}
              </p>
            </div>

            <div className="grid lg:grid-cols-2">
              <AnalysisSection
                title="当前合作判断"
                content={analysis.creatorIntent}
                secondary={analysis.attitude}
                className="border-b border-gray-100 lg:border-b-0 lg:border-r"
              />
              <AnalysisList
                title="推荐回复策略"
                items={analysis.replyStrategy}
                className="border-b border-gray-100 lg:border-b-0"
              />
              <AnalysisList
                title="待确认事项"
                items={analysis.openQuestions}
                emptyText="当前没有需要额外确认的事项"
                className="border-b border-gray-100 lg:border-b-0 lg:border-r lg:border-t"
              />
              <AnalysisList
                title="风险提醒"
                items={analysis.risks}
                emptyText="暂未发现明显风险"
                tone="warning"
                className="lg:border-t"
              />
            </div>
          </section>

          <Collapsible open={analysisExpanded} onOpenChange={setAnalysisExpanded} className="border-y border-gray-200 bg-white">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="h-10 w-full justify-between rounded-none px-1 font-normal text-gray-700 hover:bg-gray-50">
                <span className="text-sm">查看完整分析</span>
                {analysisExpanded ? <ChevronUp /> : <ChevronDown />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid border-t border-gray-100 sm:grid-cols-2">
                <AnalysisSection title="红人的态度" content={analysis.attitude} className="border-b border-gray-100 sm:border-r" />
                <AnalysisSection
                  title="沟通风格与当前情绪"
                  content={[
                    analysis.communicationStyle && `沟通风格：${analysis.communicationStyle}`,
                    analysis.currentEmotion && `当前情绪：${analysis.currentEmotion}`,
                  ].filter(Boolean).join('\n')}
                  className="border-b border-gray-100"
                />
                <AnalysisSection title="表面立场" content={analysis.statedPosition || ''} className="border-b border-gray-100 sm:border-r" />
                <AnalysisSection title="核心利益" content={analysis.coreInterests || ''} className="border-b border-gray-100" />
                <AnalysisList title="已确认事项" items={analysis.confirmedItems} className="border-b border-gray-100 sm:border-r" />
                <AnalysisList title="沟通雷区" items={analysis.communicationRisks} className="border-b border-gray-100" />
                <AnalysisList title="破局筹码" items={analysis.leverageOptions} className="sm:border-r" />
                <AnalysisList title="补充回复建议" items={analysis.replyStrategy} />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <section className="rounded-lg border border-gray-300 bg-white shadow-sm transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
            <div className="border-b border-gray-100 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label htmlFor="ai-reply-strategy" className="text-sm font-semibold text-gray-900">回复策略</label>
                  <p className="mt-0.5 text-xs text-gray-500">补充预算、底线、产品安排或需要对方确认的问题。</p>
                </div>
                <Badge variant="outline" className="shrink-0 border-gray-200 font-normal text-gray-500">必填</Badge>
              </div>
            </div>
            <Textarea
              id="ai-reply-strategy"
              value={userIdeas}
              onChange={(event) => setUserIdeas(event.target.value)}
              placeholder="例如：价格可以接受，但需要确认视频发布时间；请礼貌询问能否在月底前发布..."
              className="min-h-28 resize-y rounded-none border-0 bg-white px-4 py-3 shadow-none focus-visible:ring-0"
            />
            <div className="flex flex-wrap gap-1.5 border-t border-gray-100 px-3 py-2">
              {QUICK_REPLY_IDEAS.map(([label, text]) => (
                <Button
                  key={label}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 bg-gray-50 px-2.5 text-xs font-normal text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  onClick={() => setUserIdeas((current) => current ? `${current}\n${text}` : text)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>
          {aiError && <ErrorMessage message={aiError} />}
        </>
      )}

      {suggestion && (
        <>
          <section className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">回复草稿</h3>
                  <Badge variant="secondary" className="bg-gray-100 font-normal text-gray-700">
                    {generatedLangName || targetLangName}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">可直接编辑正文，发送前请核对价格、时间和承诺。</p>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0 text-gray-600 hover:bg-gray-100" onClick={copyToClipboard}>
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
            <AnalysisList
              title="本次回复要点"
              items={suggestion.keyPoints}
              className="border-b border-gray-100 bg-gray-50/70"
              compact
            />
            <RichEmailEditor
              value={replyContent}
              onChange={(value) => {
                setReplyContent(value);
                setTranslationUpdated(false);
              }}
              placeholder="编辑 AI 起草的邮件..."
              minHeight="13rem"
              className="rounded-none border-0 bg-white shadow-none focus-within:ring-2 focus-within:ring-inset focus-within:ring-primary/20"
            />
          </section>
          <Collapsible open={translationExpanded} onOpenChange={setTranslationExpanded} className="border-y border-gray-200 bg-white">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="h-10 w-full justify-between rounded-none px-1 font-normal text-gray-700 hover:bg-gray-50">
                <span>中文对照</span>
                {translationExpanded ? <ChevronUp /> : <ChevronDown />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {translationEditing ? (
                <div className="border-t border-gray-100 bg-white">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">编辑中文邮件</p>
                      <p className="mt-0.5 text-xs text-gray-500">修改完成后，AI 将只翻译这份中文，不会重新分析或改写你的商务决定。</p>
                    </div>
                    <Badge variant="outline" className="border-gray-200 font-normal text-gray-500">待确认</Badge>
                  </div>
                  <Textarea
                    value={editedChineseReply}
                    onChange={(event) => {
                      setEditedChineseReply(event.target.value);
                      setTranslationUpdated(false);
                    }}
                    placeholder="修改中文邮件正文..."
                    className="min-h-56 resize-y rounded-none border-0 bg-white px-4 py-3 text-sm leading-6 shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/20"
                    disabled={translatingEditedReply}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/70 px-4 py-3">
                    <p className="text-xs text-gray-500">将翻译为：{targetLangName}</p>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={translatingEditedReply}
                        onClick={() => {
                          setEditedChineseReply(suggestion.translatedReply);
                          setTranslationEditing(false);
                          setAiError('');
                        }}
                      >
                        取消
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!editedChineseReply.trim() || translatingEditedReply}
                        onClick={updateDraftFromChinese}
                      >
                        {translatingEditedReply
                          ? <Loader2 className="animate-spin" data-icon="inline-start" />
                          : <Languages data-icon="inline-start" />}
                        {translatingEditedReply ? '正在翻译...' : '根据中文更新外文'}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-t border-gray-100 bg-gray-50">
                  <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5">
                    <p className={`text-xs ${translationUpdated ? 'text-emerald-700' : 'text-gray-500'}`}>
                      {translationUpdated ? '外文草稿已按这份中文更新' : '可修改中文版本，再生成对应语言的外文草稿。'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 bg-white"
                      disabled={translatingEditedReply}
                      onClick={() => {
                        setEditedChineseReply(suggestion.translatedReply);
                        setTranslationEditing(true);
                        setTranslationUpdated(false);
                        setAiError('');
                      }}
                    >
                      编辑中文
                    </Button>
                  </div>
                  <div className="whitespace-pre-wrap px-4 py-3 text-sm leading-6 text-gray-700">
                    {suggestion.translatedReply}
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
          {aiError && <ErrorMessage message={aiError} />}
        </>
      )}
    </div>
  );

  if (mode === 'ai') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-white text-gray-900">
        {header}
        <ScrollArea className="min-h-0 flex-1 bg-[#F7F8FA]">{aiBody}</ScrollArea>
        <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.035)]">
          {analysis && !suggestion ? (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {generationSettings}
              <Button className="shrink-0" onClick={generateReply} disabled={!userIdeas.trim() || aiLoading}>
                {aiLoading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />}
                {aiLoading ? '正在生成草稿...' : '生成邮件草稿'}
              </Button>
            </div>
          ) : suggestion ? (
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              {generationSettings}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className={`mr-1 text-xs ${recipientEmail ? 'text-gray-500' : 'text-red-600'}`}>
                  收件人：{recipientEmail || '未找到可用的红人邮箱'}
                </span>
                <Button
                  variant="ghost"
                  className="text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  disabled={aiLoading || translatingEditedReply || translationEditing || sending || savingDraft}
                  onClick={() => {
                    setSuggestion(null);
                    setTranslationEditing(false);
                    setTranslationUpdated(false);
                    setAiError('');
                  }}
                >
                  调整策略
                </Button>
                <Button
                  variant="outline"
                  onClick={generateReply}
                  disabled={!userIdeas.trim() || aiLoading || translatingEditedReply || translationEditing || sending || savingDraft}
                >
                  {aiLoading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                  {aiLoading ? '重新生成中...' : '重新生成'}
                </Button>
                <Button
                  variant="outline"
                  onClick={sendEmail}
                  disabled={!recipientEmail || aiLoading || translatingEditedReply || translationEditing || sending || savingDraft || isEmailContentEmpty(replyContent)}
                >
                  {sending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                  直接发送
                </Button>
                <Button onClick={saveToGmailDrafts} disabled={!recipientEmail || aiLoading || translatingEditedReply || translationEditing || savingDraft || sending || isEmailContentEmpty(replyContent)}>
                  {savingDraft ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                  保存 Gmail 草稿
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-center text-xs text-muted-foreground">分析完成后可在这里生成回复</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Badge variant="secondary" className="gap-1">
          <Globe className="size-3" />
          手动回复
        </Badge>
        <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="关闭手动回复">
          <X />
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => handleAttachmentSelection(event.target.files)}
      />
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">附件</label>
        <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
          <Paperclip data-icon="inline-start" />
          添加附件
        </Button>
      </div>
      {attachmentList}
      <p className="text-xs text-muted-foreground">支持图片、PDF、文档等常见文件，附件总大小上限为 18 MB。</p>
      {attachmentError && <p className="text-xs text-destructive">{attachmentError}</p>}
      <RichEmailEditor value={replyContent} onChange={setReplyContent} placeholder="输入回复内容..." minHeight="12rem" />
      {aiError && <ErrorMessage message={aiError} />}
      <p className={`text-xs ${recipientEmail ? 'text-muted-foreground' : 'text-destructive'}`}>
        回复收件人：{recipientEmail || '未找到可用的红人邮箱，Mailsuite 等系统通知邮箱已排除'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={sendEmail} disabled={!recipientEmail || sending || savingDraft || isEmailContentEmpty(replyContent)}>
          {sending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
          直接发送
        </Button>
        <Button onClick={saveToGmailDrafts} disabled={!recipientEmail || savingDraft || sending || isEmailContentEmpty(replyContent)}>
          {savingDraft ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <ArrowRight data-icon="inline-start" />}
          保存为草稿
        </Button>
      </div>
    </div>
  );
}

function AnalysisSection({
  title,
  content,
  secondary,
  className = '',
}: {
  title: string;
  content: string;
  secondary?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 p-4 ${className}`}>
      <p className="text-xs font-medium text-gray-500">{title}</p>
      <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-gray-900">{content || '暂无明确结论'}</p>
      {secondary && <p className="mt-2 text-xs leading-5 text-gray-500">态度：{secondary}</p>}
    </div>
  );
}

function AnalysisList({
  title,
  items,
  emptyText,
  tone = 'default',
  compact = false,
  className = '',
}: {
  title: string;
  items?: string[];
  emptyText?: string;
  tone?: 'default' | 'warning';
  compact?: boolean;
  className?: string;
}) {
  if (!items?.length && !emptyText) return null;
  const warning = tone === 'warning';

  return (
    <div className={`${compact ? 'px-4 py-2.5' : 'p-4'} ${warning ? 'bg-[#FFF7ED]' : ''} ${className}`}>
      <p className={`text-xs font-medium ${warning ? 'text-amber-700' : 'text-gray-500'}`}>{title}</p>
      {items?.length ? (
        <ul className={`flex flex-col ${compact ? 'mt-1.5 gap-1' : 'mt-2 gap-1.5'}`}>
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className={`flex gap-2 text-sm leading-5 ${warning ? 'text-amber-950' : 'text-gray-700'}`}>
              <span className={`mt-2 size-1.5 shrink-0 rounded-full ${warning ? 'bg-amber-500' : 'bg-primary/70'}`} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`mt-1.5 text-sm ${warning ? 'text-amber-900/75' : 'text-gray-500'}`}>{emptyText}</p>
      )}
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
