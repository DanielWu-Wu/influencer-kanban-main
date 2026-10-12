import { channelPageIsBeforeStart, channelScanStart, hasStrongVideoEvidence, matchVideo, projectScanStart, resultKey, sameProjectInput,
  type MonitorState, type MonitorResult, type MonitorProject, type MonitorVideo, type VideoAssessment, type Transcript } from './video-monitor';
import { monitorSerialQueue } from './video-monitor-storage';

export type MonitorSubtitle = { state: 'starting' | 'running' | 'complete' | 'unavailable'; runId?: string; transcript?: Transcript; error?: string };
export type MonitorSubtitleBatch = { state: 'starting' | 'running' | 'complete'; runId?: string; error?: string; results: Record<string, MonitorSubtitle> };
export type MonitorOptions = { enabled: boolean; maxSubtitles: number; maxAi: number };
export type MonitorRunnerIO = {
  active: () => boolean; guard: () => void; message: (text: string) => void;
  save: (state: MonitorState) => Promise<void>;
  stage: (state: MonitorState, changed: MonitorResult[]) => Promise<void>;
  resolve: (input: string) => Promise<{ id: string; playlist: string }>;
  page: (id: string, playlist: string, page?: string) => Promise<{ videos: MonitorVideo[]; page: string }>;
  subtitles: (ids: string[]) => Promise<MonitorSubtitleBatch>;
  assess: (project: MonitorProject, video: MonitorVideo, evidence: MonitorResult['evidence']) => Promise<VideoAssessment>;
  recover: (ids: string[]) => void;
  wait?: () => Promise<void>;
};

/** Bounded workers drain in-flight work on pause/error; no late writer survives the run. */
export async function monitorPool<T>(items: T[], limit: number, active: () => boolean, work: (item: T) => Promise<void>) {
  let cursor = 0, failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed && active() && cursor < items.length) {
      const item = items[cursor++];
      try { await work(item); } catch (error) { if (!failed) failure = error; failed = true; }
    }
  }));
  if (failed) throw failure;
}

export function needsMonitorAnalysis(old: MonitorResult | undefined, project: MonitorProject, video: MonitorVideo) {
  if (old?.status === 'confirmed' || old?.status === 'excluded' || old?.writeAttempt) return false;
  const changed = !old || !sameProjectInput(old.project, project) || old.video.title !== video.title || old.video.description !== video.description;
  if (changed) return true;
  // Failed/unavailable captions require explicit retry. Changed cooperation inputs still re-evaluate.
  if (old.status === 'incomplete' && /未取得可用字幕|没有取得可用的完整字幕|提交已被拒绝/.test(old.error || '')) return false;
  return old.status === 'incomplete' || !!old.error || (old.status === 'pending' && !old.assessment);
}

/** Browser coordinator. Only mutations/checkpoints are serialized; external reads run concurrently. */
export async function runMonitor(state: MonitorState, options: MonitorOptions, io: MonitorRunnerIO) {
  const job = state.job!;
  const mutate = monitorSerialQueue();
  const commit = (change: () => void, changed?: MonitorResult[]) => mutate(async () => {
    io.guard(); change();
    if (changed) await io.stage(state, changed); else await io.save(state);
  });
  if (job.phase === 'channels') {
    await monitorPool(job.channels.filter(c => !c.id), 3, io.active, async channel => {
      try { const resolved = await io.resolve(channel.input); io.guard(); Object.assign(channel, resolved); channel.error = undefined; }
      catch (error) { io.guard(); channel.error = error instanceof Error ? error.message : '频道读取失败。'; }
    });
    // Handles /channel/ID and @handle aliases without losing either cooperation's date/products.
    const groups = new Map<string, typeof job.channels[number]>();
    for (const channel of job.channels) {
      const key = channel.id || channel.input;
      const previous = groups.get(key);
      if (!previous) groups.set(key, channel);
      else { previous.projectIds = [...new Set([...previous.projectIds, ...channel.projectIds])]; previous.done = false; previous.page = undefined; }
    }
    job.channels = [...groups.values()];
    await io.save(state);
    const seen = new Set(job.videos.map(video => video.id));
    await monitorPool(job.channels.filter(c => c.id && !c.done), 3, io.active, async channel => {
      const start = channelScanStart(job.projects, channel.projectIds, job.startedAt);
      for (let pages = 0; pages < 8 && io.active(); pages++) {
        io.message(`读取频道视频（最多 3 个频道同时进行）· 已收集 ${job.videos.length} 条`);
        let batch: { videos: MonitorVideo[]; page: string };
        try {
          batch = await io.page(channel.id!, channel.playlist!, channel.page);
          if (batch.page && batch.page === channel.page) throw new Error('YouTube 分页未前进，请稍后补查。');
        } catch (error) {
          await commit(() => { channel.error = error instanceof Error ? error.message : '频道读取失败。'; });
          return;
        }
        await commit(() => {
          for (const video of batch.videos) {
            if (!seen.has(video.id) && Date.parse(video.publishedAt) >= start && Date.parse(video.publishedAt) <= job.startedAt) {
              seen.add(video.id); job.videos.push(video);
            }
          }
          channel.page = batch.page;
          channel.done = !batch.page || channelPageIsBeforeStart(batch.videos, start);
          channel.error = !channel.done && pages === 7 ? '本次读取 400 条上传记录后仍有范围内历史页，可继续补查。' : undefined;
        });
        if (channel.done) break;
      }
    });
    if (io.active()) { job.phase = 'videos'; await io.save(state); }
  }
  if (job.phase !== 'videos' || !io.active()) return;

  const done = new Set(job.completedVideoIds ?? job.videos.slice(0, job.cursor).map(video => video.id));
  job.completedVideoIds = [...done]; job.cursor = done.size;
  const existing = new Map(state.results.map(result => [result.key, result]));
  const positions = new Map(state.results.map((result, index) => [result.key, index]));
  const projectById = new Map(job.projects.map(project => [project.id, project]));
  const byChannel = new Map(job.channels.map(channel => [channel.id, channel.projectIds.flatMap(id => projectById.get(id) || [])]));
  const tasks = job.videos.filter(video => !done.has(video.id)).map(video => {
    const projects = (byChannel.get(video.channelId) || []).filter(project => Date.parse(video.publishedAt) >= projectScanStart(project, job.startedAt)
      && needsMonitorAnalysis(existing.get(resultKey(project.id, video.id)), project, video));
    return { video, projects, subtitle: projects.some(project => !hasStrongVideoEvidence(project, matchVideo(project, video))) };
  });
  const reused = tasks.filter(task => !task.projects.length);
  if (reused.length) await commit(() => {
    reused.forEach(task => done.add(task.video.id));
    job.completedVideoIds = [...done]; job.cursor = done.size;
  });
  let aiCount = 0;
  const analyze = async (task: typeof tasks[number], subtitle?: MonitorSubtitle) => {
    const changed: MonitorResult[] = [];
    for (const project of task.projects) {
      io.guard();
      const evidence = matchVideo(project, task.video, subtitle?.transcript);
      const item: MonitorResult = { key: resultKey(project.id, task.video.id), project, video: task.video, evidence,
        status: evidence.length ? 'pending' : subtitle?.transcript ? 'no_match' : 'incomplete', error: subtitle?.error, checkedAt: Date.now() };
      if (evidence.length) {
        const previous = existing.get(item.key);
        if (previous?.assessment && sameProjectInput(previous.project, project) && JSON.stringify(previous.evidence) === JSON.stringify(evidence)
          && previous.video.description === task.video.description && previous.video.title === task.video.title) item.assessment = previous.assessment;
        else if (aiCount < options.maxAi && io.active()) {
          aiCount++;
          try { item.assessment = await io.assess(project, task.video, evidence); }
          catch (error) { item.error = [item.error, error instanceof Error ? error.message : 'AI 分析失败。'].filter(Boolean).join('；'); }
        } else item.error = [item.error, io.active() ? '达到本轮 AI 上限，可继续检测。' : 'AI 分析已暂停，可继续检测。'].filter(Boolean).join('；');
      }
      changed.push(item);
    }
    await commit(() => {
      for (const item of changed) {
        const index = positions.get(item.key);
        if (index === undefined) { positions.set(item.key, state.results.length); state.results.push(item); }
        else state.results[index] = item;
        existing.set(item.key, item);
      }
      done.add(task.video.id); job.completedVideoIds = [...done]; job.cursor = done.size;
      io.message(`已分析 ${job.cursor} / ${job.videos.length} 条视频 · AI 最多 5 条同时分析`);
    }, changed);
  };

  const subtitleTasks = tasks.filter(task => task.subtitle);
  job.subtitleBatches ??= job.subtitleBatch ? [job.subtitleBatch] : [];
  job.subtitleBatch = undefined;
  const reserved = new Set(job.subtitleBatches.flat());
  const allowance = Math.max(0, options.maxSubtitles - reserved.size);
  const batches = [...job.subtitleBatches.map(ids => [...ids])];
  const newIds = options.enabled ? subtitleTasks.map(task => task.video.id).filter(id => !reserved.has(id)).slice(0, allowance) : [];
  for (let i = 0; i < newIds.length; i += 50) batches.push(newIds.slice(i, i + 50));
  const cache = new Map<string, MonitorSubtitle>();
  let prefetch: Promise<{ result?: MonitorSubtitleBatch; error?: unknown }> | undefined;
  const launch = async (ids: string[]) => {
    if (!io.active()) return;
    await commit(() => {
      if (!job.subtitleBatches!.some(batch => JSON.stringify(batch) === JSON.stringify(ids))) {
        job.subtitleBatches!.push(ids); job.subtitleRequests += ids.length;
      }
    });
    if (!io.active()) return;
    // Attach rejection handling immediately: this promise overlaps AI work.
    prefetch = io.subtitles(ids).then(result => ({ result }), error => ({ error }));
  };
  try {
    if (batches.length) await launch(batches[0]);
    // Strong title/description matches appear while the first subtitle batch is preparing.
    await monitorPool(tasks.filter(task => task.projects.length && !task.subtitle), 5, io.active, task => analyze(task));
    for (let index = 0; index < batches.length && io.active(); index++) {
      const ids = batches[index];
      if (!prefetch) await launch(ids);
      if (!prefetch) break;
      const fetched = await prefetch; prefetch = undefined;
      if (fetched.error) throw fetched.error;
      let result = fetched.result!;
      for (let attempt = 0; result.state === 'running' && attempt < 72 && io.active(); attempt++) {
        io.message(`等待本批 ${ids.length} 条字幕 · 已分析 ${job.cursor} / ${job.videos.length}`);
        await (io.wait?.() ?? new Promise(resolve => setTimeout(resolve, 2500)));
        if (io.active()) result = await io.subtitles(ids);
      }
      if (result.state === 'starting') { io.recover(ids); throw new Error(result.error || '字幕批次提交状态待核实，请恢复运行编号。'); }
      if (result.state === 'running') { io.message('字幕批次仍在运行，已保存编号；稍后继续检测。'); await io.save(state); return; }
      for (const [id, value] of Object.entries(result.results)) cache.set(id, value);
      await commit(() => { job.subtitleBatches = job.subtitleBatches!.filter(batch => JSON.stringify(batch) !== JSON.stringify(ids)); });
      if (batches[index + 1] && io.active()) await launch(batches[index + 1]);
      const idSet = new Set(ids);
      await monitorPool(subtitleTasks.filter(task => idSet.has(task.video.id)), 5, io.active, task => analyze(task,
        cache.get(task.video.id) || { state: 'unavailable', error: '本批未取得可用字幕；可单条手动重试。' }));
    }
    const planned = new Set(batches.flat());
    await monitorPool(subtitleTasks.filter(task => !planned.has(task.video.id)), 5, io.active, task => analyze(task,
      { state: 'unavailable', error: options.enabled ? '已达到本轮字幕读取上限，点击继续检测可再处理一轮。' : '字幕未启用，文字资料不完整。' }));
    if (done.size >= job.videos.length) job.phase = 'done';
  } finally {
    // A submitted prefetch is never cancelled/recreated blindly. Its IDs remain in the checkpoint.
    if (prefetch) await prefetch;
  }
  await io.save(state);
}
