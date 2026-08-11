import test from 'node:test';
import assert from 'node:assert/strict';
import { getUsableCooperationEmailHistory } from '../src/lib/cooperation-email-thread';

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

test('合作告知邮件仍允许回复我方最后一封普通邮件', () => {
  const messages = [
    { id: 'incoming', body: '对方来信', labelIds: ['INBOX'] },
    { id: 'sent', body: '我方普通回复', labelIds: ['SENT'] },
  ];

  const usable = getUsableCooperationEmailHistory(messages);
  assert.equal(usable.at(-1)?.id, 'sent');
});
