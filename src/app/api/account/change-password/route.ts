import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import {
  createAdminServerClient,
  getRequestAccount,
} from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const account = await getRequestAccount(request);
  if (!account) return NextResponse.json({ error: '未登录。' }, { status: 401 });
  if (account.profile.status !== 'active') {
    return NextResponse.json({ error: '账号已停用，请联系管理员。' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as {
    currentPassword?: unknown;
    newPassword?: unknown;
  };
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!currentPassword) {
    return NextResponse.json({ error: '请输入当前密码。' }, { status: 400 });
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: '新密码至少需要 8 位。' }, { status: 400 });
  }
  if (currentPassword === newPassword) {
    return NextResponse.json({ error: '新密码不能与当前密码相同。' }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) {
    return NextResponse.json({ error: 'Supabase 环境变量尚未配置。' }, { status: 500 });
  }

  const verifier = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: account.user.email || account.profile.email,
    password: currentPassword,
  });
  if (verifyError) {
    return NextResponse.json({ error: '当前密码不正确。' }, { status: 400 });
  }

  try {
    const admin = createAdminServerClient();
    const { error: passwordError } = await admin.auth.admin.updateUserById(
      account.user.id,
      { password: newPassword },
    );
    if (passwordError) throw passwordError;

    const now = new Date().toISOString();
    const { error: profileError } = await admin
      .from('account_profiles')
      .update({ must_change_password: false, updated_at: now })
      .eq('user_id', account.user.id);
    if (profileError) throw profileError;

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '密码修改失败。' },
      { status: 500 },
    );
  }
}
