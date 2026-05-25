import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  if (error) {
    const redirectOrigin = state || new URL(request.url).origin;
    return NextResponse.redirect(
      new URL(`/?view=gmail&auth_error=${encodeURIComponent(error)}`, redirectOrigin)
    );
  }

  if (!code) {
    const redirectOrigin = state || new URL(request.url).origin;
    return NextResponse.redirect(
      new URL('/?view=gmail&auth_error=no_code', redirectOrigin)
    );
  }

  try {
    // 从 state 中获取 redirect origin（保存用户的原始域名）
    const redirectOrigin = state || new URL(request.url).origin;

    // 把 code 传回前端，由前端直接与 Google 交换 token
    // 因为后端服务器可能无法访问 Google（网络限制）
    return NextResponse.redirect(
      new URL(`/?view=gmail&auth_code=${encodeURIComponent(code)}`, redirectOrigin)
    );
  } catch (err) {
    console.error('OAuth callback error:', err);
    const redirectOrigin = state || new URL(request.url).origin;
    return NextResponse.redirect(
      new URL('/?view=gmail&auth_error=callback_failed', redirectOrigin)
    );
  }
}
