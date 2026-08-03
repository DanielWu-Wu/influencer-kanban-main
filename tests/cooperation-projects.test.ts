import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCooperationFullDate,
  matchesCooperationStageFilter,
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
