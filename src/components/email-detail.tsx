'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GmailAttachment, GmailThread, GmailMessage } from '@/lib/types';
import { useEmailTranslations, useGmailAuth, useSettings } from '@/lib/data';
import { 
  ArrowLeft, Reply, MoreHorizontal, Globe, Languages,
  Copy, Sparkles, ChevronDown, Loader2,
  Paperclip, Download, Forward, Mail, MailOpen,
  Database, Save, CheckCircle2, XCircle,
  Maximize2, X,
} from 'lucide-react';
import { EmailComposer } from './email-composer';
import { NewEmailComposer } from './new-email-composer';
import { YouTubeChannelAvatar } from './youtube-channel-avatar';
import { textToEmailHtml } from '@/lib/email-content';
import { repairTextEncoding, splitEmailForTranslation } from '@/lib/email-text';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';
import { getGmailThreadContact } from '@/lib/gmail-thread-contact';
import {
  fetchFeishuRecordsCached,
  type CachedFeishuRecord as FeishuRecord,
} from '@/lib/feishu-record-cache';
import { normalizeEmail, type RecordAssistantLog } from '@/lib/record-assistant';
import {
  buildChannelAvatarLookup,
  readChannelAvatarCache,
  resolveChannelAvatar,
  type ChannelAvatarState,
} from '@/lib/youtube-channel-avatar';
import { useRecordAssistant } from './record-assistant-provider';

interface EmailDetailProps {
  thread: GmailThread;
  onBack: () => void;
  onThreadUpdated?: (thread: GmailThread) => void;
}

type FeishuCreatorProfile = {
  recordId: string;
  email: string;
  matchedBy: string;
  channelName: string;
  channelUrl: string;
  channelId: string;
  region: string;
  platform: string;
  followers: string;
  collaborationStatus: string;
  hasReply: string;
};

type FeishuQuickAction = {
  id: string;
  label: string;
  description: string;
  fields: Partial<Record<FeishuFieldKey, string>>;
};

const QUICK_FIELD_LABELS: Partial<Record<FeishuFieldKey, string>> = {
  hasReply: '红人是否有回复',
  collaborationStatus: '合作状态',
  collaborationProgress: '合作进度',
  notes: '备注',
};

function stringifyFeishuValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyFeishuValue).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = ['text', 'name', 'email', 'link', 'url', 'value']
      .map((key) => stringifyFeishuValue(record[key]))
      .filter(Boolean);
    if (preferred.length) return preferred.join(' ');
    return Object.values(record).map(stringifyFeishuValue).filter(Boolean).join(' ');
  }
  return '';
}

function getMappedFeishuValue(
  record: FeishuRecord,
  mapping: FeishuFieldMapping,
  key: keyof FeishuFieldMapping,
) {
  const fieldName = mapping[key];
  if (!fieldName) return '';
  return stringifyFeishuValue(record.fields[fieldName]).trim();
}

function createClientId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getQuickFieldLabel(fieldKey: FeishuFieldKey) {
  return QUICK_FIELD_LABELS[fieldKey] || fieldKey;
}

function buildFeishuPayload(
  mapping: FeishuFieldMapping,
  fields: Partial<Record<FeishuFieldKey, string>>,
) {
  const payload: Record<string, string> = {};
  const missing: FeishuFieldKey[] = [];

  (Object.entries(fields) as Array<[FeishuFieldKey, string]>).forEach(([fieldKey, value]) => {
    const fieldName = mapping[fieldKey];
    if (!fieldName) {
      missing.push(fieldKey);
      return;
    }
    payload[fieldName] = value;
  });

  return { payload, missing };
}

function buildProfileWriteLog(
  profile: FeishuCreatorProfile,
  action: FeishuQuickAction,
  mapping: FeishuFieldMapping,
  status: 'synced' | 'failed',
  error?: string,
): RecordAssistantLog {
  const now = new Date().toISOString();

  return {
    id: createClientId('feishu-profile-write'),
    event: {
      type: 'status_changed',
      source: 'manual',
      title: `飞书快捷写回：${profile.channelName}`,
      summary: action.description,
      occurredAt: now,
      influencer: {
        channelName: profile.channelName,
        email: profile.email,
      },
    },
    updates: (Object.entries(action.fields) as Array<[FeishuFieldKey, string]>).map(([fieldKey, value]) => ({
      fieldKey,
      fieldLabel: getQuickFieldLabel(fieldKey),
      fieldName: mapping[fieldKey],
      value,
      valueTemplate: value,
      enabled: true,
    })),
    createdAt: now,
    finishedAt: now,
    status,
    error,
    recordId: profile.recordId,
    matchedBy: profile.matchedBy,
  };
}

function extractEmails(value?: string) {
  const raw = value || '';
  const emailMatches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
  if (emailMatches?.length) {
    return emailMatches.map((item) => normalizeEmail(item)).filter(Boolean);
  }
  return raw
    .split(',')
    .map((item) => normalizeEmail(item))
    .filter(Boolean);
}

function getMessageTimestamp(message: GmailMessage): number {
  const timestamp = Date.parse(message.date || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortMessagesNewestFirst(messages: GmailMessage[]) {
  return [...messages].sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
}

export function EmailDetail({ thread, onBack, onThreadUpdated }: EmailDetailProps) {
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(() => {
    const newestMessage = sortMessagesNewestFirst(thread.messages)[0];
    return new Set(newestMessage ? [newestMessage.id] : []);
  });
  const [composerState, setComposerState] = useState<'closed' | 'expanded' | 'minimized'>('closed');
  const [replyMode, setReplyMode] = useState<'compose' | 'ai'>('compose');
  const [savedReplyDraft, setSavedReplyDraft] = useState('');
  const [changingReadStateId, setChangingReadStateId] = useState<string | null>(null);
  const [messageActionError, setMessageActionError] = useState<string | null>(null);
  const [forwardDraft, setForwardDraft] = useState<{
    subject: string;
    content: string;
    attachments: File[];
  } | null>(null);
  const { addTranslation, getTranslation } = useEmailTranslations();
  const { auth, connect } = useGmailAuth();

  const toggleMessage = (messageId: string) => {
    const newExpanded = new Set(expandedMessages);
    if (newExpanded.has(messageId)) {
      newExpanded.delete(messageId);
    } else {
      newExpanded.add(messageId);
    }
    setExpandedMessages(newExpanded);
  };

  const getAccessToken = async () => {
    if (!auth?.accessToken) throw new Error('\u8bf7\u91cd\u65b0\u8fde\u63a5 Gmail\u3002');
    if (auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
      return auth.accessToken;
    }

    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
    });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) {
      throw new Error(result.error || 'Gmail \u6388\u6743\u5df2\u8fc7\u671f\u3002');
    }

    connect({
      ...auth,
      accessToken: result.data.accessToken,
      expiresAt: result.data.expiresAt,
    });
    return result.data.accessToken as string;
  };

  const toggleMessageReadState = async (message: GmailMessage) => {
    if (changingReadStateId) return;
    const markAsUnread = message.isRead;
    setChangingReadStateId(message.id);
    setMessageActionError(null);

    try {
      const accessToken = await getAccessToken();
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}/modify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            addLabelIds: markAsUnread ? ['UNREAD'] : [],
            removeLabelIds: markAsUnread ? [] : ['UNREAD'],
          }),
        },
      );
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(
          result.error?.message || (markAsUnread ? '\u6807\u8bb0\u672a\u8bfb\u5931\u8d25' : '\u6807\u8bb0\u5df2\u8bfb\u5931\u8d25'),
        );
      }

      const updatedMessages = thread.messages.map((item) => item.id === message.id
        ? {
            ...item,
            isRead: !markAsUnread,
            labels: markAsUnread
              ? Array.from(new Set([...item.labels, 'UNREAD']))
              : item.labels.filter((label) => label !== 'UNREAD'),
          }
        : item);
      const hasUnread = updatedMessages.some((item) => !item.isRead);
      const updatedThread: GmailThread = {
        ...thread,
        hasUnread,
        labels: hasUnread
          ? Array.from(new Set([...thread.labels, 'UNREAD']))
          : thread.labels.filter((label) => label !== 'UNREAD'),
        messages: updatedMessages,
      };
      onThreadUpdated?.(updatedThread);
    } catch (error) {
      setMessageActionError(
        error instanceof Error
          ? error.message
          : markAsUnread
            ? '\u6807\u8bb0\u672a\u8bfb\u5931\u8d25'
            : '\u6807\u8bb0\u5df2\u8bfb\u5931\u8d25',
      );
    } finally {
      setChangingReadStateId(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDisplayEmail = (from: string) => {
    const match = from.match(/^(.+?)\s*<(.+?)>$/);
    if (match) {
      return { name: match[1], email: match[2] };
    }
    return { name: from, email: from };
  };

  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [translatingQuotedIds, setTranslatingQuotedIds] = useState<Set<string>>(new Set());
  const [showingTranslationIds, setShowingTranslationIds] = useState<Set<string>>(new Set());
  const [translateErrors, setTranslateErrors] = useState<Record<string, string>>({});
  const [translationProgress, setTranslationProgress] = useState<Record<string, string>>({});
  const [creatorProfile, setCreatorProfile] = useState<FeishuCreatorProfile | null>(null);
  const [creatorProfileLoading, setCreatorProfileLoading] = useState(false);
  const [creatorProfileError, setCreatorProfileError] = useState('');
  const [channelAvatar, setChannelAvatar] = useState<ChannelAvatarState>({ status: 'idle' });
  const [pendingProfileAction, setPendingProfileAction] = useState<FeishuQuickAction | null>(null);
  const [profileActionLoading, setProfileActionLoading] = useState(false);
  const [profileActionMessage, setProfileActionMessage] = useState('');
  const [profileActionLogs, setProfileActionLogs] = useState<RecordAssistantLog[]>([]);
  const { settings } = useSettings();
  const { appendLog } = useRecordAssistant();
  const displayMessages = useMemo(() => sortMessagesNewestFirst(thread.messages), [thread.messages]);
  const newestDisplayMessageId = displayMessages[0]?.id || '';

  useEffect(() => {
    setExpandedMessages(new Set(newestDisplayMessageId ? [newestDisplayMessageId] : []));
  }, [newestDisplayMessageId, thread.id]);

  const profileContactEmails = useMemo(() => {
    return getGmailThreadContact(thread, auth?.email).emails;
  }, [auth?.email, thread]);

  useEffect(() => {
    let cancelled = false;
    const feishuUrl = settings.feishuUrl;
    const mapping = settings.feishuFieldMapping || {};
    const emailField = mapping.email;

    if (!feishuUrl || !emailField || !profileContactEmails.length) {
      setCreatorProfile(null);
      setCreatorProfileError('');
      setCreatorProfileLoading(false);
      return;
    }
    const activeFeishuUrl = feishuUrl;
    const activeEmailField = emailField;

    async function loadCreatorProfile() {
      setCreatorProfileLoading(true);
      setCreatorProfileError('');

      try {
        const records = await fetchFeishuRecordsCached(activeFeishuUrl);
        const matched = records
          .map((record) => {
            const emailValue = stringifyFeishuValue(record.fields[activeEmailField]);
            const emails = extractEmails(emailValue);
            const matchedEmail = profileContactEmails.find((email) => emails.includes(email));
            return matchedEmail
              ? { record, matchedEmail }
              : null;
          })
          .find(Boolean);

        if (cancelled) return;

        if (!matched) {
          setCreatorProfile(null);
          return;
        }

        const matchedRecord = matched.record;

        setCreatorProfile({
          recordId: matchedRecord.record_id,
          email: matched.matchedEmail,
          matchedBy: `邮箱：${matched.matchedEmail}`,
          channelName: getMappedFeishuValue(matchedRecord, mapping, 'channelName') || '未填写频道名',
          channelUrl: getMappedFeishuValue(matchedRecord, mapping, 'channelUrl'),
          channelId: getMappedFeishuValue(matchedRecord, mapping, 'channelId'),
          region: getMappedFeishuValue(matchedRecord, mapping, 'region') || '未填写',
          platform: getMappedFeishuValue(matchedRecord, mapping, 'platform') || '未填写',
          followers: getMappedFeishuValue(matchedRecord, mapping, 'followers') || '未填写',
          collaborationStatus: getMappedFeishuValue(matchedRecord, mapping, 'collaborationStatus') || '未填写',
          hasReply: getMappedFeishuValue(matchedRecord, mapping, 'hasReply') || '未填写',
        });
      } catch (error) {
        if (cancelled) return;
        setCreatorProfile(null);
        setCreatorProfileError(error instanceof Error ? error.message : '读取飞书红人资料失败。');
      } finally {
        if (!cancelled) setCreatorProfileLoading(false);
      }
    }

    void loadCreatorProfile();

    return () => {
      cancelled = true;
    };
  }, [profileContactEmails, settings.feishuFieldMapping, settings.feishuUrl]);

  useEffect(() => {
    let cancelled = false;
    const lookup = buildChannelAvatarLookup(creatorProfile);

    if (!lookup) {
      setChannelAvatar({ status: 'idle' });
      return;
    }
    const activeLookup = lookup;

    const cached = readChannelAvatarCache(activeLookup.key);
    if (cached) {
      setChannelAvatar(cached);
      return;
    }

    async function loadChannelAvatar() {
      setChannelAvatar({ status: 'loading' });
      const avatar = await resolveChannelAvatar(activeLookup, {
        regionCode: settings.youtubeDefaultRegion || '',
        relevanceLanguage: settings.youtubeDefaultLanguage || '',
      });
      if (!cancelled) {
        setChannelAvatar({
          ...avatar,
          title: avatar.title || creatorProfile?.channelName,
        });
      }
    }

    void loadChannelAvatar();

    return () => {
      cancelled = true;
    };
  }, [
    creatorProfile,
    settings.youtubeDefaultLanguage,
    settings.youtubeDefaultRegion,
  ]);

  useEffect(() => {
    setPendingProfileAction(null);
    setProfileActionMessage('');
    setProfileActionLogs([]);
  }, [thread.id]);

  const feishuQuickActions = useMemo<FeishuQuickAction[]>(() => {
    const mapping = settings.feishuFieldMapping || {};
    const actions: FeishuQuickAction[] = [
      {
        id: 'mark-replied',
        label: '标记已回复',
        description: '把飞书中的红人回复状态更新为已回复。',
        fields: { hasReply: '已回复' },
      },
      {
        id: 'mark-interested',
        label: '标记有意向',
        description: '把飞书中的合作状态更新为有意向。',
        fields: { collaborationStatus: '有意向' },
      },
      {
        id: 'mark-collaborating',
        label: '标记合作中',
        description: '把飞书中的合作状态更新为合作中。',
        fields: { collaborationStatus: '合作中' },
      },
      {
        id: 'mark-follow-up',
        label: '记录待跟进',
        description: '在飞书合作进度中记录需要继续跟进。',
        fields: { collaborationProgress: '需要跟进：已从 Gmail 邮件确认后续需要处理。' },
      },
    ];

    return actions.filter((action) =>
      (Object.keys(action.fields) as FeishuFieldKey[]).some((fieldKey) => Boolean(mapping[fieldKey])),
    );
  }, [settings.feishuFieldMapping]);

  const executeProfileAction = async () => {
    if (!creatorProfile || !pendingProfileAction) return;

    const mapping = settings.feishuFieldMapping || {};
    const { payload } = buildFeishuPayload(mapping, pendingProfileAction.fields);

    if (!settings.feishuUrl) {
      const log = buildProfileWriteLog(
        creatorProfile,
        pendingProfileAction,
        mapping,
        'failed',
        '请先在设置里连接飞书资源库。',
      );
      appendLog(log);
      setProfileActionLogs((current) => [log, ...current].slice(0, 5));
      setProfileActionMessage('写回失败：请先在设置里连接飞书资源库。');
      return;
    }

    if (!Object.keys(payload).length) {
      const log = buildProfileWriteLog(
        creatorProfile,
        pendingProfileAction,
        mapping,
        'failed',
        '没有可写入的字段，请检查飞书字段映射。',
      );
      appendLog(log);
      setProfileActionLogs((current) => [log, ...current].slice(0, 5));
      setProfileActionMessage('写回失败：没有可写入的字段，请检查飞书字段映射。');
      return;
    }

    setProfileActionLoading(true);
    setProfileActionMessage('');

    try {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          url: settings.feishuUrl,
          recordId: creatorProfile.recordId,
          fields: payload,
        }),
      });
      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '写回飞书失败。');
      }

      const log = buildProfileWriteLog(creatorProfile, pendingProfileAction, mapping, 'synced');
      appendLog(log);
      setProfileActionLogs((current) => [log, ...current].slice(0, 5));
      setCreatorProfile((current) => {
        if (!current || current.recordId !== creatorProfile.recordId) return current;
        return {
          ...current,
          collaborationStatus: pendingProfileAction.fields.collaborationStatus || current.collaborationStatus,
          hasReply: pendingProfileAction.fields.hasReply || current.hasReply,
        };
      });
      setProfileActionMessage(`已写回飞书：${pendingProfileAction.label}`);
      setPendingProfileAction(null);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '写回飞书失败。';
      const log = buildProfileWriteLog(
        creatorProfile,
        pendingProfileAction,
        mapping,
        'failed',
        errorMessage,
      );
      appendLog(log);
      setProfileActionLogs((current) => [log, ...current].slice(0, 5));
      setProfileActionMessage(`写回失败：${errorMessage}`);
    } finally {
      setProfileActionLoading(false);
    }
  };

  const requestTranslation = async (text: string) => {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        sourceLang: detectLanguage(text),
        customPrompt: settings.translatePrompt || '',
        modelProvider: settings.modelProvider || 'builtin',
        customApiUrl: settings.customApiUrl || '',
        customModelName: settings.customModelName || '',
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || '翻译失败');
    }

    return {
      translatedText: String(result.data.translatedText || '').trim(),
      sourceLang: String(result.data.sourceLang || 'auto'),
    };
  };

  const handleTranslateLegacy = async (message: GmailMessage) => {
    if (showingTranslationIds.has(message.id)) {
      setShowingTranslationIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
      return;
    }

    if (getTranslation(message.id)) {
      setShowingTranslationIds((current) => new Set(current).add(message.id));
      return;
    }

    setTranslatingIds(prev => new Set(prev).add(message.id));
    setTranslateErrors(prev => { const next = { ...prev }; delete next[message.id]; return next; });
    setTranslationProgress(prev => ({ ...prev, [message.id]: '正在优先翻译当前这封邮件...' }));
    
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message.body,
          sourceLang: detectLanguage(message.body),
          customPrompt: settings.translatePrompt || '',
          modelProvider: settings.modelProvider || 'builtin',
          customApiUrl: settings.customApiUrl || '',
          customModelName: settings.customModelName || '',
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || '翻译失败');
      }

      addTranslation({
        messageId: message.id,
        originalText: message.body,
        translatedText: result.data.translatedText,
        sourceLang: result.data.sourceLang,
        targetLang: 'zh',
      });
      setShowingTranslationIds((current) => new Set(current).add(message.id));
    } catch (error) {
      const msg = error instanceof Error ? error.message : '翻译失败，请稍后重试';
      setTranslateErrors(prev => ({ ...prev, [message.id]: msg }));
    } finally {
      setTranslatingIds(prev => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });
    }
  };

  // 语言检测
  const detectLanguage = (text: string): string => {
    if (/[\u4e00-\u9fa5]/.test(text)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';
    return 'en';
  };

  void handleTranslateLegacy;

  const handleTranslate = async (message: GmailMessage) => {
    if (showingTranslationIds.has(message.id)) {
      setShowingTranslationIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
      return;
    }

    if (getTranslation(message.id)) {
      setShowingTranslationIds((current) => new Set(current).add(message.id));
      return;
    }

    setTranslatingIds((current) => new Set(current).add(message.id));
    setTranslateErrors((current) => {
      const next = { ...current };
      delete next[message.id];
      return next;
    });
    setTranslationProgress((current) => ({
      ...current,
      [message.id]: '正在优先翻译当前这封邮件...',
    }));

    try {
      const originalText = repairTextEncoding(message.body);
      const { currentText, quotedText } = splitEmailForTranslation(originalText);
      if (!currentText) throw new Error('这封邮件没有可翻译的正文。');

      const currentResult = await requestTranslation(currentText);
      const hasQuotedHistory = Boolean(quotedText.trim());
      const currentTranslation = hasQuotedHistory
        ? `【当前邮件翻译】\n${currentResult.translatedText}`
        : currentResult.translatedText;

      addTranslation({
        messageId: message.id,
        originalText,
        translatedText: currentTranslation,
        sourceLang: currentResult.sourceLang,
        targetLang: 'zh',
      });
      setShowingTranslationIds((current) => new Set(current).add(message.id));
    } catch (error) {
      setTranslateErrors((current) => ({
        ...current,
        [message.id]: error instanceof Error ? error.message : '翻译失败，请稍后重试',
      }));
    } finally {
      setTranslatingIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
      setTranslationProgress((current) => {
        const next = { ...current };
        delete next[message.id];
        return next;
      });
    }
  };

  const hasQuotedHistory = (message: GmailMessage) => {
    const originalText = repairTextEncoding(message.body);
    return Boolean(splitEmailForTranslation(originalText).quotedText.trim());
  };

  const hasCompletedQuotedTranslation = (translatedText: string) =>
    translatedText.includes('【引用历史翻译】')
    && !translatedText.includes('正在继续翻译邮件引用历史')
    && !translatedText.includes('引用历史暂时翻译失败');

  const handleTranslateQuotedHistory = async (message: GmailMessage) => {
    const existingTranslation = getTranslation(message.id);
    if (!existingTranslation || hasCompletedQuotedTranslation(existingTranslation.translatedText)) return;

    const originalText = repairTextEncoding(message.body);
    const { quotedText } = splitEmailForTranslation(originalText);
    if (!quotedText.trim()) return;

    setTranslatingQuotedIds((current) => new Set(current).add(message.id));
    setTranslateErrors((current) => {
      const next = { ...current };
      delete next[message.id];
      return next;
    });
    setTranslationProgress((current) => ({
      ...current,
      [message.id]: '正在翻译引用历史...',
    }));

    try {
      const quotedResult = await requestTranslation(quotedText);
      const baseTranslation = existingTranslation.translatedText
        .replace(/\n\n---\n【引用历史翻译】\n正在继续翻译邮件引用历史\.\.\.$/, '')
        .replace(/\n\n---\n【引用历史翻译】\n引用历史暂时翻译失败，可以稍后再试。$/, '');

      addTranslation({
        messageId: message.id,
        originalText,
        translatedText: `${baseTranslation}\n\n---\n【引用历史翻译】\n${quotedResult.translatedText}`,
        sourceLang: existingTranslation.sourceLang || quotedResult.sourceLang,
        targetLang: 'zh',
      });
      setShowingTranslationIds((current) => new Set(current).add(message.id));
    } catch (error) {
      setTranslateErrors((current) => ({
        ...current,
        [message.id]: `引用历史翻译失败：${error instanceof Error ? error.message : '请稍后重试'}`,
      }));
    } finally {
      setTranslatingQuotedIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
      setTranslationProgress((current) => {
        const next = { ...current };
        delete next[message.id];
        return next;
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const escapeForwardHeader = (value: string) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const dataUrlToFile = async (attachment: GmailAttachment) => {
    if (!attachment.dataUrl) return null;
    const response = await fetch(attachment.dataUrl);
    const blob = await response.blob();
    return new File([blob], attachment.filename, {
      type: attachment.mimeType || blob.type || 'application/octet-stream',
    });
  };

  const handleForward = async (message: GmailMessage) => {
    setMessageActionError(null);
    try {
      const originalSubject = message.subject || thread.subject || '无主题';
      const forwardSubject = /^(fwd?|转发):/i.test(originalSubject)
        ? originalSubject
        : `Fwd: ${originalSubject}`;
      const originalBody = message.htmlBody
        ? sanitizeEmailHtml(message.htmlBody)
        : textToEmailHtml(message.body);
      const forwardedHeader = [
        '<br><br>',
        '<div style="border-top:1px solid #dadce0;margin-top:12px;padding-top:12px;color:#5f6368">',
        '<div><strong>---------- Forwarded message ---------</strong></div>',
        `<div><strong>From:</strong> ${escapeForwardHeader(message.from)}</div>`,
        `<div><strong>Date:</strong> ${escapeForwardHeader(formatDate(message.date))}</div>`,
        `<div><strong>Subject:</strong> ${escapeForwardHeader(originalSubject)}</div>`,
        `<div><strong>To:</strong> ${escapeForwardHeader(message.to)}</div>`,
        '</div>',
        '<br>',
        originalBody,
      ].join('');
      const attachmentFiles = (await Promise.all(
        (message.attachments || [])
          .filter((attachment) => !attachment.inline)
          .map(dataUrlToFile),
      )).filter((file): file is File => Boolean(file));

      setForwardDraft({
        subject: forwardSubject,
        content: forwardedHeader,
        attachments: attachmentFiles,
      });
    } catch (error) {
      setMessageActionError(
        error instanceof Error ? error.message : '准备转发邮件失败，请稍后重试。',
      );
    }
  };

  const sanitizeEmailHtml = (html: string) => {
    if (typeof window === 'undefined') return '';

    const documentNode = new DOMParser().parseFromString(html, 'text/html');
    documentNode
      .querySelectorAll('script, iframe, object, embed, form, input, button, meta, base')
      .forEach((element) => element.remove());

    documentNode.querySelectorAll<HTMLElement>('*').forEach((element) => {
      Array.from(element.attributes).forEach((attribute) => {
        if (attribute.name.toLowerCase().startsWith('on')) {
          element.removeAttribute(attribute.name);
        }
      });

      const style = element.getAttribute('style');
      if (style) {
        element.setAttribute(
          'style',
          style
            .replace(/position\s*:\s*(fixed|sticky)/gi, 'position: static')
            .replace(/z-index\s*:[^;]+;?/gi, ''),
        );
      }
    });

    documentNode.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (!/^(https?:|mailto:)/i.test(href)) {
        link.removeAttribute('href');
      } else {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
    });

    documentNode.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      const source = image.getAttribute('src') || '';
      if (!/^(https?:|data:image\/|blob:)/i.test(source)) {
        image.remove();
        return;
      }
      image.loading = 'lazy';
      image.referrerPolicy = 'no-referrer';
      image.style.maxWidth = '100%';
      image.style.height = 'auto';
    });

    return documentNode.body.innerHTML;
  };

  return (
    <div className="material-reading flex h-full min-h-0 flex-col overflow-hidden">
      {/* 头部 */}
      <div className="material-toolbar flex items-center justify-between border-b border-border/55 px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="h-9 w-9 rounded-lg hover:bg-white/70"
            aria-label="返回邮件目录"
            title="返回邮件目录"
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{thread.subject || '(无主题)'}</h2>
            <p className="text-xs text-muted-foreground">
              {thread.messages.length} 封邮件 · {thread.participantCount} 位参与者
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-lg hover:bg-white/70"
            title="AI 辅助回复"
            onClick={() => {
              setReplyMode('ai');
              setComposerState('expanded');
            }}
          >
            <Sparkles className="w-4 h-4 text-primary" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-white/70">
            <Reply className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-white/70">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 飞书红人资料 */}
      {(creatorProfileLoading || creatorProfile || creatorProfileError) && (
        <div className="material-toolbar shrink-0 border-b border-border/55 px-4 py-3">
          {creatorProfileLoading ? (
            <div className="glass-control flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              正在匹配飞书红人资料...
            </div>
          ) : creatorProfile ? (
            <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-white/82 px-3 py-2 shadow-[var(--glass-shadow-soft)]">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <div className="flex min-w-[180px] items-center gap-2 font-medium">
                  <YouTubeChannelAvatar
                    avatar={channelAvatar}
                    label={channelAvatar.title || creatorProfile.channelName || 'YouTube 频道头像'}
                    size="sm"
                  />
                  <span className="truncate">{creatorProfile.channelName}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  地区：<span className="text-foreground">{creatorProfile.region}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  平台：<span className="text-foreground">{creatorProfile.platform}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  粉丝数：<span className="text-foreground">{creatorProfile.followers}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  邮箱：<span className="text-foreground">{creatorProfile.email}</span>
                </span>
                <Badge variant="secondary" className="h-5 rounded-md bg-white/80 px-2 text-[11px]">
                  {creatorProfile.collaborationStatus}
                </Badge>
                <Badge variant="outline" className="h-5 rounded-md border-white/65 bg-white/50 px-2 text-[11px]">
                  {creatorProfile.hasReply}
                </Badge>
              </div>

              {feishuQuickActions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {feishuQuickActions.map((action) => (
                    <Button
                      key={action.id}
                      variant={pendingProfileAction?.id === action.id ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 rounded-lg px-2 text-xs"
                      disabled={profileActionLoading}
                      onClick={() => {
                        setPendingProfileAction(action);
                        setProfileActionMessage('');
                      }}
                    >
                      <Database className="mr-1.5 h-3.5 w-3.5" />
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}

              {pendingProfileAction && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">准备写回飞书：{pendingProfileAction.label}</p>
                      <p className="mt-1 text-muted-foreground">{pendingProfileAction.description}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(Object.entries(pendingProfileAction.fields) as Array<[FeishuFieldKey, string]>).map(([fieldKey, value]) => (
                          <span key={fieldKey} className="rounded-md bg-white/80 px-2 py-1">
                            {getQuickFieldLabel(fieldKey)} → {value}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        className="h-8 rounded-lg px-2 text-xs"
                        disabled={profileActionLoading}
                        onClick={() => void executeProfileAction()}
                      >
                        {profileActionLoading ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        确认写回
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg px-2 text-xs"
                        disabled={profileActionLoading}
                        onClick={() => setPendingProfileAction(null)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {(profileActionMessage || profileActionLogs.length > 0) && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {profileActionMessage && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-white/75 px-2 py-1">
                      {profileActionMessage.startsWith('写回失败') ? (
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      )}
                      {profileActionMessage}
                    </span>
                  )}
                  {profileActionLogs.slice(0, 3).map((log) => (
                    <span key={log.id} className="rounded-md border border-white/65 bg-white/55 px-2 py-1 text-muted-foreground">
                      {log.status === 'synced' ? '成功' : '失败'} · {log.event.summary}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-700">
              <Database className="h-3.5 w-3.5" />
              {creatorProfileError}
            </div>
          )}
        </div>
      )}

      {messageActionError && (
        <div className="shrink-0 border-b border-destructive/15 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {messageActionError}
        </div>
      )}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-4">
          {displayMessages.map((message, index) => {
            const sender = getDisplayEmail(message.from);
            const translation = getTranslation(message.id);
            const isExpanded = expandedMessages.has(message.id);
            const isNewest = index === 0;
            const visibleAttachments = (message.attachments || []).filter(
              (attachment) => !attachment.inline,
            );
            const displayBody = repairTextEncoding(message.body);
            const displayHtmlBody = message.htmlBody ? repairTextEncoding(message.htmlBody) : '';
            const isCreatorSender = creatorProfile
              ? normalizeEmail(sender.email) === normalizeEmail(creatorProfile.email)
              : false;
            const senderAvatar = isCreatorSender ? channelAvatar : { status: 'idle' as const };

            return (
              <div key={message.id} className="space-y-3">
                {/* 邮件头 */}
                <div
                  className={`
                    cursor-pointer rounded-xl border p-4 shadow-[var(--glass-shadow-soft)] transition-[background-color,border-color,box-shadow] duration-200
                    ${isNewest ? 'border-primary/22 bg-primary/[0.045]' : 'border-border/55 bg-white/92'}
                  `}
                  onClick={() => toggleMessage(message.id)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      {/* 头像 */}
                      <YouTubeChannelAvatar
                        avatar={senderAvatar}
                        fallback={sender.name}
                        label={isCreatorSender
                          ? channelAvatar.title || creatorProfile?.channelName || sender.name
                          : sender.name}
                      />
                      
                      {/* 发件人信息 */}
                      <div className="min-w-0">
                        <div className="mb-0.5 flex items-center gap-2">
                          <span className="font-medium">{sender.name}</span>
                          <span className="text-xs text-muted-foreground">&lt;{sender.email}&gt;</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(message.date)}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-lg hover:bg-white/70"
                        title="转发这封邮件"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleForward(message);
                        }}
                      >
                        <Forward className="h-4 w-4" />
                        <span className="sr-only">转发这封邮件</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-lg hover:bg-white/70"
                        title={message.isRead ? '\u6807\u8bb0\u4e3a\u672a\u8bfb' : '\u6807\u8bb0\u4e3a\u5df2\u8bfb'}
                        disabled={changingReadStateId !== null}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMessageReadState(message);
                        }}
                      >
                        {changingReadStateId === message.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : message.isRead ? (
                          <Mail className="h-4 w-4" />
                        ) : (
                          <MailOpen className="h-4 w-4 text-primary" />
                        )}
                        <span className="sr-only">
                          {message.isRead ? '\u6807\u8bb0\u4e3a\u672a\u8bfb' : '\u6807\u8bb0\u4e3a\u5df2\u8bfb'}
                        </span>
                      </Button>
                      {message.hasAttachments && (
                        <Badge variant="secondary" className="rounded-md bg-white/80 text-xs">有附件</Badge>
                      )}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-9 w-9 rounded-lg hover:bg-white/70"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTranslate(message);
                        }}
                        disabled={translatingIds.has(message.id)}
                        title={showingTranslationIds.has(message.id) ? '显示原文' : '翻译成中文'}
                      >
                        {translatingIds.has(message.id) ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : showingTranslationIds.has(message.id) ? (
                          <Languages className="h-4 w-4 text-primary" />
                        ) : (
                          <Globe className="h-4 w-4" />
                        )}
                      </Button>
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </div>
                  </div>

                  {/* 展开的邮件内容 */}
                  {isExpanded && (
                    <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-xs">
                          {showingTranslationIds.has(message.id) ? '中文翻译' : '原文'}
                        </Badge>
                      </div>

                      {showingTranslationIds.has(message.id) && translation ? (
                        <div className="prose prose-sm max-w-none">
                          <pre className="max-w-full whitespace-pre-wrap break-words rounded-lg border border-blue-100 bg-blue-50/80 p-4 font-sans text-sm">
                            {translation.translatedText}
                          </pre>
                          {translationProgress[message.id] && (
                            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              {translationProgress[message.id]}
                            </p>
                          )}
                          {hasQuotedHistory(message) && !hasCompletedQuotedTranslation(translation.translatedText) && (
                            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-white/70 px-3 py-2">
                              <p className="text-xs text-muted-foreground">
                                检测到这封邮件包含引用历史，默认先翻译当前邮件。
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 shrink-0 rounded-lg bg-white"
                                disabled={translatingQuotedIds.has(message.id)}
                                onClick={() => handleTranslateQuotedHistory(message)}
                              >
                                {translatingQuotedIds.has(message.id) ? (
                                  <>
                                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                    翻译中
                                  </>
                                ) : (
                                  '继续翻译引用历史'
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      ) : displayHtmlBody ? (
                        <div
                          className="email-html-content max-w-full overflow-hidden rounded-lg border border-border/55 bg-white p-4 text-sm leading-relaxed shadow-sm"
                          dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(displayHtmlBody) }}
                        />
                      ) : (
                        <div className="prose prose-sm max-w-none">
                          <pre className="max-w-full whitespace-pre-wrap break-words rounded-lg border border-border/55 bg-white p-4 font-sans text-sm leading-relaxed">
                            {displayBody}
                          </pre>
                        </div>
                      )}

                      {visibleAttachments.length > 0 && (
                        <AttachmentList attachments={visibleAttachments} />
                      )}

                      {/* 操作按钮 */}
                      <div className="flex items-center gap-2 pt-2">
                        <Button 
                          size="sm" 
                          variant="outline" 
                          className="h-8 rounded-lg bg-white/75"
                          onClick={() => copyToClipboard(displayBody)}
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          复制
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg bg-white/75"
                          onClick={() => handleTranslate(message)}
                          disabled={translatingIds.has(message.id)}
                        >
                          {translatingIds.has(message.id) ? (
                            <>
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              翻译中...
                            </>
                          ) : (
                            <>
                              <Languages className="mr-1 h-3 w-3" />
                              {showingTranslationIds.has(message.id) ? '恢复原文' : '翻译成中文'}
                            </>
                          )}
                        </Button>
                        {translateErrors[message.id] && (
                          <span className="text-xs text-destructive">{translateErrors[message.id]}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* 底部回复区域 */}
      <div
        className={`shrink-0 ${
          composerState === 'expanded' && replyMode === 'ai'
            ? 'h-[68dvh] min-h-0 overflow-hidden border-t border-gray-300 bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.08)] sm:h-[min(62dvh,640px)]'
            : composerState === 'expanded'
              ? 'material-toolbar max-h-[72%] overflow-y-auto border-t border-border/55 p-4'
              : composerState === 'minimized'
                ? 'border-t border-gray-200 bg-white p-0 shadow-[0_-4px_14px_rgba(15,23,42,0.05)]'
                : 'material-toolbar border-t border-border/55 p-4'
        }`}
      >
        {composerState === 'closed' ? (
          <div className="flex items-center justify-center gap-3">
            <Button 
              variant="outline" 
              className="h-10 flex-1 rounded-lg bg-white/80"
              onClick={() => {
                setReplyMode('compose');
                setComposerState('expanded');
              }}
            >
              <Reply className="w-4 h-4 mr-2" />
              回复
            </Button>
            <Button 
              className="h-10 flex-1 rounded-lg shadow-apple"
              onClick={() => {
                setReplyMode('ai');
                setComposerState('expanded');
              }}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              AI 辅助回复
            </Button>
          </div>
        ) : (
          <>
            {composerState === 'minimized' && replyMode === 'ai' && (
              <div className="flex h-12 items-center gap-3 px-4">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Sparkles className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">AI 邮件助手</p>
                  <p className="truncate text-xs text-muted-foreground">分析和回复内容已保留</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  title="展开 AI 邮件助手"
                  aria-label="展开 AI 邮件助手"
                  onClick={() => setComposerState('expanded')}
                >
                  <Maximize2 />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  title="关闭 AI 邮件助手"
                  aria-label="关闭 AI 邮件助手"
                  onClick={() => setComposerState('closed')}
                >
                  <X />
                </Button>
              </div>
            )}
            <div className={composerState === 'minimized' ? 'hidden' : 'h-full min-h-0'}>
              <EmailComposer
                key={replyMode}
                thread={thread}
                mode={replyMode}
                onMinimize={replyMode === 'ai' ? () => setComposerState('minimized') : undefined}
                onClose={() => setComposerState('closed')}
                initialMessage={replyMode === 'compose' ? savedReplyDraft : undefined}
                onDraftSaved={setSavedReplyDraft}
              />
            </div>
          </>
        )}
      </div>
      <NewEmailComposer
        open={Boolean(forwardDraft)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setForwardDraft(null);
        }}
        title="转发邮件"
        description="填写新的收件人后转发这封邮件"
        initialSubject={forwardDraft?.subject || ''}
        initialContent={forwardDraft?.content || ''}
        initialAttachments={forwardDraft?.attachments || []}
      />
    </div>
  );
}

function AttachmentList({ attachments }: { attachments: GmailAttachment[] }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="w-4 h-4" />
        附件（{attachments.length}）
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {attachments.map((attachment) => (
          <a
            key={`${attachment.id}-${attachment.filename}`}
            href={attachment.dataUrl}
            download={attachment.filename}
            className="flex min-w-0 items-center gap-3 rounded-lg border border-white/65 bg-white/72 p-3 shadow-sm transition-colors hover:bg-white"
          >
            {attachment.mimeType.startsWith('image/') && attachment.dataUrl ? (
              <img
                src={attachment.dataUrl}
                alt={attachment.filename}
                className="h-12 w-12 flex-shrink-0 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white/70">
                <Paperclip className="w-5 h-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{attachment.filename}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(attachment.size)}
              </p>
            </div>
            <Download className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
          </a>
        ))}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (!bytes) return '未知大小';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
