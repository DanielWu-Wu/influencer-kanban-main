import assert from 'node:assert/strict';
import test from 'node:test';
import { selectLatestGmailTranslationCandidate } from '../src/lib/gmail-translation-candidates';

function message(overrides: Partial<Parameters<typeof selectLatestGmailTranslationCandidate>[0][number]> = {}) {
  return {
    id: 'message-1',
    threadId: 'thread-1',
    labelIds: ['INBOX', 'UNREAD'],
    from: 'creator@example.com',
    date: '2026-08-18T10:00:00.000Z',
    automated: false,
    deliveryFailure: false,
    subject: '合作',
    body: '你好',
    snippet: '你好',
    ...overrides,
  };
}

test('只选择主要收件箱规则下最新的未读外部来信', () => {
  const result = selectLatestGmailTranslationCandidate([
    message({ id: 'older', date: '2026-08-18T09:00:00.000Z' }),
    message({ id: 'newer', date: '2026-08-18T10:00:00.000Z' }),
  ]);
  assert.equal(result?.id, 'newer');
});

test('广告、自动回复、退信、忽略邮箱和已读邮件会被排除', () => {
  assert.equal(selectLatestGmailTranslationCandidate([message({ from: 'notification@mailsuite.com' })]), undefined);
  assert.equal(selectLatestGmailTranslationCandidate([message({ automated: true })]), undefined);
  assert.equal(selectLatestGmailTranslationCandidate([message({ deliveryFailure: true })]), undefined);
  assert.equal(selectLatestGmailTranslationCandidate([message({ labelIds: ['INBOX'] })]), undefined);
});

test('最新外部来信之后已有我方回复时不会预翻译', () => {
  assert.equal(selectLatestGmailTranslationCandidate([
    message({ id: 'incoming', date: '2026-08-18T10:00:00.000Z' }),
    message({
      id: 'sent',
      date: '2026-08-18T10:05:00.000Z',
      labelIds: ['SENT'],
      from: 'me@example.com',
    }),
  ]), undefined);
});
