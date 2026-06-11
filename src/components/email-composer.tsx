'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Globe,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useEmailAISuggestions, useEmailDrafts, useGmailAuth, useSettings } from '@/lib/data';
import { GmailThread } from '@/lib/types';

interface EmailComposerProps {
  thread: GmailThread;
  mode: 'compose' | 'ai';
  onClose: () => void;
  initialMessage?: string;
}

type CollaborationAnalysis = {
  latestSummary: string;
  creatorIntent: string;
  stage: string;
  attitude: string;
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

function extractEmail(value: string) {
  return value.match(/<([^>]+)>/)?.[1] || value.split(',')[0]?.trim() || value;
}

function buildThreadMessages(thread: GmailThread) {
  return thread.messages.map((message) => ({
    from: message.from,
    to: message.to,
    date: message.date,
    body: message.body,
  }));
}

export function EmailComposer({ thread, mode, onClose, initialMessage }: EmailComposerProps) {
  const { addSuggestion } = useEmailAISuggestions();
  const { addDraft } = useEmailDrafts();
  const { auth, connect } = useGmailAuth();
  const { settings } = useSettings();
  const [replyContent, setReplyContent] = useState(initialMessage || '');
  const [userIdeas, setUserIdeas] = useState('');
  const [analysis, setAnalysis] = useState<CollaborationAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(mode === 'ai');
  const [analysisError, setAnalysisError] = useState('');
  const [targetLang, setTargetLang] = useState('en');
  const [targetLangName, setTargetLangName] = useState('英语');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [suggestion, setSuggestion] = useState<AISuggestion | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const threadMessages = useMemo(() => buildThreadMessages(thread), [thread]);
  const lastMessage = thread.messages[thread.messages.length - 1];

  const externalMessage = useMemo(() => {
    const ownEmail = auth?.email?.toLowerCase();
    return [...thread.messages].reverse().find((message) => {
      const sender = extractEmail(message.from).toLowerCase();
      return !ownEmail || sender !== ownEmail;
    }) || lastMessage;
  }, [auth?.email, lastMessage, thread.messages]);

  const invokeAI = async (payload: Record<string, unknown>) => {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        threadSubject: thread.subject,
        threadMessages,
        customPrompt: settings.aiEmailPrompt || '',
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

  const analyzeThread = async () => {
    setAnalysisLoading(true);
    setAnalysisError('');
    setSuggestion(null);

    try {
      const result = await invokeAI({ action: 'analyze' }) as CollaborationAnalysis;
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
    if (mode === 'ai') analyzeThread();
    // The analysis should run once when the AI composer opens for this thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, thread.id]);

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
      }) as AISuggestion;
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

  const saveToGmailDrafts = async () => {
    const finalReply = replyContent.trim();
    if (!finalReply) return;
    setSavingDraft(true);
    setAiError('');

    try {
      const accessToken = await getAccessToken();
      const references = [externalMessage.references, externalMessage.rfcMessageId]
        .filter(Boolean)
        .join(' ');
      const response = await fetch('/api/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draft',
          accessToken,
          to: extractEmail(externalMessage.from),
          subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
          body: finalReply,
          threadId: thread.id,
          inReplyTo: externalMessage.rfcMessageId,
          references,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '保存 Gmail 草稿失败');
      }

      addDraft({
        to: extractEmail(externalMessage.from),
        subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
        body: finalReply,
      });
      setDraftSaved(true);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : '保存 Gmail 草稿失败');
    } finally {
      setSavingDraft(false);
    }
  };

  const copyToClipboard = async () => {
    if (!suggestion) return;
    await navigator.clipboard.writeText(suggestion.suggestedReply);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (draftSaved) {
    return (
      <div className="space-y-4 py-2 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
          <Check className="h-5 w-5 text-green-700" />
        </div>
        <div>
          <p className="font-medium">已保存到 Gmail 官方草稿箱</p>
          <p className="mt-1 text-sm text-muted-foreground">你可以在 Gmail 中检查并手动发送。</p>
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

      {mode === 'ai' && analysisLoading && (
        <div className="flex items-center gap-3 rounded-lg border p-4">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">正在分析完整邮件往来</p>
            <p className="text-xs text-muted-foreground">AI 正在判断红人意图、合作阶段和回复策略。</p>
          </div>
        </div>
      )}

      {analysisError && (
        <ErrorMessage message={analysisError}>
          <Button variant="outline" size="sm" onClick={analyzeThread}>重新分析</Button>
        </ErrorMessage>
      )}

      {mode === 'ai' && analysis && !suggestion && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <AnalysisItem title="最新邮件意思梗概" content={analysis.latestSummary} />
            <AnalysisItem title="红人的意图" content={analysis.creatorIntent} />
            <AnalysisItem title="当前合作进度" content={analysis.stage} />
            <AnalysisItem title="红人的态度" content={analysis.attitude} />
          </div>

          <AnalysisList title="已确认事项" items={analysis.confirmedItems} />
          <AnalysisList title="待解决事项" items={analysis.openQuestions} />
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
            <Textarea
              value={replyContent}
              onChange={(event) => setReplyContent(event.target.value)}
              className="min-h-44 resize-y"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">中文对照</label>
            <div className="whitespace-pre-wrap rounded-lg bg-muted/50 p-4 text-sm">
              {suggestion.translatedReply}
            </div>
          </div>
          {aiError && <ErrorMessage message={aiError} />}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setSuggestion(null);
                setAiError('');
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              调整想法
            </Button>
            <Button className="flex-1" onClick={saveToGmailDrafts} disabled={savingDraft || !replyContent.trim()}>
              {savingDraft ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              保存到 Gmail 草稿
            </Button>
          </div>
        </div>
      )}

      {mode === 'compose' && (
        <div className="space-y-4">
          <Textarea
            value={replyContent}
            onChange={(event) => setReplyContent(event.target.value)}
            placeholder="输入回复内容..."
            className="min-h-44 resize-y"
          />
          {aiError && <ErrorMessage message={aiError} />}
          <Button className="w-full" onClick={saveToGmailDrafts} disabled={savingDraft || !replyContent.trim()}>
            {savingDraft ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
            保存到 Gmail 草稿
          </Button>
        </div>
      )}
    </div>
  );
}

function AnalysisItem({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="mt-1 text-sm leading-6">{content || '暂无明确结论'}</p>
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
