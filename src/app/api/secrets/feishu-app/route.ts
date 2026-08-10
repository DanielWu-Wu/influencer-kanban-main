import { NextRequest, NextResponse } from 'next/server';
import {
  deletePersonalFeishuAppCredentials,
  getFeishuAppCredentialStatus,
  savePersonalFeishuAppCredentials,
} from '@/lib/feishu-app-credentials';
import { getRequestUser } from '@/lib/supabase/server';
import { deleteUserSecret } from '@/lib/user-private-storage';

const FEISHU_AUTH_KEYS = ['feishu_auth', 'feishu_oauth_pending'] as const;

async function clearPreviousAuthorization(supabase: Parameters<typeof deleteUserSecret>[0]) {
  await Promise.all(FEISHU_AUTH_KEYS.map((key) => deleteUserSecret(supabase, key)));
}

export async function GET(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    return NextResponse.json(await getFeishuAppCredentialStatus(auth.supabase));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '读取飞书应用配置失败。' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '未登录。' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  try {
    const credentials = await savePersonalFeishuAppCredentials(auth.supabase, {
      appId: body.appId,
      appSecret: body.appSecret,
    });
    await clearPreviousAuthorization(auth.supabase);
    return NextResponse.json({
      success: true,
      configured: true,
      source: 'personal',
      appId: credentials.appId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存飞书应用配置失败。';
    const isInputError = message.includes('格式不正确');
    return NextResponse.json(
      { error: message },
      { status: isInputError ? 400 : 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    await Promise.all([
      deletePersonalFeishuAppCredentials(auth.supabase),
      clearPreviousAuthorization(auth.supabase),
    ]);
    return NextResponse.json({
      success: true,
      ...(await getFeishuAppCredentialStatus(auth.supabase)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '删除飞书应用配置失败。' },
      { status: 500 },
    );
  }
}
