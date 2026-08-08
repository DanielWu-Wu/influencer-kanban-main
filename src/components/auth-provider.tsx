'use client';

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, getSupabaseConfig } from '@/lib/supabase/client';
import type {
  AccountErrorCode,
  AccountIssue,
  AccountMeResponse,
  AccountProfile,
} from '@/lib/account-types';
import { setAccountCacheScope } from '@/lib/account-cache-scope';
import { classifyAccountFailure, shouldPreserveLastAccount } from '@/lib/account-load-state';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  account: AccountProfile | null;
  accountIssue: AccountIssue | null;
  loading: boolean;
  configured: boolean;
  signOut: () => Promise<void>;
  refreshAccount: () => Promise<AccountProfile | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

type AccountLoadResult =
  | { status: 'success'; account: AccountProfile }
  | { status: 'invalid' | 'unavailable'; issue: AccountIssue };

const ACCOUNT_ERROR_CODES = new Set<AccountErrorCode>([
  'ACCOUNT_DISABLED',
  'ACCOUNT_NOT_PROVISIONED',
  'ACCOUNT_SERVICE_UNAVAILABLE',
  'SESSION_INVALID',
]);

async function syncServerSession(session: Session | null) {
  return await fetch('/api/cloud/session', {
    method: session ? 'POST' : 'DELETE',
    headers: session ? { 'Content-Type': 'application/json' } : undefined,
    body: session ? JSON.stringify({ accessToken: session.access_token }) : undefined,
  }).catch(() => undefined);
}

function createUnavailableIssue(message = '账号服务暂时无法连接，请检查网络后重试。'): AccountIssue {
  return {
    kind: 'unavailable',
    code: 'ACCOUNT_SERVICE_UNAVAILABLE',
    message,
  };
}

async function readAccountIssue(response: Response): Promise<AccountIssue> {
  const result = await response.json().catch(() => null) as Partial<AccountMeResponse> | null;
  const kind = classifyAccountFailure(response.status);
  const candidateCode = result && 'code' in result ? result.code : undefined;
  const code = typeof candidateCode === 'string' && ACCOUNT_ERROR_CODES.has(candidateCode as AccountErrorCode)
    ? candidateCode as AccountErrorCode
    : kind === 'unavailable'
      ? 'ACCOUNT_SERVICE_UNAVAILABLE'
      : 'SESSION_INVALID';
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

async function loadAccount(session: Session): Promise<AccountLoadResult> {
  try {
    const sessionResponse = await syncServerSession(session);
    if (!sessionResponse) return { status: 'unavailable', issue: createUnavailableIssue() };
    if (!sessionResponse.ok) {
      const issue = await readAccountIssue(sessionResponse);
      return { status: issue.kind, issue };
    }

    const response = await fetch('/api/account/me', {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) {
      const issue = await readAccountIssue(response);
      return { status: issue.kind, issue };
    }
    const result = await response.json().catch(() => null) as AccountMeResponse | null;
    if (result?.success) return { status: 'success', account: result.data };
    return { status: 'unavailable', issue: createUnavailableIssue('账号资料返回异常，请稍后重试。') };
  } catch {
    return { status: 'unavailable', issue: createUnavailableIssue() };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = getSupabaseConfig().configured;
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [accountIssue, setAccountIssue] = useState<AccountIssue | null>(null);
  const [loading, setLoading] = useState(configured);
  const currentAccountId = useRef<string | null>(null);
  const backgroundCheckInFlight = useRef(false);

  useEffect(() => {
    currentAccountId.current = account?.userId || null;
  }, [account?.userId]);

  const applyAccountResult = useCallback((result: AccountLoadResult, expectedUserId: string) => {
    if (result.status === 'success') {
      if (result.account.userId !== expectedUserId) {
        setAccount(null);
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
      setAccountIssue(null);
      currentAccountId.current = result.account.userId;
      setAccountCacheScope(result.account.userId);
      return result.account;
    }

    setAccountIssue(result.issue);
    if (!shouldPreserveLastAccount(result.status, currentAccountId.current, expectedUserId)) {
      setAccount(null);
      currentAccountId.current = null;
      setAccountCacheScope(null);
    }
    return null;
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      if (!data.session) {
        setAccount(null);
        setAccountIssue(null);
        currentAccountId.current = null;
        setAccountCacheScope(null);
        setLoading(false);
        return;
      }
      const result = await loadAccount(data.session);
      if (!active) return;
      applyAccountResult(result, data.session.user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!nextSession) {
        setSession(null);
        setAccount(null);
        setAccountIssue(null);
        currentAccountId.current = null;
        setAccountCacheScope(null);
        setLoading(false);
        void syncServerSession(null);
        return;
      }
      // A signed-in user is not an invalid account while its profile request is
      // still in flight. Keep the login page in its loading state until the
      // account check has actually completed. Background refreshes for the
      // same user stay non-blocking so the current workspace remains mounted.
      if (currentAccountId.current !== nextSession.user.id) setLoading(true);
      setSession(nextSession);
      void loadAccount(nextSession).then((result) => {
        if (!active) return;
        applyAccountResult(result, nextSession.user.id);
        setLoading(false);
      });
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [applyAccountResult, supabase]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const verifyAccount = () => {
      if (backgroundCheckInFlight.current) return;
      backgroundCheckInFlight.current = true;
      void loadAccount(session)
        .then((result) => {
          if (!active) return;
          applyAccountResult(result, session.user.id);
        })
        .finally(() => {
          backgroundCheckInFlight.current = false;
        });
    };
    const interval = window.setInterval(verifyAccount, 60_000);
    window.addEventListener('focus', verifyAccount);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', verifyAccount);
    };
  }, [applyAccountResult, session]);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    session,
    account,
    accountIssue,
    loading,
    configured,
    refreshAccount: async () => {
      if (!session) return null;
      const result = await loadAccount(session);
      return applyAccountResult(result, session.user.id);
    },
    signOut: async () => {
      if (supabase) await supabase.auth.signOut();
      await syncServerSession(null);
      setSession(null);
      setAccount(null);
      setAccountIssue(null);
      currentAccountId.current = null;
      setAccountCacheScope(null);
    },
  }), [account, accountIssue, applyAccountResult, configured, loading, session, supabase]);

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
