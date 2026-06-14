import type { SupabaseClient } from '@supabase/supabase-js';
import { getUserSecret, setUserSecret } from './user-private-storage';

const FEISHU_TOKEN_ENDPOINT = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';

export interface StoredFeishuAuth {
  isConnected: true;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt?: number;
  name?: string;
  openId?: string;
  tenantKey?: string;
}

type FeishuTokenResponse = {
  code?: number;
  msg?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_token_expires_in?: number;
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
  };
};

function normalizeTokenResponse(payload: FeishuTokenResponse) {
  const source = payload.data || payload;
  if (!source.access_token || !source.refresh_token || !source.expires_in) {
    throw new Error(payload.msg || '飞书没有返回完整的授权令牌。');
  }
  return source;
}

export async function exchangeFeishuCode(code: string, redirectUri: string) {
  const clientId = process.env.FEISHU_APP_ID;
  const clientSecret = process.env.FEISHU_APP_SECRET;
  if (!clientId || !clientSecret) throw new Error('飞书应用凭证尚未配置。');

  const response = await fetch(FEISHU_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
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

export async function refreshStoredFeishuAuth(supabase: SupabaseClient) {
  const auth = await getStoredFeishuAuth(supabase);
  if (!auth) throw new Error('尚未连接飞书。');
  if (auth.expiresAt > Date.now() + 60_000) return auth;

  const clientId = process.env.FEISHU_APP_ID;
  const clientSecret = process.env.FEISHU_APP_SECRET;
  if (!clientId || !clientSecret) throw new Error('飞书应用凭证尚未配置。');

  const response = await fetch(FEISHU_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
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
    refreshToken: token.refresh_token!,
    expiresAt: Date.now() + token.expires_in! * 1000,
    refreshExpiresAt: token.refresh_token_expires_in
      ? Date.now() + token.refresh_token_expires_in * 1000
      : auth.refreshExpiresAt,
  };
  await saveStoredFeishuAuth(supabase, updated);
  return updated;
}

export function toBrowserFeishuAuth(auth: StoredFeishuAuth) {
  return {
    isConnected: true,
    name: auth.name,
    expiresAt: auth.expiresAt,
  };
}

