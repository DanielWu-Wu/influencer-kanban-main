import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMAIL_GENERATION_TASK_RETENTION_MS,
  buildEmailGenerationTaskScopeKey,
  buildGmailEmailGenerationTaskKey,
  buildOutreachEmailGenerationTaskKey,
  markInterruptedEmailGenerationTasks,
  normalizeEmailGenerationConcurrency,
  pruneExpiredEmailGenerationTasks,
  readEmailGenerationTaskSnapshot,
  serializeEmailGenerationTasks,
  selectStartableEmailTaskIds,
  type EmailGenerationTask,
} from '../src/lib/email-generation-tasks';

function task(
  id: string,
  status: EmailGenerationTask['status'],
  createdAt: number,
): EmailGenerationTask {
  return {
    id,
    key: id,
    kind: 'gmail_ai_reply',
    status,
    accountUserId: 'account-a',
    gmailEmail: 'owner@example.com',
    title: id,
    description: 'AI 辅助回复',
    stage: '等待生成',
    navigation: {
      view: 'gmail',
      threadId: `thread-${id}`,
      composerMode: 'ai',
    },
    createdAt,
  };
}

test('邮件生成并发数始终限制在 2 到 10', () => {
  assert.equal(normalizeEmailGenerationConcurrency(1), 2);
  assert.equal(normalizeEmailGenerationConcurrency(6.4), 6);
  assert.equal(normalizeEmailGenerationConcurrency(99), 10);
  assert.equal(normalizeEmailGenerationConcurrency(Number.NaN), 2);
});

test('邮件生成任务按创建顺序进入空闲并发位', () => {
  const tasks = [
    task('running', 'running', 1),
    task('third', 'queued', 30),
    task('first', 'queued', 10),
    task('second', 'queued', 20),
  ];

  assert.deepEqual(selectStartableEmailTaskIds(tasks, 2), ['first']);
  assert.deepEqual(selectStartableEmailTaskIds(tasks, 4), ['first', 'second', 'third']);
});

test('降低并发数不会选择新任务，也不会取消正在运行的任务', () => {
  const tasks = [
    task('running-a', 'running', 1),
    task('running-b', 'running', 2),
    task('queued', 'queued', 3),
  ];

  assert.deepEqual(selectStartableEmailTaskIds(tasks, 2), []);
  assert.equal(tasks.filter((item) => item.status === 'running').length, 2);
});

test('已结束任务保留 24 小时，运行中任务不会被过期清理', () => {
  const now = EMAIL_GENERATION_TASK_RETENTION_MS + 10_000;
  const expired = { ...task('expired', 'completed', 1), completedAt: 1 };
  const recent = { ...task('recent', 'failed', now - 1_000), completedAt: now - 1_000 };
  const running = task('running', 'running', 1);

  assert.deepEqual(
    pruneExpiredEmailGenerationTasks([expired, recent, running], now).map((item) => item.id),
    ['recent', 'running'],
  );
});

test('云端快照只保留可恢复字段，并能恢复已完成结果', () => {
  const original = {
    ...task('completed', 'completed', 1),
    completedAt: 2,
    result: { suggestion: { suggestedReply: 'Hello' } },
    rollbackResult: { replyContent: '之前内容' },
    retryInput: { userIdeas: '礼貌确认发布时间', targetLang: 'en' },
  };
  const snapshot = serializeEmailGenerationTasks([original]);
  assert.equal(snapshot.version, 1);
  const [restored] = readEmailGenerationTaskSnapshot(snapshot);
  assert.equal(restored.id, original.id);
  assert.equal(restored.status, 'completed');
  assert.deepEqual(restored.result, original.result);
  assert.deepEqual(restored.rollbackResult, original.rollbackResult);
  assert.deepEqual(restored.retryInput, original.retryInput);
});

test('重新打开页面会把排队中和运行中的任务标记为中断，不会自动重跑', () => {
  const recovered = markInterruptedEmailGenerationTasks([
    task('queued', 'queued', 1),
    task('running', 'running', 2),
    task('completed', 'completed', 3),
  ], 100);
  assert.deepEqual(recovered.map((item) => item.status), ['interrupted', 'interrupted', 'completed']);
  assert.equal(recovered[0].stage, '页面已关闭或会话已中断，可重试');
  assert.equal(recovered[1].completedAt, 100);
});

test('任务范围按系统账号和 Gmail 邮箱隔离', () => {
  const accountA = buildEmailGenerationTaskScopeKey('account-a', 'Owner@Example.com');
  const accountB = buildEmailGenerationTaskScopeKey('account-b', 'owner@example.com');
  const gmailB = buildEmailGenerationTaskScopeKey('account-a', 'other@example.com');

  assert.equal(accountA, 'account-a:owner@example.com');
  assert.notEqual(accountA, accountB);
  assert.notEqual(accountA, gmailB);
});

test('不同邮件线程、回复方式和开发信对象使用不同任务键', () => {
  const aiReply = buildGmailEmailGenerationTaskKey({
    kind: 'gmail_ai_reply',
    threadId: 'thread-1',
    messageId: 'message-1',
  });
  const templateReply = buildGmailEmailGenerationTaskKey({
    kind: 'gmail_template_reply',
    threadId: 'thread-1',
    messageId: 'message-1',
  });
  const anotherMessage = buildGmailEmailGenerationTaskKey({
    kind: 'gmail_ai_reply',
    threadId: 'thread-1',
    messageId: 'message-2',
  });

  assert.notEqual(aiReply, templateReply);
  assert.notEqual(aiReply, anotherMessage);
  assert.equal(buildOutreachEmailGenerationTaskKey('prospect-1'), 'outreach_email:prospect-1');
});
