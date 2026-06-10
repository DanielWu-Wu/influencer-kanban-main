import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { refreshToken, clientId, clientSecret } = body;
    const resolvedClientId = clientId || process.env.GOOGLE_CLIENT_ID;
    const resolvedClientSecret = clientSecret || process.env.GOOGLE_CLIENT_SECRET;

    if (!refreshToken || !resolvedClientId || !resolvedClientSecret) {
      return NextResponse.json({ error: '缺少 refresh token 或 Google OAuth 环境变量' }, { status: 400 });
    }

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: resolvedClientId,
        client_secret: resolvedClientSecret,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenResponse.ok) {
      const details = await tokenResponse.text();
      console.error('Token refresh failed:', details);
      return NextResponse.json({ error: 'Token 刷新失败', details }, { status: 400 });
    }

    const tokenData = await tokenResponse.json();

    return NextResponse.json({
      success: true,
      data: {
        accessToken: tokenData.access_token,
        expiresIn: tokenData.expires_in,
        tokenType: tokenData.token_type,
        scope: tokenData.scope,
      },
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
