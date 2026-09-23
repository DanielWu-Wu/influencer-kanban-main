'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { LoaderCircle } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { USER_DATA_KEYS, type UserDataKey } from '@/lib/account-data-keys';
import { scopedLocalStorageKey } from '@/lib/account-cache-scope';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { runSafeRequestWithSessionRecovery } from '@/lib/session-recovery';

const LEGACY_STORAGE_KEYS = [
  'influencer-board-influencers',
  'influencer-board-templates',
  'influencer-board-reminders',
  'influencer-board-emails',
  'influencer-board-collaborations',
  'influencer-board-todos',
  'influencer-board-calendar-events',
  'influencer-board-products',
  'influencer-board-settings',
  'gmail-auth',
  'gmail-threads',
  'gmail-translations',
  'gmail-drafts',
  'gmail-ai-suggestions',
  'influencer-board-daily-gmail-summaries-v1',
  'influencer-board-daily-gmail-completions-v1',
  'influencer-board-daily-gmail-tasks-v2',
  'influencer-board-creator-prospects',
  'influencer-board-creator-prospects-deleted',
] as const;

type UserDataContextValue = {
  data: Record<string, unknown>;
  loading: boolean;
  error: string;
  save: (key: UserDataKey, value: unknown) => void;
  update: (key: UserDataKey, updater: (current: unknown) => unknown) => void;
};

const UserDataContext = createContext<UserDataContextValue | null>(null);

const TODO_OUTBOX_PREFIX = 'influencer-board-todo-cloud-outbox-v1';
const SAVE_RETRY_DELAYS_MS = [0, 600, 1800] as const;

type PendingTodoWrite = {
  id: string;
  queuedAt: string;
  data: unknown;
};

function todoOutboxKey(userId: string) {
  return `${TODO_OUTBOX_PREFIX}:${userId}`;
}

function readPendingTodoWrite(userId: string): PendingTodoWrite | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(todoOutboxKey(userId)) || 'null') as Partial<PendingTodoWrite> | null;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.queuedAt !== 'string' || !Array.isArray(parsed.data)) {
      return null;
    }
    return { id: parsed.id, queuedAt: parsed.queuedAt, data: parsed.data };
  } catch {
    return null;
  }
}

function writePendingTodoWrite(userId: string, data: unknown): PendingTodoWrite | null {
  if (typeof window === 'undefined') return null;
  const pending = {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString(),
    data,
  } satisfies PendingTodoWrite;
  try {
    window.localStorage.setItem(todoOutboxKey(userId), JSON.stringify(pending));
    return pending;
  } catch {
    return null;
  }
}

function clearPendingTodoWrite(userId: string, pendingId?: string) {
  if (typeof window === 'undefined') return;
  if (pendingId) {
    const current = readPendingTodoWrite(userId);
    if (current?.id !== pendingId) return;
  }
  window.localStorage.removeItem(todoOutboxKey(userId));
}

function isPendingWriteNewer(pending: PendingTodoWrite, cloudUpdatedAt?: unknown) {
  if (typeof cloudUpdatedAt !== 'string') return true;
  const pendingTime = Date.parse(pending.queuedAt);
  const cloudTime = Date.parse(cloudUpdatedAt);
  return Number.isNaN(pendingTime) || Number.isNaN(cloudTime) || pendingTime > cloudTime;
}

function waitForRetry(delayMs: number) {
  if (!delayMs) return Promise.resolve();
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs));
}

const NETWORK_ERROR_PATTERN = /failed to fetch|network(?:error| request failed)|load failed/i;

function cloudSaveErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : '';
  if (!message || NETWORK_ERROR_PATTERN.test(message)) {
    return '账号数据暂时无法连接云端，请检查网络后重试。';
  }
  return message;
}

function readLegacySnapshot() {
  return Object.fromEntries(
    LEGACY_STORAGE_KEYS.flatMap((key) => {
      const value = window.localStorage.getItem(key);
      return value === null ? [] : [[key, value]];
    }),
  );
}

const LEGACY_SCOPED_CACHE_KEYS = [
  'influencer-board-creator-prospects-deleted',
  'influencer-board-sidebar-collapsed',
  'record-assistant-pending-syncs',
  'record-assistant-logs',
  'record-assistant-floating-position',
] as const;

function copyLegacyScopedCaches(userId: string) {
  for (const key of LEGACY_SCOPED_CACHE_KEYS) {
    const value = window.localStorage.getItem(key);
    const targetKey = scopedLocalStorageKey(key);
    if (value !== null && window.localStorage.getItem(targetKey) === null) {
      window.localStorage.setItem(targetKey, value);
    }
  }

  const followUpPrefix = 'influencer_follow_up_drafts_v1:';
  const targetKey = `${followUpPrefix}${userId}`;
  if (window.localStorage.getItem(targetKey) !== null) return;
  const merged: Record<string, unknown> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(followUpPrefix) || key === targetKey) continue;
    try {
      const value = JSON.parse(window.localStorage.getItem(key) || '{}') as Record<string, unknown>;
      Object.assign(merged, value);
    } catch {
      // Invalid legacy cache entries stay untouched and are ignored.
    }
  }
  if (Object.keys(merged).length) {
    window.localStorage.setItem(targetKey, JSON.stringify(merged));
  }
}

export function UserDataProvider({ children }: { children: React.ReactNode }) {
  const { account, ensureSession } = useAuth();
  const accountUserId = account?.userId;
  const accountStatus = account?.status;
  const accountMustChangePassword = account?.mustChangePassword;
  const accountIsAdmin = account?.isAdmin;
  const [data, setData] = useState<Record<string, unknown>>({});
  const dataRef = useRef<Record<string, unknown>>({});
  const [dataOwnerId, setDataOwnerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const writeQueues = useRef(new Map<string, Promise<void>>());
  const reportedErrors = useRef(new Set<string>());
  const currentAccountId = useRef<string | null>(accountUserId || null);

  const replaceData = useCallback((next: Record<string, unknown>) => {
    // Child mount effects may save immediately after hydration. Keep their
    // merge source current before publishing the new data to consumers.
    dataRef.current = next;
    setData(next);
  }, []);

  const writeCloudValue = useCallback(async (ownerId: string, key: UserDataKey, value: unknown) => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < SAVE_RETRY_DELAYS_MS.length; attempt += 1) {
      await waitForRetry(SAVE_RETRY_DELAYS_MS[attempt]);
      if (currentAccountId.current !== ownerId) return;
      try {
        const response = await runSafeRequestWithSessionRecovery(
          ensureSession,
          () => {
            if (currentAccountId.current !== ownerId) throw new Error('账号已变化，本次同步已停止。');
            return fetch('/api/user-data', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ key, data: value }),
            });
          },
        );
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.success) return;
        lastError = new Error(result.error || '账号数据保存失败。');
        if (![408, 429].includes(response.status) && response.status < 500) break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('账号数据保存失败。');
      }
    }
    throw lastError || new Error('账号数据保存失败。');
  }, [ensureSession]);

  const enqueueWrite = useCallback((
    ownerId: string,
    key: UserDataKey,
    value: unknown,
    pendingTodoId?: string,
  ) => {
    const previous = writeQueues.current.get(key) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (currentAccountId.current !== ownerId) return;
        await writeCloudValue(ownerId, key, value);
        if (currentAccountId.current !== ownerId) return;
        if (key === 'todos') clearPendingTodoWrite(ownerId, pendingTodoId);
        reportedErrors.current.delete(key);
      })
      .catch((saveError) => {
        if (currentAccountId.current !== ownerId) return;
        if (reportedErrors.current.has(key)) return;
        reportedErrors.current.add(key);
        if (key === USER_DATA_KEYS.TODOS) {
          toast.error('任务暂未同步云端，系统会在网络恢复后自动重试。');
          return;
        }
        if (key === USER_DATA_KEYS.EMAIL_GENERATION_TASKS) {
          toast.warning('邮件生成记录暂未同步云端，当前内容仍保留在页面中，请确认同步恢复后再关闭。');
          return;
        }
        toast.error(cloudSaveErrorMessage(saveError));
      })
      .finally(() => {
        if (writeQueues.current.get(key) === next) writeQueues.current.delete(key);
      });
    writeQueues.current.set(key, next);
    return next;
  }, [writeCloudValue]);

  useEffect(() => {
    currentAccountId.current = accountUserId || null;
  }, [accountUserId]);

  useEffect(() => {
    if (!accountUserId || accountStatus !== 'active' || accountMustChangePassword) {
      writeQueues.current.clear();
      replaceData({});
      setDataOwnerId(null);
      setLoading(false);
      setError('');
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      replaceData({});
      setDataOwnerId(null);
      try {
        if (accountIsAdmin) {
          copyLegacyScopedCaches(accountUserId);
          const legacy = readLegacySnapshot();
          if (Object.keys(legacy).length) {
            const migrationResponse = await fetch('/api/account/migrate-legacy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ legacy }),
            });
            const migrationResult = await migrationResponse.json();
            if (!migrationResponse.ok || !migrationResult.success) {
              throw new Error(migrationResult.error || '历史数据迁移失败。');
            }
            for (const key of migrationResult.data?.migratedKeys || []) {
              window.localStorage.removeItem(String(key));
            }
          }
        }

        const response = await runSafeRequestWithSessionRecovery(
          ensureSession,
          () => fetch('/api/user-data', { cache: 'no-store' }),
        );
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '账号数据读取失败。');
        if (active) {
          const cloudData = result.data || {};
          const pendingTodo = readPendingTodoWrite(accountUserId);
          const cloudTodoUpdatedAt = result.meta?.updatedAtByKey?.todos;
          const shouldRestorePendingTodo = pendingTodo && isPendingWriteNewer(pendingTodo, cloudTodoUpdatedAt);
          const nextData = shouldRestorePendingTodo
            ? { ...cloudData, todos: pendingTodo.data }
            : cloudData;
          if (pendingTodo && !shouldRestorePendingTodo) clearPendingTodoWrite(accountUserId, pendingTodo.id);
          replaceData(nextData);
          setDataOwnerId(accountUserId);
          if (shouldRestorePendingTodo) {
            void enqueueWrite(accountUserId, 'todos', pendingTodo.data, pendingTodo.id);
          }
        }
      } catch (loadError) {
        if (active) {
          const message = loadError instanceof Error ? loadError.message : '账号数据读取失败。';
          setError(message);
          replaceData({});
          setDataOwnerId(accountUserId);
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [accountIsAdmin, accountMustChangePassword, accountStatus, accountUserId, enqueueWrite, ensureSession, replaceData]);

  const save = useCallback((key: UserDataKey, value: unknown) => {
    const ownerId = accountUserId;
    if (!ownerId) return;
    replaceData({ ...dataRef.current, [key]: value });
    const pendingTodo = key === 'todos' ? writePendingTodoWrite(ownerId, value) : null;
    void enqueueWrite(ownerId, key, value, pendingTodo?.id);
  }, [accountUserId, enqueueWrite, replaceData]);

  useEffect(() => {
    if (!accountUserId || accountStatus !== 'active' || accountMustChangePassword) return;
    const retryPendingTodo = () => {
      const pending = readPendingTodoWrite(accountUserId);
      if (!pending || writeQueues.current.has('todos')) return;
      replaceData({ ...dataRef.current, todos: pending.data });
      void enqueueWrite(accountUserId, 'todos', pending.data, pending.id);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') retryPendingTodo();
    };
    window.addEventListener('online', retryPendingTodo);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('online', retryPendingTodo);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [accountMustChangePassword, accountStatus, accountUserId, enqueueWrite, replaceData]);

  const update = useCallback((key: UserDataKey, updater: (current: unknown) => unknown) => {
    save(key, updater(dataRef.current[key]));
  }, [save]);

  const value = useMemo<UserDataContextValue>(
    () => ({ data, loading, error, save, update }),
    [data, error, loading, save, update],
  );
  if (
    account?.status === 'active'
    && !account.mustChangePassword
    && (loading || dataOwnerId !== account.userId)
  ) {
    return (
      <div className="workspace-shell flex min-h-screen items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" />正在加载当前账号的数据…
        </div>
      </div>
    );
  }
  if (account?.status === 'active' && !account.mustChangePassword && error) {
    return (
      <div className="workspace-shell flex min-h-screen items-center justify-center p-6">
        <Alert variant="destructive" className="max-w-lg">
          <AlertTitle>当前账号的数据尚未就绪</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{error}</span>
            <Button variant="outline" onClick={() => window.location.reload()}>重新加载</Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  return <UserDataContext.Provider value={value}>{children}</UserDataContext.Provider>;
}

export function useUserDataStore() {
  const value = useContext(UserDataContext);
  if (!value) throw new Error('useUserDataStore 必须在 UserDataProvider 中使用。');
  return value;
}
