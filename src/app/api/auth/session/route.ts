import { NextRequest, NextResponse } from 'next/server';
import { deleteUserSecret } from '@/lib/user-private-storage';
import {
  getStoredGmailAuth,
  refreshStoredGmailAuth,
  saveStoredGmailAuth,
  toBrowserGmailAuth,
  type StoredGmailAuth,
} from '@/lib/gmail-cloud-auth';
import { getRequestUser } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const stored = await getStoredGmailAuth(appAuth.supabase);
    if (!stored) return NextResponse.json({ error: '尚未连接 Gmail。' }, { status: 404 });
    const fresh = stored.expiresAt > Date.now() + 60_000
      ? stored
      : await refreshStoredGmailAuth(appAuth.supabase);
    return NextResponse.json({ success: true, data: toBrowserGmailAuth(fresh) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '读取 Gmail 授权失败。' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  const body = await request.json() as Partial<StoredGmailAuth>;
  if (!body.accessToken || !body.refreshToken || !body.expiresAt) {
    return NextResponse.json({ error: '本机 Gmail 授权资料不完整。' }, { status: 400 });
  }

  await saveStoredGmailAuth(appAuth.supabase, {
    isConnected: true,
    email: body.email,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    expiresAt: body.expiresAt,
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  await deleteUserSecret(appAuth.supabase, 'gmail_auth');
  return NextResponse.json({ success: true });
}
