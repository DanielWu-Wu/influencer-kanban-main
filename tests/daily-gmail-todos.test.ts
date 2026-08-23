import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_GMAIL_LOOKBACK_HOURS,
  buildLegacyCompatibleGmailTaskCache,
  findUniqueLegacyGmailTaskMatch,
  getDailyGmailTaskKey,
  isCompletedToday,
  isWithinDailyGmailWindow,
  normalizeDailyMailTaskCache,
  resolveIncomingGmailCompletedAt,
  resolveLatestGmailAnswerAt,
  resolveLatestMatchingMailboxAnswerAt,
} from '../src/lib/daily-gmail-todos';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const HOUR_MS = 60 * 60 * 1000;

test('Gmail 待办保留近 72 小时内的来信', () => {
  assert.equal(DAILY_GMAIL_LOOKBACK_HOURS, 72);
  assert.equal(isWithinDailyGmailWindow(new Date(NOW - 71 * HOUR_MS).toISOString(), NOW), true);
  assert.equal(isWithinDailyGmailWindow(new Date(NOW - 72 * HOUR_MS).toISOString(), NOW), true);
});

test('Gmail 待办排除超过 72 小时、未来和无效日期', () => {
  assert.equal(isWithinDailyGmailWindow(new Date(NOW - 72 * HOUR_MS - 1).toISOString(), NOW), false);
  assert.equal(isWithinDailyGmailWindow(new Date(NOW + 1).toISOString(), NOW), false);
  assert.equal(isWithinDailyGmailWindow('invalid-date', NOW), false);
});

test('Gmail 待办使用线程 ID 作为稳定任务键', () => {
  assert.equal(getDailyGmailTaskKey('thread-1', 'message-1'), 'thread-1');
  assert.equal(getDailyGmailTaskKey('', 'message-1'), 'message-1');
});

test('相同线程和邮件编号在不同邮箱账号中不会串号', () => {
  const gmailKey = getDailyGmailTaskKey(
    'thread-1',
    'message-1',
    'account-1',
    'gmail',
  );
  const tencentKey = getDailyGmailTaskKey(
    'thread-1',
    'message-1',
    'account-1',
    'tencent_exmail',
    'INBOX',
    '17',
  );

  assert.equal(gmailKey, 'gmail::account-1::thread-1');
  assert.equal(tencentKey, 'tencent_exmail::account-1::INBOX::17');
  assert.notEqual(gmailKey, tencentKey);
});

test('旧版无来源任务只按精确身份迁移到唯一 Gmail', () => {
  const legacy = {
    threadId: 'legacy-thread',
    messageId: 'legacy-message',
    channelName: 'Creator A',
    subject: 'Same subject',
    summary: 'Same summary',
  };
  const gmail = { ...legacy, provider: 'gmail' as const, messageId: 'gmail-message' };
  const tencent = { ...legacy, provider: 'tencent_exmail' as const, messageId: 'tencent-message' };
  assert.equal(findUniqueLegacyGmailTaskMatch(legacy, [gmail, tencent])?.messageId, 'gmail-message');
  assert.equal(findUniqueLegacyGmailTaskMatch(legacy, [gmail, { ...gmail, messageId: 'gmail-message-2' }]), undefined);
  assert.equal(findUniqueLegacyGmailTaskMatch(legacy, [tencent]), undefined);
  assert.equal(findUniqueLegacyGmailTaskMatch(
    { ...legacy, threadId: '', messageId: 'unknown', summary: gmail.summary },
    [gmail],
  ), undefined);
});

test('旧键和账号范围键指向同一 Gmail 线程时只保留最新一条', () => {
  const older = {
    messageId: 'message-1',
    threadId: 'thread-1',
    date: '2026-08-06T09:00:00.000Z',
    summary: '旧摘要',
    completedAt: '2026-08-06T09:30:00.000Z',
  };
  const newer = {
    ...older,
    messageId: 'message-2',
    date: '2026-08-06T10:00:00.000Z',
    summary: '新摘要',
    provider: 'gmail' as const,
    mailAccountId: 'gmail:owner@example.com',
    mailAddress: 'owner@example.com',
  };
  const normalized = normalizeDailyMailTaskCache({
    'thread-1': older,
    'gmail::gmail:owner@example.com::thread-1': newer,
  });

  assert.equal(Object.keys(normalized).length, 1);
  assert.equal(normalized['gmail::gmail:owner@example.com::thread-1']?.summary, '新摘要');
  assert.equal(normalized['gmail::gmail:owner@example.com::thread-1']?.completedAt, undefined);
});

test('同一红人和主题但不同 Gmail 线程不会被合并', () => {
  const base = {
    messageId: 'message-1',
    threadId: 'thread-1',
    date: '2026-08-06T10:00:00.000Z',
    summary: '相同摘要',
    provider: 'gmail' as const,
    mailAccountId: 'gmail:owner@example.com',
    mailAddress: 'owner@example.com',
  };
  const normalized = normalizeDailyMailTaskCache({
    first: base,
    second: { ...base, messageId: 'message-2', threadId: 'thread-2' },
  });

  assert.equal(Object.keys(normalized).length, 2);
});

test('不同邮箱账号以及腾讯不同 UID 的待办保持隔离', () => {
  const gmail = {
    messageId: 'same-message',
    threadId: 'same-thread',
    date: '2026-08-06T10:00:00.000Z',
    provider: 'gmail' as const,
    mailAccountId: 'gmail:first@example.com',
    mailAddress: 'first@example.com',
  };
  const tencent = {
    messageId: 'same-message',
    threadId: 'same-thread',
    date: '2026-08-06T10:00:00.000Z',
    provider: 'tencent_exmail' as const,
    mailAccountId: 'tencent_exmail:first@example.com',
    mailAddress: 'first@example.com',
    folderRef: 'INBOX',
    providerMessageRef: '17',
  };
  const normalized = normalizeDailyMailTaskCache({
    gmail,
    tencent,
    tencentOtherUid: { ...tencent, providerMessageRef: '18' },
  });

  assert.equal(Object.keys(normalized).length, 3);
});

test('旧版兼容缓存只保留逐线程去重后的 Gmail 任务', () => {
  const gmail = {
    messageId: 'message-2',
    threadId: 'thread-1',
    date: '2026-08-06T10:00:00.000Z',
    provider: 'gmail' as const,
    mailAccountId: 'gmail:owner@example.com',
    mailAddress: 'owner@example.com',
    summary: '最新 Gmail 摘要',
  };
  const legacyCompatible = buildLegacyCompatibleGmailTaskCache({
    legacy: { ...gmail, provider: undefined, mailAccountId: undefined, date: '2026-08-06T09:00:00.000Z' },
    scoped: gmail,
    tencent: {
      ...gmail,
      provider: 'tencent_exmail' as const,
      mailAccountId: 'tencent_exmail:owner@example.com',
      folderRef: 'INBOX',
      providerMessageRef: '17',
    },
  });

  assert.deepEqual(Object.keys(legacyCompatible), ['thread-1']);
  assert.equal(legacyCompatible['thread-1']?.provider, 'gmail');
  assert.equal(legacyCompatible['thread-1']?.summary, '最新 Gmail 摘要');
});

test('同一邮件不改变完成状态，新外部来信晚于完成时间时重新进入待完成', () => {
  const completedAt = '2026-08-06T10:00:00.000Z';
  assert.equal(resolveIncomingGmailCompletedAt(
    { messageId: 'message-1', completedAt },
    { messageId: 'message-1', date: '2026-08-06T11:00:00.000Z' },
  ), completedAt);
  assert.equal(resolveIncomingGmailCompletedAt(
    { messageId: 'message-1', completedAt },
    { messageId: 'message-2', date: '2026-08-06T11:00:00.000Z' },
  ), undefined);
  assert.equal(resolveIncomingGmailCompletedAt(
    { messageId: 'message-1' },
    { messageId: 'message-2', date: '2026-08-07T11:00:00.000Z' },
  ), undefined);
});

test('最后一封来信之后已经发送回复时自动完成', () => {
  const answeredAt = '2026-08-06T11:00:00.000Z';
  assert.equal(resolveIncomingGmailCompletedAt(
    undefined,
    {
      messageId: 'message-1',
      date: '2026-08-06T10:00:00.000Z',
      answeredAt,
    },
  ), answeredAt);
});

test('线程回复识别忽略旧发件和 Gmail 草稿，只采用最新已发送回复', () => {
  assert.equal(resolveLatestGmailAnswerAt([
    { date: '2026-08-06T09:00:00.000Z', labelIds: ['SENT'] },
    { date: '2026-08-06T11:00:00.000Z', labelIds: ['DRAFT'] },
    { date: '2026-08-06T12:00:00.000Z', labelIds: ['SENT'] },
    { date: '2026-08-06T13:00:00.000Z', labelIds: ['SENT'] },
  ], '2026-08-06T10:00:00.000Z'), '2026-08-06T13:00:00.000Z');
});

test('旧回复早于最新来信时保持待完成，自动完成后出现新来信时重新待办', () => {
  assert.equal(resolveIncomingGmailCompletedAt(
    undefined,
    {
      messageId: 'message-2',
      date: '2026-08-06T12:00:00.000Z',
      answeredAt: '2026-08-06T11:00:00.000Z',
    },
  ), undefined);

  assert.equal(resolveIncomingGmailCompletedAt(
    {
      messageId: 'message-1',
      completedAt: '2026-08-06T11:00:00.000Z',
      answeredAt: '2026-08-06T11:00:00.000Z',
    },
    {
      messageId: 'message-2',
      date: '2026-08-06T12:00:00.000Z',
    },
  ), undefined);
});

test('腾讯待办只把同一会话或明确引用原邮件的发件识别为已回复', () => {
  const incoming = {
    senderEmail: 'creator@example.com',
    date: '2026-08-06T10:00:00.000Z',
    messageId: '<incoming@example.com>',
  };
  const unrelated = resolveLatestMatchingMailboxAnswerAt([
    {
      recipients: ['creator@example.com'],
      date: '2026-08-06T11:00:00.000Z',
    },
  ], incoming);
  const sameSubjectWithoutHeaders = resolveLatestMatchingMailboxAnswerAt([
    {
      recipients: ['creator@example.com'],
      date: '2026-08-06T12:00:00.000Z',
    },
  ], incoming);
  const explicitReply = resolveLatestMatchingMailboxAnswerAt([
    {
      recipients: ['creator@example.com'],
      date: '2026-08-06T13:00:00.000Z',
      inReplyTo: '<incoming@example.com>',
    },
  ], incoming);
  const referencedReply = resolveLatestMatchingMailboxAnswerAt([
    {
      recipients: ['creator@example.com'],
      date: '2026-08-06T14:00:00.000Z',
      references: '<root@example.com> <incoming@example.com>',
    },
  ], incoming);

  assert.equal(unrelated, undefined);
  assert.equal(sameSubjectWithoutHeaders, undefined);
  assert.equal(explicitReply, '2026-08-06T13:00:00.000Z');
  assert.equal(referencedReply, '2026-08-06T14:00:00.000Z');
});

test('完成时间按本地日期区分今日已完成和历史已完成', () => {
  const localNow = new Date(2026, 7, 6, 12, 0, 0).getTime();
  assert.equal(isCompletedToday(new Date(2026, 7, 6, 0, 1, 0).toISOString(), localNow), true);
  assert.equal(isCompletedToday(new Date(2026, 7, 5, 23, 59, 0).toISOString(), localNow), false);
  assert.equal(isCompletedToday(undefined, localNow), false);
});
