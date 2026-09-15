'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { runSafeRequestWithSessionRecovery } from './session-recovery';
import { isMailReplyDraftIdentity, isMailReplySystemDraft, mailReplyDraftIdentityKey, MAX_SYSTEM_DRAFT_BYTES, type MailReplyDraftIdentity, type MailReplySystemDraft } from './mail-reply-draft';
import { attachmentReminder, localReplyDraftKey, prepareReplyDraft, readLocalReplyDraft, sameReplyDraftContent, serializeReplyDraftRequest, type LocalReplyDraft } from './mail-reply-autosave';

type Session = {
  scope: string; ready: boolean; closed: boolean; saving: boolean; blocked: boolean; conflict: boolean;
  base: string | null | undefined; record: LocalReplyDraft | null; prepared: Promise<void>;
  timer?: ReturnType<typeof setTimeout>; fingerprint: string; files?: File[]; epoch: number;
  status: string; error: string; warning: string; localError: string;
};

export function useMailReplySystemDraft(identity: MailReplyDraftIdentity, enabled: boolean, options: {
  draft: MailReplySystemDraft; files: File[]; paused: boolean;
  canRestore: () => boolean; onRestore: (draft: MailReplySystemDraft) => void;
}) {
  const { account, ensureSession } = useAuth();
  const ownerId = account?.userId || '';
  const identityKey = mailReplyDraftIdentityKey(identity);
  const scope = `${ownerId}:${identityKey}`;
  const eligible = enabled && Boolean(ownerId) && isMailReplyDraftIdentity(identity);
  const session = useMemo<Session>(() => ({ scope, ready: false, closed: false, saving: false, blocked: false, conflict: false,
    base: undefined, record: null, prepared: Promise.resolve(), fingerprint: '', epoch: 0,
    status: '', error: '', warning: '', localError: '' }), [scope]);
  const current = useRef(session);
  current.current = session;
  const latestOptions = useRef(options);
  latestOptions.current = options;
  const [, redraw] = useState(0);
  const notify = useCallback(() => { if (!session.closed && current.current === session) redraw((n) => n + 1); }, [session]);

  const request = useCallback(async (action: 'read' | 'save', record?: LocalReplyDraft, signal?: AbortSignal) => {
    const payload = JSON.stringify({ action, ownerId, identity, draft: record?.draft, ...(record ? { baseSavedAt: record.baseSavedAt } : {}) });
    if (new TextEncoder().encode(payload).byteLength > MAX_SYSTEM_DRAFT_BYTES) {
      throw new Error('文字内容超过云端保存上限，尚未同步。');
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, 15_000);
    try {
      const response = await runSafeRequestWithSessionRecovery(ensureSession, () => fetch('/api/mail/system-draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal: controller.signal,
        keepalive: new TextEncoder().encode(payload).byteLength < 60_000,
      }));
      const result = await response.json();
      if (response.status === 409) { session.conflict = true; throw new Error('另一页面已保存不同版本，当前内容仍保留在本机。'); }
      if (!response.ok || !result.success) throw new Error(result.error || '自动保存暂时失败。');
      if (result.draft !== undefined && result.draft !== null && (!isMailReplySystemDraft(result.draft)
        || mailReplyDraftIdentityKey(result.draft.identity) !== identityKey)) throw new Error('保存内容与当前邮件不符，未恢复。');
      return result as { draft?: MailReplySystemDraft | null; savedAt: string | null };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    // identityKey includes every identity field, including the selected incoming body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureSession, identityKey, ownerId, session]);

  const readLocal = useCallback(() => {
    try { return readLocalReplyDraft(localStorage, ownerId, identity); }
    catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId, identityKey]);
  const writeLocal = useCallback((record: LocalReplyDraft, expectedRevision?: string) => {
    if (expectedRevision && readLocal()?.revision !== expectedRevision) return;
    try {
      localStorage.setItem(localReplyDraftKey(ownerId, record.draft.identity), JSON.stringify(record));
      session.localError = '';
    } catch {
      try {
        const textOnly = { ...record, draft: { ...record.draft, attachments: [],
          attachmentWarning: record.draft.attachmentWarning || attachmentReminder(record.draft.attachments) } };
        localStorage.setItem(localReplyDraftKey(ownerId, record.draft.identity), JSON.stringify(textOnly));
        session.localError = '本机仅暂存文字，附件需云端同步成功后才能恢复。';
      } catch { session.localError = '本机暂存不可用，请等待云端保存成功后再关闭。'; }
    }
  }, [ownerId, readLocal, session]);

  const flush = useCallback(async () => {
    clearTimeout(session.timer);
    if (session.saving || session.blocked || !session.record?.dirty || session.base === undefined) return;
    session.saving = true; session.status = '保存中…'; notify();
    await serializeReplyDraftRequest(scope, async () => {
      try {
        // New edits replace the pending snapshot, but never overtake an in-flight write.
        while (session.record?.dirty && !session.blocked) {
          const preparing = session.prepared;
          await preparing;
          if (preparing !== session.prepared) continue;
          const record = { ...session.record, baseSavedAt: session.base ?? null };
          const result = await request('save', record);
          session.base = result.savedAt;
          if (session.record.revision === record.revision) {
            session.record = { ...record, dirty: false, baseSavedAt: result.savedAt };
            writeLocal(session.record, record.revision);
            session.status = record.draft.sentAt ? '此回复已发送' : '已自动保存';
          }
          session.error = '';
        }
      } catch (error) {
        session.blocked = true;
        session.error = error instanceof Error ? error.message : '同步失败，内容已暂存本机。';
        session.status = '尚未同步';
      } finally { session.saving = false; notify(); }
    });
  }, [notify, request, scope, session, writeLocal]);

  useEffect(() => {
    if (!eligible) return;
    session.closed = false;
    const controller = new AbortController();
    void serializeReplyDraftRequest(scope, () => request('read', undefined, controller.signal)).then((result) => {
      if (controller.signal.aborted || current.current !== session) return;
      const local = readLocal();
      session.base = result.savedAt;
      const selected = local?.dirty ? local : result.draft
        ? { ownerId, revision: crypto.randomUUID(), draft: result.draft, dirty: false, baseSavedAt: result.savedAt } : null;
      if (local?.dirty && local.baseSavedAt !== result.savedAt) {
        session.conflict = true; session.blocked = true;
        session.error = '云端已有不同版本，本机修改已保留。';
        session.status = '已暂存本机，尚未同步';
      }
      if (selected && latestOptions.current.canRestore()) {
        session.record = selected;
        session.warning = selected.draft.sentAt ? '' : selected.draft.attachmentWarning || '';
        latestOptions.current.onRestore(selected.draft);
        writeLocal(selected);
        session.status = selected.draft.sentAt ? '此回复已发送' : selected.dirty ? '本机内容已恢复，等待同步' : '已自动恢复';
      }
    }).catch((error) => {
      if (controller.signal.aborted || current.current !== session) return;
      const local = readLocal();
      if (local && latestOptions.current.canRestore()) {
        session.record = local; session.warning = local.draft.sentAt ? '' : local.draft.attachmentWarning || '';
        latestOptions.current.onRestore(local.draft);
      }
      session.blocked = true;
      session.status = '尚未同步';
      session.error = error instanceof Error ? error.message : '云端读取失败，当前编辑将暂存本机。';
    }).finally(() => {
      if (!controller.signal.aborted && current.current === session) { session.ready = true; notify(); }
    });
    const saveOnLeave = () => { void flush(); };
    window.addEventListener('pagehide', saveOnLeave);
    return () => {
      controller.abort(); session.closed = true;
      window.removeEventListener('pagehide', saveOnLeave);
      void flush();
    };
  }, [eligible, flush, notify, ownerId, readLocal, request, scope, session, writeLocal]);

  const fingerprint = JSON.stringify(options.draft);
  const { files, paused } = options;
  const hasLocalEdits = !options.canRestore();
  useEffect(() => {
    if (!eligible || (!session.ready && !hasLocalEdits) || paused) return;
    const draft = JSON.parse(fingerprint) as MailReplySystemDraft;
    if (session.fingerprint === fingerprint && session.files === files) return;
    if (!session.record && !draft.foreignBody.trim() && !draft.chineseBody.trim() && !draft.userIdeas.trim() && !files.length) return;
    // A sent marker is retained until the user actually starts a new reply.
    if (session.record?.draft.sentAt && !draft.foreignBody.trim() && !draft.chineseBody.trim() && !draft.userIdeas.trim()) return;
    if (session.files?.length && !files.length) session.warning = '';
    session.fingerprint = fingerprint; session.files = files;
    const epoch = ++session.epoch;
    const record: LocalReplyDraft = { ownerId, revision: crypto.randomUUID(), dirty: true, baseSavedAt: session.base ?? session.record?.baseSavedAt ?? readLocal()?.baseSavedAt ?? null,
      draft: { ...draft, editedAt: new Date().toISOString(), attachmentWarning: attachmentReminder(files) || session.warning } };
    session.record = record;
    writeLocal(record);
    session.status = session.blocked ? '已暂存本机，尚未同步' : '保存中…';
    session.prepared = prepareReplyDraft({ ...record.draft, attachmentWarning: session.warning || undefined }, files, ownerId).then((prepared) => {
      if (session.epoch !== epoch) return;
      session.record = { ...record, draft: prepared };
      session.warning = prepared.attachmentWarning || '';
      writeLocal(session.record, record.revision); notify();
    });
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { void flush(); }, 1500);
    notify();
  }, [eligible, fingerprint, flush, notify, files, paused, hasLocalEdits, ownerId, readLocal, session, session.ready, writeLocal]);

  const retry = useCallback(async (replace = false) => {
    if (session.saving || (session.conflict && !replace)) return;
    try {
      const result = await serializeReplyDraftRequest(scope, () => request('read'));
      if (current.current !== session || session.closed) return;
      if (!session.record) {
        session.base = result.savedAt; session.blocked = false; session.conflict = false; session.error = '';
        if (result.draft && latestOptions.current.canRestore()) {
          session.record = { ownerId, revision: crypto.randomUUID(), draft: result.draft, dirty: false, baseSavedAt: result.savedAt };
          session.warning = result.draft.sentAt ? '' : result.draft.attachmentWarning || '';
          latestOptions.current.onRestore(result.draft); writeLocal(session.record);
          session.status = result.draft.sentAt ? '此回复已发送' : '已自动恢复';
        }
        notify(); return;
      }
      if (!replace && session.record?.baseSavedAt !== result.savedAt && result.draft) {
        session.conflict = true; session.error = '云端已有不同版本，本机修改已保留。'; notify(); return;
      }
      session.base = result.savedAt; session.blocked = false; session.conflict = false; session.error = '';
      if (session.record) session.record = { ...session.record, dirty: true, baseSavedAt: result.savedAt };
      await flush();
    } catch (error) { session.error = error instanceof Error ? error.message : '重试失败'; notify(); }
  }, [flush, notify, ownerId, request, scope, session, writeLocal]);
  useEffect(() => {
    const online = () => { if (!session.conflict && (session.blocked || session.record?.dirty)) void retry(); };
    if (eligible) window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [eligible, retry, session]);

  const markSent = async () => {
    if (!eligible || !session.record) return;
    clearTimeout(session.timer);
    const local = readLocal();
    const outgoing = session.record.draft;
    if (local && local.revision !== session.record.revision && !sameReplyDraftContent(local.draft, outgoing)) return;
    ++session.epoch;
    session.warning = '';
    const sent: LocalReplyDraft = { ...(local || session.record), revision: crypto.randomUUID(), dirty: true,
      draft: { ...outgoing, sentAt: new Date().toISOString() } };
    session.record = sent;
    session.prepared = Promise.resolve();
    writeLocal(sent);
    // The delayed sender may finish after this editor closed and reopened. Recheck the cloud
    // revision, and only mark matching content; a genuinely new reply must remain editable.
    await serializeReplyDraftRequest(scope, async () => {
      try {
        const remote = await request('read');
        if (remote.draft && remote.savedAt !== sent.baseSavedAt && !sameReplyDraftContent(remote.draft, outgoing)) return;
        const result = await request('save', { ...sent, baseSavedAt: remote.savedAt });
        writeLocal({ ...sent, dirty: false, baseSavedAt: result.savedAt }, sent.revision);
        if (session.record?.revision === sent.revision) session.record = { ...sent, dirty: false, baseSavedAt: result.savedAt };
        session.base = result.savedAt; session.status = '此回复已发送';
      } catch { session.error = '邮件已发送，发送状态尚未同步；本机已保留发送标记。'; }
      notify();
    });
  };
  return { ready: !eligible || session.ready, saving: session.saving, status: eligible ? session.status : '确认收件人后自动保存',
    error: session.error || (session.record?.dirty ? session.localError : ''), warning: session.warning, conflict: session.conflict, retry, flush, markSent };
}

export function restoreSystemDraftAttachments(draft: MailReplySystemDraft) {
  return draft.attachments.map((file) => new File([
    Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0)),
  ], file.name, { type: file.type, lastModified: file.lastModified }));
}
