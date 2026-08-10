import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { resolveFeishuAppCredentials } from '@/lib/feishu-app-credentials';
import { saveStoredFeishuOAuthPending } from '@/lib/feishu-cloud-auth';
import { getRequestUser } from '@/lib/supabase/server';

const FEISHU_SCOPES = [
  'offline_access',
  'bitable:app:readonly',
  'base:app:read',
  'base:table:read',
  'base:field:read',
  'base:record:retrieve',
  'base:record:read',
  'base:record:create',
  'base:record:update',
  'wiki:wiki:readonly',
];

function getRedirectUri(request: NextRequest) {
  return process.env.FEISHU_REDIRECT_URI
    || `${new URL(request.url).origin}/api/auth/feishu/callback`;
}

export async function GET(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.redirect(new URL('/login', request.url));

  try {
    const credentials = await resolveFeishuAppCredentials(appAuth.supabase);
    const state = randomBytes(24).toString('base64url');
    const redirectUri = getRedirectUri(request);
    await saveStoredFeishuOAuthPending(appAuth.supabase, {
      state,
      appId: credentials.appId,
      credentialFingerprint: credentials.fingerprint,
      redirectUri,
      createdAt: Date.now(),
    });

    const authUrl = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
    authUrl.searchParams.set('app_id', credentials.appId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
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
  } catch (error) {
    console.error('Feishu OAuth initialization failed:', error);
    const message = error instanceof Error ? error.message : '';
    const errorCode = message.includes('尚未配置')
      ? 'missing_app_credentials'
      : 'credential_error';
    return NextResponse.redirect(
      new URL(`/?view=settings&feishu_error=${errorCode}`, request.url),
    );
  }
}
