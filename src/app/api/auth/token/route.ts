import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, clientId, clientSecret, redirectUri } = body;
    const resolvedClientId = clientId || process.env.GOOGLE_CLIENT_ID;
    const resolvedClientSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    const resolvedRedirectUri =
      redirectUri || process.env.GOOGLE_REDIRECT_URI || `${new URL(request.url).origin}/api/auth/callback`;

    if (!code || !resolvedClientId || !resolvedClientSecret) {
      return NextResponse.json({ error: '缺少必要参数或 Google OAuth 环境变量' }, { status: 400 });
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: resolvedClientId,
        client_secret: resolvedClientSecret,
        redirect_uri: resolvedRedirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      const details = await tokenResponse.text();
      console.error('Token exchange failed:', details);
      return NextResponse.json({ error: 'Token 交换失败', details }, { status: 400 });
    }

    const tokenData = await tokenResponse.json();

    return NextResponse.json({
      success: true,
      data: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        tokenType: tokenData.token_type,
        scope: tokenData.scope,
      },
    });
  } catch (err) {
    console.error('Token exchange error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
