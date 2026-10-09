import { flattenFeishuValue, mapFeishuCooperationRecord, rawMappedValue } from './cooperation-projects';
import type { CachedFeishuRecord } from './feishu-record-cache';
import type { FeishuFieldMapping } from './feishu-mapping';

export const VIDEO_MONITOR_ACTOR = 'scrape-creators~best-youtube-transcripts-scraper';
export const VIDEO_MONITOR_RUN_LIMIT = 100;
export type MonitorProject = {
  id: string; name: string; channel: string; products: string[]; expected: string;
  cooperationDate?: number; discount: string; eligible: boolean;
};
export type MonitorVideo = { id: string; channelId: string; title: string; description: string; publishedAt: string };
export type Transcript = { text: string; segments: { text: string; start: number }[] };
export type MatchEvidence = { source: string; term: string; quote: string; start?: number };
export type VideoAssessment = { explanation: string; timing: 'new' | 'early' | 'normal' | 'uncertain'; dateExplanation: string };
export type MonitorResult = {
  key: string; project: MonitorProject; video: MonitorVideo; evidence: MatchEvidence[];
  status: 'pending' | 'confirmed' | 'excluded' | 'no_match' | 'incomplete';
  assessment?: VideoAssessment; error?: string; checkedAt: number;
  feishuSyncedAt?: number;
};
export type MonitorChannel = { input: string; projectIds: string[]; id?: string; playlist?: string; page?: string; done?: boolean; error?: string };
export type MonitorJob = { projects: MonitorProject[]; channels: MonitorChannel[]; videos: MonitorVideo[]; cursor: number; phase: 'channels' | 'videos' | 'done'; startedAt: number; subtitleRequests: number; subtitleBatch?: string[]; subtitleBatches?: string[][]; completedVideoIds?: string[] };
export type MonitorState = { results: MonitorResult[]; continueIds: string[]; job?: MonitorJob; saveId?: string };
export const emptyMonitorState = (): MonitorState => ({ results: [], continueIds: [] });

// A result key identifies a video/project pair; never update other collaborations
// for the same video just because that video was selected.
export function applyMonitorDecision(state: MonitorState, keys: Iterable<string>, status: MonitorResult['status']): MonitorState {
  const selected = new Set(keys);
  return { ...state, results: state.results.map(result => selected.has(result.key) ? { ...result, status } : result) };
}
export type MonitorPendingProgress = { version: 1; revision: string | null; startedAt: number; cursor: number; results: MonitorResult[]; completedVideoIds?: string[] };

export function restoreMonitorPendingProgress(cloud: MonitorState, revision: string | null, pending: MonitorPendingProgress): MonitorState | null {
  const job = cloud.job;
  if (!job || pending.version !== 1 || pending.revision !== revision || pending.startedAt !== job.startedAt
    || !Number.isInteger(pending.cursor) || pending.cursor < job.cursor || pending.cursor > job.videos.length
    || !Array.isArray(pending.results)) return null;
  const videos = new Set(job.videos.map(video => video.id));
  const projects = new Set(job.projects.map(project => project.id));
  if (pending.completedVideoIds && (pending.completedVideoIds.some(id => !videos.has(id))
    || new Set(pending.completedVideoIds).size !== pending.cursor
    || job.completedVideoIds?.some(id => !pending.completedVideoIds!.includes(id)))) return null;
  if (pending.results.some(result => !result || result.key !== resultKey(result.project?.id, result.video?.id)
    || !videos.has(result.video.id) || !projects.has(result.project.id))) return null;
  const merged = new Map(cloud.results.map(result => [result.key, result]));
  pending.results.forEach(result => merged.set(result.key, result));
  // These new local results have not been acknowledged by the cloud checkpoint.
  return { ...cloud, saveId: undefined, results: [...merged.values()], job: { ...job, cursor: pending.cursor, completedVideoIds: pending.completedVideoIds ?? job.completedVideoIds } };
}

export function monitorProjects(records: CachedFeishuRecord[], mapping: FeishuFieldMapping): MonitorProject[] {
  return records.flatMap(record => {
    const project = mapFeishuCooperationRecord(record, mapping);
    if (!/youtube/i.test(project.platform)) return [];
    const rawProducts = rawMappedValue(record, mapping, 'cooperationProduct');
    const products = (Array.isArray(rawProducts) ? rawProducts : [rawProducts])
      .flatMap(value => flattenFeishuValue(value).split(/[,，;；、\n+]+/))
      .map(value => value.trim().replace(/\s*[*×]\s*\d+$/, '')).filter(Boolean);
    return [{ id: project.id, name: project.channelName, channel: project.channelId || project.channelUrl,
      products: [...new Set(products)], expected: flattenFeishuValue(rawMappedValue(record, mapping, 'expectedPublishDate')).trim(),
      cooperationDate: project.cooperationDate, discount: project.discountCode,
      // Eligibility uses the actual raw cells, not date parsing or the computed stage.
      eligible: !flattenFeishuValue(rawMappedValue(record, mapping, 'actualPublishDate')).trim()
        && !flattenFeishuValue(rawMappedValue(record, mapping, 'publishedVideoUrl')).trim(),
    }];
  });
}

export function channelIdentity(input: string): { id?: string; handle?: string; username?: string } {
  const text = input.trim();
  if (/^UC[\w-]{22}$/.test(text)) return { id: text };
  if (/^@[\p{L}\p{N}_.-]+$/u.test(text)) return { handle: text };
  try {
    const url = new URL(text);
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return {};
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    if (parts[0] === 'channel' && /^UC[\w-]{22}$/.test(parts[1] || '')) return { id: parts[1] };
    if (parts[0]?.startsWith('@')) return { handle: parts[0] };
    if (parts[0] === 'user' && parts[1]) return { username: parts[1] };
  } catch { /* Invalid links stay unresolved; never guess by name. */ }
  return {};
}

export function createMonitorJob(projects: MonitorProject[], continueIds: string[], now = Date.now()): MonitorJob {
  const selected = projects.filter(p => p.eligible || continueIds.includes(p.id));
  const channels = new Map<string, MonitorChannel>();
  for (const p of selected) {
    const identity = channelIdentity(p.channel);
    const key = JSON.stringify(identity) === '{}' ? `missing:${p.id}` : JSON.stringify(identity);
    const group = channels.get(key) || { input: p.channel, projectIds: [] };
    group.projectIds.push(p.id);
    channels.set(key, group);
  }
  return { projects: selected, channels: [...channels.values()], videos: [], cursor: 0, phase: 'channels', startedAt: now, subtitleRequests: 0 };
}

export function projectScanStart(project: MonitorProject, now: number) {
  return project.cooperationDate ?? now - 180 * 86400000;
}

export function channelScanStart(projects: MonitorProject[], projectIds: string[], now: number) {
  const ids = new Set(projectIds);
  const starts = projects.filter(project => ids.has(project.id)).map(project => projectScanStart(project, now));
  return starts.length ? Math.min(...starts) : now - 180 * 86400000;
}

export function channelPageIsBeforeStart(videos: MonitorVideo[], start: number) {
  // A full page of older public videos is the conservative stop signal for an uploads playlist.
  return videos.length > 0 && videos.every(video => Date.parse(video.publishedAt) < start);
}

function termIndex(text: string, term: string) {
  const escaped = term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  if (!escaped) return -1;
  // Do not count P210 in P210-B or P2100. Non-Latin captions may adjoin model names.
  const match = new RegExp(`(^|[^a-z0-9-])(${escaped})(?=$|[^a-z0-9-])`, 'i').exec(text);
  return match ? match.index + match[1].length : -1;
}

/** Keep UTF-16 pairs intact when a quote boundary falls inside an emoji. */
export function monitorTextSlice(text: string, start: number, end: number) {
  if (start > 0 && /[\uDC00-\uDFFF]/.test(text.charAt(start)) && /[\uD800-\uDBFF]/.test(text.charAt(start - 1))) start--;
  if (end < text.length && /[\uDC00-\uDFFF]/.test(text.charAt(end)) && /[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end++;
  return text.slice(start, end);
}

export function matchVideo(project: MonitorProject, video: MonitorVideo, transcript?: Transcript): MatchEvidence[] {
  const terms = [...new Set(['AFERIY', ...project.products, ...project.discount.split(/[,，;；\n]+/).map(s => s.trim()).filter(Boolean)])];
  const sources: { text: string; source: string; start?: number }[] = [
    { text: video.title, source: '标题' }, { text: video.description, source: '简介' },
    ...(transcript ? [{ text: transcript.text, source: '字幕' }] : []),
  ];
  return sources.flatMap(source => terms.flatMap(term => {
    const index = termIndex(source.text, term);
    if (index < 0) return [];
    const segment = source.source === '字幕' ? transcript?.segments.find(s => termIndex(s.text, term) >= 0) : undefined;
    return [{ source: source.source, term, quote: monitorTextSlice(source.text, Math.max(0, index - 90), index + term.length + 160), start: segment?.start }];
  }));
}

export function hasStrongVideoEvidence(project: MonitorProject, evidence: MatchEvidence[]) {
  return evidence.some(e => e.term.toUpperCase() === 'AFERIY')
    && evidence.some(e => project.products.includes(e.term));
}

export function normalizeTranscript(value: unknown, videoId: string): Transcript | null {
  if (!Array.isArray(value)) return null;
  const row = value.find(item => item && (item.id === videoId || item.url === `https://www.youtube.com/watch?v=${videoId}`));
  if (!row || typeof row !== 'object') return null;
  const segments = (Array.isArray(row.transcript) ? row.transcript : []).flatMap((item: Record<string, unknown>) => {
    const start = Number(item.startMs) / 1000;
    return typeof item.text === 'string' && Number.isFinite(start) && start >= 0 ? [{ text: item.text, start }] : [];
  });
  const text = typeof row.transcript_only_text === 'string' ? row.transcript_only_text.trim() : segments.map((s: { text: string }) => s.text).join(' ');
  // Do not silently truncate then report a negative match.
  return text && text.length <= 500_000 ? { text, segments } : null;
}

export function resultKey(projectId: string, videoId: string) { return `${projectId}:${videoId}`; }
export function sameProjectInput(a: MonitorProject, b: MonitorProject) { return JSON.stringify(a) === JSON.stringify(b); }

export function normalizeVideoAssessment(raw: unknown, project: MonitorProject): VideoAssessment {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const explanation = typeof value.explanation === 'string' ? monitorTextSlice(value.explanation, 0, 1800) : '';
  if (!explanation) throw new Error('AI 分析未返回有效说明，请重试。');
  let timing: VideoAssessment['timing'] = value.timing === 'early' || value.timing === 'normal' ? value.timing : 'uncertain';
  if (!project.expected) timing = 'new';
  // An inferred year cannot establish an early release. Display the AI interpretation only.
  else if (!/20\d{2}/.test(project.expected)) timing = 'uncertain';
  return { explanation, timing, dateExplanation: !project.expected ? '没有填写预计发布时间，标记为新发布，不判断提前。' : typeof value.dateExplanation === 'string' ? monitorTextSlice(value.dateExplanation, 0, 1000) : '预计日期需要人工核实。' };
}
