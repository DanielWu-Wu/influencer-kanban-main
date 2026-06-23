import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/supabase/server';
import { getUserSecret } from '@/lib/user-private-storage';

type YouTubeErrorResponse = {
  error?: {
    message?: string;
  };
};

type YouTubeSearchItem = {
  id?: {
    channelId?: string;
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
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
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

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const apiKey = await resolveYouTubeKey(request, typeof body.apiKey === 'string' ? body.apiKey : undefined);

  if (!apiKey) {
    return NextResponse.json({ error: '缺少 YouTube API Key。' }, { status: 400 });
  }
  if (!query) {
    return NextResponse.json({ error: '请输入搜索关键词。' }, { status: 400 });
  }

  const maxResults = Math.min(50, Math.max(1, Number(body.maxResults) || 10));
  const regionCode = typeof body.regionCode === 'string' ? body.regionCode.trim().toUpperCase().slice(0, 2) : '';
  const relevanceLanguage = typeof body.relevanceLanguage === 'string' ? body.relevanceLanguage.trim().toLowerCase() : '';

  try {
    const searchUrl = buildYouTubeUrl('search', {
      part: 'snippet',
      type: 'channel',
      q: query,
      maxResults: String(maxResults),
      regionCode,
      relevanceLanguage,
      key: apiKey,
    });

    const searchResponse = await fetch(searchUrl, { cache: 'no-store' });
    const searchData = await searchResponse.json() as YouTubeSearchResponse;
    if (!searchResponse.ok || searchData.error) {
      throw new Error(searchData.error?.message || `YouTube 搜索失败 (${searchResponse.status})`);
    }

    const channelIds = Array.from(
      new Set((searchData.items || []).map((item) => item.id?.channelId).filter(Boolean) as string[]),
    );

    if (!channelIds.length) {
      return NextResponse.json({ success: true, channels: [] });
    }

    const channelsUrl = buildYouTubeUrl('channels', {
      part: 'snippet,statistics',
      id: channelIds.join(','),
      key: apiKey,
    });

    const channelsResponse = await fetch(channelsUrl, { cache: 'no-store' });
    const channelsData = await channelsResponse.json() as YouTubeChannelsResponse;
    if (!channelsResponse.ok || channelsData.error) {
      throw new Error(channelsData.error?.message || `YouTube 频道详情读取失败 (${channelsResponse.status})`);
    }

    const channels = (channelsData.items || []).map((channel) => ({
      channelId: channel.id,
      title: channel.snippet?.title || '',
      description: channel.snippet?.description || '',
      customUrl: channel.snippet?.customUrl || '',
      publishedAt: channel.snippet?.publishedAt || '',
      thumbnail:
        channel.snippet?.thumbnails?.high?.url ||
        channel.snippet?.thumbnails?.medium?.url ||
        channel.snippet?.thumbnails?.default?.url ||
        '',
      subscriberCount: channel.statistics?.hiddenSubscriberCount ? null : Number(channel.statistics?.subscriberCount || 0),
      viewCount: Number(channel.statistics?.viewCount || 0),
      videoCount: Number(channel.statistics?.videoCount || 0),
      url: `https://www.youtube.com/channel/${channel.id}`,
    }));

    return NextResponse.json({ success: true, channels });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'YouTube 搜索失败。' },
      { status: 500 },
    );
  }
}
