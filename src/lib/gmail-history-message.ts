import { repairTextEncoding } from './email-text';
import { readGmailMessageBody } from './mail-translation-body';
import { mailTimestampToIso, resolveGmailMessageTimestamp } from './mail-message-time';
import { classifyFollowUpConversation } from './outreach-follow-up';

export function parseSharedGmailMessage(message: Record<string, unknown>) {
  const payload = (message.payload || {}) as Record<string, unknown>;
  const headers = (payload.headers || []) as Array<{ name: string; value: string }>;
  const header = (name: string) => headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds.map((label) => String(label || '')) : [];
  const subject = header('Subject');
  const from = header('From');
  return {
    id: String(message.id || ''), threadId: String(message.threadId || ''), labelIds,
    mimeType: String(payload.mimeType || ''),
    rfcMessageId: header('Message-ID'), inReplyTo: header('In-Reply-To'), references: header('References'),
    subject: subject || '无主题', from, to: header('To'), cc: header('Cc'), bcc: header('Bcc'), replyTo: header('Reply-To'),
    date: mailTimestampToIso(resolveGmailMessageTimestamp({ headers, internalDate: message.internalDate, labelIds })),
    snippet: repairTextEncoding(String(message.snippet || '')), body: readGmailMessageBody(payload).body,
    automated: Boolean(header('Auto-Submitted') && header('Auto-Submitted').toLowerCase() !== 'no')
      || ['bulk', 'junk', 'list', 'auto_reply'].includes(header('Precedence').toLowerCase())
      || /(automatic reply|auto[- ]?reply|out of office|autoreply|vacation reply|自动回复)/i.test(`${subject} ${from}`),
    deliveryFailure: /(mailer-daemon|postmaster|delivery status notification|undeliverable|delivery failed|delivery failure|地址不存在|投递失败)/i.test(`${subject} ${from}`),
  };
}

export function classifySharedGmailFollowUp(messages: ReturnType<typeof parseSharedGmailMessage>[], contact: string, sentAt: number) {
  const address = (value: string) => value.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase()
    || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() || '';
  const timeline = messages.filter((m) => Date.parse(m.date) >= sentAt).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const outbound = timeline.filter((m) => m.labelIds.includes('SENT') && !m.labelIds.includes('DRAFT')
    && address(m.from) !== contact && m.to.toLowerCase().includes(contact));
  const incoming = timeline.filter((m) => address(m.from) === contact);
  const classified = classifyFollowUpConversation(outbound, incoming.filter((m) => !m.automated && !m.deliveryFailure));
  return {
    outbound: classified.outboundBeforeReply.slice(0, 3), reply: classified.humanRepliesAfterOutreach.at(-1) || null,
    automatedReply: incoming.filter((m) => m.automated && !m.deliveryFailure).at(-1) || null,
    deliveryFailure: timeline.filter((m) => m.deliveryFailure).at(-1) || null,
  };
}
