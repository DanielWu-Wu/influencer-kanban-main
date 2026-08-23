import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MailAttachmentRef } from './mail-accounts';
import {
  MAIL_ATTACHMENT_BUCKET,
  MAX_INCOMING_MAIL_ATTACHMENT_BYTES,
  MAX_OUTGOING_MAIL_ATTACHMENT_BYTES,
} from './mail-attachment-storage';

const TEMP_ATTACHMENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function safeFilename(value: string) {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'attachment';
}

function ensureOwnedPath(userId: string, path: string) {
  if (!userId || !path.startsWith(`${userId}/`) || path.includes('..')) {
    throw new Error('附件不属于当前登录账号。');
  }
}

export async function downloadOwnedMailAttachments(
  supabase: SupabaseClient,
  userId: string,
  refs: MailAttachmentRef[],
) {
  const declaredTotal = refs.reduce((sum, item) => sum + item.size, 0);
  if (declaredTotal > MAX_OUTGOING_MAIL_ATTACHMENT_BYTES) {
    throw new Error('附件总大小不能超过 18 MB。');
  }
  const result: Array<{ filename: string; contentType: string; content: Buffer }> = [];
  let actualTotal = 0;
  for (const ref of refs) {
    ensureOwnedPath(userId, ref.path);
    const { data, error } = await supabase.storage.from(MAIL_ATTACHMENT_BUCKET).download(ref.path);
    if (error || !data) throw new Error(`无法读取附件“${ref.filename}”，请重新选择后再试。`);
    const content = Buffer.from(await data.arrayBuffer());
    actualTotal += content.length;
    if (actualTotal > MAX_OUTGOING_MAIL_ATTACHMENT_BYTES) {
      throw new Error('附件实际总大小超过 18 MB。');
    }
    result.push({ filename: safeFilename(ref.filename), contentType: ref.mimeType, content });
  }
  return result;
}

export async function deleteOwnedMailAttachments(
  supabase: SupabaseClient,
  userId: string,
  refs: MailAttachmentRef[],
) {
  const paths = refs.map((ref) => {
    ensureOwnedPath(userId, ref.path);
    return ref.path;
  });
  if (paths.length) await supabase.storage.from(MAIL_ATTACHMENT_BUCKET).remove(paths);
}

export async function cleanupExpiredMailAttachments(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase.storage.from(MAIL_ATTACHMENT_BUCKET).list(userId, {
    limit: 100,
    sortBy: { column: 'created_at', order: 'asc' },
  });
  if (error || !data?.length) return;
  const cutoff = Date.now() - TEMP_ATTACHMENT_MAX_AGE_MS;
  const paths = data.flatMap((item) => {
    const createdAt = Date.parse(item.created_at || '');
    return Number.isFinite(createdAt) && createdAt < cutoff ? [`${userId}/${item.name}`] : [];
  });
  if (paths.length) await supabase.storage.from(MAIL_ATTACHMENT_BUCKET).remove(paths);
}

export async function publishIncomingMailAttachment(options: {
  supabase: SupabaseClient;
  userId: string;
  filename: string;
  mimeType: string;
  content: Buffer;
}) {
  if (options.content.length > MAX_INCOMING_MAIL_ATTACHMENT_BYTES) {
    throw new Error('附件超过 25 MB，请前往腾讯企业邮箱客户端下载。');
  }
  const path = `${options.userId}/${Date.now()}-${crypto.randomUUID()}-${safeFilename(options.filename)}`;
  const { error } = await options.supabase.storage.from(MAIL_ATTACHMENT_BUCKET).upload(path, options.content, {
    contentType: options.mimeType || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`准备附件下载失败：${error.message}`);
  const { data, error: signedError } = await options.supabase.storage
    .from(MAIL_ATTACHMENT_BUCKET)
    .createSignedUrl(path, 5 * 60, { download: safeFilename(options.filename) });
  if (signedError || !data?.signedUrl) {
    await options.supabase.storage.from(MAIL_ATTACHMENT_BUCKET).remove([path]);
    throw new Error('生成附件下载链接失败。');
  }
  return { url: data.signedUrl, expiresIn: 300 };
}
