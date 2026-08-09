'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth-provider';
import {
  appendEmailSignature,
  applyPlainTextEmailSignature,
  getEmailSignatureForContext,
  stripConfiguredEmailSignature,
  textToEmailHtml,
} from '@/lib/email-content';
import {
  buildFollowUpSentPayload,
  canSaveFollowUpDraft,
  evaluateFollowUpEligibility,
  followUpSaveMode,
  followUpTaskKey,
  type FollowUpCheck,
  type FollowUpSourceRecord,
  type FollowUpStage,
} from '@/lib/follow-up-draft-workflow';
import { outreachLanguageLabel } from '@/lib/outreach-languages';
import { sanitizeOutreachEmailBody } from '@/lib/outreach-draft-sanitizer';
import { useSettings } from '@/lib/data';

export type FollowUpDraftTaskStatus =
  | 'checking'
  | 'generating'
  | 'generated'
  | 'translating'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'feishu_error'
  | 'error';

export type FollowUpDraftTask = {
  key: string;
  accountId: string;
  source: FollowUpSourceRecord;
  stage: FollowUpStage;
  status: FollowUpDraftTaskStatus;
  subject: string;
  body: string;
  chineseBody: string;
  language: string;
  chineseDirty: boolean;
  revision: number;
  generatedAt?: number;
  gmailDraftId?: string;
  feishuSentAt?: number;
  warning?: string;
  error?: string;
  errorCode?: string;
};

export type FollowUpBatchProgress = {
  completed: number;
  total: number;
  success: number;
  skipped: number;
  failed: number;
};

type GenerationOutcome = 'success' | 'skipped' | 'failed';

type FollowUpDraftContextValue = {
  tasks: Record<string, FollowUpDraftTask>;
  batchProgress: Partial<Record<FollowUpStage, FollowUpBatchProgress>>;
  generateTask: (source: FollowUpSourceRecord, stage: FollowUpStage) => Promise<GenerationOutcome>;
  generateMany: (sources: FollowUpSourceRecord[], stage: FollowUpStage) => Promise<void>;
  updateChinese: (key: string, value: string) => void;
  translateTask: (key: string) => Promise<boolean>;
  saveTask: (key: string) => Promise<boolean>;
  retryFeishu: (key: string) => Promise<boolean>;
  clearTask: (key: string) => void;
};

const FollowUpDraftContext = createContext<FollowUpDraftContextValue | null>(null);
const TASK_CACHE_PREFIX = 'influencer_follow_up_tasks_v2';
const LEGACY_CACHE_PREFIX = 'influencer_follow_up_drafts_v1';
const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set<FollowUpDraftTaskStatus>(['checking', 'generating', 'translating', 'saving']);

function getResultError(result: unknown, fallback: string) {
  if (!result || typeof result !== 'object') return fallback;
  const item = result as Record<string, unknown>;
  return [item.error, item.details].map((value) => String(value || '').trim()).filter(Boolean).join(' ') || fallback;
}

function createEmptySource(recordId: string): FollowUpSourceRecord {
  return {
    recordId,
    channelName: '',
    email: '',
    developmentDate: 0,
    firstOutreach: '',
    secondOutreachDate: 0,
    secondOutreach: '',
    thirdOutreachDate: 0,
    thirdOutreach: '',
    language: '',
    targetProduct: '',
    cooperationType: '',
    cooperationIdea: '',
  };
}

function loadTaskCache(accountId: string) {
  if (typeof window === 'undefined' || !accountId) return {};
  const expiresBefore = Date.now() - CACHE_MAX_AGE;
  try {
    const parsed = JSON.parse(localStorage.getItem(`${TASK_CACHE_PREFIX}:${accountId}`) || '{}') as Record<string, FollowUpDraftTask>;
    const entries = Object.entries(parsed).filter(([, task]) => (
      task?.accountId === accountId
      && !ACTIVE_STATUSES.has(task.status)
      && Number(task.generatedAt || task.feishuSentAt || 0) >= expiresBefore
    ));
    if (entries.length) return Object.fromEntries(entries);
  } catch {
    // 尝试读取旧版缓存。
  }

  try {
    const legacy = JSON.parse(localStorage.getItem(`${LEGACY_CACHE_PREFIX}:${accountId}`) || '{}') as Record<string, {
      stage?: FollowUpStage;
      status?: string;
      body?: string;
      translatedBody?: string;
      language?: string;
      gmailDraftId?: string;
      generatedAt?: number;
    }>;
    return Object.fromEntries(Object.entries(legacy).flatMap(([key, draft]) => {
      const [recordId, rawStage] = key.split(':');
      const stage = Number(rawStage) === 3 ? 3 : 2;
      if (draft?.status !== 'saved' || !draft.body?.trim() || Number(draft.generatedAt || 0) < expiresBefore) return [];
      return [[key, {
        key,
        accountId,
        source: createEmptySource(recordId),
        stage,
        status: 'saved',
        subject: '',
        body: draft.body,
        chineseBody: draft.translatedBody || '',
        language: draft.language || '',
        chineseDirty: false,
        revision: 0,
        gmailDraftId: draft.gmailDraftId,
        generatedAt: draft.generatedAt,
      } satisfies FollowUpDraftTask]];
    }));
  } catch {
    return {};
  }
}

async function requestFollowUpCheck(source: FollowUpSourceRecord) {
  const query = new URLSearchParams({
    action: 'outreachFollowUp',
    email: source.email,
    sentAt: String(source.developmentDate),
  });
  const response = await fetch(`/api/gmail?${query}`);
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(getResultError(result, '检查 Gmail 回复失败。'));
  return result.data as FollowUpCheck;
}

export function FollowUpDraftProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { settings } = useSettings();
  const accountId = user?.id || '';
  const [tasks, setTasks] = useState<Record<string, FollowUpDraftTask>>({});
  const [cacheReady, setCacheReady] = useState(false);
  const [batchProgress, setBatchProgress] = useState<Partial<Record<FollowUpStage, FollowUpBatchProgress>>>({});
  const tasksRef = useRef(tasks);
  const generationLocksRef = useRef(new Set<string>());
  const batchLocksRef = useRef(new Set<FollowUpStage>());

  const commitTasks = useCallback((updater: (current: Record<string, FollowUpDraftTask>) => Record<string, FollowUpDraftTask>) => {
    const next = updater(tasksRef.current);
    tasksRef.current = next;
    setTasks(next);
  }, []);

  useEffect(() => {
    const loaded = loadTaskCache(accountId);
    tasksRef.current = loaded;
    setTasks(loaded);
    generationLocksRef.current.clear();
    batchLocksRef.current.clear();
    setBatchProgress({});
    setCacheReady(Boolean(accountId));
  }, [accountId]);

  useEffect(() => {
    if (!cacheReady || !accountId) return;
    const stableTasks = Object.fromEntries(Object.entries(tasks).filter(([, task]) => !ACTIVE_STATUSES.has(task.status)));
    try {
      localStorage.setItem(`${TASK_CACHE_PREFIX}:${accountId}`, JSON.stringify(stableTasks));
    } catch {
      // 浏览器空间不足不影响本次会话。
    }
  }, [accountId, cacheReady, tasks]);

  useEffect(() => {
    const hasActiveTask = Object.values(tasks).some((task) => ACTIVE_STATUSES.has(task.status));
    if (!hasActiveTask) return;
    const protectActiveTasks = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectActiveTasks);
    return () => window.removeEventListener('beforeunload', protectActiveTasks);
  }, [tasks]);

  const patchTask = useCallback((key: string, patch: Partial<FollowUpDraftTask>) => {
    commitTasks((current) => current[key]
      ? { ...current, [key]: { ...current[key], ...patch } }
      : current);
  }, [commitTasks]);

  const runGeneration = useCallback(async (
    source: FollowUpSourceRecord,
    stage: FollowUpStage,
    options: { notify: boolean; force?: boolean },
  ): Promise<GenerationOutcome> => {
    const key = followUpTaskKey(source.recordId, stage);
    const currentTask = tasksRef.current[key];
    if (generationLocksRef.current.has(key)) return 'skipped';
    if (!options.force && currentTask && ['generated', 'ready', 'saved', 'feishu_error'].includes(currentTask.status)) return 'skipped';
    if (currentTask?.gmailDraftId) return 'skipped';

    const priorTask = tasksRef.current[followUpTaskKey(source.recordId, 2)];
    const initialEligibility = evaluateFollowUpEligibility({
      record: source,
      stage,
      previousBody: priorTask?.body,
      previousStageSaved: priorTask?.status === 'saved' || priorTask?.status === 'feishu_error',
    });
    if (!initialEligibility.allowed) {
      commitTasks((current) => ({
        ...current,
        [key]: {
          key,
          accountId,
          source,
          stage,
          status: 'error',
          subject: currentTask?.subject || '',
          body: currentTask?.body || '',
          chineseBody: currentTask?.chineseBody || '',
          language: source.language,
          chineseDirty: false,
          revision: currentTask?.revision || 0,
          error: initialEligibility.reason,
          errorCode: initialEligibility.code,
          generatedAt: currentTask?.generatedAt,
        },
      }));
      if (options.notify) toast.warning(initialEligibility.reason);
      return 'skipped';
    }

    generationLocksRef.current.add(key);
    commitTasks((current) => ({
      ...current,
      [key]: {
        key,
        accountId,
        source,
        stage,
        status: 'checking',
        subject: currentTask?.subject || '',
        body: '',
        chineseBody: '',
        language: source.language,
        chineseDirty: false,
        revision: (currentTask?.revision || 0) + 1,
      },
    }));

    try {
      const check = await requestFollowUpCheck(source);
      const latestPriorTask = tasksRef.current[followUpTaskKey(source.recordId, 2)];
      const eligibility = evaluateFollowUpEligibility({
        record: source,
        stage,
        check,
        previousBody: latestPriorTask?.body,
        previousStageSaved: latestPriorTask?.status === 'saved' || latestPriorTask?.status === 'feishu_error',
      });
      if (!eligibility.allowed) {
        patchTask(key, { status: 'error', error: eligibility.reason, errorCode: eligibility.code });
        if (options.notify) toast.warning(eligibility.reason);
        return 'skipped';
      }

      patchTask(key, { status: 'generating', warning: eligibility.warning, error: undefined, errorCode: undefined });
      const previousMessage = check.outbound[1] || (latestPriorTask?.body ? {
        ...check.outbound[0],
        body: latestPriorTask.body,
        subject: latestPriorTask.subject || check.outbound[0].subject,
      } : undefined);
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'followUpOutreach',
          stage,
          channelName: source.channelName,
          preferredLanguage: source.language,
          targetProduct: source.targetProduct,
          cooperationType: source.cooperationType,
          cooperationIdea: source.cooperationIdea,
          initialEmail: check.outbound[0],
          previousFollowUp: stage === 3 ? previousMessage : undefined,
          followUpPrompt: stage === 2 ? settings.aiOutreachFollowUp1Prompt : settings.aiOutreachFollowUp2Prompt,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(getResultError(result, '生成跟进邮件失败。'));
      const body = sanitizeOutreachEmailBody(result.data?.body);
      const chineseBody = sanitizeOutreachEmailBody(result.data?.translatedBody);
      if (!body || !chineseBody) throw new Error('AI 没有返回完整的外文正文和中文对照。');
      patchTask(key, {
        status: 'generated',
        subject: check.outbound[0].subject,
        body,
        chineseBody,
        language: String(result.data?.language || source.language || '').trim(),
        chineseDirty: false,
        generatedAt: Date.now(),
        error: undefined,
        errorCode: undefined,
      });
      if (options.notify) toast.success(`${source.channelName} 的跟进邮件已生成，等待你审核。`);
      return 'success';
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成跟进邮件失败。';
      patchTask(key, { status: 'error', error: message, errorCode: 'request_failed' });
      if (options.notify) toast.error(message);
      return 'failed';
    } finally {
      generationLocksRef.current.delete(key);
    }
  }, [accountId, commitTasks, patchTask, settings]);

  const generateTask = useCallback((source: FollowUpSourceRecord, stage: FollowUpStage) => (
    runGeneration(source, stage, { notify: true })
  ), [runGeneration]);

  const generateMany = useCallback(async (sources: FollowUpSourceRecord[], stage: FollowUpStage) => {
    if (batchLocksRef.current.has(stage)) return;
    const uniqueSources = Array.from(new Map(sources.map((source) => [source.recordId, source])).values());
    if (!uniqueSources.length) {
      toast.info('当前没有符合条件的待生成邮件。');
      return;
    }
    batchLocksRef.current.add(stage);
    setBatchProgress((current) => ({
      ...current,
      [stage]: { completed: 0, total: uniqueSources.length, success: 0, skipped: 0, failed: 0 },
    }));
    let nextIndex = 0;
    const counts = { success: 0, skipped: 0, failed: 0 };
    const worker = async () => {
      while (nextIndex < uniqueSources.length) {
        const source = uniqueSources[nextIndex++];
        const outcome = await runGeneration(source, stage, { notify: false });
        counts[outcome] += 1;
        setBatchProgress((current) => {
          const progress = current[stage];
          if (!progress) return current;
          return {
            ...current,
            [stage]: {
              ...progress,
              completed: progress.completed + 1,
              [outcome]: progress[outcome] + 1,
            },
          };
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, uniqueSources.length) }, worker));
    batchLocksRef.current.delete(stage);
    setBatchProgress((current) => {
      const next = { ...current };
      delete next[stage];
      return next;
    });
    const label = stage === 2 ? '第1次跟进' : '第2次跟进';
    const message = `${label}后台生成完成：成功 ${counts.success}，跳过 ${counts.skipped}，失败 ${counts.failed}。`;
    if (counts.failed) toast.warning(message);
    else toast.success(message);
  }, [runGeneration]);

  const updateChinese = useCallback((key: string, value: string) => {
    commitTasks((current) => {
      const task = current[key];
      if (!task || task.gmailDraftId) return current;
      return {
        ...current,
        [key]: {
          ...task,
          chineseBody: value,
          chineseDirty: true,
          revision: task.revision + 1,
          status: task.status === 'translating' ? 'generated' : task.status,
          error: undefined,
        },
      };
    });
  }, [commitTasks]);

  const translateTask = useCallback(async (key: string) => {
    const task = tasksRef.current[key];
    if (!task || !task.chineseBody.trim() || task.gmailDraftId) return false;
    const revision = task.revision;
    const previousStatus = task.status === 'ready' ? 'ready' : 'generated';
    patchTask(key, { status: 'translating', error: undefined });
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'translateEditedReply',
          editedChineseReply: task.chineseBody.trim(),
          targetLang: task.language || task.source.language || 'en',
          targetLangName: outreachLanguageLabel(task.language || task.source.language || 'en'),
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(getResultError(result, '中文邮件翻译失败。'));
      const current = tasksRef.current[key];
      if (!current || current.revision !== revision || current.chineseBody !== task.chineseBody) return false;
      const body = sanitizeOutreachEmailBody(result.data?.suggestedReply);
      if (!body) throw new Error('AI 没有返回可用的外文正文。');
      patchTask(key, { status: 'ready', body, chineseDirty: false, error: undefined });
      toast.success('已根据中文更新外文正文。');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '中文邮件翻译失败。';
      const current = tasksRef.current[key];
      if (current?.revision === revision) patchTask(key, { status: previousStatus, error: message });
      toast.error(message);
      return false;
    }
  }, [patchTask, settings]);

  const writeFeishu = useCallback(async (task: FollowUpDraftTask, sentAt: number) => {
    const mapping = settings.feishuProspectingFieldMapping || {};
    const fields = buildFollowUpSentPayload(task.stage, sentAt, mapping);
    if (!settings.feishuProspectingUrl || !fields) {
      throw new Error(`请先配置${task.stage === 2 ? '第1次' : '第2次'}跟进状态和日期的飞书字段映射。`);
    }
    const response = await fetch('/api/feishu/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'update',
        url: settings.feishuProspectingUrl,
        recordId: task.source.recordId,
        fields,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(getResultError(result, '写回飞书失败。'));
    window.dispatchEvent(new CustomEvent('follow-up-feishu-updated', {
      detail: { recordId: task.source.recordId, stage: task.stage, sentAt },
    }));
  }, [settings.feishuProspectingFieldMapping, settings.feishuProspectingUrl]);

  const retryFeishu = useCallback(async (key: string) => {
    const task = tasksRef.current[key];
    if (!task?.gmailDraftId || !task.feishuSentAt) return false;
    patchTask(key, { status: 'saving', error: undefined });
    try {
      await writeFeishu(task, task.feishuSentAt);
      patchTask(key, { status: 'saved', error: undefined });
      toast.success('Gmail 草稿未重复创建，飞书状态已补写成功。');
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : '写回飞书失败。';
      patchTask(key, { status: 'feishu_error', error: message });
      toast.error(message);
      return false;
    }
  }, [patchTask, writeFeishu]);

  const saveTask = useCallback(async (key: string) => {
    const task = tasksRef.current[key];
    if (!task) return false;
    const canSave = canSaveFollowUpDraft(task);
    const saveMode = followUpSaveMode({ status: task.status, gmailDraftId: task.gmailDraftId, canSave });
    if (saveMode === 'retry_feishu') return retryFeishu(key);
    if (saveMode === 'blocked') return false;
    const mapping = settings.feishuProspectingFieldMapping || {};
    if (!settings.feishuProspectingUrl || !buildFollowUpSentPayload(task.stage, Date.now(), mapping)) {
      const message = `请先配置${task.stage === 2 ? '第1次' : '第2次'}跟进状态和日期的飞书字段映射。`;
      patchTask(key, { error: message });
      toast.error(message);
      return false;
    }

    patchTask(key, { status: 'saving', error: undefined });
    try {
      const check = await requestFollowUpCheck(task.source);
      const priorTask = tasksRef.current[followUpTaskKey(task.source.recordId, 2)];
      const eligibility = evaluateFollowUpEligibility({
        record: task.source,
        stage: task.stage,
        check,
        previousBody: priorTask?.body,
        previousStageSaved: priorTask?.status === 'saved' || priorTask?.status === 'feishu_error',
      });
      if (!eligibility.allowed) throw new Error(eligibility.reason);
      const initialEmail = check.outbound[0];
      const latestOutbound = check.outbound.at(-1);
      if (!initialEmail || !latestOutbound?.threadId) throw new Error('原 Gmail 邮件线程不完整，请重新生成。');
      const references = [latestOutbound.references, latestOutbound.rfcMessageId].filter(Boolean).join(' ');
      const subject = /^re:/i.test(initialEmail.subject) ? initialEmail.subject : `Re: ${initialEmail.subject}`;
      const cleanBody = stripConfiguredEmailSignature(task.body, settings.emailSignature);
      const signature = getEmailSignatureForContext(settings.emailSignature, settings.emailSignatureScope, 'outreach');
      const response = await fetch('/api/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draft',
          to: task.source.email,
          subject,
          body: applyPlainTextEmailSignature(cleanBody, signature),
          bodyHtml: appendEmailSignature(textToEmailHtml(cleanBody), signature),
          threadId: latestOutbound.threadId,
          inReplyTo: latestOutbound.rfcMessageId,
          references,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) throw new Error(getResultError(result, '保存 Gmail 草稿失败。'));
      const gmailDraftId = String(result.data?.id || result.data?.message?.id || '');
      const sentAt = Date.now();
      patchTask(key, { gmailDraftId, feishuSentAt: sentAt });
      try {
        await writeFeishu({ ...task, gmailDraftId, feishuSentAt: sentAt }, sentAt);
        patchTask(key, { status: 'saved', gmailDraftId, feishuSentAt: sentAt, error: undefined });
        toast.success('已保存到 Gmail 草稿，并已标记飞书跟进状态。邮件尚未发送。');
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : '写回飞书失败。';
        patchTask(key, { status: 'feishu_error', gmailDraftId, feishuSentAt: sentAt, error: message });
        toast.warning(`Gmail 草稿已保存，但飞书写回失败：${message}`);
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存 Gmail 草稿失败。';
      const current = tasksRef.current[key];
      if (current?.gmailDraftId) {
        patchTask(key, { status: 'feishu_error', error: message });
      } else {
        patchTask(key, { status: task.status === 'ready' ? 'ready' : 'generated', error: message });
      }
      toast.error(message);
      return false;
    }
  }, [patchTask, retryFeishu, settings, writeFeishu]);

  const clearTask = useCallback((key: string) => {
    if (generationLocksRef.current.has(key)) return;
    commitTasks((current) => Object.fromEntries(Object.entries(current).filter(([itemKey]) => itemKey !== key)));
  }, [commitTasks]);

  const value = useMemo<FollowUpDraftContextValue>(() => ({
    tasks,
    batchProgress,
    generateTask,
    generateMany,
    updateChinese,
    translateTask,
    saveTask,
    retryFeishu,
    clearTask,
  }), [
    batchProgress,
    clearTask,
    generateMany,
    generateTask,
    retryFeishu,
    saveTask,
    tasks,
    translateTask,
    updateChinese,
  ]);

  return <FollowUpDraftContext.Provider value={value}>{children}</FollowUpDraftContext.Provider>;
}

export function useFollowUpDrafts() {
  const value = useContext(FollowUpDraftContext);
  if (!value) throw new Error('useFollowUpDrafts 必须在 FollowUpDraftProvider 中使用。');
  return value;
}
