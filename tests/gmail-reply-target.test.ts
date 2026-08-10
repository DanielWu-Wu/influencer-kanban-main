import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGmailReplySubject,
  collectGmailThreadParticipants,
  getDefaultGmailReplyMessage,
  resolveGmailReplyTarget,
} from '../src/lib/gmail-reply-target';
import { scopeGmailAIMessagesToReplyTarget } from '../src/lib/gmail-ai-reply';
import type { GmailMessage, GmailThread } from '../src/lib/types';

function gmailMessage(id: string, overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id,
    threadId: 'thread-1',
    from: 'Creator <creator@example.com>',
    to: 'Me <me@example.com>',
    subject: '合作沟通',
    snippet: '',
    body: `正文 ${id}`,
    date: new Date(`2026-08-${String(Number(id.replace(/\D/g, '')) || 1).padStart(2, '0')}T08:00:00Z`).toISOString(),
    isRead: true,
    labels: ['INBOX'],
    hasAttachments: false,
    rfcMessageId: `<${id}@example.com>`,
    ...overrides,
  };
}

function gmailThread(messages: GmailMessage[]): GmailThread {
  return {
    id: 'thread-1',
    subject: messages.at(-1)?.subject || '合作沟通',
    snippet: '',
    messages,
    participantCount: 0,
    lastMessageDate: messages.at(-1)?.date || '',
    hasUnread: false,
    labels: [],
    isStarred: false,
  };
}

test('外部来信优先采用 Reply-To，且不依赖飞书匹配', () => {
  const thread = gmailThread([
    gmailMessage('1', { replyTo: 'Agent <agent@example.com>' }),
  ]);
  const target = resolveGmailReplyTarget({ thread, messageId: '1', ownEmail: 'me@example.com' });

  assert.equal(target?.direction, 'incoming');
  assert.equal(target?.recipientEmail, 'agent@example.com');
  assert.equal(target?.recipientConfirmed, true);
});

test('选择自己发送的邮件时，单一外部收件人自动确认', () => {
  const thread = gmailThread([
    gmailMessage('2', {
      from: 'Me <me@example.com>',
      to: 'Creator <creator@example.com>',
      labels: ['SENT'],
    }),
  ]);
  const target = resolveGmailReplyTarget({ thread, messageId: '2', ownEmail: 'me@example.com' });

  assert.equal(target?.direction, 'outgoing');
  assert.equal(target?.recipientEmail, 'creator@example.com');
});

test('选择自己发送的多收件人邮件时不擅自决定回复对象', () => {
  const thread = gmailThread([
    gmailMessage('3', {
      from: 'Me <me@example.com>',
      to: 'Creator <creator@example.com>, Colleague <colleague@example.com>',
      cc: 'Manager <manager@example.com>',
      labels: ['SENT'],
    }),
  ]);
  const target = resolveGmailReplyTarget({ thread, messageId: '3', ownEmail: 'me@example.com' });

  assert.equal(target?.recipientEmail, '');
  assert.deepEqual(
    target?.recipientCandidates.map((candidate) => candidate.email),
    ['creator@example.com', 'colleague@example.com', 'manager@example.com'],
  );
});

test('飞书邮箱只作为建议，手动选择后才成为最终收件人', () => {
  const thread = gmailThread([
    gmailMessage('4', {
      from: 'Me <me@example.com>',
      to: 'me@example.com',
      labels: ['SENT'],
    }),
  ]);
  const suggested = resolveGmailReplyTarget({
    thread,
    messageId: '4',
    ownEmail: 'me@example.com',
    suggestedCreatorEmail: 'creator@example.com',
  });
  const selected = resolveGmailReplyTarget({
    thread,
    messageId: '4',
    ownEmail: 'me@example.com',
    selectedRecipient: 'creator@example.com',
    suggestedCreatorEmail: 'creator@example.com',
  });

  assert.equal(suggested?.recipientEmail, '');
  assert.equal(suggested?.recipientCandidates[0]?.source, 'feishu');
  assert.equal(selected?.recipientEmail, 'creator@example.com');
  assert.equal(selected?.manuallySelected, true);
});

test('默认选中最新非系统邮件，但系统通知仍可被用户显式选为上下文', () => {
  const normal = gmailMessage('5');
  const notification = gmailMessage('6', { from: 'notification@mailsuite.com' });
  const thread = gmailThread([normal, notification]);

  assert.equal(getDefaultGmailReplyMessage(thread)?.id, '5');
  assert.equal(resolveGmailReplyTarget({ thread, messageId: '6', ownEmail: 'me@example.com' })?.messageId, '6');
});

test('参与者汇总覆盖 From、To、Cc、Bcc 并标明可靠角色', () => {
  const thread = gmailThread([
    gmailMessage('7', {
      to: 'Me <me@example.com>, Creator Two <creator2@example.com>',
      cc: 'Colleague <colleague@example.com>',
      bcc: 'Hidden <hidden@example.com>',
    }),
  ]);
  const participants = collectGmailThreadParticipants(
    thread,
    'me@example.com',
    'creator@example.com',
  );

  assert.equal(participants.length, 5);
  assert.equal(participants.find((item) => item.email === 'me@example.com')?.role, 'account');
  assert.equal(participants.find((item) => item.email === 'creator@example.com')?.role, 'creator');
  assert.ok(participants.find((item) => item.email === 'hidden@example.com')?.headers.includes('bcc'));
});

test('AI 上下文保留所选内部转发并排除该节点之后的邮件', () => {
  const messages = [
    gmailMessage('8', { date: '2026-08-08T08:00:00Z' }),
    gmailMessage('9', {
      date: '2026-08-09T08:00:00Z',
      from: 'Me <me@example.com>',
      to: 'Colleague <colleague@example.com>',
      subject: 'Fwd: 合作沟通',
      labels: ['SENT'],
    }),
    gmailMessage('10', { date: '2026-08-10T08:00:00Z' }),
  ];
  const scoped = scopeGmailAIMessagesToReplyTarget(messages, '9', messages[1].date);

  assert.deepEqual(scoped.map((message) => message.id), ['8', '9']);
  const target = resolveGmailReplyTarget({
    thread: gmailThread(messages),
    messageId: '8',
    ownEmail: 'me@example.com',
  });
  assert.equal(target ? buildGmailReplySubject(target) : '', 'Re: 合作沟通');
});
