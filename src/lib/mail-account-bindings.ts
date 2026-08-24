import type { MailProvider } from './mail-accounts';

export type ProjectConversationLocator = {
  provider: MailProvider;
  mailAccountId: string;
  threadRef?: string;
  messageRef: string;
  folderRef?: string;
  rfcMessageId?: string;
  subject: string;
  boundAt: string;
};

export type MailAccountBinding = {
  bindingKey: string;
  projectId?: string;
  prospectId?: string;
  feishuRecordId?: string;
  contactEmail: string;
  mailAccountId: string;
  provider: MailProvider;
  mailAddress: string;
  draftRef?: string;
  initialMessageRef?: string;
  folderRef?: string;
  threadRef?: string;
  conversationMode?: 'reply' | 'new';
  conversationLocator?: ProjectConversationLocator;
  createdAt: string;
  lastConfirmedAt: string;
};

export type MailAccountBindingMap = Record<string, MailAccountBinding>;

export type FeishuMailBindingTarget = {
  recordId: string;
  contactEmail: string;
  currentMailAccountId?: string;
};

export type MailBindingSelectionSummary = {
  bindings: MailAccountBindingMap;
  changedRecordIds: string[];
  accountChangedRecordIds: string[];
  unselected: number;
  same: number;
  overwrite: number;
};

export function buildMailAccountBindingKey(options: {
  projectId?: string;
  prospectId?: string;
  feishuRecordId?: string;
  contactEmail?: string;
}) {
  if (options.projectId?.trim()) return `project:${options.projectId.trim()}`;
  if (options.feishuRecordId?.trim()) return `feishu:${options.feishuRecordId.trim()}`;
  if (options.prospectId?.trim()) return `prospect:${options.prospectId.trim()}`;
  const contactEmail = String(options.contactEmail || '').trim().toLowerCase();
  return contactEmail ? `contact:${contactEmail}` : '';
}

export function parseMailAccountBindings(value: unknown): MailAccountBindingMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as Partial<MailAccountBinding>;
    if (
      typeof candidate.mailAccountId !== 'string'
      || (candidate.provider !== 'gmail' && candidate.provider !== 'tencent_exmail')
      || typeof candidate.mailAddress !== 'string'
      || typeof candidate.contactEmail !== 'string'
    ) return [];
    return [[key, { ...candidate, bindingKey: key } as MailAccountBinding]];
  }));
}

export function resolveMailAccountBinding(
  bindings: MailAccountBindingMap,
  options: { projectId?: string; prospectId?: string; feishuRecordId?: string; contactEmail?: string },
) {
  const keys = [
    options.projectId?.trim() ? `project:${options.projectId.trim()}` : '',
    options.feishuRecordId?.trim() ? `feishu:${options.feishuRecordId.trim()}` : '',
    options.prospectId?.trim() ? `prospect:${options.prospectId.trim()}` : '',
    options.contactEmail?.trim() ? `contact:${options.contactEmail.trim().toLowerCase()}` : '',
  ].filter(Boolean);
  return keys.map((key) => bindings[key]).find(Boolean) || null;
}

export function upsertMailAccountBinding(
  bindings: MailAccountBindingMap,
  input: Omit<MailAccountBinding, 'bindingKey' | 'createdAt' | 'lastConfirmedAt'>,
  now = new Date().toISOString(),
) {
  const primaryKey = buildMailAccountBindingKey(input);
  if (!primaryKey) throw new Error('缺少红人或联系邮箱，无法保存邮箱绑定。');
  const existing = resolveMailAccountBinding(bindings, input);
  const binding: MailAccountBinding = {
    ...input,
    bindingKey: primaryKey,
    createdAt: existing?.createdAt || now,
    lastConfirmedAt: now,
  };
  const next = { ...bindings, [primaryKey]: binding };
  if (input.projectId) return next;
  if (input.prospectId) next[`prospect:${input.prospectId}`] = binding;
  if (input.feishuRecordId) next[`feishu:${input.feishuRecordId}`] = binding;
  if (input.contactEmail) next[`contact:${input.contactEmail.trim().toLowerCase()}`] = binding;
  return next;
}

export function bindFeishuRecordsToMailAccount(
  bindings: MailAccountBindingMap,
  targets: FeishuMailBindingTarget[],
  account: { mailAccountId: string; provider: MailProvider; email: string },
) {
  let nextBindings = bindings;
  const summary: MailBindingSelectionSummary = {
    bindings,
    changedRecordIds: [],
    accountChangedRecordIds: [],
    unselected: 0,
    same: 0,
    overwrite: 0,
  };

  for (const target of targets) {
    const existing = resolveMailAccountBinding(nextBindings, {
      feishuRecordId: target.recordId,
      contactEmail: target.contactEmail,
    });
    if (existing?.mailAccountId === account.mailAccountId) {
      summary.same += 1;
      continue;
    }

    const currentMailAccountId = existing?.mailAccountId || target.currentMailAccountId;
    if (currentMailAccountId && currentMailAccountId !== account.mailAccountId) {
      summary.accountChangedRecordIds.push(target.recordId);
    }

    if (existing) summary.overwrite += 1;
    else summary.unselected += 1;
    summary.changedRecordIds.push(target.recordId);
    nextBindings = upsertMailAccountBinding(nextBindings, {
      prospectId: existing?.prospectId,
      feishuRecordId: target.recordId,
      contactEmail: target.contactEmail,
      mailAccountId: account.mailAccountId,
      provider: account.provider,
      mailAddress: account.email,
    });
  }

  summary.bindings = nextBindings;
  return summary;
}
