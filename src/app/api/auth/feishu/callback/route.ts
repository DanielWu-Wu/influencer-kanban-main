import { NextRequest, NextResponse } from 'next/server';
import {
  exchangeFeishuCode,
  getFeishuUser,
  saveStoredFeishuAuth,
} from '@/lib/feishu-cloud-auth';
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
  if (!state || !expectedState || state !== expectedState) {
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
    const token = await exchangeFeishuCode(code, getRedirectUri(request));
    const user = await getFeishuUser(token.access_token!);
    await saveStoredFeishuAuth(appAuth.supabase, {
      isConnected: true,
      accessToken: token.access_token!,
      refreshToken: token.refresh_token!,
      expiresAt: Date.now() + token.expires_in! * 1000,
      refreshExpiresAt: token.refresh_token_expires_in
        ? Date.now() + token.refresh_token_expires_in * 1000
        : undefined,
      ...user,
    });

    const response = NextResponse.redirect(
      new URL('/?view=settings&feishu_connected=1', origin),
    );
    response.cookies.delete('feishu_oauth_state');
    return response;
  } catch (caughtError) {
    console.error('Feishu OAuth callback failed:', caughtError);
    return NextResponse.redirect(
      new URL('/?view=settings&feishu_error=callback_failed', origin),
    );
  }
}

