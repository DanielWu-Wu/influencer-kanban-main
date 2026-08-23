import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decryptServerSecret,
  encryptServerSecret,
  type ServerSecretEnvelope,
} from './server-secret-envelope';
import { buildMailAccountId, normalizeMailAddress } from './mail-accounts';
import { deleteUserSecret, getUserSecret, setUserSecret } from './user-private-storage';

type StoredTencentExmailCredentials = {
  version: 1;
  email: string;
  password: ServerSecretEnvelope;
  updatedAt: number;
};

const SECRET_PREFIX = 'mail_account_credentials:';

export function getTencentExmailSecretKey(mailAccountId: string) {
  return `${SECRET_PREFIX}${mailAccountId}`;
}

export function normalizeTencentExmailCredentials(email: unknown, password: unknown) {
  const normalizedEmail = normalizeMailAddress(email);
  const normalizedPassword = String(password || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    throw new Error('腾讯企业邮箱地址格式不正确。');
  }
  if (normalizedPassword.length < 4 || normalizedPassword.length > 500) {
    throw new Error('客户端密码或授权码格式不正确。');
  }
  return { email: normalizedEmail, password: normalizedPassword };
}

export async function saveTencentExmailCredentials(
  supabase: SupabaseClient,
  input: { email: unknown; password: unknown },
) {
  const normalized = normalizeTencentExmailCredentials(input.email, input.password);
  const mailAccountId = buildMailAccountId('tencent_exmail', normalized.email);
  await setUserSecret(supabase, getTencentExmailSecretKey(mailAccountId), {
    version: 1,
    email: normalized.email,
    password: encryptServerSecret(normalized.password),
    updatedAt: Date.now(),
  } satisfies StoredTencentExmailCredentials);
  return { mailAccountId, ...normalized };
}

export async function resolveTencentExmailCredentials(
  supabase: SupabaseClient,
  mailAccountId: string,
) {
  if (!mailAccountId.startsWith('tencent_exmail:')) {
    throw new Error('邮箱账号类型不正确。');
  }
  const stored = await getUserSecret<StoredTencentExmailCredentials>(
    supabase,
    getTencentExmailSecretKey(mailAccountId),
  );
  if (!stored || stored.version !== 1 || !stored.email || !stored.password) {
    throw new Error('腾讯企业邮箱凭证不存在，请重新连接。');
  }
  return {
    email: stored.email,
    password: decryptServerSecret(stored.password),
  };
}

export async function deleteTencentExmailCredentials(
  supabase: SupabaseClient,
  mailAccountId: string,
) {
  await deleteUserSecret(supabase, getTencentExmailSecretKey(mailAccountId));
}
