import test from 'node:test';
import assert from 'node:assert/strict';
import { formatLocalDateKey, parseLocalDateKey } from '../src/lib/local-date';

test('日历日期键使用本地年月日，不经过 UTC 转换', () => {
  const localDate = new Date(2026, 6, 11, 0, 0, 0);
  assert.equal(formatLocalDateKey(localDate), '2026-07-11');
});

test('纯日期字符串按本地午夜解析', () => {
  const date = parseLocalDateKey('2026-10-11');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 11);
  assert.equal(date.getHours(), 0);
});
