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
  if ('baseSavedAt' in body && body.baseSavedAt !== null
    && (typeof body.baseSavedAt !== 'string' || !Number.isFinite(Date.parse(body.baseSavedAt)))) {
    return NextResponse.json({ error: '草稿版本无效。' }, { status: 400 });
  }
  const savedAt = new Date(Math.max(Date.now(), (Date.parse(body.baseSavedAt || '') || 0) + 1)).toISOString();
  const values = {
    user_id: account.user.id, data_key: key, data: body.draft, updated_at: savedAt,
  };
  // Optimistic concurrency uses the existing updated_at column; no schema or permission changes.
  if ('baseSavedAt' in body) {
    const query = body.baseSavedAt === null
      ? account.supabase.from('user_data').insert(values)
      : account.supabase.from('user_data').update({ data: body.draft, updated_at: savedAt })
        .eq('user_id', account.user.id).eq('data_key', key).eq('updated_at', body.baseSavedAt);
    const { data, error } = await query.select('updated_at').maybeSingle();
    if (error?.code === '23505' || (!error && !data)) return NextResponse.json({ error: '另一页面已保存不同版本，未覆盖云端内容。' }, { status: 409 });
    if (error || !data) return NextResponse.json({ error: '自动保存失败，编辑内容仍保留，请重试。' }, { status: 500 });
    return NextResponse.json({ success: true, savedAt: data.updated_at });
  }
  const { error } = await account.supabase.from('user_data').upsert(values);
  if (error) return NextResponse.json({ error: '系统草稿保存失败，编辑内容仍保留，请重试。' }, { status: 500 });
  return NextResponse.json({ success: true, savedAt });
}
