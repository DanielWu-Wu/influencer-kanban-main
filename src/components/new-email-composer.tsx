'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useEmailDrafts, useGmailAuth, useSettings } from '@/lib/data';
import {
  appendEmailSignature,
  buildRichRawEmail,
  emailHtmlToText,
  getEmailSignatureForContext,
  isEmailContentEmpty,
  toBase64Url,
} from '@/lib/email-content';
import { RichEmailEditor } from './rich-email-editor';
import { useDelayedEmailSender } from './delayed-email-provider';
import { useRecordAssistant } from './record-assistant-provider';
import type { MailAccount } from '@/lib/mail-accounts';
import {
  formatMailRecipients,
  isValidMailRecipient,
  parseMailRecipients,
  type EditableInlineImage,
  type EditableMailDraft,
  type MailRecipient,
} from '@/lib/mail-draft-edit';
import {
  createTencentClientMessageId,
  saveTencentMailDraft,
  sendTencentMailNow,
  verifyTencentSmtp,
} from '@/lib/tencent-mail-transport';

const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const EMPTY_ATTACHMENTS: File[] = [];

function mergeRecipientInput(recipients: MailRecipient[], input: string) {
  return input.trim() ? [...recipients, ...parseMailRecipients(input)] : recipients;
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取内嵌图片失败。'));
    reader.readAsDataURL(blob);
  });
}

function prepareInlineImagesForEditor(html: string, images: EditableInlineImage[]) {
  const container = document.createElement('div');
  container.innerHTML = html;
  const imageElements = Array.from(container.querySelectorAll<HTMLImageElement>('img'));
  for (const image of images) {
    const contentId = image.contentId.replace(/^<|>$/g, '');
    const elements = imageElements.filter((candidate) => {
      if (candidate.dataset.mailInlineId) return false;
      const source = candidate.getAttribute('src') || '';
      return source === `cid:${contentId}` || Boolean(image.dataUrl && source === image.dataUrl);
    });
    if (!elements.length || !image.dataUrl) throw new Error(`无法在正文中恢复内嵌图片：${image.filename}`);
    elements.forEach((element) => {
      element.dataset.mailInlineId = image.id;
      element.src = image.dataUrl || '';
    });
  }
  const unresolvedCid = imageElements.find((element) => (element.getAttribute('src') || '').startsWith('cid:'));
  if (unresolvedCid) throw new Error(`正文内嵌图片没有可用内容：${unresolvedCid.getAttribute('src')}`);
  return container.innerHTML;
}

function serializeInlineImagesFromEditor(html: string, images: EditableInlineImage[]) {
  const container = document.createElement('div');
  container.innerHTML = html;
  const used: EditableInlineImage[] = [];
  container.querySelectorAll<HTMLImageElement>('img[data-mail-inline-id]').forEach((element) => {
    const image = images.find((candidate) => candidate.id === element.dataset.mailInlineId);
    if (!image) throw new Error('正文中存在无法识别的内嵌图片，已停止覆盖原草稿。');
    element.setAttribute('src', `cid:${image.contentId.replace(/^<|>$/g, '')}`);
    element.removeAttribute('data-mail-inline-id');
    if (!used.some((candidate) => candidate.id === image.id)) used.push(image);
  });
  return { html: container.innerHTML, inlineImages: used };
}

function RecipientField({
  id,
  recipients,
  input,
  placeholder,
  onRecipientsChange,
  onInputChange,
}: {
  id: string;
  recipients: MailRecipient[];
  input: string;
  placeholder: string;
  onRecipientsChange: (recipients: MailRecipient[]) => void;
  onInputChange: (value: string) => void;
}) {
  const commitInput = () => {
    if (!input.trim()) return;
    onRecipientsChange([...recipients, ...parseMailRecipients(input)]);
    onInputChange('');
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-white/65 bg-white/75 px-2 py-1.5 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
      {recipients.map((recipient, index) => {
        const valid = isValidMailRecipient(recipient);
        return (
          <span
            key={`${recipient.name || ''}:${recipient.email}:${index}`}
            className={`inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-xs ${valid ? 'bg-primary/10 text-foreground' : 'bg-destructive/10 text-destructive ring-1 ring-destructive/30'}`}
            title={valid ? formatMailRecipients([recipient]) : '邮箱格式不正确'}
          >
            <span className="max-w-56 truncate">{recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}</span>
            <button
              type="button"
              className="rounded p-0.5 hover:bg-black/10"
              aria-label={`删除 ${recipient.email}`}
              onClick={() => onRecipientsChange(recipients.filter((_, itemIndex) => itemIndex !== index))}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <input
        id={id}
        value={input}
        placeholder={recipients.length ? '' : placeholder}
        className="min-w-40 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        onChange={(event) => onInputChange(event.target.value)}
        onBlur={commitInput}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
            event.preventDefault();
            commitInput();
          }
        }}
        onPaste={(event) => {
          const value = event.clipboardData.getData('text');
          if (!/[,;\n]/.test(value)) return;
          event.preventDefault();
          onRecipientsChange([...recipients, ...parseMailRecipients(value)]);
          onInputChange('');
        }}
      />
    </div>
  );
}

export function NewEmailComposer({
  open,
  onOpenChange,
  onDraftSaved,
  initialSubject = '',
  initialContent = '',
  initialAttachments = EMPTY_ATTACHMENTS,
  initialTo = '',
  editDraft,
  title = '写新邮件',
  description = '向新的红人或联系人发送邮件',
  mailAccount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftSaved?: () => void;
  initialSubject?: string;
  initialContent?: string;
  initialAttachments?: File[];
  initialTo?: string;
  editDraft?: EditableMailDraft | null;
  title?: string;
  description?: string;
  mailAccount?: MailAccount;
}) {
  const { auth, connect } = useGmailAuth();
  const { settings } = useSettings();
  const { addDraft } = useEmailDrafts();
  const { scheduleEmail } = useDelayedEmailSender();
  const { captureEvent } = useRecordAssistant();
  const [toRecipients, setToRecipients] = useState<MailRecipient[]>([]);
  const [ccRecipients, setCcRecipients] = useState<MailRecipient[]>([]);
  const [bccRecipients, setBccRecipients] = useState<MailRecipient[]>([]);
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [smtpChecking, setSmtpChecking] = useState(false);
  const [loadingDraftAttachments, setLoadingDraftAttachments] = useState(false);
  const [resolvedGmailDraftId, setResolvedGmailDraftId] = useState('');
  const [inlineImages, setInlineImages] = useState<EditableInlineImage[]>([]);
  const [draftAssetsReady, setDraftAssetsReady] = useState(true);
  const [smtpReady, setSmtpReady] = useState(
    () => mailAccount?.provider !== 'tencent_exmail' || Boolean(mailAccount.capabilities.send),
  );
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preserveContentOnOpenRef = useRef(false);
  const isTencent = mailAccount?.provider === 'tencent_exmail';
  const providerLabel = isTencent ? '腾讯企业邮箱' : 'Gmail';

  useEffect(() => {
    if (!open) return;
    if (preserveContentOnOpenRef.current) {
      preserveContentOnOpenRef.current = false;
      return;
    }
    setToRecipients(editDraft?.to || parseMailRecipients(initialTo));
    setCcRecipients(editDraft?.cc || []);
    setBccRecipients(editDraft?.bcc || []);
    setToInput('');
    setCcInput('');
    setBccInput('');
    setShowCcBcc(Boolean(editDraft?.cc.length || editDraft?.bcc.length));
    setSubject(initialSubject);
    setContent(initialContent);
    setAttachments(initialAttachments);
    setError('');
    setResolvedGmailDraftId('');
    setInlineImages([]);
    setDraftAssetsReady(!editDraft);

    if (!editDraft) return;
    const controller = new AbortController();
    const loadExistingDraft = async () => {
      setLoadingDraftAttachments(true);
      try {
        let gmailAccessToken = '';
        if (editDraft.provider === 'gmail') {
          gmailAccessToken = auth?.accessToken || '';
          if (!gmailAccessToken || (auth?.expiresAt && auth.expiresAt <= Date.now() + 60_000)) {
            const refreshResponse = await fetch('/api/auth/refresh', {
              method: 'POST',
              signal: controller.signal,
            });
            const refreshResult = await refreshResponse.json();
            if (!refreshResponse.ok || !refreshResult.data?.accessToken) {
              throw new Error(refreshResult.error || 'Gmail 授权已过期，请重新连接。');
            }
            gmailAccessToken = refreshResult.data.accessToken;
            connect({
              ...auth,
              isConnected: true,
              accessToken: gmailAccessToken,
              expiresAt: refreshResult.data.expiresAt,
            });
          }

          let pageToken = '';
          let matchedDraftId = '';
          for (let pageIndex = 0; pageIndex < 10 && !matchedDraftId; pageIndex += 1) {
            const params = new URLSearchParams({ maxResults: '100' });
            if (pageToken) params.set('pageToken', pageToken);
            const draftsResponse = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/drafts?${params.toString()}`,
              { signal: controller.signal, headers: { Authorization: `Bearer ${gmailAccessToken}` } },
            );
            const draftsResult = await draftsResponse.json().catch(() => ({})) as {
              drafts?: Array<{ id?: string; message?: { id?: string } }>;
              nextPageToken?: string;
              error?: { message?: string };
            };
            if (!draftsResponse.ok) {
              throw new Error(draftsResult.error?.message || '读取 Gmail 草稿编号失败。');
            }
            matchedDraftId = draftsResult.drafts?.find(
              (draft) => draft.message?.id === editDraft.messageId,
            )?.id || '';
            pageToken = draftsResult.nextPageToken || '';
            if (!pageToken) break;
          }
          if (!matchedDraftId) throw new Error('没有找到这封 Gmail 草稿，可能已在其他地方被删除。');
          setResolvedGmailDraftId(matchedDraftId);
        }

        const loadAttachmentSource = async (attachment: { id: string; filename: string; mimeType: string; dataUrl?: string }) => {
          let source = attachment.dataUrl || '';
          if (!source && editDraft.provider === 'tencent_exmail') {
            if (!editDraft.folderRef || !editDraft.providerMessageRef) {
              throw new Error('腾讯草稿附件定位信息不完整。');
            }
            const params = new URLSearchParams({
              action: 'attachment',
              mailAccountId: editDraft.mailAccountId,
              folder: editDraft.folderRef,
              uid: editDraft.providerMessageRef,
              attachmentId: attachment.id,
            });
            const response = await fetch(`/api/mail/tencent?${params.toString()}`, {
              cache: 'no-store',
              signal: controller.signal,
            });
            const result = await response.json().catch(() => ({})) as {
              success?: boolean;
              data?: { url?: string };
              error?: string;
            };
            if (!response.ok || !result.success || !result.data?.url) {
              throw new Error(result.error || `读取草稿附件失败：${attachment.filename}`);
            }
            source = result.data.url;
          }
          if (!source && editDraft.provider === 'gmail') {
            const response = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${editDraft.messageId}/attachments/${attachment.id}`,
              { signal: controller.signal, headers: { Authorization: `Bearer ${gmailAccessToken}` } },
            );
            const result = await response.json().catch(() => ({})) as { data?: string };
            if (!response.ok || !result.data) {
              throw new Error(`读取草稿附件失败：${attachment.filename}`);
            }
            const normalizedSource = result.data.replace(/-/g, '+').replace(/_/g, '/');
            source = `data:${attachment.mimeType};base64,${normalizedSource.padEnd(Math.ceil(normalizedSource.length / 4) * 4, '=')}`;
          }
          if (!source) throw new Error(`草稿附件内容为空：${attachment.filename}`);
          return source;
        };

        const draftFiles = await Promise.all(editDraft.attachments.map(async (attachment) => {
          const source = await loadAttachmentSource(attachment);
          const response = await fetch(source, { signal: controller.signal });
          if (!response.ok) throw new Error(`读取草稿附件失败：${attachment.filename}`);
          const blob = await response.blob();
          return new File([blob], attachment.filename, {
            type: attachment.mimeType || blob.type || 'application/octet-stream',
          });
        }));
        const loadedInlineImages = await Promise.all(editDraft.inlineImages.map(async (image) => {
          if (!image.contentId || !image.mimeType.startsWith('image/')) {
            throw new Error(`内嵌图片信息不完整：${image.filename}`);
          }
          const source = await loadAttachmentSource(image);
          const response = await fetch(source, { signal: controller.signal });
          if (!response.ok) throw new Error(`读取内嵌图片失败：${image.filename}`);
          return { ...image, dataUrl: await blobToDataUrl(await response.blob()) };
        }));
        const editableContent = prepareInlineImagesForEditor(editDraft.content, loadedInlineImages);
        if (!controller.signal.aborted) {
          setAttachments([...initialAttachments, ...draftFiles]);
          setInlineImages(loadedInlineImages);
          setContent(editableContent);
          setDraftAssetsReady(true);
        }
      } catch (caught) {
        if (!controller.signal.aborted) {
          setDraftAssetsReady(false);
          setError(`${caught instanceof Error ? caught.message : '读取原草稿失败。'} 为保护原草稿，当前禁止更新。`);
        }
      } finally {
        if (!controller.signal.aborted) setLoadingDraftAttachments(false);
      }
    };
    void loadExistingDraft();
    return () => controller.abort();
  }, [auth, connect, editDraft, initialAttachments, initialContent, initialSubject, initialTo, open]);

  useEffect(() => {
    if (!open || !isTencent || !mailAccount || smtpReady) return undefined;
    const controller = new AbortController();
    setSmtpChecking(true);
    void verifyTencentSmtp(mailAccount, controller.signal)
      .then(() => {
        setSmtpReady(true);
        setError('');
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : '腾讯企业邮箱 SMTP 验证失败。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSmtpChecking(false);
      });
    return () => controller.abort();
  }, [isTencent, mailAccount, open, smtpReady]);

  const reset = () => {
    setToRecipients([]);
    setCcRecipients([]);
    setBccRecipients([]);
    setToInput('');
    setCcInput('');
    setBccInput('');
    setShowCcBcc(false);
    setSubject('');
    setContent('');
    setAttachments([]);
    setInlineImages([]);
    setDraftAssetsReady(true);
    setError('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (toRecipients.length || toInput || subject || content || attachments.length || inlineImages.length)) {
      const discard = window.confirm('这封邮件尚未保存，确定关闭并放弃当前内容吗？');
      if (!discard) return;
    }
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const getAccessToken = async () => {
    if (!auth?.accessToken) throw new Error('请先连接 Gmail。');
    if (auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
      return auth.accessToken;
    }

    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
    });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) {
      throw new Error(result.error || 'Gmail 授权已过期，请重新连接。');
    }
    connect({
      ...auth,
      accessToken: result.data.accessToken,
      expiresAt: result.data.expiresAt,
    });
    return result.data.accessToken as string;
  };

  const createEmail = async () => {
    if (editDraft && !draftAssetsReady) throw new Error('原草稿内容没有完整加载，为避免丢失附件或图片，不能更新。');
    const finalTo = mergeRecipientInput(toRecipients, toInput);
    const finalCc = mergeRecipientInput(ccRecipients, ccInput);
    const finalBcc = mergeRecipientInput(bccRecipients, bccInput);
    if (!finalTo.length) throw new Error('请至少填写一个收件人。');
    if ([...finalTo, ...finalCc, ...finalBcc].some((recipient) => !isValidMailRecipient(recipient))) {
      throw new Error('存在格式不正确的邮箱地址，请修改红色地址后再保存。');
    }
    if (!subject.trim()) throw new Error('请填写邮件主题。');
    if (isEmailContentEmpty(content)) throw new Error('请填写邮件正文。');

    const contentWithSignature = editDraft ? content : appendEmailSignature(
      content,
      getEmailSignatureForContext(settings.emailSignature, settings.emailSignatureScope, 'regular'),
    );
    const serialized = serializeInlineImagesFromEditor(contentWithSignature, inlineImages);
    const recipientHeaders = {
      to: formatMailRecipients(finalTo),
      cc: formatMailRecipients(finalCc),
      bcc: formatMailRecipients(finalBcc),
    };
    if (isTencent) {
      if (!mailAccount) throw new Error('腾讯企业邮箱账号不可用。');
      return { accessToken: '', raw: '', finalContent: serialized.html, inlineImages: serialized.inlineImages, ...recipientHeaders, subject: subject.trim() };
    }
    const accessToken = await getAccessToken();
    const raw = toBase64Url(await buildRichRawEmail({
      to: finalTo,
      cc: finalCc,
      bcc: finalBcc,
      subject: subject.trim(),
      htmlBody: serialized.html,
      attachments,
      inlineImages: serialized.inlineImages,
    }));
    return { accessToken, finalContent: serialized.html, inlineImages: serialized.inlineImages, raw, ...recipientHeaders, subject: subject.trim() };
  };

  const saveDraft = async () => {
    setSaving(true);
    setError('');
    try {
      const outgoing = await createEmail();
      if (isTencent) {
        if (!mailAccount) throw new Error('腾讯企业邮箱账号不可用。');
        if (editDraft && (!editDraft.folderRef || !editDraft.providerMessageRef)) {
          throw new Error('原腾讯草稿定位信息不完整，为避免生成重复草稿，已停止更新。');
        }
        const savedDraft = await saveTencentMailDraft(mailAccount, {
          to: outgoing.to,
          cc: outgoing.cc,
          bcc: outgoing.bcc,
          subject: outgoing.subject,
          html: outgoing.finalContent,
          text: emailHtmlToText(outgoing.finalContent),
          attachments,
          inlineImages: outgoing.inlineImages,
        }, editDraft ? {
          provider: 'tencent_exmail',
          mailAccountId: editDraft.mailAccountId,
          draftRef: `${editDraft.folderRef || ''}:${editDraft.providerMessageRef || ''}`,
          folderRef: editDraft.folderRef,
          providerMessageRef: editDraft.providerMessageRef,
        } : undefined);
        if (savedDraft.cleanupWarning) {
          window.alert(`新草稿已保存，但旧草稿未删除：${savedDraft.cleanupWarning}`);
        }
      } else {
        if (editDraft && !resolvedGmailDraftId) {
          throw new Error('原 Gmail 草稿尚未读取完成，请稍候再保存。');
        }
        const response = await fetch(
          editDraft
            ? `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(resolvedGmailDraftId)}`
            : 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
          method: editDraft ? 'PUT' : 'POST',
          headers: {
            Authorization: `Bearer ${outgoing.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: { raw: outgoing.raw } }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || '保存草稿失败。');
      }
      if (!editDraft) {
        addDraft({
          to: outgoing.to,
          subject: subject.trim(),
          body: emailHtmlToText(outgoing.finalContent),
        });
      }
      reset();
      onOpenChange(false);
      onDraftSaved?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存草稿失败。');
    } finally {
      setSaving(false);
    }
  };

  const sendEmail = async () => {
    if (isTencent && !smtpReady) {
      setError(smtpChecking ? '正在验证腾讯企业邮箱发信能力，请稍候。' : '腾讯企业邮箱发信能力尚未通过验证，请检查连接设置。');
      return;
    }
    const pendingRecipients = mergeRecipientInput(toRecipients, toInput);
    if (!pendingRecipients.length || pendingRecipients.some((recipient) => !isValidMailRecipient(recipient))) {
      setError('请填写有效的收件人邮箱。');
      return;
    }
    const recipient = formatMailRecipients(pendingRecipients);
    const delaySeconds = Math.min(60, Math.max(0, settings.emailSendDelaySeconds ?? 0));
    const confirmed = window.confirm(
      delaySeconds > 0
        ? `确定发送给 ${recipient} 吗？邮件将在 ${delaySeconds} 秒后实际发出，倒计时结束前可以取消。`
        : `确定直接发送给 ${recipient} 吗？邮件将立即发出。`,
    );
    if (!confirmed) return;

    setSending(true);
    setError('');
    try {
      const outgoing = await createEmail();
      const messageId = isTencent ? createTencentClientMessageId(mailAccount?.email || '') : '';
      scheduleEmail({
        accessToken: outgoing.accessToken,
        raw: outgoing.raw,
        recipient,
        delaySeconds,
        providerLabel,
        sourceEmail: mailAccount?.email || auth?.email,
        execute: isTencent && mailAccount
          ? async (signal) => {
              await sendTencentMailNow(mailAccount, {
                to: outgoing.to,
                cc: outgoing.cc,
                bcc: outgoing.bcc,
                subject: outgoing.subject,
                html: outgoing.finalContent,
                text: emailHtmlToText(outgoing.finalContent),
                attachments,
                inlineImages: outgoing.inlineImages,
              }, { messageId, signal });
            }
          : undefined,
        onSent: () => {
          captureEvent({
            type: 'email_sent',
            source: isTencent ? 'tencent_exmail' : 'gmail',
            title: `已发送邮件给 ${recipient}`,
            summary: `主题：${outgoing.subject}`,
            email: {
              to: recipient,
              subject: outgoing.subject,
              body: emailHtmlToText(outgoing.finalContent),
            },
          });
          reset();
          onOpenChange(false);
        },
        onCancel: () => {
          setError('已取消发送，邮件内容仍保留。');
          preserveContentOnOpenRef.current = true;
          onOpenChange(true);
        },
        onError: (message) => {
          setError(message);
          preserveContentOnOpenRef.current = true;
          onOpenChange(true);
        },
      });
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '邮件发送失败。');
    } finally {
      setSending(false);
    }
  };

  const addAttachments = (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...attachments, ...Array.from(files)];
    const totalSize = next.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_ATTACHMENT_BYTES) {
      setError('附件总大小不能超过 18 MB。');
      return;
    }
    setAttachments(next);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="glass-panel-strong bottom-4 left-auto right-4 top-auto flex h-[min(820px,calc(100vh-2rem))] w-[min(980px,calc(100vw-2rem))] max-w-[980px] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-lg border-white/65 p-0 sm:max-w-[980px] max-sm:inset-0 max-sm:h-dvh max-sm:w-full max-sm:max-w-none max-sm:rounded-none">
        <DialogHeader className="shrink-0 border-b border-white/60 bg-white/60 px-5 py-3">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description} · 来源邮箱：{mailAccount?.email || auth?.email || providerLabel}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
          <div className="grid shrink-0 gap-3 sm:grid-cols-[72px_1fr] sm:items-start">
            <label htmlFor="new-email-to" className="pt-3 text-sm text-muted-foreground">收件人</label>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <RecipientField
                    id="new-email-to"
                    recipients={toRecipients}
                    input={toInput}
                    placeholder="输入邮箱，多个地址可用逗号、分号或回车分隔"
                    onRecipientsChange={setToRecipients}
                    onInputChange={setToInput}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 shrink-0 px-2 text-xs text-muted-foreground"
                  onClick={() => setShowCcBcc((current) => !current)}
                >
                  抄送/密送
                </Button>
              </div>
              {showCcBcc && (
                <div className="space-y-2">
                  <div className="grid grid-cols-[48px_1fr] items-center gap-2">
                    <span className="text-xs text-muted-foreground">抄送</span>
                    <RecipientField id="new-email-cc" recipients={ccRecipients} input={ccInput} placeholder="添加抄送人" onRecipientsChange={setCcRecipients} onInputChange={setCcInput} />
                  </div>
                  <div className="grid grid-cols-[48px_1fr] items-center gap-2">
                    <span className="text-xs text-muted-foreground">密送</span>
                    <RecipientField id="new-email-bcc" recipients={bccRecipients} input={bccInput} placeholder="添加密送人" onRecipientsChange={setBccRecipients} onInputChange={setBccInput} />
                  </div>
                </div>
              )}
            </div>
            <label htmlFor="new-email-subject" className="self-center text-sm text-muted-foreground">主题</label>
            <Input
              id="new-email-subject"
              value={subject}
              placeholder="填写邮件主题"
              onChange={(event) => setSubject(event.target.value)}
              className="rounded-lg border-white/65 bg-white/75"
            />
          </div>

          <RichEmailEditor
            value={content}
            placeholder="输入邮件正文..."
            minHeight="20rem"
            fillHeight
            className="min-h-[24rem] flex-1"
            onChange={setContent}
          />

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => addAttachments(event.target.files)}
          />
          <div className="flex shrink-0 items-center justify-between">
            <p className="text-xs text-muted-foreground">附件总大小上限 18 MB</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg border-white/70 bg-white/70"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
              添加附件
            </Button>
          </div>

          {attachments.length > 0 && (
            <div className="max-h-28 shrink-0 space-y-2 overflow-y-auto rounded-lg border border-white/65 bg-white/55 p-2">
              {attachments.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center gap-2 px-2 py-1">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-lg"
                    title="移除附件"
                    onClick={() => setAttachments((current) =>
                      current.filter((_, fileIndex) => fileIndex !== index))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {error && <p className="shrink-0 text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="shrink-0 border-t border-white/60 bg-white/65 px-5 py-3">
          <Button
            variant="outline"
            className="h-10 gap-2 rounded-lg border-white/70 bg-white/70"
            disabled={saving || sending || loadingDraftAttachments || (Boolean(editDraft) && !draftAssetsReady)}
            onClick={saveDraft}
          >
            {saving || loadingDraftAttachments ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {editDraft ? '更新草稿' : '保存为草稿'}
          </Button>
          <Button
            className="h-10 gap-2 rounded-lg shadow-apple"
            disabled={saving || sending || loadingDraftAttachments || smtpChecking || (Boolean(editDraft) && !draftAssetsReady) || (isTencent && !smtpReady)}
            onClick={sendEmail}
          >
            {sending || smtpChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {smtpChecking ? '正在验证发信能力' : '直接发送'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
