'use client';

import { sharedMailFetch as fetch } from '@/lib/shared-mail-read';

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
import { useAuth } from './auth-provider';
import { useGmailAuth } from './gmail-auth-provider';
import { scopedLocalStorageKey } from '@/lib/account-cache-scope';
import { parseMailAccounts, type MailAccount } from '@/lib/mail-accounts';

const SELECTED_MAIL_ACCOUNT_KEY = 'selected-mail-account-v1';
export const MAIL_ACCOUNT_CHANGED_EVENT = 'mail-account-changed';

type MailAccountContextValue = {
  accounts: MailAccount[];
  activeAccount: MailAccount | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  selectAccount: (mailAccountId: string) => void;
  refreshAccounts: () => Promise<MailAccount[]>;
  setDefaultAccount: (mailAccountId: string) => Promise<void>;
  disconnectTencentAccount: (mailAccountId: string) => Promise<void>;
};

const MailAccountContext = createContext<MailAccountContextValue | null>(null);

function chooseActiveAccount(accounts: MailAccount[], preferredId?: string | null) {
  const connected = accounts.filter((account) => account.connectionStatus === 'connected');
  return connected.find((account) => account.mailAccountId === preferredId)
    || connected.find((account) => account.isDefault)
    || connected[0]
    || accounts.find((account) => account.mailAccountId === preferredId)
    || accounts[0]
    || null;
}

export function MailAccountProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth();
  const { auth: gmailAuth, status: gmailStatus } = useGmailAuth();
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const accountOwnerRef = useRef<string | null>(null);

  const applyAccounts = useCallback((nextAccounts: MailAccount[]) => {
    setAccounts(nextAccounts);
    setActiveAccountId((currentId) => {
      const storedId = typeof window === 'undefined'
        ? ''
        : window.localStorage.getItem(scopedLocalStorageKey(SELECTED_MAIL_ACCOUNT_KEY)) || '';
      const next = chooseActiveAccount(nextAccounts, currentId || storedId);
      if (next && typeof window !== 'undefined') {
        window.localStorage.setItem(scopedLocalStorageKey(SELECTED_MAIL_ACCOUNT_KEY), next.mailAccountId);
      }
      return next?.mailAccountId || '';
    });
  }, []);

  const refreshAccounts = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setRefreshing(true);
    setError('');
    try {
      const response = await fetch('/api/mail/accounts', { cache: 'no-store' });
      const result = await response.json().catch(() => ({})) as {
        success?: boolean;
        data?: unknown;
        error?: string;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '读取邮箱账号失败。');
      }
      const nextAccounts = parseMailAccounts(result.data);
      if (requestId === requestIdRef.current) applyAccounts(nextAccounts);
      return nextAccounts;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : '读取邮箱账号失败。';
      if (requestId === requestIdRef.current) setError(message);
      throw caughtError;
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [applyAccounts]);

  useEffect(() => {
    if (!account?.userId || account.status !== 'active' || account.mustChangePassword) {
      requestIdRef.current += 1;
      accountOwnerRef.current = null;
      setAccounts([]);
      setActiveAccountId('');
      setLoading(false);
      setRefreshing(false);
      setError('');
      return;
    }
    if (accountOwnerRef.current !== account.userId) {
      requestIdRef.current += 1;
      accountOwnerRef.current = account.userId;
      setAccounts([]);
      setActiveAccountId('');
      setError('');
    }
    if (gmailStatus === 'checking') return;
    setLoading(true);
    void refreshAccounts().catch(() => undefined);
  }, [account?.mustChangePassword, account?.status, account?.userId, gmailAuth?.email, gmailStatus, refreshAccounts]);

  const selectAccount = useCallback((mailAccountId: string) => {
    const next = accounts.find((account) => account.mailAccountId === mailAccountId);
    if (!next || next.connectionStatus !== 'connected') return;
    setActiveAccountId(mailAccountId);
    window.localStorage.setItem(scopedLocalStorageKey(SELECTED_MAIL_ACCOUNT_KEY), mailAccountId);
    window.dispatchEvent(new CustomEvent(MAIL_ACCOUNT_CHANGED_EVENT, {
      detail: { mailAccountId, provider: next.provider },
    }));
  }, [accounts]);

  const setDefaultAccount = useCallback(async (mailAccountId: string) => {
    const response = await fetch('/api/mail/accounts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailAccountId }),
    });
    const result = await response.json().catch(() => ({})) as { data?: unknown; error?: string };
    if (!response.ok) throw new Error(result.error || '设置默认邮箱失败。');
    applyAccounts(parseMailAccounts(result.data));
  }, [applyAccounts]);

  const disconnectTencentAccount = useCallback(async (mailAccountId: string) => {
    const response = await fetch(`/api/mail/accounts/tencent?mailAccountId=${encodeURIComponent(mailAccountId)}`, {
      method: 'DELETE',
    });
    const result = await response.json().catch(() => ({})) as {
      data?: { accounts?: unknown };
      error?: string;
    };
    if (!response.ok) throw new Error(result.error || '断开腾讯企业邮箱失败。');
    applyAccounts(parseMailAccounts(result.data?.accounts));
  }, [applyAccounts]);

  const activeAccount = useMemo(
    () => chooseActiveAccount(accounts, activeAccountId),
    [accounts, activeAccountId],
  );
  const value = useMemo<MailAccountContextValue>(() => ({
    accounts,
    activeAccount,
    loading,
    refreshing,
    error,
    selectAccount,
    refreshAccounts,
    setDefaultAccount,
    disconnectTencentAccount,
  }), [
    accounts,
    activeAccount,
    disconnectTencentAccount,
    error,
    loading,
    refreshAccounts,
    refreshing,
    selectAccount,
    setDefaultAccount,
  ]);

  return <MailAccountContext.Provider value={value}>{children}</MailAccountContext.Provider>;
}

export function useMailAccounts() {
  const value = useContext(MailAccountContext);
  if (!value) throw new Error('useMailAccounts 必须在 MailAccountProvider 中使用。');
  return value;
}
