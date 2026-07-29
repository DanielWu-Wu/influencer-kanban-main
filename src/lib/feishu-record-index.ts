import type { Prospect } from '@/lib/creator-prospecting';
import { normalizeYouTubeKey } from '@/lib/creator-prospecting';
import type { CachedFeishuRecord } from '@/lib/feishu-record-cache';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';

export type FeishuRecordMatch =
  | { kind: 'none' }
  | { kind: 'exact'; record: CachedFeishuRecord; reason: string }
  | { kind: 'suspected'; record: CachedFeishuRecord; reason: string }
  | { kind: 'conflict'; records: CachedFeishuRecord[]; reason: string };

export type FeishuRecordIndex = {
  recordById: Map<string, CachedFeishuRecord>;
  channelIds: Map<string, CachedFeishuRecord[]>;
  channelUrls: Map<string, CachedFeishuRecord[]>;
  emails: Map<string, CachedFeishuRecord[]>;
  handles: Map<string, CachedFeishuRecord[]>;
  channelNames: Map<string, CachedFeishuRecord[]>;
};

const cachedIndexes = new WeakMap<
  CachedFeishuRecord[],
  Map<string, FeishuRecordIndex>
>();

export function flattenFeishuValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenFeishuValue).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return flattenFeishuValue(object.link || object.text || object.name || Object.values(object));
  }
  return '';
}

export function splitFeishuEmails(value: unknown) {
  return flattenFeishuValue(value)
    .split(/[\n,，;；、\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

export function extractYouTubeHandle(value?: string) {
  const match = String(value || '').match(/(?:youtube\.com\/)?@([^/?#]+)/i);
  return match?.[1]?.toLowerCase() || '';
}

function addToIndex(
  index: Map<string, CachedFeishuRecord[]>,
  key: string,
  record: CachedFeishuRecord,
) {
  if (!key) return;
  const existing = index.get(key);
  if (existing) {
    if (!existing.some((item) => item.record_id === record.record_id)) existing.push(record);
  } else {
    index.set(key, [record]);
  }
}

function fieldValue(
  record: CachedFeishuRecord,
  mapping: FeishuFieldMapping,
  key: FeishuFieldKey,
) {
  const fieldName = mapping[key];
  return fieldName ? flattenFeishuValue(record.fields[fieldName]).trim() : '';
}

export function buildFeishuRecordIndex(
  records: CachedFeishuRecord[],
  mapping: FeishuFieldMapping,
): FeishuRecordIndex {
  const mappingKey = JSON.stringify(
    Object.entries(mapping).sort(([left], [right]) => left.localeCompare(right)),
  );
  const byMapping = cachedIndexes.get(records);
  const cached = byMapping?.get(mappingKey);
  if (cached) return cached;

  const index: FeishuRecordIndex = {
    recordById: new Map(),
    channelIds: new Map(),
    channelUrls: new Map(),
    emails: new Map(),
    handles: new Map(),
    channelNames: new Map(),
  };
  for (const record of records) {
    index.recordById.set(record.record_id, record);
    const channelId = fieldValue(record, mapping, 'channelId').toLowerCase();
    const channelUrl = normalizeYouTubeKey(fieldValue(record, mapping, 'channelUrl'));
    const channelName = fieldValue(record, mapping, 'channelName').toLowerCase();
    addToIndex(index.channelIds, channelId, record);
    addToIndex(index.channelUrls, channelUrl, record);
    for (const email of splitFeishuEmails(
      mapping.email ? record.fields[mapping.email] : undefined,
    )) {
      addToIndex(index.emails, email, record);
    }
    addToIndex(index.handles, extractYouTubeHandle(channelUrl), record);
    addToIndex(index.channelNames, channelName, record);
  }

  const nextByMapping = byMapping || new Map<string, FeishuRecordIndex>();
  nextByMapping.set(mappingKey, index);
  if (!byMapping) cachedIndexes.set(records, nextByMapping);
  return index;
}

function resolveCandidates(
  candidates: CachedFeishuRecord[] | undefined,
  exactReason: string,
  conflictReason: string,
): FeishuRecordMatch | undefined {
  if (!candidates?.length) return undefined;
  if (candidates.length > 1) {
    return { kind: 'conflict', records: candidates, reason: conflictReason };
  }
  return { kind: 'exact', record: candidates[0], reason: exactReason };
}

export function findFeishuRecordMatch(
  prospect: Pick<
    Prospect,
    'channelId' | 'url' | 'sourceUrl' | 'inputUrl' | 'customUrl' | 'publicEmail' | 'title'
  >,
  index: FeishuRecordIndex,
): FeishuRecordMatch {
  const channelId = String(prospect.channelId || '').trim().toLowerCase();
  const url = prospect.url || prospect.sourceUrl || prospect.inputUrl || '';
  const urlKey = normalizeYouTubeKey(url);
  const emails = splitFeishuEmails(prospect.publicEmail || '');
  const handle = extractYouTubeHandle(prospect.customUrl || prospect.sourceUrl || prospect.inputUrl);
  const title = String(prospect.title || '').trim().toLowerCase();

  const channelIdMatch = resolveCandidates(
    channelId ? index.channelIds.get(channelId) : undefined,
    'Channel ID 一致',
    '同一 Channel ID 命中多条飞书记录',
  );
  if (channelIdMatch) return channelIdMatch;

  const urlMatch = resolveCandidates(
    urlKey ? index.channelUrls.get(urlKey) : undefined,
    '标准化 YouTube 链接一致',
    '同一频道链接命中多条飞书记录',
  );
  if (urlMatch) return urlMatch;

  const emailRecords = Array.from(new Map(
    emails.flatMap((email) => index.emails.get(email) || [])
      .map((record) => [record.record_id, record]),
  ).values());
  const emailMatch = resolveCandidates(
    emailRecords,
    '联系邮箱一致',
    '同一联系邮箱命中多条飞书记录',
  );
  if (emailMatch) return emailMatch;

  const handleRecords = handle ? index.handles.get(handle) : undefined;
  if (handleRecords?.length) {
    if (handleRecords.length > 1) {
      return { kind: 'conflict', records: handleRecords, reason: '同一 handle 命中多条飞书记录' };
    }
    return { kind: 'suspected', record: handleRecords[0], reason: 'handle 相同，请人工确认' };
  }

  const nameRecords = title ? index.channelNames.get(title) : undefined;
  if (nameRecords?.length) {
    if (nameRecords.length > 1) {
      return { kind: 'conflict', records: nameRecords, reason: '同一频道名命中多条飞书记录' };
    }
    return { kind: 'suspected', record: nameRecords[0], reason: '频道名相同，请人工确认' };
  }
  return { kind: 'none' };
}
