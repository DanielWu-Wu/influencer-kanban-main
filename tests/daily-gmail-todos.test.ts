import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_GMAIL_LOOKBACK_HOURS,
  getDailyGmailTaskKey,
  isCompletedToday,
  isWithinDailyGmailWindow,
  resolveIncomingGmailCompletedAt,
  resolveLatestGmailAnswerAt,
} from '../src/lib/daily-gmail-todos';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

test('Gmail 待办保留近 72 小时内的来信', () => {
  assert.equal(DAILY_GMAIL_LOOKBACK_HOURS, 72);
  assert.equal(isWithinDailyGmailWindow(new Date(NOW - 71 * HOUR_MS).toISOString(), NOW), true);
  assert.equal(isWithinDailyGmailWindow(new Date(NOW - 72 * HOUR_MS).toISOString(), NOW), true);
});

test('Gmail 待办排除超过 72 小时、未来和无效日期', () => {
  assert.equal(isWithinDailyGmailWindow(new Date(NOW - 72 * HOUR_MS - 1).toISOString(), NOW), false);
  assert.equal(isWithinDailyGmailWindow(new Date(NOW + 1).toISOString(), NOW), false);
  assert.equal(isWithinDailyGmailWindow('invalid-date', NOW), false);
});

test('Gmail 待办使用线程 ID 作为稳定任务键', () => {
  assert.equal(getDailyGmailTaskKey('thread-1', 'message-1'), 'thread-1');
  assert.equal(getDailyGmailTaskKey('', 'message-1'), 'message-1');
});

test('同一邮件不改变完成状态，新外部来信晚于完成时间时重新进入待完成', () => {
  const completedAt = '2026-08-06T10:00:00.000Z';
  assert.equal(resolveIncomingGmailCompletedAt(
    { messageId: 'message-1', completedAt },
    { messageId: 'message-1', date: '2026-08-06T11:00:00.000Z' },
  ), completedAt);
  assert.equal(resolveIncomingGmailCompletedAt(
    { messageId: 'message-1', completedAt },
    { messageId: 'message-2', date: '2026-08-06T11:00:00.000Z' },
  ), undefined);
  assert.equal(resolveIncomingGmailCompletedAt(
    { messageId: 'message-1' },
    { messageId: 'message-2', date: '2026-08-07T11:00:00.000Z' },
  ), undefined);
});

test('最后一封来信之后已经发送回复时自动完成', () => {
  const answeredAt = '2026-08-06T11:00:00.000Z';
  assert.equal(resolveIncomingGmailCompletedAt(
    undefined,
    {
      messageId: 'message-1',
      date: '2026-08-06T10:00:00.000Z',
      answeredAt,
    },
  ), answeredAt);
});

test('线程回复识别忽略旧发件和 Gmail 草稿，只采用最新已发送回复', () => {
  assert.equal(resolveLatestGmailAnswerAt([
    { date: '2026-08-06T09:00:00.000Z', labelIds: ['SENT'] },
    { date: '2026-08-06T11:00:00.000Z', labelIds: ['DRAFT'] },
    { date: '2026-08-06T12:00:00.000Z', labelIds: ['SENT'] },
    { date: '2026-08-06T13:00:00.000Z', labelIds: ['SENT'] },
  ], '2026-08-06T10:00:00.000Z'), '2026-08-06T13:00:00.000Z');
});

test('旧回复早于最新来信时保持待完成，自动完成后出现新来信时重新待办', () => {
  assert.equal(resolveIncomingGmailCompletedAt(
    undefined,
    {
      messageId: 'message-2',
      date: '2026-08-06T12:00:00.000Z',
      answeredAt: '2026-08-06T11:00:00.000Z',
    },
  ), undefined);

  assert.equal(resolveIncomingGmailCompletedAt(
    {
      messageId: 'message-1',
      completedAt: '2026-08-06T11:00:00.000Z',
      answeredAt: '2026-08-06T11:00:00.000Z',
    },
    {
      messageId: 'message-2',
      date: '2026-08-06T12:00:00.000Z',
    },
  ), undefined);
});

test('完成时间按本地日期区分今日已完成和历史已完成', () => {
  const localNow = new Date(2026, 7, 6, 12, 0, 0).getTime();
  assert.equal(isCompletedToday(new Date(2026, 7, 6, 0, 1, 0).toISOString(), localNow), true);
  assert.equal(isCompletedToday(new Date(2026, 7, 5, 23, 59, 0).toISOString(), localNow), false);
  assert.equal(isCompletedToday(undefined, localNow), false);
});
