import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

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

export function getRequestAccessToken(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return request.cookies.get(APP_SESSION_COOKIE)?.value;
}

export async function getRequestUser(request: NextRequest) {
  const accessToken = getRequestAccessToken(request);
  if (!accessToken) return null;

  const supabase = createAuthenticatedServerClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;

  return { user: data.user, accessToken, supabase };
}
