import { NextRequest, NextResponse } from 'next/server';
import { createAdminServerClient, getRequestAccount } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const account = await getRequestAccount(request);
  if (!account) {
    return NextResponse.json({ error: '账号尚未由管理员开通。' }, { status: 403 });
  }

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
