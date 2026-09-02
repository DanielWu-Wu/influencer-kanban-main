import type { GmailThread } from './types';
import type { MailTranslationPrefetchCandidate } from './gmail-translation-prefetch';
import { normalizeMailTranslationText } from './mail-translation-body';

// 只使用本轮真实读取的正文；摘要或旧缓存不能冒充当前原文。
export function buildDailyMailPreview(
  target: Pick<MailTranslationPrefetchCandidate, 'provider' | 'mailAccountId' | 'messageId' | 'threadId'>,
  snapshots: MailTranslationPrefetchCandidate[],
): GmailThread | undefined {
  const message = snapshots.find((item) => item.provider === target.provider
    && item.mailAccountId === target.mailAccountId && item.messageId === target.messageId
    && item.threadId === target.threadId);
  if (!message?.body.trim()) return undefined;
  return {
    id: message.threadId, provider: message.provider, mailAccountId: message.mailAccountId,
    folderRef: message.folderRef, subject: message.subject, snippet: '', isPartial: true,
    participantCount: 0, lastMessageDate: message.date, hasUnread: false, labels: [], isStarred: false,
    messages: [{
      id: message.messageId, threadId: message.threadId, provider: message.provider,
      mailAccountId: message.mailAccountId, from: message.from, to: message.mailAddress,
      subject: message.subject, body: normalizeMailTranslationText(message.body), snippet: '',
      date: message.date, isRead: true, labels: [], hasAttachments: false,
      folderRef: message.folderRef, providerMessageRef: message.providerMessageRef,
      rfcMessageId: message.rfcMessageId, inReplyTo: message.inReplyTo, references: message.references,
    }],
  };
}
