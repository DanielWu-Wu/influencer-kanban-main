export type ChannelAvatarState = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  avatarUrl?: string;
  channelUrl?: string;
  title?: string;
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
const CHANNEL_AVATAR_FAILURE_TTL_MS = 10 * 60 * 1000;
const pendingAvatarRequests = new Map<string, Promise<ChannelAvatarState>>();

export function normalizeChannelUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function buildChannelAvatarLookup(profile: {
  channelId?: string;
  channelUrl?: string;
  channelName?: string;
} | null) {
  if (!profile) return null;
  const channelId = String(profile.channelId || '').trim();
  const channelUrl = normalizeChannelUrl(String(profile.channelUrl || ''));
  const channelName = String(profile.channelName || '').trim();
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
  if (channelName && !['未填写', '未填写频道名'].includes(channelName)) {
    return {
      key: `search:${channelName.toLowerCase()}`,
      link: channelName,
    };
  }
  return null;
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
      };
    }
    if (entry.expiresAt - Date.now() > CHANNEL_AVATAR_FAILURE_TTL_MS) {
      window.localStorage.removeItem(`${CHANNEL_AVATAR_CACHE_PREFIX}${key}`);
      return null;
    }
    return { status: 'failed' };
  } catch {
    return null;
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
): ChannelAvatarState | null {
  const avatarUrl = channel?.avatarUrl || channel?.thumbnail || '';
  if (!avatarUrl) return null;
  return {
    status: 'ready',
    avatarUrl,
    channelUrl: channel?.url || channel?.sourceUrl || fallbackLink,
    title: channel?.title,
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

function cacheFailedAvatar(key: string) {
  writeChannelAvatarCache(key, {
    status: 'failed',
    expiresAt: Date.now() + CHANNEL_AVATAR_FAILURE_TTL_MS,
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
  for (let index = 0; index < uncached.length; index += 20) {
    chunks.push(uncached.slice(index, index + 20));
  }

  for (const chunk of chunks) {
    try {
      const response = await fetch('/api/youtube/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links: chunk.map((lookup) => lookup.link),
          maxVideos: 1,
          includeRecentVideos: false,
          regionCode: options.regionCode || '',
          relevanceLanguage: options.relevanceLanguage || '',
        }),
      });
      const payload = await response.json() as {
        success?: boolean;
        error?: string;
        channels?: ResolvedChannelPayload[];
      };
      if (!response.ok || !payload.success) throw new Error(payload.error || '频道头像读取失败。');

      const channelsBySource = new Map<string, ResolvedChannelPayload>();
      for (const channel of payload.channels || []) {
        for (const value of [channel.inputUrl, channel.sourceUrl]) {
          if (value) channelsBySource.set(normalizeChannelUrl(value).toLowerCase(), channel);
        }
      }
      for (const lookup of chunk) {
        const channel = channelsBySource.get(normalizeChannelUrl(lookup.link).toLowerCase());
        const avatar = channelPayloadToAvatar(channel, lookup.link);
        if (avatar) {
          results.set(lookup.key, avatar);
          cacheResolvedAvatar(lookup.key, avatar);
        } else {
          results.set(lookup.key, { status: 'failed' });
          cacheFailedAvatar(lookup.key);
        }
      }
    } catch {
      for (const lookup of chunk) {
        results.set(lookup.key, { status: 'failed' });
        cacheFailedAvatar(lookup.key);
      }
    }
  }
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
      };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '频道头像读取失败。');
      }

      const avatar = channelPayloadToAvatar(result.channels?.[0], lookup.link);
      if (!avatar) throw new Error('频道未返回头像。');
      cacheResolvedAvatar(lookup.key, avatar);
      return avatar;
    } catch {
      cacheFailedAvatar(lookup.key);
      return { status: 'failed' as const };
    }
  })().finally(() => {
    pendingAvatarRequests.delete(lookup.key);
  });

  pendingAvatarRequests.set(lookup.key, request);
  return request;
}
