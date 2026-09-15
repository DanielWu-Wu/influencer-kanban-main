import assert from 'node:assert/strict';
import test from 'node:test';
import { registerWorkspaceSession, workspaceFetch, WorkspaceRequestError } from '../src/lib/workspace-request';

const session = { user: { id: 'a' }, access_token: 'fresh-token' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('AI 与翻译等待会话就绪再请求，使用最新凭证，取消单个请求不取消共享恢复', async () => {
  const original = globalThis.fetch;
  let release!: (value: typeof session) => void;
  const pending = new Promise<typeof session>(resolve => { release = resolve; });
  const unregister = registerWorkspaceSession({ userId: () => 'a', ensure: () => pending });
  const sent: string[] = [];
  globalThis.fetch = async (_url, init) => { sent.push(new Headers(init?.headers).get('Authorization')!); return Response.json({ success: true }); };
  try {
    const abort = new AbortController();
    const cancelled = workspaceFetch('/api/ai', { signal: abort.signal });
    const active = workspaceFetch('/api/translate');
    const rejection = assert.rejects(cancelled, { name: 'AbortError' });
    abort.abort();
    await rejection;
    assert.equal(sent.length, 0);
    release(session);
    await active;
    assert.deepEqual(sent, ['Bearer fresh-token']);
  } finally { unregister(); globalThis.fetch = original; }
});

test('仅明确未执行 AI 的会话失效重试一次，未知401、403、503和网络错误不重试或降级', async () => {
  const original = globalThis.fetch;
  let recoveries = 0;
  const unregister = registerWorkspaceSession({ userId: () => 'a', ensure: async options => { if (options?.forceRefresh) recoveries++; return session; } });
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return calls === 1 ? Response.json({ code: 'SESSION_INVALID', executionStarted: false }, { status: 401 }) : Response.json({ success: true }); };
    assert.equal((await workspaceFetch('/api/ai')).status, 200);
    assert.equal(calls, 2); assert.equal(recoveries, 1);
    for (const [status, body] of [[401, {}], [403, { code: 'ACCOUNT_DISABLED' }], [503, { code: 'ACCOUNT_SERVICE_UNAVAILABLE', executionStarted: false }], [500, { error: 'AI error' }]] as const) {
      calls = 0;
      globalThis.fetch = async () => { calls++; return Response.json(body, { status }); };
      await assert.rejects(workspaceFetch('/api/ai/gmail-reply-stream'), WorkspaceRequestError);
      assert.equal(calls, 1); assert.equal(recoveries, 1);
    }
    calls = 0;
    globalThis.fetch = async () => { calls++; throw new TypeError('network'); };
    await assert.rejects(workspaceFetch('/api/ai'), WorkspaceRequestError);
    assert.equal(calls, 1);
  } finally { unregister(); globalThis.fetch = original; }
});

test('恢复后仍会话失效只请求两次；账号改变或恢复失败不发送业务请求', async () => {
  const original = globalThis.fetch;
  let owner = 'a'; let calls = 0;
  let ensure: () => Promise<typeof session | null> = async () => session;
  const unregister = registerWorkspaceSession({ userId: () => owner, ensure: () => ensure() });
  globalThis.fetch = async () => { calls++; return Response.json({ code: 'SESSION_INVALID', executionStarted: false }, { status: 401 }); };
  try {
    await assert.rejects(workspaceFetch('/api/ai'), WorkspaceRequestError);
    assert.equal(calls, 2);
    calls = 0;
    ensure = async () => { await tick(); owner = 'b'; return { ...session, user: { id: 'b' } }; };
    await assert.rejects(workspaceFetch('/api/ai'), /账号已变化/);
    assert.equal(calls, 0);
    ensure = async () => { throw new Error('恢复超时'); };
    await assert.rejects(workspaceFetch('/api/ai'), /恢复超时/);
    assert.equal(calls, 0);
  } finally { unregister(); globalThis.fetch = original; }
});

test('外部模型地址和真实邮箱发送不注入系统凭证、不自动重试', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { assert.equal(new Headers(init?.headers).has('Authorization'), false); return new Response(null, { status: 401 }); };
  try {
    assert.equal((await workspaceFetch('https://external.example/api/ai')).status, 401);
    assert.equal((await workspaceFetch('/api/mail/tencent', { method: 'POST' })).status, 401);
  } finally { globalThis.fetch = original; }
});
