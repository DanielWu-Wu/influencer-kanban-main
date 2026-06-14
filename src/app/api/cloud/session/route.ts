import { NextRequest, NextResponse } from 'next/server';
import { APP_SESSION_COOKIE, createAuthenticatedServerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const { accessToken } = await request.json();
  if (!accessToken || typeof accessToken !== 'string') {
    return NextResponse.json({ error: '缺少登录凭证。' }, { status: 400 });
  }

  const supabase = createAuthenticatedServerClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return NextResponse.json({ error: '登录凭证无效。' }, { status: 401 });
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
