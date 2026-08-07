import { createClient, type User } from '@supabase/supabase-js';
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

function sanitizeAuthErrorMessage(message: string) {
  return message
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-jwt]')
    .replace(/\bsb_(?:publishable|secret)_[A-Za-z0-9_-]+\b/g, '[redacted-key]')
    .slice(0, 240);
}

function logAuthVerificationError(context: string, error: unknown) {
  const candidate = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : {};
  console.error(`[account-auth:${context}] Supabase token verification failed`, {
    name: typeof candidate.name === 'string' ? candidate.name : 'UnknownError',
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
    message: typeof candidate.message === 'string'
      ? sanitizeAuthErrorMessage(candidate.message)
      : undefined,
  });
}

export async function verifyAccessToken(
  accessToken: string,
  context = 'request',
): Promise<User | null> {
  try {
    // Token authenticity is checked with the server-only key. The caller can
    // never choose a user id; all later reads are pinned to this verified user.
    const admin = createAdminServerClient();
    const { data, error } = await admin.auth.getUser(accessToken);
    if (error || !data.user) {
      logAuthVerificationError(context, error);
      return null;
    }
    return data.user;
  } catch (error) {
    logAuthVerificationError(context, error);
    return null;
  }
}

export function getRequestAccessToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return request.cookies.get(APP_SESSION_COOKIE)?.value;
}

export async function getRequestIdentity(request: NextRequest) {
  const accessToken = getRequestAccessToken(request);
  if (!accessToken) return null;

  const user = await verifyAccessToken(accessToken, 'request-identity');
  if (!user) return null;

  const supabase = createAuthenticatedServerClient(accessToken);
  return { user, accessToken, supabase };
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

  try {
    const admin = createAdminServerClient();
    const { data, error } = await admin
      .from('account_profiles')
      .select('user_id,email,display_name,status,must_change_password,created_at,last_login_at')
      .eq('user_id', identity.user.id)
      .maybeSingle();
    if (error) {
      console.error('[account-auth:account-profile] Account profile lookup failed', {
        code: error.code,
        message: error.message.slice(0, 240),
      });
      return null;
    }
    if (!data) return null;

    const isAdmin = identity.user.id === process.env.APP_ADMIN_USER_ID;
    return {
      ...identity,
      profile: mapAccountProfile(data, isAdmin),
    };
  } catch (error) {
    logAuthVerificationError('account-profile', error);
    return null;
  }
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
