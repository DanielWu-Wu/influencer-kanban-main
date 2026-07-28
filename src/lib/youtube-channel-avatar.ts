export type ChannelAvatarState = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  avatarUrl?: string;
  channelUrl?: string;
  title?: string;
  cacheKey?: string;
  error?: string;
};

export type ChannelAvatarLookup = {
  key: string;
  link: string;
};

type ChannelAvatarCacheEntry = {
  status: 'success' | 'failed';
  avatarUrl?: string;
  channelUrl?: string;
  title?: string;
  error?: string;
  expiresAt: number;
};

type ResolveChannelAvatarOptions = {
  regionCode?: string;
  relevanceLanguage?: string;
};

type ResolvedChannelPayload = {
  inputUrl?: string;
  sourceUrl?: string;
  avatarUrl?: string;
  thumbnail?: string;
  url?: string;
  title?: string;
};

const CHANNEL_AVATAR_CACHE_PREFIX = 'influencer_ops_youtube_avatar:';
const CHANNEL_AVATAR_SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHANNEL_AVATAR_TRANSIENT_FAILURE_TTL_MS = 10 * 60 * 1000;
const CHANNEL_AVATAR_STABLE_FAILURE_TTL_MS = 24 * 60 * 60 * 1000;
const CHANNEL_AVATAR_QUOTA_RESET_BUFFER_MS = 5 * 60 * 1000;
const CHANNEL_AVATAR_BATCH_SIZE = 50;
const pendingAvatarRequests = new Map<string, Promise<ChannelAvatarState>>();

export function normalizeChannelUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function normalizeAutomaticAvatarChannelUrl(value: string) {
  const rawUrl = normalizeChannelUrl(value);
  if (!rawUrl) return '';

  const candidate = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) return '';

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments[0]?.startsWith('@')) {
      const handle = segments[0].replace(/^@+/, '').trim();
      return handle ? `https://www.youtube.com/@${handle}` : '';
    }
    if (segments[0]?.toLowerCase() === 'channel' && segments[1]) {
      return `https://www.youtube.com/channel/${segments[1]}`;
    }
  } catch {
    return '';
  }

  return '';
}

export function getDirectYouTubeChannelUrl(profile: {
  channelId?: string;
  channelUrl?: string;
} | null) {
  if (!profile) return '';

  const channelId = String(profile.channelId || '').trim();
  if (channelId) {
    return `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
  }

  const rawUrl = String(profile.channelUrl || '').trim();
  if (!rawUrl) return '';

  const candidate = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (hostname !== 'youtube.com' && !hostname.endsWith('.youtube.com')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function buildChannelAvatarLookup(profile: {
  channelId?: string;
  channelUrl?: string;
  channelName?: string;
} | null) {
  if (!profile) return null;
  const channelId = String(profile.channelId || '').trim();
  const channelUrl = normalizeAutomaticAvatarChannelUrl(String(profile.channelUrl || ''));
  if (channelId) {
    return {
      key: `channel:${channelId.toLowerCase()}`,
      link: `https://www.youtube.com/channel/${channelId}`,
    };
  }
  if (channelUrl) {
    return {
      key: `url:${channelUrl.toLowerCase()}`,
      link: channelUrl,
    };
  }
  return null;
}

export function channelAvatarLookupPriority(profile: {
  channelId?: string;
  channelUrl?: string;
  channelName?: string;
} | null) {
  if (!profile) return 0;
  if (String(profile.channelId || '').trim()) return 3;
  if (normalizeAutomaticAvatarChannelUrl(String(profile.channelUrl || ''))) return 2;
  return 0;
}

export function readChannelAvatarCache(key: string): ChannelAvatarState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${CHANNEL_AVATAR_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as ChannelAvatarCacheEntry;
    if (!entry.expiresAt || entry.expiresAt < Date.now()) {
      window.localStorage.removeItem(`${CHANNEL_AVATAR_CACHE_PREFIX}${key}`);
      return null;
    }
    if (entry.status === 'success') {
      return {
        status: 'ready',
        avatarUrl: entry.avatarUrl,
        channelUrl: entry.channelUrl,
        title: entry.title,
        cacheKey: key,
      };
    }
    return { status: 'failed', cacheKey: key, error: entry.error };
  } catch {
    return null;
  }
}

export function invalidateChannelAvatarCache(key?: string) {
  if (typeof window === 'undefined' || !key) return;
  try {
    window.localStorage.removeItem(`${CHANNEL_AVATAR_CACHE_PREFIX}${key}`);
  } catch {
    // Avatar caching is optional; failure to clear it should not affect Gmail.
  }
}

function writeChannelAvatarCache(key: string, entry: ChannelAvatarCacheEntry) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${CHANNEL_AVATAR_CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // localStorage can be unavailable or full; avatar caching is only an optimization.
  }
}

function channelPayloadToAvatar(
  channel: ResolvedChannelPayload | undefined,
  fallbackLink: string,
  cacheKey: string,
): ChannelAvatarState | null {
  const avatarUrl = channel?.avatarUrl || channel?.thumbnail || '';
  if (!avatarUrl) return null;
  return {
    status: 'ready',
    avatarUrl,
    channelUrl: channel?.url || channel?.sourceUrl || fallbackLink,
    title: channel?.title,
    cacheKey,
  };
}

function cacheResolvedAvatar(key: string, avatar: ChannelAvatarState) {
  writeChannelAvatarCache(key, {
    status: 'success',
    avatarUrl: avatar.avatarUrl,
    channelUrl: avatar.channelUrl,
    title: avatar.title,
    expiresAt: Date.now() + CHANNEL_AVATAR_SUCCESS_TTL_MS,
  });
}

function nextPacificQuotaResetAt(now = Date.now()) {
  const pacificDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const currentDay = pacificDay.format(new Date(now));
  let beforeReset = now;
  let afterReset = now + 26 * 60 * 60 * 1000;

  for (let index = 0; index < 24; index += 1) {
    const midpoint = Math.floor((beforeReset + afterReset) / 2);
    if (pacificDay.format(new Date(midpoint)) === currentDay) beforeReset = midpoint;
    else afterReset = midpoint;
  }

  return afterReset + CHANNEL_AVATAR_QUOTA_RESET_BUFFER_MS;
}

function avatarFailureExpiresAt(error?: string) {
  const normalized = String(error || '').toLowerCase();
  if (
    normalized.includes('配额')
    || normalized.includes('quota')
    || normalized.includes('daily limit')
  ) {
    return nextPacificQuotaResetAt();
  }
  if (
    normalized.includes('没有找到')
    || normalized.includes('未返回头像')
    || normalized.includes('不存在')
    || normalized.includes('无法识别')
    || normalized.includes('仅支持 channel id')
  ) {
    return Date.now() + CHANNEL_AVATAR_STABLE_FAILURE_TTL_MS;
  }
  return Date.now() + CHANNEL_AVATAR_TRANSIENT_FAILURE_TTL_MS;
}

function cacheFailedAvatar(key: string, error?: string) {
  writeChannelAvatarCache(key, {
    status: 'failed',
    error,
    expiresAt: avatarFailureExpiresAt(error),
  });
}

export async function resolveChannelAvatars(
  lookups: ChannelAvatarLookup[],
  options: ResolveChannelAvatarOptions = {},
) {
  const uniqueLookups = Array.from(new Map(lookups.map((lookup) => [lookup.key, lookup])).values());
  const results = new Map<string, ChannelAvatarState>();
  const uncached: ChannelAvatarLookup[] = [];

  for (const lookup of uniqueLookups) {
    const cached = readChannelAvatarCache(lookup.key);
    if (cached) results.set(lookup.key, cached);
    else uncached.push(lookup);
  }

  const chunks: ChannelAvatarLookup[][] = [];
  for (let index = 0; index < uncached.length; index += CHANNEL_AVATAR_BATCH_SIZE) {
    chunks.push(uncached.slice(index, index + CHANNEL_AVATAR_BATCH_SIZE));
  }

  await Promise.all(chunks.map(async (chunk) => {
    try {
      const response = await fetch('/api/youtube/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links: chunk.map((lookup) => lookup.link),
          maxVideos: 1,
          includeRecentVideos: false,
          allowSearchFallback: false,
          regionCode: options.regionCode || '',
          relevanceLanguage: options.relevanceLanguage || '',
        }),
      });
      const payload = await response.json() as {
        success?: boolean;
        error?: string;
        channels?: ResolvedChannelPayload[];
        errors?: Array<{ sourceUrl?: string; error?: string }>;
      };
      if (!response.ok || !payload.success) throw new Error(payload.error || '频道头像读取失败。');

      const channelsBySource = new Map<string, ResolvedChannelPayload>();
      for (const channel of payload.channels || []) {
        for (const value of [channel.inputUrl, channel.sourceUrl]) {
          if (value) channelsBySource.set(normalizeChannelUrl(value).toLowerCase(), channel);
        }
      }
      const errorsBySource = new Map(
        (payload.errors || []).map((item) => [
          normalizeChannelUrl(String(item.sourceUrl || '')).toLowerCase(),
          String(item.error || '没有找到匹配的 YouTube 频道。'),
        ]),
      );
      for (const lookup of chunk) {
        const lookupSource = normalizeChannelUrl(lookup.link).toLowerCase();
        const channel = channelsBySource.get(lookupSource);
        const avatar = channelPayloadToAvatar(channel, lookup.link, lookup.key);
        if (avatar) {
          results.set(lookup.key, avatar);
          cacheResolvedAvatar(lookup.key, avatar);
        } else {
          const error = errorsBySource.get(lookupSource) || '频道未返回头像。';
          results.set(lookup.key, { status: 'failed', cacheKey: lookup.key, error });
          cacheFailedAvatar(lookup.key, error);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '频道头像读取失败。';
      for (const lookup of chunk) {
        results.set(lookup.key, { status: 'failed', cacheKey: lookup.key, error: message });
        cacheFailedAvatar(lookup.key, message);
      }
    }
  }));
  return results;
}

export async function resolveChannelAvatar(
  lookup: ChannelAvatarLookup,
  options: ResolveChannelAvatarOptions = {},
): Promise<ChannelAvatarState> {
  const cached = readChannelAvatarCache(lookup.key);
  if (cached) return cached;

  const pending = pendingAvatarRequests.get(lookup.key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const response = await fetch('/api/youtube/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links: [lookup.link],
          maxVideos: 1,
          includeRecentVideos: false,
          allowSearchFallback: false,
          regionCode: options.regionCode || '',
          relevanceLanguage: options.relevanceLanguage || '',
        }),
      });
      const result = await response.json() as {
        success?: boolean;
        error?: string;
        channels?: Array<{
          avatarUrl?: string;
          thumbnail?: string;
          url?: string;
          sourceUrl?: string;
          title?: string;
        }>;
        errors?: Array<{ sourceUrl?: string; error?: string }>;
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '频道头像读取失败。');
      }

      const avatar = channelPayloadToAvatar(result.channels?.[0], lookup.link, lookup.key);
      if (!avatar) {
        throw new Error(result.errors?.[0]?.error || '频道未返回头像。');
      }
      cacheResolvedAvatar(lookup.key, avatar);
      return avatar;
    } catch (error) {
      const message = error instanceof Error ? error.message : '频道头像读取失败。';
      cacheFailedAvatar(lookup.key, message);
      return { status: 'failed' as const, cacheKey: lookup.key, error: message };
    }
  })().finally(() => {
    pendingAvatarRequests.delete(lookup.key);
  });

  pendingAvatarRequests.set(lookup.key, request);
  return request;
}
