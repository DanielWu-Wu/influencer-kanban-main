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

type YouTubeVideoItem = {
  id?: string;
  snippet?: {
    channelId?: string;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
};

type YouTubeVideosResponse = YouTubeErrorResponse & {
  items?: YouTubeVideoItem[];
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
  inputUrl: string;
  sourceUrl: string;
  channelId?: string;
  lookupQuery?: string;
  handle?: string;
  username?: string;
  videoId?: string;
  resolution: 'direct' | 'handle' | 'username' | 'video' | 'search';
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

function parseIsoDurationSeconds(value?: string) {
  const match = String(value || '').match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) return null;
  const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return (
    Number(days) * 86_400
    + Number(hours) * 3_600
    + Number(minutes) * 60
    + Number(seconds)
  );
}

function normalizeMaybeUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (/^(www\.)?(youtube\.com|m\.youtube\.com|youtu\.be)\//i.test(trimmed)) return `https://${trimmed}`;
  if (trimmed.startsWith('@')) return `https://www.youtube.com/${trimmed}`;
  return trimmed;
}

function cleanChannelPathSegment(value: string) {
  return decodeURIComponent(value || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

function parseYouTubeInput(input: string): ResolvedInput | null {
  const normalized = normalizeMaybeUrl(input);
  if (!normalized) return null;

  if (/^UC[\w-]{20,}$/i.test(normalized)) {
    return { inputUrl: input, sourceUrl: `https://www.youtube.com/channel/${normalized}`, channelId: normalized, resolution: 'direct' };
  }

  try {
    const url = new URL(normalized);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
    const segments = url.pathname.split('/').filter(Boolean);

    if (host === 'youtu.be' && segments[0]) {
      return {
        inputUrl: input,
        sourceUrl: `https://youtu.be/${segments[0]}`,
        videoId: segments[0],
        resolution: 'video',
      };
    }

    if (!host.includes('youtube.com')) return null;

    if (url.pathname === '/watch' && url.searchParams.get('v')) {
      const videoId = url.searchParams.get('v') || '';
      return {
        inputUrl: input,
        sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
        videoId,
        resolution: 'video',
      };
    }

    if ((segments[0] === 'shorts' || segments[0] === 'live' || segments[0] === 'embed') && segments[1]) {
      return {
        inputUrl: input,
        sourceUrl: `https://www.youtube.com/${segments[0]}/${segments[1]}`,
        videoId: segments[1],
        resolution: 'video',
      };
    }

    if (!segments.length) return null;

    if (segments[0] === 'channel' && segments[1]) {
      return {
        inputUrl: input,
        sourceUrl: `https://www.youtube.com/channel/${segments[1]}`,
        channelId: segments[1],
        resolution: 'direct',
      };
    }

    if (segments[0].startsWith('@')) {
      const handle = cleanChannelPathSegment(segments[0]);
      return {
        inputUrl: input,
        sourceUrl: `https://www.youtube.com/@${handle}`,
        lookupQuery: handle,
        handle,
        resolution: 'handle',
      };
    }

    if ((segments[0] === 'c' || segments[0] === 'user') && segments[1]) {
      const lookup = cleanChannelPathSegment(segments[1]);
      return {
        inputUrl: input,
        sourceUrl: `https://www.youtube.com/${segments[0]}/${lookup}`,
        lookupQuery: lookup,
        username: segments[0] === 'user' ? lookup : undefined,
        resolution: segments[0] === 'user' ? 'username' : 'search',
      };
    }

    const lookup = cleanChannelPathSegment(segments[0]);
    if (lookup && !['feed', 'playlist', 'results', 'watch'].includes(lookup.toLowerCase())) {
      return {
        inputUrl: input,
        sourceUrl: `https://www.youtube.com/${lookup}`,
        lookupQuery: lookup,
        resolution: 'search',
      };
    }
  } catch {
    if (normalized.startsWith('@')) {
      const handle = cleanChannelPathSegment(normalized);
      return {
        inputUrl: input,
        sourceUrl: `https://www.youtube.com/@${handle}`,
        lookupQuery: handle,
        handle,
        resolution: 'handle',
      };
    }
  }

  return {
    inputUrl: input,
    sourceUrl: normalized,
    lookupQuery: normalized.replace(/^@/, ''),
    resolution: 'search',
  };
}

function extractPublicEmail(text: string) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] || '';
}

async function fetchChannelIdByHandle(apiKey: string, handle: string) {
  const cleanHandle = cleanChannelPathSegment(handle);
  if (!cleanHandle) return '';

  for (const candidate of [cleanHandle, `@${cleanHandle}`]) {
    const url = buildYouTubeUrl('channels', {
      part: 'snippet',
      forHandle: candidate,
      key: apiKey,
    });

    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json() as YouTubeChannelsResponse;
    if (response.ok && !data.error && data.items?.[0]?.id) {
      return data.items[0].id;
    }
  }

  return '';
}

async function fetchChannelIdByUsername(apiKey: string, username: string) {
  const cleanUsername = cleanChannelPathSegment(username);
  if (!cleanUsername) return '';

  const url = buildYouTubeUrl('channels', {
    part: 'snippet',
    forUsername: cleanUsername,
    key: apiKey,
  });

  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json() as YouTubeChannelsResponse;
  if (!response.ok || data.error) return '';
  return data.items?.[0]?.id || '';
}

async function fetchVideoChannelId(apiKey: string, videoId: string) {
  if (!videoId) return '';
  const url = buildYouTubeUrl('videos', {
    part: 'snippet',
    id: videoId,
    key: apiKey,
  });

  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json() as YouTubeVideosResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `YouTube 视频读取失败 (${response.status})`);
  }
  return data.items?.[0]?.snippet?.channelId || '';
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

async function resolveChannelId(apiKey: string, item: ResolvedInput, regionCode: string, relevanceLanguage: string) {
  if (item.channelId) return item.channelId;

  if (item.videoId) {
    return await fetchVideoChannelId(apiKey, item.videoId);
  }

  if (item.handle) {
    const direct = await fetchChannelIdByHandle(apiKey, item.handle);
    if (direct) return direct;
  }

  if (item.username) {
    const direct = await fetchChannelIdByUsername(apiKey, item.username);
    if (direct) return direct;
  }

  return await searchChannelId(
    apiKey,
    item.lookupQuery || item.inputUrl,
    regionCode,
    relevanceLanguage,
  );
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
    maxResults: '50',
    key: apiKey,
  });

  const response = await fetch(url, { cache: 'no-store' });
  const data = await response.json() as YouTubeSearchResponse;
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `YouTube 最近视频读取失败 (${response.status})`);
  }

  const videos = (data.items || [])
    .filter((item) => item.id?.videoId)
    .map((item) => ({
      videoId: item.id?.videoId || '',
      title: item.snippet?.title || '',
      description: item.snippet?.description || '',
      publishedAt: item.snippet?.publishedAt || '',
      thumbnail: bestThumbnail(item.snippet?.thumbnails),
      url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
    }));
  const videoIds = videos.map((item) => item.videoId).filter(Boolean);
  if (!videoIds.length) return videos;

  const statisticsUrl = buildYouTubeUrl('videos', {
    part: 'statistics,contentDetails',
    id: videoIds.join(','),
    key: apiKey,
  });
  const statisticsResponse = await fetch(statisticsUrl, { cache: 'no-store' });
  const statisticsData = await statisticsResponse.json() as YouTubeVideosResponse;
  if (!statisticsResponse.ok || statisticsData.error) {
    throw new Error(
      statisticsData.error?.message
      || `YouTube 视频时长和互动数据读取失败 (${statisticsResponse.status})`,
    );
  }
  const statisticsById = new Map(
    (statisticsData.items || []).map((item) => [
      item.id || '',
      {
        viewCount: Number(item.statistics?.viewCount || 0),
        likeCount: item.statistics?.likeCount === undefined
          ? null
          : Number(item.statistics.likeCount || 0),
        commentCount: item.statistics?.commentCount === undefined
          ? null
          : Number(item.statistics.commentCount || 0),
        durationSeconds: parseIsoDurationSeconds(item.contentDetails?.duration),
      },
    ]),
  );
  return videos
    .map((item) => ({
      ...item,
      viewCount: statisticsById.get(item.videoId)?.viewCount ?? null,
      likeCount: statisticsById.get(item.videoId)?.likeCount ?? null,
      commentCount: statisticsById.get(item.videoId)?.commentCount ?? null,
      durationSeconds: statisticsById.get(item.videoId)?.durationSeconds ?? null,
    }))
    .filter((item) => typeof item.durationSeconds === 'number' && item.durationSeconds > 180)
    .slice(0, maxVideos);
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

  const maxVideos = Math.min(8, Math.max(1, Number(body.maxVideos) || 5));
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
      try {
        const channelId = await resolveChannelId(
          apiKey,
          item.parsed,
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
          inputUrl: source?.inputUrl,
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
          confidence: source?.resolution === 'search' ? 'medium' : 'high',
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
