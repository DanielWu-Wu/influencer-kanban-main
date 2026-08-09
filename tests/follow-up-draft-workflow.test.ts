import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFollowUpSentPayload,
  canSaveFollowUpDraft,
  evaluateFollowUpEligibility,
  followUpDueAt,
  followUpSaveMode,
  type FollowUpCheck,
  type FollowUpSourceRecord,
} from '../src/lib/follow-up-draft-workflow';

const developmentDate = new Date(2026, 7, 1, 10).getTime();
const initialMessage = {
  id: 'initial',
  threadId: 'thread',
  rfcMessageId: '<initial@example.com>',
  references: '',
  subject: '合作邀请',
  from: 'me@example.com',
  to: 'creator@example.com',
  date: new Date(2026, 7, 1, 11).toISOString(),
  body: 'Initial outreach',
};
const record: FollowUpSourceRecord = {
  recordId: 'record-1',
  channelName: 'Creator',
  email: 'creator@example.com',
  developmentDate,
  firstOutreach: '已发',
  secondOutreachDate: 0,
  secondOutreach: '',
  thirdOutreachDate: 0,
  thirdOutreach: '',
  language: 'en',
  targetProduct: 'P210',
  cooperationType: 'Review',
  cooperationIdea: 'Outdoor test',
};
const cleanCheck: FollowUpCheck = {
  outbound: [initialMessage],
  reply: null,
  automatedReply: null,
  deliveryFailure: null,
};

test('第1次和第2次跟进分别在开发日期第3天和第7天到期', () => {
  assert.equal(followUpDueAt(developmentDate, 2), new Date(2026, 7, 4).getTime());
  assert.equal(followUpDueAt(developmentDate, 3), new Date(2026, 7, 8).getTime());
});

test('未到期时不能生成，达到第3天后允许进入 Gmail 检查', () => {
  assert.equal(evaluateFollowUpEligibility({
    record,
    stage: 2,
    now: new Date(2026, 7, 3, 23).getTime(),
  }).code, 'not_due');
  assert.equal(evaluateFollowUpEligibility({
    record,
    stage: 2,
    now: new Date(2026, 7, 4, 0).getTime(),
  }).code, 'needs_gmail_check');
});

test('人工回复和退信都会阻止生成，自动回复只给出提醒', () => {
  assert.equal(evaluateFollowUpEligibility({
    record,
    stage: 2,
    now: new Date(2026, 7, 5).getTime(),
    check: { ...cleanCheck, reply: initialMessage },
  }).code, 'human_reply');
  assert.equal(evaluateFollowUpEligibility({
    record,
    stage: 2,
    now: new Date(2026, 7, 5).getTime(),
    check: { ...cleanCheck, deliveryFailure: initialMessage },
  }).code, 'delivery_failure');
  const automated = evaluateFollowUpEligibility({
    record,
    stage: 2,
    now: new Date(2026, 7, 5).getTime(),
    check: { ...cleanCheck, automatedReply: initialMessage },
  });
  assert.equal(automated.allowed, true);
  assert.match(automated.warning || '', /自动回复/);
});

test('第2次跟进要求前序阶段完成且能取得上一封正文', () => {
  const dueAt = new Date(2026, 7, 8).getTime();
  assert.equal(evaluateFollowUpEligibility({ record, stage: 3, now: dueAt, check: cleanCheck }).code, 'previous_stage_incomplete');
  assert.equal(evaluateFollowUpEligibility({
    record: { ...record, secondOutreach: '已发', secondOutreachDate: new Date(2026, 7, 4).getTime() },
    stage: 3,
    now: dueAt,
    check: cleanCheck,
  }).code, 'missing_previous_body');
  assert.equal(evaluateFollowUpEligibility({
    record: { ...record, secondOutreach: '已发', secondOutreachDate: new Date(2026, 7, 4).getTime() },
    stage: 3,
    now: dueAt,
    check: cleanCheck,
    previousBody: 'Previous draft body',
  }).allowed, true);
});

test('中文存在未翻译修改或 Gmail 草稿已创建时不能保存', () => {
  const base = {
    status: 'generated',
    body: 'Foreign body',
    chineseBody: '中文正文',
    chineseDirty: false,
  };
  assert.equal(canSaveFollowUpDraft(base), true);
  assert.equal(canSaveFollowUpDraft({ ...base, chineseDirty: true }), false);
  assert.equal(canSaveFollowUpDraft({ ...base, gmailDraftId: 'draft-1' }), false);
});

test('Gmail 已存在同阶段邮件或没有初次开发信时禁止重复生成', () => {
  const now = new Date(2026, 7, 5).getTime();
  assert.equal(evaluateFollowUpEligibility({
    record,
    stage: 2,
    now,
    check: { ...cleanCheck, outbound: [] },
  }).code, 'missing_initial_email');
  assert.equal(evaluateFollowUpEligibility({
    record,
    stage: 2,
    now,
    check: { ...cleanCheck, outbound: [initialMessage, { ...initialMessage, id: 'follow-up' }] },
  }).code, 'already_sent_in_gmail');
});

test('Follow Up 飞书写回只使用已配置映射并写入指定日期', () => {
  const sentAt = new Date(2026, 7, 9, 15).getTime();
  assert.deepEqual(buildFollowUpSentPayload(2, sentAt, {
    secondOutreach: '一次跟进状态',
    secondOutreachDate: '一次跟进日期',
  }), {
    一次跟进状态: '已发',
    一次跟进日期: sentAt,
  });
  assert.equal(buildFollowUpSentPayload(3, sentAt, { thirdOutreach: '二次跟进状态' }), null);
});

test('Gmail 草稿已存在且飞书失败时只允许重试飞书', () => {
  assert.equal(followUpSaveMode({ status: 'generated', canSave: true }), 'create_gmail');
  assert.equal(followUpSaveMode({ status: 'feishu_error', gmailDraftId: 'draft-1', canSave: false }), 'retry_feishu');
  assert.equal(followUpSaveMode({ status: 'saved', gmailDraftId: 'draft-1', canSave: false }), 'blocked');
});
