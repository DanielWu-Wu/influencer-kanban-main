import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GmailTranslationPrefetchQueue,
  clearGmailTranslationRequests,
  getGmailTranslationScopeKey,
  getLegacyGmailTranslationScopeKey,
  getMailTranslationScopeKey,
  getMailTranslationStorageMessageId,
  requestGmailTranslation,
  selectDailyMailTranslationPrefetchCandidates,
  selectGmailTranslationPrefetchCandidates,
  type MailTranslationPrefetchCandidate,
} from '../src/lib/gmail-translation-prefetch';

function candidate(messageId: string, date: string): MailTranslationPrefetchCandidate {
  return {
    provider: 'gmail',
    mailAccountId: 'gmail:one@gmail.com',
    mailAddress: 'one@gmail.com',
    messageId,
    threadId: `thread-${messageId}`,
    from: `${messageId}@example.com`,
    subject: messageId,
    body: `body-${messageId}`,
    date,
  };
}

function nextTurn() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test('Gmail 预翻译候选按时间排序、去重、跳过缓存且最多保留三封', () => {
  const selected = selectGmailTranslationPrefetchCandidates([
    candidate('old', '2026-08-18T08:00:00.000Z'),
    candidate('newest', '2026-08-18T10:00:00.000Z'),
    candidate('cached', '2026-08-18T11:00:00.000Z'),
    candidate('middle', '2026-08-18T09:00:00.000Z'),
    candidate('newest', '2026-08-18T12:00:00.000Z'),
    candidate('older', '2026-08-18T07:00:00.000Z'),
  ], ['cached']);

  assert.deepEqual(selected.map((item) => item.messageId), ['newest', 'middle', 'old']);
});

test('每日待办预翻译覆盖 Gmail 和腾讯全部未完成来信并忽略已读状态', () => {
  const selected = selectDailyMailTranslationPrefetchCandidates([
    { ...candidate('gmail-read', '2026-08-18T10:00:00.000Z') },
    { ...candidate('gmail-completed', '2026-08-18T09:00:00.000Z'), completedAt: '2026-08-18T09:30:00.000Z' },
    {
      ...candidate('tencent', '2026-08-18T08:00:00.000Z'),
      provider: 'tencent_exmail' as const,
      mailAccountId: 'tencent_exmail:one@example.com',
      mailAddress: 'one@example.com',
    },
    { ...candidate('answered', '2026-08-18T07:00:00.000Z'), answeredAt: '2026-08-18T07:30:00.000Z' },
    { ...candidate('empty', '2026-08-18T06:00:00.000Z'), body: '   ' },
  ]);

  assert.deepEqual(selected.map((item) => item.messageId), ['gmail-read', 'tencent']);
});

test('Gmail 预翻译队列严格单并发并按顺序继续处理', async () => {
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;
  const queue = new GmailTranslationPrefetchQueue(async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(item.messageId);
    await nextTurn();
    active -= 1;
  });

  queue.enqueue([
    candidate('10:00', '2026-08-18T10:00:00.000Z'),
    candidate('09:00', '2026-08-18T09:00:00.000Z'),
    candidate('08:00', '2026-08-18T08:00:00.000Z'),
  ]);
  await nextTurn();
  await nextTurn();
  await nextTurn();
  await nextTurn();

  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['10:00', '09:00', '08:00']);
});

test('统一预翻译队列不再限制三封并保持 Gmail 与腾讯单并发', async () => {
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;
  const queue = new GmailTranslationPrefetchQueue(async (item) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    order.push(`${item.provider}:${item.messageId}`);
    await nextTurn();
    active -= 1;
  });
  const candidates = [
    candidate('gmail-1', '2026-08-18T10:00:00.000Z'),
    candidate('gmail-2', '2026-08-18T09:00:00.000Z'),
    candidate('gmail-3', '2026-08-18T08:00:00.000Z'),
    { ...candidate('tencent-1', '2026-08-18T07:00:00.000Z'), provider: 'tencent_exmail' as const, mailAccountId: 'tencent_exmail:one@example.com' },
    { ...candidate('tencent-2', '2026-08-18T06:00:00.000Z'), provider: 'tencent_exmail' as const, mailAccountId: 'tencent_exmail:one@example.com' },
  ];

  queue.enqueue(candidates);
  for (let index = 0; index < 8; index += 1) await nextTurn();

  assert.equal(maxActive, 1);
  assert.deepEqual(order, [
    'gmail:gmail-1',
    'gmail:gmail-2',
    'gmail:gmail-3',
    'tencent_exmail:tencent-1',
    'tencent_exmail:tencent-2',
  ]);
});

test('用户打开排队邮件时会将它提升为下一项', async () => {
  const order: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const queue = new GmailTranslationPrefetchQueue(async (item) => {
    order.push(item.messageId);
    if (item.messageId === '10:00') await firstBlocked;
  });

  queue.enqueue([
    candidate('10:00', '2026-08-18T10:00:00.000Z'),
    candidate('09:00', '2026-08-18T09:00:00.000Z'),
    candidate('08:00', '2026-08-18T08:00:00.000Z'),
  ]);
  queue.prioritize('08:00');
  releaseFirst?.();
  await nextTurn();

  assert.deepEqual(order, ['10:00', '08:00', '09:00']);
});

test('完成待办会从尚未开始的队列移除，恢复后可以重新加入', async () => {
  const order: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = candidate('first', '2026-08-18T10:00:00.000Z');
  const removed = candidate('removed', '2026-08-18T09:00:00.000Z');
  const queue = new GmailTranslationPrefetchQueue(async (item) => {
    order.push(item.messageId);
    if (item.messageId === 'first') await firstBlocked;
  });

  queue.synchronize([first, removed]);
  queue.synchronize([first]);
  releaseFirst?.();
  await nextTurn();
  assert.deepEqual(order, ['first']);

  queue.synchronize([first, removed]);
  await nextTurn();
  assert.deepEqual(order, ['first', 'removed']);
});

test('后台失败任务本轮不会自动重复进入队列', async () => {
  let attempts = 0;
  const failed = candidate('failed', '2026-08-18T10:00:00.000Z');
  const queue = new GmailTranslationPrefetchQueue(async () => {
    attempts += 1;
    throw new Error('temporary failure');
  });

  queue.enqueue([failed]);
  await nextTurn();
  queue.enqueue([failed]);
  await nextTurn();

  assert.equal(attempts, 1);
});

test('翻译作用域同时隔离系统账号和 Gmail 邮箱', () => {
  assert.notEqual(
    getGmailTranslationScopeKey('one@gmail.com', 'account-a'),
    getGmailTranslationScopeKey('one@gmail.com', 'account-b'),
  );
  assert.notEqual(
    getGmailTranslationScopeKey('one@gmail.com', 'account-a'),
    getGmailTranslationScopeKey('two@gmail.com', 'account-a'),
  );
});

test('统一翻译作用域按邮箱账号隔离并兼容旧 Gmail 预翻译键', () => {
  assert.equal(
    getMailTranslationScopeKey('gmail:one@gmail.com', 'account-a'),
    getGmailTranslationScopeKey('gmail:one@gmail.com', 'account-a'),
  );
  assert.notEqual(
    getMailTranslationScopeKey('gmail:one@gmail.com', 'account-a'),
    getMailTranslationScopeKey('tencent_exmail:one@gmail.com', 'account-a'),
  );
  assert.equal(
    getLegacyGmailTranslationScopeKey('one@gmail.com', 'account-a'),
    'account-a::one@gmail.com',
  );
});

test('长期翻译缓存键同时隔离邮箱作用域和邮件编号', () => {
  const gmailScope = getGmailTranslationScopeKey('one@gmail.com', 'account-a');
  const tencentScope = getGmailTranslationScopeKey('tencent-mail-account-id', 'account-a');

  assert.notEqual(
    getMailTranslationStorageMessageId(gmailScope, 'same-message-id'),
    getMailTranslationStorageMessageId(tencentScope, 'same-message-id'),
  );
  assert.notEqual(
    getMailTranslationStorageMessageId(gmailScope, 'same-message-id'),
    getMailTranslationStorageMessageId(gmailScope, 'another-message-id'),
  );
});

test('相同邮件的手动翻译与后台翻译复用同一个请求', async () => {
  clearGmailTranslationRequests();
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return new Response(JSON.stringify({
      success: true,
      data: { translatedText: '译文', sourceLang: 'es' },
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const options = {
      scopeKey: 'account-a::one@gmail.com',
      messageId: 'message-1',
      text: 'Hola',
      settings: {},
    };
    const backgroundRequest = requestGmailTranslation(options);
    const manualRequest = requestGmailTranslation(options);
    assert.equal(backgroundRequest, manualRequest);
    assert.equal((await manualRequest).translatedText, '译文');
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearGmailTranslationRequests();
  }
});

test('同一账号和 Gmail 邮箱的翻译请求严格单并发', async () => {
  clearGmailTranslationRequests();
  const originalFetch = globalThis.fetch;
  const releases: Array<() => void> = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  globalThis.fetch = async () => {
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    await new Promise<void>((resolve) => releases.push(resolve));
    activeRequests -= 1;
    return new Response(JSON.stringify({
      success: true,
      data: { translatedText: '译文', sourceLang: 'es' },
    }), { headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const first = requestGmailTranslation({
      scopeKey: 'account-a::one@gmail.com',
      messageId: 'message-1',
      text: 'Hola',
      settings: {},
    });
    const second = requestGmailTranslation({
      scopeKey: 'account-a::one@gmail.com',
      messageId: 'message-2',
      text: 'Buenos dias',
      settings: {},
    });
    await nextTurn();
    assert.equal(activeRequests, 1);
    releases.shift()?.();
    await first;
    await nextTurn();
    assert.equal(activeRequests, 1);
    releases.shift()?.();
    await second;
    assert.equal(maxActiveRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearGmailTranslationRequests();
  }
});
