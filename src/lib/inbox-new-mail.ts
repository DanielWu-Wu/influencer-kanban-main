import type { GmailMessage, GmailThread } from './types';
import type { MailProvider } from './mail-accounts';
import { normalizeThreadContactEmail, containsIgnoredGmailContactEmail } from './gmail-thread-contact';
import { resolveMailTranslationBody } from './mail-translation-body';
import type { MailTranslationPrefetchCandidate } from './gmail-translation-prefetch';

export const INBOX_NEW_MAIL_SNAPSHOT_EVENT = 'inbox-new-mail-snapshot';
export type InboxMailSnapshot = {
  accountScope: string;
  mailAccountId: string;
  mailAddress: string;
  provider: MailProvider;
  threads: GmailThread[];
  loadThread: (thread: GmailThread, message: GmailMessage) => Promise<GmailThread>;
};

export function hasAutomaticMailHeaders(autoSubmitted = '', precedence = '') {
  return Boolean(autoSubmitted.trim() && !/^no$/i.test(autoSubmitted.trim()))
    || /^(bulk|junk|list|auto_reply)$/i.test(precedence.trim());
}

export function latestUnansweredIncoming(thread: GmailThread, ownAddress: string) {
  const sorted = [...thread.messages].filter((message) => !message.labels.includes('DRAFT'))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const latest = sorted[0];
  if (!latest || latest.isRead || latest.labels.includes('SENT')
    || normalizeThreadContactEmail(latest.from) === ownAddress.trim().toLowerCase()
    || latest.automated || containsIgnoredGmailContactEmail(latest.from)
    || /automatic reply|auto.?reply|out of office|vacation|自动回复|mailer-daemon|postmaster|delivery status notification|undeliverable|delivery fail|退信|投递失败/i.test(`${latest.from} ${latest.subject}`)) return undefined;
  return latest;
}

/** First successful snapshot is a baseline, not a backlog translation request. */
export class InboxNewMailDetector {
  private scopes = new Map<string, { since: number; seen: Set<string> }>();

  observe(snapshot: InboxMailSnapshot, now = Date.now()) {
    const key = JSON.stringify([snapshot.accountScope, snapshot.provider, snapshot.mailAccountId]);
    const previous = this.scopes.get(key);
    const state = previous || { since: now, seen: new Set<string>() };
    const found: Array<{ thread: GmailThread; message: GmailMessage }> = [];
    for (const thread of snapshot.threads) {
      const message = latestUnansweredIncoming(thread, snapshot.mailAddress);
      if (previous && message && !state.seen.has(message.id)
        && Date.parse(message.date) >= state.since && Date.parse(message.date) <= now) {
        found.push({ thread, message });
      }
      thread.messages.forEach((item) => state.seen.add(item.id));
    }
    this.scopes.set(key, state);
    return found;
  }
}

export function publishInboxMailSnapshot(snapshot: InboxMailSnapshot) {
  window.dispatchEvent(new CustomEvent(INBOX_NEW_MAIL_SNAPSHOT_EVENT, { detail: snapshot }));
}

export async function resolveNewInboxMail(
  snapshot: InboxMailSnapshot,
  entry: { thread: GmailThread; message: GmailMessage },
  creatorEmails: Set<string>,
  isCurrent: () => boolean,
): Promise<MailTranslationPrefetchCandidate | undefined> {
  if (!isCurrent() || !creatorEmails.has(normalizeThreadContactEmail(entry.message.from))) return;
  const full = await snapshot.loadThread(entry.thread, entry.message);
  if (!isCurrent()) return;
  const incoming = latestUnansweredIncoming(full, snapshot.mailAddress);
  if (!incoming || incoming.id !== entry.message.id || !creatorEmails.has(normalizeThreadContactEmail(incoming.from))) return;
  const body = resolveMailTranslationBody(incoming.body, incoming.htmlBody);
  if (!body) return;
  return {
    provider: snapshot.provider, mailAccountId: snapshot.mailAccountId, mailAddress: snapshot.mailAddress,
    messageId: incoming.id, threadId: full.id, from: incoming.from, subject: incoming.subject,
    body, date: incoming.date, folderRef: incoming.folderRef, providerMessageRef: incoming.providerMessageRef,
    rfcMessageId: incoming.rfcMessageId, inReplyTo: incoming.inReplyTo, references: incoming.references,
  };
}
