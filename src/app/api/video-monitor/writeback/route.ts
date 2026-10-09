import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequestUser } from '@/lib/supabase/server';
import { getUserSecret } from '@/lib/user-private-storage';
import { refreshStoredFeishuAuth } from '@/lib/feishu-cloud-auth';
import { resolveFeishuBaseUrl, requestFeishuApi } from '@/lib/feishu-base';
import { readMonitorData, writeMonitorData, monitorTableKey } from '@/lib/video-monitor-server';
import { unpackMonitorState } from '@/lib/video-monitor-storage';
import { buildVideoWritePlan, sameVideoWriteFields, type VideoWritePreview } from '@/lib/video-monitor-writeback';

export const maxDuration = 60;
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), table: z.string().max(2000), key: z.string().max(200), mapping: z.record(z.string(), z.string().max(200)) }),
  z.object({ action: z.literal('commit'), token: z.string().uuid() }),
]);
type StoredPreview = { table: string; key: string; path: string; write: Record<string, unknown>; original: Record<string, unknown>; preview: VideoWritePreview; completedAt?: number; submittingAt?: number };

export async function POST(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '写回参数无效。' }, { status: 400 });
  let submitted = false;
  try {
    const body = parsed.data;
    const feishu = await refreshStoredFeishuAuth(auth.supabase);
    const getRecord = (path: string) => requestFeishuApi<{ record: { record_id: string; fields: Record<string, unknown> } }>(path, feishu.accessToken);
    if (body.action === 'preview') {
      const saved = await readMonitorData(auth.supabase, auth.user.id, monitorTableKey(body.table));
      const result = saved && unpackMonitorState(saved.value).results.find(item => item.key === body.key);
      if (!result || result.status !== 'confirmed') throw new Error('请先确认该视频属于此合作，并确保检测记录已保存。');
      const location = await resolveFeishuBaseUrl(body.table, feishu.accessToken);
      if (!location.tableId) throw new Error('合作表链接缺少子表 ID，请重新配置详细合作记录表链接。');
      const base = `/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables/${encodeURIComponent(location.tableId)}`;
      const path = `${base}/records/${encodeURIComponent(result.project.id)}`;
      const [record, youtubeKey] = await Promise.all([getRecord(path), getUserSecret<string>(auth.supabase, 'youtube_api_key')]);
      if (!youtubeKey) throw new Error('请先配置 YouTube API Key。');
      const fields: { field_name: string; type: number }[] = [];
      let page = '';
      do {
        const data: { items?: typeof fields; has_more?: boolean; page_token?: string } = await requestFeishuApi(`${base}/fields?page_size=100${page ? `&page_token=${encodeURIComponent(page)}` : ''}`, feishu.accessToken);
        fields.push(...(data.items || []));
        if (data.has_more && (!data.page_token || data.page_token === page)) throw new Error('飞书字段分页不完整。');
        page = data.has_more ? data.page_token! : '';
      } while (page);
      const query = new URLSearchParams({ part: 'snippet,statistics,status', id: result.video.id, key: youtubeKey });
      const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`YouTube 读取失败（${response.status}），请检查额度。`);
      const video = (await response.json()).items?.[0];
      if (video?.id !== result.video.id || video.snippet?.channelId !== result.video.channelId || video.status?.privacyStatus !== 'public') throw new Error('视频不可用或频道不一致，未写入飞书。');
      const plan = buildVideoWritePlan(body.mapping, new Map(fields.map(field => [field.field_name, field.type])), record.record.fields, { id: video.id, channelId: video.snippet.channelId, title: video.snippet.title, publishedAt: video.snippet.publishedAt, statistics: video.statistics || {} });
      const token = crypto.randomUUID();
      const preview: VideoWritePreview = { token, name: result.project.name, products: result.project.products, title: video.snippet.title, recordId: result.project.id, fetchedAt: Date.now(), rows: plan.rows };
      await writeMonitorData(auth.supabase, auth.user.id, `video_write_${token}`, { table: body.table, key: body.key, path, write: plan.write, original: plan.original, preview } satisfies StoredPreview, null);
      return NextResponse.json({ preview });
    }
    const storageKey = `video_write_${body.token}`;
    const stored = await readMonitorData<StoredPreview>(auth.supabase, auth.user.id, storageKey);
    if (!stored) throw new Error('写回预览不存在，请重新预览。');
    const plan = stored.value;
    if (Date.now() - plan.preview.fetchedAt > 10 * 60_000) throw new Error('预览已超过10分钟，请重新读取最新数据。');
    const saved = await readMonitorData(auth.supabase, auth.user.id, monitorTableKey(plan.table));
    if (!saved || unpackMonitorState(saved.value).results.find(item => item.key === plan.key)?.status !== 'confirmed') throw new Error('该视频已不再是已确认状态，请重新核对。');
    const before = (await getRecord(plan.path)).record.fields;
    if (sameVideoWriteFields(before, plan.write)) return NextResponse.json({ syncedAt: plan.completedAt || Date.now(), alreadyApplied: true });
    if (!sameVideoWriteFields(before, plan.original)) throw new Error('飞书这5个字段已被修改，未覆盖。请重新打开写回预览核对。');
    if (plan.submittingAt && Date.now() - plan.submittingAt < 60_000) throw new Error('这次写回仍在提交或核实中，请稍等一分钟后重试。');
    // Reserve this preview version so concurrent duplicate confirmations cannot both write.
    const reserved = await writeMonitorData(auth.supabase, auth.user.id, storageKey, { ...plan, submittingAt: Date.now() }, stored.revision);
    submitted = true;
    await requestFeishuApi(plan.path, feishu.accessToken, { method: 'PUT', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ fields: plan.write }) });
    if (!sameVideoWriteFields((await getRecord(plan.path)).record.fields, plan.write)) throw new Error('写回后读取的值与预览不一致，请核对飞书。');
    const syncedAt = Date.now();
    await writeMonitorData(auth.supabase, auth.user.id, storageKey, { ...plan, completedAt: syncedAt }, reserved).catch(() => undefined);
    return NextResponse.json({ syncedAt });
  } catch (error) {
    return NextResponse.json({ error: (submitted ? '写入请求已提交，请先核对飞书；可在此预览中重试核实，勿改写其他视频。' : '') + (error instanceof Error ? error.message : '写回失败。') }, { status: 409 });
  }
}
