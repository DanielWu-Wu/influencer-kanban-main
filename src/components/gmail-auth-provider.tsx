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
import type { GmailAuth } from '@/lib/types';
import { useAuth } from './auth-provider';

export type GmailAuthStatus = 'checking' | 'connected' | 'disconnected' | 'error';
export const GMAIL_AUTH_CACHE_RESET_EVENT = 'gmail-auth-cache-reset';

interface GmailAuthContextValue {
  auth: GmailAuth | null;
  status: GmailAuthStatus;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  connect: (auth: GmailAuth) => void;
  disconnect: () => void;
  refreshSession: () => Promise<GmailAuth | null>;
  getAccessToken: (options?: { force?: boolean }) => Promise<string>;
}

const GmailAuthContext = createContext<GmailAuthContextValue | null>(null);

function readGmailAuthError(result: unknown, fallback: string) {
  if (
    result
    && typeof result === 'object'
    && 'error' in result
    && typeof result.error === 'string'
    && result.error.trim()
  ) {
    return result.error;
  }
  return fallback;
}

export function GmailAuthProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth();
  const accountUserId = account?.userId;
  const accountCanUseWorkspace = account?.status === 'active' && !account.mustChangePassword;
  const authRef = useRef<GmailAuth | null>(null);
  const sessionRequestRef = useRef<Promise<GmailAuth | null> | null>(null);
  const tokenRequestRef = useRef<Promise<string> | null>(null);
  const [auth, setAuth] = useState<GmailAuth | null>(null);
  const [status, setStatus] = useState<GmailAuthStatus>('checking');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback((nextAuth: GmailAuth) => {
    const previousEmail = authRef.current?.email?.trim().toLowerCase();
    const nextEmail = nextAuth.email?.trim().toLowerCase();
    if (previousEmail && nextEmail && previousEmail !== nextEmail) {
      window.dispatchEvent(new Event(GMAIL_AUTH_CACHE_RESET_EVENT));
    }
    authRef.current = nextAuth;
    setAuth(nextAuth);
    setStatus(nextAuth.isConnected ? 'connected' : 'disconnected');
    setError(null);
  }, []);

  const refreshSession = useCallback(() => {
    if (sessionRequestRef.current) return sessionRequestRef.current;

    const hadConnectedAuth = Boolean(authRef.current?.isConnected);
    if (hadConnectedAuth) setRefreshing(true);
    else setStatus('checking');
    setError(null);

    const request = fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as {
          success?: boolean;
          data?: GmailAuth;
          error?: string;
        } | null;

        if (response.status === 404) {
          authRef.current = null;
          setAuth(null);
          setStatus('disconnected');
          return null;
        }
        if (!response.ok || !result?.success || !result.data?.isConnected) {
          throw new Error(readGmailAuthError(result, '暂时无法检查 Gmail 登录状态。'));
        }

        connect(result.data);
        return result.data;
      })
      .catch((caughtError: unknown) => {
        const message = caughtError instanceof Error
          ? caughtError.message
          : '暂时无法检查 Gmail 登录状态。';
        setError(message);
        setStatus(authRef.current?.isConnected ? 'connected' : 'error');
        throw caughtError;
      })
      .finally(() => {
        setRefreshing(false);
        if (sessionRequestRef.current === request) sessionRequestRef.current = null;
      });

    sessionRequestRef.current = request;
    return request;
  }, [connect]);

  useEffect(() => {
    sessionRequestRef.current = null;
    tokenRequestRef.current = null;

    if (!accountUserId || !accountCanUseWorkspace) {
      authRef.current = null;
      setAuth(null);
      setStatus('checking');
      setRefreshing(false);
      setError(null);
      return;
    }

    void refreshSession().catch(() => {
      // The provider keeps the last confirmed state and exposes a retryable error.
    });
  }, [accountCanUseWorkspace, accountUserId, refreshSession]);

  const disconnect = useCallback(() => {
    const previousAuth = authRef.current;
    authRef.current = null;
    tokenRequestRef.current = null;
    setAuth(null);
    setStatus('disconnected');
    setError(null);
    window.dispatchEvent(new Event(GMAIL_AUTH_CACHE_RESET_EVENT));

    void fetch('/api/auth/session', { method: 'DELETE' })
      .then(async (response) => {
        if (response.ok) return;
        const result = await response.json().catch(() => null);
        throw new Error(readGmailAuthError(result, '断开 Gmail 失败，请稍后重试。'));
      })
      .catch((caughtError: unknown) => {
        if (previousAuth?.isConnected) {
          authRef.current = previousAuth;
          setAuth(previousAuth);
          setStatus('connected');
        }
        setError(caughtError instanceof Error ? caughtError.message : '断开 Gmail 失败，请稍后重试。');
      });
  }, []);

  const getAccessToken = useCallback((options: { force?: boolean } = {}) => {
    const currentAuth = authRef.current;
    if (!currentAuth?.isConnected) {
      return Promise.reject(new Error('请重新连接 Gmail。'));
    }
    if (
      !options.force
      && currentAuth.accessToken
      && currentAuth.expiresAt
      && currentAuth.expiresAt > Date.now() + 60_000
    ) {
      return Promise.resolve(currentAuth.accessToken);
    }
    if (tokenRequestRef.current) return tokenRequestRef.current;

    setRefreshing(true);
    const request = fetch(options.force ? '/api/auth/refresh?force=1' : '/api/auth/refresh', {
      method: 'POST',
    })
      .then(async (response) => {
        const result = await response.json().catch(() => null) as {
          success?: boolean;
          data?: Partial<GmailAuth>;
          error?: string;
        } | null;
        const accessToken = result?.data?.accessToken;
        if (!response.ok || !accessToken) {
          throw new Error(readGmailAuthError(result, 'Gmail 授权刷新失败，请稍后重试。'));
        }

        const latestAuth = authRef.current || currentAuth;
        connect({
          ...latestAuth,
          ...result?.data,
          isConnected: true,
          accessToken,
          email: result?.data?.email || latestAuth.email,
        });
        return accessToken;
      })
      .catch((caughtError: unknown) => {
        setError(caughtError instanceof Error ? caughtError.message : 'Gmail 授权刷新失败，请稍后重试。');
        throw caughtError;
      })
      .finally(() => {
        setRefreshing(false);
        if (tokenRequestRef.current === request) tokenRequestRef.current = null;
      });

    tokenRequestRef.current = request;
    return request;
  }, [connect]);

  const value = useMemo<GmailAuthContextValue>(() => ({
    auth,
    status,
    loading: status === 'checking',
    refreshing,
    error,
    connect,
    disconnect,
    refreshSession,
    getAccessToken,
  }), [auth, connect, disconnect, error, getAccessToken, refreshSession, refreshing, status]);

  return <GmailAuthContext.Provider value={value}>{children}</GmailAuthContext.Provider>;
}

export function useGmailAuth() {
  const value = useContext(GmailAuthContext);
  if (!value) throw new Error('useGmailAuth 必须在 GmailAuthProvider 中使用。');
  return value;
}
