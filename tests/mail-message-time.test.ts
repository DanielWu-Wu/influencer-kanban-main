import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mailTimestampToIso,
  resolveGmailMessageTimestamp,
  resolveImapMessageTimestamp,
} from '../src/lib/mail-message-time';

const wrongSenderDate = 'Tue, 25 Aug 2026 12:33:39 -0700';
const actualReceivedDate = 'Tue, 25 Aug 2026 02:35:10 -0700 (PDT)';

test('Gmail 收件邮件优先采用接收服务器时间', () => {
  const timestamp = resolveGmailMessageTimestamp({
    headers: [
      { name: 'Date', value: wrongSenderDate },
      { name: 'Received', value: `by mx.google.com with SMTP id example; ${actualReceivedDate}` },
    ],
    internalDate: '1787686419000',
    labelIds: ['INBOX'],
  });

  assert.equal(mailTimestampToIso(timestamp), '2026-08-25T09:35:10.000Z');
});

test('Gmail 已发送邮件优先采用邮箱内部时间', () => {
  const timestamp = resolveGmailMessageTimestamp({
    headers: [
      { name: 'Date', value: wrongSenderDate },
      { name: 'Received', value: `by mx.google.com; ${actualReceivedDate}` },
    ],
    internalDate: Date.parse('2026-08-25T09:29:00.000Z'),
    labelIds: ['SENT'],
  });

  assert.equal(mailTimestampToIso(timestamp), '2026-08-25T09:29:00.000Z');
});

test('Gmail 缺少 Received 时回退到邮箱内部时间', () => {
  const timestamp = resolveGmailMessageTimestamp({
    headers: [{ name: 'Date', value: wrongSenderDate }],
    internalDate: Date.parse('2026-08-25T09:35:00.000Z'),
    labelIds: ['INBOX'],
  });

  assert.equal(mailTimestampToIso(timestamp), '2026-08-25T09:35:00.000Z');
});

test('腾讯企业邮箱优先采用 IMAP 服务器内部时间', () => {
  const timestamp = resolveImapMessageTimestamp({
    internalDate: new Date('2026-08-25T09:35:10.000Z'),
    parsedDate: wrongSenderDate,
    envelopeDate: wrongSenderDate,
  });

  assert.equal(mailTimestampToIso(timestamp), '2026-08-25T09:35:10.000Z');
});

test('腾讯企业邮箱缺少内部时间时回退到邮件日期', () => {
  const timestamp = resolveImapMessageTimestamp({
    parsedDate: actualReceivedDate,
    envelopeDate: wrongSenderDate,
  });

  assert.equal(mailTimestampToIso(timestamp), '2026-08-25T09:35:10.000Z');
});

test('修复后的 Gmail 时间能按真实收发顺序排列', () => {
  const messages = [
    { id: 'sent-1729', timestamp: Date.parse('2026-08-25T09:29:00.000Z') },
    {
      id: 'received-1735',
      timestamp: resolveGmailMessageTimestamp({
        headers: [
          { name: 'Date', value: wrongSenderDate },
          { name: 'Received', value: `by mx.google.com; ${actualReceivedDate}` },
        ],
        internalDate: '1787686419000',
        labelIds: ['INBOX'],
      }),
    },
    { id: 'sent-1752', timestamp: Date.parse('2026-08-25T09:52:00.000Z') },
    { id: 'received-1804', timestamp: Date.parse('2026-08-25T10:04:00.000Z') },
  ].sort((left, right) => left.timestamp - right.timestamp);

  assert.deepEqual(messages.map((message) => message.id), [
    'sent-1729',
    'received-1735',
    'sent-1752',
    'received-1804',
  ]);
});
