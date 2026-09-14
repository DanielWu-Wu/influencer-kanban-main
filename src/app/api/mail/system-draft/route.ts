import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/supabase/server';
import { isMailReplyDraftIdentity, isMailReplySystemDraft, mailReplyDraftIdentityKey, MAX_SYSTEM_DRAFT_BYTES } from '@/lib/mail-reply-draft';

// System-only storage. Never calls a mail provider, creates a mailbox draft or sends mail.
export async function POST(request: NextRequest) {
  const account = await getRequestUser(request);
  if (!account) return NextResponse.json({ error: '请重新登录。' }, { status: 403 });
  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_SYSTEM_DRAFT_BYTES) {
    return NextResponse.json({ error: '系统草稿内容及附件过大（上限 3 MB），未保存。请减少附件后重试。' }, { status: 413 });
  }
  let body;
  try { body = JSON.parse(raw); } catch {
    return NextResponse.json({ error: '草稿格式不正确。' }, { status: 400 });
  }
  if (!body || body.ownerId !== account.user.id || !['read', 'save'].includes(body.action) || !isMailReplyDraftIdentity(body.identity)) {
    return NextResponse.json({ error: '缺少有效的邮件身份。' }, { status: 400 });
  }
  const key = `mail_reply_system_draft_v1:${createHash('sha256').update(mailReplyDraftIdentityKey(body.identity)).digest('hex')}`;
  if (body.action === 'read') {
    const { data, error } = await account.supabase.from('user_data').select('data,updated_at')
      .eq('user_id', account.user.id).eq('data_key', key).maybeSingle();
    if (error) return NextResponse.json({ error: '系统草稿读取失败，请重试。' }, { status: 500 });
    return NextResponse.json({ success: true, draft: data?.data ?? null, savedAt: data?.updated_at ?? null });
  }
  if (!isMailReplySystemDraft(body.draft)
    || mailReplyDraftIdentityKey(body.identity) !== mailReplyDraftIdentityKey(body.draft.identity)) {
    return NextResponse.json({ error: '系统草稿内容或邮件身份不正确。' }, { status: 400 });
  }
  const savedAt = new Date().toISOString();
  const { error } = await account.supabase.from('user_data').upsert({
    user_id: account.user.id, data_key: key, data: body.draft, updated_at: savedAt,
  });
  if (error) return NextResponse.json({ error: '系统草稿保存失败，编辑内容仍保留，请重试。' }, { status: 500 });
  return NextResponse.json({ success: true, savedAt });
}
