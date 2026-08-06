import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_GMAIL_LOOKBACK_HOURS,
  isWithinDailyGmailWindow,
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
