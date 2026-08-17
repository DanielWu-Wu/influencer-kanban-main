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
import { useUserDataStore } from '@/components/user-data-provider';
import {
  GMAIL_AUTH_CACHE_RESET_EVENT,
  useGmailAuth,
} from '@/components/gmail-auth-provider';
import {
  EMAIL_GENERATION_TASK_OPEN_EVENT,
  EMAIL_GENERATION_TOASTER_ID,
  buildEmailGenerationTaskScopeKey,
  markInterruptedEmailGenerationTasks,
  normalizeEmailGenerationConcurrency,
  readEmailGenerationTaskSnapshot,
  pruneExpiredEmailGenerationTasks,
  serializeEmailGenerationTasks,
  selectStartableEmailTaskIds,
  type EmailGenerationTask,
  type EmailGenerationTaskKind,
  type EmailGenerationTaskNavigation,
} from '@/lib/email-generation-tasks';
import { USER_DATA_KEYS } from '@/lib/account-data-keys';

interface EmailGenerationTaskRunContext {
  signal: AbortSignal;
  report: (stage: string, partialResult?: unknown) => void;
}

interface EnqueueEmailGenerationTaskInput {
  key: string;
  kind: EmailGenerationTaskKind;
  title: string;
  description: string;
  avatarUrl?: string;
  navigation: EmailGenerationTaskNavigation;
  initialStage?: string;
  rollbackResult?: unknown;
  retryInput?: unknown;
  run: (context: EmailGenerationTaskRunContext) => Promise<unknown>;
}

interface EmailGenerationTaskContextValue {
  tasks: EmailGenerationTask[];
  concurrency: number;
  setConcurrency: (value: number) => void;
  enqueueTask: (input: EnqueueEmailGenerationTaskInput) => string | null;
  cancelTask: (taskId: string) => void;
  retryTask: (taskId: string) => void;
  openTask: (taskId: string) => void;
  getLatestTaskByKey: (key: string) => EmailGenerationTask | undefined;
}

type TaskRunner = EnqueueEmailGenerationTaskInput['run'];

const EmailGenerationTaskContext = createContext<EmailGenerationTaskContextValue | null>(null);

function createTaskId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `email-task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dispatchOpenTask(task: EmailGenerationTask, retryRequested = false) {
  window.dispatchEvent(new CustomEvent(EMAIL_GENERATION_TASK_OPEN_EVENT, {
    detail: {
      taskId: task.id,
      navigation: task.navigation,
      retryRequested,
      retryInput: retryRequested ? task.retryInput : undefined,
    },
  }));
}

function completionMessage(task: EmailGenerationTask) {
  return task.kind === 'outreach_email'
    ? `${task.title} 的开发信已生成`
    : `${task.title} 的邮件回复已生成`;
}

export function EmailGenerationTaskProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth();
  const { auth: gmailAuth } = useGmailAuth();
  const { data: userData, loading: userDataLoading, save: saveUserData } = useUserDataStore();
  const accountUserId = account?.userId || '';
  const gmailEmail = gmailAuth?.email?.trim().toLowerCase() || '';
  const scopeKey = buildEmailGenerationTaskScopeKey(accountUserId, gmailEmail);
  const scopeKeyRef = useRef(scopeKey);
  const tasksRef = useRef<EmailGenerationTask[]>([]);
  const persistedTasksRef = useRef<EmailGenerationTask[]>([]);
  const hydratedAccountIdRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const lastPersistedAtRef = useRef(0);
  const runnersRef = useRef(new Map<string, TaskRunner>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const drainQueueRef = useRef<() => void>(() => undefined);
  const disposedRef = useRef(false);
  const [tasks, setTasks] = useState<EmailGenerationTask[]>([]);
  const [concurrency, setConcurrencyState] = useState(2);
  const concurrencyRef = useRef(concurrency);

  const persistCloudTasks = useCallback((immediate = false) => {
    const ownerId = accountUserId;
    if (!ownerId || hydratedAccountIdRef.current !== ownerId) return;
    const write = () => {
      persistTimerRef.current = null;
      if (hydratedAccountIdRef.current !== ownerId) return;
      lastPersistedAtRef.current = Date.now();
      persistedTasksRef.current = pruneExpiredEmailGenerationTasks(persistedTasksRef.current);
      saveUserData(USER_DATA_KEYS.EMAIL_GENERATION_TASKS, serializeEmailGenerationTasks(persistedTasksRef.current));
    };
    const elapsed = Date.now() - lastPersistedAtRef.current;
    if (immediate || elapsed >= 1000) {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      write();
      return;
    }
    if (persistTimerRef.current !== null) return;
    persistTimerRef.current = window.setTimeout(write, 1000 - elapsed);
  }, [accountUserId, saveUserData]);

  const mergeVisibleTasksIntoCloud = useCallback((nextTasks: EmailGenerationTask[]) => {
    const visibleIds = new Set(tasksRef.current.map((task) => task.id));
    const nextById = new Map(nextTasks.map((task) => [task.id, task]));
    persistedTasksRef.current = [
      ...persistedTasksRef.current.filter((task) => !visibleIds.has(task.id)),
      ...nextById.values(),
    ];
  }, []);

  const replaceTasks = useCallback((updater: (current: EmailGenerationTask[]) => EmailGenerationTask[]) => {
    const nextTasks = updater(tasksRef.current);
    mergeVisibleTasksIntoCloud(nextTasks);
    tasksRef.current = nextTasks;
    setTasks(nextTasks);
    persistCloudTasks();
    return nextTasks;
  }, [mergeVisibleTasksIntoCloud, persistCloudTasks]);

  const clearTasks = useCallback(() => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    runnersRef.current.clear();
    tasksRef.current = [];
    setTasks([]);
  }, []);

  const interruptVisibleTasks = useCallback(() => {
    if (!tasksRef.current.length) return;
    const interrupted = markInterruptedEmailGenerationTasks(tasksRef.current);
    mergeVisibleTasksIntoCloud(interrupted);
    tasksRef.current = [];
    setTasks([]);
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    runnersRef.current.clear();
    persistCloudTasks(true);
  }, [mergeVisibleTasksIntoCloud, persistCloudTasks]);

  const startTask = useCallback((taskId: string) => {
    if (disposedRef.current) return;
    const runner = runnersRef.current.get(taskId);
    if (!runner) return;

    const controller = new AbortController();
    controllersRef.current.set(taskId, controller);
    const taskScopeKey = scopeKeyRef.current;
    const report = (stage: string, partialResult?: unknown) => {
      if (disposedRef.current || controller.signal.aborted || scopeKeyRef.current !== taskScopeKey) return;
      replaceTasks((current) => current.map((task) => task.id === taskId
        ? {
            ...task,
            stage,
            ...(partialResult === undefined ? {} : { partialResult }),
          }
        : task));
    };

    void runner({ signal: controller.signal, report })
      .then((result) => {
        if (disposedRef.current || controller.signal.aborted || scopeKeyRef.current !== taskScopeKey) return;
        let completedTask: EmailGenerationTask | undefined;
        replaceTasks((current) => current.map((task) => {
          if (task.id !== taskId || task.status !== 'running') return task;
          completedTask = {
            ...task,
            status: 'completed',
            stage: '已生成',
            completedAt: Date.now(),
            result,
            partialResult: undefined,
            error: undefined,
          };
          return completedTask;
        }));
        if (completedTask) {
          persistCloudTasks(true);
          const task = completedTask;
          toast.success(completionMessage(task), {
            toasterId: EMAIL_GENERATION_TOASTER_ID,
            action: {
              label: '打开',
              onClick: () => dispatchOpenTask(task),
            },
          });
        }
        runnersRef.current.delete(taskId);
      })
      .catch((error: unknown) => {
        if (disposedRef.current || controller.signal.aborted || scopeKeyRef.current !== taskScopeKey) return;
        const message = error instanceof Error && error.message
          ? error.message
          : '生成失败，请稍后重试。';
        replaceTasks((current) => current.map((task) => task.id === taskId
          ? {
              ...task,
              status: 'failed',
              stage: '生成失败',
              completedAt: Date.now(),
              error: message,
            }
          : task));
        persistCloudTasks(true);
        toast.error('邮件生成失败，请在“邮件生成进度”中重试。', {
          toasterId: EMAIL_GENERATION_TOASTER_ID,
        });
      })
      .finally(() => {
        controllersRef.current.delete(taskId);
        if (!disposedRef.current) window.queueMicrotask(() => drainQueueRef.current());
      });
  }, [persistCloudTasks, replaceTasks]);

  const drainQueue = useCallback(() => {
    if (disposedRef.current) return;
    const startableIds = selectStartableEmailTaskIds(tasksRef.current, concurrencyRef.current);
    if (startableIds.length === 0) return;
    const startedAt = Date.now();
    replaceTasks((current) => current.map((task) => startableIds.includes(task.id)
      ? { ...task, status: 'running', stage: '正在准备', startedAt }
      : task));
    startableIds.forEach(startTask);
  }, [replaceTasks, startTask]);

  useEffect(() => {
    drainQueueRef.current = drainQueue;
  }, [drainQueue]);

  const enqueueTask = useCallback((input: EnqueueEmailGenerationTaskInput) => {
    if (disposedRef.current || !accountUserId) return null;
    const activeDuplicate = tasksRef.current.find((task) => (
      task.key === input.key
      && (task.status === 'queued' || task.status === 'running')
    ));
    if (activeDuplicate) return activeDuplicate.id;

    const id = createTaskId();
    const task: EmailGenerationTask = {
      id,
      key: input.key,
      kind: input.kind,
      status: 'queued',
      accountUserId,
      gmailEmail,
      title: input.title.trim() || '未命名频道',
      description: input.description,
      avatarUrl: input.avatarUrl,
      stage: input.initialStage || '等待生成',
      navigation: input.navigation,
      createdAt: Date.now(),
      rollbackResult: input.rollbackResult,
      retryInput: input.retryInput,
    };
    runnersRef.current.set(id, input.run);
    replaceTasks((current) => [...pruneExpiredEmailGenerationTasks(current), task]);
    window.queueMicrotask(drainQueue);
    return id;
  }, [accountUserId, drainQueue, gmailEmail, replaceTasks]);

  const cancelTask = useCallback((taskId: string) => {
    const task = tasksRef.current.find((item) => item.id === taskId);
    if (!task || task.status !== 'queued') return;
    runnersRef.current.delete(taskId);
    replaceTasks((current) => current.map((item) => item.id === taskId
      ? { ...item, status: 'cancelled', stage: '已取消', completedAt: Date.now() }
      : item));
  }, [replaceTasks]);

  const retryTask = useCallback((taskId: string) => {
    const task = tasksRef.current.find((item) => item.id === taskId);
    if (!task || (task.status !== 'failed' && task.status !== 'interrupted')) return;
    if (!runnersRef.current.has(taskId)) {
      const canAutoRetry = task.navigation.view === 'prospecting' || task.retryInput !== undefined;
      dispatchOpenTask(task, canAutoRetry);
      if (canAutoRetry) {
        replaceTasks((current) => current.map((item) => item.id === taskId
          ? { ...item, status: 'cancelled', stage: '已重新发起', completedAt: Date.now() }
          : item));
      }
      return;
    }
    replaceTasks((current) => current.map((item) => item.id === taskId
      ? {
          ...item,
          status: 'queued',
          stage: '等待重试',
          startedAt: undefined,
          completedAt: undefined,
          partialResult: undefined,
          result: undefined,
          error: undefined,
        }
      : item));
    window.queueMicrotask(drainQueue);
  }, [drainQueue, replaceTasks]);

  const openTask = useCallback((taskId: string) => {
    const task = tasksRef.current.find((item) => item.id === taskId);
    if (task) dispatchOpenTask(task);
  }, []);

  const getLatestTaskByKey = useCallback((key: string) => {
    return [...tasksRef.current]
      .reverse()
      .find((task) => task.key === key && task.status !== 'cancelled');
  }, []);

  const setConcurrency = useCallback((value: number) => {
    const normalized = normalizeEmailGenerationConcurrency(value);
    concurrencyRef.current = normalized;
    setConcurrencyState(normalized);
    window.queueMicrotask(drainQueue);
  }, [drainQueue]);

  useEffect(() => {
    if (scopeKeyRef.current === scopeKey) return;
    interruptVisibleTasks();
    scopeKeyRef.current = scopeKey;
    const visible = persistedTasksRef.current.filter((task) => (
      buildEmailGenerationTaskScopeKey(task.accountUserId, task.gmailEmail) === scopeKey
    ));
    tasksRef.current = visible;
    setTasks(visible);
  }, [interruptVisibleTasks, scopeKey]);

  useEffect(() => {
    if (userDataLoading || !accountUserId) {
      if (!accountUserId) {
        clearTasks();
        persistedTasksRef.current = [];
        hydratedAccountIdRef.current = null;
        scopeKeyRef.current = scopeKey;
      }
      return;
    }
    if (hydratedAccountIdRef.current === accountUserId) return;

    const loaded = readEmailGenerationTaskSnapshot(userData[USER_DATA_KEYS.EMAIL_GENERATION_TASKS]);
    const accountTasks = pruneExpiredEmailGenerationTasks(
      loaded.filter((task) => task.accountUserId === accountUserId),
    );
    const recovered = markInterruptedEmailGenerationTasks(accountTasks);
    const hadInterruptedTasks = recovered.some((task, index) => task.status !== accountTasks[index]?.status);
    persistedTasksRef.current = recovered;
    hydratedAccountIdRef.current = accountUserId;
    scopeKeyRef.current = scopeKey;
    const visible = recovered.filter((task) => buildEmailGenerationTaskScopeKey(task.accountUserId, task.gmailEmail) === scopeKey);
    tasksRef.current = visible;
    setTasks(visible);
    if (hadInterruptedTasks) persistCloudTasks(true);
  }, [accountUserId, clearTasks, persistCloudTasks, scopeKey, userData, userDataLoading]);

  useEffect(() => {
    const handleReset = () => interruptVisibleTasks();
    window.addEventListener(GMAIL_AUTH_CACHE_RESET_EVENT, handleReset);
    return () => window.removeEventListener(GMAIL_AUTH_CACHE_RESET_EVENT, handleReset);
  }, [interruptVisibleTasks]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      replaceTasks((current) => {
        const retained = pruneExpiredEmailGenerationTasks(current);
        const retainedIds = new Set(retained.map((task) => task.id));
        runnersRef.current.forEach((_, taskId) => {
          if (!retainedIds.has(taskId)) runnersRef.current.delete(taskId);
        });
        return retained;
      });
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [replaceTasks]);

  useEffect(() => {
    disposedRef.current = false;
    const controllers = controllersRef.current;
    const runners = runnersRef.current;
    return () => {
      disposedRef.current = true;
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
      runners.clear();
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      tasksRef.current = [];
    };
  }, []);

  const value = useMemo<EmailGenerationTaskContextValue>(() => ({
    tasks,
    concurrency,
    setConcurrency,
    enqueueTask,
    cancelTask,
    retryTask,
    openTask,
    getLatestTaskByKey,
  }), [
    cancelTask,
    concurrency,
    enqueueTask,
    getLatestTaskByKey,
    openTask,
    retryTask,
    setConcurrency,
    tasks,
  ]);

  return (
    <EmailGenerationTaskContext.Provider value={value}>
      {children}
    </EmailGenerationTaskContext.Provider>
  );
}

export function useEmailGenerationTasks() {
  const context = useContext(EmailGenerationTaskContext);
  if (!context) throw new Error('useEmailGenerationTasks must be used within EmailGenerationTaskProvider');
  return context;
}
