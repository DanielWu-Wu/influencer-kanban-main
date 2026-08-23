export type StrictConversationMessage = {
  id: string;
  mailAccountId?: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string;
  date?: string;
  labelIds?: string[];
  labels?: string[];
  automated?: boolean;
  deliveryFailure?: boolean;
  folderRef?: string;
};

export type StrictConversationGroup<T extends StrictConversationMessage> = {
  identity: string;
  messages: T[];
};

export function extractRfcMessageIds(value: unknown) {
  const text = String(value || '');
  const matches = text.match(/<[^<>\s]+>|[^\s<>,]+@[^\s<>,]+/g) || [];
  return Array.from(new Set(matches.map((item) => (
    item.trim().replace(/^<|>$/g, '').toLowerCase()
  )).filter(Boolean)));
}

function messageLabels(message: StrictConversationMessage) {
  return [...(message.labelIds || []), ...(message.labels || [])];
}

function copyPriority(message: StrictConversationMessage) {
  const labels = messageLabels(message);
  if (labels.includes('SENT')) return 30;
  if (labels.includes('DRAFT')) return 0;
  if (/temp|temporary/i.test(message.folderRef || '')) return 10;
  return 20;
}

function deduplicateMessages<T extends StrictConversationMessage>(messages: T[]) {
  const unique = new Map<string, T>();
  messages.forEach((message) => {
    const rfcId = extractRfcMessageIds(message.rfcMessageId)[0];
    const key = rfcId
      ? `${message.mailAccountId || ''}|rfc:${rfcId}`
      : `${message.mailAccountId || ''}|local:${message.id}`;
    const existing = unique.get(key);
    if (!existing || copyPriority(message) > copyPriority(existing)) unique.set(key, message);
  });
  return Array.from(unique.values());
}

function relationIds(message: StrictConversationMessage) {
  return Array.from(new Set([
    ...extractRfcMessageIds(message.inReplyTo),
    ...extractRfcMessageIds(message.references),
  ]));
}

function stableIdentity(messages: StrictConversationMessage[]) {
  const sorted = [...messages].sort((left, right) => Date.parse(left.date || '') - Date.parse(right.date || ''));
  const explicitRoot = sorted.find((message) => relationIds(message).length === 0);
  const explicitRootId = explicitRoot ? extractRfcMessageIds(explicitRoot.rfcMessageId)[0] : '';
  if (explicitRootId) return explicitRootId;
  for (const message of sorted) {
    const firstReference = extractRfcMessageIds(message.references)[0]
      || extractRfcMessageIds(message.inReplyTo)[0];
    if (firstReference) return firstReference;
  }
  return extractRfcMessageIds(sorted[0]?.rfcMessageId)[0]
    || sorted.map((message) => message.id).sort()[0]
    || 'unknown-message';
}

/**
 * 只使用 RFC 邮件关系头分组。主题、联系人和时间一律不参与会话判定。
 */
export function groupStrictMailConversations<T extends StrictConversationMessage>(messages: T[]) {
  const deduplicated = deduplicateMessages(messages);
  const groups: StrictConversationGroup<T>[] = [];
  const byAccount = new Map<string, T[]>();
  deduplicated.forEach((message) => {
    const accountKey = message.mailAccountId || '';
    byAccount.set(accountKey, [...(byAccount.get(accountKey) || []), message]);
  });

  byAccount.forEach((accountMessages) => {
    const regular = accountMessages.filter((message) => !message.automated && !message.deliveryFailure);
    const excluded = accountMessages.filter((message) => message.automated || message.deliveryFailure);
    const parent = regular.map((_, index) => index);
    const find = (index: number): number => {
      if (parent[index] !== index) parent[index] = find(parent[index]);
      return parent[index];
    };
    const join = (left: number, right: number) => {
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
    };

    const byRfcId = new Map<string, number[]>();
    const byRelationId = new Map<string, number[]>();
    regular.forEach((message, index) => {
      extractRfcMessageIds(message.rfcMessageId).forEach((id) => {
        byRfcId.set(id, [...(byRfcId.get(id) || []), index]);
      });
      relationIds(message).forEach((id) => {
        byRelationId.set(id, [...(byRelationId.get(id) || []), index]);
      });
    });

    byRelationId.forEach((relationIndexes, relationId) => {
      const referencedIndexes = byRfcId.get(relationId) || [];
      const connected = [...relationIndexes, ...referencedIndexes];
      connected.slice(1).forEach((index) => join(connected[0], index));
    });

    const connectedGroups = new Map<number, T[]>();
    regular.forEach((message, index) => {
      const root = find(index);
      connectedGroups.set(root, [...(connectedGroups.get(root) || []), message]);
    });
    connectedGroups.forEach((groupMessages) => {
      const sorted = [...groupMessages].sort((left, right) => Date.parse(left.date || '') - Date.parse(right.date || ''));
      groups.push({ identity: stableIdentity(sorted), messages: sorted });
    });
    excluded.forEach((message) => {
      groups.push({ identity: stableIdentity([message]), messages: [message] });
    });
  });

  return groups.sort((left, right) => {
    const leftDate = Date.parse(left.messages.at(-1)?.date || '');
    const rightDate = Date.parse(right.messages.at(-1)?.date || '');
    return (Number.isFinite(rightDate) ? rightDate : 0) - (Number.isFinite(leftDate) ? leftDate : 0);
  });
}

export function findStrictConversation<T extends StrictConversationMessage>(messages: T[], targetId: string) {
  return groupStrictMailConversations(messages).find((group) => (
    group.messages.some((message) => message.id === targetId)
  )) || null;
}
