import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequestUser } from '@/lib/supabase/server';
import { getUserSecret } from '@/lib/user-private-storage';
import { emptyMonitorState, type MonitorState } from '@/lib/video-monitor';
import { packMonitorState, unpackMonitorState } from '@/lib/video-monitor-storage';
import { monitorTableKey, readMonitorData, saveMonitorCheckpoint, MonitorSaveError, resolveMonitorChannel, fetchMonitorVideoPage, monitorTranscript, monitorTranscriptBatch, type ApifyConfig } from '@/lib/video-monitor-server';

export const maxDuration = 60;
const command = z.discriminatedUnion('action', [
  z.object({ action: z.literal('resolve'), channel: z.string().max(1000) }),
  z.object({ action: z.literal('page'), channelId: z.string().max(30), playlist: z.string().max(30), page: z.string().max(1000).optional() }),
  z.object({ action: z.literal('transcript'), videoId: z.string().regex(/^[\w-]{11}$/), retry: z.boolean().optional(), recoverRunId: z.string().max(100).optional() }),
  z.object({ action: z.literal('transcripts'), videoIds: z.array(z.string().regex(/^[\w-]{11}$/)).min(1).max(50), recoverRunId: z.string().max(100).optional() }),
]);
export async function GET(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录账号。' }, { status: 401 });
  try {
    const saved = await readMonitorData<MonitorState>(auth.supabase, auth.user.id, monitorTableKey(request.nextUrl.searchParams.get('table') || ''));
    return NextResponse.json({ state: saved ? unpackMonitorState(saved.value) : emptyMonitorState(), revision: saved?.revision || null });
  } catch { return NextResponse.json({ error: '检测记录读取失败，请核实合作表链接并重试。' }, { status: 503 }); }
}
export async function PUT(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录账号。' }, { status: 401 });
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 4_000_000) return NextResponse.json({ error: '检测记录超过保存大小限制，进度保留在本机。', code: 'SAVE_TOO_LARGE' }, { status: 413 });
    let body, state: MonitorState, key: string;
    try { body = JSON.parse(text); state = unpackMonitorState(body.state); key = monitorTableKey(body.table); }
    catch { return NextResponse.json({ error: '检测记录格式无效，未覆盖已有记录。', code: 'SAVE_INVALID' }, { status: 400 }); }
    const saveId = typeof body.saveId === 'string' && body.saveId.length <= 100 ? body.saveId : crypto.randomUUID();
    const revision = await saveMonitorCheckpoint(auth.supabase, auth.user.id, key, packMonitorState(state), typeof body.revision === 'string' ? body.revision : null, saveId);
    return NextResponse.json({ revision });
  } catch (error) {
    const failure = error instanceof MonitorSaveError ? error : new MonitorSaveError('SAVE_UNAVAILABLE');
    return NextResponse.json({ error: failure.message, code: failure.code }, { status: failure.code === 'SAVE_CONFLICT' ? 409 : 503 });
  }
}
export async function POST(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录账号。' }, { status: 401 });
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '检测参数无效。' }, { status: 400 });
  try {
    const body = parsed.data;
    if (body.action === 'transcript' || body.action === 'transcripts') {
      const config = await getUserSecret<ApifyConfig>(auth.supabase, 'apify_transcript');
      const settings = config || { token: '', enabled: false, maxSubtitles: 50, maxAi: 50 };
      return NextResponse.json(body.action === 'transcript'
        ? await monitorTranscript(auth.supabase, auth.user.id, settings, body.videoId, body)
        : await monitorTranscriptBatch(auth.supabase, auth.user.id, settings, body.videoIds, body.recoverRunId));
    }
    const key = await getUserSecret<string>(auth.supabase, 'youtube_api_key');
    if (!key) return NextResponse.json({ error: '请先在设置中配置 YouTube API Key。' }, { status: 400 });
    return NextResponse.json(body.action === 'resolve' ? await resolveMonitorChannel(key, body.channel)
      : await fetchMonitorVideoPage(key, body.channelId, body.playlist, body.page));
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return NextResponse.json({ error: /频道|字幕|检测|YouTube|Apify/.test(message) ? message : '检测连接暂时失败，请稍后重试。' }, { status: 503 });
  }
}
