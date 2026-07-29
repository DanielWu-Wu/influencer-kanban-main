import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearFeishuRecordsCache,
  fetchFeishuRecordSnapshot,
  invalidateFeishuRecordsCache,
} from '../src/lib/feishu-record-cache';

test('60秒快照复用、进行中请求去重、按 URL 失效与强制刷新', async () => {
  clearFeishuRecordsCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({
      success: true,
      data: {
        items: [{ record_id: `record-${requestCount}`, fields: { 邮箱: 'a@example.com' } }],
        has_more: false,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const [first, pendingReuse] = await Promise.all([
      fetchFeishuRecordSnapshot('https://example.feishu.cn/base/abc', { fieldNames: ['邮箱'] }),
      fetchFeishuRecordSnapshot('https://example.feishu.cn/base/abc', { fieldNames: ['邮箱'] }),
    ]);
    assert.equal(requestCount, 1);
    assert.equal(first.cacheHit, false);
    assert.equal(pendingReuse.cacheHit, true);

    const cached = await fetchFeishuRecordSnapshot(
      'https://example.feishu.cn/base/abc',
      { fieldNames: ['邮箱'] },
    );
    assert.equal(cached.cacheHit, true);
    assert.equal(requestCount, 1);

    invalidateFeishuRecordsCache('https://example.feishu.cn/base/abc');
    await fetchFeishuRecordSnapshot(
      'https://example.feishu.cn/base/abc',
      { fieldNames: ['邮箱'] },
    );
    assert.equal(requestCount, 2);

    await fetchFeishuRecordSnapshot(
      'https://example.feishu.cn/base/abc',
      { force: true, fieldNames: ['邮箱'] },
    );
    assert.equal(requestCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    clearFeishuRecordsCache();
  }
});

test('字段集合排序后共享同一缓存键，不同字段投影相互隔离', async () => {
  clearFeishuRecordsCache();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      success: true,
      data: { items: [], has_more: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    await fetchFeishuRecordSnapshot('https://example.feishu.cn/base/abc', {
      fieldNames: ['频道链接', '邮箱'],
    });
    await fetchFeishuRecordSnapshot('https://example.feishu.cn/base/abc', {
      fieldNames: ['邮箱', '频道链接'],
    });
    await fetchFeishuRecordSnapshot('https://example.feishu.cn/base/abc', {
      fieldNames: ['频道名'],
    });
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    clearFeishuRecordsCache();
  }
});

test('快照超过60秒后自动重新读取', async () => {
  clearFeishuRecordsCache();
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  let now = 1_000_000;
  let requestCount = 0;
  Date.now = () => now;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      success: true,
      data: { items: [], has_more: false },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    await fetchFeishuRecordSnapshot('https://example.feishu.cn/base/ttl');
    now += 59_999;
    await fetchFeishuRecordSnapshot('https://example.feishu.cn/base/ttl');
    assert.equal(requestCount, 1);
    now += 2;
    const refreshed = await fetchFeishuRecordSnapshot('https://example.feishu.cn/base/ttl');
    assert.equal(requestCount, 2);
    assert.equal(refreshed.cacheHit, false);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
    clearFeishuRecordsCache();
  }
});
