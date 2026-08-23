import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseMailAccountBindings,
  resolveMailAccountBinding,
  upsertMailAccountBinding,
} from '../src/lib/mail-account-bindings';

test('邮箱绑定可按飞书记录和联系人邮箱找到同一账号', () => {
  const bindings = upsertMailAccountBinding({}, {
    feishuRecordId: 'rec-1',
    contactEmail: 'Creator@Example.com',
    mailAccountId: 'tencent_exmail:collab@example.com',
    provider: 'tencent_exmail',
    mailAddress: 'collab@example.com',
    draftRef: 'draft-1',
  }, '2026-08-20T00:00:00.000Z');

  assert.equal(resolveMailAccountBinding(bindings, { feishuRecordId: 'rec-1' })?.provider, 'tencent_exmail');
  assert.equal(resolveMailAccountBinding(bindings, { contactEmail: 'creator@example.com' })?.draftRef, 'draft-1');
});

test('无效邮箱绑定快照会被忽略', () => {
  assert.deepEqual(parseMailAccountBindings({ invalid: { provider: 'unknown' } }), {});
});

test('合作项目绑定优先且不会覆盖红人或联系人绑定', () => {
  const creatorBindings = upsertMailAccountBinding({}, {
    prospectId: 'prospect-1',
    contactEmail: 'creator@example.com',
    mailAccountId: 'gmail:owner@example.com',
    provider: 'gmail',
    mailAddress: 'owner@example.com',
  });
  const bindings = upsertMailAccountBinding(creatorBindings, {
    projectId: 'project-1',
    contactEmail: 'creator@example.com',
    mailAccountId: 'tencent_exmail:collab@example.com',
    provider: 'tencent_exmail',
    mailAddress: 'collab@example.com',
  });

  assert.equal(resolveMailAccountBinding(bindings, {
    projectId: 'project-1',
    contactEmail: 'creator@example.com',
  })?.provider, 'tencent_exmail');
  assert.equal(resolveMailAccountBinding(bindings, {
    contactEmail: 'creator@example.com',
  })?.provider, 'gmail');
});

test('项目会话选择只保存到项目绑定且不覆盖联系人绑定', () => {
  const creatorBindings = upsertMailAccountBinding({}, {
    contactEmail: 'creator@example.com',
    mailAccountId: 'gmail:owner@example.com',
    provider: 'gmail',
    mailAddress: 'owner@example.com',
  });
  const bindings = upsertMailAccountBinding(creatorBindings, {
    projectId: 'project-a',
    contactEmail: 'creator@example.com',
    mailAccountId: 'tencent_exmail:collab@example.com',
    provider: 'tencent_exmail',
    mailAddress: 'collab@example.com',
    conversationMode: 'reply',
    conversationLocator: {
      provider: 'tencent_exmail',
      mailAccountId: 'tencent_exmail:collab@example.com',
      messageRef: '88',
      folderRef: 'INBOX',
      rfcMessageId: '<project-a@example.com>',
      subject: 'Project A',
      boundAt: '2026-08-21T00:00:00.000Z',
    },
  });

  assert.equal(resolveMailAccountBinding(bindings, { projectId: 'project-a' })?.conversationLocator?.subject, 'Project A');
  assert.equal(resolveMailAccountBinding(bindings, { contactEmail: 'creator@example.com' })?.provider, 'gmail');
});
