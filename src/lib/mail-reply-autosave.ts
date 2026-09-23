import { isMailReplySystemDraft, mailReplyDraftIdentityKey, MAX_SYSTEM_DRAFT_BYTES, type MailReplyDraftIdentity, type MailReplySystemDraft } from './mail-reply-draft';

export type LocalReplyDraft = {
  ownerId: string;
  revision: string;
  draft: MailReplySystemDraft;
  dirty: boolean;
  baseSavedAt: string | null;
};

export function localReplyDraftKey(ownerId: string, identity: MailReplyDraftIdentity) {
  // The envelope additionally checks the full identity, including the incoming body.
  return `mail-reply-autosave-v1:${JSON.stringify([ownerId, identity.provider, identity.mailAccountId,
    identity.mailAddress.trim().toLowerCase(), identity.threadId, identity.messageId, identity.recipient.trim().toLowerCase()])}`;
}

export function readLocalReplyDraft(storage: Pick<Storage, 'getItem'>, ownerId: string, identity: MailReplyDraftIdentity): LocalReplyDraft | null {
  const raw = storage.getItem(localReplyDraftKey(ownerId, identity));
  if (!raw) return null;
  const record = JSON.parse(raw) as LocalReplyDraft;
  return record.ownerId === ownerId && typeof record.revision === 'string' && typeof record.dirty === 'boolean'
    && (record.baseSavedAt === null || typeof record.baseSavedAt === 'string')
    && isMailReplySystemDraft(record.draft)
    && mailReplyDraftIdentityKey(record.draft.identity) === mailReplyDraftIdentityKey(identity) ? record : null;
}

export function attachmentReminder(files: Array<{ name: string }>) {
  return files.length ? `附件未完整暂存，重新打开后请重新添加：${files.map((file) => file.name).join('、')}` : '';
}

export function sameReplyDraftContent(left: MailReplySystemDraft, right: MailReplySystemDraft) {
  const content = (draft: MailReplySystemDraft) => JSON.stringify([
    mailReplyDraftIdentityKey(draft.identity), draft.foreignBody, draft.chineseBody, draft.userIdeas,
    draft.targetLanguage, draft.tone, draft.attachments, draft.attachmentWarning || '',
  ]);
  return content(left) === content(right);
}

// JSONB may reorder object keys. Compare the full saved snapshot, including
// approval state and sent markers, before acknowledging a lost save response.
export function sameSavedReplyDraft(left: MailReplySystemDraft, right: MailReplySystemDraft) {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
    );
    return value;
  };
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

const encodedFiles = new WeakMap<File, Promise<MailReplySystemDraft['attachments'][number]>>();
export async function prepareReplyDraft(draft: MailReplySystemDraft, files: File[], ownerId: string): Promise<MailReplySystemDraft> {
  const textOnly = { ...draft, attachments: [], attachmentWarning: attachmentReminder(files) || draft.attachmentWarning };
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_SYSTEM_DRAFT_BYTES * 0.65) return textOnly;
  try {
    const attachments = await Promise.all(files.map((file) => {
      let encoded = encodedFiles.get(file);
      if (!encoded) {
        encoded = file.arrayBuffer().then((buffer) => {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          return { name: file.name, type: file.type, lastModified: file.lastModified, base64: btoa(binary) };
        });
        encodedFiles.set(file, encoded);
      }
      return encoded;
    }));
    const complete = { ...draft, attachments, attachmentWarning: files.length ? undefined : draft.attachmentWarning };
    const bytes = new TextEncoder().encode(JSON.stringify({ action: 'save', ownerId, identity: draft.identity, draft: complete, baseSavedAt: new Date().toISOString() })).byteLength;
    return bytes <= MAX_SYSTEM_DRAFT_BYTES ? complete : textOnly;
  } catch { return textOnly; }
}

// A closing editor and a newly opened editor in the same tab cannot reorder writes/reads.
const lanes = new Map<string, Promise<unknown>>();
export function serializeReplyDraftRequest<T>(scope: string, run: () => Promise<T>): Promise<T> {
  const result = (lanes.get(scope) || Promise.resolve()).catch(() => undefined).then(run);
  lanes.set(scope, result);
  void result.finally(() => { if (lanes.get(scope) === result) lanes.delete(scope); }).catch(() => undefined);
  return result;
}
