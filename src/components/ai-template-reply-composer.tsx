'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Languages,
  Loader2,
  Minimize2,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  appendEmailSignature,
  applyPlainTextEmailSignature,
  emailHtmlToText,
  getEmailSignatureForContext,
  isEmailContentEmpty,
  stripConfiguredEmailSignature,
  textToEmailHtml,
} from '@/lib/email-content';
import { detectEmailLanguage } from '@/lib/email-language';
import {
  buildGmailAIHistoryCacheKey,
  getOrLoadGmailAIHistory,
  GMAIL_AI_HISTORY_LIMIT,
  mergeRecentGmailAIMessages,
  type GmailAIHistoryMessage,
} from '@/lib/gmail-ai-reply';
import { getGmailThreadContact, isIgnoredGmailThreadSender } from '@/lib/gmail-thread-contact';
import { getAIReplyTemplates, type AIReplyTemplate } from '@/lib/ai-reply-templates';
import { useEmailDrafts, useEmailTemplates, useGmailAuth, useSettings } from '@/lib/data';
import type { GmailThread } from '@/lib/types';
import { AIReplyTemplateManager } from './ai-reply-template-manager';
import { RichEmailEditor } from './rich-email-editor';

type ReplyTone = 'friendly' | 'formal' | 'casual';

type TemplateSuggestion = {
  suggestedReply: string;
  translatedReply: string;
  tone: ReplyTone;
  keyPoints: string[];
  missingInfo: string[];
  riskNotes: string[];
};

const LANGUAGE_OPTIONS = [
  ['en', '英语'], ['es', '西班牙语'], ['nl', '荷兰语'], ['de', '德语'],
  ['fr', '法语'], ['pt', '葡萄牙语'], ['pl', '波兰语'], ['it', '意大利语'],
  ['sv', '瑞典语'], ['da', '丹麦语'], ['no', '挪威语'], ['fi', '芬兰语'],
  ['cs', '捷克语'], ['ro', '罗马尼亚语'], ['uk', '乌克兰语'], ['ru', '俄语'],
] as const;

function buildThreadMessages(thread: GmailThread): GmailAIHistoryMessage[] {
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

function toneLabel(tone: ReplyTone) {
  if (tone === 'formal') return '正式专业';
  if (tone === 'casual') return '轻松亲切';
  return '自然友好';
}

export function AITemplateReplyComposer({
  thread,
  onMinimize,
  onClose,
  onDraftSaved,
}: {
  thread: GmailThread;
  onMinimize?: () => void;
  onClose: () => void;
  onDraftSaved?: (content: string) => void;
}) {
  const { templates, addTemplate, updateTemplate, deleteTemplate } = useEmailTemplates();
  const { addDraft } = useEmailDrafts();
  const { auth, connect } = useGmailAuth();
  const { settings, loading: settingsLoading } = useSettings();
  const aiTemplates = useMemo(() => getAIReplyTemplates(templates), [templates]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('ai-reply-logistics');
  const selectedTemplate = useMemo(
    () => aiTemplates.find((template) => template.id === selectedTemplateId) || aiTemplates[0],
    [aiTemplates, selectedTemplateId],
  );
  const [userIdeas, setUserIdeas] = useState('');
  const [targetLang, setTargetLang] = useState('en');
  const [replyTone, setReplyTone] = useState<ReplyTone>('friendly');
  const [replyContent, setReplyContent] = useState('');
  const [suggestion, setSuggestion] = useState<TemplateSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);
  const generationRef = useRef<AbortController | null>(null);

  const threadMessages = useMemo(() => buildThreadMessages(thread), [thread]);
  const threadContact = useMemo(
    () => getGmailThreadContact(thread, auth?.email),
    [auth?.email, thread],
  );
  const externalMessage = threadContact.message || [...thread.messages]
    .reverse()
    .find((message) => !isIgnoredGmailThreadSender(message.from));
  const recipientEmail = threadContact.emails[0] || '';
  const languageName = LANGUAGE_OPTIONS.find(([code]) => code === targetLang)?.[1] || targetLang;

  useEffect(() => {
    const detected = detectEmailLanguage(externalMessage?.body || '');
    const option = LANGUAGE_OPTIONS.find(([code]) => code === detected);
    if (option) setTargetLang(option[0]);
  }, [externalMessage?.body, thread.id]);

  useEffect(() => {
    if (selectedTemplate) setReplyTone(selectedTemplate.defaultTone);
  }, [selectedTemplate]);

  useEffect(() => () => generationRef.current?.abort(), []);

  const getAccessToken = async () => {
    if (!auth?.accessToken) throw new Error('请先连接 Gmail。');
    if (auth.expiresAt && auth.expiresAt > Date.now() + 60_000) return auth.accessToken;
    const response = await fetch('/api/auth/refresh', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) {
      throw new Error(result.error || 'Gmail 授权已过期，请重新连接。');
    }
    connect({ ...auth, accessToken: result.data.accessToken, expiresAt: result.data.expiresAt });
    return result.data.accessToken as string;
  };

  const loadContactHistory = async () => {
    if (!recipientEmail) throw new Error('未找到可用的红人邮箱；系统通知邮箱不会作为回复收件人。');
    const latest = [...threadMessages]
      .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime())
      .at(-1);
    const cacheKey = buildGmailAIHistoryCacheKey({
      accountEmail: auth?.email,
      contactEmail: recipientEmail,
      latestMessageId: latest?.id,
      latestMessageDate: latest?.date,
    });
    const loaded = await getOrLoadGmailAIHistory(cacheKey, async () => {
      const accessToken = await getAccessToken();
      const response = await fetch('/api/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'contactHistory',
          accessToken,
          contactEmail: recipientEmail,
          maxResults: GMAIL_AI_HISTORY_LIMIT,
          knownMessageIds: threadMessages.map((message) => message.id).filter(Boolean),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取联系人历史邮件失败。');
      return mergeRecentGmailAIMessages(result.data || [], threadMessages);
    });
    return loaded.value;
  };

  const baseAIPayload = (history: GmailAIHistoryMessage[], template: AIReplyTemplate) => ({
    threadSubject: thread.subject,
    threadMessages: history,
    templateReply: true,
    replyTemplate: template,
    userIdeas: userIdeas.trim(),
    targetLang,
    targetLangName: languageName,
    replyTone,
    gmailAccountEmail: auth?.email || '',
    draftPrompt: settings.aiDraftPrompt || settings.aiEmailPrompt || '',
    modelProvider: settings.modelProvider || 'builtin',
    customApiUrl: settings.customApiUrl || '',
    customModelName: settings.customModelName || '',
  });

  const generate = async () => {
    if (!selectedTemplate || !userIdeas.trim() || settingsLoading) return;
    generationRef.current?.abort();
    const controller = new AbortController();
    generationRef.current = controller;
    const previousContent = replyContent;
    const previousSuggestion = suggestion;
    setLoading(true);
    setDraftSaved(false);
    setError('');
    setStage('正在读取最近邮件上下文');

    try {
      const history = await loadContactHistory();
      let finalResult: TemplateSuggestion | null = null;
      let streamError = '';
      let streamedBody = '';
      setStage('正在按模板起草邮件');
      try {
        const response = await fetch('/api/ai/gmail-reply-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify(baseAIPayload(history, selectedTemplate)),
        });
        if (!response.ok || !response.body) throw new Error(`流式接口暂不可用 (${response.status})`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const handleEvent = (chunk: string) => {
          const eventName = chunk.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message';
          const dataText = chunk.split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s*/, ''))
            .join('\n');
          if (!dataText) return;
          const event = JSON.parse(dataText) as Record<string, unknown>;
          if (eventName === 'stage') setStage(String(event.label || '正在生成草稿'));
          if (eventName === 'delta') {
            streamedBody += String(event.text || '');
            setReplyContent(streamedBody);
          }
          if (eventName === 'final') finalResult = event as unknown as TemplateSuggestion;
          if (eventName === 'error') streamError = String(event.message || '流式生成失败');
        };
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split(/\r?\n\r?\n/);
          buffer = chunks.pop() || '';
          chunks.forEach(handleEvent);
        }
        buffer += decoder.decode();
        if (buffer.trim()) handleEvent(buffer);
        if (streamError) throw new Error(streamError);
        if (!finalResult) throw new Error('流式生成未返回完整草稿');
      } catch (streamFailure) {
        if (controller.signal.aborted) return;
        console.warn('[AI template reply stream fallback]', streamFailure);
        setStage('流式生成不可用，正在使用兼容模式');
        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            ...baseAIPayload(history, selectedTemplate),
            action: 'templateDraft',
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'AI 生成失败。');
        finalResult = result.data as TemplateSuggestion;
      }

      if (!finalResult) throw new Error('AI 没有返回可用草稿。');
      const cleanReply = stripConfiguredEmailSignature(finalResult.suggestedReply, settings.emailSignature);
      setSuggestion({
        ...finalResult,
        suggestedReply: cleanReply,
        keyPoints: finalResult.keyPoints || [],
        missingInfo: finalResult.missingInfo || [],
        riskNotes: finalResult.riskNotes || [],
      });
      setReplyContent(cleanReply);
      setTranslationOpen(true);
    } catch (generationError) {
      if (controller.signal.aborted) return;
      setReplyContent(previousContent);
      setSuggestion(previousSuggestion);
      setError(generationError instanceof Error ? generationError.message : 'AI 生成失败，请稍后重试。');
    } finally {
      if (generationRef.current === controller) generationRef.current = null;
      setLoading(false);
      setStage('');
    }
  };

  const saveGmailDraft = async () => {
    if (isEmailContentEmpty(replyContent)) return;
    if (!recipientEmail) {
      setError('未找到可用的红人邮箱；系统通知邮箱不会作为收件人。');
      return;
    }
    setSavingDraft(true);
    setError('');
    try {
      const accessToken = await getAccessToken();
      const cleanText = stripConfiguredEmailSignature(emailHtmlToText(replyContent), settings.emailSignature);
      const signature = getEmailSignatureForContext(
        settings.emailSignature,
        settings.emailSignatureScope,
        'regular',
      );
      const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
      const references = [externalMessage?.references, externalMessage?.rfcMessageId]
        .filter(Boolean)
        .join(' ');
      const response = await fetch('/api/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draft',
          accessToken,
          to: recipientEmail,
          subject,
          body: applyPlainTextEmailSignature(cleanText, signature),
          bodyHtml: appendEmailSignature(textToEmailHtml(cleanText), signature),
          threadId: thread.id,
          inReplyTo: externalMessage?.rfcMessageId,
          references,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '保存 Gmail 草稿失败。');
      addDraft({ to: recipientEmail, subject, body: cleanText });
      onDraftSaved?.(replyContent);
      setDraftSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 Gmail 草稿失败。');
    } finally {
      setSavingDraft(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">AI 模板起草</p>
          <p className="truncate text-xs text-muted-foreground">模板定规则，你补事实，AI 整理成标准合作邮件</p>
        </div>
        {onMinimize && (
          <Button variant="ghost" size="icon" title="最小化" onClick={onMinimize}><Minimize2 /></Button>
        )}
        <Button variant="ghost" size="icon" title="关闭" onClick={onClose}><X /></Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(280px,0.85fr)_minmax(380px,1.25fr)]">
          <div className="space-y-4">
            <div className="rounded-xl border bg-slate-50/70 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">1. 选择业务模板</p>
                  <p className="text-xs text-muted-foreground">模板只规定结构和边界，不会替你编造事实</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setManagerOpen(true)}>
                  <Settings2 />管理
                </Button>
              </div>
              <Select
                value={selectedTemplate?.id}
                onValueChange={(value) => {
                  setSelectedTemplateId(value);
                  setSuggestion(null);
                  setReplyContent('');
                  setDraftSaved(false);
                }}
              >
                <SelectTrigger className="w-full"><SelectValue placeholder="选择模板" /></SelectTrigger>
                <SelectContent>
                  {aiTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplate && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm leading-6 text-muted-foreground">{selectedTemplate.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedTemplate.requiredInfo.map((item) => (
                      <Badge key={item} variant="outline" className="font-normal">{item}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-xl border p-4">
              <p className="text-sm font-semibold">2. 用自己的话补充事实</p>
              <p className="mb-3 mt-1 text-xs text-muted-foreground">可以口语化输入，写清楚“发生了什么、想告诉对方什么、希望对方做什么”即可。</p>
              <Textarea
                value={userIdeas}
                onChange={(event) => setUserIdeas(event.target.value)}
                placeholder="例如：货今天已经发了，DHL，单号 123456，预计下周二到。请他收到后告诉我，并确认大概什么时候能拍。"
                className="min-h-32 resize-y"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Select value={targetLang} onValueChange={setTargetLang}>
                  <SelectTrigger className="w-full"><Languages /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGUAGE_OPTIONS.map(([code, label]) => (
                      <SelectItem key={code} value={code}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={replyTone} onValueChange={(value) => setReplyTone(value as ReplyTone)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="friendly">自然友好</SelectItem>
                    <SelectItem value="formal">正式专业</SelectItem>
                    <SelectItem value="casual">轻松亲切</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="mt-3 w-full" disabled={!selectedTemplate || !userIdeas.trim() || loading || settingsLoading} onClick={generate}>
                {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {loading ? stage || '正在生成' : '按模板生成邮件'}
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex min-h-9 items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">3. 检查并编辑草稿</p>
                <p className="text-xs text-muted-foreground">AI 只生成草稿，不会自动发送</p>
              </div>
              {suggestion && (
                <div className="flex gap-1.5">
                  <Badge variant="secondary">{languageName}</Badge>
                  <Badge variant="outline">{toneLabel(replyTone)}</Badge>
                </div>
              )}
            </div>

            {!replyContent && !loading ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed bg-slate-50/45 px-6 text-center">
                <Sparkles className="mb-3 size-7 text-primary/55" />
                <p className="text-sm font-medium">生成后，标准邮件会出现在这里</p>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">同时给出中文对照、缺失信息和发送前风险，方便你人工确认。</p>
              </div>
            ) : (
              <RichEmailEditor
                value={replyContent}
                onChange={(value) => {
                  setReplyContent(value);
                  setDraftSaved(false);
                }}
                placeholder="AI 邮件草稿"
                minHeight="16rem"
              />
            )}

            {suggestion?.keyPoints.length ? (
              <div className="rounded-xl border bg-white p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">本次回复已包含</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestion.keyPoints.map((item) => (
                    <Badge key={item} variant="secondary" className="font-normal">{item}</Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {suggestion?.missingInfo.length ? (
              <Alert className="border-amber-200 bg-amber-50/80 text-amber-950">
                <AlertTriangle />
                <AlertTitle>建议补充的信息</AlertTitle>
                <AlertDescription>
                  {suggestion.missingInfo.map((item) => <p key={item}>• {item}</p>)}
                </AlertDescription>
              </Alert>
            ) : null}
            {suggestion?.riskNotes.length ? (
              <Alert className="border-blue-200 bg-blue-50/70 text-blue-950">
                <AlertTriangle />
                <AlertTitle>发送前请确认</AlertTitle>
                <AlertDescription>
                  {suggestion.riskNotes.map((item) => <p key={item}>• {item}</p>)}
                </AlertDescription>
              </Alert>
            ) : null}
            {suggestion?.translatedReply && (
              <Collapsible open={translationOpen} onOpenChange={setTranslationOpen}>
                <div className="rounded-xl border bg-slate-50/60">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="h-10 w-full justify-between rounded-xl px-3">
                      <span>中文对照</span>
                      {translationOpen ? <ChevronUp /> : <ChevronDown />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t px-3 py-3 text-sm leading-6 whitespace-pre-wrap text-muted-foreground">
                      {suggestion.translatedReply}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )}
            {error && <Alert variant="destructive"><AlertTriangle /><AlertTitle>操作未完成</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
            {draftSaved && (
              <Alert className="border-emerald-200 bg-emerald-50/70 text-emerald-950">
                <CheckCircle2 /><AlertTitle>Gmail 草稿已保存</AlertTitle>
                <AlertDescription>请前往 Gmail 做最后检查并手动发送。</AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-white px-4 py-3">
        <p className="truncate text-xs text-muted-foreground">收件人：{recipientEmail || '未识别到有效邮箱'}</p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" disabled={!userIdeas.trim() || loading} onClick={generate}>
            <RefreshCw />重新生成
          </Button>
          <Button disabled={isEmailContentEmpty(replyContent) || savingDraft || loading || draftSaved} onClick={saveGmailDraft}>
            {savingDraft ? <Loader2 className="animate-spin" /> : draftSaved ? <CheckCircle2 /> : <Save />}
            {draftSaved ? '已保存草稿' : '保存 Gmail 草稿'}
          </Button>
        </div>
      </div>

      <AIReplyTemplateManager
        open={managerOpen}
        onOpenChange={setManagerOpen}
        templates={aiTemplates}
        onAdd={addTemplate}
        onUpdate={updateTemplate}
        onDelete={deleteTemplate}
        onSelect={(id) => {
          setSelectedTemplateId(id);
          setManagerOpen(false);
        }}
      />
    </div>
  );
}
