'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { runSafeRequestWithSessionRecovery } from './session-recovery';
import { isMailReplySystemDraft, mailReplyDraftIdentityKey, MAX_SYSTEM_DRAFT_BYTES, type MailReplyDraftIdentity, type MailReplySystemDraft } from './mail-reply-draft';

export function useMailReplySystemDraft(identity: MailReplyDraftIdentity, enabled: boolean) {
  const { account, ensureSession } = useAuth();
  const ownerId = account?.userId || '';
  const identityKey = mailReplyDraftIdentityKey(identity);
  const scope = `${ownerId}:${identityKey}`;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const [stored, setStored] = useState<{ scope: string; draft: MailReplySystemDraft; savedAt: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const savingRef = useRef(false);

  const request = useCallback(async (action: 'read' | 'save', draft?: MailReplySystemDraft, signal?: AbortSignal) => {
    if (!ownerId || activeScope.current !== scope) throw new Error('账号或邮件已切换，请重新打开。');
    const payload = JSON.stringify({ action, ownerId, identity, draft });
    if (new TextEncoder().encode(payload).byteLength > MAX_SYSTEM_DRAFT_BYTES) {
      throw new Error('系统草稿内容及附件过大（上限 3 MB），未保存。请减少附件后重试。');
    }
    const response = await runSafeRequestWithSessionRecovery(ensureSession, () => {
      if (activeScope.current !== scope) throw new Error('账号或邮件已切换，已停止操作。');
      return fetch('/api/mail/system-draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, signal,
      });
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || '系统草稿操作失败。');
    return result;
    // identityKey includes every identity field, including the selected incoming body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensureSession, identityKey, ownerId, scope]);

  useEffect(() => {
    if (!enabled || !ownerId || !identity.messageId) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setNotice('');
    void request('read', undefined, controller.signal).then((result) => {
      if (controller.signal.aborted || activeScope.current !== scope) return;
      if (result.draft !== null && (!isMailReplySystemDraft(result.draft)
        || mailReplyDraftIdentityKey(result.draft.identity) !== identityKey)) {
        throw new Error('系统草稿格式或邮件身份不符，未恢复。');
      }
      setStored(result.draft ? { scope, draft: result.draft, savedAt: result.savedAt } : null);
    }).catch((caught) => {
      if (!controller.signal.aborted && activeScope.current === scope) setError(caught instanceof Error ? caught.message : '系统草稿读取失败。');
    }).finally(() => {
      if (!controller.signal.aborted && activeScope.current === scope) setLoading(false);
    });
    return () => controller.abort();
  }, [enabled, identity.messageId, identityKey, ownerId, reload, request, scope]);

  const save = async (draft: MailReplySystemDraft, files: File[]) => {
    if (savingRef.current || loading) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (files.reduce((sum, file) => sum + file.size, 0) > MAX_SYSTEM_DRAFT_BYTES * 0.7) {
        throw new Error('系统草稿附件过大，未保存。请减少附件后重试；不会静默丢弃附件。');
      }
      const attachments = await Promise.all(files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        return { name: file.name, type: file.type, lastModified: file.lastModified, base64: btoa(binary) };
      }));
      const savedDraft = { ...draft, attachments };
      const result = await request('save', savedDraft);
      if (activeScope.current !== scope) return;
      setStored({ scope, draft: savedDraft, savedAt: result.savedAt });
      setNotice('已保存系统草稿，不会写入邮箱或发送。之后打开同一来信的 AI 辅助回复，点击“恢复系统草稿”继续。');
    } catch (caught) {
      if (activeScope.current === scope) setError(caught instanceof Error ? caught.message : '系统草稿保存失败。');
    } finally {
      savingRef.current = false;
      if (activeScope.current === scope) setSaving(false);
    }
  };
  return {
    stored: stored?.scope === scope ? stored : null, loading, saving, error, notice,
    save, retry: () => setReload((value) => value + 1), setNotice,
  };
}

export function restoreSystemDraftAttachments(draft: MailReplySystemDraft) {
  return draft.attachments.map((file) => new File([
    Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0)),
  ], file.name, { type: file.type, lastModified: file.lastModified }));
}
