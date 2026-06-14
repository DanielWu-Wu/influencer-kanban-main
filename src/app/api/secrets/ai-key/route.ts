import { NextRequest, NextResponse } from 'next/server';
import { deleteUserSecret, getUserSecret, setUserSecret } from '@/lib/user-private-storage';
import { getRequestUser } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const value = await getUserSecret<string>(auth.supabase, 'ai_api_key');
    return NextResponse.json({ configured: Boolean(value) });
  } catch (error) {
    return NextResponse.json({
      configured: false,
      error: error instanceof Error ? error.message : '读取失败。',
    });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  const { apiKey } = await request.json();
  if (!apiKey || typeof apiKey !== 'string') {
    return NextResponse.json({ error: '请输入 API Key。' }, { status: 400 });
  }

  try {
    await setUserSecret(auth.supabase, 'ai_api_key', apiKey.trim());
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '保存失败。' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  await deleteUserSecret(auth.supabase, 'ai_api_key');
  return NextResponse.json({ success: true });
}
