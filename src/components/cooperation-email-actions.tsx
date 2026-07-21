'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BadgePercent,
  CheckCircle2,
  Loader2,
  MailCheck,
  PackageCheck,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { type AppSettings, useGmailAuth } from '@/lib/data';
import {
  appendEmailSignature,
  applyPlainTextEmailSignature,
  stripConfiguredEmailSignature,
  textToEmailHtml,
} from '@/lib/email-content';
import { type CooperationProject } from '@/lib/cooperation-projects';
import {
  collectProfileEmails,
  extractEmailAddresses,
  loadCreatorResourceProfiles,
  matchCreatorResourceProfiles,
} from '@/lib/creator-resource-profile';
import type { GmailAuth } from '@/lib/types';

type NoticeType = 'logistics' | 'discount';
type GmailHistoryMessage = {
  id: string;
  threadId: string;
  rfcMessageId: string;
  references: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  automated?: boolean;
  deliveryFailure?: boolean;
};
type NoticeDraft = {
  type: NoticeType;
  status: 'generating' | 'ready' | 'saving' | 'saved' | 'writing' | 'written' | 'error';
  recipient: string;
  subject: string;
  body: string;
  translatedBody: string;
  language: string;
  riskNotes: string[];
  missingInfo: string[];
  thread?: GmailHistoryMessage;
  gmailDraftId?: string;
  error?: string;
};

type Props = {
  project: CooperationProject;
  settings: AppSettings;
  onProjectUpdated: () => Promise<void>;
};

const NOTICE_META: Record<NoticeType, {
  label: string;
  shortLabel: string;
  description: string;
  icon: typeof PackageCheck;
}> = {
  logistics: {
    label: '红人包裹物流告知',
    shortLabel: '物流告知',
    description: '根据运输追踪信息起草邮件',
    icon: PackageCheck,
  },
  discount: {
    label: '红人折扣信息告知',
    shortLabel: '折扣告知',
    description: '根据折扣码或联盟信息起草邮件',
    icon: BadgePercent,
  },
};

function isGmailAuthError(error: unknown) {
  return /UNAUTHENTICATED|invalid authentication|invalid credentials|OAuth|access token|401|authError/i.test(
    error instanceof Error ? error.message : String(error || ''),
  );
}

function replySubject(subject: string) {
  const clean = subject.trim() || 'Collaboration update';
  return /^re:/i.test(clean) ? clean : `Re: ${clean}`;
}

async function resolveRecipientOptions(project: CooperationProject, settings: AppSettings) {
  const projectEmails = extractEmailAddresses(project.email);
  if (projectEmails.length === 1) {
    return { confirmedEmail: projectEmails[0], emails: projectEmails, ambiguous: false };
  }
  if (projectEmails.length > 1) {
    return { confirmedEmail: '', emails: projectEmails, ambiguous: false };
  }

  const profiles = await loadCreatorResourceProfiles(settings);
  const match = matchCreatorResourceProfiles(project, profiles);
  return {
    confirmedEmail: '',
    emails: collectProfileEmails(match.profiles),
    ambiguous: match.ambiguous,
  };
}

export function CooperationEmailActions({ project, settings, onProjectUpdated }: Props) {
  const { auth, connect } = useGmailAuth();
  const [draft, setDraft] = useState<NoticeDraft | null>(null);
  const [confirmDraftOpen, setConfirmDraftOpen] = useState(false);
  const [confirmSentOpen, setConfirmSentOpen] = useState(false);
  const [recipientSelection, setRecipientSelection] = useState<{
    type: NoticeType;
    emails: string[];
  } | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [persistRecipient, setPersistRecipient] = useState(true);
  const [savingRecipient, setSavingRecipient] = useState(false);
  const [resolvingRecipientType, setResolvingRecipientType] = useState<NoticeType | null>(null);

  useEffect(() => {
    setDraft(null);
    setConfirmDraftOpen(false);
    setConfirmSentOpen(false);
    setRecipientSelection(null);
    setSelectedRecipient('');
    setResolvingRecipientType(null);
  }, [project.id]);

  const refreshGmailAuth = async () => {
    const response = await fetch('/api/auth/refresh?force=1', { method: 'POST' });
    const result = await response.json();
    const accessToken = String(result.data?.accessToken || '');
    if (!response.ok || !result.success || !accessToken) {
      throw new Error('Gmail 授权已失效，请到“设置 > Gmail 邮件”重新连接 Gmail。');
    }
    connect(result.data as GmailAuth);
    return accessToken;
  };

  const requestContactHistory = async (email: string, accessToken: string) => {
    const response = await fetch('/api/gmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'contactHistory',
        accessToken,
        contactEmail: email,
        maxResults: 15,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error([result.error, result.details].filter(Boolean).join(' ') || '读取 Gmail 历史邮件失败。');
    }
    return (result.data || []) as GmailHistoryMessage[];
  };

  const loadContactHistory = async (email: string) => {
    if (!auth?.accessToken) return [];
    try {
      return await requestContactHistory(email, auth.accessToken);
    } catch (error) {
      if (!isGmailAuthError(error)) throw error;
      try {
        return await requestContactHistory(email, await refreshGmailAuth());
      } catch {
        return [];
      }
    }
  };

  const generateNoticeForRecipient = async (type: NoticeType, recipient: string) => {
    setDraft({
      type,
      status: 'generating',
      recipient,
      subject: '',
      body: '',
      translatedBody: '',
      language: '',
      riskNotes: [],
      missingInfo: [],
    });
    try {
      const historyMessages = await loadContactHistory(recipient);
      const validHistory = historyMessages.filter((message) => !message.automated && !message.deliveryFailure);
      const thread = validHistory.at(-1);
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cooperationNotice',
          noticeType: type,
          noticePrompt: type === 'logistics'
            ? settings.aiLogisticsNoticePrompt
            : settings.aiDiscountNoticePrompt,
          preferredLanguage: project.region,
          project: {
            channelName: project.channelName,
            region: project.region,
            product: project.product,
            cooperationType: project.cooperationType,
            shippingDate: project.shippingDate,
            shippingTracking: project.shippingTracking,
            discountCode: project.discountCode,
          },
          historyMessages: validHistory,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(String(result.error || '生成告知邮件失败。'));
      const cleanBody = stripConfiguredEmailSignature(
        String(result.data?.body || '').trim(),
        settings.emailSignature,
      );
      setDraft({
        type,
        status: 'ready',
        recipient,
        subject: thread ? replySubject(thread.subject) : String(result.data?.subject || '').trim(),
        body: cleanBody,
        translatedBody: String(result.data?.translatedBody || '').trim(),
        language: String(result.data?.language || '').trim(),
        riskNotes: Array.isArray(result.data?.riskNotes) ? result.data.riskNotes.map(String) : [],
        missingInfo: Array.isArray(result.data?.missingInfo) ? result.data.missingInfo.map(String) : [],
        thread,
      });
    } catch (error) {
      setDraft((current) => current ? {
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : '生成告知邮件失败。',
      } : null);
    }
  };

  const generateNotice = async (type: NoticeType) => {
    const missingCore = type === 'logistics' ? !project.shippingTracking : !project.discountCode;
    if (missingCore) {
      toast.error(type === 'logistics' ? '请先补充运输追踪信息。' : '请先补充折扣码信息。');
      return;
    }
    setDraft(null);
    setResolvingRecipientType(type);
    try {
      const options = await resolveRecipientOptions(project, settings);
      if (options.confirmedEmail) {
        await generateNoticeForRecipient(type, options.confirmedEmail);
        return;
      }
      if (options.ambiguous) throw new Error('频道名称对应多条不同红人资料，请补充或映射 Channel ID、频道链接后再试。');
      if (!options.emails.length) throw new Error('没有找到可用邮箱，请检查红人信息数据库中的频道资料和联系邮箱。');
      setRecipientSelection({ type, emails: options.emails });
      setSelectedRecipient(options.emails[0]);
      setPersistRecipient(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '确认红人邮箱失败。');
    } finally {
      setResolvingRecipientType(null);
    }
  };

  const confirmRecipient = async () => {
    if (!recipientSelection || !selectedRecipient) return;
    const { type } = recipientSelection;
    const fieldName = settings.feishuCooperationFieldMapping?.email;
    const canPersist = Boolean(settings.feishuCooperationUrl && fieldName);
    setSavingRecipient(true);
    if (persistRecipient && canPersist) {
      try {
        const response = await fetch('/api/feishu/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            url: settings.feishuCooperationUrl,
            recordId: project.id,
            fields: { [fieldName!]: selectedRecipient },
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(String(result.error || '保存本次联系邮箱失败。'));
        toast.success('已保存为本次合作联系邮箱。');
        await onProjectUpdated();
      } catch (error) {
        toast.warning(`${error instanceof Error ? error.message : '保存本次联系邮箱失败。'} 本次仍将使用所选邮箱生成草稿。`);
      }
    }
    setRecipientSelection(null);
    setSavingRecipient(false);
    await generateNoticeForRecipient(type, selectedRecipient);
  };

  const createGmailDraft = async (accessToken: string) => {
    if (!draft?.recipient || !draft.subject.trim() || !draft.body.trim()) {
      throw new Error('收件人、主题或邮件正文不完整。');
    }
    const cleanBody = stripConfiguredEmailSignature(draft.body, settings.emailSignature);
    const payload: Record<string, unknown> = {
      action: 'draft',
      accessToken,
      to: draft.recipient,
      subject: draft.subject.trim(),
      body: applyPlainTextEmailSignature(cleanBody, settings.emailSignature),
      bodyHtml: appendEmailSignature(textToEmailHtml(cleanBody), settings.emailSignature),
    };
    if (draft.thread?.threadId) {
      payload.threadId = draft.thread.threadId;
      payload.inReplyTo = draft.thread.rfcMessageId;
      payload.references = [draft.thread.references, draft.thread.rfcMessageId].filter(Boolean).join(' ');
    }
    const response = await fetch('/api/gmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error([result.error, result.details].filter(Boolean).join(' ') || '保存 Gmail 草稿失败。');
    }
    return result;
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (!auth?.accessToken) {
      toast.error('请先在“设置 > Gmail 邮件”连接 Gmail。');
      return;
    }
    setConfirmDraftOpen(false);
    setDraft((current) => current ? { ...current, status: 'saving', error: undefined } : null);
    try {
      let result;
      try {
        result = await createGmailDraft(auth.accessToken);
      } catch (error) {
        if (!isGmailAuthError(error)) throw error;
        result = await createGmailDraft(await refreshGmailAuth());
      }
      setDraft((current) => current ? {
        ...current,
        status: 'saved',
        gmailDraftId: String(result.data?.id || result.data?.message?.id || ''),
      } : null);
      toast.success('邮件已保存到 Gmail 草稿，尚未发送，也没有写回“已告知”。');
    } catch (error) {
      setDraft((current) => current ? {
        ...current,
        status: 'ready',
        error: error instanceof Error ? error.message : '保存 Gmail 草稿失败。',
      } : null);
      toast.error(error instanceof Error ? error.message : '保存 Gmail 草稿失败。');
    }
  };

  const confirmSentAndWriteBack = async () => {
    if (!draft) return;
    setConfirmSentOpen(false);
    const mapping = settings.feishuCooperationFieldMapping || {};
    const mappingKey = draft.type === 'logistics' ? 'logisticsNotified' : 'discountNotified';
    const fieldName = mapping[mappingKey];
    if (!settings.feishuCooperationUrl || !fieldName) {
      toast.error(`请先在“设置 > 飞书”映射${draft.type === 'logistics' ? '物流信息已告知' : '折扣信息已告知'}字段。`);
      return;
    }
    setDraft((current) => current ? { ...current, status: 'writing', error: undefined } : null);
    try {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          url: settings.feishuCooperationUrl,
          recordId: project.id,
          fields: { [fieldName]: true },
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(String(result.error || '写回飞书失败。'));
      setDraft((current) => current ? { ...current, status: 'written' } : null);
      toast.success('已确认邮件实际发送，并写回飞书“已告知”状态。');
      await onProjectUpdated();
    } catch (error) {
      setDraft((current) => current ? {
        ...current,
        status: 'saved',
        error: error instanceof Error ? error.message : '写回飞书失败。',
      } : null);
      toast.error(error instanceof Error ? error.message : '写回飞书失败。');
    }
  };

  const activeMeta = draft ? NOTICE_META[draft.type] : null;
  const alreadyNotified = draft?.type === 'logistics'
    ? project.logisticsNotified
    : project.discountNotified;
  const canPersistRecipient = Boolean(
    settings.feishuCooperationUrl && settings.feishuCooperationFieldMapping?.email,
  );

  return (
    <section className="border-b border-slate-200 py-4">
      <Toaster richColors position="top-center" />
      <h3 className="text-sm font-semibold text-slate-900">邮件动作</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">先生成并检查，再保存 Gmail 草稿；系统不会自动发送。</p>

      <div className="mt-3 grid gap-2">
        {(Object.keys(NOTICE_META) as NoticeType[]).map((type) => {
          const meta = NOTICE_META[type];
          const Icon = meta.icon;
          const missingCore = type === 'logistics' ? !project.shippingTracking : !project.discountCode;
          const notified = type === 'logistics' ? project.logisticsNotified : project.discountNotified;
          const loading = (draft?.type === type && draft.status === 'generating') || resolvingRecipientType === type;
          return (
            <Button
              key={type}
              type="button"
              variant="outline"
              className="h-auto justify-start gap-3 rounded-lg border-slate-200 bg-white px-3 py-2.5 text-left"
              disabled={missingCore || loading}
              onClick={() => void generateNotice(type)}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                  {meta.label}
                  {notified ? <Badge variant="secondary" className="h-5 rounded-md text-[10px]">此前已告知</Badge> : null}
                </span>
                <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                  {missingCore
                    ? type === 'logistics' ? '请先补充运输追踪信息' : '请先补充折扣码信息'
                    : meta.description}
                </span>
              </span>
              <Sparkles className="h-4 w-4 shrink-0 text-blue-600" />
            </Button>
          );
        })}
      </div>

      {draft ? (
        <div className="mt-3 space-y-3 rounded-xl border border-blue-100 bg-blue-50/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-slate-900">{activeMeta?.label}草稿</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {draft.recipient ? `收件人：${draft.recipient}` : '正在确认收件邮箱与历史邮件…'}
              </p>
            </div>
            {alreadyNotified ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">此前已告知</Badge> : null}
          </div>

          {draft.status === 'generating' ? (
            <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />正在读取合作资料和 Gmail 历史并生成邮件…
            </div>
          ) : draft.status === 'error' ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              <p>{draft.error || '生成邮件失败。'}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void generateNotice(draft.type)}>
                <RefreshCw className="h-4 w-4" />重新尝试
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-white/80 bg-white/80 p-2.5 text-[11px] text-slate-600">
                {draft.thread
                  ? <>将回复原 Gmail 线程：<span className="font-medium text-slate-800">{draft.thread.subject}</span></>
                  : '没有找到可用的历史线程，将创建一封新的 Gmail 草稿。'}
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">邮件主题</label>
                <Input
                  value={draft.subject}
                  className="mt-1.5 bg-white"
                  disabled={draft.status === 'saving' || draft.status === 'writing'}
                  onChange={(event) => setDraft((current) => current ? { ...current, subject: event.target.value } : null)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">外语邮件正文</label>
                <Textarea
                  value={draft.body}
                  className="mt-1.5 min-h-40 resize-y bg-white leading-6"
                  disabled={draft.status === 'saving' || draft.status === 'writing'}
                  onChange={(event) => setDraft((current) => current ? { ...current, body: event.target.value } : null)}
                />
              </div>
              {draft.translatedBody ? (
                <details open className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-slate-700">中文对照</summary>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-600">{draft.translatedBody}</p>
                </details>
              ) : null}
              {draft.riskNotes.length || draft.missingInfo.length ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3.5 w-3.5" />发送前核对</p>
                  <ul className="mt-1.5 space-y-1">
                    {[...draft.riskNotes, ...draft.missingInfo].map((item) => <li key={item}>· {item}</li>)}
                  </ul>
                </div>
              ) : null}
              {draft.error ? <p className="text-xs text-red-700">{draft.error}</p> : null}
              <div className="flex flex-wrap gap-2 border-t border-blue-100 pt-3">
                <Button variant="outline" size="sm" onClick={() => void generateNotice(draft.type)} disabled={draft.status === 'saving' || draft.status === 'writing'}>
                  <RefreshCw className="h-4 w-4" />重新生成
                </Button>
                <Button size="sm" onClick={() => setConfirmDraftOpen(true)} disabled={!draft.subject.trim() || !draft.body.trim() || draft.status === 'saving' || draft.status === 'writing'}>
                  {draft.status === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {draft.status === 'saved' || draft.status === 'written' ? '重新保存 Gmail 草稿' : '保存 Gmail 草稿'}
                </Button>
                {draft.status === 'saved' || draft.status === 'written' ? (
                  <Button variant="outline" size="sm" className="border-emerald-200 bg-emerald-50 text-emerald-700" onClick={() => setConfirmSentOpen(true)} disabled={draft.status === 'written'}>
                    <MailCheck className="h-4 w-4" />{draft.status === 'written' ? '已写回飞书' : '确认已发送并写回'}
                  </Button>
                ) : null}
              </div>
              {draft.status === 'saved' ? (
                <p className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />草稿已保存，尚未发送，也未标记“已告知”。</p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <Dialog
        open={Boolean(recipientSelection)}
        onOpenChange={(open) => {
          if (!open && !savingRecipient) setRecipientSelection(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>选择本次合作联系邮箱</DialogTitle>
            <DialogDescription>
              红人信息数据库中找到多个邮箱。请选择这次合作实际使用的收件人，系统不会自行决定。
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={selectedRecipient} onValueChange={setSelectedRecipient}>
            {recipientSelection?.emails.map((email) => (
              <label
                key={email}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 text-sm hover:bg-muted/50"
              >
                <RadioGroupItem value={email} />
                <span className="min-w-0 flex-1 truncate font-medium">{email}</span>
              </label>
            ))}
          </RadioGroup>
          <label className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${canPersistRecipient ? 'cursor-pointer bg-muted/30' : 'bg-muted/20 opacity-70'}`}>
            <Checkbox
              checked={canPersistRecipient && persistRecipient}
              disabled={!canPersistRecipient || savingRecipient}
              onCheckedChange={(checked) => setPersistRecipient(checked === true)}
            />
            <span className="text-sm">
              <span className="block font-medium">保存为本次合作邮箱</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {canPersistRecipient
                  ? '确认后写入详细合作记录；以后该合作优先使用这个邮箱。'
                  : '尚未映射详细合作记录的“联系邮箱”，本次可以临时使用，但不会保存。'}
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" disabled={savingRecipient} onClick={() => setRecipientSelection(null)}>取消</Button>
            <Button disabled={!selectedRecipient || savingRecipient} onClick={() => void confirmRecipient()}>
              {savingRecipient ? <Loader2 className="animate-spin" /> : <MailCheck />}
              {canPersistRecipient && persistRecipient ? '保存邮箱并生成' : '使用该邮箱生成'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDraftOpen} onOpenChange={setConfirmDraftOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认保存 Gmail 草稿</AlertDialogTitle>
            <AlertDialogDescription>
              将为 {project.channelName} 创建一封收件人为 {draft?.recipient || '待确认邮箱'} 的{activeMeta?.shortLabel}草稿。
              系统不会发送邮件，也不会写回飞书“已告知”状态。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续检查</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void saveDraft(); }}>
              <Save className="h-4 w-4" />确认保存草稿
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmSentOpen} onOpenChange={setConfirmSentOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认邮件已经实际发送</AlertDialogTitle>
            <AlertDialogDescription>
              只有你已经在 Gmail 中真实发送这封{activeMeta?.shortLabel}邮件，才应继续。确认后系统将把飞书中的“已告知”状态更新为已完成。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>尚未发送</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmSentAndWriteBack(); }}>
              <CheckCircle2 className="h-4 w-4" />确认发送并写回
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
