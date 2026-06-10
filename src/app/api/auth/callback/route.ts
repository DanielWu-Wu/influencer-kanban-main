import { NextRequest, NextResponse } from 'next/server';

function getRedirectUri(request: NextRequest) {
  return process.env.GOOGLE_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/callback`;
}

async function getGmailEmail(accessToken: string) {
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return undefined;
  const data = await response.json();
  return typeof data.emailAddress === 'string' ? data.emailAddress : undefined;
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const error = requestUrl.searchParams.get('error');
  const state = requestUrl.searchParams.get('state');
  const expectedState = request.cookies.get('gmail_oauth_state')?.value;
  const redirectOrigin = requestUrl.origin;

  if (!state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL('/?view=gmail&auth_error=invalid_state', redirectOrigin));
  }

  if (error) {
    return NextResponse.redirect(new URL(`/?view=gmail&auth_error=${encodeURIComponent(error)}`, redirectOrigin));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/?view=gmail&auth_error=no_code', redirectOrigin));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/?view=gmail&auth_error=missing_google_oauth_env', redirectOrigin));
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(request),
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const details = await tokenResponse.text();
      console.error('Gmail token exchange failed:', details);
      return NextResponse.redirect(new URL('/?view=gmail&auth_error=token_exchange_failed', redirectOrigin));
    }

    const tokenData = await tokenResponse.json();
    const email = await getGmailEmail(tokenData.access_token);
    const authPayload = {
      isConnected: true,
      email,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
    };

    const response = NextResponse.redirect(new URL('/?view=gmail&gmail_connected=1', redirectOrigin));
    response.cookies.set('gmail_oauth_result', Buffer.from(JSON.stringify(authPayload)).toString('base64url'), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 300,
      path: '/',
    });
    return response;
  } catch (err) {
    console.error('OAuth callback error:', err);
    return NextResponse.redirect(new URL('/?view=gmail&auth_error=callback_failed', redirectOrigin));
  }
}
