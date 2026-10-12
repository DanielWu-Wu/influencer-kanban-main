import type { FeishuFieldMapping } from './feishu-mapping';
import { flattenFeishuValue } from './cooperation-projects';

export const VIDEO_WRITE_FIELDS = [
  ['actualPublishDate', '实际上线日期'], ['publishedVideoUrl', '视频上线链接'],
  ['exposureCount', '曝光量（播放数）'], ['commentCount', '评论量'], ['likeCount', '点赞量'],
] as const;
export type VideoWritePreview = {
  token: string; name: string; products: string[]; title: string; recordId: string; fetchedAt: number;
  rows: { field: string; label: string; before: string; after: string; skip: boolean }[];
};
export type VideoWriteData = { id: string; channelId: string; title: string; publishedAt: string; statistics: Record<string, unknown> };

export function linkVideoId(value: unknown): string | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    return linkVideoId(object.link ?? object.url ?? object.text);
  }
  const text = flattenFeishuValue(value).trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (url.hostname === 'youtu.be') return url.pathname.slice(1);
    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) return url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live)\/([\w-]{11})/)?.[1] || null;
  } catch { /* Unknown nonempty links must never be replaced. */ }
  return null;
}

export function buildVideoWritePlan(mapping: FeishuFieldMapping, types: Map<string, number>, old: Record<string, unknown>, video: VideoWriteData) {
  const fields = VIDEO_WRITE_FIELDS.map(([key]) => mapping[key]?.trim());
  if (fields.some(field => !field) || new Set(fields).size !== fields.length) throw new Error('请先在合作表字段映射中配置这5个字段，且不能重复映射。');
  const existing = linkVideoId(old[mapping.publishedVideoUrl!]);
  if (existing !== '' && existing !== video.id) throw new Error('该合作记录已有不同的视频链接，已阻止覆盖。请在飞书手动处理多视频情况。');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(video.publishedAt));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('视频公开日期无法识别。');
  const count = (key: string) => {
    const raw = video.statistics[key];
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) ? value : undefined;
  };
  const values = [date, `https://www.youtube.com/watch?v=${video.id}`, count('viewCount'), count('commentCount'), count('likeCount')];
  const write: Record<string, unknown> = {};
  const original: Record<string, unknown> = {};
  const rows = VIDEO_WRITE_FIELDS.map(([key, label], index) => {
    const field = mapping[key]!;
    const type = types.get(field);
    if (!type || ![1, index === 0 ? 5 : index === 1 ? 15 : 2].includes(type)) throw new Error(`字段“${field}”不存在或类型不支持，请检查映射。`);
    original[field] = old[field] ?? null;
    const value = values[index];
    if (value !== undefined) write[field] = type === 5 ? Date.parse(`${date}T00:00:00+08:00`) : type === 15 ? { text: String(value), link: String(value) } : type === 1 ? String(value) : value;
    const before = index === 0 && typeof old[field] === 'number' ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(new Date(old[field] as number)) : flattenFeishuValue(old[field]) || '未填写';
    return { field, label, before, after: value === undefined ? '未获取，保留原值' : String(value), skip: value === undefined };
  });
  return { write, original, rows };
}

export function sameVideoWriteFields(left: Record<string, unknown>, right: Record<string, unknown>) {
  const value = (input: unknown): string => {
    if (input && typeof input === 'object' && !Array.isArray(input)) {
      const object = input as Record<string, unknown>;
      if (object.link || object.url) return String(object.link || object.url);
    }
    return flattenFeishuValue(input);
  };
  return Object.keys(right).every(key => value(left[key]) === value(right[key]));
}
