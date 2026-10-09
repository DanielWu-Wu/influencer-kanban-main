import test from 'node:test';
import { applyMonitorDecision } from '../src/lib/video-monitor';
import { encodeMonitorCloud, decodeMonitorCloud } from '../src/lib/video-monitor-cloud-codec';
import assert from 'node:assert/strict';
import { channelIdentity, channelPageIsBeforeStart, channelScanStart, createMonitorJob, hasStrongVideoEvidence, matchVideo, monitorProjects, normalizeTranscript, normalizeVideoAssessment, restoreMonitorPendingProgress, resultKey, type MonitorProject, type MonitorState, type MonitorVideo } from '../src/lib/video-monitor';
import type { FeishuFieldMapping } from '../src/lib/feishu-mapping';
import { fetchMonitorVideoPage, monitorTableKey, resolveMonitorChannel, monitorTranscript, monitorTranscriptBatch, readMonitorData, writeMonitorData, saveMonitorCheckpoint, MonitorSaveError } from '../src/lib/video-monitor-server';
import type { SupabaseClient } from '@supabase/supabase-js';

const project: MonitorProject = { id: 'rec1', name: '测试频道', channel: 'UCabcdefghijklmnopqrstuv', products: ['P210', 'S400A1'], expected: '', discount: '', eligible: true };
const video: MonitorVideo = { id: 'abcdefghijk', channelId: project.channel, title: 'Review', description: '', publishedAt: '2026-09-23T12:00:00Z' };
const EMPTY_FEISHU_MAPPING = {} as FeishuFieldMapping;

test('P3 批量审核只更新勾选关联，不连带同视频其他合作，不修改原状态', () => {
  const first = { key: resultKey(project.id, video.id), project, video, evidence: [], status: 'pending' as const, checkedAt: 1 };
  const second = { ...first, key: resultKey('rec2', video.id), project: { ...project, id: 'rec2' } };
  const state: MonitorState = { results: [first, second], continueIds: ['rec2'], job: createMonitorJob([project], []) };
  const next = applyMonitorDecision(state, [first.key, first.key, 'missing'], 'confirmed');
  assert.deepEqual(next.results.map(item => item.status), ['confirmed', 'pending']);
  assert.equal(first.status, 'pending');
  assert.equal(next.results[1], second);
  assert.equal(next.job, state.job);
  assert.equal(next.continueIds, state.continueIds);
  assert.deepEqual(applyMonitorDecision(state, [], 'excluded'), state);
  assert.deepEqual(applyMonitorDecision(state, [first.key, second.key], 'excluded').results.map(item => item.status), ['excluded', 'excluded']);
});
test('P3 大记录无损压缩，旧格式兼容，损坏压缩拒绝读取', () => {
  const value = { saveId: 'checkpoint', videos: Array.from({ length: 2135 }, (_, id) => ({ id, text: '中文字幕 😀 descripción '.repeat(80) })), brokenOldQuote: '\ud83d' };
  const encoded = encodeMonitorCloud(value);
  assert.ok(JSON.stringify(encoded).length < JSON.stringify(value).length / 5);
  assert.deepEqual(decodeMonitorCloud(encoded), value);
  assert.deepEqual(decodeMonitorCloud({ old: true }), { old: true });
  assert.throws(() => decodeMonitorCloud({ monitorEncoding: 'gzip-base64-v1', payload: 'broken' }));
});
test('P3 文字摘录和 AI 说明截断不产生半个 emoji', () => {
  const suffix = 'AFERIY' + ' '.repeat(159) + '😀';
  assert.equal(matchVideo(project, { ...video, description: suffix })[0].quote, suffix);
  const prefix = '😀' + ' '.repeat(89) + 'AFERIY';
  assert.equal(matchVideo(project, { ...video, description: prefix })[0].quote, prefix);
  const explanation = 'a'.repeat(1799) + '😀';
  assert.equal(normalizeVideoAssessment({ explanation }, project).explanation, explanation);
});
const row = (fields: Record<string, unknown>) => ({ record_id: 'rec1', fields: { '推广平台': ['YouTube', 'TikTok'], '合作产品': ['P210', 'S400A1'], ...fields } });

test('P3 50 条云端检查点之间的本机增量可恢复，拒绝旧版本和别的合作', () => {
  const second = { ...video, id: 'lmnopqrstuv' };
  const job = { ...createMonitorJob([project], [], 1000), videos: [video, second], cursor: 1, phase: 'videos' as const };
  const firstResult = { key: resultKey(project.id, video.id), project, video, evidence: [], status: 'incomplete' as const, checkedAt: 1 };
  const secondResult = { ...firstResult, key: resultKey(project.id, second.id), video: second, checkedAt: 2 };
  const cloud: MonitorState = { results: [firstResult], continueIds: [], job };
  const queued = { version: 1 as const, revision: 'rev1', startedAt: 1000, cursor: 2, results: [secondResult] };
  const restored = restoreMonitorPendingProgress(cloud, 'rev1', queued);
  assert.equal(restored?.job?.cursor, 2);
  assert.deepEqual(restored?.results.map(result => result.key), [firstResult.key, secondResult.key]);
  assert.equal(restoreMonitorPendingProgress(cloud, 'rev2', queued), null);
  assert.equal(restoreMonitorPendingProgress(cloud, 'rev1', { ...queued, results: [{ ...secondResult, key: 'other:video' }] }), null);
});

test('P3 仅同时缺少实际上线日期和链接才默认纳入，保留多产品', () => {
  const blank = monitorProjects([row({})], EMPTY_FEISHU_MAPPING)[0];
  assert.equal(blank.eligible, true);
  assert.deepEqual(blank.products, ['P210', 'S400A1']);
  for (const fields of [{ 实际上线日期: '无效但非空' }, { 视频上线链接: '已有链接' }, { 实际上线日期: 1780000000000 }]) {
    assert.equal(monitorProjects([row(fields)], EMPTY_FEISHU_MAPPING)[0].eligible, false);
  }
});
test('P3 非 YouTube 项目不纳入，字段映射优先，预计原文保留', () => {
  assert.equal(monitorProjects([row({ 推广平台: ['TikTok'] })], EMPTY_FEISHU_MAPPING).length, 0);
  const result = monitorProjects([row({ 约定: '9月上旬', 产品: ['Nomad1800 Pro', 'AF-SA100*2'] })], { ...EMPTY_FEISHU_MAPPING, expectedPublishDate: '约定', cooperationProduct: '产品' })[0];
  assert.equal(result.expected, '9月上旬');
  assert.deepEqual(result.products, ['Nomad1800 Pro', 'AF-SA100']);
});
test('P3 按频道分组但不合并重复合作，可额外监测已上线合作', () => {
  const second = { ...project, id: 'rec2', products: ['P280'], eligible: false };
  assert.equal(createMonitorJob([project, second], []).projects.length, 1);
  const job = createMonitorJob([project, second], ['rec2']);
  assert.equal(job.channels.length, 1);
  assert.deepEqual(job.channels[0].projectIds, ['rec1', 'rec2']);
  assert.notEqual(resultKey('rec1', video.id), resultKey('rec2', video.id));
  assert.notEqual(resultKey('rec1', video.id), resultKey('rec1', 'other-video'));
});
test('P3 各频道只用自己的最早合作日期作扫描边界', () => {
  const now = Date.parse('2026-09-24T00:00:00Z');
  const older = { ...project, id: 'older', cooperationDate: Date.parse('2025-01-01T00:00:00Z') };
  const recent = { ...project, id: 'recent', channel: 'UCzzzzzzzzzzzzzzzzzzzzzz', cooperationDate: Date.parse('2026-09-01T00:00:00Z') };
  assert.equal(channelScanStart([older, recent], ['recent'], now), recent.cooperationDate);
  assert.equal(channelScanStart([older, recent], ['older'], now), older.cooperationDate);
  assert.equal(channelScanStart([{ ...recent, cooperationDate: undefined }], ['recent'], now), now - 180 * 86400000);
});
test('P3 整页视频早于合作日期时停止历史翻页，混合页继续', () => {
  const start = Date.parse('2026-09-01T00:00:00Z');
  const old = { ...video, publishedAt: '2026-08-31T23:59:59Z' };
  assert.equal(channelPageIsBeforeStart([old, old], start), true);
  assert.equal(channelPageIsBeforeStart([old, { ...video, publishedAt: '2026-09-01T00:00:00Z' }], start), false);
  assert.equal(channelPageIsBeforeStart([], start), false);
});
test('P3 频道解析拒绝外站、相似域名和昵称猜测', () => {
  assert.deepEqual(channelIdentity('https://youtube.com.evil.test/@demo'), {});
  assert.deepEqual(channelIdentity('频道名字'), {});
  assert.deepEqual(channelIdentity('https://www.youtube.com/@demo/videos'), { handle: '@demo' });
  assert.deepEqual(channelIdentity(`https://youtube.com/channel/${project.channel}`), { id: project.channel });
});
test('P3 型号边界不会把 P2100、P210-B 识别为 P210', () => {
  assert.equal(matchVideo(project, { ...video, title: 'P2100 P210-B' }).length, 0);
  assert.equal(matchVideo(project, { ...video, title: '测试P210产品' })[0].term, 'P210');
  assert.equal(matchVideo(project, { ...video, title: 'P210 / S400A1' }).length, 2);
});
test('P3 品牌加准确型号为较强线索，单品牌不是强证据', () => {
  const weak = matchVideo(project, { ...video, title: 'Aferiy review' });
  assert.equal(hasStrongVideoEvidence(project, weak), false);
  const strong = matchVideo(project, { ...video, title: 'AFERIY P210 review' });
  assert.equal(hasStrongVideoEvidence(project, strong), true);
});
test('P3 完整字幕末尾仍参与匹配，保留命中时间', () => {
  const transcript = normalizeTranscript([{ id: video.id, transcript_only_text: `${'abc '.repeat(6000)} Aferiy`, transcript: [{ text: 'Aferiy', startMs: '122000' }] }], video.id)!;
  const evidence = matchVideo(project, video, transcript);
  assert.equal(evidence[0].source, '字幕');
  assert.equal(evidence[0].start, 122);
});
test('P3 无字幕、错视频、超长截断不冒充完整文本', () => {
  assert.equal(normalizeTranscript([], video.id), null);
  assert.equal(normalizeTranscript([{ id: 'other', transcript_only_text: 'AFERIY' }], video.id), null);
  assert.equal(normalizeTranscript([{ id: video.id, transcript_only_text: 'x'.repeat(500001) }], video.id), null);
});
test('P3 没有预计时间为新发布，缺年份不采纳 AI 的提前结论', () => {
  assert.equal(normalizeVideoAssessment({ explanation: '证据', timing: 'early' }, project).timing, 'new');
  assert.equal(normalizeVideoAssessment({ explanation: '证据', timing: 'early' }, { ...project, expected: '10月8日' }).timing, 'uncertain');
  assert.throws(() => normalizeVideoAssessment({}, project));
});
test('P3 同表不同视图共用记录，不同表隔离', () => {
  assert.equal(monitorTableKey('https://example.feishu.cn/base/demo?table=one&view=a'), monitorTableKey('https://example.feishu.cn/base/demo?table=one&view=b'));
  assert.notEqual(monitorTableKey('https://example.feishu.cn/base/demo?table=one'), monitorTableKey('https://example.feishu.cn/base/demo?table=two'));
});
test('P3 YouTube 使用视频真实公开时间、分页、保留短视频、过滤其他频道', async () => {
  const original = global.fetch;
  const calls: string[] = [];
  global.fetch = async input => {
    const url = new URL(String(input)); calls.push(url.pathname);
    return Response.json(url.pathname.endsWith('playlistItems') ? { items: [{ contentDetails: { videoId: video.id } }], nextPageToken: 'next' }
      : { items: [
        { id: video.id, snippet: { ...video, publishedAt: video.publishedAt }, status: { privacyStatus: 'public' } },
        { id: 'other', snippet: { ...video, channelId: 'other' }, status: { privacyStatus: 'public' } },
      ] });
  };
  try {
    const result = await fetchMonitorVideoPage('mock-key', project.channel, `UU${project.channel.slice(2)}`);
    assert.equal(result.videos.length, 1); assert.equal(result.page, 'next');
    assert.equal(result.videos[0].publishedAt, video.publishedAt);
    assert.equal(calls.length, 2);
    await assert.rejects(() => fetchMonitorVideoPage('mock-key', project.channel, 'wrong'));
  } finally { global.fetch = original; }
});
test('P3 不可解析频道不触发 YouTube 搜索', async () => {
  await assert.rejects(() => resolveMonitorChannel('unused', '名字'), /无法核实/);
});

function mockDatabase() {
  const rows: Record<string, unknown>[] = [];
  return { from() {
    let mode = 'read'; let value: Record<string, unknown> = {}; const filters: [string, unknown][] = [];
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      insert(next: Record<string, unknown>) { mode = 'insert'; value = structuredClone(next); return query; },
      update(next: Record<string, unknown>) { mode = 'update'; value = structuredClone(next); return query; },
      async maybeSingle() { return { data: rows.find(row => filters.every(([key, value]) => row[key] === value)) || null, error: null }; },
      then(resolve: (value: unknown) => unknown) {
        if (mode === 'insert') {
          if (rows.some(r => r.user_id === value.user_id && r.data_key === value.data_key)) return Promise.resolve(resolve({ error: { code: 'duplicate' }, data: [] }));
          rows.push(value); return Promise.resolve(resolve({ data: [value], error: null }));
        }
        const found = rows.find(row => filters.every(([key, value]) => row[key] === value));
        if (found) Object.assign(found, value);
        return Promise.resolve(resolve({ data: found ? [found] : [], error: null }));
      },
    }; return query;
  } } as unknown as SupabaseClient;
}

test('P3 压缩检查点保存、读取、丢响应重试和冲突保护', async () => {
  const db = mockDatabase();
  const value = { results: ['视频简介 😀 '.repeat(40000)] };
  const revision = await saveMonitorCheckpoint(db, 'alice', 'p3', value, null, 'large-save');
  assert.deepEqual((await readMonitorData(db, 'alice', 'p3'))?.value, { ...value, saveId: 'large-save' });
  assert.equal(await saveMonitorCheckpoint(db, 'alice', 'p3', value, null, 'large-save'), revision);
  await assert.rejects(() => saveMonitorCheckpoint(db, 'alice', 'p3', value, null, 'other-save'), error => error instanceof MonitorSaveError && error.code === 'SAVE_CONFLICT');
});

test('P3 数据按账号隔离，过期版本不能覆盖', async () => {
  const db = mockDatabase();
  await writeMonitorData(db, 'alice', 'p3', { results: ['alice'] }, null);
  assert.equal(await readMonitorData(db, 'bob', 'p3'), null);
  await assert.rejects(() => writeMonitorData(db, 'alice', 'p3', { results: [] }, 'old-revision'));
  assert.deepEqual((await readMonitorData(db, 'alice', 'p3'))?.value, { results: ['alice'] });
});
test('P3 保存成功但响应丢失：重试同一标识返回原版本；真实冲突不覆盖', async () => {
  const db = mockDatabase();
  const revision = await saveMonitorCheckpoint(db, 'alice', 'p3', { results: ['saved'] }, null, 'save-one');
  assert.equal(await saveMonitorCheckpoint(db, 'alice', 'p3', { results: ['saved'] }, null, 'save-one'), revision);
  await assert.rejects(() => saveMonitorCheckpoint(db, 'alice', 'p3', { results: ['other'] }, null, 'save-two'),
    error => error instanceof MonitorSaveError && error.code === 'SAVE_CONFLICT');
  assert.deepEqual((await readMonitorData(db, 'alice', 'p3'))?.value, { results: ['saved'], saveId: 'save-one' });
});
test('P3 临时数据库故障不再伪装成另一窗口冲突', async () => {
  const chain = { update: () => chain, eq: () => chain, select: () => chain,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: null, error: { code: '57014' } })) };
  const db = { from: () => chain } as unknown as SupabaseClient;
  await assert.rejects(() => writeMonitorData(db, 'alice', 'p3', {}, '2026-01-01T00:00:00Z'),
    error => error instanceof MonitorSaveError && error.code === 'SAVE_UNAVAILABLE');
});
test('P3 字幕提交前占位；超时后不再次创建收费任务', async () => {
  const db = mockDatabase(); const original = global.fetch; let calls = 0;
  const config = { token: 'test-token', enabled: true, maxAi: 50, maxSubtitles: 50 };
  global.fetch = async () => { calls += 1; throw new Error('network timeout'); };
  try {
    await assert.rejects(() => monitorTranscript(db, 'alice', config, video.id));
    const result = await monitorTranscript(db, 'alice', config, video.id);
    assert.equal(result.state, 'starting'); assert.equal(calls, 1);
    await monitorTranscript(db, 'alice', config, video.id, { retry: true });
    assert.equal(calls, 1, 'even explicit retry cannot duplicate an ambiguous submission');
  } finally { global.fetch = original; }
});
test('P3 字幕异步运行只提交一次，完成后复用缓存', async () => {
  const db = mockDatabase(); const original = global.fetch; const calls: string[] = [];
  const config = { token: 'test-token', enabled: true, maxAi: 50, maxSubtitles: 50 };
  global.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(`${init?.method || 'GET'}:${url.pathname}`);
    assert.equal(url.searchParams.has('token'), false, 'token must not appear in URL');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    if (url.pathname.endsWith('/runs')) return Response.json({ data: { id: 'run1' } });
    if (url.pathname.includes('actor-runs')) return Response.json({ data: { status: 'SUCCEEDED', defaultDatasetId: 'dataset1' } });
    return Response.json([{ id: video.id, transcript_only_text: 'Aferiy P210', transcript: [{ text: 'Aferiy', startMs: '500' }] }]);
  };
  try {
    assert.equal((await monitorTranscript(db, 'alice', config, video.id)).state, 'running');
    assert.equal((await monitorTranscript(db, 'alice', config, video.id)).state, 'complete');
    assert.equal((await monitorTranscript(db, 'alice', config, video.id)).state, 'complete');
    assert.equal(calls.length, 3); assert.equal(calls.filter(c => c.startsWith('POST')).length, 1);
  } finally { global.fetch = original; }
});

test('P3 字幕明确被拒绝时保留可重试状态，不锁成状态不明', async () => {
  const db = mockDatabase(); const original = global.fetch; let calls = 0;
  const config = { token: 'test-token', enabled: true, maxAi: 50, maxSubtitles: 50 };
  global.fetch = async () => { calls += 1; return Response.json({}, { status: 401 }); };
  try {
    assert.equal((await monitorTranscript(db, 'alice', config, video.id)).state, 'unavailable');
    await monitorTranscript(db, 'alice', config, video.id);
    assert.equal(calls, 1, 'ordinary continuation does not resubmit');
    await monitorTranscript(db, 'alice', config, video.id, { retry: true });
    assert.equal(calls, 2, 'only explicit retry resubmits a rejected request');
  } finally { global.fetch = original; }
});

test('P3 字幕 50 条合并为一次运行，按视频 ID 回填并复用缓存', async () => {
  const db = mockDatabase(); const original = global.fetch; const calls: string[] = []; let polls = 0;
  const ids = Array.from({ length: 50 }, (_, index) => `batch${String(index).padStart(6, '0')}`);
  const config = { token: 'test-token', enabled: true, maxAi: 50, maxSubtitles: 50 };
  global.fetch = async (input, init) => {
    const url = new URL(String(input)); calls.push(`${init?.method || 'GET'}:${url.pathname}`);
    if (url.pathname.endsWith('/runs')) {
      assert.equal(url.searchParams.get('maxItems'), '50');
      assert.equal(JSON.parse(String(init?.body)).videoUrls.length, 50);
      return Response.json({ data: { id: 'batchrun1' } });
    }
    if (url.pathname.includes('actor-runs')) return Response.json({ data: ++polls === 1 ? { status: 'RUNNING' } : { status: 'SUCCEEDED', defaultDatasetId: 'dataset1' } });
    return Response.json([{ id: ids[0], transcript_only_text: 'Aferiy P210', transcript: [] }]);
  };
  try {
    assert.equal((await monitorTranscriptBatch(db, 'alice', config, ids)).state, 'running');
    const result = await monitorTranscriptBatch(db, 'alice', config, ids);
    assert.equal(result.state, 'complete');
    assert.equal(result.results[ids[0]].state, 'complete');
    assert.equal(result.results[ids[1]].state, 'unavailable');
    await monitorTranscriptBatch(db, 'alice', config, ids);
    assert.equal(calls.filter(call => call.startsWith('POST')).length, 1);
  } finally { global.fetch = original; }
});

test('P3 批量字幕提交超时后不重复创建任务', async () => {
  const db = mockDatabase(); const original = global.fetch; let calls = 0;
  const config = { token: 'test-token', enabled: true, maxAi: 50, maxSubtitles: 50 };
  global.fetch = async () => { calls += 1; throw new Error('network timeout'); };
  try {
    assert.equal((await monitorTranscriptBatch(db, 'alice', config, [video.id])).state, 'starting');
    assert.equal((await monitorTranscriptBatch(db, 'alice', config, [video.id])).state, 'starting');
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});
