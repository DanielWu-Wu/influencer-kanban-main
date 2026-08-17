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
  getEmailSignatureForContext,
  isEmailContentEmpty,
  stripConfiguredEmailSignature,
  toBase64Url,
} from '@/lib/email-content';
import { detectEmailLanguage } from '@/lib/email-language';
import {
  buildGmailAIAnalysisCacheKey,
  buildGmailAIThreadMessages,
  getOrLoadGmailAIAnalysis,
  loadGmailAIContactHistory,
  type GmailAIHistoryMessage,
} from '@/lib/gmail-ai-reply';
import {
  buildGmailReplyReferences,
  buildGmailReplySubject,
  type GmailReplyTarget,
} from '@/lib/gmail-reply-target';
import {
  isGmailBilingualDraftForeignEdited,
  isGmailBilingualDraftTranslationCurrent,
  type GmailBilingualDraftSnapshot,
} from '@/lib/gmail-bilingual-draft';
import { GmailThread } from '@/lib/types';
import { RichEmailEditor } from './rich-email-editor';
import { useDelayedEmailSender } from './delayed-email-provider';
import { useRecordAssistant } from './record-assistant-provider';
import { useEmailGenerationTasks } from './email-generation-task-provider';
import { buildGmailEmailGenerationTaskKey } from '@/lib/email-generation-tasks';

interface EmailComposerProps {
  thread: GmailThread;
  replyTarget: GmailReplyTarget | null;
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

type GmailAIReplyTaskResult = {
  suggestion: AISuggestion;
  targetLang: string;
  targetLangName: string;
  usedAnalysis: boolean;
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
const QUICK_REPLY_IDEAS = [
  ['接受报价', '可以接受对方的报价和合作条件。'],
  ['需要降价', '当前报价超出预算，请礼貌协商更合适的价格。'],
  ['确认发布时间', '请确认视频预计发布时间和交付安排。'],
  ['询问数据', '请询问频道近期视频表现和受众数据。'],
] as const;

export function EmailComposer({
  thread,
  replyTarget,
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
  const { enqueueTask, getLatestTaskByKey } = useEmailGenerationTasks();
  const [replyContent, setReplyContent] = useState(initialMessage || '');
  const [userIdeas, setUserIdeas] = useState('');
  const [analysis, setAnalysis] = useState<CollaborationAnalysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(mode === 'ai');
  const [analysisError, setAnalysisError] = useState('');
  const [historyMessages, setHistoryMessages] = useState<GmailAIHistoryMessage[]>([]);
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
  const [synchronizedDraft, setSynchronizedDraft] = useState<GmailBilingualDraftSnapshot | null>(null);
  const [generationStage, setGenerationStage] = useState('');
  const [optimizationLoading, setOptimizationLoading] = useState(false);
  const [optimizationError, setOptimizationError] = useState('');
  const [optimizedSuggestion, setOptimizedSuggestion] = useState<AISuggestion | null>(null);
  const [draftUsedAnalysis, setDraftUsedAnalysis] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisRunRef = useRef(0);
  const generationRunRef = useRef(0);
  const optimizationRunRef = useRef(0);
  const appliedGenerationTaskRef = useRef('');
  const targetLangLockedRef = useRef(false);
  const targetContextKeyRef = useRef('');

  const threadMessages = useMemo(() => buildGmailAIThreadMessages(
    thread,
    replyTarget?.messageId,
    replyTarget?.date,
  ), [replyTarget?.date, replyTarget?.messageId, thread]);
  const externalMessage = replyTarget?.message;
  const recipientEmail = replyTarget?.recipientEmail || '';
  const targetContextKey = `${thread.id}:${replyTarget?.messageId || ''}`;
  const generationTaskKey = buildGmailEmailGenerationTaskKey({
    kind: 'gmail_ai_reply',
    threadId: thread.id,
    messageId: replyTarget?.messageId,
  });
  const generationTask = getLatestTaskByKey(generationTaskKey);
  const bilingualDraftTranslationCurrent = isGmailBilingualDraftTranslationCurrent({
    snapshot: synchronizedDraft,
    chineseBody: editedChineseReply,
    targetLanguage: targetLang,
  });
  const bilingualDraftForeignEdited = isGmailBilingualDraftForeignEdited({
    snapshot: synchronizedDraft,
    foreignBody: replyContent,
  });

  useEffect(() => {
    if (targetContextKeyRef.current !== targetContextKey) {
      targetContextKeyRef.current = targetContextKey;
      targetLangLockedRef.current = false;
    }
    if (targetLangLockedRef.current) return;

    const normalizedAccountEmail = String(auth?.email || '').trim().toLowerCase();
    const latestMessage = [...threadMessages].reverse().find((message) => (
      !normalizedAccountEmail
      || !String(message.from || '').toLowerCase().includes(normalizedAccountEmail)
    )) || threadMessages.at(-1);
    const detectedLanguage = detectEmailLanguage(
      `${latestMessage?.subject || ''}\n${latestMessage?.body || ''}`,
    );
    const knownLanguage = LANGUAGE_OPTIONS.find(([code]) => code === detectedLanguage);
    if (!knownLanguage) return;
    setTargetLang(knownLanguage[0]);
    setTargetLangName(knownLanguage[1]);
  }, [auth?.email, targetContextKey, threadMessages]);

  const invokeAI = async (
    payload: Record<string, unknown>,
    messages: GmailAIHistoryMessage[] = historyMessages.length ? historyMessages : threadMessages,
    signal?: AbortSignal,
  ) => {
    const response = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        ...payload,
        threadSubject: replyTarget?.subject || thread.subject,
        threadMessages: messages,
        targetMessageId: replyTarget?.messageId || '',
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

  const loadContactHistory = async (force = false) => {
    const loaded = await loadGmailAIContactHistory({
      accountEmail: auth?.email,
      thread,
      contactEmail: recipientEmail,
      targetMessageId: replyTarget?.messageId,
      targetMessageDate: replyTarget?.date,
      force,
    });
    return { messages: loaded.messages, historyKey: loaded.historyKey };
  };

  const analyzeThread = async (force = false) => {
    const runId = analysisRunRef.current + 1;
    analysisRunRef.current = runId;
    setAnalysisLoading(true);
    setAnalysisError('');
    setSuggestion(null);

    try {
      const { messages: contactHistory, historyKey } = await loadContactHistory(force);
      if (runId !== analysisRunRef.current) return;
      setHistoryMessages(contactHistory);
      const analysisKey = buildGmailAIAnalysisCacheKey(historyKey, {
        modelProvider: settings.modelProvider,
        customApiUrl: settings.customApiUrl,
        customModelName: settings.customModelName,
        analysisPrompt: settings.aiAnalysisPrompt,
      });
      const analysisStartedAt = performance.now();
      const loaded = await getOrLoadGmailAIAnalysis(
        analysisKey,
        () => invokeAI({ action: 'analyze' }, contactHistory) as Promise<CollaborationAnalysis>,
        force,
      );
      if (runId !== analysisRunRef.current) return;
      const result = loaded.value;
      console.info('[Gmail AI client analysis timing]', {
        cacheHit: loaded.cacheHit,
        totalMs: Math.round(performance.now() - analysisStartedAt),
      });
      const language = result.language || 'en';
      const knownLanguage = LANGUAGE_OPTIONS.find(([code]) => code === language);
      setAnalysis(result);
      if (!targetLangLockedRef.current) {
        setTargetLang(language);
        setTargetLangName(result.languageName || knownLanguage?.[1] || language);
      }
    } catch (error) {
      if (runId !== analysisRunRef.current) return;
      setAnalysisError(error instanceof Error ? error.message : '邮件分析失败，请稍后重试');
    } finally {
      if (runId === analysisRunRef.current) setAnalysisLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'ai' && !settingsLoading) void analyzeThread();
    // Re-run only when the selected reply anchor or confirmed recipient changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, recipientEmail, replyTarget?.messageId, settingsLoading, thread.id]);

  useEffect(() => () => {
    analysisRunRef.current += 1;
    optimizationRunRef.current += 1;
  }, [thread.id]);

  useEffect(() => {
    if (!generationTask) return;
    if (generationTask.status === 'queued' || generationTask.status === 'running') {
      setAiLoading(true);
      setAiError('');
      setGenerationStage(generationTask.stage);
      const partial = generationTask.partialResult as AISuggestion | undefined;
      if (partial?.suggestedReply) {
        setReplyContent(partial.suggestedReply);
        setSuggestion(partial);
        if (partial.translatedReply) {
          setEditedChineseReply(partial.translatedReply);
          setTranslationExpanded(true);
        }
      }
      return;
    }
    if (appliedGenerationTaskRef.current === generationTask.id) return;
    appliedGenerationTaskRef.current = generationTask.id;
    setAiLoading(false);
    setGenerationStage('');

    if (generationTask.status === 'failed') {
      const rollback = generationTask.rollbackResult as {
        suggestion?: AISuggestion | null;
        replyContent?: string;
      } | undefined;
      setSuggestion(rollback?.suggestion || null);
      setReplyContent(rollback?.replyContent || '');
      setAiError(generationTask.error || 'AI 生成失败，请稍后重试');
      return;
    }
    if (generationTask.status !== 'completed') return;
    const result = generationTask.result as GmailAIReplyTaskResult | undefined;
    if (!result?.suggestion?.suggestedReply) return;
    const completedSuggestion = result.suggestion;
    targetLangLockedRef.current = true;
    setTargetLang(result.targetLang);
    setTargetLangName(result.targetLangName);
    setSuggestion(completedSuggestion);
    setReplyContent(completedSuggestion.suggestedReply);
    setEditedChineseReply(completedSuggestion.translatedReply);
    setTranslationExpanded(true);
    setTranslationEditing(false);
    setTranslationUpdated(false);
    setSynchronizedDraft(completedSuggestion.translatedReply.trim() ? {
      foreignBody: completedSuggestion.suggestedReply,
      chineseBody: completedSuggestion.translatedReply,
      targetLanguage: result.targetLang,
    } : null);
    setDraftUsedAnalysis(result.usedAnalysis);
    setGeneratedLangName(result.targetLangName);
    setAiError('');
  }, [generationTask]);

  const translateDraftToChinese = async (
    text: string,
    signal: AbortSignal,
    onProgress: (translatedText: string) => void,
  ) => {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        text,
        sourceLang: targetLang,
        customPrompt: settings.translatePrompt || '',
        modelProvider: settings.modelProvider || 'builtin',
        customApiUrl: settings.customApiUrl || '',
        customModelName: settings.customModelName || '',
        stream: true,
      }),
    });

    const contentType = response.headers.get('content-type')?.toLowerCase() || '';
    if (!contentType.includes('text/event-stream')) {
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || '中文对照生成失败');
      const translatedText = String(result.data?.translatedText || '').trim();
      if (!translatedText) throw new Error('中文对照生成失败');
      onProgress(translatedText);
      return translatedText;
    }

    if (!response.ok || !response.body) throw new Error('中文对照服务没有返回可读取的结果');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let translatedText = '';
    let streamError = '';

    const handleBlock = (block: string) => {
      const eventName = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message';
      const dataText = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.replace(/^data:\s?/, ''))
        .join('\n');
      if (!dataText) return;
      try {
        const data = JSON.parse(dataText) as Record<string, unknown>;
        if (eventName === 'delta' && typeof data.text === 'string') {
          translatedText += data.text;
          onProgress(translatedText);
        } else if (eventName === 'final') {
          translatedText = String(data.translatedText || translatedText).trim();
          onProgress(translatedText);
        } else if (eventName === 'metrics') {
          console.info('[Gmail AI staged translation timing]', data);
        } else if (eventName === 'error') {
          streamError = String(data.message || '中文对照生成失败');
        }
      } catch {
        // Ignore malformed keepalive events and continue consuming valid translation chunks.
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      blocks.forEach(handleBlock);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleBlock(buffer);
    if (streamError) throw new Error(streamError);
    if (!translatedText.trim()) throw new Error('中文对照服务没有返回可用内容');
    return translatedText.trim();
  };

  const generateReply = () => {
    if (!userIdeas.trim()) return;
    const generationMessages = historyMessages.length ? historyMessages : threadMessages;
    if (generationMessages.length === 0) {
      setAiError('当前邮件还没有可用于起草的正文，请稍后重试。');
      return;
    }
    targetLangLockedRef.current = true;
    const previousSuggestion = suggestion;
    const previousReplyContent = replyContent;
    const senderLabel = String(externalMessage?.from || recipientEmail || '邮件联系人')
      .replace(/<[^>]+>.*$/, '')
      .replace(/^"|"$/g, '')
      .trim() || recipientEmail || '邮件联系人';
    const taskId = enqueueTask({
      key: generationTaskKey,
      kind: 'gmail_ai_reply',
      title: senderLabel,
      description: 'AI 辅助回复',
      navigation: {
        view: 'gmail',
        threadId: thread.id,
        messageId: replyTarget?.messageId,
        composerMode: 'ai',
      },
      initialStage: '等待生成',
      rollbackResult: {
        suggestion: previousSuggestion,
        replyContent: previousReplyContent,
      },
      run: async ({ signal, report }) => {
        const controller = { signal };
        const runId = generationRunRef.current + 1;
        generationRunRef.current = runId;
        setAiLoading(true);
        setAiError('');
        setOptimizedSuggestion(null);
        setOptimizationError('');
        report('正在准备邮件上下文');
    setGenerationStage('正在准备邮件上下文');

    try {
      const startedAt = performance.now();
      let firstDeltaAt = 0;
      let streamedBody = '';
      let streamedTranslation = '';
      let pendingBody = '';
      let pendingTranslation = '';
      let lastUiUpdateAt = 0;
      let streamUiTimeout: number | undefined;
      let finalResult: AISuggestion | null = null;
      let streamError = '';
      let streamedBodyComplete = false;

      const flushStreamUi = () => {
        if (runId !== generationRunRef.current) return;
        streamUiTimeout = undefined;
        lastUiUpdateAt = performance.now();
        const visibleBody = pendingBody;
        setReplyContent(visibleBody);
        setSuggestion({
          suggestedReply: visibleBody,
          translatedReply: pendingTranslation,
          tone: replyTone,
          keyPoints: [],
        });
        report('正在生成回复正文', {
          suggestedReply: visibleBody,
          translatedReply: pendingTranslation,
          tone: replyTone,
          keyPoints: [],
        } satisfies AISuggestion);
      };

      const queueStreamUiFlush = () => {
        const elapsed = performance.now() - lastUiUpdateAt;
        if (elapsed >= 80) {
          if (streamUiTimeout) window.clearTimeout(streamUiTimeout);
          flushStreamUi();
        } else if (!streamUiTimeout) {
          streamUiTimeout = window.setTimeout(flushStreamUi, 80 - elapsed);
        }
      };

      try {
        const response = await fetch('/api/ai/gmail-reply-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            threadSubject: thread.subject,
            threadMessages: generationMessages,
            analysis: analysis || {},
            userIdeas,
            targetLang,
            targetLangName,
            replyTone,
            gmailAccountEmail: auth?.email || '',
            targetMessageId: replyTarget?.messageId || '',
            draftPrompt: settings.aiDraftPrompt || settings.aiEmailPrompt || '',
            modelProvider: settings.modelProvider || 'builtin',
            customApiUrl: settings.customApiUrl || '',
            customModelName: settings.customModelName || '',
          }),
        });
        if (!response.ok || !response.body) {
          throw new Error(`流式接口暂不可用 (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const handleEvent = (chunk: string) => {
          const eventName = chunk.match(/^event:\s*(.+)$/m)?.[1]?.trim() || 'message';
          const dataText = chunk
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.replace(/^data:\s*/, ''))
            .join('\n');
          if (!dataText) return;
          const event = JSON.parse(dataText) as Record<string, unknown>;
          if (eventName === 'stage') {
            if (event.stage === 'finalizing' && streamedBody.trim()) {
              streamedBodyComplete = true;
            }
            const nextStage = String(event.label || '正在生成草稿');
            setGenerationStage(nextStage);
            report(nextStage);
            return;
          }
          if (eventName === 'delta') {
            const text = String(event.text || '');
            if (!text) return;
            if (!firstDeltaAt) firstDeltaAt = performance.now();
            streamedBody += text;
            pendingBody = streamedBody;
            queueStreamUiFlush();
            return;
          }
          if (eventName === 'translation_delta') {
            const text = String(event.text || '');
            if (!text) return;
            streamedTranslation += text;
            pendingTranslation = streamedTranslation;
            setTranslationExpanded(true);
            queueStreamUiFlush();
            return;
          }
          if (eventName === 'final') {
            finalResult = event as AISuggestion;
            return;
          }
          if (eventName === 'error') {
            streamError = String(event.message || '流式生成失败');
          }
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
        if (streamUiTimeout) {
          window.clearTimeout(streamUiTimeout);
          flushStreamUi();
        }
        if (streamError) throw new Error(streamError);
        if (!finalResult) throw new Error('流式生成未返回完整草稿');
        console.info('[Gmail AI client draft timing]', {
          mode: 'stream',
          firstDeltaMs: firstDeltaAt ? Math.round(firstDeltaAt - startedAt) : null,
          totalMs: Math.round(performance.now() - startedAt),
        });
      } catch (streamFailure) {
        if (controller.signal.aborted) return;
        if (streamUiTimeout) window.clearTimeout(streamUiTimeout);
        console.warn('[Gmail AI reply stream fallback]', {
          reason: streamFailure instanceof Error ? streamFailure.message : 'unknown',
          bodyComplete: streamedBodyComplete,
        });
        if (streamedBodyComplete && streamedBody.trim()) {
          pendingBody = streamedBody.trim();
          pendingTranslation = '';
          setGenerationStage('正文已生成，正在单独补充中文对照');
          report('正文已生成，正在补充中文对照');
          flushStreamUi();
          try {
            const translatedReply = await translateDraftToChinese(
              pendingBody,
              controller.signal,
              (partialTranslation) => {
                pendingTranslation = partialTranslation;
                setTranslationExpanded(true);
                queueStreamUiFlush();
              },
            );
            finalResult = {
              suggestedReply: pendingBody,
              translatedReply,
              tone: replyTone,
              keyPoints: [],
            };
            console.info('[Gmail AI client draft timing]', {
              mode: 'staged_translation_fallback',
              totalMs: Math.round(performance.now() - startedAt),
            });
          } catch (translationFailure) {
            if (controller.signal.aborted) return;
            finalResult = {
              suggestedReply: pendingBody,
              translatedReply: '',
              tone: replyTone,
              keyPoints: [],
            };
            setAiError(`正文已生成并保留，但中文对照暂时失败：${translationFailure instanceof Error ? translationFailure.message : '请稍后重试'}`);
          }
        } else {
          setGenerationStage('流式生成不可用，正在使用兼容模式');
          report('流式生成不可用，正在使用兼容模式');
          finalResult = await invokeAI({
            action: 'draft',
            analysis: analysis || {},
            userIdeas,
            targetLang,
            targetLangName,
            replyTone,
          }, generationMessages, controller.signal) as AISuggestion;
          console.info('[Gmail AI client draft timing]', {
            mode: 'fallback',
            totalMs: Math.round(performance.now() - startedAt),
          });
        }
      }

      if (runId !== generationRunRef.current || !finalResult) return;
      const result = finalResult;
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
      setSynchronizedDraft(result.translatedReply.trim() ? {
        foreignBody: cleanSuggestedReply,
        chineseBody: result.translatedReply,
        targetLanguage: targetLang,
      } : null);
      setDraftUsedAnalysis(Boolean(analysis));
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
      return {
        suggestion: cleanSuggestion,
        targetLang,
        targetLangName,
        usedAnalysis: Boolean(analysis),
      } satisfies GmailAIReplyTaskResult;
    } catch (error) {
      if (controller.signal.aborted || runId !== generationRunRef.current) return;
      setSuggestion(previousSuggestion);
      setReplyContent(previousReplyContent);
      if (previousSuggestion) {
        setEditedChineseReply(previousSuggestion.translatedReply);
        setGeneratedLangName(targetLangName);
      }
      setAiError(error instanceof Error ? error.message : 'AI 生成失败，请稍后重试');
      throw error;
    } finally {
      if (runId === generationRunRef.current) {
        setAiLoading(false);
        setGenerationStage('');
      }
    }
      },
    });
    if (taskId) {
      setAiLoading(true);
      setAiError('');
      setGenerationStage('等待生成');
    }
  };

  const optimizeReplyWithPortrait = async () => {
    if (!analysis || !suggestion || optimizationLoading || aiLoading) return;
    const generationMessages = historyMessages.length ? historyMessages : threadMessages;
    const currentDraft = emailHtmlToText(replyContent).trim();
    if (!currentDraft || generationMessages.length === 0) {
      setOptimizationError('当前草稿或邮件上下文为空，暂时无法进行画像优化。');
      return;
    }

    const runId = optimizationRunRef.current + 1;
    optimizationRunRef.current = runId;
    setOptimizationLoading(true);
    setOptimizationError('');
    setOptimizedSuggestion(null);

    try {
      const result = await invokeAI({
        action: 'optimizeDraft',
        analysis,
        userIdeas,
        currentDraft,
        targetLang,
        targetLangName,
        replyTone,
        gmailAccountEmail: auth?.email || '',
      }, generationMessages) as AISuggestion;
      if (runId !== optimizationRunRef.current) return;
      const cleanSuggestedReply = stripConfiguredEmailSignature(
        result.suggestedReply,
        settings.emailSignature,
      );
      setOptimizedSuggestion({
        ...result,
        suggestedReply: cleanSuggestedReply,
        keyPoints: result.keyPoints || [],
      });
    } catch (error) {
      if (runId !== optimizationRunRef.current) return;
      setOptimizationError(error instanceof Error ? error.message : '结合红人画像优化失败，请稍后重试。');
    } finally {
      if (runId === optimizationRunRef.current) setOptimizationLoading(false);
    }
  };

  const applyOptimizedSuggestion = () => {
    if (!optimizedSuggestion) return;
    setSuggestion(optimizedSuggestion);
    setReplyContent(optimizedSuggestion.suggestedReply);
    setEditedChineseReply(optimizedSuggestion.translatedReply);
    setTranslationExpanded(true);
    setTranslationEditing(false);
    setTranslationUpdated(false);
    setSynchronizedDraft(optimizedSuggestion.translatedReply.trim() ? {
      foreignBody: optimizedSuggestion.suggestedReply,
      chineseBody: optimizedSuggestion.translatedReply,
      targetLanguage: targetLang,
    } : null);
    setDraftUsedAnalysis(true);
    setOptimizedSuggestion(null);
    setOptimizationError('');
    setAiError('');
  };

  const updateDraftFromChinese = async () => {
    const confirmedChineseReply = editedChineseReply.trim();
    if (!confirmedChineseReply || !suggestion) return;
    if (bilingualDraftForeignEdited && !window.confirm('根据中文重新翻译会覆盖当前手动调整的外文，是否继续？')) return;
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
      setSynchronizedDraft({
        foreignBody: cleanSuggestedReply,
        chineseBody: confirmedChineseReply,
        targetLanguage: targetLang,
      });
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
    if (!recipientEmail || !replyTarget) {
      throw new Error('请先确认最终回复收件人，再保存草稿或发送。');
    }
    const finalReply = appendEmailSignature(
      replyContent,
      getEmailSignatureForContext(
        settings.emailSignature,
        settings.emailSignatureScope,
        'regular',
      ),
    );
    const accessToken = await getAccessToken();
    const references = buildGmailReplyReferences(replyTarget);
    const subject = buildGmailReplySubject(replyTarget);
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
    if (mode === 'ai' && !bilingualDraftTranslationCurrent) {
      setAiError('中文或回复语言已发生变化，请先点击“根据中文更新外文”，再保存 Gmail 草稿。');
      return;
    }
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
    if (mode === 'ai' && !translationUpdated) {
      setAiError('直接发送前，请先点击“修改中文”，再点击“根据中文更新外文”完成人工确认。');
      return;
    }
    if (!recipientEmail) {
      setAiError('请先确认最终回复收件人，再发送邮件。');
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
    if (!suggestion || isEmailContentEmpty(replyContent)) return;
    await navigator.clipboard.writeText(emailHtmlToText(replyContent));
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

  const generationSettings = (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs font-medium text-gray-600">
        <span className="shrink-0">回复语言</span>
        <select
          value={targetLang}
          className="h-9 min-w-36 rounded-md border border-gray-300 bg-white px-3 text-sm font-normal text-gray-900 outline-none transition hover:border-gray-400 focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={aiLoading || translatingEditedReply}
          onChange={(event) => {
            const language = LANGUAGE_OPTIONS.find(([code]) => code === event.target.value);
            targetLangLockedRef.current = true;
            setTargetLang(event.target.value);
            setTargetLangName(language?.[1] || event.target.value);
            setTranslationUpdated(false);
          }}
        >
          {LANGUAGE_OPTIONS.map(([code, name]) => (
            <option key={code} value={code}>
              {code === analysis?.language ? `${name}（来信语言）` : name}
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
  );

  const aiBody = (
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      {(analysisLoading || settingsLoading) && (
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4">
          <Loader2 className="size-5 animate-spin text-primary" />
          <div>
            <p className="text-sm font-medium">正在后台分析最近往来</p>
            <p className="text-xs text-muted-foreground">
              不影响填写和生成；完成后会补充合作判断和风险提醒。
            </p>
          </div>
        </div>
      )}

      {analysisError && (
        <ErrorMessage message={analysisError}>
          <Button variant="outline" size="sm" onClick={() => void analyzeThread(true)}>重新分析</Button>
        </ErrorMessage>
      )}

      {attachmentList}
      {attachmentError && <p className="text-xs text-destructive">{attachmentError}</p>}

      {!suggestion && (
        <section className="rounded-lg border border-gray-300 bg-white shadow-sm transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <div className="border-b border-gray-100 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <label htmlFor="ai-reply-strategy" className="text-sm font-semibold text-gray-900">回复想法</label>
                <p className="mt-0.5 text-xs text-gray-500">
                  {analysisLoading || settingsLoading
                    ? '可以先填写预算、底线或需要确认的问题；邮件分析会在后台继续。'
                    : '补充预算、底线、产品安排或需要对方确认的问题。'}
                </p>
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
      )}

      {analysis && !suggestion && (
        <>
          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">核心分析</h3>
                  {analysis.stage && (
                    <Badge variant="secondary" className="bg-gray-100 font-normal text-gray-700">
                      {analysis.stage}
                    </Badge>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs font-normal text-gray-500"
                  disabled={analysisLoading || aiLoading}
                  onClick={() => void analyzeThread(true)}
                >
                  <RefreshCw className="size-3.5" />
                  重新分析
                </Button>
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

        </>
      )}

      {!suggestion && aiError && <ErrorMessage message={aiError} />}

      {suggestion && (
        <>
          {analysis && (
            <section className={`overflow-hidden rounded-lg border ${draftUsedAnalysis ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'}`}>
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5 ${draftUsedAnalysis ? 'border-emerald-100' : 'border-amber-100'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={draftUsedAnalysis
                      ? 'border-emerald-200 bg-white font-normal text-emerald-700'
                      : 'border-amber-200 bg-white font-normal text-amber-700'}
                  >
                    {draftUsedAnalysis ? '当前草稿已结合画像' : '后台红人画像已完成'}
                  </Badge>
                  <p className={`text-xs ${draftUsedAnalysis && bilingualDraftTranslationCurrent ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {draftUsedAnalysis
                      ? bilingualDraftTranslationCurrent
                        ? bilingualDraftForeignEdited
                          ? '外文已手动调整，可直接保存草稿；系统不会自动发送。'
                          : '中文依据已同步，可直接保存草稿；系统不会自动发送。'
                        : '中文或回复语言已修改；根据中文更新外文后可保存草稿。'
                      : '可以对比画像优化版；当前草稿不会被自动覆盖。'}
                  </p>
                </div>
                {!draftUsedAnalysis && !optimizedSuggestion && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 border-amber-200 bg-white text-amber-800 hover:bg-amber-100"
                    disabled={optimizationLoading || aiLoading || translatingEditedReply || translationEditing}
                    onClick={optimizeReplyWithPortrait}
                  >
                    {optimizationLoading
                      ? <Loader2 className="animate-spin" data-icon="inline-start" />
                      : <Sparkles data-icon="inline-start" />}
                    {optimizationLoading ? '正在生成优化版...' : '结合画像优化草稿'}
                  </Button>
                )}
              </div>
              <div className="grid sm:grid-cols-2">
                <AnalysisList
                  title="待确认事项"
                  items={analysis.openQuestions || []}
                  emptyText="当前没有需要额外确认的事项"
                  className="border-b border-amber-100 sm:border-b-0 sm:border-r"
                  compact
                />
                <AnalysisList
                  title="风险提醒"
                  items={analysis.risks || []}
                  emptyText="暂未发现明显风险"
                  tone="warning"
                  compact
                />
              </div>
            </section>
          )}
          {optimizationError && (
            <ErrorMessage message={optimizationError}>
              <Button variant="outline" size="sm" onClick={optimizeReplyWithPortrait}>重新优化</Button>
            </ErrorMessage>
          )}
          {optimizedSuggestion && (
            <section className="overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm">
              <div className="border-b border-blue-100 bg-blue-50/70 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-blue-950">当前版与画像优化版</h3>
                  <Badge variant="outline" className="border-blue-200 bg-white font-normal text-blue-700">等待你选择</Badge>
                </div>
                <p className="mt-1 text-xs text-blue-800">先看中文差异；选定版本后如未再修改，可以直接保存 Gmail 草稿。直接发送仍需人工确认。</p>
              </div>
              <div className="grid lg:grid-cols-2">
                <DraftComparisonCard
                  title="当前版本"
                  chineseText={suggestion.translatedReply}
                  foreignText={emailHtmlToText(replyContent)}
                  actionLabel="保留当前版"
                  onSelect={() => {
                    setOptimizedSuggestion(null);
                    setOptimizationError('');
                  }}
                  className="border-b border-blue-100 lg:border-b-0 lg:border-r"
                />
                <DraftComparisonCard
                  title="画像优化版本"
                  chineseText={optimizedSuggestion.translatedReply}
                  foreignText={optimizedSuggestion.suggestedReply}
                  keyPoints={optimizedSuggestion.keyPoints}
                  actionLabel="使用优化版"
                  primary
                  onSelect={applyOptimizedSuggestion}
                />
              </div>
            </section>
          )}
          <section className="overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">回复草稿</h3>
                  <Badge variant="secondary" className="bg-gray-100 font-normal text-gray-700">
                    {generatedLangName || targetLangName}
                  </Badge>
                  <Badge
                    variant="outline"
                    className={!bilingualDraftTranslationCurrent
                      ? 'border-amber-200 bg-amber-50 font-normal text-amber-700'
                      : bilingualDraftForeignEdited
                        ? 'border-blue-200 bg-blue-50 font-normal text-blue-700'
                        : 'border-emerald-200 bg-emerald-50 font-normal text-emerald-700'}
                  >
                    {!bilingualDraftTranslationCurrent
                      ? '待更新外文'
                      : bilingualDraftForeignEdited
                        ? '外文已手动调整'
                        : '中文依据已同步'}
                  </Badge>
                  {aiLoading && generationStage && (
                    <Badge variant="outline" className="border-blue-200 bg-blue-50 font-normal text-blue-700">
                      <Loader2 className="size-3 animate-spin" />
                      {generationStage}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">可直接编辑正文，发送前请核对价格、时间和承诺。</p>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0 text-gray-600 hover:bg-gray-100" onClick={copyToClipboard}>
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                {copied ? '已复制' : '复制'}
              </Button>
            </div>
            {suggestion.keyPoints.length > 0 && (
              <AnalysisList
                title="本次回复要点"
                items={suggestion.keyPoints}
                className="border-b border-gray-100 bg-gray-50/70"
                compact
              />
            )}
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
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700">最终人工确认</Badge>
                  </div>
                  <Textarea
                    value={editedChineseReply}
                    onChange={(event) => {
                      setEditedChineseReply(event.target.value);
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
                    <p className={`text-xs ${bilingualDraftTranslationCurrent ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {bilingualDraftTranslationCurrent
                        ? bilingualDraftForeignEdited
                          ? '外文已手动调整，中文依据未变化，可以直接保存 Gmail 草稿。'
                          : '中文依据已同步；满意时可以直接保存 Gmail 草稿。'
                        : '中文或回复语言已发生变化，请根据中文更新外文后再保存草稿。'}
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
                        setAiError('');
                      }}
                    >
                      修改中文
                    </Button>
                  </div>
                  <div className="whitespace-pre-wrap px-4 py-3 text-sm leading-6 text-gray-700">
                    {suggestion.translatedReply || (aiLoading ? '正文已生成，正在补充中文对照…' : '暂无中文对照')}
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
          {!suggestion ? (
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              {generationSettings}
              <Button
                className="shrink-0"
                onClick={generateReply}
                disabled={!userIdeas.trim() || settingsLoading || aiLoading}
              >
                {aiLoading || settingsLoading
                  ? <Loader2 className="animate-spin" data-icon="inline-start" />
                  : <Sparkles data-icon="inline-start" />}
                {aiLoading
                  ? '正在生成草稿...'
                  : settingsLoading
                    ? '正在读取设置...'
                    : '生成邮件草稿'}
              </Button>
            </div>
          ) : suggestion ? (
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              {generationSettings}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className={`mr-1 text-xs ${recipientEmail ? 'text-gray-500' : 'text-red-600'}`}>
                  收件人：{recipientEmail || '保存草稿前需确认'}
                </span>
                {!bilingualDraftTranslationCurrent && (
                  <span className="mr-1 text-xs font-medium text-amber-700">
                    请先根据中文更新外文
                  </span>
                )}
                <Button
                  variant="ghost"
                  className="text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  disabled={aiLoading || optimizationLoading || translatingEditedReply || translationEditing || sending || savingDraft}
                  onClick={() => {
                    optimizationRunRef.current += 1;
                    setSuggestion(null);
                    setOptimizedSuggestion(null);
                    setOptimizationError('');
                    setDraftUsedAnalysis(false);
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
                  disabled={!userIdeas.trim() || aiLoading || optimizationLoading || Boolean(optimizedSuggestion) || translatingEditedReply || translationEditing || sending || savingDraft}
                >
                  {aiLoading ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                  {aiLoading ? '重新生成中...' : '重新生成'}
                </Button>
                <Button
                  variant="outline"
                  onClick={sendEmail}
                  disabled={!recipientEmail || !translationUpdated || aiLoading || optimizationLoading || Boolean(optimizedSuggestion) || translatingEditedReply || translationEditing || sending || savingDraft || isEmailContentEmpty(replyContent)}
                >
                  {sending ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Send data-icon="inline-start" />}
                  直接发送
                </Button>
                <Button onClick={saveToGmailDrafts} disabled={!recipientEmail || !bilingualDraftTranslationCurrent || aiLoading || optimizationLoading || Boolean(optimizedSuggestion) || translatingEditedReply || translationEditing || savingDraft || sending || isEmailContentEmpty(replyContent)}>
                  {savingDraft ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                  保存 Gmail 草稿
                </Button>
              </div>
            </div>
          ) : null}
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
        回复收件人：{recipientEmail || '尚未确认；AI 仍可正常生成内容'}
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

function DraftComparisonCard({
  title,
  chineseText,
  foreignText,
  keyPoints = [],
  actionLabel,
  onSelect,
  primary = false,
  className = '',
}: {
  title: string;
  chineseText: string;
  foreignText: string;
  keyPoints?: string[];
  actionLabel: string;
  onSelect: () => void;
  primary?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-3 p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        {primary && <Badge className="bg-blue-600 font-normal hover:bg-blue-600">结合画像</Badge>}
      </div>
      <div className="min-h-36 flex-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
        <p className="text-xs font-medium text-gray-500">中文对照</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-gray-800">
          {chineseText || '暂无中文对照，请先生成完整的中外文版本。'}
        </p>
      </div>
      {keyPoints.length > 0 && (
        <div className="rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2.5">
          <p className="text-xs font-medium text-blue-700">画像优化变化</p>
          <ul className="mt-1.5 space-y-1 text-xs leading-5 text-blue-950">
            {keyPoints.map((point, index) => <li key={`portrait-change-${index}`}>• {point}</li>)}
          </ul>
        </div>
      )}
      <details className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
        <summary className="cursor-pointer select-none font-medium">查看外文正文</summary>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{foreignText}</p>
      </details>
      <Button type="button" variant={primary ? 'default' : 'outline'} onClick={onSelect}>
        {primary && <Check data-icon="inline-start" />}
        {actionLabel}
      </Button>
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
