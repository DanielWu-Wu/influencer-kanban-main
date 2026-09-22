import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectReminder, getProjectReminderConversation, isUsableReminderConversation } from '../src/lib/project-reminders';
import type { ProjectConversationLocator, MailAccountBindingMap } from '../src/lib/mail-account-bindings';

const input = { projectId: 'project-1', sourceUrl: ' https://example.com/base ', title: ' 跟进视频 ', description: '频道 · 产品', dueDate: '2026-09-18', dueTime: '09:30', target: 'project' as const };
const conversation: ProjectConversationLocator = { provider: 'gmail', mailAccountId: 'account-1', threadRef: 'thread-1', messageRef: 'message-1', subject: '合作', boundAt: '2026-09-18' };

test('project reminder retains its source and target through cloud JSON serialization', () => {
  const todo = JSON.parse(JSON.stringify(createProjectReminder(input)));
  assert.equal(todo.title, '跟进视频');
  assert.equal(todo.status, 'pending');
  assert.deepEqual(todo.projectReminder, { projectId: 'project-1', sourceUrl: 'https://example.com/base', target: 'project' });
  assert.equal(todo.dueTime, '09:30');
});

test('reject invalid dates, time and missing business context', () => {
  for (const patch of [{ dueDate: '2026-02-30' }, { dueTime: '24:00' }, { dueTime: '' }, { title: ' ' }, { sourceUrl: '' }, { projectId: '' }]) {
    assert.throws(() => createProjectReminder({ ...input, ...patch }));
  }
});

test('mail reminder requires exact locator and snapshots the selected conversation', () => {
  assert.throws(() => createProjectReminder({ ...input, target: 'mail' }));
  const locator = { ...conversation };
  const todo = createProjectReminder({ ...input, target: 'mail', conversation: locator });
  locator.threadRef = 'different-thread';
  assert.equal(todo.projectReminder?.conversation?.threadRef, 'thread-1');
  assert.equal(isUsableReminderConversation({ ...conversation, threadRef: undefined }), false);
  assert.equal(isUsableReminderConversation({ ...conversation, provider: 'tencent_exmail', folderRef: 'INBOX' }), true);
  assert.equal(isUsableReminderConversation({ ...conversation, provider: 'tencent_exmail' }), false);
});

test('contact bindings and mismatched accounts cannot open another project conversation', () => {
  const binding = { projectId: 'project-1', mailAccountId: 'account-1', provider: 'gmail' as const, conversationLocator: conversation, bindingKey: 'project:project-1', contactEmail: 'user@example.com', mailAddress: 'me@example.com', createdAt: '2026-09-18', lastConfirmedAt: '2026-09-18' };
  const bindings = { 'project:project-1': binding, 'contact:user@example.com': binding } as MailAccountBindingMap;
  assert.equal(getProjectReminderConversation(bindings, 'project-1'), conversation);
  assert.equal(getProjectReminderConversation(bindings, 'project-2'), undefined);
  assert.equal(getProjectReminderConversation({ 'contact:user@example.com': binding } as MailAccountBindingMap, 'project-1'), undefined);
  assert.equal(getProjectReminderConversation({ 'project:project-1': { ...binding, mailAccountId: 'other' } } as MailAccountBindingMap, 'project-1'), undefined);
});
