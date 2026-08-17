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
  Maximize2,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  scopeGmailAIMessagesToReplyTarget,
  type GmailAIHistoryMessage,
} from '@/lib/gmail-ai-reply';
import { isIgnoredGmailThreadSender } from '@/lib/gmail-thread-contact';
import {
  buildGmailReplyReferences,
  buildGmailReplySubject,
  type GmailReplyTarget,
} from '@/lib/gmail-reply-target';
import {
  isGmailBilingualDraftForeignEdited,
  type GmailBilingualDraftSnapshot,
  type GmailTemplateDraftResult,
} from '@/lib/gmail-bilingual-draft';
import { getAIReplyTemplates, type AIReplyTemplate } from '@/lib/ai-reply-templates';
import { useEmailDrafts, useEmailTemplates, useGmailAuth, useSettings } from '@/lib/data';
import type { GmailThread } from '@/lib/types';
import { AIReplyTemplateManager } from './ai-reply-template-manager';
import { RichEmailEditor } from './rich-email-editor';
import { useEmailGenerationTasks } from './email-generation-task-provider';
import { buildGmailEmailGenerationTaskKey } from '@/lib/email-generation-tasks';

type ReplyTone = 'friendly' | 'formal' | 'casual';

type TemplateSuggestion = GmailTemplateDraftResult;

type GmailTemplateReplyTaskResult = {
  suggestion: TemplateSuggestion;
  targetLang: string;
};

const LANGUAGE_OPTIONS = [
  ['en', '英语'], ['es', '西班牙语'], ['nl', '荷兰语'], ['de', '德语'],
  ['fr', '法语'], ['pt', '葡萄牙语'], ['pl', '波兰语'], ['it', '意大利语'],
  ['sv', '瑞典语'], ['da', '丹麦语'], ['no', '挪威语'], ['fi', '芬兰语'],
  ['cs', '捷克语'], ['ro', '罗马尼亚语'], ['uk', '乌克兰语'], ['ru', '俄语'],
] as const;

function buildThreadMessages(
  thread: GmailThread,
  target: GmailReplyTarget | null,
): GmailAIHistoryMessage[] {
  const messages = thread.messages
    .filter((message) => !isIgnoredGmailThreadSender(message.from))
    .map((message) => ({
      id: message.id,
      threadId: message.threadId,
      subject: message.subject || thread.subject,
      from: message.from,
      to: message.to,
      cc: message.cc,
      replyTo: message.replyTo,
      date: message.date,
      body: message.body,
    }));
  return target
    ? scopeGmailAIMessagesToReplyTarget(messages, target.messageId, target.date)
    : messages;
}

function toneLabel(tone: ReplyTone) {
  if (tone === 'formal') return '正式专业';
  if (tone === 'casual') return '轻松亲切';
  return '自然友好';
}

export function AITemplateReplyComposer({
  thread,
  replyTarget,
  onMinimize,
  onClose,
  onDraftSaved,
  autoRetryRequest,
  avatarUrl,
}: {
  thread: GmailThread;
  replyTarget: GmailReplyTarget | null;
  onMinimize?: () => void;
  onClose: () => void;
  onDraftSaved?: (content: string) => void;
  autoRetryRequest?: { taskId: string; retryInput?: unknown };
  avatarUrl?: string;
}) {
  const { templates, addTemplate, updateTemplate, deleteTemplate } = useEmailTemplates();
  const { addDraft } = useEmailDrafts();
  const { auth, connect } = useGmailAuth();
  const { settings, loading: settingsLoading } = useSettings();
  const { enqueueTask, getLatestTaskByKey, updateTaskAvatarByKey } = useEmailGenerationTasks();
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
  const [editedChineseReply, setEditedChineseReply] = useState('');
  const [synchronizedDraft, setSynchronizedDraft] = useState<GmailBilingualDraftSnapshot | null>(null);
  const [chineseDirty, setChineseDirty] = useState(false);
  const [translatingChinese, setTranslatingChinese] = useState(false);
  const [translationUpdated, setTranslationUpdated] = useState(false);
  const [syncedTargetLang, setSyncedTargetLang] = useState('');
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(true);
  const [managerOpen, setManagerOpen] = useState(false);
  const [factEditorOpen, setFactEditorOpen] = useState(false);
  const factEditorTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const appliedGenerationTaskRef = useRef('');
  const chineseTranslationRef = useRef<AbortController | null>(null);
  const restoringTaskSettingsRef = useRef(false);
  const handledAutoRetryTaskRef = useRef('');

  const threadMessages = useMemo(() => buildThreadMessages(thread, replyTarget), [replyTarget, thread]);
  const externalMessage = replyTarget?.message;
  const recipientEmail = replyTarget?.recipientEmail || '';
  const languageName = LANGUAGE_OPTIONS.find(([code]) => code === targetLang)?.[1] || targetLang;
  const targetLanguageChanged = Boolean(suggestion && syncedTargetLang && syncedTargetLang !== targetLang);
  const translationOutOfSync = chineseDirty || targetLanguageChanged;
  const foreignManuallyEdited = isGmailBilingualDraftForeignEdited({
    snapshot: synchronizedDraft,
    foreignBody: replyContent,
  });
  const generationTaskKey = buildGmailEmailGenerationTaskKey({
    kind: 'gmail_template_reply',
    threadId: thread.id,
    messageId: replyTarget?.messageId,
  });
  const generationTask = getLatestTaskByKey(generationTaskKey);

  useEffect(() => {
    if (avatarUrl) updateTaskAvatarByKey(generationTaskKey, avatarUrl);
  }, [avatarUrl, generationTaskKey, updateTaskAvatarByKey]);

  useEffect(() => {
    const detected = detectEmailLanguage(externalMessage?.body || '');
    const option = LANGUAGE_OPTIONS.find(([code]) => code === detected);
    if (option) setTargetLang(option[0]);
  }, [externalMessage?.body, thread.id]);

  useEffect(() => {
    if (!selectedTemplate) return;
    if (restoringTaskSettingsRef.current) {
      restoringTaskSettingsRef.current = false;
      return;
    }
    setReplyTone(selectedTemplate.defaultTone);
  }, [selectedTemplate]);

  useEffect(() => {
    if (!factEditorOpen) return;
    const editor = factEditorTextareaRef.current;
    if (!editor) return;
    editor.focus();
    const end = editor.value.length;
    editor.setSelectionRange(end, end);
  }, [factEditorOpen]);

  useEffect(() => () => {
    chineseTranslationRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!generationTask) return;
    const rollback = generationTask.rollbackResult as {
      replyContent?: string;
      suggestion?: TemplateSuggestion | null;
      editedChineseReply?: string;
      chineseDirty?: boolean;
      translationUpdated?: boolean;
      syncedTargetLang?: string;
      synchronizedDraft?: GmailBilingualDraftSnapshot | null;
    } | undefined;
    const replacingExistingDraft = Boolean(
      rollback?.replyContent?.trim() || rollback?.editedChineseReply?.trim(),
    );
    if (generationTask.status === 'queued' || generationTask.status === 'running') {
      setLoading(true);
      setError('');
      setStage(generationTask.stage);
      const partial = generationTask.partialResult as TemplateSuggestion | undefined;
      if (!replacingExistingDraft && partial?.suggestedReply) setReplyContent(partial.suggestedReply);
      return;
    }
    if (appliedGenerationTaskRef.current === generationTask.id) return;
    appliedGenerationTaskRef.current = generationTask.id;
    setLoading(false);
    setStage('');

    if (generationTask.status === 'failed' || generationTask.status === 'interrupted') {
      if (generationTask.status === 'interrupted') {
        const retryInput = generationTask.retryInput as {
          selectedTemplateId?: string;
          userIdeas?: string;
          targetLang?: string;
          replyTone?: ReplyTone;
        } | undefined;
        setUserIdeas((current) => current.trim() ? current : retryInput?.userIdeas || '');
        if (retryInput?.selectedTemplateId && retryInput.selectedTemplateId !== selectedTemplateId) {
          restoringTaskSettingsRef.current = true;
          setSelectedTemplateId(retryInput.selectedTemplateId);
        }
        if (retryInput?.targetLang) setTargetLang(retryInput.targetLang);
        if (retryInput?.replyTone) setReplyTone(retryInput.replyTone);
      }
      setReplyContent(rollback?.replyContent || '');
      setSuggestion(rollback?.suggestion || null);
      setEditedChineseReply(rollback?.editedChineseReply || '');
      setChineseDirty(Boolean(rollback?.chineseDirty));
      setTranslationUpdated(Boolean(rollback?.translationUpdated));
      setSyncedTargetLang(rollback?.syncedTargetLang || '');
      setSynchronizedDraft(rollback?.synchronizedDraft || null);
      setError(generationTask.error || '任务已中断，请重新点击生成。');
      return;
    }
    if (generationTask.status !== 'completed') return;
    const result = generationTask.result as GmailTemplateReplyTaskResult | undefined;
    if (!result?.suggestion?.suggestedReply) return;
    setTargetLang(result.targetLang);
    setSuggestion(result.suggestion);
    setReplyContent(result.suggestion.suggestedReply);
    setEditedChineseReply(result.suggestion.translatedReply || '');
    setSynchronizedDraft({
      foreignBody: result.suggestion.suggestedReply,
      chineseBody: result.suggestion.translatedReply || '',
      targetLanguage: result.targetLang,
    });
    setChineseDirty(false);
    setTranslationUpdated(false);
    setSyncedTargetLang(result.targetLang);
    setTranslationOpen(true);
    setError('');
  }, [generationTask, selectedTemplateId]);

  const getAccessToken = async (signal?: AbortSignal) => {
    if (!auth?.accessToken) throw new Error('请先连接 Gmail。');
    if (auth.expiresAt && auth.expiresAt > Date.now() + 60_000) return auth.accessToken;
    const response = await fetch('/api/auth/refresh', { method: 'POST', signal });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) {
      throw new Error(result.error || 'Gmail 授权已过期，请重新连接。');
    }
    connect({ ...auth, accessToken: result.data.accessToken, expiresAt: result.data.expiresAt });
    return result.data.accessToken as string;
  };

  const loadContactHistory = async (signal?: AbortSignal) => {
    const cacheKey = buildGmailAIHistoryCacheKey({
      accountEmail: auth?.email,
      threadId: thread.id,
      contactEmail: recipientEmail || 'no-recipient',
      targetMessageId: replyTarget?.messageId,
      latestMessageDate: replyTarget?.date,
    });
    const loaded = await getOrLoadGmailAIHistory(cacheKey, async () => {
      if (!recipientEmail || !replyTarget) return threadMessages;
      const accessToken = await getAccessToken(signal);
      const response = await fetch('/api/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          action: 'contactHistory',
          accessToken,
          contactEmail: recipientEmail,
          maxResults: GMAIL_AI_HISTORY_LIMIT,
          knownMessageIds: thread.messages.map((message) => message.id).filter(Boolean),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '读取联系人历史邮件失败。');
      const scopedFetched = scopeGmailAIMessagesToReplyTarget(
        result.data || [],
        replyTarget.messageId,
        replyTarget.date,
      );
      const merged = mergeRecentGmailAIMessages(scopedFetched, threadMessages);
      return scopeGmailAIMessagesToReplyTarget(
        merged,
        replyTarget.messageId,
        replyTarget.date,
      );
    });
    return loaded.value;
  };

  const baseAIPayload = (history: GmailAIHistoryMessage[], template: AIReplyTemplate) => ({
    threadSubject: replyTarget?.subject || thread.subject,
    threadMessages: history,
    targetMessageId: replyTarget?.messageId || '',
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

  const generate = () => {
    if (!selectedTemplate || !userIdeas.trim() || settingsLoading) return;
    chineseTranslationRef.current?.abort();
    const previousContent = replyContent;
    const previousSuggestion = suggestion;
    const previousChineseReply = editedChineseReply;
    const previousChineseDirty = chineseDirty;
    const previousTranslationUpdated = translationUpdated;
    const previousSyncedTargetLang = syncedTargetLang;
    const previousSynchronizedDraft = synchronizedDraft;
    const replacingExistingDraft = Boolean(previousContent.trim() || previousChineseReply.trim());
    const senderLabel = String(externalMessage?.from || recipientEmail || '邮件联系人')
      .replace(/<[^>]+>.*$/, '')
      .replace(/^"|"$/g, '')
      .trim() || recipientEmail || '邮件联系人';
    const taskId = enqueueTask({
      key: generationTaskKey,
      kind: 'gmail_template_reply',
      title: senderLabel,
      description: 'AI 模板回复',
      avatarUrl,
      navigation: {
        view: 'gmail',
        threadId: thread.id,
        messageId: replyTarget?.messageId,
        composerMode: 'template',
      },
      initialStage: '等待生成',
      rollbackResult: {
        replyContent: previousContent,
        suggestion: previousSuggestion,
        editedChineseReply: previousChineseReply,
        chineseDirty: previousChineseDirty,
        translationUpdated: previousTranslationUpdated,
        syncedTargetLang: previousSyncedTargetLang,
        synchronizedDraft: previousSynchronizedDraft,
      },
      retryInput: {
        selectedTemplateId: selectedTemplate.id,
        userIdeas: userIdeas.trim(),
        targetLang,
        replyTone,
      },
      run: async ({ signal, report }) => {
        const controller = { signal };
        setLoading(true);
        setTranslatingChinese(false);
        setDraftSaved(false);
        setError('');
        report('正在读取最近邮件上下文');
    setStage('正在读取最近邮件上下文');

    try {
      const history = await loadContactHistory(controller.signal);
      let finalResult: TemplateSuggestion | null = null;
      let streamError = '';
      let streamedBody = '';
      setStage('正在生成外文邮件');
      report('正在生成外文邮件');
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
          if (eventName === 'stage') {
            const nextStage = String(event.label || '正在生成草稿');
            setStage(nextStage);
            report(nextStage);
          }
          if (eventName === 'delta') {
            streamedBody += String(event.text || '');
            if (!replacingExistingDraft) setReplyContent(streamedBody);
            report('正在生成外文邮件', {
              suggestedReply: streamedBody,
              translatedReply: '',
              tone: replyTone,
            } satisfies TemplateSuggestion);
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
        setStage('正在生成外文邮件');
        report('流式生成不可用，正在使用兼容模式');
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
      });
      setReplyContent(cleanReply);
      setEditedChineseReply(finalResult.translatedReply || '');
      setSynchronizedDraft({
        foreignBody: cleanReply,
        chineseBody: finalResult.translatedReply || '',
        targetLanguage: targetLang,
      });
      setChineseDirty(false);
      setTranslationUpdated(false);
      setSyncedTargetLang(targetLang);
      setTranslationOpen(true);
      return {
        suggestion: {
          ...finalResult,
          suggestedReply: cleanReply,
        },
        targetLang,
      } satisfies GmailTemplateReplyTaskResult;
    } catch (generationError) {
      if (controller.signal.aborted) return;
      setReplyContent(previousContent);
      setSuggestion(previousSuggestion);
      setEditedChineseReply(previousChineseReply);
      setChineseDirty(previousChineseDirty);
      setTranslationUpdated(previousTranslationUpdated);
      setSyncedTargetLang(previousSyncedTargetLang);
      setSynchronizedDraft(previousSynchronizedDraft);
      setError(generationError instanceof Error ? generationError.message : 'AI 生成失败，请稍后重试。');
      throw generationError;
    } finally {
      setLoading(false);
      setStage('');
    }
      },
    });
    if (taskId) {
      setLoading(true);
      setError('');
      setStage('等待生成');
    }
  };

  useEffect(() => {
    if (!autoRetryRequest || handledAutoRetryTaskRef.current === autoRetryRequest.taskId) return;
    const retryInput = autoRetryRequest.retryInput as {
      selectedTemplateId?: string;
      userIdeas?: string;
      targetLang?: string;
      replyTone?: ReplyTone;
    } | undefined;
    if (!retryInput?.userIdeas?.trim()) return;
    if (!userIdeas.trim()) {
      setUserIdeas(retryInput.userIdeas);
      if (retryInput.selectedTemplateId && retryInput.selectedTemplateId !== selectedTemplateId) {
        restoringTaskSettingsRef.current = true;
        setSelectedTemplateId(retryInput.selectedTemplateId);
      }
      if (retryInput.targetLang) setTargetLang(retryInput.targetLang);
      if (retryInput.replyTone) setReplyTone(retryInput.replyTone);
      return;
    }
    if (settingsLoading || loading || !selectedTemplate) return;
    handledAutoRetryTaskRef.current = autoRetryRequest.taskId;
    generate();
    // The task id guard makes this a single, explicit retry after navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRetryRequest, loading, selectedTemplate, selectedTemplateId, settingsLoading, userIdeas]);

  const updateDraftFromChinese = async () => {
    const confirmedChineseReply = editedChineseReply.trim();
    if (!confirmedChineseReply || !suggestion || !translationOutOfSync) return;
    if (foreignManuallyEdited && !window.confirm('根据中文更新外文会覆盖当前手动调整的外文，是否继续？')) return;
    chineseTranslationRef.current?.abort();
    const controller = new AbortController();
    chineseTranslationRef.current = controller;
    setTranslatingChinese(true);
    setTranslationUpdated(false);
    setDraftSaved(false);
    setError('');

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          action: 'translateEditedReply',
          editedChineseReply: confirmedChineseReply,
          targetLang,
          targetLangName: languageName,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        success?: boolean;
        data?: { suggestedReply?: string };
        error?: string;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '根据中文更新外文草稿失败。');
      }
      const translatedReply = stripConfiguredEmailSignature(
        String(result.data?.suggestedReply || ''),
        settings.emailSignature,
      );
      if (!translatedReply.trim()) throw new Error('AI 没有返回可用的外文正文。');
      if (controller.signal.aborted || chineseTranslationRef.current !== controller) return;

      setReplyContent(translatedReply);
      setSuggestion((current) => current ? {
        ...current,
        suggestedReply: translatedReply,
        translatedReply: confirmedChineseReply,
      } : current);
      setEditedChineseReply(confirmedChineseReply);
      setSynchronizedDraft({
        foreignBody: translatedReply,
        chineseBody: confirmedChineseReply,
        targetLanguage: targetLang,
      });
      setChineseDirty(false);
      setTranslationUpdated(true);
      setSyncedTargetLang(targetLang);
    } catch (translationError) {
      if (controller.signal.aborted) return;
      setError(translationError instanceof Error
        ? translationError.message
        : '根据中文更新外文草稿失败。');
    } finally {
      if (chineseTranslationRef.current === controller) {
        chineseTranslationRef.current = null;
        setTranslatingChinese(false);
      }
    }
  };

  const saveGmailDraft = async () => {
    if (isEmailContentEmpty(replyContent)) return;
    if (translationOutOfSync) {
      setError('中文内容已修改，请先点击“根据中文更新外文”，再保存 Gmail 草稿。');
      return;
    }
    if (!recipientEmail || !replyTarget) {
      setError('请先确认最终回复收件人，再保存 Gmail 草稿。');
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
      const subject = buildGmailReplySubject(replyTarget);
      const references = buildGmailReplyReferences(replyTarget);
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
                disabled={loading || translatingChinese}
                onValueChange={(value) => {
                  setSelectedTemplateId(value);
                  setSuggestion(null);
                  setReplyContent('');
                  setEditedChineseReply('');
                  setSynchronizedDraft(null);
                  setChineseDirty(false);
                  setTranslationUpdated(false);
                  setSyncedTargetLang('');
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
              <p className="mb-3 mt-1 text-xs text-muted-foreground">先快速记录；内容较多时打开专注编辑，减少周围信息干扰。</p>
              <Textarea
                aria-label="邮件事实"
                value={userIdeas}
                onChange={(event) => setUserIdeas(event.target.value)}
                placeholder="例如：产品今天已经发出，请他收到后告诉我，并确认大概什么时候可以拍摄。"
                className="h-28 min-h-28 max-h-28 resize-none overflow-y-auto px-3 py-3 text-sm leading-6 shadow-inner"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{userIdeas.length} 字</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2.5 text-primary hover:text-primary"
                  onClick={() => setFactEditorOpen(true)}
                >
                  <Maximize2 className="size-3.5" />打开大编辑器
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Select
                  value={targetLang}
                  disabled={loading || translatingChinese}
                  onValueChange={(value) => {
                    setTargetLang(value);
                    if (suggestion) {
                      setTranslationUpdated(false);
                      setDraftSaved(false);
                    }
                  }}
                >
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
              <Button className="mt-3 w-full" disabled={!selectedTemplate || !userIdeas.trim() || loading || translatingChinese || settingsLoading} onClick={generate}>
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
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">AI 会先生成外文邮件，再提供可编辑的中文对照供你确认。</p>
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

            {suggestion?.translatedReply && (
              <Collapsible open={translationOpen} onOpenChange={setTranslationOpen}>
                <div className="rounded-xl border bg-slate-50/60">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="h-10 w-full justify-between rounded-xl px-3">
                      <span>中文确认稿（可编辑）</span>
                      {translationOpen ? <ChevronUp /> : <ChevronDown />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="border-t bg-white">
                      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
                        <p className="text-xs text-muted-foreground">
                          直接修改中文；确认后再更新为{languageName}，输入过程中不会调用 AI。
                        </p>
                        <Badge
                          variant="outline"
                          className={translationOutOfSync
                            ? 'shrink-0 border-amber-200 bg-amber-50 text-amber-700'
                            : foreignManuallyEdited
                              ? 'shrink-0 border-blue-200 bg-blue-50 text-blue-700'
                            : translationUpdated
                              ? 'shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'shrink-0'}
                        >
                          {translationOutOfSync
                            ? '待更新外文'
                            : foreignManuallyEdited
                              ? '外文已手动调整'
                              : translationUpdated
                                ? '外文已同步'
                                : '中文对照'}
                        </Badge>
                      </div>
                      <Textarea
                        value={editedChineseReply}
                        onChange={(event) => {
                          setEditedChineseReply(event.target.value);
                          setChineseDirty(event.target.value.trim() !== suggestion.translatedReply.trim());
                          setTranslationUpdated(false);
                          setDraftSaved(false);
                        }}
                        placeholder="修改中文邮件正文..."
                        className="min-h-56 resize-y rounded-none border-0 px-3 py-3 text-sm leading-6 shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/20"
                        disabled={translatingChinese}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-slate-50/70 px-3 py-2.5">
                        <p className={`text-xs ${translationOutOfSync ? 'text-amber-700' : 'text-muted-foreground'}`}>
                          {targetLanguageChanged
                            ? `目标语言已改为${languageName}；请更新外文后再保存 Gmail 草稿。`
                            : chineseDirty
                              ? '中文已修改；更新外文成功前不能保存 Gmail 草稿。'
                              : foreignManuallyEdited
                                ? '外文已手动调整，中文对照可能未同步；可以直接保存 Gmail 草稿。'
                                : translationUpdated
                                  ? `上方外文已按这份中文更新为${languageName}。`
                                  : '请重点检查中文；无误可直接保存，修改后再由 AI 忠实更新外文。'}
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          disabled={!editedChineseReply.trim() || !translationOutOfSync || translatingChinese || loading}
                          onClick={updateDraftFromChinese}
                        >
                          {translatingChinese
                            ? <Loader2 className="animate-spin" />
                            : <Languages />}
                          {translatingChinese ? '正在翻译...' : '根据中文更新外文'}
                        </Button>
                      </div>
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
        <p className="truncate text-xs text-muted-foreground">收件人：{recipientEmail || '保存草稿前需确认'}</p>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" disabled={!userIdeas.trim() || loading || translatingChinese} onClick={generate}>
            <RefreshCw />重新生成
          </Button>
          <Button
            disabled={!recipientEmail || isEmailContentEmpty(replyContent) || savingDraft || loading || translatingChinese || translationOutOfSync || draftSaved}
            title={!recipientEmail ? '请先确认最终回复收件人' : translationOutOfSync ? '请先根据中文更新外文' : undefined}
            onClick={saveGmailDraft}
          >
            {savingDraft ? <Loader2 className="animate-spin" /> : draftSaved ? <CheckCircle2 /> : <Save />}
            {draftSaved ? '已保存草稿' : '保存 Gmail 草稿'}
          </Button>
        </div>
      </div>

      <Dialog open={factEditorOpen} onOpenChange={setFactEditorOpen}>
        <DialogContent
          className="flex h-[86dvh] flex-col overflow-hidden p-5 sm:h-[72dvh] sm:max-h-[760px]"
          style={{ width: 'calc(100vw - 2rem)', maxWidth: '64rem' }}
        >
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base">专注填写邮件事实</DialogTitle>
            <DialogDescription>像给同事讲事情一样写即可，不需要组织正式邮件语言。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <Textarea
              ref={factEditorTextareaRef}
              aria-label="邮件事实"
              value={userIdeas}
              onChange={(event) => setUserIdeas(event.target.value)}
              placeholder="例如：货今天已经发了，走 DHL，单号是 123456，预计下周二送达。请他收到后告诉我，并确认大概什么时候可以拍摄。"
              className="h-full min-h-0 resize-none px-4 py-3 text-base leading-7 shadow-inner"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">已输入 {userIdeas.length} 字</span>
            <Button type="button" onClick={() => setFactEditorOpen(false)}>完成填写</Button>
          </div>
        </DialogContent>
      </Dialog>

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
