import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReuseReadyWorkspaceSession,
  runSafeRequestWithSessionRecovery,
  shouldRefreshWorkspaceSession,
  shouldRetrySafeRequestAfterSessionRecovery,
  WORKSPACE_SESSION_READY_CACHE_MS,
} from '../src/lib/session-recovery';

test('系统会话在即将过期或缺少过期时间时主动静默刷新', () => {
  const now = Date.parse('2026-08-24T10:00:00.000Z');
  assert.equal(shouldRefreshWorkspaceSession(undefined, now), true);
  assert.equal(shouldRefreshWorkspaceSession((now + 4 * 60 * 1000) / 1000, now), true);
  assert.equal(shouldRefreshWorkspaceSession((now + 10 * 60 * 1000) / 1000, now), false);
});

test('只有同一令牌且刚验证过的系统会话可以跳过重复恢复', () => {
  const now = Date.parse('2026-08-24T10:00:00.000Z');
  const base = {
    readyAt: now - 1_000,
    readyAccessToken: 'token-a',
    currentAccessToken: 'token-a',
    expiresAtSeconds: (now + 10 * 60 * 1000) / 1000,
    now,
  };
  assert.equal(canReuseReadyWorkspaceSession(base), true);
  assert.equal(canReuseReadyWorkspaceSession({ ...base, currentAccessToken: 'token-b' }), false);
  assert.equal(canReuseReadyWorkspaceSession({
    ...base,
    readyAt: now - WORKSPACE_SESSION_READY_CACHE_MS,
  }), false);
});

test('只有安全请求遇到登录或权限响应时进入一次会话恢复重试', () => {
  assert.equal(shouldRetrySafeRequestAfterSessionRecovery(401), true);
  assert.equal(shouldRetrySafeRequestAfterSessionRecovery(403), true);
  assert.equal(shouldRetrySafeRequestAfterSessionRecovery(400), false);
  assert.equal(shouldRetrySafeRequestAfterSessionRecovery(500), false);
});

test('安全请求在旧服务端会话返回未登录后静默恢复并只重试一次', async () => {
  const ensureOptions: Array<{ forceRefresh?: boolean; forceVerify?: boolean } | undefined> = [];
  let requestCount = 0;
  const response = await runSafeRequestWithSessionRecovery(
    async (options) => {
      ensureOptions.push(options);
      return { userId: 'member-a' };
    },
    async () => {
      requestCount += 1;
      return new Response(null, { status: requestCount === 1 ? 401 : 200 });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(requestCount, 2);
  assert.deepEqual(ensureOptions, [undefined, { forceRefresh: true, forceVerify: true }]);
});

test('安全请求成功时不重复恢复，不会形成刷新循环', async () => {
  let ensureCount = 0;
  let requestCount = 0;
  const response = await runSafeRequestWithSessionRecovery(
    async () => {
      ensureCount += 1;
      return { userId: 'member-a' };
    },
    async () => {
      requestCount += 1;
      return new Response(null, { status: 200 });
    },
  );
  assert.equal(response.status, 200);
  assert.equal(ensureCount, 1);
  assert.equal(requestCount, 1);
});
