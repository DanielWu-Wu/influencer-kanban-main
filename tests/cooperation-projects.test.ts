import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCooperationFullDate,
  matchesCooperationStageFilter,
  normalizeCooperationDateSelection,
  shouldShowStageDuration,
} from '../src/lib/cooperation-projects';

test('合作项目阶段时间显示完整中文年月日', () => {
  assert.equal(
    formatCooperationFullDate(Date.UTC(2026, 9, 11, 12)),
    '2026年10月11日',
  );
});

test('合作阶段筛选支持同时显示多个所选阶段', () => {
  const selected = ['in_transit', 'arrived', 'filming'] as const;
  assert.equal(matchesCooperationStageFilter('in_transit', [...selected]), true);
  assert.equal(matchesCooperationStageFilter('arrived', [...selected]), true);
  assert.equal(matchesCooperationStageFilter('filming', [...selected]), true);
  assert.equal(matchesCooperationStageFilter('published', [...selected]), false);
  assert.equal(matchesCooperationStageFilter('published', []), true);
});

test('合作日期选择保存为当天本地中午，避免跨时区偏移到相邻日期', () => {
  const timestamp = normalizeCooperationDateSelection(new Date(2026, 6, 11));
  const normalized = new Date(timestamp);
  assert.equal(normalized.getFullYear(), 2026);
  assert.equal(normalized.getMonth(), 6);
  assert.equal(normalized.getDate(), 11);
  assert.equal(normalized.getHours(), 12);
});

test('仅未完成合作的阶段显示停留天数', () => {
  assert.equal(shouldShowStageDuration('in_transit'), true);
  assert.equal(shouldShowStageDuration('filming'), true);
  assert.equal(shouldShowStageDuration('filming_complete'), true);
  assert.equal(shouldShowStageDuration('published'), false);
});
