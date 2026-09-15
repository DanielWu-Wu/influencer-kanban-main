'use client';

import { createContext, Fragment, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { registerWorkspaceSession, waitForWorkspace } from '@/lib/workspace-request';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, getSupabaseConfig } from '@/lib/supabase/client';
import type {
  AccountErrorCode,
  AccountIssue,
  AccountMeResponse,
  AccountProfile,
} from '@/lib/account-types';
import { setAccountCacheScope } from '@/lib/account-cache-scope';
import {
  classifyAuthVerificationError,
  shouldPreserveLastAccount,
  shouldRefreshAccountSession,
} from '@/lib/account-load-state';
import {
  canReuseReadyWorkspaceSession,
  shouldRefreshWorkspaceSession,
} from '@/lib/session-recovery';

export type EnsureWorkspaceSessionOptions = {
  forceRefresh?: boolean;
  forceVerify?: boolean;
};

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  account: AccountProfile | null;
  accountIssue: AccountIssue | null;
  loading: boolean;
  configured: boolean;
  ensureSession: (options?: EnsureWorkspaceSessionOptions) => Promise<Session | null>;
  signOut: () => Promise<void>;
  refreshAccount: () => Promise<AccountProfile | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type AccountLoadResult =
  | { status: 'success'; account: AccountProfile }
  | { status: 'invalid' | 'unavailable'; issue: AccountIssue };

async function syncServerSession(session: Session | null, signal?: AbortSignal) {
  return await fetch('/api/cloud/session', {
    method: session ? 'POST' : 'DELETE',
    headers: session ? { 'Content-Type': 'application/json' } : undefined,
    body: session ? JSON.stringify({ accessToken: session.access_token }) : undefined,
    signal,
  }).catch(() => undefined);
}

function createUnavailableIssue(message = '账号服务暂时无法连接，请检查网络后重试。'): AccountIssue {
  return {
    kind: 'unavailable',
    code: 'ACCOUNT_SERVICE_UNAVAILABLE',
    message,
  };
}

function createInvalidSessionIssue(message = '登录状态已失效，请重新登录。'): AccountIssue {
  return {
    kind: 'invalid',
    code: 'SESSION_INVALID',
    message,
  };
}

async function readAccountIssue(response: Response): Promise<AccountIssue> {
  const result = await response.json().catch(() => null) as Partial<AccountMeResponse> | null;
  const candidateCode = result && 'code' in result ? result.code : undefined;
  const kind = (response.status === 401 && candidateCode === 'SESSION_INVALID')
    || (response.status === 403 && (candidateCode === 'ACCOUNT_DISABLED' || candidateCode === 'ACCOUNT_NOT_PROVISIONED'))
    ? 'invalid' : 'unavailable';
  const code: AccountErrorCode = kind === 'unavailable' ? 'ACCOUNT_SERVICE_UNAVAILABLE' : candidateCode as AccountErrorCode;
  const candidateMessage = result && 'error' in result ? result.error : undefined;
  return {
    kind,
    code,
    message: typeof candidateMessage === 'string'
      ? candidateMessage
      : kind === 'unavailable'
        ? '账号服务暂时无法连接，请检查网络后重试。'
        : '登录状态已失效，请重新登录。',
  };
}

async function loadAccount(session: Session, signal: AbortSignal): Promise<AccountLoadResult> {
  try {
    const sessionResponse = await syncServerSession(session, signal);
    if (!sessionResponse) return { status: 'unavailable', issue: createUnavailableIssue() };
    if (!sessionResponse.ok) {
      const issue = await readAccountIssue(sessionResponse);
      return { status: issue.kind, issue };
    }

    const result = await sessionResponse.json().catch(() => null) as AccountMeResponse | null;
    if (result?.success) return { status: 'success', account: result.data };
    return { status: 'unavailable', issue: createUnavailableIssue('账号资料返回异常，请稍后重试。') };
  } catch {
    return { status: 'unavailable', issue: createUnavailableIssue() };
  }
}

type AccountSessionLoadResult = {
  session: Session;
  result: AccountLoadResult;
};

type SessionRefreshResult =
  | { status: 'success'; session: Session }
  | { status: 'invalid' | 'unavailable'; issue: AccountIssue };

async function refreshAccountSession(
  supabase: SupabaseClient,
  expectedUserId: string,
  signal: AbortSignal,
): Promise<SessionRefreshResult> {
  const refreshed = await waitForWorkspace(supabase.auth.refreshSession(), signal).catch(() => null);
  if (!refreshed) return { status: 'unavailable', issue: createUnavailableIssue() };
  if (refreshed.data.session?.user.id === expectedUserId) {
    return { status: 'success', session: refreshed.data.session };
  }
  const refreshStatus = refreshed.error && 'status' in refreshed.error
    ? Number((refreshed.error as { status?: unknown }).status)
    : undefined;
  if (classifyAuthVerificationError(refreshStatus) === 'unavailable') {
    return { status: 'unavailable', issue: createUnavailableIssue() };
  }
  return { status: 'invalid', issue: createInvalidSessionIssue() };
}

async function loadAccountWithSessionRecovery(
  supabase: SupabaseClient,
  session: Session,
  options: EnsureWorkspaceSessionOptions = {},
  signal: AbortSignal,
): Promise<AccountSessionLoadResult> {
  let latestSession = session;
  const currentSession = await waitForWorkspace(supabase.auth.getSession(), signal);
  if (currentSession.data.session?.user.id === session.user.id) {
    latestSession = currentSession.data.session;
  }

  let refreshedOnce = false;
  if (options.forceRefresh || shouldRefreshWorkspaceSession(latestSession.expires_at)) {
    const refreshed = await refreshAccountSession(supabase, session.user.id, signal);
    if (refreshed.status !== 'success') {
      return { session: latestSession, result: { status: refreshed.status, issue: refreshed.issue } };
    }
    latestSession = refreshed.session;
    refreshedOnce = true;
  }

  let result = await loadAccount(latestSession, signal);
  if (
    refreshedOnce
    || result.status !== 'invalid'
    || !shouldRefreshAccountSession(result.status, result.issue.code)
  ) {
    return { session: latestSession, result };
  }

  const refreshed = await refreshAccountSession(supabase, session.user.id, signal);
  if (refreshed.status !== 'success') {
    return { session: latestSession, result: { status: refreshed.status, issue: refreshed.issue } };
  }
  latestSession = refreshed.session;
  result = await loadAccount(latestSession, signal);
  return { session: latestSession, result };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = getSupabaseConfig().configured;
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [accountIssue, setAccountIssue] = useState<AccountIssue | null>(null);
  const [loading, setLoading] = useState(configured);
  const sessionRef = useRef<Session | null>(null);
  const accountRef = useRef<AccountProfile | null>(null);
  const currentAccountId = useRef<string | null>(null);
  const accountRequestVersion = useRef(0);
  const sessionRecoveryRef = useRef<{
    userId: string | null;
    request: Promise<Session | null>;
    forceRefresh: boolean;
    controller: AbortController;
  } | null>(null);
  const readySessionRef = useRef({
    readyAt: 0,
    accessToken: '',
  });

  useEffect(() => {
    accountRef.current = account;
    currentAccountId.current = account?.userId || null;
  }, [account]);

  const applyAccountResult = useCallback((result: AccountLoadResult, expectedUserId: string) => {
    if (result.status === 'success') {
      if (result.account.userId !== expectedUserId) {
        setAccount(null);
        accountRef.current = null;
        setAccountIssue({
          kind: 'invalid',
          code: 'SESSION_INVALID',
          message: '账号身份校验不一致，请重新登录。',
        });
        currentAccountId.current = null;
        setAccountCacheScope(null);
        return null;
      }
      setAccount(result.account);
      accountRef.current = result.account;
      setAccountIssue(null);
      currentAccountId.current = result.account.userId;
      setAccountCacheScope(result.account.userId);
      return result.account;
    }

    setAccountIssue(result.issue);
    if (!shouldPreserveLastAccount(result.status, currentAccountId.current, expectedUserId)) {
      setAccount(null);
      accountRef.current = null;
      currentAccountId.current = null;
      setAccountCacheScope(null);
    }
    return null;
  }, []);

  const ensureSession = useCallback((options: EnsureWorkspaceSessionOptions = {}) => {
    if (!supabase) return Promise.resolve(null);
    const knownSession = sessionRef.current;
    const existing = sessionRecoveryRef.current;
    if (
      existing
      && (existing.userId === null || existing.userId === knownSession?.user.id)
    ) {
      if (options.forceRefresh) existing.forceRefresh = true;
      return existing.request;
    }
    if (
      knownSession
      && !options.forceRefresh
      && !options.forceVerify
      && canReuseReadyWorkspaceSession({
        readyAt: readySessionRef.current.readyAt,
        readyAccessToken: readySessionRef.current.accessToken,
        currentAccessToken: knownSession.access_token,
        expiresAtSeconds: knownSession.expires_at,
      })
    ) {
      return Promise.resolve(knownSession);
    }

    const recoveryUserId = knownSession?.user.id || null;
    const requestVersion = ++accountRequestVersion.current;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const job = { userId: recoveryUserId, forceRefresh: Boolean(options.forceRefresh), controller, request: null as unknown as Promise<Session | null> };
    const request = (async () => {
      let currentSession = knownSession;
      if (!currentSession) {
        const current = await waitForWorkspace(supabase.auth.getSession(), controller.signal);
        currentSession = current?.data.session || null;
      }
      if (requestVersion !== accountRequestVersion.current) return null;
      if (!currentSession) return null;

      sessionRef.current = currentSession;
      setSession(currentSession);
      let loaded: AccountSessionLoadResult | undefined;
      let settled = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (!currentSession) return null;
        const beforeToken = currentSession.access_token;
        const forceRefresh = job.forceRefresh;
        job.forceRefresh = false;
        loaded = await waitForWorkspace(loadAccountWithSessionRecovery(supabase, currentSession, { ...options, forceRefresh }, controller.signal), controller.signal);
        if (requestVersion !== accountRequestVersion.current || sessionRef.current?.user.id !== loaded.session.user.id) return null;
        const latest: Session = sessionRef.current;
        // A token event or stronger recovery request arrived during validation.
        if (latest.access_token !== beforeToken && latest.access_token !== loaded.session.access_token) {
          currentSession = latest;
          continue;
        }
        if (job.forceRefresh && !forceRefresh && loaded.session.access_token === beforeToken) {
          currentSession = loaded.session;
          continue;
        }
        settled = true;
        break;
      }
      if (!loaded || controller.signal.aborted) throw new Error('连接恢复超时，请重试。');
      if (!settled || (sessionRef.current?.access_token !== currentSession?.access_token && sessionRef.current?.access_token !== loaded.session.access_token)) {
        throw new Error('账号连接暂未恢复，请重试。');
      }

      sessionRef.current = loaded.session;
      setSession(loaded.session);
      const verifiedAccount = applyAccountResult(loaded.result, loaded.session.user.id);
      if (loaded.result.status === 'success' && verifiedAccount) {
        readySessionRef.current = {
          readyAt: Date.now(),
          accessToken: loaded.session.access_token,
        };
        return loaded.session;
      }
      readySessionRef.current = { readyAt: 0, accessToken: '' };
      if (loaded.result.status === 'unavailable') {
        throw new Error(loaded.result.issue.message);
      }
      return null;
    })().catch((error) => {
      if (requestVersion !== accountRequestVersion.current) return null;
      const issue = createUnavailableIssue(controller.signal.aborted ? '连接恢复超时，请重试。' : error instanceof Error ? error.message : undefined);
      applyAccountResult({ status: 'unavailable', issue }, sessionRef.current?.user.id || recoveryUserId || '');
      readySessionRef.current = { readyAt: 0, accessToken: '' };
      throw new Error(issue.message);
    });
    const trackedRequest = request.finally(() => {
      clearTimeout(timer);
      if (sessionRecoveryRef.current?.request === trackedRequest) {
        sessionRecoveryRef.current = null;
      }
    });
    job.request = trackedRequest;
    sessionRecoveryRef.current = job;
    return trackedRequest;
  }, [applyAccountResult, supabase]);

  useLayoutEffect(() => registerWorkspaceSession({ ensure: ensureSession, userId: () => sessionRef.current?.user.id || null }), [ensureSession]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    void ensureSession({ forceVerify: true })
      .catch(() => {
        // A temporary account-service failure is already represented by accountIssue.
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!nextSession) {
        accountRequestVersion.current += 1;
        sessionRecoveryRef.current?.controller.abort();
        sessionRecoveryRef.current = null;
        sessionRef.current = null;
        setSession(null);
        setAccount(null);
        accountRef.current = null;
        setAccountIssue(null);
        currentAccountId.current = null;
        readySessionRef.current = { readyAt: 0, accessToken: '' };
        setAccountCacheScope(null);
        setLoading(false);
        if (event === 'SIGNED_OUT') void syncServerSession(null);
        return;
      }
      // A signed-in user is not an invalid account while its profile request is
      // still in flight. Keep the login page in its loading state until the
      // account check has actually completed. Background refreshes for the
      // same user stay non-blocking so the current workspace remains mounted.
      if (sessionRef.current && sessionRef.current.user.id !== nextSession.user.id) {
        accountRequestVersion.current += 1;
        sessionRecoveryRef.current?.controller.abort();
        sessionRecoveryRef.current = null;
        accountRef.current = null;
        currentAccountId.current = null;
        setAccount(null);
        setAccountIssue(null);
        readySessionRef.current = { readyAt: 0, accessToken: '' };
        setAccountCacheScope(null);
      }
      if (currentAccountId.current !== nextSession.user.id) setLoading(true);
      sessionRef.current = nextSession;
      setSession(nextSession);
      // Start outside the Supabase auth callback/lock, including refresh events.
      setTimeout(() => {
        if (!active || sessionRef.current?.user.id !== nextSession.user.id) return;
        void ensureSession({ forceVerify: event === 'SIGNED_IN' })
          .catch(() => {
            // Keep the last confirmed workspace mounted during temporary failures.
          })
          .finally(() => {
            if (active && sessionRef.current?.user.id === nextSession.user.id) setLoading(false);
          });
      }, 0);
    });

    return () => {
      active = false;
      accountRequestVersion.current += 1;
      sessionRecoveryRef.current?.controller.abort();
      sessionRecoveryRef.current = null;
      listener.subscription.unsubscribe();
    };
  }, [ensureSession, supabase]);

  useEffect(() => {
    if (!session) return;
    const verifyAccount = () => {
      void ensureSession().catch(() => {
        // Network interruptions keep the current workspace visible and retryable.
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') verifyAccount();
    };
    window.addEventListener('focus', verifyAccount);
    window.addEventListener('online', verifyAccount);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('focus', verifyAccount);
      window.removeEventListener('online', verifyAccount);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [ensureSession, session]);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    session,
    account,
    accountIssue,
    loading,
    configured,
    ensureSession,
    refreshAccount: async () => {
      try {
        const recoveredSession = await ensureSession({ forceVerify: true });
        return recoveredSession ? accountRef.current : null;
      } catch {
        return null;
      }
    },
    signOut: async () => {
      accountRequestVersion.current += 1;
      sessionRecoveryRef.current?.controller.abort();
      sessionRecoveryRef.current = null;
      readySessionRef.current = { readyAt: 0, accessToken: '' };
      if (supabase) await supabase.auth.signOut();
      await syncServerSession(null);
      sessionRef.current = null;
      setSession(null);
      setAccount(null);
      accountRef.current = null;
      setAccountIssue(null);
      currentAccountId.current = null;
      accountRequestVersion.current += 1;
      readySessionRef.current = { readyAt: 0, accessToken: '' };
      setAccountCacheScope(null);
    },
  }), [account, accountIssue, configured, ensureSession, loading, session, supabase]);

  return (
    <AuthContext.Provider value={value}>
      <Fragment key={account?.userId || 'signed-out'}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth 必须在 AuthProvider 中使用。');
  return value;
}
