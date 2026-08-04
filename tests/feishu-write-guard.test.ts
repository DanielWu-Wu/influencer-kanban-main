import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prospect } from '../src/lib/creator-prospecting';
import {
  compareEmailSyncPlan,
  compareProspectWritePlan,
  isProspectWriteBlocked,
} from '../src/lib/feishu-write-guard';

function prospect(overrides: Partial<Prospect> = {}) {
  return {
    schemaVersion: 1,
    id: 'prospect-3',
    inputUrl: 'https://youtube.com/@third',
    workflowStatus: 'resolved',
    emailStatus: 'available',
    dedupeStatus: 'unique',
    resourceStatus: 'exists',
    developmentStatus: 'missing',
    resourceRecordId: 'resource-3',
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  } as Prospect;
}

test('其他红人的飞书变化不会改变当前红人的写入计划', () => {
  const current = prospect();
  const refreshed = prospect({
    duplicateReason: '资源库已收录：频道链接精确匹配',
    updatedAt: '2026-08-04T00:01:00.000Z',
  });

  assert.deepEqual(compareProspectWritePlan(current, refreshed, 'development'), []);
});

test('当前红人出现历史开发记录时要求重新确认并说明原因', () => {
  const reasons = compareProspectWritePlan(
    prospect(),
    prospect({
      developmentStatus: 'history_exists',
      previousDevelopmentRecordId: 'development-history-3',
    }),
    'development',
  );

  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /历史开发记录/);
  assert.equal(isProspectWriteBlocked(
    prospect({
      developmentStatus: 'history_exists',
      previousDevelopmentRecordId: 'development-history-3',
    }),
    'development',
  ), false);
});

test('当前红人已经进入资源库时阻止重复资源建档', () => {
  assert.equal(isProspectWriteBlocked(
    prospect({ resourceStatus: 'exists', resourceRecordId: 'resource-3' }),
    'resource',
  ), true);
});

test('邮箱已由前序操作补全时自动跳过重复补写', () => {
  const result = compareEmailSyncPlan(
    {
      status: 'will_update',
      recordId: 'resource-3',
      fieldName: '联系邮箱',
      currentValue: '',
      nextValue: 'third@example.com',
      appendedEmail: 'third@example.com',
    },
    {
      status: 'already_exists',
      currentValue: 'third@example.com',
      appendedEmail: 'third@example.com',
    },
  );

  assert.equal(result.requiresConfirmation, false);
  assert.match(result.message, /自动跳过/);
});

test('邮箱最终写入内容真正变化时仍要求重新确认', () => {
  const result = compareEmailSyncPlan(
    {
      status: 'will_update',
      recordId: 'resource-3',
      fieldName: '联系邮箱',
      currentValue: '',
      nextValue: 'third@example.com',
      appendedEmail: 'third@example.com',
    },
    {
      status: 'will_update',
      recordId: 'resource-3',
      fieldName: '联系邮箱',
      currentValue: 'other@example.com',
      nextValue: 'other@example.com\nthird@example.com',
      appendedEmail: 'third@example.com',
    },
  );

  assert.equal(result.requiresConfirmation, true);
});
