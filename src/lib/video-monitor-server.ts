import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encodeMonitorCloud, decodeMonitorCloud } from './video-monitor-cloud-codec';
import { channelIdentity, normalizeTranscript, VIDEO_MONITOR_ACTOR, type MonitorVideo, type Transcript } from './video-monitor';

export function monitorTableKey(input: string) {
  const url = new URL(input);
  if (!/^https:$/.test(url.protocol)) throw new Error('合作表链接无效。');
  // A view change must not create a separate history for the same table.
  return `video_monitor_${createHash('sha256').update(`${url.origin}${url.pathname}?table=${url.searchParams.get('table') || ''}`).digest('hex').slice(0, 32)}`;
}

export async function readMonitorData<T>(db: SupabaseClient, userId: string, key: string) {
  const { data, error } = await db.from('user_data').select('data,updated_at').eq('user_id', userId).eq('data_key', key).maybeSingle();
  if (error) throw new Error('检测记录读取失败，请稍后重试。');
  return data ? { value: decodeMonitorCloud<T>(data.data), revision: data.updated_at as string } : null;
}

export class MonitorSaveError extends Error {
  constructor(readonly code: 'SAVE_CONFLICT' | 'SAVE_UNAVAILABLE', diagnostic?: string) {
    super((code === 'SAVE_CONFLICT' ? '另一窗口已更新检测记录，请重新打开检测窗口核对；本机结果已保留。' : '云端保存暂时失败，请稍后重试；本机结果已保留。')
      + (diagnostic && /^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(diagnostic) ? `（错误码：${diagnostic}）` : ''));
  }
}
export async function writeMonitorData(db: SupabaseClient, userId: string, key: string, data: unknown, revision: string | null) {
  const updated_at = new Date(Math.max(Date.now(), revision ? Date.parse(revision) + 1 : 0)).toISOString();
  const query = revision
    ? db.from('user_data').update({ data, updated_at }).eq('user_id', userId).eq('data_key', key).eq('updated_at', revision).select('updated_at')
    : db.from('user_data').insert({ user_id: userId, data_key: key, data, updated_at }).select('updated_at');
  const result = await query;
  if (result.error) {
    // Never log database details: they can contain the user's complete record.
    const reason = /surrogate|unicode|utf-?8/i.test(result.error.message) ? 'unicode'
      : /not enough input|unexpected end|empty/i.test(result.error.message) ? 'incomplete-body'
      : /size|large|limit/i.test(result.error.message) ? 'size-limit' : 'other';
    console.warn('[video-monitor save]', { code: result.error.code, status: result.status, reason, bytes: new TextEncoder().encode(JSON.stringify(data)).length });
    throw new MonitorSaveError(['23505', 'duplicate'].includes(result.error.code) ? 'SAVE_CONFLICT' : 'SAVE_UNAVAILABLE', result.error.code);
  }
  if (!result.data?.length) throw new MonitorSaveError('SAVE_CONFLICT');
  return result.data[0].updated_at as string;
}

/** A lost HTTP response must not turn our own successful write into a false conflict. */
export async function saveMonitorCheckpoint(db: SupabaseClient, userId: string, key: string, value: unknown, revision: string | null, saveId: string) {
  try { return await writeMonitorData(db, userId, key, encodeMonitorCloud({ ...(value as object), saveId }), revision); }
  catch (error) {
    const latest = await readMonitorData<{ saveId?: string }>(db, userId, key);
    if (latest?.value.saveId === saveId) return latest.revision;
    throw error;
  }
}

async function youtube(key: string, resource: string, query: Record<string, string>) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
  Object.entries({ ...query, key }).forEach(([k, v]) => url.searchParams.set(k, v));
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`YouTube 读取失败（${response.status}），请检查额度或稍后重试。`);
  return response.json();
}

export async function resolveMonitorChannel(key: string, input: string): Promise<{ id: string; playlist: string }> {
  const identity = channelIdentity(input);
  const query: Record<string, string> | null = identity.id ? { id: identity.id } : identity.handle ? { forHandle: identity.handle } : identity.username ? { forUsername: identity.username } : null;
  if (!query) throw new Error('频道链接无法核实，请在飞书补充 /channel/ID 或 @频道链接。');
  const data = await youtube(key, 'channels', { part: 'id,contentDetails', ...query });
  const channel = data.items?.[0];
  if (!channel?.id || !channel.contentDetails?.relatedPlaylists?.uploads) throw new Error('找不到公开频道，请核实链接。');
  return { id: channel.id, playlist: channel.contentDetails.relatedPlaylists.uploads };
}

export async function fetchMonitorVideoPage(key: string, channelId: string, playlist: string, page = '') {
  if (!/^UC[\w-]{22}$/.test(channelId) || playlist !== `UU${channelId.slice(2)}`) throw new Error('频道上传列表不匹配。');
  const list = await youtube(key, 'playlistItems', { part: 'contentDetails', playlistId: playlist, maxResults: '50', ...(page ? { pageToken: page } : {}) });
  const ids: string[] = (list.items || []).map((i: { contentDetails?: { videoId?: string } }) => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length && list.nextPageToken) throw new Error('YouTube 分页数据不完整，请重试。');
  const details = ids.length ? await youtube(key, 'videos', { part: 'snippet,status', id: ids.join(',') }) : { items: [] };
  const videos: MonitorVideo[] = (details.items || []).flatMap((item: { id: string; snippet?: { channelId: string; title: string; description: string; publishedAt: string; liveBroadcastContent: string }; status?: { privacyStatus: string } }) => {
    const s = item.snippet;
    return s && s.channelId === channelId && item.status?.privacyStatus === 'public' && s.liveBroadcastContent !== 'upcoming' && Number.isFinite(Date.parse(s.publishedAt))
      ? [{ id: item.id, channelId, title: s.title, description: s.description, publishedAt: s.publishedAt }] : [];
  });
  return { videos, page: typeof list.nextPageToken === 'string' ? list.nextPageToken : '' };
}

export type ApifyConfig = { token: string; enabled: boolean; maxSubtitles: number; maxAi: number };
export type TranscriptCache = { state: 'starting' | 'running' | 'complete' | 'unavailable'; runId?: string; transcript?: Transcript; error?: string };
export type TranscriptBatch = { state: 'starting' | 'running' | 'complete'; videoIds: string[]; runId?: string; error?: string };
class ApifyHttpError extends Error {
  constructor(readonly status: number) { super(`字幕服务请求失败（${status}）。请检查 Apify 账号或额度。`); }
}
export async function apifyRequest(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`https://api.apify.com/v2/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new ApifyHttpError(response.status);
  return response.json();
}

export async function monitorTranscript(db: SupabaseClient, userId: string, config: ApifyConfig, videoId: string, options: { retry?: boolean; recoverRunId?: string } = {}) {
  if (!/^[\w-]{11}$/.test(videoId)) throw new Error('视频 ID 无效。');
  const key = `video_transcript_${videoId}`;
  let saved = await readMonitorData<TranscriptCache>(db, userId, key);
  if (saved?.value.state === 'complete') return saved.value;
  if (!config.enabled || !config.token) return { state: 'unavailable', error: '字幕服务未启用或未配置，请先到设置填写 Apify Token。' } satisfies TranscriptCache;
  if (options.recoverRunId) {
    if (!saved || saved.value.state !== 'starting' || !/^[a-zA-Z0-9]+$/.test(options.recoverRunId)) throw new Error('仅可为提交状态不明的任务恢复运行编号。');
    const run = (await apifyRequest(config.token, `actor-runs/${options.recoverRunId}`)).data;
    const input = await apifyRequest(config.token, `key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT`);
    if (!Array.isArray(input.videoUrls) || input.videoUrls.length !== 1 || input.videoUrls[0] !== `https://www.youtube.com/watch?v=${videoId}`) throw new Error('此运行编号对应的视频不一致，不能恢复。');
    const value: TranscriptCache = { state: 'running', runId: options.recoverRunId };
    const revision = await writeMonitorData(db, userId, key, value, saved.revision);
    saved = { value, revision };
  }
  if (saved?.value.state === 'starting') return { ...saved.value, error: '字幕任务提交状态不明，为防重复收费已停止。请在 Apify 运行记录找到对应视频的 Run ID 后恢复。' };
  if (saved?.value.state === 'unavailable' && !options.retry) return saved.value;
  if (!saved || (options.retry && saved.value.state === 'unavailable')) {
    // Reserve BEFORE the billable call. An ambiguous timeout must never submit twice.
    const revision = await writeMonitorData(db, userId, key, { state: 'starting' }, saved?.revision || null);
    let started;
    try {
      started = await apifyRequest(config.token, `actors/${VIDEO_MONITOR_ACTOR}/runs?maxItems=1&maxTotalChargeUsd=0.05&timeout=180`, {
        method: 'POST', body: JSON.stringify({ videoUrls: [`https://www.youtube.com/watch?v=${videoId}`] }),
      });
    } catch (error) {
      if (error instanceof ApifyHttpError && [400, 401, 403, 404, 422, 429].includes(error.status)) {
        const value: TranscriptCache = { state: 'unavailable', error: `${error.message}本次提交已被拒绝，修正后可手动重试。` };
        await writeMonitorData(db, userId, key, value, revision);
        return value;
      }
      throw new Error('字幕提交状态不明，为防重复收费已停止。请在 Apify 核对对应视频的 Run ID 后恢复。');
    }
    if (!started.data?.id) throw new Error('字幕提交状态不明，请到 Apify 核对运行记录。');
    const value: TranscriptCache = { state: 'running', runId: started.data.id };
    try { await writeMonitorData(db, userId, key, value, revision); }
    catch { throw new Error(`字幕提交状态不明：运行已创建，Run ID 为 ${started.data.id}，但记录保存失败。请用此编号恢复，不要重新提交。`); }
    return value;
  }
  const run = (await apifyRequest(config.token, `actor-runs/${saved.value.runId}`)).data;
  if (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run?.status)) return saved.value;
  const transcript = run.status === 'SUCCEEDED' && run.defaultDatasetId
    ? normalizeTranscript(await apifyRequest(config.token, `datasets/${run.defaultDatasetId}/items?format=json&limit=10`), videoId) : null;
  const value: TranscriptCache = transcript ? { state: 'complete', runId: saved.value.runId, transcript }
    : { state: 'unavailable', runId: saved.value.runId, error: '没有取得可用的完整字幕（可能无字幕或抓取失败），不能据此排除合作。' };
  await writeMonitorData(db, userId, key, value, saved.revision);
  return value;
}

/** Submit up to 50 uncached videos in one Actor run; the batch reservation prevents duplicate charges. */
export async function monitorTranscriptBatch(db: SupabaseClient, userId: string, config: ApifyConfig, videoIds: string[], recoverRunId?: string) {
  if (!videoIds.length || videoIds.length > 50 || new Set(videoIds).size !== videoIds.length || videoIds.some(id => !/^[\w-]{11}$/.test(id))) throw new Error('字幕批次须包含 1–50 个不同视频。');
  const cached = await Promise.all(videoIds.map(id => readMonitorData<TranscriptCache>(db, userId, `video_transcript_${id}`)));
  const results: Record<string, TranscriptCache> = {};
  const pending = videoIds.filter((id, index) => {
    if (cached[index]) { results[id] = cached[index].value; return false; }
    return true;
  });
  if (!pending.length) return { state: 'complete' as const, results };
  if (!config.enabled || !config.token) return { state: 'complete' as const, results: { ...results, ...Object.fromEntries(pending.map(id => [id, { state: 'unavailable', error: '字幕服务未启用或未配置。' }])) } as Record<string, TranscriptCache> };
  const key = `video_transcript_batch_${createHash('sha256').update([...videoIds].sort().join(',')).digest('hex').slice(0, 32)}`;
  let saved = await readMonitorData<TranscriptBatch>(db, userId, key);
  const batchIds = saved?.value.videoIds || pending;
  if (!saved) {
    const revision = await writeMonitorData(db, userId, key, { state: 'starting', videoIds: pending } satisfies TranscriptBatch, null);
    try {
      const started = await apifyRequest(config.token, `actors/${VIDEO_MONITOR_ACTOR}/runs?maxItems=${pending.length}&maxTotalChargeUsd=0.05&timeout=180`, {
        method: 'POST', body: JSON.stringify({ videoUrls: pending.map(id => `https://www.youtube.com/watch?v=${id}`) }),
      });
      if (!started.data?.id) throw new Error('字幕批次提交状态不明。');
      const value: TranscriptBatch = { state: 'running', videoIds: pending, runId: started.data.id };
      const runningRevision = await writeMonitorData(db, userId, key, value, revision);
      saved = { value, revision: runningRevision };
    } catch (error) {
      if (error instanceof ApifyHttpError && [400, 401, 403, 404, 422, 429].includes(error.status)) {
        const value: TranscriptBatch = { state: 'complete', videoIds: pending, error: `${error.message}提交已被拒绝。` };
        await writeMonitorData(db, userId, key, value, revision);
        return { state: 'complete' as const, results: { ...results, ...Object.fromEntries(pending.map(id => [id, { state: 'unavailable', error: value.error }])) } as Record<string, TranscriptCache> };
      }
      return { state: 'starting' as const, error: '字幕批次提交状态不明，为防重复收费已停止。请从 Apify 运行记录核对 Run ID 后恢复。', results };
    }
  }
  if (saved.value.state === 'starting') {
    if (!recoverRunId) return { state: 'starting' as const, error: '字幕批次提交状态不明，为防重复收费已停止。请从 Apify 运行记录核对 Run ID 后恢复。', results };
    if (!/^[a-zA-Z0-9]+$/.test(recoverRunId)) throw new Error('运行编号无效。');
    const run = (await apifyRequest(config.token, `actor-runs/${recoverRunId}`)).data;
    const input = await apifyRequest(config.token, `key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT`);
    if (JSON.stringify(input.videoUrls) !== JSON.stringify(batchIds.map(id => `https://www.youtube.com/watch?v=${id}`))) throw new Error('运行编号对应的视频批次不一致。');
    const value: TranscriptBatch = { state: 'running', videoIds: batchIds, runId: recoverRunId };
    const revision = await writeMonitorData(db, userId, key, value, saved.revision);
    saved = { value, revision };
  }
  if (saved.value.state === 'complete' && saved.value.error) return { state: 'complete' as const, results: { ...results, ...Object.fromEntries(batchIds.map(id => [id, { state: 'unavailable', error: saved.value.error }])) } as Record<string, TranscriptCache> };
  if (!saved.value.runId) throw new Error('字幕批次缺少运行编号。');
  const run = (await apifyRequest(config.token, `actor-runs/${saved.value.runId}`)).data;
  if (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run?.status)) return { state: 'running' as const, runId: saved.value.runId, results };
  const rows = run.defaultDatasetId ? await apifyRequest(config.token, `datasets/${run.defaultDatasetId}/items?format=json&limit=50`) : [];
  for (let offset = 0; offset < batchIds.length; offset += 10) {
    await Promise.all(batchIds.slice(offset, offset + 10).map(async id => {
      const transcript = normalizeTranscript(rows, id);
      const value: TranscriptCache = transcript ? { state: 'complete', runId: saved.value.runId, transcript }
        : { state: 'unavailable', runId: saved.value.runId, error: '本批未取得可用字幕；不能据此排除合作，可单条手动重试。' };
      const previous = await readMonitorData<TranscriptCache>(db, userId, `video_transcript_${id}`);
      if (!previous || previous.value.state !== 'complete') await writeMonitorData(db, userId, `video_transcript_${id}`, value, previous?.revision || null);
      results[id] = previous?.value.state === 'complete' ? previous.value : value;
    }));
  }
  if (saved.value.state !== 'complete') await writeMonitorData(db, userId, key, { ...saved.value, state: 'complete' } satisfies TranscriptBatch, saved.revision);
  return { state: 'complete' as const, results };
}
