import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMAIL_GENERATION_TASK_RETENTION_MS,
  EMAIL_GENERATION_PROGRESS,
  MAIL_AI_TASK_CONTEXT_VERSION,
  advanceEmailGenerationProgress,
  buildEmailGenerationTaskScopeKey,
  buildGmailEmailGenerationTaskKey,
  buildGmailEmailTranslationTaskKey,
  buildMailEmailGenerationTaskKey,
  buildOutreachEmailGenerationTaskKey,
  buildOutreachEmailTranslationTaskKey,
  isEmailGenerationTaskRestorableForContext,
  markInterruptedEmailGenerationTasks,
  normalizeEmailGenerationConcurrency,
  normalizeEmailGenerationProgress,
  pruneExpiredEmailGenerationTasks,
  readEmailGenerationTaskSnapshot,
  replaceEmailGenerationTaskForKey,
  resolveEmailGenerationTaskProgress,
  serializeEmailGenerationTasks,
  selectStartableEmailTaskIds,
  updateEmailGenerationTaskAvatar,
  updateEmailGenerationTaskDraftSavedAt,
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
    provider: 'gmail',
    mailAccountId: 'gmail:owner@example.com',
    mailAddress: 'owner@example.com',
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

test('邮件生成百分比始终限制在 0 到 100', () => {
  assert.equal(normalizeEmailGenerationProgress(-10), 0);
  assert.equal(normalizeEmailGenerationProgress(35.4), 35);
  assert.equal(normalizeEmailGenerationProgress(160), 100);
  assert.equal(normalizeEmailGenerationProgress(Number.NaN), 0);
});

test('邮件生成业务阶段使用固定百分比', () => {
  assert.deepEqual(EMAIL_GENERATION_PROGRESS, {
    queued: 0,
    preparing: 10,
    readingContext: 15,
    generatingBody: 35,
    organizingResult: 70,
    translatingOrAnalyzing: 85,
    completed: 100,
  });
});

test('邮件生成进度只能前进，不能被较早阶段倒退', () => {
  assert.equal(advanceEmailGenerationProgress(35, 15), 35);
  assert.equal(advanceEmailGenerationProgress(35, 70), 70);
  assert.equal(advanceEmailGenerationProgress(undefined, 10), 10);
});

test('只有成功任务显示 100%，其他状态保留自己的阶段进度', () => {
  assert.equal(resolveEmailGenerationTaskProgress({ status: 'completed', progress: 85 }), 100);
  assert.equal(resolveEmailGenerationTaskProgress({ status: 'failed', progress: 35 }), 35);
  assert.equal(resolveEmailGenerationTaskProgress({ status: 'interrupted', progress: 70 }), 70);
  assert.equal(resolveEmailGenerationTaskProgress({ status: 'queued', progress: 85 }), 0);
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

test('邮件生成记录只恢复到同一邮箱、回复方式和回复依据', () => {
  const now = EMAIL_GENERATION_TASK_RETENTION_MS + 20_000;
  const key = buildMailEmailGenerationTaskKey({
    kind: 'gmail_ai_reply',
    mailAccountId: 'gmail:owner@example.com',
    threadId: 'thread-1',
    messageId: 'message-1',
  });
  const completed = {
    ...task('restore', 'completed', now - 1_000),
    key,
    completedAt: now - 1_000,
    navigation: {
      view: 'gmail' as const,
      threadId: 'thread-1',
      messageId: 'message-1',
      composerMode: 'ai' as const,
    },
  };
  const context = {
    key,
    kind: 'gmail_ai_reply' as const,
    provider: 'gmail' as const,
    mailAccountId: 'gmail:owner@example.com',
  };

  assert.equal(isEmailGenerationTaskRestorableForContext(completed, context, now), true);
  assert.equal(isEmailGenerationTaskRestorableForContext(completed, { ...context, mailAccountId: 'gmail:other@example.com' }, now), false);
  assert.equal(isEmailGenerationTaskRestorableForContext(completed, { ...context, kind: 'gmail_template_reply' }, now), false);
  assert.equal(isEmailGenerationTaskRestorableForContext(completed, { ...context, key: `${key}:new-message` }, now), false);
});

test('过期邮件记录不能自动恢复，运行中记录仍可继续显示', () => {
  const now = EMAIL_GENERATION_TASK_RETENTION_MS + 20_000;
  const key = 'gmail_ai_reply:thread-v2:thread-1:message-1';
  const context = {
    key,
    kind: 'gmail_ai_reply' as const,
    provider: 'gmail' as const,
    mailAccountId: 'gmail:owner@example.com',
  };
  const expired = { ...task('expired-restore', 'completed', 1), key, completedAt: 1 };
  const running = { ...task('running-restore', 'running', 1), key };

  assert.equal(isEmailGenerationTaskRestorableForContext(expired, context, now), false);
  assert.equal(isEmailGenerationTaskRestorableForContext(running, context, now), true);
});

test('同一封邮件重新生成时只保留最新任务', () => {
  const previous = { ...task('previous', 'completed', 1), key: 'same-reply' };
  const unrelated = { ...task('unrelated', 'completed', 2), key: 'another-reply' };
  const latest = { ...task('latest', 'queued', 3), key: 'same-reply' };

  assert.deepEqual(
    replaceEmailGenerationTaskForKey([previous, unrelated], latest).map((item) => item.id),
    ['unrelated', 'latest'],
  );
});

test('任务头像只更新同一任务键，并保留其他任务', () => {
  const target = { ...task('target', 'completed', 1), key: 'same-reply' };
  const unrelated = { ...task('unrelated', 'completed', 2), key: 'another-reply' };
  const updated = updateEmailGenerationTaskAvatar(
    [target, unrelated],
    'same-reply',
    ' https://yt3.ggpht.com/avatar.jpg ',
  );

  assert.equal(updated[0].avatarUrl, 'https://yt3.ggpht.com/avatar.jpg');
  assert.equal(updated[1].avatarUrl, undefined);
  assert.strictEqual(
    updateEmailGenerationTaskAvatar(updated, 'same-reply', ' '),
    updated,
  );
});

test('云端快照只保留可恢复字段，并能恢复已完成结果', () => {
  const original = {
    ...task('completed', 'completed', 1),
    completedAt: 2,
    progress: 100,
    result: { suggestion: { suggestedReply: 'Hello' } },
    avatarUrl: 'https://yt3.ggpht.com/avatar.jpg',
    rollbackResult: { replyContent: '之前内容' },
    retryInput: { userIdeas: '礼貌确认发布时间', targetLang: 'en' },
  };
  const snapshot = serializeEmailGenerationTasks([original]);
  assert.equal(snapshot.version, 4);
  const [restored] = readEmailGenerationTaskSnapshot(snapshot);
  assert.equal(restored.id, original.id);
  assert.equal(restored.status, 'completed');
  assert.deepEqual(restored.result, original.result);
  assert.deepEqual(restored.rollbackResult, original.rollbackResult);
  assert.deepEqual(restored.retryInput, original.retryInput);
  assert.equal(restored.avatarUrl, original.avatarUrl);
  assert.equal(restored.progress, 100);
});

test('草稿保存状态只更新当前系统账号的指定生成任务，并可在正文修改后清除', () => {
  const completed = { ...task('saved-draft', 'completed', 1), completedAt: 2 };
  const otherAccount = {
    ...task('other-account', 'completed', 1),
    accountUserId: 'account-b',
    completedAt: 2,
  };
  const sameIdOtherMailbox = {
    ...completed,
    provider: 'tencent_exmail' as const,
    mailAccountId: 'tencent_exmail:owner@example.com',
    mailAddress: 'owner@example.com',
  };
  const running = task('running-draft', 'running', 1);
  const savedAt = 123_456;
  const updated = updateEmailGenerationTaskDraftSavedAt(
    [completed, sameIdOtherMailbox, otherAccount, running],
    completed.id,
    'account-a',
    completed.mailAccountId,
    savedAt,
  );

  assert.equal(updated[0].draftSavedAt, savedAt);
  assert.equal(updated[1].draftSavedAt, undefined);
  assert.equal(updated[2].draftSavedAt, undefined);
  assert.equal(updated[3].draftSavedAt, undefined);

  const tencentUpdated = updateEmailGenerationTaskDraftSavedAt(
    updated,
    sameIdOtherMailbox.id,
    'account-a',
    sameIdOtherMailbox.mailAccountId,
    savedAt + 1,
  );
  assert.equal(tencentUpdated[0].draftSavedAt, savedAt);
  assert.equal(tencentUpdated[1].draftSavedAt, savedAt + 1);

  const [restored] = readEmailGenerationTaskSnapshot(serializeEmailGenerationTasks([updated[0]]));
  assert.equal(restored.draftSavedAt, savedAt);

  const cleared = updateEmailGenerationTaskDraftSavedAt(
    updated,
    completed.id,
    'account-a',
    completed.mailAccountId,
    null,
  );
  assert.equal(cleared[0].draftSavedAt, undefined);
  assert.strictEqual(
    updateEmailGenerationTaskDraftSavedAt(
      cleared,
      otherAccount.id,
      'account-a',
      otherAccount.mailAccountId,
      savedAt,
    ),
    cleared,
  );
  assert.strictEqual(
    updateEmailGenerationTaskDraftSavedAt(
      cleared,
      running.id,
      'account-a',
      running.mailAccountId,
      savedAt,
    ),
    cleared,
  );
});

test('旧版云端任务没有百分比时仍可安全恢复', () => {
  const oldTask = task('legacy', 'running', 1);
  const [restored] = readEmailGenerationTaskSnapshot({
    version: 2,
    tasks: [oldTask],
  });

  assert.equal(restored.progress, undefined);
  assert.equal(resolveEmailGenerationTaskProgress(restored), 0);
});

test('重新打开页面会把排队中和运行中的任务标记为中断，不会自动重跑', () => {
  const recovered = markInterruptedEmailGenerationTasks([
    task('queued', 'queued', 1),
    { ...task('running', 'running', 2), progress: 35 },
    task('completed', 'completed', 3),
  ], 100);
  assert.deepEqual(recovered.map((item) => item.status), ['interrupted', 'interrupted', 'completed']);
  assert.equal(recovered[0].stage, '页面已关闭或会话已中断，可重试');
  assert.equal(recovered[1].completedAt, 100);
  assert.equal(recovered[1].progress, 35);
});

test('并发任务分别保留自己的百分比，不会互相覆盖', () => {
  const gmail = { ...task('gmail-progress', 'running', 1), progress: 35 };
  const tencent = {
    ...task('tencent-progress', 'running', 2),
    provider: 'tencent_exmail' as const,
    mailAccountId: 'tencent_exmail:owner@example.com',
    progress: 85,
  };

  assert.deepEqual(
    [gmail, tencent].map(resolveEmailGenerationTaskProgress),
    [35, 85],
  );
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
  assert.match(aiReply, new RegExp(MAIL_AI_TASK_CONTEXT_VERSION));
  assert.equal(buildOutreachEmailGenerationTaskKey('prospect-1'), 'outreach_email:prospect-1');
  assert.notEqual(
    buildGmailEmailTranslationTaskKey({ composerMode: 'ai', threadId: 'thread-1', messageId: 'message-1' }),
    aiReply,
  );
  assert.notEqual(
    buildGmailEmailTranslationTaskKey({ composerMode: 'template', threadId: 'thread-1', messageId: 'message-1' }),
    templateReply,
  );
  assert.equal(
    buildOutreachEmailTranslationTaskKey('prospect-1'),
    'email_translation:outreach:prospect-1',
  );
});

test('相同邮件编号在 Gmail 和腾讯邮箱中不会互相替换', () => {
  const gmail = { ...task('gmail', 'completed', 1), key: 'same', mailAccountId: 'gmail:owner@example.com' };
  const tencent = {
    ...task('tencent', 'queued', 2),
    key: 'same',
    kind: 'tencent_ai_reply' as const,
    provider: 'tencent_exmail' as const,
    mailAccountId: 'tencent_exmail:owner@example.com',
    mailAddress: 'owner@example.com',
  };
  assert.deepEqual(
    replaceEmailGenerationTaskForKey([gmail], tencent).map((item) => item.id),
    ['gmail', 'tencent'],
  );
  assert.notEqual(
    buildMailEmailGenerationTaskKey({
      kind: 'gmail_ai_reply',
      mailAccountId: gmail.mailAccountId,
      threadId: 'thread-1',
      messageId: 'message-1',
    }),
    buildMailEmailGenerationTaskKey({
      kind: 'tencent_ai_reply',
      mailAccountId: tencent.mailAccountId,
      threadId: 'thread-1',
      messageId: 'message-1',
    }),
  );
});

test('翻译任务可以保存并恢复结果', () => {
  const original: EmailGenerationTask = {
    ...task('translation', 'completed', 1),
    key: 'email_translation:ai:thread-1:message-1',
    kind: 'email_translation',
    description: '根据中文更新外文',
    stage: '外文邮件已更新',
    retryInput: {
      operation: 'translate_chinese_to_foreign',
      source: 'gmail_ai_reply',
      chineseBody: '请确认发布时间。',
      targetLang: 'es',
      targetLangName: '西班牙语',
    },
    result: {
      source: 'gmail_ai_reply',
      chineseBody: '请确认发布时间。',
      targetLang: 'es',
      targetLangName: '西班牙语',
      foreignBody: 'Confirma la fecha de publicación, por favor.',
    },
  };
  const [restored] = readEmailGenerationTaskSnapshot(serializeEmailGenerationTasks([original]));
  assert.equal(restored.kind, 'email_translation');
  assert.deepEqual(restored.result, original.result);
  assert.deepEqual(restored.retryInput, original.retryInput);
});

test('翻译任务复用统一并发队列和中断恢复规则', () => {
  const translationTask: EmailGenerationTask = {
    ...task('translation-queued', 'queued', 2),
    key: 'email_translation:ai:thread-1:message-1',
    kind: 'email_translation',
    description: '根据中文更新外文',
    retryInput: {
      operation: 'translate_chinese_to_foreign',
      source: 'gmail_ai_reply',
      chineseBody: '请确认发布时间。',
      targetLang: 'es',
      targetLangName: '西班牙语',
    },
  };
  const running = task('running', 'running', 1);

  assert.deepEqual(selectStartableEmailTaskIds([running, translationTask], 2), ['translation-queued']);
  const interrupted = markInterruptedEmailGenerationTasks([translationTask], 100)[0];
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.stage, '页面已关闭或会话已中断，可重试');
  assert.deepEqual(interrupted.retryInput, translationTask.retryInput);
});
