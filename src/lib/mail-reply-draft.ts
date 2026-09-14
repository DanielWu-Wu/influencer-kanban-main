import type { GmailBilingualDraftSnapshot } from './gmail-bilingual-draft';
import { isGmailBilingualDraftForeignEdited, isGmailBilingualDraftTranslationCurrent } from './gmail-bilingual-draft';

export function getMailReplyApproval(input: {
  snapshot: GmailBilingualDraftSnapshot | null;
  confirmedForeign: GmailBilingualDraftSnapshot | null;
  foreignBody: string;
  chineseBody: string;
  targetLanguage: string;
}) {
  const current = isGmailBilingualDraftTranslationCurrent(input);
  const foreignEdited = isGmailBilingualDraftForeignEdited(input);
  const confirmed = Boolean(input.confirmedForeign
    && input.confirmedForeign.foreignBody.trim() === input.foreignBody.trim()
    && input.confirmedForeign.chineseBody.trim() === input.chineseBody.trim()
    && input.confirmedForeign.targetLanguage === input.targetLanguage);
  return {
    canExport: current || confirmed,
    canConfirmForeign: !current && foreignEdited,
    warning: confirmed
      ? '已采用当前外文为最终稿，中文对照未同步，仅供参考。'
      : current && foreignEdited
        ? '外文已手动修改，中文仅供参考。'
        : current
          ? '中外文已同步，可以保存邮箱草稿或确认发送。'
          : '中文或回复语言已变化，请先更新外文；如果中外文都改过，也可以明确采用当前外文。',
  };
}

export type MailReplyDraftIdentity = {
  provider: 'gmail' | 'tencent_exmail';
  mailAccountId: string;
  mailAddress: string;
  threadId: string;
  messageId: string;
  recipient: string;
  subject: string;
  anchorBody: string;
};

export type MailReplySystemDraft = {
  version: 1;
  identity: MailReplyDraftIdentity;
  foreignBody: string;
  chineseBody: string;
  userIdeas: string;
  targetLanguage: string;
  targetLanguageName: string;
  tone: 'friendly' | 'formal' | 'casual';
  snapshot: GmailBilingualDraftSnapshot | null;
  confirmedForeign: GmailBilingualDraftSnapshot | null;
  hasSuggestion: boolean;
  strategyEditing: boolean;
  translationEditing: boolean;
  attachments: Array<{ name: string; type: string; lastModified: number; base64: string }>;
};

// Stay below the hosting request limit; never silently drop large attachments.
export const MAX_SYSTEM_DRAFT_BYTES = 3 * 1024 * 1024;

export function mailReplyDraftIdentityKey(identity: MailReplyDraftIdentity) {
  return JSON.stringify([
    identity.provider, identity.mailAccountId, identity.mailAddress.trim().toLowerCase(),
    identity.threadId, identity.messageId, identity.recipient.trim().toLowerCase(),
    identity.subject, identity.anchorBody,
  ]);
}

export function isMailReplyDraftIdentity(value: unknown): value is MailReplyDraftIdentity {
  if (!value || typeof value !== 'object') return false;
  const item = value as MailReplyDraftIdentity;
  return (item.provider === 'gmail' || item.provider === 'tencent_exmail')
    && ['mailAccountId', 'mailAddress', 'threadId', 'messageId', 'recipient'].every(
      (key) => typeof item[key as keyof MailReplyDraftIdentity] === 'string'
        && Boolean(item[key as keyof MailReplyDraftIdentity].trim()),
    ) && typeof item.subject === 'string' && typeof item.anchorBody === 'string';
}

export function isMailReplySystemDraft(value: unknown): value is MailReplySystemDraft {
  if (!value || typeof value !== 'object') return false;
  const item = value as MailReplySystemDraft;
  const validSnapshot = (snapshot: unknown) => snapshot === null || (
    Boolean(snapshot) && typeof snapshot === 'object'
    && ['foreignBody', 'chineseBody', 'targetLanguage'].every(
      (key) => typeof (snapshot as Record<string, unknown>)[key] === 'string',
    )
  );
  return item.version === 1 && isMailReplyDraftIdentity(item.identity)
    && ['foreignBody', 'chineseBody', 'userIdeas', 'targetLanguage', 'targetLanguageName'].every(
      (key) => typeof (item as unknown as Record<string, unknown>)[key] === 'string',
    ) && ['friendly', 'formal', 'casual'].includes(item.tone)
    && ['hasSuggestion', 'strategyEditing', 'translationEditing'].every(
      (key) => typeof (item as unknown as Record<string, unknown>)[key] === 'boolean',
    ) && validSnapshot(item.snapshot) && validSnapshot(item.confirmedForeign)
    && Array.isArray(item.attachments) && item.attachments.every((file) => (
      file && typeof file.name === 'string' && typeof file.type === 'string'
      && Number.isFinite(file.lastModified) && typeof file.base64 === 'string'
      && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64)
    ));
}
