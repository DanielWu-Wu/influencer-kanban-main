import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/supabase/server';
import { getUserSecret } from '@/lib/user-private-storage';

type YouTubeErrorResponse = {
  error?: {
    message?: string;
  };
};

type YouTubeThumbnails = {
  default?: { url?: string };
  medium?: { url?: string };
  high?: { url?: string };
};

type YouTubeSearchItem = {
  id?: {
    channelId?: string;
    videoId?: string;
  };
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    channelId?: string;
    thumbnails?: YouTubeThumbnails;
  };
};

type YouTubeSearchResponse = YouTubeErrorResponse & {
  items?: YouTubeSearchItem[];
};

type YouTubeChannelItem = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    publishedAt?: string;
    country?: string;
    thumbnails?: YouTubeThumbnails;
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    videoCount?: string;
  };
};

type YouTubeChannelsResponse = YouTubeErrorResponse & {
  items?: YouTubeChannelItem[];
};

type ResolvedInput = {
  sourceUrl: string;
  channelId?: string;
  lookupQuery?: string;
  resolution: 'direct' | 'search';
};

async function resolveYouTubeKey(request: NextRequest, providedKey?: string) {
  if (providedKey?.trim()) return providedKey.trim();
  if (process.env.YOUTUBE_API_KEY) return process.env.YOUTUBE_API_KEY;

  const auth = await getRequestUser(request);
  if (!auth) return '';
  return await getUserSecret<string>(auth.supabase, 'youtube_api_key') || '';
}

function buildYouTubeUrl(path: string, params: Record<string, string>) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

function bestThumbnail(thumbnails?: YouTubeThumbnails) {
  return thumbnails?.high?.url || thumbnails?.medium?.url || thumbnails?.default?.url || '';
}

function normalizeMaybeUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (/^(www\.)?(youtube\.com|m\.youtube\.com)\//i.test(trimmed)) return `https://${trimmed}`;
  if (trimmed.startsWith('@')) return `https://www.youtube.com/${trimmed}`;
  return trimmed;
}

function parseYouTubeInput(input: string): ResolvedInput | null {
  const normalized = normalizeMaybeUrl(input);
  if (!normalized) return null;

  if (/^UC[\w-]{20,}$/i.test(normalized)) {
    return { sourceUrl: `https://www.youtube.com/channel/${normalized}`, channelId: normalized, resolution: 'direct' };
  }

  try {
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
    if (!host.includes('youtube.com')) return null;

    const segments = url.pathname.split('/').filter(Boolean);
    if (!segments.length) return null;

    if (segments[0] === 'channel' && segments[1]) {
      return {
        sourceUrl: `https://www.youtube.com/channel/${segments[1]}`,
        channelId: segments[1],
        resolution: 'direct',
      };
    }

    if (segments[0].startsWith('@')) {
      return {
        sourceUrl: `https://www.youtube.com/${segments[0]}`,
        lookupQuery: segments[0],
        resolution: 'search',
      };
    }

    if ((segments[0] === 'c' || segments[0] === 'user') && segments[1]) {
      return {
        sourceUrl: `https://www.youtube.com/${segments[0]}/${segments[1]}`,
        lookupQuery: segments[1],
        resolution: 'search',
      };
    }
  } catch {
    if (normalized.startsWith('@')) {
      return {
        sourceUrl: `https://www.youtube.com/${normalized}`,
        lookupQuery: normalized,
        resolution: 'search',
      };
    }
  }

  return {
    sourceUrl: normalized,
    lookupQuery: normalized.replace(/^@/, ''),
    resolution: 'search',
  };
}

function extractPublicEmail(text: string) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] || '';
}

async function searchChannelId(apiKey: string, query: string, regionCode: string, relevanceLanguage: string) {
  const searchUrl = buildYouTubeUrl('search', {
    part: 'snippet',
    type: 'channel',
    q: query,
    maxResults: '1',
    regionCode,
    relevanceLanguage,
    key: apiKey,
  });

  const response = await fetch(searchUrl, { cache: 'no-store' });
  const data = await response.json() as YouTubeSearchResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `YouTube 频道搜索失败 (${response.status})`);
  }
  return data.items?.[0]?.id?.channelId || '';
}

async function fetchChannels(apiKey: string, channelIds: string[]) {
  if (!channelIds.length) return [];
  const url = buildYouTubeUrl('channels', {
    part: 'snippet,statistics',
    id: channelIds.join(','),
    key: apiKey,
  });

  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json() as YouTubeChannelsResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `YouTube 频道详情读取失败 (${response.status})`);
  }
  return data.items || [];
}

async function fetchRecentVideos(apiKey: string, channelId: string, maxVideos: number) {
  const url = buildYouTubeUrl('search', {
    part: 'snippet',
    channelId,
    type: 'video',
    order: 'date',
    maxResults: String(maxVideos),
    key: apiKey,
  });

  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json() as YouTubeSearchResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `YouTube 最近视频读取失败 (${response.status})`);
  }

  return (data.items || [])
    .filter((item) => item.id?.videoId)
    .map((item) => ({
      videoId: item.id?.videoId || '',
      title: item.snippet?.title || '',
      description: item.snippet?.description || '',
      publishedAt: item.snippet?.publishedAt || '',
      thumbnail: bestThumbnail(item.snippet?.thumbnails),
      url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    }));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    links?: unknown[];
    apiKey?: unknown;
    maxVideos?: unknown;
    regionCode?: unknown;
    relevanceLanguage?: unknown;
  };
  const links = Array.isArray(body.links)
    ? body.links.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : [];
  const apiKey = await resolveYouTubeKey(request, typeof body.apiKey === 'string' ? body.apiKey : undefined);

  if (!apiKey) {
    return NextResponse.json({ error: '缺少 YouTube API Key。请先在设置中保存 YouTube API Key。' }, { status: 400 });
  }
  if (!links.length) {
    return NextResponse.json({ error: '请先粘贴至少一个 YouTube 频道链接。' }, { status: 400 });
  }

  const maxVideos = Math.min(5, Math.max(1, Number(body.maxVideos) || 3));
  const regionCode = typeof body.regionCode === 'string' ? body.regionCode.trim().toUpperCase().slice(0, 2) : '';
  const relevanceLanguage = typeof body.relevanceLanguage === 'string' ? body.relevanceLanguage.trim().toLowerCase() : '';
  const parsedInputs = links.map((link: string) => ({ input: link, parsed: parseYouTubeInput(link) }));
  const errors: Array<{ sourceUrl: string; error: string }> = [];

  try {
    const resolvedInputs: ResolvedInput[] = [];
    for (const item of parsedInputs) {
      if (!item.parsed) {
        errors.push({ sourceUrl: item.input, error: '无法识别为 YouTube 频道链接。' });
        continue;
      }
      if (item.parsed.channelId) {
        resolvedInputs.push(item.parsed);
        continue;
      }
      try {
        const channelId = await searchChannelId(
          apiKey,
          item.parsed.lookupQuery || item.input,
          regionCode,
          relevanceLanguage,
        );
        if (!channelId) {
          errors.push({ sourceUrl: item.input, error: '没有找到匹配的 YouTube 频道。' });
          continue;
        }
        resolvedInputs.push({ ...item.parsed, channelId });
      } catch (error) {
        errors.push({
          sourceUrl: item.input,
          error: error instanceof Error ? error.message : '频道搜索失败。',
        });
      }
    }

    const uniqueInputs = Array.from(
      new Map(resolvedInputs.map((item) => [item.channelId, item])).values(),
    );
    const channels = await fetchChannels(apiKey, uniqueInputs.map((item) => item.channelId!).filter(Boolean));
    const inputByChannelId = new Map(uniqueInputs.map((item) => [item.channelId, item]));

    const results = await Promise.all(
      channels.map(async (channel) => {
        const source = inputByChannelId.get(channel.id);
        let recentVideos: Awaited<ReturnType<typeof fetchRecentVideos>> = [];
        try {
          recentVideos = await fetchRecentVideos(apiKey, channel.id, maxVideos);
        } catch (error) {
          errors.push({
            sourceUrl: source?.sourceUrl || `https://www.youtube.com/channel/${channel.id}`,
            error: error instanceof Error ? error.message : '最近视频读取失败。',
          });
        }

        const description = channel.snippet?.description || '';
        return {
          sourceUrl: source?.sourceUrl || `https://www.youtube.com/channel/${channel.id}`,
          channelId: channel.id,
          title: channel.snippet?.title || '',
          description,
          customUrl: channel.snippet?.customUrl || '',
          country: channel.snippet?.country || '',
          publishedAt: channel.snippet?.publishedAt || '',
          avatarUrl: bestThumbnail(channel.snippet?.thumbnails),
          thumbnail: bestThumbnail(channel.snippet?.thumbnails),
          subscriberCount: channel.statistics?.hiddenSubscriberCount ? null : Number(channel.statistics?.subscriberCount || 0),
          viewCount: Number(channel.statistics?.viewCount || 0),
          videoCount: Number(channel.statistics?.videoCount || 0),
          url: `https://www.youtube.com/channel/${channel.id}`,
          publicEmail: extractPublicEmail(description),
          recentVideos,
          resolution: source?.resolution || 'direct',
          confidence: source?.resolution === 'direct' ? 'high' : 'medium',
        };
      }),
    );

    return NextResponse.json({ success: true, channels: results, errors });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'YouTube 频道识别失败。' },
      { status: 500 },
    );
  }
}
