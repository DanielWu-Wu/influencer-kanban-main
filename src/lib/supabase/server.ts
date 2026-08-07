import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import type { AccountProfile } from '@/lib/account-types';

export const APP_SESSION_COOKIE = 'influencer_app_session';

function getServerConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error('Supabase 环境变量尚未配置。');
  }

  return { url, publishableKey };
}

export function createAuthenticatedServerClient(accessToken: string) {
  const { url, publishableKey } = getServerConfig();
  return createClient(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export function createAdminServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secretKey) {
    throw new Error('账号管理尚未配置 SUPABASE_SECRET_KEY。');
  }

  return createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function getRequestAccessToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return request.cookies.get(APP_SESSION_COOKIE)?.value;
}

export async function getRequestIdentity(request: NextRequest) {
  const accessToken = getRequestAccessToken(request);
  if (!accessToken) return null;

  const supabase = createAuthenticatedServerClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;

  return { user: data.user, accessToken, supabase };
}

function mapAccountProfile(
  row: Record<string, unknown>,
  isAdmin: boolean,
): AccountProfile {
  return {
    userId: String(row.user_id || ''),
    email: String(row.email || ''),
    displayName: String(row.display_name || ''),
    status: row.status === 'disabled' ? 'disabled' : 'active',
    mustChangePassword: Boolean(row.must_change_password),
    isAdmin,
    createdAt: String(row.created_at || ''),
    lastLoginAt: row.last_login_at ? String(row.last_login_at) : undefined,
  };
}

export async function getRequestAccount(request: NextRequest) {
  const identity = await getRequestIdentity(request);
  if (!identity) return null;

  const { data, error } = await identity.supabase
    .from('account_profiles')
    .select('user_id,email,display_name,status,must_change_password,created_at,last_login_at')
    .eq('user_id', identity.user.id)
    .maybeSingle();
  if (error || !data) return null;

  const isAdmin = identity.user.id === process.env.APP_ADMIN_USER_ID;
  return {
    ...identity,
    profile: mapAccountProfile(data, isAdmin),
  };
}

export async function getRequestUser(request: NextRequest) {
  const account = await getRequestAccount(request);
  if (
    !account
    || account.profile.status !== 'active'
    || account.profile.mustChangePassword
  ) return null;
  return account;
}

export async function getRequestAdmin(request: NextRequest) {
  const account = await getRequestUser(request);
  if (!account || !account.profile.isAdmin) return null;
  return account;
}
