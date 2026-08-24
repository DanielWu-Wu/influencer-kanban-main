export const DAILY_GMAIL_LOOKBACK_HOURS = 72;
export const DAILY_MAIL_AUTO_REFRESH_MS = 5 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;

export function shouldRefreshDailyMail(
  lastSuccessfulRefreshAt: number,
  now: number = Date.now(),
  intervalMs: number = DAILY_MAIL_AUTO_REFRESH_MS,
) {
  if (!Number.isFinite(lastSuccessfulRefreshAt) || lastSuccessfulRefreshAt <= 0) return true;
  const elapsed = now - lastSuccessfulRefreshAt;
  return elapsed < 0 || elapsed >= intervalMs;
}

export function isWithinDailyGmailWindow(
  dateValue: string,
  now: number = Date.now(),
) {
  const timestamp = Date.parse(dateValue);
  if (Number.isNaN(timestamp)) return false;

  const age = now - timestamp;
  return age >= 0 && age <= DAILY_GMAIL_LOOKBACK_HOURS * HOUR_MS;
}

export function getDailyGmailTaskKey(
  threadId: string,
  messageId: string,
  mailAccountId?: string,
  provider?: 'gmail' | 'tencent_exmail',
  folderRef?: string,
  providerMessageRef?: string,
) {
  const messageKey = provider === 'tencent_exmail' && folderRef?.trim() && providerMessageRef?.trim()
    ? `${folderRef.trim()}::${providerMessageRef.trim()}`
    : threadId.trim() || messageId.trim();
  return mailAccountId?.trim()
    ? `${provider || 'gmail'}::${mailAccountId.trim()}::${messageKey}`
    : messageKey;
}

export type DailyMailCacheTask = {
  messageId: string;
  threadId: string;
  date: string;
  provider?: 'gmail' | 'tencent_exmail';
  mailAccountId?: string;
  mailAddress?: string;
  folderRef?: string;
  providerMessageRef?: string;
  completedAt?: string;
  answeredAt?: string;
  summary?: string;
};

function taskTimestamp(task: DailyMailCacheTask) {
  const timestamp = Date.parse(task.date);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function mergeDailyMailTasks<T extends DailyMailCacheTask>(existing: T, incoming: T): T {
  const incomingIsNewer = taskTimestamp(incoming) >= taskTimestamp(existing);
  const newest = incomingIsNewer ? incoming : existing;
  const older = incomingIsNewer ? existing : incoming;
  const inheritedCompletedAt = resolveIncomingGmailCompletedAt(
    older,
    newest,
  );
  const newestCompletedAt = Date.parse(newest.completedAt || '');
  const newestIncomingAt = Date.parse(newest.date);
  const hasCurrentCompletion = Boolean(
    newest.completedAt
    && (
      Number.isNaN(newestCompletedAt)
      || Number.isNaN(newestIncomingAt)
      || newestCompletedAt >= newestIncomingAt
    ),
  );

  return {
    ...older,
    ...newest,
    summary: newest.summary || older.summary,
    completedAt: hasCurrentCompletion ? newest.completedAt : inheritedCompletedAt,
  };
}

function sourcefulTaskKey(task: DailyMailCacheTask) {
  if (!task.provider || !task.mailAccountId) return '';
  return getDailyGmailTaskKey(
    task.threadId,
    task.messageId,
    task.mailAccountId,
    task.provider,
    task.folderRef,
    task.providerMessageRef,
  );
}

function hasExactLegacyIdentity(left: DailyMailCacheTask, right: DailyMailCacheTask) {
  return Boolean(
    (left.threadId.trim() && left.threadId.trim() === right.threadId.trim())
    || (left.messageId.trim() && left.messageId.trim() === right.messageId.trim()),
  );
}

/**
 * Rebuilds the persisted cache from real mailbox identities before it is rendered.
 * It deliberately never uses sender, subject, summary, or time proximity as identity.
 */
export function normalizeDailyMailTaskCache<T extends DailyMailCacheTask>(
  cache: Record<string, T>,
) {
  const normalized: Record<string, T> = {};
  const legacyTasks: T[] = [];

  Object.values(cache).forEach((task) => {
    if (!task || (!task.threadId?.trim() && !task.messageId?.trim())) return;
    const key = sourcefulTaskKey(task);
    if (!key) {
      legacyTasks.push(task);
      return;
    }
    normalized[key] = normalized[key]
      ? mergeDailyMailTasks(normalized[key], task)
      : task;
  });

  legacyTasks.forEach((legacyTask) => {
    const gmailMatches = Object.entries(normalized).filter(([, candidate]) => (
      candidate.provider === 'gmail' && hasExactLegacyIdentity(legacyTask, candidate)
    ));
    if (gmailMatches.length === 1) {
      const [key, candidate] = gmailMatches[0];
      normalized[key] = mergeDailyMailTasks(candidate, legacyTask);
      return;
    }

    const legacyKey = legacyTask.threadId.trim() || legacyTask.messageId.trim();
    normalized[legacyKey] = normalized[legacyKey]
      ? mergeDailyMailTasks(normalized[legacyKey], legacyTask)
      : legacyTask;
  });

  return normalized;
}

/** Builds the Gmail-only shape understood by the currently deployed pre-v3 page. */
export function buildLegacyCompatibleGmailTaskCache<T extends DailyMailCacheTask>(
  cache: Record<string, T>,
) {
  const legacyCache: Record<string, T> = {};
  Object.values(normalizeDailyMailTaskCache(cache)).forEach((task) => {
    if (task.provider === 'tencent_exmail') return;
    const key = task.threadId.trim() || task.messageId.trim();
    if (!key) return;
    legacyCache[key] = legacyCache[key]
      ? mergeDailyMailTasks(legacyCache[key], task)
      : task;
  });
  return legacyCache;
}

type LegacyDailyTaskComparable = {
  threadId: string;
  messageId: string;
  channelName: string;
  subject: string;
  summary: string;
};

export function findUniqueLegacyGmailTaskMatch<T extends LegacyDailyTaskComparable & { provider: 'gmail' | 'tencent_exmail' }>(
  legacyTask: LegacyDailyTaskComparable,
  candidates: T[],
) {
  const gmailCandidates = candidates.filter((candidate) => candidate.provider === 'gmail');
  const identityMatches = gmailCandidates.filter((candidate) => (
    (legacyTask.threadId.trim() && candidate.threadId === legacyTask.threadId)
    || (legacyTask.messageId.trim() && candidate.messageId === legacyTask.messageId)
  ));
  return identityMatches.length === 1 ? identityMatches[0] : undefined;
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

function normalizeMessageIds(value: unknown) {
  const matches = String(value || '').match(/<[^<>\s]+>|[^\s<>,]+@[^\s<>,]+/g) || [];
  return new Set(matches.map((item) => item.replace(/^<|>$/g, '').trim().toLowerCase()).filter(Boolean));
}

export function resolveLatestMatchingMailboxAnswerAt(
  messages: Array<{
    recipients: string[];
    date: string;
    inReplyTo?: string;
    references?: string;
  }>,
  incoming: {
    senderEmail: string;
    date: string;
    messageId?: string;
  },
) {
  const senderEmail = incoming.senderEmail.trim().toLowerCase();
  const incomingAt = Date.parse(incoming.date);
  const messageId = Array.from(normalizeMessageIds(incoming.messageId))[0];
  if (!senderEmail || !messageId || Number.isNaN(incomingAt)) return undefined;

  const latest = messages.reduce((latestAt, message) => {
    const sentAt = Date.parse(message.date);
    const addressedToSender = message.recipients.some(
      (recipient) => recipient.trim().toLowerCase() === senderEmail,
    );
    if (!addressedToSender || Number.isNaN(sentAt) || sentAt <= incomingAt) return latestAt;

    const relationIds = new Set([
      ...normalizeMessageIds(message.inReplyTo),
      ...normalizeMessageIds(message.references),
    ]);
    return relationIds.has(messageId)
      ? Math.max(latestAt, sentAt)
      : latestAt;
  }, 0);

  return latest ? new Date(latest).toISOString() : undefined;
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
