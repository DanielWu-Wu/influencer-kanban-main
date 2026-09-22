import type { TodoItem } from './types';
import type { MailAccountBindingMap, ProjectConversationLocator } from './mail-account-bindings';

export function isUsableReminderConversation(value?: ProjectConversationLocator): value is ProjectConversationLocator {
  if (!value?.mailAccountId || !value.messageRef) return false;
  return value.provider === 'gmail' ? Boolean(value.threadRef)
    : value.provider === 'tencent_exmail' && Boolean(value.folderRef);
}

export function getProjectReminderConversation(bindings: MailAccountBindingMap, projectId: string) {
  // A contact-level binding can belong to another cooperation; only accept this project's confirmed thread.
  const binding = bindings[`project:${projectId}`];
  const locator = binding?.conversationLocator;
  return binding?.projectId === projectId && isUsableReminderConversation(locator)
    && binding.mailAccountId === locator.mailAccountId && binding.provider === locator.provider
    ? locator : undefined;
}

export function createProjectReminder(input: {
  projectId: string; sourceUrl: string; title: string; description: string;
  dueDate: string; dueTime: string; target: 'project' | 'mail';
  conversation?: ProjectConversationLocator;
}): Omit<TodoItem, 'id' | 'createdAt'> {
  if (!input.title.trim() || !input.projectId || !input.sourceUrl.trim()) throw new Error('请填写提醒事项并确认合作项目来源。');
  const date = new Date(`${input.dueDate}T00:00:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || Number.isNaN(date.getTime())
    || date.getFullYear() !== Number(input.dueDate.slice(0, 4))
    || date.getMonth() + 1 !== Number(input.dueDate.slice(5, 7))
    || date.getDate() !== Number(input.dueDate.slice(8, 10))
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.dueTime)) throw new Error('请选择有效的提醒日期和时间。');
  if (input.target === 'mail' && !isUsableReminderConversation(input.conversation)) throw new Error('请先在项目详情中确认绑定的邮件线程。');
  return {
    title: input.title.trim(), description: input.description, dueDate: input.dueDate, dueTime: input.dueTime,
    priority: 'medium', status: 'pending', tags: ['项目提醒'],
    projectReminder: { projectId: input.projectId, sourceUrl: input.sourceUrl.trim(), target: input.target,
      ...(input.target === 'mail' ? { conversation: { ...input.conversation! } } : {}) },
  };
}
