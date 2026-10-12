import test from 'node:test';
import assert from 'node:assert/strict';
import { compactCompletedMonitor, conflictingMonitorKeys, monitorCategory, monitorNeedsAttention, preferredMonitorCategory, reconcileMonitorLinks } from '../src/lib/video-monitor-workflow';
import { monitorRetentionCandidates, monitorProtectedStorage, type MonitorStorageRow } from '../src/lib/video-monitor-retention';
import { applyMonitorDecision, createMonitorJob, type MonitorResult, type MonitorState } from '../src/lib/video-monitor';
import { packMonitorState, unpackMonitorState } from '../src/lib/video-monitor-storage';
import type { FeishuFieldMapping } from '../src/lib/feishu-mapping';

const project = { id: 'rec1', name: 'Creator', channel: 'UCabcdefghijklmnopqrstuv', products: ['P210'], expected: '', discount: '', eligible: true };
const video = { id: 'abcdefghijk', channelId: project.channel, title: 'AFERIY P210', description: 'large description', publishedAt: '2026-10-01T00:00:00Z' };
const base: MonitorResult = { key: 'rec1:abcdefghijk', project, video, status: 'confirmed', checkedAt: 1, evidence: [{ source: '简介', term: 'AFERIY', quote: 'evidence' }] };
const mapping = { publishedVideoUrl: 'Link' } as FeishuFieldMapping;
const state = (...results: MonitorResult[]): MonitorState => ({ results, continueIds: [] });

test('旧确认状态按同步时间分入待写回和已完成，完成历史兼容存储', () => {
  assert.equal(monitorCategory(base), 'ready');
  const done = { ...base, feishuSyncedAt: 100 };
  assert.equal(monitorCategory(done), 'done');
  assert.equal(preferredMonitorCategory(state(done, base)), 'ready');
  assert.equal(preferredMonitorCategory(state(done)), 'done');
  assert.equal(monitorNeedsAttention(state(done)), false);
  assert.equal(monitorNeedsAttention(state({ ...base, writeAttempt: { token: 'saved' } })), true);
  assert.deepEqual(unpackMonitorState(packMonitorState(state(done))).results, [done]);
});
test('已完成及未知提交不能批量返回审核或排除，普通待写回可直接返回', () => {
  const done = { ...base, key: 'done', feishuSyncedAt: 100 };
  const unknown = { ...base, key: 'unknown', writeAttempt: { token: 'saved' } };
  const next = applyMonitorDecision(state(base, done, unknown), [base.key, 'done', 'unknown'], 'pending');
  assert.deepEqual(next.results.map(x => x.status), ['pending', 'confirmed', 'confirmed']);
  assert.equal(next.results[1], done); assert.equal(next.results[2], unknown);
});
test('同合作多个不同视频全被阻止，同视频不同合作互不影响', () => {
  const second = { ...base, key: 'rec1:other', video: { ...video, id: 'lmnopqrstuv' } };
  const other = { ...base, key: 'rec2:abcdefghijk', project: { ...project, id: 'rec2' } };
  assert.deepEqual([...conflictingMonitorKeys([base, second, other])], [base.key, second.key]);
  assert.equal(conflictingMonitorKeys([base, other]).size, 0);
});
test('飞书同视频才精简完成详情，链接冲突、记录缺失、未知提交保留', () => {
  const done = { ...base, feishuSyncedAt: 100 };
  const records = [{ record_id: 'rec1', fields: { Link: { link: `https://youtu.be/${video.id}` } } }];
  const compact = compactCompletedMonitor(state(done), records, mapping, 200);
  assert.equal(compact.count, 1); assert.equal(compact.state.results[0].video.description, '');
  assert.equal(compact.state.results[0].video.id, video.id); assert.equal(compact.state.results[0].feishuSyncedAt, 100);
  assert.equal(compactCompletedMonitor(state(done), [], mapping).count, 0);
  assert.equal(compactCompletedMonitor(state(done), [{ record_id: 'rec1', fields: { Link: 'https://youtu.be/lmnopqrstuv' } }], mapping).count, 0);
  assert.equal(compactCompletedMonitor(state({ ...done, writeAttempt: { token: 'saved' } }), records, mapping).count, 0);
  assert.equal(done.video.description, 'large description');
});
test('清空飞书链接后重新审核；其他链接不静默认领；缺失记录不丢弃', () => {
  const done = { ...base, feishuSyncedAt: 100, compactedAt: 200 };
  const reopened = reconcileMonitorLinks(state(done), [{ record_id: 'rec1', fields: { Link: '' } }], mapping).results[0];
  assert.equal(reopened.status, 'pending'); assert.equal(reopened.feishuSyncedAt, undefined); assert.equal(reopened.checkedAt, 0);
  assert.equal(reconcileMonitorLinks(state(done), [], mapping).results[0], done);
  assert.equal(reconcileMonitorLinks(state(done), [{ record_id: 'rec1', fields: { Link: 'another video' } }], mapping).results[0], done);
});
test('未完成工作保留扫描资料，所有已完成才精简扫描视频池', () => {
  const job = { ...createMonitorJob([project], []), phase: 'done' as const, channels: [{ input: project.channel, projectIds: [project.id], done: true }], videos: [video], cursor: 1 };
  assert.equal(compactCompletedMonitor({ ...state(base), job }, [], mapping).state.job?.videos.length, 1);
  assert.equal(compactCompletedMonitor({ ...state({ ...base, feishuSyncedAt: 1 }), job }, [], mapping).state.job?.videos.length, 0);
});
const now = Date.parse('2026-10-10T00:00:00Z');
const old = new Date(now - 100 * 86400000).toISOString();
const row = (key: string, data: unknown, updated_at = old): MonitorStorageRow => ({ data_key: key, data, updated_at });
test('清理遵守90天和7天边界，保护跨表引用及未知收费/写回任务', () => {
  const rows = [row('video_monitor_table', state({ ...base, writeAttempt: { token: 'active' } })),
    row('video_transcript_abcdefghijk', { state: 'complete' }), row('video_transcript_lmnopqrstuv', { state: 'complete' }),
    row('video_transcript_batch_old', { state: 'complete', videoIds: ['abcdefghijk', 'lmnopqrstuv'] }),
    row('video_transcript_running', { state: 'running' }), row('video_transcript_new', { state: 'complete' }, new Date(now - 89 * 86400000).toISOString()),
    row('video_write_active', {}), row('video_write_unknown', { submittingAt: 1 }), row('video_write_done', { submittingAt: 1, completedAt: 2 }), row('video_write_unused', {}),
    row('video_cleanup_old', {}), row('video_write_new', {}, new Date(now - 6 * 86400000).toISOString())];
  assert.deepEqual(monitorRetentionCandidates(rows, now).map(x => x.data_key), ['video_transcript_lmnopqrstuv', 'video_write_done', 'video_write_unused', 'video_cleanup_old']);
  assert.ok(monitorProtectedStorage(rows).tokens.has('video_write_active'));
});
test('清理拒绝损坏历史，保留没有视频清单的旧批次', () => {
  assert.throws(() => monitorRetentionCandidates([row('video_monitor_bad', {})], now));
  assert.equal(monitorRetentionCandidates([row('video_transcript_batch_legacy', { state: 'complete' })], now).length, 0);
});
test('排除历史仅精简详情，恢复审核仍保留视频与合作身份', () => {
  const excluded = { ...base, status: 'excluded' as const };
  const cleaned = compactCompletedMonitor(state(excluded), [], mapping).state;
  assert.equal(cleaned.results[0].evidence.length, 0);
  const restored = applyMonitorDecision(cleaned, [base.key], 'pending').results[0];
  assert.equal(restored.status, 'pending'); assert.equal(restored.project.id, project.id); assert.equal(restored.video.id, video.id);
});
