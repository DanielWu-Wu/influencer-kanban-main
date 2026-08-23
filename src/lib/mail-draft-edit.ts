import { textToEmailHtml } from './email-content';
import type { MailProvider } from './mail-accounts';
import type { GmailAttachment, GmailMessage, GmailThread } from './types';

export type MailRecipient = {
  name?: string;
  email: string;
};

export type EditableInlineImage = {
  id: string;
  contentId: string;
  filename: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
};

export type EditableMailDraft = {
  provider: MailProvider;
  mailAccountId: string;
  messageId: string;
  folderRef?: string;
  providerMessageRef?: string;
  to: MailRecipient[];
  cc: MailRecipient[];
  bcc: MailRecipient[];
  subject: string;
  content: string;
  attachments: GmailAttachment[];
  inlineImages: EditableInlineImage[];
};

function splitAddressList(value: string) {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  let angleDepth = 0;
  for (const character of value) {
    if (character === '"') quoted = !quoted;
    if (!quoted && character === '<') angleDepth += 1;
    if (!quoted && character === '>' && angleDepth > 0) angleDepth -= 1;
    if (!quoted && angleDepth === 0 && (character === ',' || character === ';' || character === '\n')) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

export function parseMailRecipients(value: string): MailRecipient[] {
  return splitAddressList(value).map((token) => {
    const angleMatch = token.match(/^(.*?)<([^<>]+)>\s*$/);
    if (!angleMatch) return { email: token.trim() };
    const name = angleMatch[1].trim().replace(/^"|"$/g, '').trim();
    return { name: name || undefined, email: angleMatch[2].trim() };
  });
}

export function isValidMailRecipient(recipient: MailRecipient) {
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(recipient.email.trim());
}

export function formatMailRecipient(recipient: MailRecipient) {
  const email = recipient.email.replace(/[\r\n<>]/g, '').trim();
  const name = recipient.name?.replace(/[\r\n]/g, ' ').trim();
  if (!name) return email;
  return `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>`;
}

export function formatMailRecipients(recipients: MailRecipient[]) {
  return recipients.map(formatMailRecipient).join(', ');
}

export function getEditableMailDraft(
  thread: GmailThread,
  provider: MailProvider,
  mailAccountId: string,
) {
  const draftMessage = [...thread.messages]
    .reverse()
    .find((message) => message.labels.includes('DRAFT')) as GmailMessage | undefined;
  if (!draftMessage) return null;

  const inlineImages = (draftMessage.attachments || [])
    .filter((attachment) => attachment.inline)
    .map((attachment) => ({
      id: attachment.id,
      contentId: (attachment.contentId || '').replace(/^<|>$/g, ''),
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      dataUrl: attachment.dataUrl,
    }));

  return {
    provider,
    mailAccountId,
    messageId: draftMessage.id,
    folderRef: draftMessage.folderRef,
    providerMessageRef: draftMessage.providerMessageRef,
    to: parseMailRecipients(draftMessage.to),
    cc: parseMailRecipients(draftMessage.cc || ''),
    bcc: parseMailRecipients(draftMessage.bcc || ''),
    subject: draftMessage.subject,
    content: draftMessage.htmlBody || textToEmailHtml(draftMessage.body),
    attachments: (draftMessage.attachments || []).filter((attachment) => !attachment.inline),
    inlineImages,
  } satisfies EditableMailDraft;
}
