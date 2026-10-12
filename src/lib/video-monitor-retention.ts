import { unpackMonitorState } from './video-monitor-storage';
import { monitorCategory } from './video-monitor-workflow';

export type MonitorStorageRow = { data_key: string; updated_at: string; data: unknown };
export const MONITOR_TRANSCRIPT_RETENTION_MS = 90 * 86400000;
export const MONITOR_PREVIEW_RETENTION_MS = 7 * 86400000;
export function monitorProtectedStorage(rows: MonitorStorageRow[]) {
  const videos = new Set<string>(), tokens = new Set<string>();
  for (const row of rows) {
    if (!row.data_key.startsWith('video_monitor_')) continue;
    // Invalid state aborts cleanup: it must never be treated as an empty/unreferenced history.
    const state = unpackMonitorState(row.data);
    for (const result of state.results) {
      if (['pending', 'ready', 'incomplete'].includes(monitorCategory(result)) || result.writeAttempt) videos.add(result.video.id);
      if (result.writeAttempt) tokens.add(`video_write_${result.writeAttempt.token}`);
    }
    if (state.job && (state.job.phase !== 'done' || state.job.channels.some(channel => !channel.done || channel.error))) {
      state.job.videos.forEach(video => videos.add(video.id));
    }
    const batches = state.job?.subtitleBatches || (state.job?.subtitleBatch ? [state.job.subtitleBatch] : []);
    batches.flat().forEach(id => videos.add(id));
  }
  return { videos, tokens };
}
export function monitorRetentionCandidates(rows: MonitorStorageRow[], now = Date.now()) {
  const protectedData = monitorProtectedStorage(rows);
  return rows.filter(row => {
    const value = row.data as Record<string, unknown>;
    if (!value || typeof value !== 'object') return false;
    const age = now - Date.parse(row.updated_at);
    if (!Number.isFinite(age)) return false;
    if (row.data_key.startsWith('video_cleanup_')) return age >= MONITOR_PREVIEW_RETENTION_MS;
    if (row.data_key.startsWith('video_write_')) {
      // Unknown/in-flight submissions are never expired merely because their preview is old.
      return !protectedData.tokens.has(row.data_key) && age >= MONITOR_PREVIEW_RETENTION_MS
        && (!value.submittingAt || !!value.completedAt);
    }
    if (!row.data_key.startsWith('video_transcript_') || age < MONITOR_TRANSCRIPT_RETENTION_MS || value.state !== 'complete') return false;
    const ids = row.data_key.startsWith('video_transcript_batch_')
      ? (Array.isArray(value.videoIds) ? value.videoIds : null) : [row.data_key.slice('video_transcript_'.length)];
    return !!ids && ids.every(id => typeof id === 'string' && !protectedData.videos.has(id));
  });
}
