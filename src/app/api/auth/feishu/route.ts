import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/supabase/server';

const FEISHU_SCOPES = [
  'offline_access',
  'base:app:read',
  'base:table:read',
  'base:field:read',
  'base:record:read',
  'base:record:create',
  'base:record:update',
];

function getRedirectUri(request: NextRequest) {
  return process.env.FEISHU_REDIRECT_URI
    || `${new URL(request.url).origin}/api/auth/feishu/callback`;
}

export async function GET(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.redirect(new URL('/login', request.url));

  const appId = process.env.FEISHU_APP_ID;
  if (!appId) {
    return NextResponse.redirect(new URL('/?view=settings&feishu_error=missing_app_id', request.url));
  }

  const state = randomBytes(24).toString('base64url');
  const authUrl = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
  authUrl.searchParams.set('app_id', appId);
  authUrl.searchParams.set('redirect_uri', getRedirectUri(request));
  authUrl.searchParams.set('scope', FEISHU_SCOPES.join(' '));
  authUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authUrl);
  response.cookies.set('feishu_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });
  return response;
}
