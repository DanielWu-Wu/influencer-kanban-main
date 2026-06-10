import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const encodedAuth = request.cookies.get('gmail_oauth_result')?.value;

  if (!encodedAuth) {
    return NextResponse.json({ error: '未找到 Gmail 授权结果，请重新连接。' }, { status: 404 });
  }

  try {
    const auth = JSON.parse(Buffer.from(encodedAuth, 'base64url').toString('utf8'));
    const response = NextResponse.json({ success: true, data: auth });
    response.cookies.delete('gmail_oauth_result');
    return response;
  } catch {
    const response = NextResponse.json({ error: 'Gmail 授权结果无效，请重新连接。' }, { status: 400 });
    response.cookies.delete('gmail_oauth_result');
    return response;
  }
}
