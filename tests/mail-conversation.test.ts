import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStrictMailConversations } from '../src/lib/mail-conversation';

const base = {
  mailAccountId: 'tencent:a@example.com',
  date: '2026-08-20T00:00:00.000Z',
};

test('相同联系人和主题但没有标准关系头时保持独立', () => {
  const groups = groupStrictMailConversations([
    { ...base, id: 'a', rfcMessageId: '<a@example.com>' },
    { ...base, id: 'b', rfcMessageId: '<b@example.com>' },
  ]);
  assert.equal(groups.length, 2);
});

test('In-Reply-To 和 References 能连接邮件且不依赖主题', () => {
  const groups = groupStrictMailConversations([
    { ...base, id: 'root', rfcMessageId: '<root@example.com>' },
    { ...base, id: 'reply', rfcMessageId: '<reply@example.com>', inReplyTo: '<root@example.com>' },
    { ...base, id: 'renamed', rfcMessageId: '<renamed@example.com>', references: '<root@example.com> <reply@example.com>' },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].messages.map((message) => message.id), ['root', 'reply', 'renamed']);
});

test('自动回复和退信不因引用关系混入人工会话', () => {
  const groups = groupStrictMailConversations([
    { ...base, id: 'root', rfcMessageId: '<root@example.com>' },
    { ...base, id: 'auto', rfcMessageId: '<auto@example.com>', inReplyTo: '<root@example.com>', automated: true },
    { ...base, id: 'bounce', rfcMessageId: '<bounce@example.com>', references: '<root@example.com>', deliveryFailure: true },
  ]);
  assert.equal(groups.length, 3);
});

test('相同 Message-ID 的已发送副本优先于草稿副本', () => {
  const groups = groupStrictMailConversations([
    { ...base, id: 'draft', rfcMessageId: '<same@example.com>', labelIds: ['DRAFT'] },
    { ...base, id: 'sent', rfcMessageId: '<same@example.com>', labelIds: ['SENT'] },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].messages[0].id, 'sent');
});

test('不同邮箱账号不能形成同一会话', () => {
  const groups = groupStrictMailConversations([
    { ...base, id: 'a', rfcMessageId: '<root@example.com>' },
    { ...base, id: 'b', mailAccountId: 'tencent:b@example.com', rfcMessageId: '<reply@example.com>', inReplyTo: '<root@example.com>' },
  ]);
  assert.equal(groups.length, 2);
});
