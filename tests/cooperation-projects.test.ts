import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCooperationCalendarEvents,
  formatCooperationFullDate,
  matchesCooperationStageFilter,
  normalizeCooperationDateSelection,
  shouldShowStageDuration,
  type CooperationProject,
} from '../src/lib/cooperation-projects';

function calendarProject(overrides: Partial<CooperationProject> = {}) {
  return {
    id: 'project-1',
    channelName: 'Demo Creator',
    product: 'Power Station',
    stage: 'filming',
    risks: [],
    milestones: [],
    rawFields: {},
    ...overrides,
  } as CooperationProject;
}

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

test('工作日历生成六类真实合作节点并保持稳定 ID 和本地日期', () => {
  const dates = [11, 12, 13, 14, 15, 16].map((day) => new Date(2026, 7, day, 12).getTime());
  const events = buildCooperationCalendarEvents([calendarProject({
    cooperationDate: dates[0],
    shippingDate: dates[1],
    arrivalDate: dates[2],
    filmingCompleteDate: dates[3],
    expectedPublishDate: dates[4],
    actualPublishDate: dates[5],
  })], new Date(2026, 7, 17, 12).getTime());

  assert.deepEqual(
    events.map((event) => event.kind),
    ['confirmed', 'shipping', 'arrival', 'filming_complete', 'expected_publish', 'published'],
  );
  assert.equal(events[0].id, 'project-1-confirmed');
  assert.equal(events[0].dateKey, '2026-08-11');
  assert.equal(events[4].overdue, false, '已有实际上线日期时预计上线节点不应标记逾期');
});

test('工作日历跳过缺失和推断节点，并突出已逾期的预计上线', () => {
  const expectedPublishDate = new Date(2026, 7, 10, 12).getTime();
  const events = buildCooperationCalendarEvents([calendarProject({
    filmingStartDate: new Date(2026, 7, 8, 12).getTime(),
    expectedPublishDate,
  })], new Date(2026, 7, 11, 12).getTime());

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'expected_publish');
  assert.equal(events[0].dateKey, '2026-08-10');
  assert.equal(events[0].overdue, true);
  assert.equal(events[0].colorClass, 'bg-red-50 text-red-700');
});
