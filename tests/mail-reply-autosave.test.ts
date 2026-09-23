import test from 'node:test';
import assert from 'node:assert/strict';
import { localReplyDraftKey, prepareReplyDraft, readLocalReplyDraft, sameReplyDraftContent, sameSavedReplyDraft, serializeReplyDraftRequest, type LocalReplyDraft } from '../src/lib/mail-reply-autosave';
import { isMailReplySystemDraft, type MailReplySystemDraft } from '../src/lib/mail-reply-draft';

const draft: MailReplySystemDraft = {
  version: 1, identity: { provider: 'gmail', mailAccountId: 'gmail:a', mailAddress: 'a@example.com', threadId: 't', messageId: 'm', recipient: 'c@example.com', subject: 'Re: Test', anchorBody: 'Incoming' },
  foreignBody: 'Edited foreign', chineseBody: '尚未同步的中文', userIdeas: '人工修改', targetLanguage: 'en', targetLanguageName: '英语', tone: 'friendly',
  snapshot: null, confirmedForeign: null, hasSuggestion: true, strategyEditing: false, translationEditing: true, attachments: [],
};

test('丢失保存响应的核对忽略对象键顺序，但不忽略审核状态、发送标记或编辑版本', () => {
  const reordered = Object.fromEntries(Object.entries(draft).reverse()) as MailReplySystemDraft;
  assert.equal(sameSavedReplyDraft(draft, reordered), true);
  for (const change of [{ strategyEditing: true }, { confirmedForeign: { foreignBody: 'yes', chineseBody: '是', targetLanguage: 'en' } },
    { sentAt: '2026-09-23T00:00:00Z' }, { editedAt: '2026-09-23T00:00:00Z' }]) {
    assert.equal(sameSavedReplyDraft(draft, { ...draft, ...change }), false);
  }
});

test('自动保存：小附件保留完整字节，人工中文及未确认状态不变', async () => {
  const result = await prepareReplyDraft(draft, [new File(['hello'], 'note.txt', { type: 'text/plain', lastModified: 10 })], 'u');
  assert.equal(result.attachments[0].base64, 'aGVsbG8=');
  assert.equal(result.attachments[0].lastModified, 10);
  assert.equal(result.chineseBody, draft.chineseBody);
  assert.equal(result.snapshot, null); assert.equal(result.confirmedForeign, null);
  assert.equal(result.attachmentWarning, undefined);
});

test('自动保存：大附件不阻止文字，恢复时保留缺失附件说明', async () => {
  const result = await prepareReplyDraft(draft, [new File([new Uint8Array(3 * 1024 * 1024)], 'large.pdf')], 'u');
  assert.equal(result.foreignBody, draft.foreignBody); assert.equal(result.userIdeas, draft.userIdeas);
  assert.deepEqual(result.attachments, []); assert.match(result.attachmentWarning || '', /large.pdf/);
  const reopened = await prepareReplyDraft(result, [], 'u');
  assert.equal(reopened.attachmentWarning, result.attachmentWarning);
});

test('自动保存：附件读取失败仍保留文字，重新添加后可恢复完整保存', async () => {
  const file = new File(['bad'], 'broken.txt');
  file.arrayBuffer = async () => { throw new Error('unreadable'); };
  const result = await prepareReplyDraft(draft, [file], 'u');
  assert.equal(result.foreignBody, draft.foreignBody); assert.match(result.attachmentWarning || '', /broken.txt/);
  const fixed = await prepareReplyDraft(result, [new File(['fixed'], 'fixed.txt')], 'u');
  assert.equal(fixed.attachmentWarning, undefined); assert.equal(fixed.attachments.length, 1);
});

test('自动保存：本机草稿按用户及完整邮件身份校验，不复用变更后的来信正文', () => {
  const rows = new Map<string, string>(); const storage = { getItem: (key: string) => rows.get(key) || null };
  const record: LocalReplyDraft = { ownerId: 'u1', revision: '1', draft, dirty: true, baseSavedAt: null };
  rows.set(localReplyDraftKey('u1', draft.identity), JSON.stringify(record));
  assert.deepEqual(readLocalReplyDraft(storage, 'u1', draft.identity), record);
  assert.equal(readLocalReplyDraft(storage, 'u2', draft.identity), null);
  for (const change of [{ provider: 'tencent_exmail' as const }, { mailAccountId: 'other' }, { recipient: 'other@example.com' }, { messageId: 'new' }, { anchorBody: 'new incoming' }, { subject: 'changed' }]) {
    assert.equal(readLocalReplyDraft(storage, 'u1', { ...draft.identity, ...change }), null);
  }
});

test('自动保存：旧草稿兼容，发送标记和附件说明可往返，损坏标记拒绝恢复', () => {
  assert.equal(isMailReplySystemDraft(draft), true);
  const sent = { ...draft, sentAt: '2026-09-14T08:00:00Z', editedAt: '2026-09-14T07:00:00Z', attachmentWarning: '附件未暂存' };
  assert.equal(isMailReplySystemDraft(JSON.parse(JSON.stringify(sent))), true);
  for (const change of [{ sentAt: 'bad' }, { editedAt: 123 }, { attachmentWarning: {} }]) {
    assert.equal(isMailReplySystemDraft({ ...draft, ...change }), false);
  }
});

test('自动保存：关闭后的写入先完成，同一邮件重新打开再读取；其他邮箱不等待', async () => {
  let release!: () => void;
  const order: string[] = [];
  const save = serializeReplyDraftRequest('a', async () => { await new Promise<void>((r) => { release = r; }); order.push('save'); });
  await new Promise((r) => setTimeout(r, 0));
  const read = serializeReplyDraftRequest('a', async () => { order.push('read'); });
  await serializeReplyDraftRequest('b', async () => { order.push('other'); });
  release(); await Promise.all([save, read]);
  assert.deepEqual(order, ['other', 'save', 'read']);
});

test('自动保存：上一请求失败不会使后续恢复或重试永远卡住', async () => {
  await assert.rejects(serializeReplyDraftRequest('retry', async () => { throw new Error('offline'); }), /offline/);
  assert.equal(await serializeReplyDraftRequest('retry', async () => 'recovered'), 'recovered');
});

test('发送后只标记相同编辑内容，重新打开的时间变化不阻止标记，新回复不误清空', () => {
  assert.equal(sameReplyDraftContent(draft, { ...draft, editedAt: new Date().toISOString() }), true);
  for (const change of [{ foreignBody: 'New reply' }, { chineseBody: '新的中文' }, { userIdeas: '新想法' }, { targetLanguage: 'es' }, { attachmentWarning: '新附件未保存' }]) {
    assert.equal(sameReplyDraftContent(draft, { ...draft, ...change }), false);
  }
});
