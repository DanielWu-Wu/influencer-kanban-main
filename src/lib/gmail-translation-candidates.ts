import { containsIgnoredGmailContactEmail } from '@/lib/gmail-thread-contact';
import { resolveLatestGmailAnswerAt } from '@/lib/daily-gmail-todos';

export type GmailTranslationCandidateMessage = {
  id: string;
  threadId: string;
  labelIds: string[];
  from: string;
  date: string;
  automated: boolean;
  deliveryFailure: boolean;
  subject: string;
  body: string;
  snippet: string;
};

export function selectLatestGmailTranslationCandidate<T extends GmailTranslationCandidateMessage>(
  messages: T[],
): T | undefined {
  const externalMessages = messages
    .filter((message) => (
      !message.labelIds.includes('SENT')
      && !message.automated
      && !message.deliveryFailure
      && !containsIgnoredGmailContactEmail(message.from)
    ))
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
  const latestIncoming = externalMessages[0];
  if (!latestIncoming || !latestIncoming.labelIds.includes('UNREAD')) return undefined;
  if (resolveLatestGmailAnswerAt(messages, latestIncoming.date)) return undefined;
  return latestIncoming;
}
