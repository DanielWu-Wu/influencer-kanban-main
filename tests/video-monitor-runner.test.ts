import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitorJob, matchVideo, restoreMonitorPendingProgress, type MonitorProject, type MonitorState, type MonitorVideo } from '../src/lib/video-monitor';
import { monitorPool, runMonitor, type MonitorRunnerIO } from '../src/lib/video-monitor-runner';
import { monitorSerialQueue, packMonitorState, unpackMonitorState } from '../src/lib/video-monitor-storage';

const project: MonitorProject = { id: 'rec', name: '频道', channel: 'UCabcdefghijklmnopqrstuv', products: ['P210'], expected: '', discount: '', eligible: true, cooperationDate: 1 };
const videos = (count: number, title = 'AFERIY') => Array.from({ length: count }, (_, i): MonitorVideo => ({ id: `video${String(i).padStart(6, '0')}`, channelId: project.channel, title, description: '', publishedAt: '2026-01-01T00:00:00Z' }));
const makeState = (count: number, title?: string): MonitorState => ({ results: [], continueIds: [], job: {
  ...createMonitorJob([project], [], Date.parse('2026-09-01T00:00:00Z')), phase: 'videos',
  channels: [{ input: project.channel, id: project.channel, playlist: `UU${project.channel.slice(2)}`, projectIds: [project.id], done: true }], videos: videos(count, title),
} });
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
function harness(state: MonitorState) {
  let active = true, saves = 0, sinceSave = 0, inSave = 0, maxSave = 0;
  const requests: string[][] = [], ai: string[] = [];
  const io: MonitorRunnerIO = {
    active: () => active, guard: () => undefined, message: () => undefined, recover: () => undefined,
    save: async () => { inSave++; maxSave = Math.max(maxSave, inSave); await Promise.resolve(); saves++; sinceSave = 0; inSave--; },
    stage: async () => { if (++sinceSave >= 50) await io.save(state); },
    resolve: async () => ({ id: project.channel, playlist: `UU${project.channel.slice(2)}` }),
    page: async () => ({ videos: [], page: '' }),
    subtitles: async ids => { requests.push([...ids]); return { state: 'complete', results: Object.fromEntries(ids.map(id => [id, { state: 'complete', transcript: { text: 'AFERIY P210', segments: [] } }])) }; },
    assess: async (_p, video) => { ai.push(video.id); return { explanation: '依据', timing: 'new', dateExplanation: '' }; }, wait: async () => undefined,
  };
  return { io, requests, ai, pause: () => { active = false; }, stats: () => ({ saves, maxSave }) };
}

test('P3 并行流水线：50 条批次、预取重叠、AI 最多 5 个、保存顺序执行', async () => {
  const state = makeState(105), h = harness(state);
  let activeAi = 0, maxAi = 0;
  const original = h.io.assess;
  h.io.assess = async (...args) => {
    activeAi++; maxAi = Math.max(maxAi, activeAi);
    if (args[1].id === state.job!.videos[0].id) assert.equal(h.requests.length, 2, '下一批在当前批 AI 分析前已启动');
    await new Promise(resolve => setTimeout(resolve, 1));
    const value = await original(...args); activeAi--; return value;
  };
  await runMonitor(state, { enabled: true, maxSubtitles: 105, maxAi: 105 }, h.io);
  assert.deepEqual(h.requests.map(ids => ids.length), [50, 50, 5]);
  assert.equal(new Set(h.requests.flat()).size, 105);
  assert.equal(maxAi, 5); assert.equal(h.stats().maxSave, 1);
  assert.equal(state.job!.cursor, 105); assert.equal(state.job!.phase, 'done');
  assert.equal(state.results.length, 105);
  assert.ok(h.stats().saves < 15, '不再逐条保存整份结果');
});

test('P3 乱序完成后暂停，恢复跳过已完成 ID，未完成视频不会漏掉', async () => {
  const state = makeState(6, 'AFERIY P210'), h = harness(state), gate = deferred(), firstStarted = deferred();
  const original = h.io.assess;
  h.io.assess = async (...args) => {
    if (args[1].id === state.job!.videos[0].id) { firstStarted.resolve(); await gate.promise; }
    else { h.pause(); gate.resolve(); }
    return original(...args);
  };
  await runMonitor(state, { enabled: true, maxSubtitles: 50, maxAi: 50 }, h.io);
  await firstStarted.promise;
  const complete = new Set(state.job!.completedVideoIds);
  assert.ok(complete.size > 0 && complete.size < 6);
  const restored = structuredClone(state), second = harness(restored);
  await runMonitor(restored, { enabled: true, maxSubtitles: 50, maxAi: 50 }, second.io);
  assert.ok(second.ai.every(id => !complete.has(id)));
  assert.equal(restored.job!.cursor, 6); assert.equal(restored.results.length, 6);
});

test('P3 暂停预取后恢复原批次，AI/字幕预算不会因并行超额', async () => {
  const state = makeState(110), h = harness(state), original = h.io.assess;
  h.io.assess = async (...args) => { h.pause(); return original(...args); };
  await runMonitor(state, { enabled: true, maxSubtitles: 60, maxAi: 2 }, h.io);
  assert.deepEqual(h.requests.map(ids => ids.length), [50, 10]);
  assert.deepEqual(state.job!.subtitleBatches, [h.requests[1]]);
  assert.ok(h.ai.length <= 2);
  const resume = harness(state);
  await runMonitor(state, { enabled: true, maxSubtitles: 10, maxAi: 2 }, resume.io);
  assert.deepEqual(resume.requests, [h.requests[1]], '先接续已提交批次，不重新分组');
  assert.ok(resume.ai.length <= 2);
});

test('P3 未变化结果复用；多产品、多合作独立匹配；字幕无命中与失败区分', async () => {
  const state = makeState(3, 'Review');
  const other = { ...project, id: 'second', products: ['P280'] };
  state.job!.projects.push(other); state.job!.channels[0].projectIds.push(other.id);
  const h = harness(state);
  h.io.subtitles = async ids => ({ state: 'complete', results: {
    [ids[0]]: { state: 'complete', transcript: { text: 'P210', segments: [] } },
    [ids[1]]: { state: 'complete', transcript: { text: 'No brand here', segments: [] } },
    [ids[2]]: { state: 'unavailable', error: '本批未取得可用字幕' },
  } });
  await runMonitor(state, { enabled: true, maxSubtitles: 50, maxAi: 50 }, h.io);
  assert.deepEqual(state.results.slice().sort((a, b) => a.video.id.localeCompare(b.video.id) || a.project.id.localeCompare(b.project.id)).map(r => r.status), ['pending', 'no_match', 'no_match', 'no_match', 'incomplete', 'incomplete']);
  assert.equal(h.ai.length, 1);
  state.job!.phase = 'videos'; state.job!.cursor = 0; state.job!.completedVideoIds = [];
  const next = harness(state);
  await runMonitor(state, { enabled: true, maxSubtitles: 50, maxAi: 50 }, next.io);
  assert.equal(next.requests.length, 0); assert.equal(next.ai.length, 0);
});

test('P3 频道同时最多 3 个、频道内顺序分页、别名保留全部合作', async () => {
  const projects = Array.from({ length: 5 }, (_, i) => ({ ...project, id: `p${i}`, channel: `@channel${i}` }));
  projects.push({ ...project, id: 'alias', channel: '@alias' });
  const state: MonitorState = { results: [], continueIds: [], job: createMonitorJob(projects, [], Date.now()) };
  const h = harness(state); let active = 0, max = 0;
  h.io.resolve = async input => ({ id: input === '@alias' ? '@channel0' : input, playlist: input });
  const calls = new Map<string, string[]>();
  h.io.page = async (id, _playlist, page) => {
    active++; max = Math.max(max, active);
    calls.set(id, [...(calls.get(id) || []), page || 'first']);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return { videos: [], page: page ? '' : 'second' };
  };
  await runMonitor(state, { enabled: true, maxSubtitles: 50, maxAi: 50 }, h.io);
  assert.equal(max, 3); assert.equal(calls.size, 5);
  assert.ok([...calls.values()].every(pages => JSON.stringify(pages) === '["first","second"]'));
  assert.deepEqual(state.job!.channels[0].projectIds, ['p0', 'alias']);
});

test('P3 池出错先等待已启动任务，不留下迟到结果写入；保存队列失败即停', async () => {
  let finished = false;
  await assert.rejects(() => monitorPool([1, 2, 3], 2, () => true, async n => {
    if (n === 1) throw new Error('failed');
    await new Promise(resolve => setTimeout(resolve, 5)); finished = true;
  }), /failed/);
  assert.equal(finished, true);
  const queue = monitorSerialQueue(); let writes = 0;
  const first = queue(async () => { writes++; throw new Error('save failed'); });
  const second = queue(async () => { writes++; });
  await Promise.allSettled([first, second]); assert.equal(writes, 1);
});

test('P3 去重保存可还原历史版本；乱序本机增量按已完成 ID 恢复', () => {
  const state = makeState(3); const job = state.job!;
  state.results = job.videos.map(video => ({ key: `${project.id}:${video.id}`, project, video, evidence: matchVideo(project, video), status: 'pending', checkedAt: 1 }));
  state.results.push({ ...state.results[0], video: { ...job.videos[0], title: 'old' } });
  const packed = packMonitorState(state);
  assert.deepEqual(JSON.parse(JSON.stringify(unpackMonitorState(JSON.parse(JSON.stringify(packed))))), JSON.parse(JSON.stringify(state)));
  assert.equal(packed.projects.length, 1); assert.equal(packed.videos.length, 4);
  const pending = { version: 1 as const, revision: 'r', startedAt: job.startedAt, cursor: 1, completedVideoIds: [job.videos[2].id], results: [state.results[2]] };
  state.saveId = 'acknowledged-cloud-checkpoint';
  assert.equal(restoreMonitorPendingProgress(state, 'r', pending)?.saveId, undefined, '本机增量不能沿用云端已确认保存编号');
  assert.deepEqual(restoreMonitorPendingProgress(state, 'r', pending)?.job?.completedVideoIds, [job.videos[2].id]);
  assert.equal(restoreMonitorPendingProgress(state, 'r', { ...pending, completedVideoIds: ['wrong'] }), null);
});
