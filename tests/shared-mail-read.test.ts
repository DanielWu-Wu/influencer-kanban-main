import test from 'node:test';
import assert from 'node:assert/strict';
import { MailReadCoordinator } from '../src/lib/mail-read-coordinator';
import { sharedMailFetch, bindGmailReadAccount, invalidateMailReads } from '../src/lib/shared-mail-read';
import { setAccountCacheScope } from '../src/lib/account-cache-scope';
import { readSharedGmailDaily, readSharedFollowUp, readSharedTencentBody } from '../src/lib/shared-mail-workflows';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test('共享读取：相同请求只执行一次，强制刷新不重复并发，TTL 到期再读', async () => {
  let now = 1000;
  let calls = 0;
  const c = new MailReadCoordinator(() => now);
  const load = async () => { await tick(); return ++calls; };
  assert.deepEqual(await Promise.all([c.load('a', 'x', load), c.load('a', 'x', load, { force: true })]), [1, 1]);
  assert.equal(await c.load('a', 'x', load), 1);
  now += 60001;
  assert.equal(await c.load('a', 'x', load), 2);
  assert.equal(await c.load('b', 'x', load), 3);
});
test('共享读取：每邮箱限制并发，排队的前台读取优先，其他邮箱独立', async () => {
  const c = new MailReadCoordinator(Date.now, 1);
  let release!: () => void;
  const order: string[] = [];
  const first = c.load('a', 'running', () => new Promise<void>((r) => { release = r; }));
  await tick();
  const background = c.load('a', 'background', async () => { order.push('background'); }, { priority: 2 });
  const foreground = c.load('a', 'foreground', async () => { order.push('foreground'); }, { priority: 0 });
  await c.load('b', 'other', async () => { order.push('other'); });
  release();
  await Promise.all([first, foreground, background]);
  assert.deepEqual(order, ['other', 'foreground', 'background']);
});
test('共享读取：账号作废、邮件版本变化后，旧请求不能重新写入缓存', async () => {
  for (const invalidate of [(c: MailReadCoordinator) => c.invalidate('a'), (c: MailReadCoordinator) => c.forget('a', 'x')]) {
    const c = new MailReadCoordinator();
    let release!: (n: number) => void;
    const p = c.load('a', 'x', () => new Promise<number>((r) => { release = r; }));
    await tick();
    invalidate(c);
    release(1);
    await assert.rejects(p, /状态已变化/);
    assert.equal(c.peek('a', 'x'), undefined);
    assert.equal(await c.load('a', 'x', async () => 2), 2);
  }
});
test('共享读取：冷却只影响当前邮箱，失败不缓存，到期可恢复', async () => {
  let now = 1000;
  const c = new MailReadCoordinator(() => now);
  c.cooldown('a', 60000);
  await assert.rejects(c.load('a', 'x', async () => 1), /受限/);
  assert.equal(await c.load('b', 'x', async () => 2), 2);
  now += 60001;
  assert.equal(await c.load('a', 'x', async () => 3), 3);
  await assert.rejects(c.load('a', 'error', async () => { throw new Error('network'); }));
  assert.equal(c.peek('a', 'error'), undefined);
});
test('共享读取：缓存大小有上限', () => {
  const c = new MailReadCoordinator(Date.now, 2, 2);
  c.seed('a', '1', 1); c.seed('a', '2', 2); c.seed('a', '3', 3);
  assert.equal(c.peek('a', '1'), undefined);
  assert.equal(c.peek('a', '3'), 3);
});

const incoming = (id: string, history = '1') => ({
  id, threadId: 'thread', historyId: history, internalDate: String(Date.parse('2026-09-13T10:00:00Z')),
  labelIds: ['INBOX', 'UNREAD'], payload: { mimeType: 'text/plain', headers: [
    { name: 'From', value: 'creator@example.com' }, { name: 'To', value: 'owner@example.com' },
    { name: 'Subject', value: '合作' }, { name: 'Message-ID', value: `<${id}@example.com>` },
  ], body: { data: Buffer.from('Hello creator').toString('base64url') } },
});
function setup() {
  invalidateMailReads();
  setAccountCacheScope('test-user');
  bindGmailReadAccount('owner@example.com', 'test-token');
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
test('Gmail 真正共用：收件箱完整会话 → 待办 → Follow Up，只读一次相同正文', async () => {
  setup();
  const original = globalThis.fetch;
  let full = 0;
  let metadata = 0;
  let current = { id: 'thread', historyId: '1', messages: [incoming('m1')] };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://test');
    if (url.searchParams.get('action') === 'readReferences') return json({ success: true, data: {
      references: url.searchParams.get('kind') === 'daily' ? [{ id: 'thread' }] : current.messages.map((m) => ({ id: m.id, threadId: 'thread' })),
    } });
    if (url.searchParams.get('format') === 'metadata') {
      metadata++;
      return json({ success: true, data: { ...current, messages: current.messages.map((m) => ({ ...m, payload: { headers: m.payload.headers } })) } });
    }
    full++;
    return json(url.hostname === 'gmail.googleapis.com' ? current : { success: true, data: current });
  };
  try {
    const first = await sharedMailFetch('https://gmail.googleapis.com/gmail/v1/users/me/threads/thread?format=full', { headers: { Authorization: 'Bearer test-token' } });
    assert.equal((await first.json()).id, 'thread');
    assert.equal((await readSharedGmailDaily())[0].body, 'Hello creator');
    await readSharedFollowUp({ provider: 'gmail', mailAccountId: 'gmail:owner@example.com', email: 'creator@example.com', developmentDate: Date.parse('2026-09-01') });
    assert.equal(full, 1);
    assert.equal(metadata, 2);
    current = { id: 'thread', historyId: '2', messages: [incoming('m1'), incoming('m2', '2')] };
    const daily = await readSharedGmailDaily(true);
    assert.equal(daily.length, 1);
    assert.equal(full, 2, 'new history causes a fresh complete read');
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});
test('Gmail 首次待办冷启动不额外读 metadata，读取失败不能变成无来信', async () => {
  setup();
  const original = globalThis.fetch;
  let metadata = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://test');
    if (url.searchParams.get('action') === 'readReferences') return json({ success: true, data: { references: [{ id: 'thread' }] } });
    if (url.searchParams.get('format') === 'metadata') metadata++;
    return json({ error: '正文读取失败' }, 503);
  };
  try {
    await assert.rejects(readSharedGmailDaily(), /正文读取失败/);
    assert.equal(metadata, 0);
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});
test('Gmail 第 51 封继续分页，不完整分页明确报错', async () => {
  setup();
  const original = globalThis.fetch;
  let pages = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://test');
    if (url.searchParams.get('action') === 'readReferences') {
      pages++;
      return json({ success: true, data: { references: [], nextPageToken: 'same' } });
    }
    throw new Error('unexpected body read');
  };
  try {
    await assert.rejects(readSharedGmailDaily(), /尚未完整/);
    assert.equal(pages, 2);
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});
test('腾讯完整会话可为待办、预翻译和 Follow Up 共用正文；不同邮箱不能串用', async () => {
  setup();
  const original = globalThis.fetch;
  let bodies = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://test');
    if (url.searchParams.get('action') === 'thread') return json({ success: true, data: {
      id: 't', messages: [{ id: 'm', folderRef: 'INBOX', providerMessageRef: '1', rfcMessageId: '<m@example.com>', body: '瑞典来信完整正文' }],
    } });
    bodies++;
    return json({ success: true, data: { body: '另一个邮箱' } });
  };
  try {
    await sharedMailFetch('/api/mail/tencent?action=thread&mailAccountId=tencent-a&folder=INBOX&uid=1');
    const message = { folderRef: 'INBOX', providerMessageRef: '1', rfcMessageId: '<m@example.com>' };
    assert.equal(await readSharedTencentBody('tencent-a', message), '瑞典来信完整正文');
    assert.equal(await readSharedTencentBody('tencent-a', message), '瑞典来信完整正文');
    assert.equal(bodies, 0);
    assert.equal(await readSharedTencentBody('tencent-b', message), '另一个邮箱');
    assert.equal(bodies, 1);
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});
test('共享 HTTP：一个查看者取消不取消另一个；响应体可各自读取', async () => {
  setup();
  const original = globalThis.fetch;
  let release!: () => void;
  let calls = 0;
  globalThis.fetch = async () => { calls++; await new Promise<void>((r) => { release = r; }); return json({ success: true, data: { body: '完整正文' } }); };
  try {
    const controller = new AbortController();
    const url = '/api/mail/tencent?action=messageBody&mailAccountId=a&folder=INBOX&uid=1';
    const first = sharedMailFetch(url, { signal: controller.signal });
    const second = sharedMailFetch(url);
    await tick();
    controller.abort();
    await assert.rejects(first, { name: 'AbortError' });
    release();
    assert.equal((await (await second).json()).data.body, '完整正文');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});
test('共享 HTTP：写入不缓存、不重试；成功或未知结果都作废读取缓存', async () => {
  setup();
  const original = globalThis.fetch;
  let gets = 0; let posts = 0;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === 'POST') { posts++; return json({ error: 'unknown' }, 503); }
    gets++; return json({ success: true, data: { body: '正文' } });
  };
  try {
    const url = '/api/mail/tencent?action=messageBody&mailAccountId=a&folder=INBOX&uid=1';
    await sharedMailFetch(url); await sharedMailFetch(url);
    await sharedMailFetch('/api/mail/tencent', { method: 'POST', body: '{}' });
    await sharedMailFetch(url);
    assert.equal(gets, 2); assert.equal(posts, 1);
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});
test('共享 HTTP：旧账号 Token 禁止读取，429 会使后续同邮箱后台请求冷却', async () => {
  setup();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ error: 'rateLimitExceeded' }, 429); };
  try {
    await sharedMailFetch('/api/mail/tencent?action=messageBody&mailAccountId=limited&folder=INBOX&uid=1');
    await assert.rejects(sharedMailFetch('/api/mail/tencent?action=messageBody&mailAccountId=limited&folder=INBOX&uid=2'), /受限/);
    assert.equal(calls, 1);
    setAccountCacheScope('other-user');
    await assert.rejects(sharedMailFetch('https://gmail.googleapis.com/gmail/v1/users/me/threads/t?format=full', { headers: { Authorization: 'Bearer test-token' } }), /身份已变化/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});

test('Gmail 51 封真实分页合并，不遗漏第二页，冷启动每会话正文只读一次', async () => {
  setup();
  const original = globalThis.fetch;
  let pages = 0, full = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://test');
    if (url.searchParams.get('action') === 'readReferences') {
      pages++;
      const second = Boolean(url.searchParams.get('pageToken'));
      return json({ success: true, data: { references: Array.from({ length: second ? 1 : 50 }, (_, i) => ({ id: `t${second ? 50 : i}` })), nextPageToken: second ? null : 'page2' } });
    }
    full++;
    const id = url.searchParams.get('threadId')!;
    return json({ success: true, data: { id, historyId: '1', messages: [{ ...incoming(id), threadId: id }] } });
  };
  try {
    const result = await readSharedGmailDaily();
    assert.equal(result.length, 51); assert.equal(pages, 2); assert.equal(full, 51);
    assert.ok(result.some((m) => m.threadId === 't50'));
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});
test('腾讯同一会话新回复使详情失效，文件夹版本变化不能复用旧正文', async () => {
  setup();
  const original = globalThis.fetch;
  let full = 0, bodies = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://test');
    if (url.searchParams.get('action') === 'thread') {
      full++;
      assert.equal(url.searchParams.get('forceRefresh'), '1');
      return json({ success: true, data: { messages: [{ id: 'm', body: 'old', folderRef: 'INBOX', providerMessageRef: '1', rfcMessageId: '<m@example.com>', mailboxVersion: '1' }] } });
    }
    if (url.searchParams.get('action') === 'dailyTodos') return json({ success: true, data: [{ messageId: 'new', references: '<m@example.com>', folderRef: 'INBOX', mailboxVersion: '1' }] });
    bodies++;
    return json({ success: true, data: { body: 'new generation' } });
  };
  try {
    const detail = '/api/mail/tencent?action=thread&mailAccountId=a&folder=INBOX&uid=1';
    await sharedMailFetch(detail); await sharedMailFetch(detail + '&rfcMessageId=%3Cm%40example.com%3E');
    assert.equal(full, 1);
    await sharedMailFetch('/api/mail/tencent?action=dailyTodos&metadataOnly=1&mailAccountId=a');
    await sharedMailFetch(detail); assert.equal(full, 2);
    assert.equal(await readSharedTencentBody('a', { folderRef: 'INBOX', providerMessageRef: '1', rfcMessageId: '<m@example.com>', mailboxVersion: '2' }), 'new generation');
    assert.equal(bodies, 1);
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});
test('部分会话带警告时不缓存，也不用于证明翻译正文完整', async () => {
  setup();
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return json({ success: true, data: { messages: [], loadWarning: 'partial' } }); };
  try {
    const url = '/api/mail/tencent?action=thread&mailAccountId=a&folder=INBOX&uid=1';
    await sharedMailFetch(url); await sharedMailFetch(url); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; invalidateMailReads(); }
});
test('五分钟后的待办先核对版本，未变化复用正文；有变化立即重新读取', async () => {
  setup();
  const original = globalThis.fetch, originalNow = Date.now;
  let now = originalNow(), full = 0, revision = '1';
  Date.now = () => now;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), 'https://test');
    if (url.searchParams.get('action') === 'readReferences') return json({ success: true, data: { references: [{ id: 'thread' }] } });
    if (url.searchParams.get('format') !== 'metadata') full++;
    return json({ success: true, data: { id: 'thread', historyId: revision, messages: [incoming('m', revision)] } });
  };
  try {
    await readSharedGmailDaily(); assert.equal(full, 1);
    now += 300001;
    await readSharedGmailDaily(); assert.equal(full, 1);
    now += 300001; revision = '2';
    await readSharedGmailDaily(); assert.equal(full, 2);
  } finally { Date.now = originalNow; globalThis.fetch = original; invalidateMailReads(); }
});
