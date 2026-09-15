import { NextRequest, NextResponse } from 'next/server';
import {
  APP_SESSION_COOKIE,
  getRequestAccountResult,
} from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const { accessToken } = await request.json();
  if (!accessToken || typeof accessToken !== 'string') {
    return NextResponse.json({ error: '缺少登录凭证。' }, { status: 400 });
  }

  const verification = await getRequestAccountResult(new NextRequest(request.url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }));
  if (verification.status === 'unavailable') {
    return NextResponse.json({
      success: false,
      code: 'ACCOUNT_SERVICE_UNAVAILABLE',
      error: '账号服务暂时不可用，请稍后重试。',
    }, { status: 503 });
  }
  if (verification.status === 'unauthenticated') {
    return NextResponse.json({
      success: false,
      code: 'SESSION_INVALID',
      error: '登录凭证无效。',
    }, { status: 401 });
  }
  if (verification.status === 'not_found') {
    return NextResponse.json({
      success: false,
      code: 'ACCOUNT_NOT_PROVISIONED',
      error: '账号尚未由管理员开通。',
    }, { status: 403 });
  }
  const profile = verification.account.profile;
  if (profile.status !== 'active') {
    return NextResponse.json({
      success: false,
      code: 'ACCOUNT_DISABLED',
      error: '账号已停用，请联系管理员。',
    }, { status: 403 });
  }

  const response = NextResponse.json({ success: true, data: profile });
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
