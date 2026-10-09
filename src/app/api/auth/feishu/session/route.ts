import { NextRequest, NextResponse } from 'next/server';
import {
  deleteStoredFeishuOAuthPending,
  getStoredFeishuAuth,
  refreshStoredFeishuAuth,
} from '@/lib/feishu-cloud-auth';
import { getFeishuAppCredentialStatus } from '@/lib/feishu-app-credentials';
import { getFeishuSessionState } from '@/lib/feishu-session-state';
import { deleteUserSecret } from '@/lib/user-private-storage';
import { getRequestUser } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const callbackUrl = process.env.FEISHU_REDIRECT_URI
      || `${new URL(request.url).origin}/api/auth/feishu/callback`;
    const credentials = await getFeishuAppCredentialStatus(appAuth.supabase);
    const stored = await getStoredFeishuAuth(appAuth.supabase);
    const state = await getFeishuSessionState(
      credentials,
      stored,
      () => refreshStoredFeishuAuth(appAuth.supabase),
    );
    return NextResponse.json({ ...state, callbackUrl });
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
  await Promise.all([
    deleteUserSecret(appAuth.supabase, 'feishu_auth'),
    deleteStoredFeishuOAuthPending(appAuth.supabase),
  ]);
  return NextResponse.json({ success: true });
}
