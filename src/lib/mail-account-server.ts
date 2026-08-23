import type { SupabaseClient } from '@supabase/supabase-js';
import { getStoredMailAccounts } from './mail-account-storage';
import type { MailProvider } from './mail-accounts';

export async function requireOwnedMailAccount(
  supabase: SupabaseClient,
  mailAccountId: string,
  provider?: MailProvider,
) {
  const accounts = await getStoredMailAccounts(supabase);
  const account = accounts.find((item) => item.mailAccountId === mailAccountId);
  if (!account || (provider && account.provider !== provider)) {
    throw new Error('邮箱账号不存在或不属于当前系统账号。');
  }
  if (account.connectionStatus !== 'connected') {
    throw new Error('邮箱账号当前未连接，请先重新验证。');
  }
  return account;
}
