'use client';

import { createContext, Fragment, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseBrowserClient, getSupabaseConfig } from '@/lib/supabase/client';
import type { AccountMeResponse, AccountProfile } from '@/lib/account-types';
import { setAccountCacheScope } from '@/lib/account-cache-scope';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  account: AccountProfile | null;
  loading: boolean;
  configured: boolean;
  signOut: () => Promise<void>;
  refreshAccount: () => Promise<AccountProfile | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function syncServerSession(session: Session | null) {
  return await fetch('/api/cloud/session', {
    method: session ? 'POST' : 'DELETE',
    headers: session ? { 'Content-Type': 'application/json' } : undefined,
    body: session ? JSON.stringify({ accessToken: session.access_token }) : undefined,
  }).catch(() => undefined);
}

async function loadAccount(session: Session | null) {
  if (!session) return null;
  try {
    await syncServerSession(session);
    const response = await fetch('/api/account/me', {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json().catch(() => null) as AccountMeResponse | null;
    return result && 'success' in result && result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = getSupabaseConfig().configured;
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(configured);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      const nextAccount = await loadAccount(data.session);
      if (!active) return;
      setAccount(nextAccount);
      setAccountCacheScope(nextAccount?.userId);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setAccount(null);
        setAccountCacheScope(null);
        setLoading(false);
        void syncServerSession(null);
        return;
      }
      void loadAccount(nextSession).then((nextAccount) => {
        if (!active) return;
        setAccount(nextAccount);
        setAccountCacheScope(nextAccount?.userId);
        setLoading(false);
      });
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const verifyAccount = () => {
      void loadAccount(session).then((nextAccount) => {
        if (!active) return;
        setAccount(nextAccount);
        setAccountCacheScope(nextAccount?.userId);
      });
    };
    const interval = window.setInterval(verifyAccount, 60_000);
    window.addEventListener('focus', verifyAccount);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', verifyAccount);
    };
  }, [session]);

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null,
    session,
    account,
    loading,
    configured,
    refreshAccount: async () => {
      const nextAccount = await loadAccount(session);
      setAccount(nextAccount);
      setAccountCacheScope(nextAccount?.userId);
      return nextAccount;
    },
    signOut: async () => {
      if (supabase) await supabase.auth.signOut();
      await syncServerSession(null);
      setSession(null);
      setAccount(null);
      setAccountCacheScope(null);
    },
  }), [account, configured, loading, session, supabase]);

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
