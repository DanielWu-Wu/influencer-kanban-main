import type { MailAccount, MailDraftLocator } from './mail-accounts';
import { sharedMailFetch as fetch } from './shared-mail-read';
import type { EditableInlineImage } from './mail-draft-edit';
import {
  removeMailAttachmentRefs,
  uploadMailAttachmentFiles,
} from './mail-attachment-storage';

export type TencentOutgoingContent = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: File[];
  inlineImages?: EditableInlineImage[];
};

function inlineImagePayload(image: EditableInlineImage) {
  const dataUrl = image.dataUrl || '';
  const commaIndex = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || commaIndex < 0 || !/;base64$/i.test(dataUrl.slice(0, commaIndex))) {
    throw new Error(`内嵌图片内容不可用：${image.filename}`);
  }
  return {
    filename: image.filename,
    mimeType: image.mimeType,
    contentId: image.contentId,
    data: dataUrl.slice(commaIndex + 1).replace(/\s/g, ''),
  };
}

async function postTencentMail(
  account: MailAccount,
  action: 'draft' | 'send',
  content: TencentOutgoingContent,
  options: { previousDraft?: MailDraftLocator; messageId?: string; signal?: AbortSignal } = {},
) {
  const attachmentRefs = content.attachments?.length
    ? await uploadMailAttachmentFiles(content.attachments)
    : [];
  try {
    const response = await fetch('/api/mail/tencent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify({
        action,
        mailAccountId: account.mailAccountId,
        to: content.to,
        cc: content.cc,
        bcc: content.bcc,
        subject: content.subject,
        html: content.html,
        text: content.text,
        inReplyTo: content.inReplyTo,
        references: content.references,
        attachments: attachmentRefs,
        inlineImages: content.inlineImages?.map(inlineImagePayload),
        messageId: options.messageId,
        previousDraft: options.previousDraft
          ? {
              folderRef: options.previousDraft.folderRef,
              providerMessageRef: options.previousDraft.providerMessageRef,
            }
          : undefined,
      }),
    });
    const result = await response.json().catch(() => ({})) as {
      success?: boolean;
      data?: Record<string, unknown>;
      error?: string;
    };
    if (!response.ok || !result.success) throw new Error(result.error || '腾讯企业邮箱操作失败。');
    return result.data || {};
  } catch (error) {
    if (attachmentRefs.length) await removeMailAttachmentRefs(attachmentRefs);
    throw error;
  }
}

export async function saveTencentMailDraft(
  account: MailAccount,
  content: TencentOutgoingContent,
  previousDraft?: MailDraftLocator,
) {
  const data = await postTencentMail(account, 'draft', content, { previousDraft });
  const draftRef = String(data.draftRef || '');
  if (!draftRef) throw new Error('腾讯企业邮箱没有返回草稿编号。');
  return {
    provider: 'tencent_exmail' as const,
    mailAccountId: account.mailAccountId,
    draftRef,
    folderRef: String(data.folderRef || '') || undefined,
    providerMessageRef: String(data.uid || '') || undefined,
    cleanupWarning: String(data.cleanupWarning || '') || undefined,
  } satisfies MailDraftLocator & { cleanupWarning?: string };
}

export async function sendTencentMailNow(
  account: MailAccount,
  content: TencentOutgoingContent,
  options: { messageId: string; signal: AbortSignal },
) {
  return postTencentMail(account, 'send', content, options);
}

export function createTencentClientMessageId(email: string) {
  const domain = email.split('@')[1] || 'exmail.local';
  return `<${crypto.randomUUID()}@${domain}>`;
}

export async function verifyTencentSmtp(account: MailAccount, signal?: AbortSignal) {
  const response = await fetch('/api/mail/tencent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      action: 'verifySmtp',
      mailAccountId: account.mailAccountId,
    }),
  });
  const result = await response.json().catch(() => ({})) as {
    success?: boolean;
    data?: { account?: MailAccount };
    error?: string;
  };
  if (!response.ok || !result.success) {
    throw new Error(result.error || '腾讯企业邮箱 SMTP 验证失败，请检查授权密码。');
  }
  return result.data?.account;
}
