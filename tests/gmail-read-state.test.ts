import assert from 'node:assert/strict';
import test from 'node:test';
import {
  beginGmailReadStateOperation,
  clearGmailReadStateRuntime,
  copyGmailThreadReadState,
  getAutomaticGmailReadRequest,
  getGmailReadStateOperationVersion,
  hasManualGmailUnreadPreference,
  registerAutomaticGmailReadRequest,
  setGmailThreadReadState,
  setManualGmailUnreadPreference,
  shouldAutoMarkGmailThreadRead,
  shouldRollbackAutomaticGmailRead,
} from '../src/lib/gmail-read-state';
import type { GmailThread } from '../src/lib/types';

const unreadThread: GmailThread = {
  id: 'thread-1',
  subject: 'Subject',
  snippet: 'Snippet',
  participantCount: 1,
  lastMessageDate: '2026-08-18T10:00:00.000Z',
  hasUnread: true,
  labels: ['INBOX', 'UNREAD'],
  isStarred: false,
  messages: [{
    id: 'message-1',
    threadId: 'thread-1',
    from: 'creator@example.com',
    to: 'owner@example.com',
    subject: 'Subject',
    snippet: 'Snippet',
    body: 'Body',
    date: '2026-08-18T10:00:00.000Z',
    isRead: false,
    labels: ['INBOX', 'UNREAD'],
    hasAttachments: false,
  }],
};

test('正文成功显示且仍在查看时允许自动标记已读', () => {
  assert.equal(shouldAutoMarkGmailThreadRead({
    hasUnread: true,
    contentReady: true,
    stillViewing: true,
    manuallyPreservedUnread: false,
    latestMessageFromOwnAccount: false,
  }), true);
});

test('正文失败、已经关闭、手动保留未读或最后一封为我方发送时不自动已读', () => {
  const base = {
    hasUnread: true,
    contentReady: true,
    stillViewing: true,
    manuallyPreservedUnread: false,
    latestMessageFromOwnAccount: false,
  };
  assert.equal(shouldAutoMarkGmailThreadRead({ ...base, contentReady: false }), false);
  assert.equal(shouldAutoMarkGmailThreadRead({ ...base, stillViewing: false }), false);
  assert.equal(shouldAutoMarkGmailThreadRead({ ...base, manuallyPreservedUnread: true }), false);
  assert.equal(shouldAutoMarkGmailThreadRead({ ...base, latestMessageFromOwnAccount: true }), false);
  assert.equal(shouldAutoMarkGmailThreadRead({ ...base, hasUnread: false }), false);
});

test('线程已读状态同时更新线程标签和全部消息', () => {
  const readThread = setGmailThreadReadState(unreadThread, true);
  assert.equal(readThread.hasUnread, false);
  assert.equal(readThread.labels.includes('UNREAD'), false);
  assert.equal(readThread.messages[0].isRead, true);
  assert.equal(readThread.messages[0].labels.includes('UNREAD'), false);

  const restored = setGmailThreadReadState(readThread, false);
  assert.equal(restored.hasUnread, true);
  assert.equal(restored.messages[0].isRead, false);
});

test('后续正文或图片结果沿用缓存中的最新已读状态', () => {
  const readThread = setGmailThreadReadState(unreadThread, true);
  const lateContent = {
    ...unreadThread,
    messages: unreadThread.messages.map((message) => ({ ...message, body: '含内嵌图片的完整正文' })),
  };
  const synchronized = copyGmailThreadReadState(lateContent, readThread);
  assert.equal(synchronized.hasUnread, false);
  assert.equal(synchronized.messages[0].isRead, true);
  assert.equal(synchronized.messages[0].body, '含内嵌图片的完整正文');
});

test('只有账号作用域和操作版本均未变化时才允许失败回滚', () => {
  assert.equal(shouldRollbackAutomaticGmailRead(2, 2, 'account-a', 'account-a'), true);
  assert.equal(shouldRollbackAutomaticGmailRead(2, 3, 'account-a', 'account-a'), false);
  assert.equal(shouldRollbackAutomaticGmailRead(2, 2, 'account-a', 'account-b'), false);
});

test('读状态操作版本、自动请求和手动未读偏好按作用域隔离', async () => {
  clearGmailReadStateRuntime();
  assert.equal(beginGmailReadStateOperation('account-a::one@gmail.com', 'thread-1'), 1);
  assert.equal(beginGmailReadStateOperation('account-a::one@gmail.com', 'thread-1'), 2);
  assert.equal(getGmailReadStateOperationVersion('account-a::one@gmail.com', 'thread-1'), 2);
  assert.equal(getGmailReadStateOperationVersion('account-b::one@gmail.com', 'thread-1'), 0);

  const request = Promise.resolve();
  const unregister = registerAutomaticGmailReadRequest('account-a::one@gmail.com', 'thread-1', request);
  assert.equal(getAutomaticGmailReadRequest('account-a::one@gmail.com', 'thread-1'), request);
  assert.equal(getAutomaticGmailReadRequest('account-a::two@gmail.com', 'thread-1'), undefined);
  unregister();

  setManualGmailUnreadPreference('account-a::one@gmail.com', 'thread-1', true);
  assert.equal(hasManualGmailUnreadPreference('account-a::one@gmail.com', 'thread-1'), true);
  assert.equal(hasManualGmailUnreadPreference('account-b::one@gmail.com', 'thread-1'), false);
  setManualGmailUnreadPreference('account-a::one@gmail.com', 'thread-1', false);
  assert.equal(hasManualGmailUnreadPreference('account-a::one@gmail.com', 'thread-1'), false);
  clearGmailReadStateRuntime();
});
