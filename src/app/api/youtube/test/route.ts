import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/supabase/server';
import { getUserSecret } from '@/lib/user-private-storage';

type YouTubeApiError = {
  error?: {
    message?: string;
    code?: number;
  };
};

type YouTubeSearchResponse = YouTubeApiError & {
  items?: unknown[];
};

async function getStoredYouTubeKey(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return '';
  const value = await getUserSecret<string>(auth.supabase, 'youtube_api_key');
  return value || '';
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const providedKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiKey = providedKey || process.env.YOUTUBE_API_KEY || await getStoredYouTubeKey(request);

  if (!apiKey) {
    return NextResponse.json({ error: '缺少 YouTube API Key。' }, { status: 400 });
  }

  const regionCode = typeof body.regionCode === 'string' && body.regionCode.trim()
    ? body.regionCode.trim().toUpperCase().slice(0, 2)
    : 'ES';

  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('type', 'channel');
  url.searchParams.set('q', 'vanlife');
  url.searchParams.set('maxResults', '1');
  url.searchParams.set('regionCode', regionCode);
  url.searchParams.set('key', apiKey);

  try {
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json() as YouTubeSearchResponse;

    if (!response.ok || data.error) {
      throw new Error(data.error?.message || `YouTube API 测试失败 (${response.status})`);
    }

    return NextResponse.json({
      success: true,
      itemCount: data.items?.length || 0,
      regionCode,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'YouTube API 连接测试失败。' },
      { status: 500 },
    );
  }
}
