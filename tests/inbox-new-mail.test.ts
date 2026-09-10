import assert from 'node:assert/strict';
import test from 'node:test';
import { InboxNewMailDetector, latestUnansweredIncoming, resolveNewInboxMail, hasAutomaticMailHeaders, type InboxMailSnapshot } from '../src/lib/inbox-new-mail';
import type { GmailMessage, GmailThread } from '../src/lib/types';

function message(id: string, time: number, overrides: Partial<GmailMessage> = {}): GmailMessage {
  return { id, threadId: 'thread', from: 'Creator <creator@example.com>', to: 'me@example.com',
    subject: 'Hello', snippet: '', body: 'Hello there', date: new Date(time).toISOString(),
    isRead: false, labels: ['INBOX', 'UNREAD'], hasAttachments: false, ...overrides };
}
function thread(messages: GmailMessage[]): GmailThread {
  return { id: 'thread', subject: '', snippet: '', messages, participantCount: 2,
    lastMessageDate: messages.at(-1)?.date || '', hasUnread: true, labels: ['INBOX'], isStarred: false };
}
function snapshot(messages: GmailMessage[], overrides: Partial<InboxMailSnapshot> = {}): InboxMailSnapshot {
  return { accountScope: 'user-a', provider: 'gmail', mailAccountId: 'gmail:me@example.com',
    mailAddress: 'me@example.com', threads: messages.length ? [thread(messages)] : [],
    loadThread: async (value) => value, ...overrides };
}

test('新来信：首次建立基线，不批量翻译历史未读；空收件箱也能建立基线', () => {
  for (const baseline of [[], [message('old', 900)]]) {
    const detector = new InboxNewMailDetector();
    assert.equal(detector.observe(snapshot(baseline), 1000).length, 0);
    assert.deepEqual(detector.observe(snapshot([message('new', 1100)]), 1200).map((v) => v.message.id), ['new']);
  }
});
test('新来信：同线程新 messageId 触发一次，重复刷新不重复', () => {
  const detector = new InboxNewMailDetector();
  const old = message('old', 900);
  detector.observe(snapshot([old]), 1000);
  const incoming = snapshot([old, message('new', 1100)]);
  assert.equal(detector.observe(incoming, 1200).length, 1);
  assert.equal(detector.observe(incoming, 1300).length, 0);
});
test('新来信：旧信改未读、分页带来的旧信和未来异常日期不会触发', () => {
  const detector = new InboxNewMailDetector();
  detector.observe(snapshot([message('old', 900, { isRead: true })]), 1000);
  assert.equal(detector.observe(snapshot([message('old', 900)]), 1200).length, 0);
  assert.equal(detector.observe(snapshot([message('older-unseen', 500)]), 1200).length, 0);
  assert.equal(detector.observe(snapshot([message('future', 5000)]), 1200).length, 0);
});
test('新来信：系统账号、邮箱和 provider 分别建立基线', () => {
  const detector = new InboxNewMailDetector();
  detector.observe(snapshot([]), 1000);
  for (const change of [{ accountScope: 'user-b' }, { mailAccountId: 'another' }, { provider: 'tencent_exmail' as const }]) {
    assert.equal(detector.observe(snapshot([message('new', 1100)], change), 1200).length, 0);
  }
  assert.equal(detector.observe(snapshot([message('new', 1100)]), 1200).length, 1);
});
test('新来信：排除已读、我方回复、草稿、自动回复、退信', () => {
  const incoming = message('incoming', 1100);
  for (const override of [{ isRead: true }, { labels: ['SENT'] }, { labels: ['DRAFT'] },
    { from: 'me@example.com' }, { automated: true }, { subject: 'Out of office' }, { from: 'mailer-daemon@example.com' }]) {
    assert.equal(latestUnansweredIncoming(thread([message('skip', 1100, override)]), 'me@example.com'), undefined);
  }
  assert.equal(latestUnansweredIncoming(thread([incoming, message('reply', 1200, { labels: ['SENT'] })]), 'me@example.com'), undefined);
  assert.equal(latestUnansweredIncoming(thread([incoming, message('draft', 1200, { labels: ['DRAFT'] })]), 'me@example.com')?.id, 'incoming');
});
test('新来信：自动回复头识别，不把 Auto-Submitted: no 当作自动邮件', () => {
  assert.equal(hasAutomaticMailHeaders('no'), false);
  assert.equal(hasAutomaticMailHeaders('auto-replied'), true);
  assert.equal(hasAutomaticMailHeaders('', 'bulk'), true);
});
test('新来信：先匹配红人，陌生来信不读取正文；双邮箱复用完整正文', async () => {
  for (const provider of ['gmail', 'tencent_exmail'] as const) {
    let reads = 0;
    const mail = message('new', 1100);
    const source = snapshot([mail], { provider, loadThread: async () => { reads++; return thread([mail]); } });
    const entry = { thread: source.threads[0], message: mail };
    assert.equal(await resolveNewInboxMail(source, entry, new Set(), () => true), undefined);
    assert.equal(reads, 0);
    const result = await resolveNewInboxMail(source, entry, new Set(['creator@example.com']), () => true);
    assert.equal(result?.messageId, 'new');
    assert.equal(result?.provider, provider);
    assert.equal(result?.body, mail.body);
    assert.equal(mail.isRead, false);
    assert.equal(reads, 1);
  }
});
test('新来信：切换账号后旧正文请求返回，不交给翻译队列', async () => {
  let current = true;
  const mail = message('new', 1100);
  const source = snapshot([mail], { loadThread: async () => { current = false; return thread([mail]); } });
  assert.equal(await resolveNewInboxMail(source, { thread: source.threads[0], message: mail },
    new Set(['creator@example.com']), () => current), undefined);
});
test('新来信：旧详情缓存、正文为空、期间已回复时不误翻译', async () => {
  const mail = message('new', 1100);
  for (const full of [thread([message('old', 900)]), thread([{ ...mail, body: '' }]),
    thread([mail, message('reply', 1200, { from: 'me@example.com', labels: ['SENT'] })])]) {
    const source = snapshot([mail], { loadThread: async () => full });
    assert.equal(await resolveNewInboxMail(source, { thread: source.threads[0], message: mail },
      new Set(['creator@example.com']), () => true), undefined);
  }
});
