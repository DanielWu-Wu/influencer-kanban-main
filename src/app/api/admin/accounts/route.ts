import { NextRequest, NextResponse } from 'next/server';
import {
  createAdminServerClient,
  getRequestAdmin,
} from '@/lib/supabase/server';

const LONG_BAN_DURATION = '876000h';

type SupabaseDatabaseError = {
  code?: string;
  message?: string;
};

function throwDatabaseError(
  context: string,
  error: SupabaseDatabaseError,
  fallbackMessage: string,
): never {
  console.error(`[admin-accounts:${context}] Supabase database operation failed`, {
    code: error.code,
    message: error.message?.slice(0, 240),
  });
  throw new Error(
    error.code === '42501'
      ? '账号管理数据库权限尚未配置。'
      : fallbackMessage,
  );
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizePassword(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function normalizeDisplayName(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET(request: NextRequest) {
  const currentAdmin = await getRequestAdmin(request);
  if (!currentAdmin) return NextResponse.json({ error: '没有账号管理权限。' }, { status: 403 });

  try {
    const admin = createAdminServerClient();
    const [{ data: profiles, error: profileError }, { data: authData, error: authError }] = await Promise.all([
      admin
        .from('account_profiles')
        .select('user_id,email,display_name,status,must_change_password,created_at,last_login_at')
        .order('created_at', { ascending: true }),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (profileError) throwDatabaseError('list-profiles', profileError, '账号资料读取失败。');
    if (authError) throw authError;

    const authUsers = new Map(authData.users.map((user) => [user.id, user]));
    const accounts = (profiles || []).map((profile) => {
      const authUser = authUsers.get(profile.user_id);
      return {
        userId: profile.user_id,
        email: profile.email,
        displayName: profile.display_name,
        status: profile.status,
        mustChangePassword: profile.must_change_password,
        isAdmin: profile.user_id === process.env.APP_ADMIN_USER_ID,
        createdAt: profile.created_at,
        lastLoginAt: authUser?.last_sign_in_at || profile.last_login_at || undefined,
      };
    });
    return NextResponse.json({ success: true, data: accounts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '账号列表读取失败。' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const currentAdmin = await getRequestAdmin(request);
  if (!currentAdmin) return NextResponse.json({ error: '没有账号管理权限。' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = normalizeEmail(body.email);
  const displayName = normalizeDisplayName(body.displayName);
  const temporaryPassword = normalizePassword(body.temporaryPassword);
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: '请输入有效邮箱。' }, { status: 400 });
  }
  if (!displayName) {
    return NextResponse.json({ error: '请输入成员姓名。' }, { status: 400 });
  }
  if (displayName.length > 80) {
    return NextResponse.json({ error: '姓名备注最多 80 个字符。' }, { status: 400 });
  }
  if (temporaryPassword.length < 8) {
    return NextResponse.json({ error: '临时密码至少需要 8 位。' }, { status: 400 });
  }

  try {
    const admin = createAdminServerClient();
    const { data, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (createError || !data.user) throw createError || new Error('账号创建失败。');

    const now = new Date().toISOString();
    const { error: profileError } = await admin.from('account_profiles').insert({
      user_id: data.user.id,
      email,
      display_name: displayName,
      status: 'active',
      must_change_password: true,
      created_by: currentAdmin.user.id,
      created_at: now,
      updated_at: now,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      throwDatabaseError('create-profile', profileError, '账号资料创建失败。');
    }

    return NextResponse.json({ success: true, data: { userId: data.user.id } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '账号创建失败。';
    return NextResponse.json(
      { error: /already|registered|exists/i.test(message) ? '该邮箱已经存在。' : message },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const currentAdmin = await getRequestAdmin(request);
  if (!currentAdmin) return NextResponse.json({ error: '没有账号管理权限。' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const action = typeof body.action === 'string' ? body.action : '';
  if (!userId) return NextResponse.json({ error: '缺少成员账号。' }, { status: 400 });
  if (
    action !== 'update_display_name'
    && (userId === currentAdmin.user.id || userId === process.env.APP_ADMIN_USER_ID)
  ) {
    return NextResponse.json({ error: '主管理员账号不能停用或重置。' }, { status: 400 });
  }

  try {
    const admin = createAdminServerClient();
    const now = new Date().toISOString();
    if (action === 'update_display_name') {
      const displayName = normalizeDisplayName(body.displayName);
      if (!displayName) {
        return NextResponse.json({ error: '请输入姓名备注。' }, { status: 400 });
      }
      if (displayName.length > 80) {
        return NextResponse.json({ error: '姓名备注最多 80 个字符。' }, { status: 400 });
      }
      const { data: updatedProfile, error: profileError } = await admin
        .from('account_profiles')
        .update({ display_name: displayName, updated_at: now })
        .eq('user_id', userId)
        .select('user_id')
        .maybeSingle();
      if (profileError) throwDatabaseError('update-display-name', profileError, '姓名备注更新失败。');
      if (!updatedProfile) {
        return NextResponse.json({ error: '未找到这个成员账号，请刷新后重试。' }, { status: 404 });
      }
    } else if (action === 'disable') {
      const { error: profileError } = await admin
        .from('account_profiles')
        .update({ status: 'disabled', updated_at: now })
        .eq('user_id', userId);
      if (profileError) throwDatabaseError('disable-profile', profileError, '账号状态更新失败。');
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: LONG_BAN_DURATION });
      if (error) throw error;
    } else if (action === 'enable') {
      const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' });
      if (error) throw error;
      const { error: profileError } = await admin
        .from('account_profiles')
        .update({ status: 'active', updated_at: now })
        .eq('user_id', userId);
      if (profileError) throwDatabaseError('enable-profile', profileError, '账号状态更新失败。');
    } else if (action === 'reset_password') {
      const temporaryPassword = normalizePassword(body.temporaryPassword);
      if (temporaryPassword.length < 8) {
        return NextResponse.json({ error: '临时密码至少需要 8 位。' }, { status: 400 });
      }
      const { error: profileError } = await admin
        .from('account_profiles')
        .update({ must_change_password: true, updated_at: now })
        .eq('user_id', userId);
      if (profileError) throwDatabaseError('reset-password-profile', profileError, '账号状态更新失败。');
      const { error } = await admin.auth.admin.updateUserById(userId, { password: temporaryPassword });
      if (error) throw error;
    } else {
      return NextResponse.json({ error: '不支持的账号操作。' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '账号操作失败。' },
      { status: 500 },
    );
  }
}
