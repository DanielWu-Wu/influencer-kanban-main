import type { MailAttachmentRef } from './mail-accounts';
import { getSupabaseBrowserClient } from './supabase/client';

export const MAIL_ATTACHMENT_BUCKET = 'mail-attachments-temp' as const;
export const MAX_OUTGOING_MAIL_ATTACHMENT_BYTES = 18 * 1024 * 1024;
export const MAX_INCOMING_MAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function safeFilename(value: string) {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'attachment';
}

export async function uploadMailAttachmentFiles(files: File[]) {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_OUTGOING_MAIL_ATTACHMENT_BYTES) {
    throw new Error('附件总大小不能超过 18 MB。');
  }
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error('Supabase 尚未配置，无法安全上传附件。');
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new Error('登录状态已失效，请重新登录。');
  const userId = userData.user.id;
  const uploaded: MailAttachmentRef[] = [];
  try {
    for (const file of files) {
      const path = `${userId}/${Date.now()}-${crypto.randomUUID()}-${safeFilename(file.name)}`;
      const { error } = await supabase.storage
        .from(MAIL_ATTACHMENT_BUCKET)
        .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (error) throw new Error(`附件“${file.name}”上传失败：${error.message}`);
      uploaded.push({
        bucket: MAIL_ATTACHMENT_BUCKET,
        path,
        filename: safeFilename(file.name),
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      });
    }
    return uploaded;
  } catch (error) {
    if (uploaded.length) {
      await supabase.storage.from(MAIL_ATTACHMENT_BUCKET).remove(uploaded.map((item) => item.path));
    }
    throw error;
  }
}

export async function removeMailAttachmentRefs(refs: MailAttachmentRef[]) {
  if (!refs.length) return;
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  await supabase.storage.from(MAIL_ATTACHMENT_BUCKET).remove(refs.map((item) => item.path));
}

export function parseMailAttachmentRefs(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<MailAttachmentRef>;
    if (
      candidate.bucket !== MAIL_ATTACHMENT_BUCKET
      || typeof candidate.path !== 'string'
      || typeof candidate.filename !== 'string'
      || typeof candidate.mimeType !== 'string'
      || typeof candidate.size !== 'number'
      || candidate.size < 0
    ) return [];
    return [candidate as MailAttachmentRef];
  });
}
