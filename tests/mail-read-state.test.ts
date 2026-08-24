import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectUnreadMailTargets,
  setMailMessagesReadState,
  shouldShowMailThreadUnreadStyle,
} from '../src/lib/mail-read-state';
import type { GmailMessage, GmailThread } from '../src/lib/types';

function message(overrides: Partial<GmailMessage>): GmailMessage {
  return {
    id: 'message-1',
    threadId: 'thread-1',
    from: 'creator@example.com',
    to: 'owner@example.com',
    subject: 'Subject',
    snippet: 'Snippet',
    body: 'Body',
    date: '2026-08-24T10:00:00.000Z',
    isRead: false,
    labels: ['INBOX', 'UNREAD'],
    hasAttachments: false,
    provider: 'tencent_exmail',
    mailAccountId: 'tencent:account-a',
    folderRef: 'INBOX',
    providerMessageRef: '1',
    ...overrides,
  };
}

function thread(messages: GmailMessage[]): GmailThread {
  return {
    id: 'thread-1',
    subject: 'Subject',
    snippet: 'Snippet',
    messages,
    participantCount: 2,
    lastMessageDate: '2026-08-24T10:00:00.000Z',
    hasUnread: messages.some((item) => !item.isRead),
    labels: ['INBOX', 'UNREAD'],
    isStarred: false,
    provider: 'tencent_exmail',
    mailAccountId: 'tencent:account-a',
  };
}

test('当前选中邮件不再使用未读蓝色背景，未选中的未读邮件保持蓝色', () => {
  assert.equal(shouldShowMailThreadUnreadStyle(true, true), false);
  assert.equal(shouldShowMailThreadUnreadStyle(true, false), true);
  assert.equal(shouldShowMailThreadUnreadStyle(false, false), false);
});

test('腾讯自动已读收集当前严格会话中所有可定位的未读真实邮件', () => {
  const current = thread([
    message({ id: 'inbox-1', providerMessageRef: '1' }),
    message({ id: 'inbox-2', providerMessageRef: '2' }),
    message({ id: 'read-1', providerMessageRef: '3', isRead: true, labels: ['INBOX'] }),
    message({ id: 'sent-1', providerMessageRef: '4', isRead: false, labels: ['SENT'], folderRef: 'Sent' }),
    message({ id: 'missing-1', providerMessageRef: undefined }),
    message({ id: 'duplicate-1', providerMessageRef: '2' }),
  ]);
  const result = collectUnreadMailTargets(current);
  assert.deepEqual(result.targets.map((target) => target.messageId), ['inbox-1', 'inbox-2', 'sent-1']);
  assert.deepEqual(result.unresolvedMessageIds, ['missing-1']);
});

test('腾讯多封未读邮件只应用成功结果，失败项继续保持未读', () => {
  const current = thread([
    message({ id: 'inbox-1', providerMessageRef: '1' }),
    message({ id: 'inbox-2', providerMessageRef: '2' }),
  ]);
  const partial = setMailMessagesReadState(current, ['inbox-1'], true);
  assert.equal(partial.messages[0].isRead, true);
  assert.equal(partial.messages[1].isRead, false);
  assert.equal(partial.hasUnread, true);
  assert.equal(partial.labels.includes('UNREAD'), true);

  const completed = setMailMessagesReadState(partial, ['inbox-2'], true);
  assert.equal(completed.hasUnread, false);
  assert.equal(completed.labels.includes('UNREAD'), false);
});
