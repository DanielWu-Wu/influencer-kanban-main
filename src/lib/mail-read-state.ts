import type { GmailThread } from '@/lib/types';

export type MailMessageReadTarget = {
  messageId: string;
  folderRef: string;
  providerMessageRef: string;
};

export function getMailThreadRowVisualState(hasUnread: boolean, selected: boolean) {
  return {
    visuallyUnread: hasUnread,
    showSelectedIndicator: selected,
    showSelectedReadBackground: selected && !hasUnread,
  };
}

export function copyMailThreadReadState(
  targetThread: GmailThread,
  stateThread: GmailThread,
) {
  const stateMessages = new Map(stateThread.messages.map((message) => [message.id, message]));
  return {
    ...targetThread,
    hasUnread: stateThread.hasUnread,
    labels: stateThread.hasUnread
      ? Array.from(new Set([...targetThread.labels, 'UNREAD']))
      : targetThread.labels.filter((label) => label !== 'UNREAD'),
    messages: targetThread.messages.map((message) => {
      const stateMessage = stateMessages.get(message.id);
      if (!stateMessage) return message;
      return {
        ...message,
        isRead: stateMessage.isRead,
        labels: stateMessage.isRead
          ? message.labels.filter((label) => label !== 'UNREAD')
          : Array.from(new Set([...message.labels, 'UNREAD'])),
      };
    }),
  };
}

export function collectUnreadMailTargets(thread: GmailThread) {
  const targets: MailMessageReadTarget[] = [];
  const unresolvedMessageIds: string[] = [];
  const seen = new Set<string>();

  for (const message of thread.messages) {
    if (message.isRead) continue;
    if (!message.folderRef || !message.providerMessageRef) {
      unresolvedMessageIds.push(message.id);
      continue;
    }
    const key = `${message.folderRef}:${message.providerMessageRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({
      messageId: message.id,
      folderRef: message.folderRef,
      providerMessageRef: message.providerMessageRef,
    });
  }

  return { targets, unresolvedMessageIds };
}

export function setMailMessagesReadState(
  thread: GmailThread,
  messageIds: Iterable<string>,
  isRead: boolean,
) {
  const targetIds = new Set(messageIds);
  if (!targetIds.size) return thread;
  const messages = thread.messages.map((message) => {
    if (!targetIds.has(message.id)) return message;
    return {
      ...message,
      isRead,
      labels: isRead
        ? message.labels.filter((label) => label !== 'UNREAD')
        : Array.from(new Set([...message.labels, 'UNREAD'])),
    };
  });
  const hasUnread = messages.some((message) => !message.isRead);
  return {
    ...thread,
    messages,
    hasUnread,
    labels: hasUnread
      ? Array.from(new Set([...thread.labels, 'UNREAD']))
      : thread.labels.filter((label) => label !== 'UNREAD'),
  };
}
