import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getUsableCooperationEmailHistory,
  findBoundCooperationConversation,
  groupCooperationProjectConversations,
} from '../src/lib/cooperation-email-thread';

test('合作告知邮件忽略 Gmail 表情回应和已有草稿', () => {
  const messages = [
    { id: 'normal', body: '普通往来邮件', labelIds: ['SENT'] },
    { id: 'reaction-mime', body: '🤝', mimeType: 'text/x-gmail-reaction', labelIds: ['SENT'] },
    { id: 'reaction-text', body: 'Daniel Wu reacted via Gmail', labelIds: ['SENT'] },
    { id: 'draft', body: '已有物流草稿', labelIds: ['DRAFT'] },
  ];

  assert.deepEqual(
    getUsableCooperationEmailHistory(messages).map((message) => message.id),
    ['normal'],
  );
});

test('Gmail 项目历史只按原生 threadId 分组', () => {
  const groups = groupCooperationProjectConversations([
    { id: 'a', threadId: 'thread-a', date: '2026-08-20T00:00:00Z' },
    { id: 'b', threadId: 'thread-b', date: '2026-08-20T00:01:00Z' },
  ], 'gmail', 'gmail:owner@example.com');
  assert.equal(groups.length, 2);
});

test('腾讯项目历史缺少标准关系头时不按最近邮件合并', () => {
  const groups = groupCooperationProjectConversations([
    { id: 'a', rfcMessageId: '<a@example.com>', date: '2026-08-20T00:00:00Z' },
    { id: 'b', rfcMessageId: '<b@example.com>', date: '2026-08-20T00:01:00Z' },
  ], 'tencent_exmail', 'tencent:owner@example.com');
  assert.equal(groups.length, 2);
});

test('项目会话绑定失效时不会自动选择最近会话', () => {
  const candidates = groupCooperationProjectConversations([
    { id: 'project-a', rfcMessageId: '<project-a@example.com>', date: '2026-08-20T00:00:00Z' },
    { id: 'project-b', rfcMessageId: '<project-b@example.com>', date: '2026-08-21T00:00:00Z' },
  ], 'tencent_exmail', 'tencent:owner@example.com');
  assert.equal(findBoundCooperationConversation(candidates, {
    messageRef: 'missing',
    rfcMessageId: '<missing@example.com>',
  }), null);
  assert.equal(findBoundCooperationConversation(candidates, {
    messageRef: 'project-a',
    rfcMessageId: '<project-a@example.com>',
  })?.messages[0].id, 'project-a');
});

test('合作告知邮件仍允许回复我方最后一封普通邮件', () => {
  const messages = [
    { id: 'incoming', body: '对方来信', labelIds: ['INBOX'] },
    { id: 'sent', body: '我方普通回复', labelIds: ['SENT'] },
  ];

  const usable = getUsableCooperationEmailHistory(messages);
  assert.equal(usable.at(-1)?.id, 'sent');
});
