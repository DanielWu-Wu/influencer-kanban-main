export const DAILY_GMAIL_LOOKBACK_HOURS = 72;

const HOUR_MS = 60 * 60 * 1000;

export function isWithinDailyGmailWindow(
  dateValue: string,
  now: number = Date.now(),
) {
  const timestamp = Date.parse(dateValue);
  if (Number.isNaN(timestamp)) return false;

  const age = now - timestamp;
  return age >= 0 && age <= DAILY_GMAIL_LOOKBACK_HOURS * HOUR_MS;
}

export function getDailyGmailTaskKey(threadId: string, messageId: string) {
  return threadId.trim() || messageId.trim();
}

export function resolveLatestGmailAnswerAt(
  messages: Array<{ date: string; labelIds: string[] }>,
  latestIncomingDate: string,
) {
  const latestIncomingAt = Date.parse(latestIncomingDate);
  if (Number.isNaN(latestIncomingAt)) return undefined;

  return messages
    .filter((message) => (
      message.labelIds.includes('SENT')
      && !message.labelIds.includes('DRAFT')
      && Date.parse(message.date) > latestIncomingAt
    ))
    .sort((left, right) => Date.parse(right.date) - Date.parse(left.date))[0]?.date;
}

export function resolveIncomingGmailCompletedAt(
  existing: { messageId: string; completedAt?: string; answeredAt?: string } | undefined,
  incoming: { messageId: string; date: string; answeredAt?: string },
  legacyCompletedAt?: string,
) {
  const incomingTimestamp = Date.parse(incoming.date);
  const answeredTimestamp = Date.parse(incoming.answeredAt || '');
  if (
    !Number.isNaN(incomingTimestamp)
    && !Number.isNaN(answeredTimestamp)
    && answeredTimestamp > incomingTimestamp
  ) {
    return incoming.answeredAt;
  }

  if (!existing) return legacyCompletedAt;
  if (existing.answeredAt && existing.completedAt === existing.answeredAt) return undefined;
  if (!existing.completedAt) return undefined;
  if (existing.messageId === incoming.messageId) return existing.completedAt;

  const completedTimestamp = Date.parse(existing.completedAt);
  if (!Number.isNaN(incomingTimestamp) && !Number.isNaN(completedTimestamp) && incomingTimestamp > completedTimestamp) {
    return undefined;
  }
  return existing.completedAt;
}

export function isCompletedToday(completedAt: string | undefined, now: number = Date.now()) {
  if (!completedAt) return false;
  const completedDate = new Date(completedAt);
  if (Number.isNaN(completedDate.getTime())) return false;
  const today = new Date(now);
  return completedDate.getFullYear() === today.getFullYear()
    && completedDate.getMonth() === today.getMonth()
    && completedDate.getDate() === today.getDate();
}
