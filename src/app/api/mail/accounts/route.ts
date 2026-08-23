import { NextRequest, NextResponse } from 'next/server';
import { getStoredGmailAuth } from '@/lib/gmail-cloud-auth';
import {
  ensureLegacyGmailMailAccount,
  getStoredMailAccounts,
  saveStoredMailAccounts,
} from '@/lib/mail-account-storage';
import { sortMailAccounts } from '@/lib/mail-accounts';
import { getRequestUser } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const gmailAuth = await getStoredGmailAuth(appAuth.supabase);
    let accounts = await ensureLegacyGmailMailAccount(
      appAuth.supabase,
      appAuth.user.id,
      gmailAuth?.email,
    );
    accounts = accounts.map((account) => account.provider === 'gmail'
      ? {
          ...account,
          connectionStatus: gmailAuth?.email?.trim().toLowerCase() === account.email
            ? 'connected' as const
            : 'disconnected' as const,
        }
      : account);
    return NextResponse.json({ success: true, data: sortMailAccounts(accounts) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '读取邮箱账号失败。' },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { mailAccountId?: unknown };
  const mailAccountId = String(body.mailAccountId || '');

  try {
    const current = await getStoredMailAccounts(appAuth.supabase);
    if (!current.some((account) => account.mailAccountId === mailAccountId)) {
      return NextResponse.json({ error: '邮箱账号不存在。' }, { status: 404 });
    }
    const updatedAt = new Date().toISOString();
    const next = current.map((account) => ({
      ...account,
      isDefault: account.mailAccountId === mailAccountId,
      updatedAt: account.mailAccountId === mailAccountId ? updatedAt : account.updatedAt,
    }));
    await saveStoredMailAccounts(appAuth.supabase, appAuth.user.id, next);
    return NextResponse.json({ success: true, data: sortMailAccounts(next) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '设置默认邮箱失败。' },
      { status: 500 },
    );
  }
}
