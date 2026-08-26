'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  AlertTriangle,
  BadgePercent,
  CheckCircle2,
  Loader2,
  MailCheck,
  PackageCheck,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  WandSparkles,
} from 'lucide-react';
import { toast } from 'sonner';
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
  buildRichRawEmail,
  emailHtmlToText,
  getEmailSignatureForContext,
  stripConfiguredEmailSignature,
  textToEmailHtml,
  toBase64Url,
} from '@/lib/email-content';
import {
  formatCooperationNoticeDate,
  type CooperationProject,
} from '@/lib/cooperation-projects';
import {
  getUsableCooperationEmailHistory,
  findBoundCooperationConversation,
  groupCooperationProjectConversations,
  type CooperationConversation,
} from '@/lib/cooperation-email-thread';
import {
  collectProfileEmails,
  extractEmailAddresses,
  loadCreatorResourceProfiles,
  matchCreatorResourceProfiles,
} from '@/lib/creator-resource-profile';
import type { GmailAuth } from '@/lib/types';
import { ACCOUNT_SCOPE_CHANGED_EVENT, getAccountCacheScope } from '@/lib/account-cache-scope';
import { useMailAccounts } from '@/components/mail-account-provider';
import { useUserDataStore } from '@/components/user-data-provider';
import { USER_DATA_KEYS } from '@/lib/account-data-keys';
import {
  parseMailAccountBindings,
  resolveMailAccountBinding,
  upsertMailAccountBinding,
  type MailAccountBinding,
  type ProjectConversationLocator,
} from '@/lib/mail-account-bindings';
import { getMailProviderLabel, type MailAccount, type MailProvider } from '@/lib/mail-accounts';
import { useEmailGenerationTasks } from '@/components/email-generation-task-provider';
import { EMAIL_GENERATION_PROGRESS } from '@/lib/email-generation-tasks';
import { useDelayedEmailSender } from '@/components/delayed-email-provider';
import {
  createTencentClientMessageId,
  sendTencentMailNow,
  verifyTencentSmtp,
} from '@/lib/tencent-mail-transport';

type NoticeType = 'logistics' | 'discount' | 'reply';
type GmailHistoryMessage = {
  id: string;
  threadId: string;
  rfcMessageId: string;
  inReplyTo?: string;
  references: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  snippet?: string;
  labelIds?: string[];
  mimeType?: string;
  automated?: boolean;
  deliveryFailure?: boolean;
  providerMessageRef?: string;
  folderRef?: string;
};
export type NoticeDraft = {
  type: NoticeType;
  status: 'generating' | 'refining' | 'ready' | 'saving' | 'saved' | 'scheduled' | 'writing' | 'sent' | 'written' | 'error';
  recipient: string;
  subject: string;
  body: string;
  translatedBody: string;
  language: string;
  riskNotes: string[];
  missingInfo: string[];
  chineseDirty: boolean;
  thread?: GmailHistoryMessage;
  provider: MailProvider;
  mailAccountId: string;
  mailAddress: string;
  gmailDraftId?: string;
  tencentDraftRef?: string;
  tencentDraftFolderRef?: string;
  tencentDraftMessageRef?: string;
  notifiedBy?: 'draft' | 'send';
  error?: string;
};

type Props = {
  project: CooperationProject;
  settings: AppSettings;
  onProjectUpdated: () => Promise<void>;
  draft: NoticeDraft | null;
  setDraft: Dispatch<SetStateAction<NoticeDraft | null>>;
};

type CachedContactHistory = {
  expiresAt: number;
  messages: GmailHistoryMessage[];
};

type ConversationSelectionState = {
  type: NoticeType;
  recipient: string;
  mailAccount: MailAccount;
  candidates: CooperationConversation<GmailHistoryMessage>[];
  reason?: string;
};

const CONTACT_HISTORY_MAX_RESULTS = 20;
const CONTACT_HISTORY_CACHE_MS = 2 * 60 * 1000;
const contactHistoryCache = new Map<string, CachedContactHistory>();
const pendingContactHistoryRequests = new Map<string, Promise<GmailHistoryMessage[]>>();

if (typeof window !== 'undefined') {
  window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, () => {
    contactHistoryCache.clear();
    pendingContactHistoryRequests.clear();
  });
}

function tokenFingerprint(token: string) {
  let hash = 0;
  for (let index = 0; index < token.length; index += 1) {
    hash = ((hash << 5) - hash + token.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

async function requestContactHistory(email: string, account: MailAccount, accessToken = '') {
  const cacheKey = `${getAccountCacheScope()}|${account.provider}|${account.mailAccountId}|${email.toLowerCase()}|${accessToken ? tokenFingerprint(accessToken) : 'server-auth'}`;
  const cached = contactHistoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.messages;

  const pending = pendingContactHistoryRequests.get(cacheKey);
  if (pending) return await pending;

  const request = (async () => {
    const response = account.provider === 'gmail'
      ? await fetch('/api/gmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'contactHistory',
            accessToken,
            contactEmail: email,
            maxResults: CONTACT_HISTORY_MAX_RESULTS,
          }),
        })
      : await fetch(`/api/mail/tencent?${new URLSearchParams({
          action: 'contactHistory',
          mailAccountId: account.mailAccountId,
          email,
          maxResults: String(CONTACT_HISTORY_MAX_RESULTS),
        }).toString()}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error([result.error, result.details].filter(Boolean).join(' ') || `读取${getMailProviderLabel(account.provider)}历史邮件失败。`);
    }
    const messages = (result.data || []) as GmailHistoryMessage[];
    contactHistoryCache.set(cacheKey, {
      expiresAt: Date.now() + CONTACT_HISTORY_CACHE_MS,
      messages,
    });
    if (contactHistoryCache.size > 50) {
      const oldestKey = contactHistoryCache.keys().next().value;
      if (oldestKey) contactHistoryCache.delete(oldestKey);
    }
    return messages;
  })();

  pendingContactHistoryRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    pendingContactHistoryRequests.delete(cacheKey);
  }
}

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
  reply: {
    label: '合作项目回复邮件',
    shortLabel: '合作回复',
    description: '结合最近往来与项目资料起草回复',
    icon: MailCheck,
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

function buildProjectConversationLocator(
  candidate: CooperationConversation<GmailHistoryMessage>,
  account: MailAccount,
  boundAt: string,
) : ProjectConversationLocator {
  const latest = candidate.messages.at(-1)!;
  return {
    provider: account.provider,
    mailAccountId: account.mailAccountId,
    threadRef: latest.threadId,
    messageRef: latest.providerMessageRef || latest.id,
    folderRef: latest.folderRef,
    rfcMessageId: latest.rfcMessageId,
    subject: latest.subject,
    boundAt,
  };
}

export function CooperationEmailActions({
  project,
  settings,
  onProjectUpdated,
  draft,
  setDraft,
}: Props) {
  const { auth, connect } = useGmailAuth();
  const { accounts } = useMailAccounts();
  const { data: userData, save: saveUserData } = useUserDataStore();
  const { enqueueTask, tasks: emailGenerationTasks } = useEmailGenerationTasks();
  const { scheduleEmail } = useDelayedEmailSender();
  const [confirmDraftOpen, setConfirmDraftOpen] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [recipientSelection, setRecipientSelection] = useState<{
    type: NoticeType;
    emails: string[];
  } | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState('');
  const [persistRecipient, setPersistRecipient] = useState(true);
  const [savingRecipient, setSavingRecipient] = useState(false);
  const [resolvingRecipientType, setResolvingRecipientType] = useState<NoticeType | null>(null);
  const [mailSelection, setMailSelection] = useState<{
    type: NoticeType;
    recipient: string;
    reason?: string;
  } | null>(null);
  const [selectedMailAccountId, setSelectedMailAccountId] = useState('');
  const [conversationSelection, setConversationSelection] = useState<ConversationSelectionState | null>(null);
  const [selectedConversationKey, setSelectedConversationKey] = useState('');
  const mailBindings = parseMailAccountBindings(userData[USER_DATA_KEYS.MAIL_ACCOUNT_BINDINGS]);

  useEffect(() => {
    setConfirmDraftOpen(false);
    setConfirmSendOpen(false);
    setRecipientSelection(null);
    setSelectedRecipient('');
    setResolvingRecipientType(null);
    setMailSelection(null);
    setSelectedMailAccountId('');
    setConversationSelection(null);
    setSelectedConversationKey('');
  }, [project.id]);

  useEffect(() => {
    if (draft) return;
    const restored = [...emailGenerationTasks].reverse().find((task) => (
      task.status === 'completed'
      && task.kind === 'cooperation_email'
      && task.navigation.view === 'cooperation'
      && task.navigation.projectId === project.id
      && task.result
      && typeof task.result === 'object'
    ));
    if (!restored?.result || typeof restored.result !== 'object') return;
    const result = restored.result as Partial<NoticeDraft>;
    if (
      (result.type !== 'logistics' && result.type !== 'discount' && result.type !== 'reply')
      || result.status !== 'ready'
      || typeof result.recipient !== 'string'
      || typeof result.body !== 'string'
      || typeof result.subject !== 'string'
      || (result.provider !== 'gmail' && result.provider !== 'tencent_exmail')
      || typeof result.mailAccountId !== 'string'
      || typeof result.mailAddress !== 'string'
    ) return;
    const projectBinding = resolveMailAccountBinding(mailBindings, { projectId: project.id });
    if (
      !projectBinding
      || projectBinding.mailAccountId !== result.mailAccountId
      || projectBinding.provider !== result.provider
      || !projectBinding.conversationMode
    ) return;
    if (projectBinding.conversationMode === 'new' && result.thread) return;
    if (
      projectBinding.conversationMode === 'reply'
      && (
        !result.thread
        || !projectBinding.conversationLocator
        || !findBoundCooperationConversation(
          [{ key: 'restored', messages: [result.thread] }],
          projectBinding.conversationLocator,
        )
      )
    ) return;
    setDraft(result as NoticeDraft);
  }, [draft, emailGenerationTasks, mailBindings, project.id, setDraft]);

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

  const loadContactHistory = async (email: string, account: MailAccount) => {
    if (account.provider === 'tencent_exmail') {
      return await requestContactHistory(email, account);
    }
    if (!auth?.accessToken) {
      return await requestContactHistory(email, account, await refreshGmailAuth());
    }
    try {
      return await requestContactHistory(email, account, auth.accessToken);
    } catch (error) {
      if (!isGmailAuthError(error)) throw error;
      return await requestContactHistory(email, account, await refreshGmailAuth());
    }
  };

  const loadBoundProjectConversation = async (
    account: MailAccount,
    locator: ProjectConversationLocator,
  ) : Promise<GmailHistoryMessage[] | null> => {
    const response = account.provider === 'gmail'
      ? await fetch(`/api/gmail?${new URLSearchParams({
          action: 'projectConversation',
          threadId: locator.threadRef || '',
        }).toString()}`, { cache: 'no-store' })
      : await fetch(`/api/mail/tencent?${new URLSearchParams({
          action: 'projectConversation',
          mailAccountId: account.mailAccountId,
          rfcMessageId: locator.rfcMessageId || '',
          folder: locator.folderRef || '',
          uid: locator.messageRef,
        }).toString()}`, { cache: 'no-store' });
    const result = await response.json();
    if (response.status === 404) return null;
    if (!response.ok || !result.success) {
      throw new Error(String(result.error || '读取项目绑定邮件会话失败。'));
    }
    return (account.provider === 'gmail' ? result.data : result.data?.messages || []) as GmailHistoryMessage[];
  };

  const generateNoticeForRecipient = async (
    type: NoticeType,
    recipient: string,
    mailAccount: MailAccount,
    selectedHistory: GmailHistoryMessage[],
    conversationKey: string,
  ) => {
    const existingGmailDraftId = draft?.type === type && draft.recipient === recipient
      && draft.mailAccountId === mailAccount.mailAccountId
      ? draft.gmailDraftId
      : undefined;
    const existingTencentDraftRef = draft?.type === type && draft.recipient === recipient
      && draft.mailAccountId === mailAccount.mailAccountId
      ? draft.tencentDraftRef
      : undefined;
    const existingTencentDraftFolderRef = draft?.type === type && draft.recipient === recipient
      && draft.mailAccountId === mailAccount.mailAccountId
      ? draft.tencentDraftFolderRef
      : undefined;
    const existingTencentDraftMessageRef = draft?.type === type && draft.recipient === recipient
      && draft.mailAccountId === mailAccount.mailAccountId
      ? draft.tencentDraftMessageRef
      : undefined;
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
      chineseDirty: false,
      provider: mailAccount.provider,
      mailAccountId: mailAccount.mailAccountId,
      mailAddress: mailAccount.email,
      gmailDraftId: existingGmailDraftId,
      tencentDraftRef: existingTencentDraftRef,
      tencentDraftFolderRef: existingTencentDraftFolderRef,
      tencentDraftMessageRef: existingTencentDraftMessageRef,
    });
    const taskId = enqueueTask({
      key: `cooperation_email:${mailAccount.mailAccountId}:${project.id}:${type}:${recipient.toLowerCase()}:${conversationKey}`,
      kind: 'cooperation_email',
      title: project.channelName,
      description: `${NOTICE_META[type].shortLabel} · ${mailAccount.email}`,
      navigation: { view: 'cooperation', projectId: project.id },
      mailContext: {
        provider: mailAccount.provider,
        mailAccountId: mailAccount.mailAccountId,
        mailAddress: mailAccount.email,
      },
      retryInput: { type, recipient, mailAccountId: mailAccount.mailAccountId, conversationKey },
      run: async ({ signal, report }) => {
        try {
          report(
            `正在读取${getMailProviderLabel(mailAccount.provider)}当前项目绑定会话`,
            undefined,
            EMAIL_GENERATION_PROGRESS.readingContext,
          );
          const validHistory = getUsableCooperationEmailHistory(selectedHistory);
          const thread = validHistory.at(-1);
          report(
            '正在生成外文与中文对照',
            undefined,
            EMAIL_GENERATION_PROGRESS.generatingBody,
          );
          const response = await fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
              action: 'cooperationNotice',
              noticeType: type,
              noticePrompt: type === 'logistics'
                ? settings.aiLogisticsNoticePrompt
                : type === 'discount'
                  ? settings.aiDiscountNoticePrompt
                  : settings.aiDraftPrompt || settings.aiEmailPrompt,
              preferredLanguage: project.region,
              project: {
                channelName: project.channelName,
                region: project.region,
                product: project.product,
                cooperationType: project.cooperationType,
                shippingDate: formatCooperationNoticeDate(project.shippingDate),
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
          report(
            '正在整理生成结果',
            undefined,
            EMAIL_GENERATION_PROGRESS.organizingResult,
          );
          const readyDraft: NoticeDraft = {
            type,
            status: 'ready',
            recipient,
            subject: thread ? replySubject(thread.subject) : String(result.data?.subject || '').trim(),
            body: stripConfiguredEmailSignature(String(result.data?.body || '').trim(), settings.emailSignature),
            translatedBody: String(result.data?.translatedBody || '').trim(),
            language: String(result.data?.language || '').trim(),
            riskNotes: Array.isArray(result.data?.riskNotes) ? result.data.riskNotes.map(String) : [],
            missingInfo: Array.isArray(result.data?.missingInfo) ? result.data.missingInfo.map(String) : [],
            chineseDirty: false,
            thread,
            provider: mailAccount.provider,
            mailAccountId: mailAccount.mailAccountId,
            mailAddress: mailAccount.email,
            gmailDraftId: existingGmailDraftId,
            tencentDraftRef: existingTencentDraftRef,
            tencentDraftFolderRef: existingTencentDraftFolderRef,
            tencentDraftMessageRef: existingTencentDraftMessageRef,
          };
          setDraft(readyDraft);
          toast.success(`${project.channelName} 的${NOTICE_META[type].shortLabel}草稿已生成，可以打开项目检查。`);
          return {
            ...readyDraft,
            thread: thread ? {
              id: thread.id,
              threadId: thread.threadId,
              rfcMessageId: thread.rfcMessageId,
              inReplyTo: thread.inReplyTo,
              references: thread.references,
              subject: thread.subject,
              from: thread.from,
              to: thread.to,
              date: thread.date,
              body: '',
              providerMessageRef: thread.providerMessageRef,
              folderRef: thread.folderRef,
            } : undefined,
          };
        } catch (caughtError) {
          const message = caughtError instanceof Error ? caughtError.message : '生成告知邮件失败。';
          setDraft((current) => current ? { ...current, status: 'error', error: message } : null);
          throw caughtError;
        }
      },
    });
    if (!taskId) {
      setDraft((current) => current ? { ...current, status: 'error', error: '邮件生成任务暂时无法启动。' } : null);
    }
  };

  const prepareProjectConversation = async (
    type: NoticeType,
    recipient: string,
    mailAccount: MailAccount,
    projectBinding: MailAccountBinding | null,
    forceSelection = false,
  ) => {
    const historyMessages = await loadContactHistory(recipient, mailAccount);
    const candidates = groupCooperationProjectConversations(
      historyMessages,
      mailAccount.provider,
      mailAccount.mailAccountId,
    );
    const bindingBelongsToAccount = projectBinding?.mailAccountId === mailAccount.mailAccountId
      && projectBinding.provider === mailAccount.provider;

    if (!forceSelection && bindingBelongsToAccount && projectBinding?.conversationMode === 'new') {
      await generateNoticeForRecipient(type, recipient, mailAccount, [], 'new');
      return;
    }
    if (
      !forceSelection
      && bindingBelongsToAccount
      && projectBinding?.conversationMode === 'reply'
      && projectBinding.conversationLocator
    ) {
      const boundConversation = findBoundCooperationConversation(
        candidates,
        projectBinding.conversationLocator,
      );
      let resolvedConversation = boundConversation;
      if (!resolvedConversation) {
        const relocatedMessages = await loadBoundProjectConversation(
          mailAccount,
          projectBinding.conversationLocator,
        );
        if (relocatedMessages) {
          const relocatedCandidates = groupCooperationProjectConversations(
            relocatedMessages,
            mailAccount.provider,
            mailAccount.mailAccountId,
          );
          resolvedConversation = findBoundCooperationConversation(
            relocatedCandidates,
            projectBinding.conversationLocator,
          );
        }
      }
      if (resolvedConversation) {
        await generateNoticeForRecipient(
          type,
          recipient,
          mailAccount,
          resolvedConversation.messages,
          resolvedConversation.key,
        );
        return;
      }
    }

    setConversationSelection({
      type,
      recipient,
      mailAccount,
      candidates,
      reason: projectBinding?.conversationMode === 'reply'
        ? '这个项目原来绑定的邮件会话已移动、删除或无法读取，请重新选择；系统不会自动改用最近邮件。'
        : undefined,
    });
    setSelectedConversationKey('');
  };

  const prepareNoticeForRecipient = async (type: NoticeType, recipient: string) => {
    const projectBinding = resolveMailAccountBinding(mailBindings, { projectId: project.id });
    const fallbackBinding = projectBinding || resolveMailAccountBinding(mailBindings, { contactEmail: recipient });
    const boundAccount = fallbackBinding
      ? accounts.find((account) => account.mailAccountId === fallbackBinding.mailAccountId)
      : undefined;
    if (boundAccount?.connectionStatus === 'connected') {
      await prepareProjectConversation(type, recipient, boundAccount, projectBinding);
      return;
    }
    const connectedAccounts = accounts.filter((account) => account.connectionStatus === 'connected' && account.capabilities.drafts);
    if (!connectedAccounts.length) throw new Error('没有可保存草稿的已连接邮箱，请先在设置中连接邮箱。');
    setMailSelection({
      type,
      recipient,
      reason: projectBinding
        ? `项目原绑定邮箱 ${projectBinding.mailAddress} 已断开，请重新选择。`
        : undefined,
    });
    setSelectedMailAccountId(connectedAccounts[0]?.mailAccountId || '');
  };

  const refineNoticeFromChinese = async () => {
    if (!draft) return;
    const chineseBody = draft.translatedBody.trim();
    if (!chineseBody) {
      toast.error('请先填写需要转换的中文邮件内容。');
      return;
    }

    setDraft((current) => current ? { ...current, status: 'refining', error: undefined } : null);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'polishCooperationNotice',
          noticeType: draft.type,
          noticePrompt: draft.type === 'logistics'
            ? settings.aiLogisticsNoticePrompt
            : draft.type === 'discount'
              ? settings.aiDiscountNoticePrompt
              : settings.aiDraftPrompt || settings.aiEmailPrompt,
          chineseBody,
          targetLanguage: draft.language || project.region,
          currentSubject: draft.subject,
          project: {
            channelName: project.channelName,
            region: project.region,
            product: project.product,
            cooperationType: project.cooperationType,
            shippingDate: formatCooperationNoticeDate(project.shippingDate),
            shippingTracking: project.shippingTracking,
            discountCode: project.discountCode,
          },
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(String(result.error || '根据中文润色外语邮件失败。'));
      }
      const cleanBody = stripConfiguredEmailSignature(
        String(result.data?.body || '').trim(),
        settings.emailSignature,
      );
      if (!cleanBody) throw new Error('AI 没有返回可用的外语邮件正文。');

      setDraft((current) => current ? {
        ...current,
        status: 'ready',
        subject: current.thread
          ? replySubject(current.thread.subject)
          : String(result.data?.subject || current.subject).trim(),
        body: cleanBody,
        language: String(result.data?.language || current.language).trim(),
        riskNotes: Array.isArray(result.data?.riskNotes) ? result.data.riskNotes.map(String) : [],
        missingInfo: Array.isArray(result.data?.missingInfo) ? result.data.missingInfo.map(String) : [],
        chineseDirty: false,
      } : null);
      toast.success(`已根据你确认的中文更新${NOTICE_META[draft.type].shortLabel}外语邮件，请检查后再保存草稿。`);
    } catch (error) {
      setDraft((current) => current ? {
        ...current,
        status: 'ready',
        error: error instanceof Error ? error.message : '根据中文润色外语邮件失败。',
      } : null);
      toast.error(error instanceof Error ? error.message : '根据中文润色外语邮件失败。');
    }
  };

  const generateNotice = async (type: NoticeType) => {
    const missingCore = type === 'logistics'
      ? !project.shippingTracking
      : type === 'discount'
        ? !project.discountCode
        : false;
    if (missingCore) {
      toast.error(type === 'logistics' ? '请先补充运输追踪信息。' : '请先补充折扣码信息。');
      return;
    }
    setDraft(null);
    setResolvingRecipientType(type);
    try {
      const options = await resolveRecipientOptions(project, settings);
      if (options.confirmedEmail) {
        await prepareNoticeForRecipient(type, options.confirmedEmail);
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
    await prepareNoticeForRecipient(type, selectedRecipient);
  };

  const confirmMailAccount = async () => {
    if (!mailSelection || !selectedMailAccountId) return;
    const mailAccount = accounts.find((account) => (
      account.mailAccountId === selectedMailAccountId
      && account.connectionStatus === 'connected'
      && account.capabilities.drafts
    ));
    if (!mailAccount) {
      toast.error('所选邮箱已断开，请重新选择。');
      return;
    }
    const nextBindings = upsertMailAccountBinding(mailBindings, {
      projectId: project.id,
      contactEmail: mailSelection.recipient,
      mailAccountId: mailAccount.mailAccountId,
      provider: mailAccount.provider,
      mailAddress: mailAccount.email,
    });
    saveUserData(USER_DATA_KEYS.MAIL_ACCOUNT_BINDINGS, nextBindings);
    const pending = mailSelection;
    const nextProjectBinding = resolveMailAccountBinding(nextBindings, { projectId: project.id });
    setMailSelection(null);
    await prepareProjectConversation(pending.type, pending.recipient, mailAccount, nextProjectBinding);
  };

  const confirmProjectConversation = async () => {
    if (!conversationSelection || !selectedConversationKey) return;
    const { type, recipient, mailAccount, candidates } = conversationSelection;
    const selectedConversation = selectedConversationKey === 'new'
      ? null
      : candidates.find((candidate) => candidate.key === selectedConversationKey);
    if (selectedConversationKey !== 'new' && !selectedConversation) {
      toast.error('所选邮件会话已经不可用，请重新选择。');
      return;
    }
    const now = new Date().toISOString();
    const nextBindings = upsertMailAccountBinding(mailBindings, {
      projectId: project.id,
      contactEmail: recipient,
      mailAccountId: mailAccount.mailAccountId,
      provider: mailAccount.provider,
      mailAddress: mailAccount.email,
      conversationMode: selectedConversation ? 'reply' : 'new',
      conversationLocator: selectedConversation
        ? buildProjectConversationLocator(selectedConversation, mailAccount, now)
        : undefined,
    }, now);
    saveUserData(USER_DATA_KEYS.MAIL_ACCOUNT_BINDINGS, nextBindings);
    setConversationSelection(null);
    setSelectedConversationKey('');
    setDraft(null);
    await generateNoticeForRecipient(
      type,
      recipient,
      mailAccount,
      selectedConversation?.messages || [],
      selectedConversation?.key || 'new',
    );
  };

  const reselectProjectConversation = async () => {
    if (!draft) return;
    const mailAccount = accounts.find((account) => (
      account.mailAccountId === draft.mailAccountId
      && account.connectionStatus === 'connected'
    ));
    if (!mailAccount) {
      toast.error('项目绑定邮箱已断开，请先重新连接或重新选择邮箱。');
      return;
    }
    try {
      await prepareProjectConversation(
        draft.type,
        draft.recipient,
        mailAccount,
        resolveMailAccountBinding(mailBindings, { projectId: project.id }),
        true,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '读取项目邮件会话失败。');
    }
  };

  const createGmailDraft = async (accessToken: string) => {
    if (!draft?.recipient || !draft.subject.trim() || !draft.body.trim()) {
      throw new Error('收件人、主题或邮件正文不完整。');
    }
    const cleanBody = stripConfiguredEmailSignature(draft.body, settings.emailSignature);
    const emailSignature = getEmailSignatureForContext(
      settings.emailSignature,
      settings.emailSignatureScope,
      'regular',
    );
    const payload: Record<string, unknown> = {
      action: 'draft',
      accessToken,
      to: draft.recipient,
      subject: draft.subject.trim(),
      body: applyPlainTextEmailSignature(cleanBody, emailSignature),
      bodyHtml: appendEmailSignature(textToEmailHtml(cleanBody), emailSignature),
      draftId: draft.gmailDraftId,
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

  const createTencentDraft = async () => {
    if (!draft?.recipient || !draft.subject.trim() || !draft.body.trim()) {
      throw new Error('收件人、主题或邮件正文不完整。');
    }
    const cleanBody = stripConfiguredEmailSignature(draft.body, settings.emailSignature);
    const emailSignature = getEmailSignatureForContext(
      settings.emailSignature,
      settings.emailSignatureScope,
      'regular',
    );
    const response = await fetch('/api/mail/tencent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'draft',
        mailAccountId: draft.mailAccountId,
        to: draft.recipient,
        subject: draft.subject.trim(),
        text: applyPlainTextEmailSignature(cleanBody, emailSignature),
        html: appendEmailSignature(textToEmailHtml(cleanBody), emailSignature),
        inReplyTo: draft.thread?.rfcMessageId,
        references: [draft.thread?.references, draft.thread?.rfcMessageId].filter(Boolean).join(' '),
        previousDraft: draft.tencentDraftFolderRef && draft.tencentDraftMessageRef
          ? {
              folderRef: draft.tencentDraftFolderRef,
              providerMessageRef: draft.tencentDraftMessageRef,
            }
          : undefined,
      }),
    });
    const result = await response.json().catch(() => ({})) as {
      success?: boolean;
      data?: { draftRef?: string; folderRef?: string; uid?: string; cleanupWarning?: string };
      error?: string;
    };
    if (!response.ok || !result.success || !result.data?.draftRef) {
      throw new Error(result.error || '保存腾讯企业邮箱草稿失败。');
    }
    return result;
  };

  const getNoticeWritebackConfig = (type: NoticeType) => {
    if (type === 'reply') return null;
    const mappingKey = type === 'logistics' ? 'logisticsNotified' : 'discountNotified';
    return {
      fieldName: settings.feishuCooperationFieldMapping?.[mappingKey],
      fieldLabel: type === 'logistics' ? '物流信息已告知' : '折扣信息已告知',
    };
  };

  const writeNotifiedToFeishu = async (type: NoticeType) => {
    const config = getNoticeWritebackConfig(type);
    if (!config) throw new Error('合作回复邮件不需要更新“已告知”字段。');
    const { fieldName, fieldLabel } = config;
    if (!settings.feishuCooperationUrl || !fieldName) {
      throw new Error(`请先在“设置 > 飞书”映射${fieldLabel}字段。`);
    }
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
    if (!response.ok || !result.success) {
      throw new Error(String(result.error || `同步飞书“${fieldLabel}”失败。`));
    }
    return fieldLabel;
  };

  const refreshProjectAfterWriteback = async () => {
    try {
      await onProjectUpdated();
    } catch {
      toast.warning('飞书已成功勾选，但合作项目列表刷新失败，请手动点击“刷新项目”。');
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    if (draft.chineseDirty) {
      toast.error('中文内容已修改，请先按中文更新外语邮件，再保存草稿。');
      return;
    }
    if (draft.provider === 'gmail' && !auth?.accessToken) {
      toast.error('请先在“设置 > Gmail 邮件”连接 Gmail。');
      return;
    }
    const writebackConfig = getNoticeWritebackConfig(draft.type);
    if (writebackConfig && (!settings.feishuCooperationUrl || !writebackConfig.fieldName)) {
      toast.error(`请先在“设置 > 飞书”映射${writebackConfig.fieldLabel}字段，再保存邮箱草稿。`);
      return;
    }
    setConfirmDraftOpen(false);
    setDraft((current) => current ? { ...current, status: 'saving', error: undefined } : null);
    try {
      let draftRef = '';
      let tencentDraftFolderRef: string | undefined;
      let tencentDraftMessageRef: string | undefined;
      let cleanupWarning = '';
      if (draft.provider === 'gmail') {
        let result;
        try {
          result = await createGmailDraft(auth?.accessToken || '');
        } catch (error) {
          if (!isGmailAuthError(error)) throw error;
          result = await createGmailDraft(await refreshGmailAuth());
        }
        draftRef = String(result.data?.id || result.data?.message?.id || '');
        setDraft((current) => current ? {
          ...current,
          status: writebackConfig ? 'writing' : 'saved',
          gmailDraftId: draftRef,
        } : null);
      } else {
        const result = await createTencentDraft();
        draftRef = String(result.data?.draftRef || '');
        tencentDraftFolderRef = String(result.data?.folderRef || '') || undefined;
        tencentDraftMessageRef = String(result.data?.uid || '') || undefined;
        cleanupWarning = String(result.data?.cleanupWarning || '');
        setDraft((current) => current ? {
          ...current,
          status: writebackConfig ? 'writing' : 'saved',
          tencentDraftRef: draftRef,
          tencentDraftFolderRef,
          tencentDraftMessageRef,
          error: cleanupWarning || undefined,
        } : null);
      }
      const providerLabel = getMailProviderLabel(draft.provider);
      if (!writebackConfig) {
        toast.success(`${providerLabel}草稿已保存；按现有业务规则，本次合作回复不修改飞书“已告知”字段。`);
        return;
      }
      try {
        await writeNotifiedToFeishu(draft.type);
        setDraft((current) => current ? {
          ...current,
          status: 'written',
          notifiedBy: 'draft',
          error: cleanupWarning || undefined,
        } : null);
        toast.success(`${providerLabel}草稿已保存，并已按业务规则同步飞书“${writebackConfig.fieldLabel}”。邮件仍在草稿箱中。`);
        await refreshProjectAfterWriteback();
      } catch (writebackError) {
        const message = writebackError instanceof Error ? writebackError.message : `同步飞书“${writebackConfig.fieldLabel}”失败。`;
        setDraft((current) => current ? {
          ...current,
          status: 'saved',
          ...(draft.provider === 'gmail'
            ? { gmailDraftId: draftRef }
            : {
                tencentDraftRef: draftRef,
                tencentDraftFolderRef,
                tencentDraftMessageRef,
              }),
          error: `${providerLabel}草稿已保存，但${message}`,
        } : null);
        toast.error(`${providerLabel}草稿已保存，但${message} 请点击“重试同步飞书”，不会重复创建草稿。`);
      }
    } catch (error) {
      setDraft((current) => current ? {
        ...current,
        status: 'ready',
        error: error instanceof Error ? error.message : '保存邮箱草稿失败。',
      } : null);
      toast.error(error instanceof Error ? error.message : '保存邮箱草稿失败。');
    }
  };

  const finishSuccessfulSend = async (sentDraft: NoticeDraft) => {
    const writebackConfig = getNoticeWritebackConfig(sentDraft.type);
    if (!writebackConfig) {
      setDraft((current) => current ? { ...current, status: 'sent', error: undefined } : null);
      toast.success(`${getMailProviderLabel(sentDraft.provider)}邮件已发送。`);
      return;
    }
    setDraft((current) => current ? { ...current, status: 'writing', error: undefined } : null);
    try {
      await writeNotifiedToFeishu(sentDraft.type);
      setDraft((current) => current ? { ...current, status: 'written', notifiedBy: 'send', error: undefined } : null);
      toast.success(`邮件已发送，并已同步勾选飞书“${writebackConfig.fieldLabel}”。`);
      await refreshProjectAfterWriteback();
    } catch (error) {
      const message = error instanceof Error ? error.message : `同步飞书“${writebackConfig.fieldLabel}”失败。`;
      setDraft((current) => current ? {
        ...current,
        status: 'sent',
        error: `邮件已经发送，但${message}`,
      } : null);
      toast.warning(`邮件已经发送，但${message} 请点击“重试同步飞书”，不要重复发送邮件。`);
    }
  };

  const sendNotice = async () => {
    if (!draft) return;
    if (draft.chineseDirty) {
      toast.error('中文内容已修改，请先按中文更新外语邮件，再发送。');
      return;
    }
    const mailAccount = accounts.find((account) => (
      account.mailAccountId === draft.mailAccountId
      && account.provider === draft.provider
      && account.connectionStatus === 'connected'
    ));
    if (!mailAccount) {
      toast.error('项目绑定邮箱已断开，请重新选择；系统不会自动改用其他邮箱。');
      return;
    }
    setConfirmSendOpen(false);
    try {
      const cleanBody = stripConfiguredEmailSignature(draft.body, settings.emailSignature);
      const signature = getEmailSignatureForContext(
        settings.emailSignature,
        settings.emailSignatureScope,
        'regular',
      );
      const html = appendEmailSignature(textToEmailHtml(cleanBody), signature);
      const delaySeconds = Math.min(60, Math.max(0, settings.emailSendDelaySeconds ?? 0));
      let accessToken = '';
      let raw = '';
      if (draft.provider === 'gmail') {
        accessToken = auth?.accessToken || '';
        if (!accessToken || !auth?.expiresAt || auth.expiresAt <= Date.now() + (delaySeconds + 60) * 1000) {
          accessToken = await refreshGmailAuth();
        }
        raw = toBase64Url(await buildRichRawEmail({
          to: draft.recipient,
          subject: draft.subject.trim(),
          htmlBody: html,
          inReplyTo: draft.thread?.rfcMessageId,
          references: [draft.thread?.references, draft.thread?.rfcMessageId].filter(Boolean).join(' '),
          attachments: [],
        }));
      } else {
        await verifyTencentSmtp(mailAccount);
      }
      const messageId = draft.provider === 'tencent_exmail'
        ? createTencentClientMessageId(mailAccount.email)
        : '';
      const sentDraft = { ...draft };
      setDraft((current) => current ? { ...current, status: 'scheduled', error: undefined } : null);
      scheduleEmail({
        accessToken,
        raw,
        threadId: draft.provider === 'gmail' ? draft.thread?.threadId : undefined,
        recipient: draft.recipient,
        delaySeconds,
        providerLabel: getMailProviderLabel(draft.provider),
        sourceEmail: mailAccount.email,
        execute: draft.provider === 'tencent_exmail'
          ? async (signal) => {
              await sendTencentMailNow(mailAccount, {
                to: draft.recipient,
                subject: draft.subject.trim(),
                html,
                text: emailHtmlToText(html),
                inReplyTo: draft.thread?.rfcMessageId,
                references: [draft.thread?.references, draft.thread?.rfcMessageId].filter(Boolean).join(' '),
              }, { messageId, signal });
            }
          : undefined,
        onSent: () => { void finishSuccessfulSend(sentDraft); },
        onCancel: () => {
          setDraft((current) => current ? { ...current, status: 'ready', error: undefined } : null);
          toast.info('已取消发送，邮件内容仍保留。');
        },
        onError: (message) => {
          setDraft((current) => current ? { ...current, status: 'ready', error: message } : null);
          toast.error(message);
        },
      });
      toast.success(delaySeconds > 0 ? `邮件已进入 ${delaySeconds} 秒发送倒计时。` : '邮件正在提交发送。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '邮件发送准备失败。';
      setDraft((current) => current ? { ...current, status: 'ready', error: message } : null);
      toast.error(message);
    }
  };

  const retryNotifiedWriteback = async () => {
    if (!draft) return;
    if (!getNoticeWritebackConfig(draft.type)) return;
    const retryOrigin = draft.status === 'sent' ? 'sent' : 'saved';
    setDraft((current) => current ? { ...current, status: 'writing', error: undefined } : null);
    try {
      const fieldLabel = await writeNotifiedToFeishu(draft.type);
      setDraft((current) => current ? {
        ...current,
        status: 'written',
        notifiedBy: retryOrigin === 'sent' ? 'send' : 'draft',
        error: undefined,
      } : null);
      toast.success(`已同步勾选飞书“${fieldLabel}”，不会重复${retryOrigin === 'sent' ? '发送邮件' : '创建邮箱草稿'}。`);
      await refreshProjectAfterWriteback();
    } catch (error) {
      const message = error instanceof Error ? error.message : '同步飞书失败。';
      setDraft((current) => current ? {
        ...current,
        status: retryOrigin,
        error: retryOrigin === 'sent'
          ? `邮件已经发送，但${message}`
          : `${getMailProviderLabel(draft.provider)}草稿已保存，但${message}`,
      } : null);
      toast.error(message);
    }
  };

  const activeMeta = draft ? NOTICE_META[draft.type] : null;
  const draftBusy = draft?.status === 'refining'
    || draft?.status === 'saving'
    || draft?.status === 'scheduled'
    || draft?.status === 'writing';
  const alreadyNotified = draft?.type === 'logistics'
    ? project.logisticsNotified
    : draft?.type === 'discount'
      ? project.discountNotified
      : false;
  const canPersistRecipient = Boolean(
    settings.feishuCooperationUrl && settings.feishuCooperationFieldMapping?.email,
  );

  return (
    <section className="border-b border-slate-200 py-4">
      <h3 className="text-sm font-semibold text-slate-900">邮件动作</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">先确认项目邮箱，再生成并检查；草稿成功保存后即按现有业务规则标记飞书“已发/已告知”，保存失败则不写回。</p>

      <div className="mt-3 grid gap-2">
        {(Object.keys(NOTICE_META) as NoticeType[]).map((type) => {
          const meta = NOTICE_META[type];
          const Icon = meta.icon;
          const missingCore = type === 'logistics'
            ? !project.shippingTracking
            : type === 'discount'
              ? !project.discountCode
              : false;
          const notified = type === 'logistics'
            ? project.logisticsNotified
            : type === 'discount'
              ? project.discountNotified
              : false;
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
              <p className="mt-0.5 text-[11px] text-blue-700">
                来源邮箱：{getMailProviderLabel(draft.provider)} · {draft.mailAddress}
              </p>
            </div>
            {alreadyNotified ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">此前已告知</Badge> : null}
          </div>

          {draft.status === 'generating' ? (
            <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />正在读取合作资料和来源邮箱历史并生成邮件…
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
              <div className="flex items-center justify-between gap-3 rounded-lg border border-white/80 bg-white/80 p-2.5 text-[11px] text-slate-600">
                <span>
                  {draft.thread
                    ? <>只参考并回复本项目已绑定会话：<span className="font-medium text-slate-800">{draft.thread.subject}</span></>
                    : `本项目已明确选择独立新邮件，将创建一封新的${getMailProviderLabel(draft.provider)}草稿。`}
                </span>
                <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-[11px]" onClick={() => void reselectProjectConversation()} disabled={draftBusy}>
                  更换会话
                </Button>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">邮件主题</label>
                <Input
                  value={draft.subject}
                  className="mt-1.5 bg-white"
                  disabled={draftBusy}
                  onChange={(event) => setDraft((current) => current ? { ...current, subject: event.target.value } : null)}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">外语邮件正文</label>
                <Textarea
                  value={draft.body}
                  className="mt-1.5 min-h-40 resize-y bg-white leading-6"
                  disabled={draftBusy}
                  onChange={(event) => setDraft((current) => current ? { ...current, body: event.target.value } : null)}
                />
              </div>
              {draft.translatedBody ? (
                <div className="rounded-lg border border-blue-200 bg-white/90 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-slate-800">中文内容（可直接修改）</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">修改后点击下方按钮，系统才会更新对应语言的邮件正文。</p>
                    </div>
                    {draft.chineseDirty ? <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">等待更新外语</Badge> : null}
                  </div>
                  <Textarea
                    value={draft.translatedBody}
                    className="mt-2 min-h-44 resize-y bg-white leading-6"
                    disabled={draftBusy}
                    onChange={(event) => setDraft((current) => current ? {
                      ...current,
                      translatedBody: event.target.value,
                      chineseDirty: true,
                    } : null)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                    disabled={!draft.translatedBody.trim() || draftBusy}
                    onClick={() => void refineNoticeFromChinese()}
                  >
                    {draft.status === 'refining' ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}
                    {draft.status === 'refining' ? '正在更新外语邮件…' : `按中文更新${draft.language ? `为${draft.language}` : '对应语言'}`}
                  </Button>
                </div>
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
                <Button variant="outline" size="sm" onClick={() => void generateNotice(draft.type)} disabled={draftBusy}>
                  <RefreshCw className="h-4 w-4" />重新生成
                </Button>
                <Button size="sm" onClick={() => setConfirmDraftOpen(true)} disabled={!draft.subject.trim() || !draft.body.trim() || draft.chineseDirty || draftBusy}>
                  {draft.status === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {draft.status === 'saving'
                    ? `正在保存${getMailProviderLabel(draft.provider)}草稿`
                    : draft.status === 'saved' || draft.status === 'sent' || draft.status === 'written'
                        ? `重新保存${getMailProviderLabel(draft.provider)}草稿`
                        : `保存${getMailProviderLabel(draft.provider)}草稿`}
                </Button>
                <Button size="sm" variant="default" onClick={() => setConfirmSendOpen(true)} disabled={!draft.subject.trim() || !draft.body.trim() || draft.chineseDirty || draftBusy || draft.status === 'sent' || draft.status === 'written'}>
                  {draft.status === 'scheduled' || draft.status === 'writing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {draft.status === 'scheduled'
                    ? '等待发送'
                    : draft.status === 'writing'
                      ? '邮件已发送，正在同步飞书'
                      : '确认并直接发送'}
                </Button>
                {(draft.status === 'saved' || draft.status === 'sent') && getNoticeWritebackConfig(draft.type) && draft.error ? (
                  <Button variant="outline" size="sm" className="border-amber-200 bg-amber-50 text-amber-700" onClick={() => void retryNotifiedWriteback()}>
                    <RefreshCw className="h-4 w-4" />重试同步飞书
                  </Button>
                ) : null}
                {draft.status === 'written' ? (
                  <Button variant="outline" size="sm" className="border-emerald-200 bg-emerald-50 text-emerald-700" disabled>
                    <CheckCircle2 className="h-4 w-4" />飞书已同步
                  </Button>
                ) : null}
              </div>
              {draft.status === 'saved' ? (
                <p className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />草稿已保存，但飞书状态尚未同步；重试不会重复创建草稿。</p>
              ) : null}
              {draft.status === 'sent' ? <p className="flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />邮件已发送；{draft.error || '本邮件不需要更新飞书“已告知”字段。'}</p> : null}
              {draft.status === 'written' ? (
                <p className="flex items-center gap-1 text-[11px] text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{draft.notifiedBy === 'send' ? '邮件已发送' : '草稿已保存'}，飞书“已发/已告知”已同步。</p>
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

      <Dialog
        open={Boolean(mailSelection)}
        onOpenChange={(open) => {
          if (!open) setMailSelection(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>选择本项目使用的邮箱</DialogTitle>
            <DialogDescription>
              {mailSelection?.reason || '这个合作项目还没有绑定邮箱。请选择草稿要保存到哪个邮箱；系统会记住为项目绑定，不会修改红人的全局绑定。'}
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={selectedMailAccountId} onValueChange={setSelectedMailAccountId}>
            {accounts.filter((account) => account.connectionStatus === 'connected' && account.capabilities.drafts).map((account) => (
              <label
                key={account.mailAccountId}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-background px-3 py-3 text-sm hover:bg-muted/50"
              >
                <RadioGroupItem value={account.mailAccountId} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{getMailProviderLabel(account.provider)}</span>
                  <span className="block truncate text-xs text-muted-foreground">{account.email}</span>
                </span>
                {account.provider === 'tencent_exmail' ? <Badge variant="outline">支持确认后发送</Badge> : null}
              </label>
            ))}
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMailSelection(null)}>取消</Button>
            <Button disabled={!selectedMailAccountId} onClick={() => void confirmMailAccount()}>
              <MailCheck />绑定项目邮箱并生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(conversationSelection)}
        onOpenChange={(open) => {
          if (!open) {
            setConversationSelection(null);
            setSelectedConversationKey('');
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>选择这个合作项目对应的邮件会话</DialogTitle>
            <DialogDescription>
              系统只会把你确认的会话交给 AI，并把草稿回复到该会话。这个选择只影响当前项目，不会修改红人的全局邮箱绑定。
            </DialogDescription>
          </DialogHeader>
          {conversationSelection?.reason ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              {conversationSelection.reason}
            </div>
          ) : null}
          <div className="text-xs text-muted-foreground">
            来源邮箱：{conversationSelection ? getMailProviderLabel(conversationSelection.mailAccount.provider) : ''}
            {conversationSelection ? ` · ${conversationSelection.mailAccount.email}` : ''}
          </div>
          <RadioGroup value={selectedConversationKey} onValueChange={setSelectedConversationKey} className="max-h-[55vh] overflow-y-auto pr-1">
            {conversationSelection?.candidates.map((candidate) => {
              const latest = candidate.messages.at(-1)!;
              const recentBody = String(latest.snippet || latest.body || '').replace(/\s+/g, ' ').trim();
              return (
                <label
                  key={candidate.key}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-3 py-3 hover:bg-muted/50"
                >
                  <RadioGroupItem value={candidate.key} className="mt-1" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{latest.subject || '无主题'}</span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span>{candidate.messages.length} 封邮件</span>
                      <span>{latest.date ? new Date(latest.date).toLocaleString('zh-CN') : '时间未知'}</span>
                    </span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                      {recentBody || '没有可显示的正文摘要'}
                    </span>
                  </span>
                </label>
              );
            })}
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/50 px-3 py-3 hover:bg-blue-50">
              <RadioGroupItem value="new" className="mt-1" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">作为独立新邮件</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">不读取任何旧会话，不携带旧邮件的回复关系。</span>
              </span>
            </label>
          </RadioGroup>
          {!conversationSelection?.candidates.length ? (
            <p className="text-xs text-muted-foreground">当前邮箱没有找到可用的人工往来会话，请选择“作为独立新邮件”。</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConversationSelection(null)}>取消</Button>
            <Button disabled={!selectedConversationKey} onClick={() => void confirmProjectConversation()}>
              <MailCheck />确认绑定并生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDraftOpen} onOpenChange={setConfirmDraftOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认保存邮箱草稿</AlertDialogTitle>
            <AlertDialogDescription>
              将使用 {draft ? `${getMailProviderLabel(draft.provider)}（${draft.mailAddress}）` : '待确认邮箱'}，
              为 {project.channelName} 创建或保存一封{activeMeta?.shortLabel || ''}草稿，收件人为 {draft?.recipient || '待确认邮箱'}。
              {draft && getNoticeWritebackConfig(draft.type)
                ? `草稿成功保存后，将按你的现有业务规则同步勾选飞书“${getNoticeWritebackConfig(draft.type)?.fieldLabel}”。`
                : '本次合作回复不修改飞书“已告知”字段。'}
              本操作不会通过邮箱服务器直接发送邮件。
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

      <AlertDialog open={confirmSendOpen} onOpenChange={setConfirmSendOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认直接发送合作邮件</AlertDialogTitle>
            <AlertDialogDescription>
              请再次核对：将使用 {draft ? `${getMailProviderLabel(draft.provider)}（${draft.mailAddress}）` : '待确认邮箱'}，
              向 {draft?.recipient || '待确认收件人'} 发送“{draft?.subject || '无主题'}”。
              点击确认后会进入发送倒计时，倒计时结束前可以取消；真正提交给邮箱服务器后不能保证撤回。
              {draft && getNoticeWritebackConfig(draft.type)
                ? `只有邮件真实发送成功后，才会同步飞书“${getNoticeWritebackConfig(draft.type)?.fieldLabel}”。`
                : '本次合作回复不会修改飞书“已告知”字段。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续检查</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void sendNotice(); }}>
              <Send className="h-4 w-4" />确认进入发送倒计时
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
