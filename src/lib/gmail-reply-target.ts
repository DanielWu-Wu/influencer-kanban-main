import { isIgnoredGmailContactEmail, isIgnoredGmailThreadSender } from './gmail-thread-contact';
import type { GmailMessage, GmailThread } from './types';

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export type GmailAddress = {
  email: string;
  name: string;
};

export type GmailReplyRecipientCandidate = GmailAddress & {
  source: 'reply-to' | 'from' | 'to' | 'cc' | 'feishu' | 'manual';
};

export type GmailReplyTarget = {
  message: GmailMessage;
  messageId: string;
  threadId: string;
  subject: string;
  date: string;
  direction: 'incoming' | 'outgoing';
  recipientCandidates: GmailReplyRecipientCandidate[];
  recipientEmail: string;
  recipientConfirmed: boolean;
  manuallySelected: boolean;
};

export type GmailThreadParticipant = GmailAddress & {
  role: 'account' | 'creator' | 'contact';
  headers: Array<'from' | 'to' | 'cc' | 'bcc' | 'reply-to'>;
};

export type GmailReplyAnchorState = {
  messageId: string;
  manuallySelected: boolean;
};

function normalizeEmail(value?: string) {
  return String(value || '').trim().replace(/^mailto:/i, '').toLowerCase();
}

function isValidEmail(value?: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function fallbackName(email: string) {
  return email.split('@')[0] || email;
}

export function parseGmailAddresses(value?: string): GmailAddress[] {
  const raw = String(value || '');
  const matches = [...raw.matchAll(new RegExp(EMAIL_PATTERN.source, 'gi'))];
  const seen = new Set<string>();

  return matches.flatMap((match) => {
    const email = normalizeEmail(match[0]);
    if (!email || seen.has(email)) return [];
    seen.add(email);
    const matchIndex = match.index || 0;
    const prefixStart = Math.max(
      raw.lastIndexOf(',', matchIndex - 1),
      raw.lastIndexOf(';', matchIndex - 1),
    ) + 1;
    const rawName = raw
      .slice(prefixStart, matchIndex)
      .replace(/[<>"']/g, '')
      .trim();
    const name = rawName && !rawName.includes('@') ? rawName : fallbackName(email);
    return [{ email, name }];
  });
}

function isOwnMessage(message: GmailMessage, ownEmail?: string) {
  const normalizedOwn = normalizeEmail(ownEmail);
  return message.labels.includes('SENT')
    || Boolean(normalizedOwn && parseGmailAddresses(message.from).some((address) => address.email === normalizedOwn));
}

function eligibleAddresses(value: string | undefined, ownEmail?: string) {
  const normalizedOwn = normalizeEmail(ownEmail);
  return parseGmailAddresses(value).filter((address) => (
    address.email !== normalizedOwn && !isIgnoredGmailContactEmail(address.email)
  ));
}

function addCandidate(
  target: GmailReplyRecipientCandidate[],
  seen: Set<string>,
  address: GmailAddress,
  source: GmailReplyRecipientCandidate['source'],
) {
  if (seen.has(address.email)) return;
  seen.add(address.email);
  target.push({ ...address, source });
}

export function getDefaultGmailReplyMessage(thread: GmailThread) {
  const chronological = [...thread.messages].sort(
    (left, right) => Date.parse(left.date || '') - Date.parse(right.date || ''),
  );
  return [...chronological]
    .reverse()
    .find((message) => !isIgnoredGmailThreadSender(message.from))
    || chronological.at(-1);
}

export function resolveGmailReplyAnchorState({
  thread,
  currentMessageId,
  defaultMessageId,
  manuallySelected,
  scopeChanged,
}: {
  thread: Pick<GmailThread, 'messages'>;
  currentMessageId: string;
  defaultMessageId: string;
  manuallySelected: boolean;
  scopeChanged: boolean;
}): GmailReplyAnchorState {
  const currentMessageExists = Boolean(
    currentMessageId && thread.messages.some((message) => message.id === currentMessageId),
  );
  if (!scopeChanged && manuallySelected && currentMessageExists) {
    return { messageId: currentMessageId, manuallySelected: true };
  }
  return { messageId: defaultMessageId, manuallySelected: false };
}

export function resolveGmailReplyTarget({
  thread,
  messageId,
  ownEmail,
  selectedRecipient,
  suggestedCreatorEmail,
}: {
  thread: GmailThread;
  messageId?: string;
  ownEmail?: string;
  selectedRecipient?: string;
  suggestedCreatorEmail?: string;
}): GmailReplyTarget | null {
  const message = thread.messages.find((item) => item.id === messageId)
    || getDefaultGmailReplyMessage(thread);
  if (!message) return null;

  const outgoing = isOwnMessage(message, ownEmail);
  const primaryCandidates: GmailReplyRecipientCandidate[] = [];
  const candidates: GmailReplyRecipientCandidate[] = [];
  const seen = new Set<string>();
  const primaryValues: Array<[string | undefined, GmailReplyRecipientCandidate['source']]> = outgoing
    ? [[message.to, 'to'], [message.cc, 'cc']]
    : [[message.replyTo, 'reply-to'], [message.from, 'from']];

  primaryValues.forEach(([value, source]) => {
    eligibleAddresses(value, ownEmail).forEach((address) => {
      if (seen.has(address.email)) return;
      addCandidate(candidates, seen, address, source);
      primaryCandidates.push({ ...address, source });
    });
  });

  eligibleAddresses(suggestedCreatorEmail, ownEmail).forEach((address) => {
    addCandidate(candidates, seen, address, 'feishu');
  });

  const normalizedSelected = normalizeEmail(selectedRecipient);
  const validSelected = isValidEmail(normalizedSelected)
    && normalizedSelected !== normalizeEmail(ownEmail)
    && !isIgnoredGmailContactEmail(normalizedSelected);
  if (validSelected && !seen.has(normalizedSelected)) {
    addCandidate(candidates, seen, {
      email: normalizedSelected,
      name: fallbackName(normalizedSelected),
    }, 'manual');
  }

  const automaticRecipient = outgoing
    ? primaryCandidates.length === 1 ? primaryCandidates[0].email : ''
    : primaryCandidates[0]?.email || '';
  const recipientEmail = validSelected ? normalizedSelected : automaticRecipient;

  return {
    message,
    messageId: message.id,
    threadId: message.threadId,
    subject: message.subject || thread.subject || '无主题',
    date: message.date,
    direction: outgoing ? 'outgoing' : 'incoming',
    recipientCandidates: candidates,
    recipientEmail,
    recipientConfirmed: Boolean(recipientEmail),
    manuallySelected: Boolean(validSelected),
  };
}

export function collectGmailThreadParticipants(
  thread: Pick<GmailThread, 'messages'>,
  ownEmail?: string,
  creatorEmail?: string,
): GmailThreadParticipant[] {
  const byEmail = new Map<string, GmailThreadParticipant>();
  const normalizedOwn = normalizeEmail(ownEmail);
  const normalizedCreator = normalizeEmail(creatorEmail);
  const fields: Array<['from' | 'to' | 'cc' | 'bcc' | 'reply-to', keyof GmailMessage]> = [
    ['from', 'from'],
    ['to', 'to'],
    ['cc', 'cc'],
    ['bcc', 'bcc'],
    ['reply-to', 'replyTo'],
  ];

  thread.messages.forEach((message) => {
    fields.forEach(([header, key]) => {
      parseGmailAddresses(String(message[key] || '')).forEach((address) => {
        const existing = byEmail.get(address.email);
        if (existing) {
          if (!existing.headers.includes(header)) existing.headers.push(header);
          if (existing.name === fallbackName(existing.email) && address.name !== fallbackName(address.email)) {
            existing.name = address.name;
          }
          return;
        }
        byEmail.set(address.email, {
          ...address,
          role: address.email === normalizedOwn
            ? 'account'
            : address.email === normalizedCreator
              ? 'creator'
              : 'contact',
          headers: [header],
        });
      });
    });
  });

  return [...byEmail.values()];
}

export function formatGmailRecipientSummary(message: GmailMessage) {
  const to = parseGmailAddresses(message.to);
  const cc = parseGmailAddresses(message.cc);
  if (!to.length && !cc.length) return '未显示收件人';
  const names = to.map((address) => address.name || address.email);
  const visible = names.slice(0, 2).join('、');
  const remainder = Math.max(0, names.length - 2);
  const toText = visible
    ? `发给 ${visible}${remainder ? ` 等 ${names.length} 人` : ''}`
    : '未显示主收件人';
  return cc.length ? `${toText} · 抄送 ${cc.length} 人` : toText;
}

export function buildGmailReplySubject(target: GmailReplyTarget) {
  return /^re:/i.test(target.subject) ? target.subject : `Re: ${target.subject}`;
}

export function buildGmailReplyReferences(target: GmailReplyTarget) {
  return [target.message.references, target.message.rfcMessageId]
    .filter(Boolean)
    .join(' ');
}
