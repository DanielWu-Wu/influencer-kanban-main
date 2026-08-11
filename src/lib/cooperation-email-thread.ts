export type CooperationEmailHistoryCandidate = {
  automated?: boolean;
  deliveryFailure?: boolean;
  labelIds?: string[];
  mimeType?: string;
  body?: string;
  snippet?: string;
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
