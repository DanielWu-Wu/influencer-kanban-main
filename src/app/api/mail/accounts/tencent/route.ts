import { NextRequest, NextResponse } from 'next/server';
import {
  getStoredMailAccounts,
  removeStoredMailAccount,
  upsertStoredMailAccount,
} from '@/lib/mail-account-storage';
import {
  buildMailAccountId,
  DEFAULT_TENCENT_EXMAIL_CONFIG,
  normalizeMailAddress,
  type MailAccount,
} from '@/lib/mail-accounts';
import { getRequestUser } from '@/lib/supabase/server';
import {
  deleteTencentExmailCredentials,
  normalizeTencentExmailCredentials,
  saveTencentExmailCredentials,
} from '@/lib/tencent-exmail-credentials';
import { testTencentExmailImap, testTencentExmailSmtp } from '@/lib/tencent-exmail-client';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action === 'save' ? 'save' : 'test';

  try {
    const login = normalizeTencentExmailCredentials(body.email, body.password);
    const mailAccountId = buildMailAccountId('tencent_exmail', login.email);
    const current = await getStoredMailAccounts(appAuth.supabase);
    const otherTencentAccount = current.find((account) => (
      account.provider === 'tencent_exmail' && account.mailAccountId !== mailAccountId
    ));
    if (otherTencentAccount) {
      return NextResponse.json(
        { error: `首版只支持一个腾讯企业邮箱，请先断开 ${otherTencentAccount.email}。` },
        { status: 409 },
      );
    }

    await testTencentExmailImap(login);
    await testTencentExmailSmtp(login);
    const testedAt = new Date().toISOString();
    if (action === 'test') {
      return NextResponse.json({
        success: true,
        data: { imap: true, smtp: true, testedAt },
      });
    }

    await saveTencentExmailCredentials(appAuth.supabase, login);
    const existing = current.find((account) => account.mailAccountId === mailAccountId);
    const account: MailAccount = {
      mailAccountId,
      provider: 'tencent_exmail',
      email: login.email,
      displayName: String(body.displayName || '').trim() || '腾讯企业邮箱',
      connectionStatus: 'connected',
      isDefault: existing?.isDefault || !current.some((item) => item.isDefault),
      capabilities: { receive: true, drafts: true, send: true },
      lastTestedAt: testedAt,
      folderMapping: existing?.folderMapping || {},
      ...DEFAULT_TENCENT_EXMAIL_CONFIG,
      createdAt: existing?.createdAt || testedAt,
      updatedAt: testedAt,
    };
    const accounts = await upsertStoredMailAccount(appAuth.supabase, appAuth.user.id, account);
    return NextResponse.json({ success: true, data: { account, accounts } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '腾讯企业邮箱连接失败。';
    const isInputError = message.includes('格式不正确') || message.includes('不能为空');
    return NextResponse.json({ error: message }, { status: isInputError ? 400 : 502 });
  }
}

export async function DELETE(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });
  const mailAccountId = String(new URL(request.url).searchParams.get('mailAccountId') || '');
  const normalizedId = buildMailAccountId(
    'tencent_exmail',
    normalizeMailAddress(mailAccountId.replace(/^tencent_exmail:/, '')),
  );

  try {
    const current = await getStoredMailAccounts(appAuth.supabase);
    if (!current.some((account) => account.mailAccountId === normalizedId)) {
      return NextResponse.json({ error: '腾讯企业邮箱账号不存在。' }, { status: 404 });
    }
    await deleteTencentExmailCredentials(appAuth.supabase, normalizedId);
    const accounts = await removeStoredMailAccount(appAuth.supabase, appAuth.user.id, normalizedId);
    return NextResponse.json({ success: true, data: { accounts } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '断开腾讯企业邮箱失败。' },
      { status: 500 },
    );
  }
}
