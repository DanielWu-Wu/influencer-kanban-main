import type { GmailMessage, GmailThread } from './types';

const IGNORED_CONTACT_EMAILS = new Set([
  'notification@mailsuite.com',
]);

const IGNORED_NOTIFICATION_DOMAINS = new Set([
  'mailsuite.com',
  'mailtrack.io',
]);

const IGNORED_NOTIFICATION_LOCAL_PARTS = new Set([
  'notification',
  'notifications',
  'no-reply',
  'noreply',
]);

export function normalizeThreadContactEmail(value?: string): string {
  const email = value?.match(/<([^>]+)>/)?.[1] || value || '';
  return email.trim().replace(/^mailto:/i, '').toLowerCase();
}

function extractThreadContactEmails(value?: string): string[] {
  const raw = value || '';
  const matches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (matches?.length) {
    return matches.map(normalizeThreadContactEmail).filter(Boolean);
  }
  return raw
    .split(',')
    .map(normalizeThreadContactEmail)
    .filter(Boolean);
}

export function isIgnoredGmailContactEmail(value?: string): boolean {
  const email = normalizeThreadContactEmail(value);
  if (!email) return false;
  if (IGNORED_CONTACT_EMAILS.has(email)) return true;

  const separatorIndex = email.lastIndexOf('@');
  if (separatorIndex <= 0) return false;
  const localPart = email.slice(0, separatorIndex);
  const domain = email.slice(separatorIndex + 1);
  return (
    IGNORED_NOTIFICATION_DOMAINS.has(domain)
    && IGNORED_NOTIFICATION_LOCAL_PARTS.has(localPart)
  );
}

export function containsIgnoredGmailContactEmail(value?: string): boolean {
  return extractThreadContactEmails(value).some(isIgnoredGmailContactEmail);
}

export function isIgnoredGmailThreadSender(value?: string): boolean {
  const emails = extractThreadContactEmails(value);
  return emails.length > 0 && emails.every(isIgnoredGmailContactEmail);
}

function isEligibleContactEmail(email: string, ownEmail: string) {
  return Boolean(email && email !== ownEmail && !isIgnoredGmailContactEmail(email));
}

export type GmailThreadContact = {
  message?: GmailMessage;
  emails: string[];
};

export function getGmailThreadContact(
  thread: GmailThread,
  ownEmail?: string,
): GmailThreadContact {
  const normalizedOwnEmail = normalizeThreadContactEmail(ownEmail);
  const senderEmails: string[] = [];
  const recipientEmails: string[] = [];
  const seenSenders = new Set<string>();
  const seenRecipients = new Set<string>();
  let message: GmailMessage | undefined;

  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const candidateMessage = thread.messages[index];
    const isSentMessage = candidateMessage.labels.includes('SENT');
    if (isSentMessage) continue;
    const eligibleSenders = extractThreadContactEmails(candidateMessage.from)
      .filter((email) => isEligibleContactEmail(email, normalizedOwnEmail));

    if (!message && eligibleSenders.length) message = candidateMessage;
    eligibleSenders.forEach((email) => {
      if (seenSenders.has(email)) return;
      seenSenders.add(email);
      senderEmails.push(email);
    });
  }

  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const candidateMessage = thread.messages[index];
    const senderEmails = extractThreadContactEmails(candidateMessage.from);
    const isSentMessage = candidateMessage.labels.includes('SENT');
    const isSentByKnownAccount = Boolean(
      normalizedOwnEmail && senderEmails.includes(normalizedOwnEmail),
    );
    if (!isSentMessage && !isSentByKnownAccount) continue;

    extractThreadContactEmails(candidateMessage.to)
      .filter((email) => isEligibleContactEmail(email, normalizedOwnEmail))
      .forEach((email) => {
        if (seenSenders.has(email) || seenRecipients.has(email)) return;
        seenRecipients.add(email);
        recipientEmails.push(email);
      });
  }

  return {
    message,
    emails: [...senderEmails, ...recipientEmails],
  };
}
