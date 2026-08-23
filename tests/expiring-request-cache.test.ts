import test from 'node:test';
import assert from 'node:assert/strict';
import { ExpiringRequestCache } from '../src/lib/expiring-request-cache';

test('60 秒缓存复用结果，强制刷新会跳过旧缓存', async () => {
  let now = 1_000;
  let calls = 0;
  const cache = new ExpiringRequestCache<number>(60_000, () => now);
  const load = () => cache.load('user-a|account-a|INBOX|1', async () => ++calls);

  assert.equal(await load(), 1);
  assert.equal(await load(), 1);
  assert.equal(await cache.load('user-a|account-a|INBOX|1', async () => ++calls, { force: true }), 2);
  now += 60_001;
  assert.equal(await load(), 3);
});

test('相同会话的并发请求只执行一次，账号缓存互不影响', async () => {
  let resolveRequest: ((value: string) => void) | undefined;
  let calls = 0;
  const cache = new ExpiringRequestCache<string>(60_000);
  const loader = () => {
    calls += 1;
    return new Promise<string>((resolve) => { resolveRequest = resolve; });
  };
  const first = cache.load('user-a|account-a|INBOX|1', loader);
  const second = cache.load('user-a|account-a|INBOX|1', loader);
  resolveRequest?.('thread-a');
  assert.deepEqual(await Promise.all([first, second]), ['thread-a', 'thread-a']);
  assert.equal(calls, 1);

  cache.set('user-a|account-b|INBOX|1', 'thread-b');
  cache.invalidatePrefix('user-a|account-a|');
  assert.equal(cache.get('user-a|account-a|INBOX|1'), undefined);
  assert.equal(cache.get('user-a|account-b|INBOX|1'), 'thread-b');
});
