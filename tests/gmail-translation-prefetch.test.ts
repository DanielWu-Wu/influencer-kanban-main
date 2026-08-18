import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GmailTranslationPrefetchQueue,
  clearGmailTranslationRequests,
  getGmailTranslationScopeKey,
  requestGmailTranslation,
  selectGmailTranslationPrefetchCandidates,
  type GmailTranslationPrefetchCandidate,
} from '../src/lib/gmail-translation-prefetch';

function candidate(messageId: string, date: string): GmailTranslationPrefetchCandidate {
  return {
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
