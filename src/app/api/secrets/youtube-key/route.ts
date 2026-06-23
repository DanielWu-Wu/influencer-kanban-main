import { NextRequest, NextResponse } from 'next/server';
import { deleteUserSecret, getUserSecret, setUserSecret } from '@/lib/user-private-storage';
import { getRequestUser } from '@/lib/supabase/server';

const YOUTUBE_SECRET_KEY = 'youtube_api_key';

export async function GET(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ configured: false });

  try {
    const value = await getUserSecret<string>(auth.supabase, YOUTUBE_SECRET_KEY);
    return NextResponse.json({ configured: Boolean(value) });
  } catch (error) {
    return NextResponse.json({
      configured: false,
      error: error instanceof Error ? error.message : '读取 YouTube API Key 失败。',
    });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录账号。' }, { status: 401 });

  const { apiKey } = await request.json();
  if (!apiKey || typeof apiKey !== 'string') {
    return NextResponse.json({ error: '请输入 YouTube API Key。' }, { status: 400 });
  }

  try {
    await setUserSecret(auth.supabase, YOUTUBE_SECRET_KEY, apiKey.trim());
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '保存 YouTube API Key 失败。' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录账号。' }, { status: 401 });

  await deleteUserSecret(auth.supabase, YOUTUBE_SECRET_KEY);
  return NextResponse.json({ success: true });
}
