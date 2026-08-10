import { NextRequest, NextResponse } from 'next/server';
import {
  deleteStoredFeishuOAuthPending,
  exchangeFeishuCode,
  getFeishuUser,
  getStoredFeishuOAuthPending,
  saveStoredFeishuAuth,
} from '@/lib/feishu-cloud-auth';
import { resolveFeishuAppCredentials } from '@/lib/feishu-app-credentials';
import { getRequestUser } from '@/lib/supabase/server';

function getRedirectUri(request: NextRequest) {
  return process.env.FEISHU_REDIRECT_URI
    || `${new URL(request.url).origin}/api/auth/feishu/callback`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const expectedState = request.cookies.get('feishu_oauth_state')?.value;
  const appAuth = await getRequestUser(request);

  if (!appAuth) return NextResponse.redirect(new URL('/login', origin));
  const pending = await getStoredFeishuOAuthPending(appAuth.supabase).catch(() => null);
  if (
    !state
    || !expectedState
    || state !== expectedState
    || !pending
    || pending.state !== state
  ) {
    return NextResponse.redirect(new URL('/?view=settings&feishu_error=invalid_state', origin));
  }
  if (error) {
    return NextResponse.redirect(
      new URL(`/?view=settings&feishu_error=${encodeURIComponent(error)}`, origin),
    );
  }
  if (!code) {
    return NextResponse.redirect(new URL('/?view=settings&feishu_error=no_code', origin));
  }

  try {
    if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
      throw new Error('authorization_expired');
    }
    const redirectUri = getRedirectUri(request);
    const credentials = await resolveFeishuAppCredentials(appAuth.supabase);
    if (
      pending.appId !== credentials.appId
      || pending.credentialFingerprint !== credentials.fingerprint
      || pending.redirectUri !== redirectUri
    ) {
      throw new Error('credentials_changed');
    }
    const token = await exchangeFeishuCode(code, redirectUri, credentials);
    const user = await getFeishuUser(token.access_token!);
    await saveStoredFeishuAuth(appAuth.supabase, {
      isConnected: true,
      accessToken: token.access_token!,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in! * 1000,
      refreshExpiresAt: token.refresh_token_expires_in || token.refresh_expires_in
        ? Date.now() + (token.refresh_token_expires_in || token.refresh_expires_in)! * 1000
        : undefined,
      appId: credentials.appId,
      credentialSource: credentials.source,
      credentialFingerprint: credentials.fingerprint,
      ...user,
    });
    await deleteStoredFeishuOAuthPending(appAuth.supabase);

    const response = NextResponse.redirect(
      new URL('/?view=settings&feishu_connected=1', origin),
    );
    response.cookies.delete('feishu_oauth_state');
    return response;
  } catch (caughtError) {
    console.error('Feishu OAuth callback failed:', caughtError);
    await deleteStoredFeishuOAuthPending(appAuth.supabase).catch(() => undefined);
    const errorCode = caughtError instanceof Error
      && ['authorization_expired', 'credentials_changed'].includes(caughtError.message)
      ? caughtError.message
      : 'callback_failed';
    return NextResponse.redirect(
      new URL(`/?view=settings&feishu_error=${errorCode}`, origin),
    );
  }
}
