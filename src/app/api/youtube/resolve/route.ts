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
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
};

type YouTubeChannelsResponse = YouTubeErrorResponse & {
  items?: YouTubeChannelItem[];
};

type YouTubePlaylistItem = {
  snippet?: {
    title?: string;
    description?: string;
    publishedAt?: string;
    thumbnails?: YouTubeThumbnails;
    resourceId?: { videoId?: string };
  };
  contentDetails?: { videoId?: string };
};

type YouTubePlaylistResponse = YouTubeErrorResponse & {
  items?: YouTubePlaylistItem[];
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

const YOUTUBE_REQUEST_TIMEOUT_MS = 12_000;
const YOUTUBE_MAX_ATTEMPTS = 2;

function youtubeErrorMessage(label: string, status: number, rawMessage: string) {
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes('quota') || normalized.includes('daily limit')) {
    return `${label}失败：YouTube API 当日配额已用完，请在配额重置后重试。`;
  }
  if (status === 429 || normalized.includes('rate limit')) {
    return `${label}失败：YouTube API 请求过于频繁，请稍后重试。`;
  }
  if (status === 403 && normalized.includes('key')) {
    return `${label}失败：YouTube API Key 无效或未获授权，请检查设置。`;
  }
  if (status === 404) return `${label}失败：频道或视频不存在，可能已删除或设为私密。`;
  if (status >= 500) return `${label}失败：YouTube 服务暂时不可用。`;
  return `${label}失败${status ? ` (${status})` : ''}${rawMessage ? `：${rawMessage}` : '。'}`;
}

function isRetryableYouTubeError(status: number, rawMessage: string) {
  const normalized = rawMessage.toLowerCase();
  if (normalized.includes('quota') || normalized.includes('daily limit')) return false;
  return status === 408 || status === 429 || status >= 500;
}

async function fetchYouTubeJson<T extends YouTubeErrorResponse>(url: URL, label: string): Promise<T> {
  let lastError = '';
  for (let attempt = 1; attempt <= YOUTUBE_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), YOUTUBE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({})) as T;
      if (response.ok && !data.error) return data;

      const rawMessage = data.error?.message || '';
      lastError = youtubeErrorMessage(label, response.status, rawMessage);
      if (!isRetryableYouTubeError(response.status, rawMessage) || attempt === YOUTUBE_MAX_ATTEMPTS) {
        throw new Error(attempt > 1 ? `${lastError}（已自动重试 1 次）` : lastError);
      }
    } catch (error) {
      if (error instanceof Error && error.message === lastError) throw error;
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      lastError = isTimeout
        ? `${label}超时（${YOUTUBE_REQUEST_TIMEOUT_MS / 1000} 秒）`
        : `${label}失败：网络连接异常`;
      if (attempt === YOUTUBE_MAX_ATTEMPTS) {
        throw new Error(`${lastError}（已自动重试 1 次）`);
      }
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  throw new Error(lastError || `${label}失败。`);
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

    const data = await fetchYouTubeJson<YouTubeChannelsResponse>(url, 'YouTube 频道 Handle 解析');
    if (data.items?.[0]?.id) {
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

  const data = await fetchYouTubeJson<YouTubeChannelsResponse>(url, 'YouTube 用户名解析');
  return data.items?.[0]?.id || '';
}

async function fetchVideoChannelId(apiKey: string, videoId: string) {
  if (!videoId) return '';
  const url = buildYouTubeUrl('videos', {
    part: 'snippet',
    id: videoId,
    key: apiKey,
  });

  const data = await fetchYouTubeJson<YouTubeVideosResponse>(url, 'YouTube 视频来源频道读取');
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

  const data = await fetchYouTubeJson<YouTubeSearchResponse>(searchUrl, 'YouTube 频道搜索');
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
    part: 'snippet,statistics,contentDetails',
    id: channelIds.join(','),
    key: apiKey,
  });

  const data = await fetchYouTubeJson<YouTubeChannelsResponse>(url, 'YouTube 频道详情读取');
  return data.items || [];
}

async function fetchRecentVideos(apiKey: string, uploadsPlaylistId: string, maxVideos: number) {
  if (!uploadsPlaylistId) throw new Error('未找到频道上传播放列表，无法读取最近视频。');
  const url = buildYouTubeUrl('playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: uploadsPlaylistId,
    maxResults: '50',
    key: apiKey,
  });

  const data = await fetchYouTubeJson<YouTubePlaylistResponse>(url, 'YouTube 最近视频列表读取');

  const videos = (data.items || [])
    .filter((item) => item.contentDetails?.videoId || item.snippet?.resourceId?.videoId)
    .map((item) => ({
      videoId: item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || '',
      title: item.snippet?.title || '',
      description: item.snippet?.description || '',
      publishedAt: item.snippet?.publishedAt || '',
      thumbnail: bestThumbnail(item.snippet?.thumbnails),
      url: `https://www.youtube.com/watch?v=${item.contentDetails?.videoId || item.snippet?.resourceId?.videoId}`,
    }));
  const videoIds = videos.map((item) => item.videoId).filter(Boolean);
  if (!videoIds.length) return { videos: [], warning: '频道目前没有可读取的公开视频。' };

  const statisticsUrl = buildYouTubeUrl('videos', {
    part: 'statistics,contentDetails',
    id: videoIds.join(','),
    key: apiKey,
  });
  const statisticsData = await fetchYouTubeJson<YouTubeVideosResponse>(
    statisticsUrl,
    'YouTube 视频播放量和时长读取',
  );
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
  const enrichedVideos = videos.map((item) => ({
      ...item,
      viewCount: statisticsById.get(item.videoId)?.viewCount ?? null,
      likeCount: statisticsById.get(item.videoId)?.likeCount ?? null,
      commentCount: statisticsById.get(item.videoId)?.commentCount ?? null,
      durationSeconds: statisticsById.get(item.videoId)?.durationSeconds ?? null,
    }));
  const longFormVideos = enrichedVideos.filter(
    (item) => typeof item.durationSeconds === 'number' && item.durationSeconds > 180,
  );
  if (longFormVideos.length) return { videos: longFormVideos.slice(0, maxVideos) };
  return {
    videos: enrichedVideos.slice(0, maxVideos),
    warning: '近期公开视频以 Shorts 或短视频为主，当前显示最新短视频。',
  };
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
  const includeRecentVideos = (body as { includeRecentVideos?: unknown }).includeRecentVideos !== false;
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
        let recentVideos: Awaited<ReturnType<typeof fetchRecentVideos>>['videos'] = [];
        let recentVideosStatus: 'ready' | 'empty' | 'error' = 'empty';
        const youtubeDataWarnings: string[] = [];
        if (includeRecentVideos) {
          try {
            const recentVideoResult = await fetchRecentVideos(
              apiKey,
              channel.contentDetails?.relatedPlaylists?.uploads || '',
              maxVideos,
            );
            recentVideos = recentVideoResult.videos;
            recentVideosStatus = recentVideos.length ? 'ready' : 'empty';
            if (recentVideoResult.warning) youtubeDataWarnings.push(recentVideoResult.warning);
          } catch (error) {
            recentVideosStatus = 'error';
            youtubeDataWarnings.push(
              error instanceof Error ? error.message : '最近视频读取失败。',
            );
            errors.push({
              sourceUrl: source?.sourceUrl || `https://www.youtube.com/channel/${channel.id}`,
              error: error instanceof Error ? error.message : '最近视频读取失败。',
            });
          }
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
          youtubeDataStatus: recentVideosStatus === 'error' ? 'partial' : 'complete',
          youtubeDataWarnings,
          youtubeLastFetchedAt: new Date().toISOString(),
          recentVideosStatus,
          descriptionStatus: description ? 'ready' : 'empty',
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
