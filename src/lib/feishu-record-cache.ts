export type CachedFeishuRecord = {
  record_id: string;
  fields: Record<string, unknown>;
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
  records: CachedFeishuRecord[];
  expiresAt: number;
};

const FEISHU_RECORD_CACHE_TTL_MS = 60_000;
const recordCache = new Map<string, CacheEntry>();
const pendingRequests = new Map<string, Promise<CachedFeishuRecord[]>>();

async function loadFeishuRecords(url: string) {
  const records: CachedFeishuRecord[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const response = await fetch('/api/feishu/records', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'list',
        url,
        pageSize: 500,
        pageToken,
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

export function fetchFeishuRecordsCached(
  url: string,
  options: { force?: boolean } = {},
) {
  const cacheKey = url.trim();
  if (options.force) recordCache.delete(cacheKey);
  const cached = recordCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.records);

  const pending = pendingRequests.get(cacheKey);
  if (pending) return pending;

  const request = loadFeishuRecords(cacheKey)
    .then((records) => {
      recordCache.set(cacheKey, {
        records,
        expiresAt: Date.now() + FEISHU_RECORD_CACHE_TTL_MS,
      });
      return records;
    })
    .finally(() => {
      pendingRequests.delete(cacheKey);
    });

  pendingRequests.set(cacheKey, request);
  return request;
}
