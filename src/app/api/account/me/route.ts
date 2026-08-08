import { NextRequest, NextResponse } from 'next/server';
import { createAdminServerClient, getRequestAccountResult } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const accountResult = await getRequestAccountResult(request);
  if (accountResult.status === 'unavailable') {
    return NextResponse.json({
      success: false,
      code: 'ACCOUNT_SERVICE_UNAVAILABLE',
      error: '账号服务暂时不可用，请稍后重试。',
    }, { status: 503 });
  }
  if (accountResult.status === 'unauthenticated') {
    return NextResponse.json({
      success: false,
      code: 'SESSION_INVALID',
      error: '登录状态已失效，请重新登录。',
    }, { status: 401 });
  }
  if (accountResult.status === 'not_found') {
    return NextResponse.json({
      success: false,
      code: 'ACCOUNT_NOT_PROVISIONED',
      error: '账号尚未由管理员开通。',
    }, { status: 403 });
  }
  const { account } = accountResult;

  if (account.profile.status === 'active') {
    try {
      const admin = createAdminServerClient();
      const lastLoginAt = new Date().toISOString();
      await admin
        .from('account_profiles')
        .update({ last_login_at: lastLoginAt, updated_at: lastLoginAt })
        .eq('user_id', account.user.id);
      account.profile.lastLoginAt = lastLoginAt;
    } catch {
      // Account reads must keep working before the server management key is configured.
    }
  }

  return NextResponse.json({ success: true, data: account.profile });
}
