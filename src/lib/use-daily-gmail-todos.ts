'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCreatorResourceProfiles, type CreatorResourceProfile } from '@/lib/creator-resource-profile';
import {
  getDailyGmailTaskKey,
  isWithinDailyGmailWindow,
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

type DailyGmailMessage = {
  messageId: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  date: string;
  answeredAt?: string;
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

type StoredDailyGmailTask = Omit<DailyGmailTodo, 'snippet' | 'body' | 'summaryPending' | 'completed'>;

const AUTO_REFRESH_MS = 5 * 60_000;

function taskCacheToItems(cache: Record<string, StoredDailyGmailTask>) {
  return Object.values(cache)
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
  const { data: accountData, save: saveAccountData } = useUserDataStore();
  const [items, setItems] = useState<DailyGmailTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const runIdRef = useRef(0);
  const summaryCacheRef = useRef(
    (accountData[USER_DATA_KEYS.DAILY_GMAIL_SUMMARIES] || {}) as Record<string, string>,
  );
  const completionCacheRef = useRef(
    (accountData[USER_DATA_KEYS.DAILY_GMAIL_COMPLETIONS] || {}) as Record<string, string>,
  );
  const taskCacheRef = useRef(
    (accountData[USER_DATA_KEYS.DAILY_GMAIL_TASKS] || {}) as Record<string, StoredDailyGmailTask>,
  );

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

      await getAccessToken(force);
      const requestDailyMessages = () => fetch(
        '/api/gmail?action=daily-inbox&maxResults=50',
        { cache: 'no-store' },
      );
      let gmailResponse = await requestDailyMessages();
      if (gmailResponse.status === 401) {
        await getAccessToken(true);
        gmailResponse = await requestDailyMessages();
      }
      const gmailResult = await gmailResponse.json();
      if (!gmailResponse.ok || !gmailResult.success) {
        throw new Error(String(gmailResult.error || '读取近 72 小时 Gmail 来信失败。'));
      }

      const now = Date.now();
      const messages = (Array.isArray(gmailResult.data) ? gmailResult.data : [])
        .filter((message: DailyGmailMessage) => isWithinDailyGmailWindow(message.date, now)) as DailyGmailMessage[];
      const profiles = await loadCreatorResourceProfiles(settings);
      if (runId !== runIdRef.current) return;
      const profileByEmail = selectProfileByEmail(profiles);
      const summaryCache = summaryCacheRef.current;
      const completionCache = completionCacheRef.current;
      const matched = messages.flatMap((message) => {
        const profile = profileByEmail.get(normalizeThreadContactEmail(message.from));
        if (!profile) return [];
        return [{
          ...message,
          channelName: profile.channelName || senderLabel(message.from),
          channelUrl: profile.channelUrl,
          summary: summaryCache[message.messageId] || fallbackSummary(message),
          summaryPending: !summaryCache[message.messageId],
          avatar: initialAvatar(profile),
          profile,
        }];
      });

      const nextTaskCache = Object.fromEntries(
        Object.entries(taskCacheRef.current)
          .filter(([, task]) => isWithinDailyGmailWindow(task.date, now)),
      ) as Record<string, StoredDailyGmailTask>;
      const pendingSummaryIds = new Set<string>();
      matched.forEach((item) => {
        const taskKey = getDailyGmailTaskKey(item.threadId, item.messageId);
        const existing = nextTaskCache[taskKey];
        if (existing && Date.parse(existing.date) > Date.parse(item.date)) return;
        const completedAt = resolveIncomingGmailCompletedAt(
          existing,
          item,
          completionCache[item.messageId],
        );
        nextTaskCache[taskKey] = {
          messageId: item.messageId,
          threadId: item.threadId,
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
        if (item.summaryPending) pendingSummaryIds.add(item.messageId);
      });
      taskCacheRef.current = nextTaskCache;
      saveAccountData(USER_DATA_KEYS.DAILY_GMAIL_TASKS, nextTaskCache);
      setItems(taskCacheToItems(nextTaskCache).map((item) => ({
        ...item,
        summaryPending: pendingSummaryIds.has(item.messageId),
      })));
      setLoading(false);
      setRefreshing(false);

      const pendingSummaries = matched.filter((item) => !summaryCache[item.messageId]);
      const summaryRequest = pendingSummaries.length
        ? fetch('/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'dailyGmailSummaries',
              emails: pendingSummaries.map((item) => ({
                id: item.messageId,
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
        if (item.avatar.status !== 'loading') return [item.messageId, item.avatar] as const;
        const lookup = buildChannelAvatarLookup(item.profile);
        if (!lookup) return [item.messageId, item.avatar] as const;
        const avatar = await resolveChannelAvatar(lookup, {
          regionCode: settings.youtubeDefaultRegion || '',
          relevanceLanguage: settings.youtubeDefaultLanguage || '',
        });
        return [item.messageId, { ...avatar, title: avatar.title || item.channelName }] as const;
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
        const summary = summaries.get(task.messageId);
        const avatar = avatarByMessage.get(task.messageId);
        if (!summary && !avatar) return;
        updatedTaskCache[taskKey] = {
          ...task,
          summary: summary || task.summary,
          avatar: avatar || task.avatar,
        };
      });
      taskCacheRef.current = updatedTaskCache;
      saveAccountData(USER_DATA_KEYS.DAILY_GMAIL_TASKS, updatedTaskCache);
      setItems((current) => current.map((item) => ({
        ...item,
        summary: summaries.get(item.messageId) || item.summary,
        summaryPending: false,
        avatar: avatarByMessage.get(item.messageId) || item.avatar,
      })));
    } catch (caughtError) {
      if (runId !== runIdRef.current) return;
      setError(caughtError instanceof Error ? caughtError.message : '读取近 72 小时 Gmail 来信失败。');
      setLoading(false);
      setRefreshing(false);
    }
  }, [getAccessToken, saveAccountData, settings]);

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
    saveAccountData(USER_DATA_KEYS.DAILY_GMAIL_TASKS, taskCacheRef.current);
    setItems((current) => current.map((item) => (
      getDailyGmailTaskKey(item.threadId, item.messageId) === taskId
        ? { ...item, completed, completedAt }
        : item
    )));
  }, [saveAccountData]);

  return {
    items,
    loading,
    refreshing,
    error,
    refresh: () => load(true),
    toggleCompleted,
  };
}
