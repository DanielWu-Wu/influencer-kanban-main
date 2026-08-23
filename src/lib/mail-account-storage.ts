import type { SupabaseClient } from '@supabase/supabase-js';
import { USER_DATA_KEYS } from './account-data-keys';
import {
  createLegacyGmailAccount,
  parseMailAccounts,
  sortMailAccounts,
  type MailAccount,
} from './mail-accounts';

export async function getStoredMailAccounts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from('user_data')
    .select('data')
    .eq('data_key', USER_DATA_KEYS.MAIL_ACCOUNTS)
    .maybeSingle();
  if (error) throw error;
  return parseMailAccounts(data?.data);
}

export async function saveStoredMailAccounts(
  supabase: SupabaseClient,
  userId: string,
  accounts: MailAccount[],
) {
  const { error } = await supabase.from('user_data').upsert({
    user_id: userId,
    data_key: USER_DATA_KEYS.MAIL_ACCOUNTS,
    data: sortMailAccounts(accounts),
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function upsertStoredMailAccount(
  supabase: SupabaseClient,
  userId: string,
  account: MailAccount,
) {
  const current = await getStoredMailAccounts(supabase);
  const hasDefault = current.some((item) => item.isDefault && item.mailAccountId !== account.mailAccountId);
  const normalizedAccount = {
    ...account,
    isDefault: account.isDefault || !hasDefault,
  };
  const next = current.filter((item) => item.mailAccountId !== account.mailAccountId);
  next.push(normalizedAccount);
  await saveStoredMailAccounts(supabase, userId, next);
  return sortMailAccounts(next);
}

export async function removeStoredMailAccount(
  supabase: SupabaseClient,
  userId: string,
  mailAccountId: string,
) {
  const current = await getStoredMailAccounts(supabase);
  const removedWasDefault = current.some((item) => item.mailAccountId === mailAccountId && item.isDefault);
  const next = current.filter((item) => item.mailAccountId !== mailAccountId);
  if (removedWasDefault && next.length && !next.some((item) => item.isDefault)) {
    next[0] = { ...next[0], isDefault: true, updatedAt: new Date().toISOString() };
  }
  await saveStoredMailAccounts(supabase, userId, next);
  return sortMailAccounts(next);
}

export async function ensureLegacyGmailMailAccount(
  supabase: SupabaseClient,
  userId: string,
  gmailEmail?: string,
) {
  const current = await getStoredMailAccounts(supabase);
  const normalizedEmail = String(gmailEmail || '').trim().toLowerCase();
  if (!normalizedEmail) return current;
  const legacy = createLegacyGmailAccount(normalizedEmail);
  const existing = current.find((item) => item.mailAccountId === legacy.mailAccountId);
  if (existing) {
    if (existing.connectionStatus === 'connected') return current;
    const next = current.map((item) => item.mailAccountId === legacy.mailAccountId
      ? { ...item, connectionStatus: 'connected' as const, updatedAt: new Date().toISOString() }
      : item);
    await saveStoredMailAccounts(supabase, userId, next);
    return sortMailAccounts(next);
  }
  const next = [...current, { ...legacy, isDefault: !current.some((item) => item.isDefault) }];
  await saveStoredMailAccounts(supabase, userId, next);
  return sortMailAccounts(next);
}
