import test from 'node:test';
import assert from 'node:assert/strict';
import { getFeishuSessionState } from '../src/lib/feishu-session-state';
import type { StoredFeishuAuth } from '../src/lib/feishu-cloud-auth';

const credentials = { configured: true, source: 'personal' as const, appId: 'cli_saved_app' };
const stored: StoredFeishuAuth = {
  isConnected: true,
  accessToken: 'stored-token',
  refreshToken: 'refresh-token',
  expiresAt: 1,
};

test('飞书刷新失败仍保留应用配置并提供重新连接入口', async () => {
  let attempts = 0;
  const state = await getFeishuSessionState(credentials, stored, async () => {
    attempts += 1;
    throw new Error('飞书授权刷新失败 (400)');
  });

  assert.equal(attempts, 1);
  assert.deepEqual(state, {
    ...credentials,
    connected: false,
    reconnectRequired: true,
    error: '飞书授权刷新失败 (400)',
  });
});

test('已有有效授权继续显示连接，未授权时不触发刷新', async () => {
  const connected = await getFeishuSessionState(credentials, stored, async () => ({ ...stored, expiresAt: 1234 }));
  assert.equal(connected.connected, true);
  assert.equal('data' in connected ? connected.data.expiresAt : undefined, 1234);

  const missing = await getFeishuSessionState(credentials, null, async () => {
    throw new Error('不应刷新');
  });
  assert.deepEqual(missing, { ...credentials, connected: false });
});
