import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatMailRecipients,
  getEditableMailDraft,
  isValidMailRecipient,
  parseMailRecipients,
} from '../src/lib/mail-draft-edit';
import type { GmailThread } from '../src/lib/types';

function createDraftThread(provider: 'gmail' | 'tencent_exmail'): GmailThread {
  return {
    id: `${provider}-thread`,
    subject: '草稿主题',
    snippet: '草稿正文',
    participantCount: 2,
    lastMessageDate: '2026-08-20T12:00:00.000Z',
    hasUnread: false,
    labels: ['DRAFT'],
    isStarred: false,
    provider,
    mailAccountId: `${provider}:owner@example.com`,
    messages: [{
      id: `${provider}-message`,
      threadId: `${provider}-thread`,
      from: 'owner@example.com',
      to: 'Creator <creator@example.com>, second@example.com',
      cc: 'Reviewer <reviewer@example.com>; audit@example.com',
      bcc: 'private@example.com',
      subject: '草稿主题',
      snippet: '草稿正文',
      body: '草稿正文',
      date: '2026-08-20T12:00:00.000Z',
      isRead: true,
      labels: ['DRAFT'],
      hasAttachments: true,
      provider,
      mailAccountId: `${provider}:owner@example.com`,
      folderRef: provider === 'tencent_exmail' ? 'Drafts' : undefined,
      providerMessageRef: provider === 'tencent_exmail' ? '17' : undefined,
      attachments: [{
        id: 'attachment-1',
        filename: 'brief.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        inline: false,
      }, {
        id: 'inline-1',
        filename: 'logo.png',
        mimeType: 'image/png',
        size: 512,
        contentId: 'logo-1',
        dataUrl: 'data:image/png;base64,AA==',
        inline: true,
      }],
    }],
  };
}

test('Gmail 和腾讯草稿都能转换为隔离的编辑上下文', () => {
  const gmail = getEditableMailDraft(createDraftThread('gmail'), 'gmail', 'gmail:owner@example.com');
  const tencent = getEditableMailDraft(
    createDraftThread('tencent_exmail'),
    'tencent_exmail',
    'tencent_exmail:owner@example.com',
  );

  assert.deepEqual(gmail?.to, [
    { name: 'Creator', email: 'creator@example.com' },
    { email: 'second@example.com' },
  ]);
  assert.deepEqual(gmail?.cc, [
    { name: 'Reviewer', email: 'reviewer@example.com' },
    { email: 'audit@example.com' },
  ]);
  assert.deepEqual(gmail?.bcc, [{ email: 'private@example.com' }]);
  assert.equal(gmail?.provider, 'gmail');
  assert.equal(gmail?.mailAccountId, 'gmail:owner@example.com');
  assert.equal(tencent?.provider, 'tencent_exmail');
  assert.equal(tencent?.folderRef, 'Drafts');
  assert.equal(tencent?.providerMessageRef, '17');
  assert.notEqual(gmail?.mailAccountId, tencent?.mailAccountId);
  assert.equal(tencent?.attachments[0]?.filename, 'brief.pdf');
  assert.equal(tencent?.inlineImages[0]?.contentId, 'logo-1');
});

test('收件人解析保留显示名称、顺序并支持逗号分号和换行', () => {
  const recipients = parseMailRecipients('"Creator One" <one@example.com>, two@example.com;\nThree <three@example.com>');
  assert.deepEqual(recipients, [
    { name: 'Creator One', email: 'one@example.com' },
    { email: 'two@example.com' },
    { name: 'Three', email: 'three@example.com' },
  ]);
  assert.equal(
    formatMailRecipients(recipients),
    '"Creator One" <one@example.com>, two@example.com, "Three" <three@example.com>',
  );
});

test('无效邮箱能够被识别并阻止草稿保存', () => {
  const [recipient] = parseMailRecipients('not-an-email');
  assert.equal(isValidMailRecipient(recipient), false);
  assert.equal(isValidMailRecipient({ email: 'valid@example.com' }), true);
});

test('普通邮件不能误进入草稿编辑器', () => {
  const thread = createDraftThread('gmail');
  thread.messages[0].labels = ['INBOX'];
  thread.labels = ['INBOX'];
  assert.equal(getEditableMailDraft(thread, 'gmail', 'gmail:owner@example.com'), null);
});
