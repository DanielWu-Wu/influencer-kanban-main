import test from 'node:test';
import assert from 'node:assert/strict';
import { getMailReplyApproval, isMailReplySystemDraft, mailReplyDraftIdentityKey, type MailReplySystemDraft } from '../src/lib/mail-reply-draft';

const snapshot = { foreignBody: '<p>Hello</p>', chineseBody: '你好', targetLanguage: 'en' };
const base = { snapshot, confirmedForeign: null, ...snapshot };
for (const provider of ['gmail', 'tencent_exmail'] as const) {
  test(`${provider}: AI 原稿与只改外文都允许导出，不要求重复翻译`, () => {
    assert.equal(getMailReplyApproval(base).canExport, true);
    const edited = getMailReplyApproval({ ...base, foreignBody: '<p>Hello friend</p>' });
    assert.equal(edited.canExport, true);
    assert.match(edited.warning, /中文仅供参考/);
  });
  test(`${provider}: 修改中文要同步，中外文都修改可明确采用外文`, () => {
    const chinese = { ...base, chineseBody: '你好，明天发货' };
    assert.equal(getMailReplyApproval(chinese).canExport, false);
    assert.equal(getMailReplyApproval(chinese).canConfirmForeign, false);
    const both = { ...chinese, foreignBody: '<p>Send tomorrow</p>' };
    assert.equal(getMailReplyApproval(both).canConfirmForeign, true);
    const confirmedForeign = { foreignBody: both.foreignBody, chineseBody: both.chineseBody, targetLanguage: 'en' };
    assert.equal(getMailReplyApproval({ ...both, confirmedForeign }).canExport, true);
    assert.equal(getMailReplyApproval({ ...both, confirmedForeign, chineseBody: '后天发货' }).canExport, false);
    assert.equal(getMailReplyApproval({ ...both, confirmedForeign, foreignBody: 'Other text' }).canExport, false);
    assert.equal(getMailReplyApproval({ ...both, confirmedForeign, targetLanguage: 'es' }).canExport, false);
  });
}
test('中文同步完成恢复导出；缺少同步依据保守阻止', () => {
  const updated = { ...snapshot, chineseBody: '新中文', foreignBody: 'New body' };
  assert.equal(getMailReplyApproval({ ...updated, snapshot: updated, confirmedForeign: null }).canExport, true);
  assert.equal(getMailReplyApproval({ ...base, snapshot: null }).canExport, false);
});

const draft: MailReplySystemDraft = {
  version: 1,
  identity: { provider: 'gmail', mailAccountId: 'mail-a', mailAddress: 'me@example.com', threadId: 't1', messageId: 'm1', recipient: 'creator@example.com', subject: 'Re: Test', anchorBody: 'Incoming body' },
  foreignBody: snapshot.foreignBody, chineseBody: '未同步中文', userIdeas: '我的想法', targetLanguage: 'en', targetLanguageName: '英语', tone: 'friendly',
  snapshot, confirmedForeign: null, hasSuggestion: true, strategyEditing: false, translationEditing: true,
  attachments: [{ name: 'small.txt', type: 'text/plain', lastModified: 1, base64: 'aGk=' }],
};
test('系统草稿序列化完整保留未同步编辑状态和附件，不自动转为已确认', () => {
  const restored = JSON.parse(JSON.stringify(draft));
  assert.equal(isMailReplySystemDraft(restored), true);
  assert.deepEqual(restored, draft);
  assert.equal(getMailReplyApproval({ snapshot: restored.snapshot, confirmedForeign: restored.confirmedForeign, foreignBody: restored.foreignBody, chineseBody: restored.chineseBody, targetLanguage: restored.targetLanguage }).canExport, false);
});
test('草稿身份严格区分邮箱、提供商、来信、收件人和正文', () => {
  const key = mailReplyDraftIdentityKey(draft.identity);
  for (const field of ['mailAccountId', 'mailAddress', 'threadId', 'messageId', 'recipient', 'subject', 'anchorBody']) {
    assert.notEqual(mailReplyDraftIdentityKey({ ...draft.identity, [field]: 'changed' }), key);
  }
  assert.notEqual(mailReplyDraftIdentityKey({ ...draft.identity, provider: 'tencent_exmail' }), key);
  assert.equal(mailReplyDraftIdentityKey({ ...draft.identity, mailAddress: 'ME@example.com' }), key);
});
test('损坏草稿和损坏附件拒绝恢复', () => {
  for (const value of [null, {}, { ...draft, version: 2 }, { ...draft, snapshot: {} }, { ...draft, translationEditing: 'yes' }, { ...draft, attachments: [{ ...draft.attachments[0], base64: 'bad!!' }] }]) {
    assert.equal(isMailReplySystemDraft(value), false);
  }
});
