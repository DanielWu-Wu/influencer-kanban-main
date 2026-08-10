import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  decryptServerSecret,
  encryptServerSecret,
  type ServerSecretEnvelope,
} from './server-secret-envelope';
import { deleteUserSecret, getUserSecret, setUserSecret } from './user-private-storage';

export const FEISHU_APP_CREDENTIALS_KEY = 'feishu_app_credentials';

type StoredFeishuAppCredentials = {
  version: 1;
  appId: string;
  appSecret: ServerSecretEnvelope;
  updatedAt: number;
};

export type FeishuCredentialSource = 'personal' | 'global';

export type ResolvedFeishuAppCredentials = {
  appId: string;
  appSecret: string;
  source: FeishuCredentialSource;
  fingerprint: string;
};

export type FeishuAppCredentialStatus = {
  configured: boolean;
  source?: FeishuCredentialSource;
  appId?: string;
};

export function normalizeFeishuAppCredentials(appId: unknown, appSecret: unknown) {
  const normalizedAppId = String(appId || '').trim();
  const normalizedAppSecret = String(appSecret || '').trim();
  if (normalizedAppId.length < 6 || normalizedAppId.length > 200) {
    throw new Error('飞书 App ID格式不正确，请从飞书开发者后台重新复制。');
  }
  if (normalizedAppSecret.length < 8 || normalizedAppSecret.length > 500) {
    throw new Error('飞书 App Secret格式不正确，请从飞书开发者后台重新复制。');
  }
  return { appId: normalizedAppId, appSecret: normalizedAppSecret };
}

export function buildFeishuCredentialFingerprint(appId: string, appSecret: string) {
  return createHash('sha256')
    .update(appId)
    .update('\0')
    .update(appSecret)
    .digest('base64url')
    .slice(0, 24);
}

function resolveGlobalCredentials(): ResolvedFeishuAppCredentials | null {
  const appId = process.env.FEISHU_APP_ID?.trim();
  const appSecret = process.env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) return null;
  return {
    appId,
    appSecret,
    source: 'global',
    fingerprint: buildFeishuCredentialFingerprint(appId, appSecret),
  };
}

async function getStoredPersonalCredentials(supabase: SupabaseClient) {
  return getUserSecret<StoredFeishuAppCredentials>(supabase, FEISHU_APP_CREDENTIALS_KEY);
}

export async function savePersonalFeishuAppCredentials(
  supabase: SupabaseClient,
  input: { appId: unknown; appSecret: unknown },
) {
  const normalized = normalizeFeishuAppCredentials(input.appId, input.appSecret);
  await setUserSecret(supabase, FEISHU_APP_CREDENTIALS_KEY, {
    version: 1,
    appId: normalized.appId,
    appSecret: encryptServerSecret(normalized.appSecret),
    updatedAt: Date.now(),
  } satisfies StoredFeishuAppCredentials);
  return normalized;
}

export async function deletePersonalFeishuAppCredentials(supabase: SupabaseClient) {
  await deleteUserSecret(supabase, FEISHU_APP_CREDENTIALS_KEY);
}

export async function resolveFeishuAppCredentials(
  supabase: SupabaseClient,
): Promise<ResolvedFeishuAppCredentials> {
  const stored = await getStoredPersonalCredentials(supabase);
  if (stored) {
    if (stored.version !== 1 || !stored.appId || !stored.appSecret) {
      throw new Error('当前账号的飞书应用凭证格式无效，请重新保存。');
    }
    const appSecret = decryptServerSecret(stored.appSecret);
    return {
      appId: stored.appId,
      appSecret,
      source: 'personal',
      fingerprint: buildFeishuCredentialFingerprint(stored.appId, appSecret),
    };
  }

  const globalCredentials = resolveGlobalCredentials();
  if (globalCredentials) return globalCredentials;
  throw new Error('尚未配置飞书企业自建应用，请先保存当前企业的 App ID 和 App Secret。');
}

export async function getFeishuAppCredentialStatus(
  supabase: SupabaseClient,
): Promise<FeishuAppCredentialStatus> {
  const stored = await getStoredPersonalCredentials(supabase);
  if (stored) {
    return { configured: true, source: 'personal', appId: stored.appId };
  }
  const globalCredentials = resolveGlobalCredentials();
  if (globalCredentials) {
    return { configured: true, source: 'global', appId: globalCredentials.appId };
  }
  return { configured: false };
}
