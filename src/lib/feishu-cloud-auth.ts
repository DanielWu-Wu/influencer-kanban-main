import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveFeishuAppCredentials,
  type FeishuCredentialSource,
  type ResolvedFeishuAppCredentials,
} from './feishu-app-credentials';
import { deleteUserSecret, getUserSecret, setUserSecret } from './user-private-storage';

const FEISHU_TOKEN_ENDPOINT = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';

export interface StoredFeishuAuth {
  isConnected: true;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  refreshExpiresAt?: number;
  name?: string;
  openId?: string;
  tenantKey?: string;
  appId?: string;
  credentialSource?: FeishuCredentialSource;
  credentialFingerprint?: string;
}

export interface StoredFeishuOAuthPending {
  state: string;
  appId: string;
  credentialFingerprint: string;
  redirectUri: string;
  createdAt: number;
}

type FeishuTokenResponse = {
  code?: number;
  msg?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  refresh_expires_in?: number;
  scope?: string;
  token_type?: string;
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    refresh_expires_in?: number;
    scope?: string;
    token_type?: string;
  };
};

function normalizeTokenResponse(payload: FeishuTokenResponse) {
  const source = payload.data || payload;
  if (!source.access_token || !source.expires_in) {
    throw new Error(
      payload.msg
        || `飞书令牌响应不完整（返回字段：${Object.keys(source).join(', ') || '无'}）。`,
    );
  }
  return source;
}

export async function exchangeFeishuCode(
  code: string,
  redirectUri: string,
  credentials: ResolvedFeishuAppCredentials,
) {
  const response = await fetch(FEISHU_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: credentials.appId,
      client_secret: credentials.appSecret,
      code,
      redirect_uri: redirectUri,
    }),
    cache: 'no-store',
  });
  const payload = await response.json() as FeishuTokenResponse;
  if (!response.ok || (payload.code && payload.code !== 0)) {
    throw new Error(payload.msg || `飞书授权交换失败 (${response.status})`);
  }
  return normalizeTokenResponse(payload);
}

export async function getFeishuUser(accessToken: string) {
  const response = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) return {};
  const payload = await response.json();
  const data = payload.data || payload;
  return {
    name: typeof data.name === 'string' ? data.name : undefined,
    openId: typeof data.open_id === 'string' ? data.open_id : undefined,
    tenantKey: typeof data.tenant_key === 'string' ? data.tenant_key : undefined,
  };
}

export async function getStoredFeishuAuth(supabase: SupabaseClient) {
  return getUserSecret<StoredFeishuAuth>(supabase, 'feishu_auth');
}

export async function saveStoredFeishuAuth(
  supabase: SupabaseClient,
  auth: StoredFeishuAuth,
) {
  await setUserSecret(supabase, 'feishu_auth', auth);
}

export async function getStoredFeishuOAuthPending(supabase: SupabaseClient) {
  return getUserSecret<StoredFeishuOAuthPending>(supabase, 'feishu_oauth_pending');
}

export async function saveStoredFeishuOAuthPending(
  supabase: SupabaseClient,
  pending: StoredFeishuOAuthPending,
) {
  await setUserSecret(supabase, 'feishu_oauth_pending', pending);
}

export async function deleteStoredFeishuOAuthPending(supabase: SupabaseClient) {
  await deleteUserSecret(supabase, 'feishu_oauth_pending');
}

function assertMatchingCredentials(
  auth: StoredFeishuAuth,
  credentials: ResolvedFeishuAppCredentials,
) {
  if (auth.credentialFingerprint) {
    if (auth.credentialFingerprint !== credentials.fingerprint) {
      throw new Error('飞书应用凭证已经更换，请重新连接飞书。');
    }
    return;
  }

  // 兼容旧版全局授权；切换到个人企业应用后必须重新授权，避免令牌被错误应用刷新。
  if (credentials.source === 'personal') {
    throw new Error('当前账号已改用自己的飞书企业应用，请重新连接飞书。');
  }
}

export async function refreshStoredFeishuAuth(supabase: SupabaseClient) {
  const auth = await getStoredFeishuAuth(supabase);
  if (!auth) throw new Error('尚未连接飞书。');
  const credentials = await resolveFeishuAppCredentials(supabase);
  assertMatchingCredentials(auth, credentials);
  if (auth.expiresAt > Date.now() + 60_000) {
    if (!auth.credentialFingerprint) {
      const upgraded = {
        ...auth,
        appId: credentials.appId,
        credentialSource: credentials.source,
        credentialFingerprint: credentials.fingerprint,
      } satisfies StoredFeishuAuth;
      await saveStoredFeishuAuth(supabase, upgraded);
      return upgraded;
    }
    return auth;
  }
  if (!auth.refreshToken) {
    throw new Error('飞书授权已过期且没有刷新令牌，请重新连接飞书。');
  }

  const response = await fetch(FEISHU_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: credentials.appId,
      client_secret: credentials.appSecret,
      refresh_token: auth.refreshToken,
    }),
    cache: 'no-store',
  });
  const payload = await response.json() as FeishuTokenResponse;
  if (!response.ok || (payload.code && payload.code !== 0)) {
    throw new Error(payload.msg || `飞书授权刷新失败 (${response.status})`);
  }
  const token = normalizeTokenResponse(payload);
  const updated: StoredFeishuAuth = {
    ...auth,
    accessToken: token.access_token!,
    refreshToken: token.refresh_token || auth.refreshToken,
    expiresAt: Date.now() + token.expires_in! * 1000,
    refreshExpiresAt: token.refresh_token_expires_in || token.refresh_expires_in
      ? Date.now() + (token.refresh_token_expires_in || token.refresh_expires_in)! * 1000
      : auth.refreshExpiresAt,
    appId: credentials.appId,
    credentialSource: credentials.source,
    credentialFingerprint: credentials.fingerprint,
  };
  await saveStoredFeishuAuth(supabase, updated);
  return updated;
}

export function toBrowserFeishuAuth(auth: StoredFeishuAuth) {
  return {
    isConnected: true,
    name: auth.name,
    expiresAt: auth.expiresAt,
    appId: auth.appId,
    credentialSource: auth.credentialSource,
  };
}
