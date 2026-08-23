import type { MailProvider } from './mail-accounts';
import { extractRfcMessageIds, groupStrictMailConversations } from './mail-conversation';

export type CooperationEmailHistoryCandidate = {
  id?: string;
  threadId?: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string;
  date?: string;
  folderRef?: string;
  providerMessageRef?: string;
  automated?: boolean;
  deliveryFailure?: boolean;
  labelIds?: string[];
  mimeType?: string;
  body?: string;
  snippet?: string;
};

export type CooperationConversation<T extends CooperationEmailHistoryCandidate> = {
  key: string;
  messages: T[];
};

export type CooperationConversationLocator = {
  threadRef?: string;
  messageRef: string;
  folderRef?: string;
  rfcMessageId?: string;
};

export function isGmailReactionMessage(message: CooperationEmailHistoryCandidate) {
  if (/^text\/x-gmail-reaction\b/i.test(message.mimeType || '')) return true;
  return /\breacted via Gmail\b/i.test(`${message.body || ''} ${message.snippet || ''}`);
}

export function getUsableCooperationEmailHistory<T extends CooperationEmailHistoryCandidate>(messages: T[]) {
  return messages.filter((message) => (
    !message.automated
    && !message.deliveryFailure
    && !message.labelIds?.includes('DRAFT')
    && !isGmailReactionMessage(message)
  ));
}

export function groupCooperationProjectConversations<T extends CooperationEmailHistoryCandidate>(
  messages: T[],
  provider: MailProvider,
  mailAccountId: string,
): CooperationConversation<T>[] {
  const usable = getUsableCooperationEmailHistory(messages);
  if (provider === 'gmail') {
    const byThread = new Map<string, T[]>();
    usable.forEach((message) => {
      const key = message.threadId || message.id || '';
      if (!key) return;
      byThread.set(key, [...(byThread.get(key) || []), message]);
    });
    return Array.from(byThread.entries()).map(([threadId, threadMessages]) => ({
      key: `gmail:${mailAccountId}:${threadId}`,
      messages: [...threadMessages].sort((left, right) => Date.parse(left.date || '') - Date.parse(right.date || '')),
    })).sort((left, right) => Date.parse(right.messages.at(-1)?.date || '') - Date.parse(left.messages.at(-1)?.date || ''));
  }

  return groupStrictMailConversations(usable.flatMap((message) => (
    message.id ? [{ ...message, id: message.id, mailAccountId }] : []
  ))).map((group) => ({
    key: `tencent_exmail:${mailAccountId}:${group.identity}`,
    messages: group.messages as T[],
  }));
}

export function findBoundCooperationConversation<T extends CooperationEmailHistoryCandidate>(
  candidates: CooperationConversation<T>[],
  locator: CooperationConversationLocator,
) {
  const locatorRfcId = extractRfcMessageIds(locator.rfcMessageId)[0];
  return candidates.find((candidate) => candidate.messages.some((message) => (
    (locator.threadRef && message.threadId === locator.threadRef)
    || (locator.messageRef === (message.providerMessageRef || message.id || '')
      && (!locator.folderRef || locator.folderRef === message.folderRef))
    || (locatorRfcId && extractRfcMessageIds(message.rfcMessageId).includes(locatorRfcId))
  ))) || null;
}
