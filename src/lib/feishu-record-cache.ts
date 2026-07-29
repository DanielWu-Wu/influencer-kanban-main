export type CachedFeishuRecord = {
  record_id: string;
  fields: Record<string, unknown>;
};

export type FeishuRecordSnapshot = {
  records: CachedFeishuRecord[];
  fetchedAt: number;
  expiresAt: number;
  cacheHit: boolean;
  cacheKey: string;
  fieldNames: string[];
};

type FeishuRecordListResult = {
  success?: boolean;
  error?: string;
  data?: {
    items?: CachedFeishuRecord[];
    has_more?: boolean;
    page_token?: string;
  };
};

type CacheEntry = {
  snapshot: Omit<FeishuRecordSnapshot, 'cacheHit'>;
};

export const FEISHU_RECORD_CACHE_TTL_MS = 60_000;
const recordCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<FeishuRecordSnapshot>>();
const requestVersions = new Map<string, number>();

function normalizeFieldNames(fieldNames: string[] = []) {
  return Array.from(new Set(fieldNames.map((name) => name.trim()).filter(Boolean))).sort();
}

function buildCacheKey(url: string, fieldNames: string[]) {
  return `${url.trim()}::${fieldNames.length ? fieldNames.join('\u001f') : '*'}`;
}

async function loadFeishuRecords(url: string, fieldNames: string[]) {
  const records: CachedFeishuRecord[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const response = await fetch('/api/feishu/records', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: fieldNames.length ? 'search' : 'list',
        url,
        pageSize: 500,
        pageToken,
        fieldNames: fieldNames.length ? fieldNames : undefined,
      }),
    });
    const result = await response.json() as FeishuRecordListResult;
    if (!response.ok || !result.success) {
      throw new Error(result.error || '读取飞书红人资料失败。');
    }

    records.push(...(result.data?.items || []));
    if (!result.data?.has_more || !result.data.page_token) break;
    pageToken = result.data.page_token;
  }

  return records;
}

export function fetchFeishuRecordSnapshot(
  url: string,
  options: { force?: boolean; fieldNames?: string[] } = {},
) {
  const normalizedUrl = url.trim();
  const fieldNames = normalizeFieldNames(options.fieldNames);
  const cacheKey = buildCacheKey(normalizedUrl, fieldNames);
  if (options.force) {
    recordCache.delete(cacheKey);
    pendingRequests.delete(cacheKey);
    requestVersions.set(cacheKey, (requestVersions.get(cacheKey) || 0) + 1);
  }
  const cached = recordCache.get(cacheKey);
  if (cached && cached.snapshot.expiresAt > Date.now()) {
    return Promise.resolve({ ...cached.snapshot, cacheHit: true });
  }

  const pending = pendingRequests.get(cacheKey);
  if (pending) return pending.then((snapshot) => ({ ...snapshot, cacheHit: true }));

  const requestVersion = requestVersions.get(cacheKey) || 0;
  const request = loadFeishuRecords(normalizedUrl, fieldNames)
    .then((records) => {
      const fetchedAt = Date.now();
      const snapshot: Omit<FeishuRecordSnapshot, 'cacheHit'> = {
        records,
        fetchedAt,
        expiresAt: fetchedAt + FEISHU_RECORD_CACHE_TTL_MS,
        cacheKey,
        fieldNames,
      };
      if ((requestVersions.get(cacheKey) || 0) === requestVersion) {
        recordCache.set(cacheKey, { snapshot });
      }
      return { ...snapshot, cacheHit: false };
    })
    .finally(() => {
      if (pendingRequests.get(cacheKey) === request) {
        pendingRequests.delete(cacheKey);
      }
    });

  pendingRequests.set(cacheKey, request);
  return request;
}

export async function fetchFeishuRecordsCached(
  url: string,
  options: { force?: boolean; fieldNames?: string[] } = {},
) {
  const snapshot = await fetchFeishuRecordSnapshot(url, options);
  return snapshot.records;
}

export function invalidateFeishuRecordsCache(url: string) {
  const prefix = `${url.trim()}::`;
  const keys = new Set([...recordCache.keys(), ...pendingRequests.keys()]);
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    recordCache.delete(key);
    pendingRequests.delete(key);
    requestVersions.set(key, (requestVersions.get(key) || 0) + 1);
  }
}

export function clearFeishuRecordsCache() {
  recordCache.clear();
  pendingRequests.clear();
  requestVersions.clear();
}
