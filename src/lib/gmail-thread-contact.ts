import type { GmailMessage, GmailThread } from './types';

const IGNORED_CONTACT_EMAILS = new Set([
  'notification@mailsuite.com',
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

export function isIgnoredGmailThreadSender(value?: string): boolean {
  const emails = extractThreadContactEmails(value);
  return emails.length > 0 && emails.every((email) => IGNORED_CONTACT_EMAILS.has(email));
}

function isEligibleContactEmail(email: string, ownEmail: string) {
  return Boolean(email && email !== ownEmail && !IGNORED_CONTACT_EMAILS.has(email));
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
    extractThreadContactEmails(thread.messages[index].to)
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
