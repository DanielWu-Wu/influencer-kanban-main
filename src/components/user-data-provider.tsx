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
import type { UserDataKey } from '@/lib/account-data-keys';
import { scopedLocalStorageKey } from '@/lib/account-cache-scope';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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
};

const UserDataContext = createContext<UserDataContextValue | null>(null);

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
  const { account, loading: authLoading } = useAuth();
  const [data, setData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const writeQueues = useRef(new Map<string, Promise<void>>());
  const reportedErrors = useRef(new Set<string>());
  const currentAccountId = useRef<string | null>(account?.userId || null);
  currentAccountId.current = account?.userId || null;

  useEffect(() => {
    if (authLoading) return;
    if (!account || account.status !== 'active' || account.mustChangePassword) {
      writeQueues.current.clear();
      setData({});
      setLoading(false);
      setError('');
      return;
    }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        if (account.isAdmin) {
          copyLegacyScopedCaches(account.userId);
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

        const response = await fetch('/api/user-data', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || '账号数据读取失败。');
        if (active) setData(result.data || {});
      } catch (loadError) {
        if (active) {
          const message = loadError instanceof Error ? loadError.message : '账号数据读取失败。';
          setError(message);
          setData({});
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [account, authLoading]);

  const save = useCallback((key: UserDataKey, value: unknown) => {
    const ownerId = account?.userId;
    if (!ownerId) return;
    setData((current) => ({ ...current, [key]: value }));
    const previous = writeQueues.current.get(key) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (currentAccountId.current !== ownerId) return;
        const response = await fetch('/api/user-data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, data: value }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
          throw new Error(result.error || '账号数据保存失败。');
        }
        reportedErrors.current.delete(key);
      })
      .catch((saveError) => {
        if (reportedErrors.current.has(key)) return;
        reportedErrors.current.add(key);
        toast.error(saveError instanceof Error ? saveError.message : '账号数据保存失败。');
      })
      .finally(() => {
        if (writeQueues.current.get(key) === next) writeQueues.current.delete(key);
      });
    writeQueues.current.set(key, next);
  }, [account?.userId]);

  const value = useMemo<UserDataContextValue>(() => ({ data, loading, error, save }), [data, error, loading, save]);
  if (account?.status === 'active' && !account.mustChangePassword && loading) {
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
