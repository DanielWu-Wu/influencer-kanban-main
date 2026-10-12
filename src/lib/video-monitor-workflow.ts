import type { CachedFeishuRecord } from './feishu-record-cache';
import type { FeishuFieldMapping } from './feishu-mapping';
import { rawMappedValue } from './cooperation-projects';
import { linkVideoId } from './video-monitor-writeback';
import type { MonitorResult, MonitorState } from './video-monitor';

export type MonitorCategory = 'pending' | 'ready' | 'done' | 'incomplete' | 'excluded' | 'no_match';
export function monitorCategory(item: MonitorResult): MonitorCategory {
  if (item.status === 'confirmed') return item.feishuSyncedAt ? 'done' : 'ready';
  return item.status;
}
export function monitorNeedsAttention(state: MonitorState) {
  return state.results.some(item => item.writeAttempt || ['pending', 'ready', 'incomplete'].includes(monitorCategory(item)))
    || !!state.job?.channels.some(channel => !channel.done || channel.error)
    || !!state.job?.subtitleBatches?.length || !!state.job?.subtitleBatch?.length;
}
export function preferredMonitorCategory(state: MonitorState): MonitorCategory {
  for (const category of ['pending', 'ready', 'incomplete'] as const) {
    if (state.results.some(item => monitorCategory(item) === category)) return category;
  }
  return state.results.some(item => monitorCategory(item) === 'done') ? 'done' : 'pending';
}
/** Every conflicting candidate is blocked, rather than choosing the first selected video. */
export function conflictingMonitorKeys(items: MonitorResult[]) {
  const videos = new Map<string, Set<string>>();
  for (const item of items) {
    const group = videos.get(item.project.id) || new Set<string>();
    group.add(item.video.id); videos.set(item.project.id, group);
  }
  return new Set(items.filter(item => videos.get(item.project.id)!.size > 1).map(item => item.key));
}
/** A cleared link reopens a completed collaboration; an unrelated existing link never proves completion. */
export function reconcileMonitorLinks(state: MonitorState, records: CachedFeishuRecord[], mapping: FeishuFieldMapping): MonitorState {
  const byId = new Map(records.map(record => [record.record_id, record]));
  return { ...state, results: state.results.map(item => {
    const record = byId.get(item.project.id);
    if (!record || !item.feishuSyncedAt) return item;
    const linked = linkVideoId(rawMappedValue(record, mapping, 'publishedVideoUrl'));
    if (linked !== '') return item;
    return { ...item, status: 'pending', feishuSyncedAt: undefined, compactedAt: undefined,
      writeError: undefined, assessment: undefined, checkedAt: 0 } satisfies MonitorResult;
  }) };
}
/** Keep identity and publication history; strip heavy analysis only after an exact Feishu link check. */
export function compactCompletedMonitor(state: MonitorState, records: CachedFeishuRecord[], mapping: FeishuFieldMapping, now = Date.now()) {
  const byId = new Map(records.map(record => [record.record_id, record]));
  let count = 0;
  const results = state.results.map(item => {
    if (item.status === 'excluded' && !item.writeAttempt && !item.feishuSyncedAt && !item.compactedAt) {
      count++;
      return { ...item, video: { ...item.video, description: '' }, evidence: [], assessment: undefined, error: undefined, compactedAt: now };
    }
    const record = byId.get(item.project.id);
    if (!record || monitorCategory(item) !== 'done' || item.writeAttempt || item.compactedAt
      || linkVideoId(rawMappedValue(record, mapping, 'publishedVideoUrl')) !== item.video.id) return item;
    count++;
    return { ...item, video: { ...item.video, description: '' }, evidence: [], assessment: undefined,
      error: undefined, writeError: undefined, compactedAt: now };
  });
  let job = state.job;
  if (job?.phase === 'done' && job.channels.every(channel => channel.done && !channel.error)
    && !job.subtitleBatch?.length && !job.subtitleBatches?.length) {
    const retained = new Set(results.filter(item => item.writeAttempt || ['pending', 'ready', 'incomplete'].includes(monitorCategory(item))).map(item => item.video.id));
    const videos = job.videos.filter(video => retained.has(video.id));
    const completedVideoIds = (job.completedVideoIds ?? job.videos.slice(0, job.cursor).map(video => video.id)).filter(id => retained.has(id));
    job = { ...job, videos, cursor: completedVideoIds.length, completedVideoIds };
  }
  return { state: { ...state, results, job }, count };
}
