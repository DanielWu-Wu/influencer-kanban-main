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
  isEmailContentEmpty,
  toBase64Url,
} from '@/lib/email-content';
import { RichEmailEditor } from './rich-email-editor';
import { useDelayedEmailSender } from './delayed-email-provider';

const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const EMPTY_ATTACHMENTS: File[] = [];

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function NewEmailComposer({
  open,
  onOpenChange,
  onDraftSaved,
  initialSubject = '',
  initialContent = '',
  initialAttachments = EMPTY_ATTACHMENTS,
  title = '写新邮件',
  description = '向新的红人或联系人发送邮件',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftSaved?: () => void;
  initialSubject?: string;
  initialContent?: string;
  initialAttachments?: File[];
  title?: string;
  description?: string;
}) {
  const { auth, connect } = useGmailAuth();
  const { settings } = useSettings();
  const { addDraft } = useEmailDrafts();
  const { scheduleEmail } = useDelayedEmailSender();
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const preserveContentOnOpenRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    if (preserveContentOnOpenRef.current) {
      preserveContentOnOpenRef.current = false;
      return;
    }
    setTo('');
    setSubject(initialSubject);
    setContent(initialContent);
    setAttachments(initialAttachments);
    setError('');
  }, [initialAttachments, initialContent, initialSubject, open]);

  const reset = () => {
    setTo('');
    setSubject('');
    setContent('');
    setAttachments([]);
    setError('');
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (to || subject || content || attachments.length)) {
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
    if (!isValidEmail(to)) throw new Error('请输入有效的收件人邮箱。');
    if (!subject.trim()) throw new Error('请填写邮件主题。');
    if (isEmailContentEmpty(content)) throw new Error('请填写邮件正文。');

    const finalContent = appendEmailSignature(content, settings.emailSignature);
    const accessToken = await getAccessToken();
    const raw = toBase64Url(await buildRichRawEmail({
      to: to.trim(),
      subject: subject.trim(),
      htmlBody: finalContent,
      attachments,
    }));
    return { accessToken, finalContent, raw };
  };

  const saveDraft = async () => {
    setSaving(true);
    setError('');
    try {
      const { accessToken, finalContent, raw } = await createEmail();
      const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: { raw } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || '保存草稿失败。');
      addDraft({
        to: to.trim(),
        subject: subject.trim(),
        body: emailHtmlToText(finalContent),
      });
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
    if (!isValidEmail(to)) {
      setError('请输入有效的收件人邮箱。');
      return;
    }
    const recipient = to.trim();
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
      const { accessToken, raw } = await createEmail();
      scheduleEmail({
        accessToken,
        raw,
        recipient,
        delaySeconds,
        onSent: () => {
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
      <DialogContent className="bottom-4 left-auto right-4 top-auto flex h-[min(820px,calc(100vh-2rem))] w-[min(900px,calc(100vw-2rem))] max-w-[900px] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-md p-0 shadow-2xl sm:max-w-[900px] max-sm:inset-0 max-sm:h-dvh max-sm:w-full max-sm:max-w-none max-sm:rounded-none">
        <DialogHeader className="shrink-0 border-b bg-muted/40 px-5 py-3">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
          <div className="grid shrink-0 gap-3 sm:grid-cols-[72px_1fr] sm:items-center">
            <label htmlFor="new-email-to" className="text-sm text-muted-foreground">收件人</label>
            <Input
              id="new-email-to"
              type="email"
              value={to}
              placeholder="creator@example.com"
              onChange={(event) => setTo(event.target.value)}
            />
            <label htmlFor="new-email-subject" className="text-sm text-muted-foreground">主题</label>
            <Input
              id="new-email-subject"
              value={subject}
              placeholder="填写邮件主题"
              onChange={(event) => setSubject(event.target.value)}
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
              className="gap-1.5"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
              添加附件
            </Button>
          </div>

          {attachments.length > 0 && (
            <div className="max-h-28 shrink-0 space-y-2 overflow-y-auto rounded-md border p-2">
              {attachments.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center gap-2 px-2 py-1">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
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

        <DialogFooter className="shrink-0 border-t bg-background px-5 py-3">
          <Button
            variant="outline"
            className="gap-2"
            disabled={saving || sending}
            onClick={saveDraft}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            保存为草稿
          </Button>
          <Button
            className="gap-2"
            disabled={saving || sending}
            onClick={sendEmail}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            直接发送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
