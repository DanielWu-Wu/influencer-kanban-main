import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFollowUpWriteChanges } from '../src/lib/outreach-follow-up-sync';
import type { FeishuFieldMapping } from '../src/lib/feishu-mapping';

const mapping: FeishuFieldMapping = {
  firstOutreach: '初次开发信',
  secondOutreachDate: '一次 Follow Up 日期',
  secondOutreach: '一次 Follow Up',
  thirdOutreachDate: '二次 Follow Up 日期',
  thirdOutreach: '二次 Follow Up',
  hasReply: '是否回复',
};

const firstSentAt = new Date(2026, 6, 1, 10).toISOString();
const secondSentAt = new Date(2026, 6, 4, 11).toISOString();
const thirdSentAt = new Date(2026, 6, 8, 12).toISOString();

test('Gmail 检查结果与飞书现值完全一致时无需写回', () => {
  const changes = buildFollowUpWriteChanges({
    firstOutreach: '已发',
    secondOutreachDate: new Date(2026, 6, 4, 0).getTime(),
    secondOutreach: '已发送',
    thirdOutreachDate: 0,
    thirdOutreach: '',
    hasReply: '未回复',
    check: {
      outbound: [{ date: firstSentAt }, { date: secondSentAt }],
      reply: null,
    },
  }, mapping);

  assert.equal(changes, null);
});

test('只返回与飞书现值不同的 Follow Up 字段', () => {
  const changes = buildFollowUpWriteChanges({
    firstOutreach: '已发',
    secondOutreachDate: new Date(2026, 6, 4, 0).getTime(),
    secondOutreach: '已发',
    thirdOutreachDate: 0,
    thirdOutreach: '',
    hasReply: '未回复',
    check: {
      outbound: [{ date: firstSentAt }, { date: secondSentAt }, { date: thirdSentAt }],
      reply: null,
    },
  }, mapping);

  assert.deepEqual(changes?.payload, {
    '二次 Follow Up 日期': new Date(thirdSentAt).getTime(),
    '二次 Follow Up': '已发',
  });
  assert.deepEqual(changes?.fields.map((field) => field.label), [
    '二次 Follow Up 日期',
    '二次 Follow Up',
  ]);
});

test('人工回复状态变化时只写回是否回复', () => {
  const changes = buildFollowUpWriteChanges({
    firstOutreach: '已发',
    secondOutreachDate: 0,
    secondOutreach: '',
    thirdOutreachDate: 0,
    thirdOutreach: '',
    hasReply: '未回复',
    check: {
      outbound: [{ date: firstSentAt }],
      reply: { date: new Date(2026, 6, 2).toISOString() },
    },
  }, mapping);

  assert.deepEqual(changes?.payload, { 是否回复: '已回复' });
});

test('飞书明确标记未发送时仍需写回已发状态', () => {
  const changes = buildFollowUpWriteChanges({
    firstOutreach: '未发送',
    secondOutreachDate: 0,
    secondOutreach: '',
    thirdOutreachDate: 0,
    thirdOutreach: '',
    hasReply: '未回复',
    check: {
      outbound: [{ date: firstSentAt }],
      reply: null,
    },
  }, mapping);

  assert.deepEqual(changes?.payload, { 初次开发信: '已发' });
});
