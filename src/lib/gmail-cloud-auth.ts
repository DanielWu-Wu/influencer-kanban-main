import type { SupabaseClient } from '@supabase/supabase-js';
import { getUserSecret, setUserSecret } from './user-private-storage';

export interface StoredGmailAuth {
  isConnected: true;
  email?: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export async function getStoredGmailAuth(supabase: SupabaseClient) {
  return getUserSecret<StoredGmailAuth>(supabase, 'gmail_auth');
}

export async function saveStoredGmailAuth(
  supabase: SupabaseClient,
  auth: StoredGmailAuth,
) {
  await setUserSecret(supabase, 'gmail_auth', auth);
}

export async function refreshStoredGmailAuth(supabase: SupabaseClient) {
  const auth = await getStoredGmailAuth(supabase);
  if (!auth) throw new Error('尚未连接 Gmail。');
  if (auth.expiresAt > Date.now() + 60_000) return auth;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google OAuth 环境变量不完整。');

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: auth.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`Gmail Token 刷新失败 (${tokenResponse.status})`);
  }

  const tokenData = await tokenResponse.json();
  const updated: StoredGmailAuth = {
    ...auth,
    accessToken: tokenData.access_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
  };
  await saveStoredGmailAuth(supabase, updated);
  return updated;
}

export function toBrowserGmailAuth(auth: StoredGmailAuth) {
  return {
    isConnected: true,
    email: auth.email,
    accessToken: auth.accessToken,
    expiresAt: auth.expiresAt,
  };
}
