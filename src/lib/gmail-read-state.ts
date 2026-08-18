import type { GmailThread } from '@/lib/types';
import { getAccountCacheScope } from '@/lib/account-cache-scope';

const readOperationVersions = new Map<string, number>();
const automaticReadRequests = new Map<string, Promise<void>>();
const manuallyPreservedUnreadThreads = new Set<string>();

function getGmailReadThreadKey(scopeKey: string, threadId: string) {
  return `${scopeKey}::${threadId}`;
}

export type GmailAutoReadDecisionInput = {
  hasUnread: boolean;
  contentReady: boolean;
  stillViewing: boolean;
  manuallyPreservedUnread: boolean;
  latestMessageFromOwnAccount: boolean;
};

export function shouldAutoMarkGmailThreadRead(input: GmailAutoReadDecisionInput) {
  return input.hasUnread
    && input.contentReady
    && input.stillViewing
    && !input.manuallyPreservedUnread
    && !input.latestMessageFromOwnAccount;
}

export function setGmailThreadReadState(thread: GmailThread, isRead: boolean): GmailThread {
  const labels = isRead
    ? thread.labels.filter((label) => label !== 'UNREAD')
    : Array.from(new Set([...thread.labels, 'UNREAD']));

  return {
    ...thread,
    labels,
    hasUnread: !isRead,
    messages: thread.messages.map((message) => ({
      ...message,
      labels: isRead
        ? message.labels.filter((label) => label !== 'UNREAD')
        : Array.from(new Set([...message.labels, 'UNREAD'])),
      isRead,
    })),
  };
}

export function copyGmailThreadReadState(contentThread: GmailThread, stateThread: GmailThread): GmailThread {
  const stateMessages = new Map(stateThread.messages.map((message) => [message.id, message]));
  const labels = stateThread.hasUnread
    ? Array.from(new Set([...contentThread.labels, 'UNREAD']))
    : contentThread.labels.filter((label) => label !== 'UNREAD');
  return {
    ...contentThread,
    labels,
    hasUnread: stateThread.hasUnread,
    messages: contentThread.messages.map((message) => {
      const stateMessage = stateMessages.get(message.id);
      if (!stateMessage) return message;
      return {
        ...message,
        labels: stateMessage.isRead
          ? message.labels.filter((label) => label !== 'UNREAD')
          : Array.from(new Set([...message.labels, 'UNREAD'])),
        isRead: stateMessage.isRead,
      };
    }),
  };
}

export function shouldRollbackAutomaticGmailRead(
  requestVersion: number,
  currentVersion: number,
  requestScope: string,
  currentScope: string,
) {
  return requestVersion === currentVersion && requestScope === currentScope;
}

export function getGmailReadScopeKey(gmailEmail?: string, accountScope = getAccountCacheScope()) {
  return `${accountScope}::${gmailEmail?.trim().toLowerCase() || 'unknown-gmail'}`;
}

export function beginGmailReadStateOperation(scopeKey: string, threadId: string) {
  const key = getGmailReadThreadKey(scopeKey, threadId);
  const version = (readOperationVersions.get(key) || 0) + 1;
  readOperationVersions.set(key, version);
  return version;
}

export function getGmailReadStateOperationVersion(scopeKey: string, threadId: string) {
  return readOperationVersions.get(getGmailReadThreadKey(scopeKey, threadId)) || 0;
}

export function getAutomaticGmailReadRequest(scopeKey: string, threadId: string) {
  return automaticReadRequests.get(getGmailReadThreadKey(scopeKey, threadId));
}

export function registerAutomaticGmailReadRequest(
  scopeKey: string,
  threadId: string,
  request: Promise<void>,
) {
  const key = getGmailReadThreadKey(scopeKey, threadId);
  automaticReadRequests.set(key, request);
  return () => {
    if (automaticReadRequests.get(key) === request) automaticReadRequests.delete(key);
  };
}

export async function waitForAutomaticGmailRead(scopeKey: string, threadId: string) {
  await getAutomaticGmailReadRequest(scopeKey, threadId)?.catch(() => undefined);
}

export function setManualGmailUnreadPreference(scopeKey: string, threadId: string, preserve: boolean) {
  const key = getGmailReadThreadKey(scopeKey, threadId);
  if (preserve) manuallyPreservedUnreadThreads.add(key);
  else manuallyPreservedUnreadThreads.delete(key);
}

export function hasManualGmailUnreadPreference(scopeKey: string, threadId: string) {
  return manuallyPreservedUnreadThreads.has(getGmailReadThreadKey(scopeKey, threadId));
}

export function clearGmailReadStateRuntime() {
  readOperationVersions.clear();
  automaticReadRequests.clear();
  manuallyPreservedUnreadThreads.clear();
}
