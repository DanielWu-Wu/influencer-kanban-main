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

const CHANNEL_AVATAR_CACHE_PREFIX = 'influencer_ops_youtube_avatar:';
const CHANNEL_AVATAR_SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CHANNEL_AVATAR_FAILURE_TTL_MS = 6 * 60 * 60 * 1000;

export function normalizeChannelUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

export function buildChannelAvatarLookup(profile: { channelId?: string; channelUrl?: string } | null) {
  if (!profile) return null;
  const channelId = String(profile.channelId || '').trim();
  const channelUrl = normalizeChannelUrl(String(profile.channelUrl || ''));
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

export async function resolveChannelAvatar(
  lookup: ChannelAvatarLookup,
  options: ResolveChannelAvatarOptions = {},
): Promise<ChannelAvatarState> {
  const cached = readChannelAvatarCache(lookup.key);
  if (cached) return cached;

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

    const channel = result.channels?.[0];
    const avatarUrl = channel?.avatarUrl || channel?.thumbnail || '';
    const channelUrl = channel?.url || channel?.sourceUrl || lookup.link;
    if (!avatarUrl) throw new Error('频道未返回头像。');

    const avatar: ChannelAvatarState = {
      status: 'ready',
      avatarUrl,
      channelUrl,
      title: channel?.title,
    };
    writeChannelAvatarCache(lookup.key, {
      status: 'success',
      avatarUrl,
      channelUrl,
      title: avatar.title,
      expiresAt: Date.now() + CHANNEL_AVATAR_SUCCESS_TTL_MS,
    });
    return avatar;
  } catch {
    writeChannelAvatarCache(lookup.key, {
      status: 'failed',
      expiresAt: Date.now() + CHANNEL_AVATAR_FAILURE_TTL_MS,
    });
    return { status: 'failed' };
  }
}
