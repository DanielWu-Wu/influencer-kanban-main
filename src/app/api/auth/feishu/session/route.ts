import { NextRequest, NextResponse } from 'next/server';
import {
  getStoredFeishuAuth,
  refreshStoredFeishuAuth,
  toBrowserFeishuAuth,
} from '@/lib/feishu-cloud-auth';
import { deleteUserSecret } from '@/lib/user-private-storage';
import { getRequestUser } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const stored = await getStoredFeishuAuth(appAuth.supabase);
    if (!stored) {
      return NextResponse.json({
        configured: Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET),
        connected: false,
      });
    }
    const fresh = stored.expiresAt > Date.now() + 60_000
      ? stored
      : await refreshStoredFeishuAuth(appAuth.supabase);
    return NextResponse.json({
      configured: true,
      connected: true,
      data: toBrowserFeishuAuth(fresh),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '读取飞书连接状态失败。' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });
  await deleteUserSecret(appAuth.supabase, 'feishu_auth');
  return NextResponse.json({ success: true });
}

