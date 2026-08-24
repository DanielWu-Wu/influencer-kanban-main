import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindFeishuRecordsToMailAccount,
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

test('批量选择邮箱会准确统计新增、相同和覆盖记录', () => {
  let bindings = upsertMailAccountBinding({}, {
    feishuRecordId: 'rec-same',
    contactEmail: 'same@example.com',
    mailAccountId: 'gmail:owner@example.com',
    provider: 'gmail',
    mailAddress: 'owner@example.com',
  });
  bindings = upsertMailAccountBinding(bindings, {
    feishuRecordId: 'rec-overwrite',
    contactEmail: 'overwrite@example.com',
    mailAccountId: 'tencent_exmail:old@example.com',
    provider: 'tencent_exmail',
    mailAddress: 'old@example.com',
    draftRef: 'old-draft',
    folderRef: 'Drafts',
    threadRef: 'old-thread',
  });

  const result = bindFeishuRecordsToMailAccount(bindings, [
    { recordId: 'rec-new', contactEmail: 'new@example.com' },
    { recordId: 'rec-same', contactEmail: 'same@example.com' },
    { recordId: 'rec-overwrite', contactEmail: 'overwrite@example.com' },
  ], {
    mailAccountId: 'gmail:owner@example.com',
    provider: 'gmail',
    email: 'owner@example.com',
  });

  assert.deepEqual(result.changedRecordIds, ['rec-new', 'rec-overwrite']);
  assert.deepEqual(result.accountChangedRecordIds, ['rec-overwrite']);
  assert.equal(result.unselected, 1);
  assert.equal(result.same, 1);
  assert.equal(result.overwrite, 1);
  assert.equal(resolveMailAccountBinding(result.bindings, { feishuRecordId: 'rec-new' })?.provider, 'gmail');
});

test('真正切换邮箱时不继承旧账号的草稿和线程定位', () => {
  const original = upsertMailAccountBinding({}, {
    feishuRecordId: 'rec-1',
    contactEmail: 'creator@example.com',
    mailAccountId: 'tencent_exmail:old@example.com',
    provider: 'tencent_exmail',
    mailAddress: 'old@example.com',
    draftRef: 'old-draft',
    initialMessageRef: 'old-message',
    folderRef: 'Drafts',
    threadRef: 'old-thread',
    conversationMode: 'reply',
    conversationLocator: {
      provider: 'tencent_exmail',
      mailAccountId: 'tencent_exmail:old@example.com',
      messageRef: '99',
      folderRef: 'INBOX',
      subject: 'Old thread',
      boundAt: '2026-08-21T00:00:00.000Z',
    },
  });

  const result = bindFeishuRecordsToMailAccount(original, [
    { recordId: 'rec-1', contactEmail: 'creator@example.com' },
  ], {
    mailAccountId: 'gmail:new@example.com',
    provider: 'gmail',
    email: 'new@example.com',
  });
  const binding = resolveMailAccountBinding(result.bindings, { feishuRecordId: 'rec-1' });

  assert.equal(binding?.mailAccountId, 'gmail:new@example.com');
  assert.equal(binding?.draftRef, undefined);
  assert.equal(binding?.initialMessageRef, undefined);
  assert.equal(binding?.folderRef, undefined);
  assert.equal(binding?.threadRef, undefined);
  assert.equal(binding?.conversationLocator, undefined);
});

test('同一默认邮箱只补做绑定时不算切换账号', () => {
  const result = bindFeishuRecordsToMailAccount({}, [{
    recordId: 'rec-legacy',
    contactEmail: 'legacy@example.com',
    currentMailAccountId: 'gmail:owner@example.com',
  }], {
    mailAccountId: 'gmail:owner@example.com',
    provider: 'gmail',
    email: 'owner@example.com',
  });

  assert.deepEqual(result.changedRecordIds, ['rec-legacy']);
  assert.deepEqual(result.accountChangedRecordIds, []);
});
