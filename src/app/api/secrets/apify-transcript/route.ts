import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequestUser } from '@/lib/supabase/server';
import { getUserSecret, setUserSecret } from '@/lib/user-private-storage';
import { apifyRequest, type ApifyConfig } from '@/lib/video-monitor-server';
import { VIDEO_MONITOR_ACTOR, VIDEO_MONITOR_RUN_LIMIT } from '@/lib/video-monitor';

export async function GET(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录账号。' }, { status: 401 });
  try {
    const config = await getUserSecret<ApifyConfig>(auth.supabase, 'apify_transcript');
    return NextResponse.json({ configured: !!config?.token, enabled: config?.enabled ?? false, maxSubtitles: VIDEO_MONITOR_RUN_LIMIT, maxAi: VIDEO_MONITOR_RUN_LIMIT });
  } catch { return NextResponse.json({ error: '字幕设置读取失败。' }, { status: 503 }); }
}
export async function POST(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录账号。' }, { status: 401 });
  const input = z.object({ token: z.string().max(500).optional(), enabled: z.boolean(), test: z.boolean().optional() }).safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: '字幕设置无效。' }, { status: 400 });
  try {
    const old = await getUserSecret<ApifyConfig>(auth.supabase, 'apify_transcript');
    const config = { ...input.data, token: input.data.token?.trim() || old?.token || '', maxSubtitles: VIDEO_MONITOR_RUN_LIMIT, maxAi: VIDEO_MONITOR_RUN_LIMIT };
    if (input.data.test) {
      if (!config.token) throw new Error('missing token');
      await apifyRequest(config.token, `actors/${VIDEO_MONITOR_ACTOR}`);
    } else await setUserSecret(auth.supabase, 'apify_transcript', config);
    return NextResponse.json({ success: true, configured: !!config.token });
  } catch { return NextResponse.json({ error: input.data.test ? '连接测试失败，请检查 Token 和网络；没有启动字幕抓取。' : '字幕设置保存失败，请重试。' }, { status: 503 }); }
}
