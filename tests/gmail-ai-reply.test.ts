import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompactGmailAIConversation,
  buildGmailAIAnalysisCacheKey,
  clearGmailAIReplyCaches,
  compactGmailAIMessageBody,
  getOrLoadGmailAIAnalysis,
  getOrLoadGmailAIHistory,
  GMAIL_AI_CACHE_MS,
  mergeRecentGmailAIMessages,
  selectRelevantGmailAIDraftMessages,
  type GmailAIHistoryMessage,
} from '../src/lib/gmail-ai-reply';

function message(index: number, overrides: Partial<GmailAIHistoryMessage> = {}): GmailAIHistoryMessage {
  return {
    id: `message-${index}`,
    threadId: `thread-${Math.floor(index / 3)}`,
    subject: '合作沟通',
    from: index % 2 === 0 ? 'creator@example.com' : 'me@example.com',
    to: index % 2 === 0 ? 'me@example.com' : 'creator@example.com',
    date: new Date(2026, 0, index + 1).toISOString(),
    body: `邮件正文 ${index}`,
    ...overrides,
  };
}

test('合并当前线程和 Gmail 结果后只保留最近 10 封，并复用当前正文', () => {
  const fetched = Array.from({ length: 12 }, (_, index) => message(index));
  const current = [
    message(11, { body: '页面已经加载的完整正文' }),
  ];
  const merged = mergeRecentGmailAIMessages(fetched, current);

  assert.equal(merged.length, 10);
  assert.equal(merged[0].id, 'message-2');
  assert.equal(merged.at(-1)?.body, '页面已经加载的完整正文');
});

test('清除明显引用历史并为超长邮件同时保留开头和结尾', () => {
  const quoted = compactGmailAIMessageBody(`Hallo,

新的回复内容。

On Tue, someone wrote:
> 很长的旧邮件
> 不应重复发送给 AI`);
  assert.match(quoted, /新的回复内容/);
  assert.doesNotMatch(quoted, /很长的旧邮件/);

  const longBody = `开头条件：报价 500 欧元。\n${'中间内容'.repeat(2_000)}\n结尾条件：8 月底发布。`;
  const compacted = compactGmailAIMessageBody(longBody, 1_200);
  assert.ok(compacted.length <= 1_200);
  assert.match(compacted, /报价 500 欧元/);
  assert.match(compacted, /8 月底发布/);
});

test('10 封分析上下文不超过 3 万字符', () => {
  const messages = Array.from({ length: 10 }, (_, index) =>
    message(index, { body: `第 ${index} 封\n${'内容'.repeat(5_000)}` }));
  const conversation = buildCompactGmailAIConversation(messages);

  assert.equal(conversation.messageCount, 10);
  assert.ok(conversation.outputCharacters <= 30_000);
  assert.ok(conversation.inputCharacters > conversation.outputCharacters);
});

test('草稿最多选择 6 封，保留最近来信、我方邮件和商务条件', () => {
  const messages = Array.from({ length: 10 }, (_, index) => message(index));
  messages[2] = message(2, { body: '我们的报价是 900 EUR，并希望 8 月发布。' });
  const selected = selectRelevantGmailAIDraftMessages(messages, 'me@example.com');

  assert.ok(selected.length <= 6);
  assert.ok(selected.some((item) => item.id === 'message-2'));
  assert.ok(selected.some((item) => item.from?.includes('creator@example.com')));
  assert.ok(selected.some((item) => item.from?.includes('me@example.com')));
  assert.equal(selected.at(-1)?.id, 'message-9');
});

test('历史与分析缓存支持 5 分钟复用、请求去重、过期和强制刷新', async () => {
  clearGmailAIReplyCaches();
  const originalDateNow = Date.now;
  let now = 1_000_000;
  let historyLoads = 0;
  let analysisLoads = 0;
  Date.now = () => now;

  try {
    const loadHistory = async () => {
      historyLoads += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [message(historyLoads)];
    };
    const [first, pendingReuse] = await Promise.all([
      getOrLoadGmailAIHistory('history-key', loadHistory),
      getOrLoadGmailAIHistory('history-key', loadHistory),
    ]);
    assert.equal(historyLoads, 1);
    assert.equal(first.cacheHit, false);
    assert.equal(pendingReuse.cacheHit, true);

    await getOrLoadGmailAIHistory('history-key', loadHistory);
    assert.equal(historyLoads, 1);
    now += GMAIL_AI_CACHE_MS + 1;
    await getOrLoadGmailAIHistory('history-key', loadHistory);
    assert.equal(historyLoads, 2);
    await getOrLoadGmailAIHistory('history-key', loadHistory, true);
    assert.equal(historyLoads, 3);

    const loadAnalysis = async () => {
      analysisLoads += 1;
      return { stage: `stage-${analysisLoads}` };
    };
    const analysisKey = buildGmailAIAnalysisCacheKey('history-key', {
      modelProvider: 'custom',
      customModelName: 'model-a',
      analysisPrompt: 'prompt-a',
    });
    await getOrLoadGmailAIAnalysis(analysisKey, loadAnalysis);
    await getOrLoadGmailAIAnalysis(analysisKey, loadAnalysis);
    assert.equal(analysisLoads, 1);
    await getOrLoadGmailAIAnalysis(analysisKey, loadAnalysis, true);
    assert.equal(analysisLoads, 2);
  } finally {
    Date.now = originalDateNow;
    clearGmailAIReplyCaches();
  }
});
