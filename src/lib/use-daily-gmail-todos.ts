'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCreatorResourceProfiles, type CreatorResourceProfile } from '@/lib/creator-resource-profile';
import {
  buildLegacyCompatibleGmailTaskCache,
  findUniqueLegacyGmailTaskMatch,
  getDailyGmailTaskKey,
  isWithinDailyGmailWindow,
  normalizeDailyMailTaskCache,
  resolveIncomingGmailCompletedAt,
} from '@/lib/daily-gmail-todos';
import { useGmailAuth, type AppSettings } from '@/lib/data';
import { normalizeThreadContactEmail } from '@/lib/gmail-thread-contact';
import { useUserDataStore } from '@/components/user-data-provider';
import { USER_DATA_KEYS } from '@/lib/account-data-keys';
import {
  buildChannelAvatarLookup,
  channelAvatarLookupPriority,
  readChannelAvatarCache,
  resolveChannelAvatar,
  type ChannelAvatarState,
} from '@/lib/youtube-channel-avatar';
import { useMailAccounts } from '@/components/mail-account-provider';
import type { MailProvider } from '@/lib/mail-accounts';

type DailyGmailMessage = {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  answeredAt?: string;
  mailAccountId: string;
  provider: MailProvider;
  mailAddress: string;
  folderRef?: string;
  providerMessageRef?: string;
  rfcMessageId?: string;
  inReplyTo?: string;
  references?: string;
};

export type DailyGmailTodo = DailyGmailMessage & {
  channelName: string;
  channelUrl: string;
  summary: string;
  summaryPending: boolean;
  avatar: ChannelAvatarState;
  completed: boolean;
  completedAt?: string;
};

export type DailyMailboxStatus = {
  provider: MailProvider;
  mailAccountId: string;
  mailAddress: string;
  state: 'fresh' | 'cached' | 'error' | 'disconnected';
  loadedCount: number;
  matchedCount: number;
  cacheUpdatedAt?: string;
  error?: string;
};

type StoredDailyGmailTask = Omit<DailyGmailTodo, 'snippet' | 'body' | 'summaryPending' | 'completed'>;

const AUTO_REFRESH_MS = 5 * 60_000;

function taskCacheToItems(cache: Record<string, StoredDailyGmailTask>) {
  return Object.values(normalizeDailyMailTaskCache(cache))
    .filter((task) => Boolean(task.threadId || task.messageId))
    .map((task): DailyGmailTodo => ({
      ...task,
      snippet: '',
      body: '',
      summaryPending: false,
      completed: Boolean(task.completedAt),
    }))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function compactText(value: string) {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/^>.*$/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fallbackSummary(message: DailyGmailMessage) {
  const content = compactText(message.body || message.snippet);
  if (content) return content.length > 72 ? `${content.slice(0, 72)}…` : content;
  return message.subject ? `来信主题：${message.subject}` : '收到一封新的红人来信。';
}

function messageCacheKey(message: Pick<DailyGmailMessage, 'provider' | 'mailAccountId' | 'messageId'>) {
  return `${message.provider}:${message.mailAccountId}:${message.messageId}`;
}

function dailyTaskKey(message: Pick<DailyGmailMessage, 'threadId' | 'messageId' | 'mailAccountId' | 'provider' | 'folderRef' | 'providerMessageRef'>) {
  return getDailyGmailTaskKey(
    message.threadId,
    message.messageId,
    message.mailAccountId,
    message.provider,
    message.folderRef,
    message.providerMessageRef,
  );
}

function senderLabel(value: string) {
  return value.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim()
    || normalizeThreadContactEmail(value)
    || '未命名红人';
}

function selectProfileByEmail(profiles: CreatorResourceProfile[]) {
  const byEmail = new Map<string, CreatorResourceProfile>();
  profiles.forEach((profile) => {
    profile.emails.forEach((email) => {
      const normalizedEmail = normalizeThreadContactEmail(email);
      const current = byEmail.get(normalizedEmail);
      if (!current || channelAvatarLookupPriority(profile) > channelAvatarLookupPriority(current)) {
        byEmail.set(normalizedEmail, profile);
      }
    });
  });
  return byEmail;
}

function initialAvatar(profile: CreatorResourceProfile): ChannelAvatarState {
  const lookup = buildChannelAvatarLookup(profile);
  const cached = lookup ? readChannelAvatarCache(lookup.key) : null;
  if (cached) return { ...cached, title: cached.title || profile.channelName };
  if (lookup) {
    return { status: 'loading', channelUrl: lookup.link, title: profile.channelName, cacheKey: lookup.key };
  }
  if (profile.avatarUrl) {
    return {
      status: 'ready',
      avatarUrl: profile.avatarUrl,
      channelUrl: profile.channelUrl,
      title: profile.channelName,
    };
  }
  return { status: 'failed', title: profile.channelName, error: '飞书记录缺少有效的 YouTube 频道链接。' };
}

export function useDailyGmailTodos(settings: AppSettings, active = true) {
  const { auth, connect } = useGmailAuth();
  const { accounts } = useMailAccounts();
  const { data: accountData, save: saveAccountData } = useUserDataStore();
  const [items, setItems] = useState<DailyGmailTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sourceStatus, setSourceStatus] = useState<DailyMailboxStatus[]>([]);
  const runIdRef = useRef(0);
  const summaryCacheRef = useRef(
    (accountData[USER_DATA_KEYS.DAILY_GMAIL_SUMMARIES] || {}) as Record<string, string>,
  );
  const completionCacheRef = useRef(
    (accountData[USER_DATA_KEYS.DAILY_GMAIL_COMPLETIONS] || {}) as Record<string, string>,
  );
  const legacyTaskCache = useMemo(
    () => (accountData[USER_DATA_KEYS.DAILY_GMAIL_TASKS] || {}) as Record<string, StoredDailyGmailTask>,
    [accountData],
  );
  const versionedTaskCache = useMemo(
    () => (accountData[USER_DATA_KEYS.DAILY_MAIL_TASKS_V3] || {}) as Record<string, StoredDailyGmailTask>,
    [accountData],
  );
  const taskCacheRef = useRef(normalizeDailyMailTaskCache({
    ...legacyTaskCache,
    ...versionedTaskCache,
  }));
  const cacheMigrationCompletedRef = useRef(false);

  const getAccessToken = useCallback(async (force = false) => {
    if (!auth?.isConnected) throw new Error('请先连接 Gmail。');
    if (!force && auth.accessToken && auth.expiresAt && auth.expiresAt > Date.now() + 60_000) {
      return auth.accessToken;
    }
    const response = await fetch(force ? '/api/auth/refresh?force=1' : '/api/auth/refresh', {
      method: 'POST',
    });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) {
      throw new Error(String(result.error || 'Gmail 授权已失效，请重新连接。'));
    }
    connect({
      ...auth,
      isConnected: true,
      email: result.data.email || auth.email,
      accessToken: result.data.accessToken,
      expiresAt: result.data.expiresAt,
    });
    return String(result.data.accessToken);
  }, [auth, connect]);

  const load = useCallback(async (force = false) => {
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    setError('');
    setRefreshing(true);
    try {
      if (!settings.feishuUrl || !settings.feishuFieldMapping?.email) {
        throw new Error('请先在设置中配置红人信息数据库及联系邮箱字段映射。');
      }

      const connectedAccounts = accounts.filter((account) => account.connectionStatus === 'connected');
      const cachedTasksForAccount = (mailAccountId: string) => Object.values(taskCacheRef.current)
        .filter((task) => task.mailAccountId === mailAccountId);
      const disconnectedStatuses: DailyMailboxStatus[] = accounts
        .filter((account) => account.connectionStatus !== 'connected')
        .map((account) => {
          const cached = cachedTasksForAccount(account.mailAccountId);
          return {
            provider: account.provider,
            mailAccountId: account.mailAccountId,
            mailAddress: account.email,
            state: 'disconnected' as const,
            loadedCount: cached.length,
            matchedCount: cached.length,
            error: '邮箱已断开，请重新连接。',
          };
        });
      if (!connectedAccounts.length) {
        setSourceStatus(disconnectedStatuses);
        throw new Error('请先连接至少一个邮箱。');
      }

      const requestAccount = async (mailAccount: (typeof connectedAccounts)[number]) => {
        if (mailAccount.provider === 'gmail') {
          if (!auth?.isConnected || auth.email?.trim().toLowerCase() !== mailAccount.email.trim().toLowerCase()) {
            throw new Error('当前 Gmail 授权不可用，请重新连接。');
          }
          await getAccessToken(force);
          const requestDailyMessages = () => fetch('/api/gmail?action=daily-inbox&maxResults=50', { cache: 'no-store' });
          let response = await requestDailyMessages();
          if (response.status === 401) {
            await getAccessToken(true);
            response = await requestDailyMessages();
          }
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(String(result.error || '读取失败'));
          return (Array.isArray(result.data) ? result.data : []).map((message: Omit<DailyGmailMessage, 'mailAccountId' | 'provider' | 'mailAddress'>) => ({
            ...message,
            mailAccountId: mailAccount.mailAccountId,
            provider: 'gmail' as const,
            mailAddress: mailAccount.email,
          }));
        }

        const params = new URLSearchParams({
          action: 'dailyTodos',
          mailAccountId: mailAccount.mailAccountId,
          hours: '72',
          maxResults: '50',
        });
        const response = await fetch(`/api/mail/tencent?${params.toString()}`, { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(String(result.error || '读取失败'));
        return ((Array.isArray(result.data) ? result.data : []) as Array<Record<string, unknown>>).map((message) => ({
          messageId: String(message.messageId || ''),
          threadId: String(message.threadId || ''),
          from: String(message.from || ''),
          subject: String(message.subject || ''),
          snippet: String(message.snippet || ''),
          body: String(message.body || ''),
          date: String(message.date || ''),
          answeredAt: String(message.answeredAt || '') || undefined,
          mailAccountId: mailAccount.mailAccountId,
          provider: 'tencent_exmail' as const,
          mailAddress: mailAccount.email,
          folderRef: String(message.folderRef || ''),
          providerMessageRef: String(message.providerMessageRef || ''),
          rfcMessageId: String(message.rfcMessageId || '') || undefined,
          inReplyTo: String(message.inReplyTo || '') || undefined,
          references: String(message.references || '') || undefined,
        }));
      };

      const settled = await Promise.allSettled(connectedAccounts.map(requestAccount));
      const sourceErrors: string[] = [];
      const freshMessages: DailyGmailMessage[] = [];
      const connectedStatuses = settled.map((result, index): DailyMailboxStatus => {
        const mailAccount = connectedAccounts[index];
        const cached = cachedTasksForAccount(mailAccount.mailAccountId);
        if (result.status === 'fulfilled') {
          freshMessages.push(...result.value);
          return {
            provider: mailAccount.provider,
            mailAccountId: mailAccount.mailAccountId,
            mailAddress: mailAccount.email,
            state: 'fresh',
            loadedCount: result.value.length,
            matchedCount: 0,
          };
        }
        const reason = result.reason instanceof Error ? result.reason.message : '读取失败';
        const label = mailAccount.provider === 'tencent_exmail' ? '腾讯企业邮箱' : 'Gmail';
        sourceErrors.push(`${label}（${mailAccount.email}）：${reason}`);
        return {
          provider: mailAccount.provider,
          mailAccountId: mailAccount.mailAccountId,
          mailAddress: mailAccount.email,
          state: cached.length ? 'cached' : 'error',
          loadedCount: cached.length,
          matchedCount: cached.length,
          error: reason,
        };
      });
      const initialStatuses = [...connectedStatuses, ...disconnectedStatuses];
      if (!settled.some((result) => result.status === 'fulfilled')) {
        setSourceStatus(initialStatuses);
        setItems(taskCacheToItems(taskCacheRef.current));
        setLoading(false);
        setRefreshing(false);
        setError(sourceErrors.join('；'));
        return;
      }
      const now = Date.now();
      const messages = freshMessages
        .filter((message: DailyGmailMessage) => isWithinDailyGmailWindow(message.date, now)) as DailyGmailMessage[];
      let profiles: CreatorResourceProfile[];
      try {
        profiles = await loadCreatorResourceProfiles(settings);
      } catch (profileError) {
        const profileMessage = profileError instanceof Error ? profileError.message : '读取红人资料失败。';
        setSourceStatus(initialStatuses);
        setItems(taskCacheToItems(taskCacheRef.current));
        setLoading(false);
        setRefreshing(false);
        setError([...sourceErrors, `红人资料匹配失败：${profileMessage}`].join('；'));
        return;
      }
      if (runId !== runIdRef.current) return;
      const profileByEmail = selectProfileByEmail(profiles);
      const summaryCache = summaryCacheRef.current;
      const completionCache = completionCacheRef.current;
      const matched = messages.flatMap((message) => {
        const profile = profileByEmail.get(normalizeThreadContactEmail(message.from));
        if (!profile) return [];
        const allowLegacyGmailCache = message.provider === 'gmail'
          && auth?.email?.trim().toLowerCase() === message.mailAddress.trim().toLowerCase();
        const scopedSummary = summaryCache[messageCacheKey(message)];
        const legacySummary = allowLegacyGmailCache ? summaryCache[message.messageId] : '';
        return [{
          ...message,
          channelName: profile.channelName || senderLabel(message.from),
          channelUrl: profile.channelUrl,
          summary: scopedSummary || legacySummary || fallbackSummary(message),
          summaryPending: !scopedSummary && !legacySummary,
          avatar: initialAvatar(profile),
          profile,
        }];
      });
      setSourceStatus(initialStatuses.map((status) => status.state === 'fresh'
        ? {
            ...status,
            matchedCount: matched.filter((item) => item.mailAccountId === status.mailAccountId).length,
          }
        : status));

      const retainedEntries = Object.entries(normalizeDailyMailTaskCache(taskCacheRef.current)).filter(([, task]) => (
        Boolean(task.completedAt) || isWithinDailyGmailWindow(task.date, now)
      ));
      const nextTaskCache: Record<string, StoredDailyGmailTask> = {};
      const unscopedLegacyEntries: Array<[string, StoredDailyGmailTask]> = [];
      retainedEntries.forEach(([storedKey, task]) => {
        if (!task.provider || !task.mailAccountId || !task.mailAddress) {
          unscopedLegacyEntries.push([storedKey, task]);
          return;
        }
        const key = dailyTaskKey(task);
        const existing = nextTaskCache[key];
        nextTaskCache[key] = !existing || Date.parse(task.date) >= Date.parse(existing.date)
          ? { ...task, completedAt: task.completedAt || existing?.completedAt }
          : { ...existing, completedAt: existing.completedAt || task.completedAt };
      });

      const migratedLegacyByTaskKey = new Map<string, StoredDailyGmailTask>();
      unscopedLegacyEntries.forEach(([storedKey, legacyTask]) => {
        const candidate = findUniqueLegacyGmailTaskMatch(legacyTask, matched);
        if (!candidate) {
          nextTaskCache[storedKey] = legacyTask;
          return;
        }
        const taskKey = dailyTaskKey(candidate);
        const current = migratedLegacyByTaskKey.get(taskKey);
        if (!current || Date.parse(legacyTask.date) >= Date.parse(current.date)) {
          migratedLegacyByTaskKey.set(taskKey, legacyTask);
        }
      });

      const pendingSummaryKeys = new Set<string>();
      matched.forEach((item) => {
        const taskKey = dailyTaskKey(item);
        const allowLegacyGmailCache = item.provider === 'gmail'
          && auth?.email?.trim().toLowerCase() === item.mailAddress.trim().toLowerCase();
        const sourcefulExisting = nextTaskCache[taskKey];
        const migratedLegacy = migratedLegacyByTaskKey.get(taskKey);
        const existing = sourcefulExisting && migratedLegacy
          ? {
              ...sourcefulExisting,
              completedAt: sourcefulExisting.completedAt || migratedLegacy.completedAt,
            }
          : sourcefulExisting || migratedLegacy;
        if (existing && Date.parse(existing.date) > Date.parse(item.date)) return;
        const completedAt = resolveIncomingGmailCompletedAt(
          existing,
          item,
          completionCache[messageCacheKey(item)]
            || (allowLegacyGmailCache ? completionCache[item.messageId] : undefined),
        );
        nextTaskCache[taskKey] = {
          messageId: item.messageId,
          threadId: item.threadId,
          mailAccountId: item.mailAccountId,
          provider: item.provider,
          mailAddress: item.mailAddress,
          folderRef: item.folderRef,
          providerMessageRef: item.providerMessageRef,
          rfcMessageId: item.rfcMessageId,
          inReplyTo: item.inReplyTo,
          references: item.references,
          from: item.from,
          subject: item.subject,
          date: item.date,
          channelName: item.channelName,
          channelUrl: item.channelUrl,
          summary: item.summary,
          avatar: item.avatar,
          answeredAt: item.answeredAt,
          completedAt,
        };
        if (item.summaryPending) pendingSummaryKeys.add(messageCacheKey(item));
      });
      taskCacheRef.current = nextTaskCache;
      saveAccountData(USER_DATA_KEYS.DAILY_MAIL_TASKS_V3, nextTaskCache);
      setItems(taskCacheToItems(nextTaskCache).map((item) => ({
        ...item,
        summaryPending: pendingSummaryKeys.has(messageCacheKey(item)),
      })));
      setLoading(false);
      setRefreshing(false);
      setError(sourceErrors.join('；'));

      const pendingSummaries = matched.filter((item) => {
        const allowLegacyGmailCache = item.provider === 'gmail'
          && auth?.email?.trim().toLowerCase() === item.mailAddress.trim().toLowerCase();
        return !summaryCache[messageCacheKey(item)]
          && !(allowLegacyGmailCache && summaryCache[item.messageId]);
      });
      const summaryRequest = pendingSummaries.length
        ? fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'dailyGmailSummaries',
              emails: pendingSummaries.map((item) => ({
                id: messageCacheKey(item),
                subject: item.subject,
                body: item.body || item.snippet,
              })),
              modelProvider: settings.modelProvider || 'builtin',
              customApiUrl: settings.customApiUrl || '',
              customModelName: settings.customModelName || '',
            }),
          })
            .then(async (response) => {
              const result = await response.json();
              if (!response.ok || !result.success) return new Map<string, string>();
              return new Map<string, string>(
                (result.data?.summaries || []).map((item: { id: string; summary: string }) => [item.id, item.summary]),
              );
            })
            .catch(() => new Map<string, string>())
        : Promise.resolve(new Map<string, string>());

      const avatarRequest = Promise.all(matched.map(async (item) => {
        if (item.avatar.status !== 'loading') return [messageCacheKey(item), item.avatar] as const;
        const lookup = buildChannelAvatarLookup(item.profile);
        if (!lookup) return [messageCacheKey(item), item.avatar] as const;
        const avatar = await resolveChannelAvatar(lookup, {
          regionCode: settings.youtubeDefaultRegion || '',
          relevanceLanguage: settings.youtubeDefaultLanguage || '',
        });
        return [messageCacheKey(item), { ...avatar, title: avatar.title || item.channelName }] as const;
      }));

      const [summaries, avatars] = await Promise.all([summaryRequest, avatarRequest]);
      if (runId !== runIdRef.current) return;
      summaries.forEach((summary, id) => {
        summaryCache[id] = summary;
      });
      if (summaries.size) {
        summaryCacheRef.current = summaryCache;
        saveAccountData(USER_DATA_KEYS.DAILY_GMAIL_SUMMARIES, summaryCache);
      }
      const avatarByMessage = new Map(avatars);
      const updatedTaskCache = { ...taskCacheRef.current };
      Object.entries(updatedTaskCache).forEach(([taskKey, task]) => {
        const summary = summaries.get(messageCacheKey(task));
        const avatar = avatarByMessage.get(messageCacheKey(task));
        if (!summary && !avatar) return;
        updatedTaskCache[taskKey] = {
          ...task,
          summary: summary || task.summary,
          avatar: avatar || task.avatar,
        };
      });
      taskCacheRef.current = updatedTaskCache;
      saveAccountData(USER_DATA_KEYS.DAILY_MAIL_TASKS_V3, updatedTaskCache);
      setItems((current) => current.map((item) => ({
        ...item,
        summary: summaries.get(messageCacheKey(item)) || item.summary,
        summaryPending: false,
        avatar: avatarByMessage.get(messageCacheKey(item)) || item.avatar,
      })));
    } catch (caughtError) {
      if (runId !== runIdRef.current) return;
      setError(caughtError instanceof Error ? caughtError.message : '读取近 72 小时 Gmail 来信失败。');
      setLoading(false);
      setRefreshing(false);
    }
  }, [accounts, auth?.email, auth?.isConnected, getAccessToken, saveAccountData, settings]);

  useEffect(() => {
    if (cacheMigrationCompletedRef.current) return;
    cacheMigrationCompletedRef.current = true;

    const normalized = normalizeDailyMailTaskCache({
      ...legacyTaskCache,
      ...versionedTaskCache,
    });
    const legacyCompatible = buildLegacyCompatibleGmailTaskCache(normalized);
    taskCacheRef.current = normalized;

    if (JSON.stringify(versionedTaskCache) !== JSON.stringify(normalized)) {
      saveAccountData(USER_DATA_KEYS.DAILY_MAIL_TASKS_V3, normalized);
    }
    if (JSON.stringify(legacyTaskCache) !== JSON.stringify(legacyCompatible)) {
      saveAccountData(USER_DATA_KEYS.DAILY_GMAIL_TASKS, legacyCompatible);
    }
  }, [legacyTaskCache, saveAccountData, versionedTaskCache]);

  useEffect(() => {
    if (!active) {
      runIdRef.current += 1;
      setRefreshing(false);
      return;
    }
    const cachedTasks = taskCacheRef.current;
    setItems(taskCacheToItems(cachedTasks));
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, AUTO_REFRESH_MS);
    return () => {
      runIdRef.current += 1;
      window.clearInterval(timer);
    };
  }, [active, load]);

  const toggleCompleted = useCallback((taskId: string) => {
    const task = taskCacheRef.current[taskId];
    if (!task) return;
    const completed = !Boolean(task.completedAt);
    const completedAt = completed ? new Date().toISOString() : undefined;
    const updatedTask = { ...task, completedAt };
    taskCacheRef.current = { ...taskCacheRef.current, [taskId]: updatedTask };
    saveAccountData(USER_DATA_KEYS.DAILY_MAIL_TASKS_V3, taskCacheRef.current);
    setItems((current) => current.map((item) => (
      dailyTaskKey(item) === taskId
        ? { ...item, completed, completedAt }
        : item
    )));
  }, [saveAccountData]);

  return {
    items,
    loading,
    refreshing,
    error,
    sourceStatus,
    refresh: () => load(true),
    toggleCompleted,
  };
}
