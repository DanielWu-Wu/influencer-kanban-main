'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCreatorResourceProfiles, type CreatorResourceProfile } from '@/lib/creator-resource-profile';
import { isWithinDailyGmailWindow } from '@/lib/daily-gmail-todos';
import { useGmailAuth, type AppSettings } from '@/lib/data';
import { normalizeThreadContactEmail } from '@/lib/gmail-thread-contact';
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

const SUMMARY_CACHE_KEY = 'influencer-board-daily-gmail-summaries-v1';
const COMPLETION_CACHE_KEY = 'influencer-board-daily-gmail-completions-v1';
const AUTO_REFRESH_MS = 5 * 60_000;

function loadSummaryCache() {
  try {
    return JSON.parse(window.localStorage.getItem(SUMMARY_CACHE_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveSummaryCache(cache: Record<string, string>) {
  try {
    const entries = Object.entries(cache).slice(-300);
    window.localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 摘要缓存只是性能优化，不应阻断每日来信读取。
  }
}

function loadCompletionCache() {
  try {
    return JSON.parse(window.localStorage.getItem(COMPLETION_CACHE_KEY) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveCompletionCache(cache: Record<string, string>) {
  try {
    const entries = Object.entries(cache).slice(-500);
    window.localStorage.setItem(COMPLETION_CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 完成状态只影响本地界面，不应阻断 Gmail 来信显示。
  }
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

export function useDailyGmailTodos(settings: AppSettings) {
  const { auth, connect } = useGmailAuth();
  const [items, setItems] = useState<DailyGmailTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const runIdRef = useRef(0);
  const completionCacheRef = useRef<Record<string, string>>({});

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

      let accessToken = await getAccessToken(force);
      const requestDailyMessages = (token: string) => fetch(
        `/api/gmail?action=daily-inbox&maxResults=50&token=${encodeURIComponent(token)}`,
        { cache: 'no-store' },
      );
      let gmailResponse = await requestDailyMessages(accessToken);
      if (gmailResponse.status === 401) {
        accessToken = await getAccessToken(true);
        gmailResponse = await requestDailyMessages(accessToken);
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
      const summaryCache = loadSummaryCache();
      const completionCache = loadCompletionCache();
      completionCacheRef.current = completionCache;
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
          completed: Boolean(completionCache[message.messageId]),
          completedAt: completionCache[message.messageId] || undefined,
          profile,
        }];
      });

      setItems(matched.map((item) => ({
        messageId: item.messageId,
        threadId: item.threadId,
        from: item.from,
        subject: item.subject,
        snippet: item.snippet,
        body: item.body,
        date: item.date,
        channelName: item.channelName,
        channelUrl: item.channelUrl,
        summary: item.summary,
        summaryPending: item.summaryPending,
        avatar: item.avatar,
        completed: item.completed,
        completedAt: item.completedAt,
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
      if (summaries.size) saveSummaryCache(summaryCache);
      const avatarByMessage = new Map(avatars);
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
  }, [getAccessToken, settings]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, AUTO_REFRESH_MS);
    return () => {
      runIdRef.current += 1;
      window.clearInterval(timer);
    };
  }, [load]);

  const toggleCompleted = useCallback((messageId: string) => {
    const completed = !Boolean(completionCacheRef.current[messageId]);
    const completedAt = completed ? new Date().toISOString() : undefined;
    if (completedAt) completionCacheRef.current[messageId] = completedAt;
    else delete completionCacheRef.current[messageId];
    saveCompletionCache(completionCacheRef.current);
    setItems((current) => current.map((item) => (
      item.messageId === messageId ? { ...item, completed, completedAt } : item
    )));
  }, []);

  return {
    items,
    loading,
    refreshing,
    error,
    refresh: () => load(true),
    toggleCompleted,
  };
}
