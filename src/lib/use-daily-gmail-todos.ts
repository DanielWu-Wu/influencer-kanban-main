'use client';

import { sharedMailFetch as fetch } from '@/lib/shared-mail-read';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadCreatorResourceProfiles, type CreatorResourceProfile } from '@/lib/creator-resource-profile';
import {
  DAILY_MAIL_AUTO_REFRESH_MS,
  buildLegacyCompatibleGmailTaskCache,
  findUniqueLegacyGmailTaskMatch,
  getDailyGmailTaskKey,
  isWithinDailyGmailWindow,
  normalizeDailyMailTaskCache,
  resolveIncomingGmailCompletedAt,
  shouldRefreshDailyMail,
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
import { readSharedGmailDaily, readSharedTencentBody, SharedMailReadError } from '@/lib/shared-mail-workflows';
import {
  selectDailyMailTranslationPrefetchCandidates,
  type MailTranslationPrefetchCandidate,
} from '@/lib/gmail-translation-prefetch';

type DailyGmailMessage = {
  mailboxVersion?: string;
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
  const [translationCandidates, setTranslationCandidates] = useState<MailTranslationPrefetchCandidate[]>([]);
  const [messageSnapshots, setMessageSnapshots] = useState<MailTranslationPrefetchCandidate[]>([]);
  const runIdRef = useRef(0);
  const loadInFlightRef = useRef<{ scope: string; request: Promise<void> } | null>(null);
  const lastSuccessfulRefreshAtRef = useRef(0);
  const lastSuccessfulRefreshScopeRef = useRef('');
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
  const loadScope = [
    auth?.isConnected ? auth.email?.trim().toLowerCase() : 'gmail-disconnected',
    accounts
      .map((account) => [
        account.provider,
        account.mailAccountId,
        account.email.trim().toLowerCase(),
        account.connectionStatus,
      ].join(':'))
      .sort()
      .join(','),
    settings.feishuUrl?.trim() || '',
    JSON.stringify(settings.feishuFieldMapping || {}),
  ].join('|');
  const connectedMailAccountIds = useMemo(
    () => new Set(accounts
      .filter((mailAccount) => mailAccount.connectionStatus === 'connected')
      .map((mailAccount) => mailAccount.mailAccountId)),
    [accounts],
  );

  useEffect(() => {
    setMessageSnapshots((current) => current.filter((message) => connectedMailAccountIds.has(message.mailAccountId)));
    setTranslationCandidates((current) => current.filter((candidate) => (
      connectedMailAccountIds.has(candidate.mailAccountId)
    )));
  }, [connectedMailAccountIds]);

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

  const load = useCallback((force = false, silent = false) => {
    if (
      !force
      && lastSuccessfulRefreshScopeRef.current === loadScope
      && !shouldRefreshDailyMail(lastSuccessfulRefreshAtRef.current)
    ) {
      return Promise.resolve();
    }

    const currentLoad = loadInFlightRef.current;
    if (currentLoad?.scope === loadScope) {
      if (!silent) setRefreshing(true);
      return currentLoad.request.finally(() => {
        if (!silent) setRefreshing(false);
      });
    }
    if (currentLoad) {
      runIdRef.current += 1;
      loadInFlightRef.current = null;
    }

    const request = (async () => {
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      setError('');
      if (!silent) setRefreshing(true);
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
          let messages;
          try { messages = await readSharedGmailDaily(force); }
          catch (error) {
            if (!(error instanceof SharedMailReadError) || error.status !== 401) throw error;
            await getAccessToken(true);
            messages = await readSharedGmailDaily(true);
          }
          return messages.map((message) => ({
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
          metadataOnly: '1',
        });
        const url = `/api/mail/tencent?${params.toString()}`;
        let response: Response;
        try {
          response = await fetch(url, { cache: 'no-store' });
        } catch (firstError) {
          const message = firstError instanceof Error ? firstError.message : '';
          if (!/failed to fetch|networkerror|load failed/i.test(message)) throw firstError;
          if (!navigator.onLine) throw new Error('网络暂时中断，恢复联网后会重新检查腾讯邮箱。');
          await new Promise<void>((resolve) => window.setTimeout(resolve, 1500));
          try {
            response = await fetch(url, { cache: 'no-store' });
          } catch (retryError) {
            throw new Error('腾讯邮箱连接暂时失败，系统会在下次检查时重试。', { cause: retryError });
          }
        }
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
          mailboxVersion: String(message.mailboxVersion || '') || undefined,
          rfcMessageId: String(message.rfcMessageId || '') || undefined,
          inReplyTo: String(message.inReplyTo || '') || undefined,
          references: String(message.references || '') || undefined,
        }));
      };

      const settled = await Promise.allSettled(connectedAccounts.map(requestAccount));
      if (runId !== runIdRef.current) return;
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
      // Only matched creators need complete bodies; summary/header text is never a translation body.
      const bodyResults: PromiseSettledResult<DailyGmailMessage>[] = new Array(messages.length);
      const indicesByAccount = new Map<string, number[]>();
      messages.forEach((message, index) => {
        const key = JSON.stringify([message.provider, message.mailAccountId]);
        const indices = indicesByAccount.get(key) || [];
        indices.push(index);
        indicesByAccount.set(key, indices);
      });
      await Promise.all([...indicesByAccount.values()].map(async (indices) => {
        // Different mailboxes keep progressing independently.
        for (let offset = 0; offset < indices.length; offset += 4) {
          if (runId !== runIdRef.current) return;
          const batch = indices.slice(offset, offset + 4);
          const results = await Promise.allSettled(batch.map(async (index) => {
            const message = messages[index];
            if (message.provider === 'tencent_exmail' && profileByEmail.has(normalizeThreadContactEmail(message.from))) {
              const body = await readSharedTencentBody(message.mailAccountId, message);
              return { ...message, body, snippet: body.replace(/\s+/g, ' ').trim().slice(0, 240) };
            }
            return message;
          }));
          results.forEach((result, index) => { bodyResults[batch[index]] = result; });
        }
      }));
      if (runId !== runIdRef.current) return;
      const failedBodyAccounts = new Set<string>();
      bodyResults.forEach((result, index) => {
        if (result.status === 'fulfilled') messages[index] = result.value;
        else {
          failedBodyAccounts.add(messages[index].mailAccountId);
          sourceErrors.push(result.reason instanceof Error ? result.reason.message : '部分完整正文读取失败');
        }
      });
      initialStatuses.forEach((status) => {
        if (failedBodyAccounts.has(status.mailAccountId)) {
          status.state = 'cached';
          status.error = '部分完整正文读取失败，本邮箱保留上次待办结果，请重试。';
        }
      });
      const summaryCache = summaryCacheRef.current;
      const completionCache = completionCacheRef.current;
      const matched = messages.flatMap((message) => {
        if (failedBodyAccounts.has(message.mailAccountId)) return [];
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
      const candidateSnapshots = matched.map((item) => ({
          provider: item.provider,
          mailAccountId: item.mailAccountId,
          mailAddress: item.mailAddress,
          messageId: item.messageId,
          threadId: item.threadId,
          from: item.from,
          subject: item.subject,
          body: item.body,
          date: item.date,
          folderRef: item.folderRef,
          providerMessageRef: item.providerMessageRef,
          rfcMessageId: item.rfcMessageId,
          inReplyTo: item.inReplyTo,
          references: item.references,
          answeredAt: item.answeredAt,
          completedAt: nextTaskCache[dailyTaskKey(item)]?.completedAt,
        }));
      const freshTranslationCandidates = selectDailyMailTranslationPrefetchCandidates(
        candidateSnapshots,
        { includeCompleted: true },
      );
      setMessageSnapshots(candidateSnapshots);
      setTranslationCandidates(freshTranslationCandidates);
      saveAccountData(USER_DATA_KEYS.DAILY_MAIL_TASKS_V3, nextTaskCache);
      setItems(taskCacheToItems(nextTaskCache).map((item) => ({
        ...item,
        summaryPending: pendingSummaryKeys.has(messageCacheKey(item)),
      })));
      if (!sourceErrors.length) {
        lastSuccessfulRefreshAtRef.current = Date.now();
        lastSuccessfulRefreshScopeRef.current = loadScope;
      }
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
    })();

    loadInFlightRef.current = { scope: loadScope, request };
    return request.finally(() => {
      if (loadInFlightRef.current?.request === request) loadInFlightRef.current = null;
      if (!silent) setRefreshing(false);
    });
  }, [accounts, auth?.email, auth?.isConnected, getAccessToken, loadScope, saveAccountData, settings]);

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
      setMessageSnapshots([]);
      setTranslationCandidates([]);
      const cachedItems = taskCacheToItems(taskCacheRef.current);
      setItems(cachedItems);
      setLoading(cachedItems.length === 0);
      runIdRef.current += 1;
      loadInFlightRef.current = null;
      lastSuccessfulRefreshAtRef.current = 0;
      lastSuccessfulRefreshScopeRef.current = '';
      setRefreshing(false);
      return;
    }
    const cachedTasks = taskCacheRef.current;
    const cachedItems = taskCacheToItems(cachedTasks);
    setItems(cachedItems);
    setLoading(cachedItems.length === 0);
    const refreshInBackgroundIfNeeded = () => {
      if (document.visibilityState !== 'visible') return;
      void load(false, true);
    };
    refreshInBackgroundIfNeeded();
    const timer = window.setInterval(refreshInBackgroundIfNeeded, DAILY_MAIL_AUTO_REFRESH_MS);
    const refreshWhenOnline = () => { void load(true, true); };
    window.addEventListener('online', refreshWhenOnline);
    document.addEventListener('visibilitychange', refreshInBackgroundIfNeeded);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', refreshWhenOnline);
      document.removeEventListener('visibilitychange', refreshInBackgroundIfNeeded);
    };
  }, [active, load]);

  useEffect(() => () => {
    runIdRef.current += 1;
    loadInFlightRef.current = null;
  }, []);

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
    translationCandidates,
    messageSnapshots,
    refresh: () => load(true),
    toggleCompleted,
  };
}
