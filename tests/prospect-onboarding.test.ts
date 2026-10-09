import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateProspects, type Prospect } from '../src/lib/creator-prospecting';
import { applyProspectBatchDefaults, canConfirmProspectDirection, canStartProspectRound, createProspectOutreachRound, resolveProspectContentTypes } from '../src/lib/prospect-onboarding';
import { buildFeishuRecordIndex, findFeishuDevelopmentHistoryMatch, findFeishuRecordMatch, getFeishuCandidateRecordIds } from '../src/lib/feishu-record-index';

function prospect(): Prospect {
  return migrateProspects([{ schemaVersion: 7, id: 'old', inputUrl: 'https://youtube.com/@creator',
    channelId: 'UCcreator', title: 'Creator', workflowStatus: 'gmail_draft_saved',
    publicEmail: 'manual@example.com', emailManuallyLocked: true, resourceRecordId: 'resource',
    resourceStatus: 'exists', feishuRecordId: 'development-old', developmentStatus: 'exists',
    aiDraft: { subject: 'old subject', body: 'old body' }, gmailDraftId: 'draft-old',
    targetProduct: 'previous product', cooperationType: '付费测评', cooperationIdea: 'previous promise',
    outreachNotes: 'previous requirements', resourceContentTypes: ['科技'],
    feishuWriteTask: { id: 'old-operation', scope: 'a', status: 'success', kind: 'quick',
      resourceUrl: 'resource', developmentUrl: 'development', mappingSignature: 'mapping', steps: [] },
  }])[0];
}

test('每次发起独立轮次，资源和手动邮箱复用，旧草稿与任务不被覆盖', () => {
  const old = prospect();
  const first = createProspectOutreachRound(old, 'new-1', '2026-09-30T01:00:00Z');
  const second = createProspectOutreachRound(old, 'new-2', '2026-09-30T02:00:00Z');
  assert.notEqual(first.id, second.id);
  assert.equal(first.resourceRecordId, 'resource'); assert.equal(first.publicEmail, 'manual@example.com');
  assert.equal(first.emailManuallyLocked, true); assert.equal(first.previousDevelopmentRecordId, 'development-old');
  for (const round of [first, second]) {
    assert.equal(round.feishuRecordId, undefined); assert.equal(round.feishuWriteTask, undefined);
    assert.equal(round.gmailDraftId, undefined); assert.equal(round.aiDraft, undefined);
    assert.equal(round.cooperationIdea, undefined); assert.equal(round.targetProduct, undefined);
    assert.equal(round.outreachNotes, undefined); assert.equal(round.workflowStatus, 'resolved');
  }
  assert.equal(old.aiDraft?.body, 'old body'); assert.equal(old.gmailDraftId, 'draft-old');
});

test('本批次信息只补空白，已填写的产品与语言保持不变，要求随轮次固定', () => {
  const round = createProspectOutreachRound(prospect(), 'new', '2026-09-30T01:00:00Z');
  const applied = applyProspectBatchDefaults({ ...round, targetProduct: 'manual product', outreachLanguage: 'nl', outreachLanguageSource: 'manual' },
    { targetProduct: 'batch product', cooperationType: '送样测评', outreachLanguage: 'es', notes: 'new requirements' });
  assert.equal(applied.targetProduct, 'manual product'); assert.equal(applied.outreachLanguage, 'nl');
  assert.equal(applied.cooperationType, '送样测评'); assert.equal(applied.outreachNotes, 'new requirements');
});

test('AI 分类失败或无选项直接留空，手动类型（包括留空）不被 AI 覆盖', async () => {
  const source = { ...prospect(), resourceContentTypes: undefined };
  let calls = 0;
  const failed = await resolveProspectContentTypes(source, async () => { calls++; throw new Error('timeout'); });
  assert.deepEqual(failed.values, []); assert.match(failed.notice!, /继续建档/);
  const empty = await resolveProspectContentTypes(source, async () => []);
  assert.deepEqual(empty.values, []);
  for (const values of [[], ['旅行']]) {
    const result = await resolveProspectContentTypes({ ...source, resourceContentTypesManual: true, resourceContentTypes: values }, async () => { calls++; return ['科技']; });
    assert.deepEqual(result.values, values);
  }
  assert.equal(calls, 1);
});

test('同频道多轮是开发历史；资源库重复和跨频道共用邮箱仍需核实', () => {
  const mapping = { channelUrl: 'Channel', channelId: 'Id', email: 'Email' };
  const records = ['round-1', 'round-2'].map((record_id) => ({ record_id, fields: { Channel: 'https://youtube.com/@creator', Id: 'UCcreator' } }));
  const index = buildFeishuRecordIndex(records, mapping);
  assert.equal(findFeishuRecordMatch(prospect(), index).kind, 'conflict');
  assert.deepEqual(getFeishuCandidateRecordIds(prospect(), index), ['round-1', 'round-2']);
  const history = findFeishuDevelopmentHistoryMatch(prospect(), index, 'round-2');
  assert.equal(history.kind, 'exact'); assert.equal(history.kind === 'exact' && history.record.record_id, 'round-2');
  const ambiguous = buildFeishuRecordIndex([
    { record_id: 'a', fields: { Channel: 'https://youtube.com/@a', Email: 'agency@example.com' } },
    { record_id: 'b', fields: { Channel: 'https://youtube.com/@b', Email: 'agency@example.com' } },
  ], mapping);
  assert.equal(findFeishuDevelopmentHistoryMatch({ inputUrl: 'https://youtube.com/@other', publicEmail: 'agency@example.com' }, ambiguous).kind, 'conflict');
});

test('处理中的任务与结果不确定不能发起新轮次；明确的附带失败不覆盖旧任务', () => {
  const source = prospect(); assert.equal(canStartProspectRound(source), true);
  for (const status of ['checking', 'writing', 'unknown'] as const) {
    assert.equal(canStartProspectRound({ ...source, feishuWriteTask: { ...source.feishuWriteTask!, status } }), false);
  }
  assert.equal(canStartProspectRound({ ...source, publicEmail: '' }), false);
  assert.equal(canStartProspectRound({ ...source, emailSelectionRequired: true }), false);
  assert.equal(canStartProspectRound({ ...source, feishuWriteTask: { ...source.feishuWriteTask!, status: 'failed' } }), true);
});

test('刷新从成功日志恢复建档后的邀约阶段，不重复创建', () => {
  const source = prospect();
  const [restored] = migrateProspects([{ ...source, workflowStatus: 'resolved', feishuRecordId: undefined,
    feishuWriteTask: { ...source.feishuWriteTask!, advanceToInvitation: true,
      steps: [{ key: 'development', url: 'development', operationId: 'new-op', action: 'batchCreate',
        fields: { Channel: source.inputUrl }, status: 'success', recordId: 'new-development' }] },
  }]);
  assert.equal(restored.feishuRecordId, 'new-development'); assert.equal(restored.workflowStatus, 'invitation_pending');
});

test('只有邀约信息完整且收件邮箱唯一有效的当前阶段条目可批量确认', () => {
  const ready = { ...prospect(), workflowStatus: 'invitation_pending' as const, outreachLanguage: 'en' };
  assert.equal(canConfirmProspectDirection(ready), true);
  for (const publicEmail of ['', 'invalid-email', 'a@example.com\nb@example.com']) {
    assert.equal(canConfirmProspectDirection({ ...ready, publicEmail }), false);
    assert.equal(canStartProspectRound({ ...ready, publicEmail }), false);
  }
  assert.equal(canConfirmProspectDirection({ ...ready, cooperationIdea: '' }), false);
  assert.equal(canConfirmProspectDirection({ ...ready, workflowStatus: 'outreach_pending' }), false);
});
