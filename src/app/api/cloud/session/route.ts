import { NextRequest, NextResponse } from 'next/server';
import {
  APP_SESSION_COOKIE,
  createAuthenticatedServerClient,
  verifyAccessTokenResult,
} from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const { accessToken } = await request.json();
  if (!accessToken || typeof accessToken !== 'string') {
    return NextResponse.json({ error: '缺少登录凭证。' }, { status: 400 });
  }

  const verification = await verifyAccessTokenResult(accessToken, 'cloud-session');
  if (verification.status === 'unavailable') {
    return NextResponse.json({
      success: false,
      code: 'ACCOUNT_SERVICE_UNAVAILABLE',
      error: '账号服务暂时不可用，请稍后重试。',
    }, { status: 503 });
  }
  if (verification.status !== 'ok') {
    return NextResponse.json({
      success: false,
      code: 'SESSION_INVALID',
      error: '登录凭证无效。',
    }, { status: 401 });
  }
  const { user } = verification;

  const userClient = createAuthenticatedServerClient(accessToken);
  const { data: profile, error: profileError } = await userClient
    .from('account_profiles')
    .select('status,must_change_password')
    .eq('user_id', user.id)
    .maybeSingle();
  if (profileError) {
    console.error('[account-auth:cloud-session] Account profile lookup failed', {
      code: profileError.code,
      message: profileError.message.slice(0, 240),
    });
    return NextResponse.json({
      success: false,
      code: 'ACCOUNT_SERVICE_UNAVAILABLE',
      error: '账号服务暂时不可用，请稍后重试。',
    }, { status: 503 });
  }
  if (!profile) {
    return NextResponse.json({
      success: false,
      code: 'ACCOUNT_NOT_PROVISIONED',
      error: '账号尚未由管理员开通。',
    }, { status: 403 });
  }
  if (profile.status !== 'active') {
    return NextResponse.json({
      success: false,
      code: 'ACCOUNT_DISABLED',
      error: '账号已停用，请联系管理员。',
    }, { status: 403 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(APP_SESSION_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(APP_SESSION_COOKIE);
  return response;
}
