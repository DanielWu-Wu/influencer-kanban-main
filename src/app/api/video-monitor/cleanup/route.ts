import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequestUser } from '@/lib/supabase/server';
import { refreshStoredFeishuAuth } from '@/lib/feishu-cloud-auth';
import { requestFeishuApi, resolveFeishuBaseUrl } from '@/lib/feishu-base';
import { readMonitorData, writeMonitorData, monitorTableKey, saveMonitorCheckpoint } from '@/lib/video-monitor-server';
import { decodeMonitorCloud } from '@/lib/video-monitor-cloud-codec';
import { packMonitorState, unpackMonitorState } from '@/lib/video-monitor-storage';
import { compactCompletedMonitor } from '@/lib/video-monitor-workflow';
import { monitorRetentionCandidates, type MonitorStorageRow } from '@/lib/video-monitor-retention';
import type { FeishuFieldMapping } from '@/lib/feishu-mapping';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CachedFeishuRecord } from '@/lib/feishu-record-cache';

export const maxDuration = 60;
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), table: z.string().max(2000), mapping: z.record(z.string(), z.string().max(200)), revision: z.string().nullable() }),
  z.object({ action: z.literal('apply'), token: z.string().uuid() }),
  z.object({ action: z.literal('maintain'), table: z.string().max(2000), mapping: z.record(z.string(), z.string().max(200)), revision: z.string().nullable() }),
]);
type CleanupPlan = { table: string; mapping: FeishuFieldMapping; revision: string | null; createdAt: number; candidates: { key: string; revision: string }[] };
async function storageRows(db: SupabaseClient, userId: string) {
  const rows: MonitorStorageRow[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await db.from('user_data').select('data_key,data,updated_at').eq('user_id', userId)
      .like('data_key', 'video_%').order('data_key').range(page * 200, page * 200 + 199);
    if (error) throw new Error('存储清单读取失败，未清理。');
    rows.push(...(data || []).map(row => ({ ...row, data: decodeMonitorCloud(row.data) })));
    if (!data || data.length < 200) return rows;
  }
  throw new Error('存储清单分页未完成，未清理。');
}
async function compact(db: SupabaseClient, userId: string, plan: CleanupPlan) {
  const key = monitorTableKey(plan.table), saved = await readMonitorData(db, userId, key);
  if ((saved?.revision || null) !== plan.revision) throw new Error('检测记录已变化，请重新查看清理预览。');
  if (!saved) return { state: null, count: 0, revision: null };
  const state = unpackMonitorState(saved.value);
  const targets = state.results.filter(item => item.feishuSyncedAt && !item.compactedAt && !item.writeAttempt);
  if (!targets.length) return { ...compactCompletedMonitor(state, [], plan.mapping), revision: saved.revision };
  const feishu = await refreshStoredFeishuAuth(db);
  const location = await resolveFeishuBaseUrl(plan.table, feishu.accessToken);
  if (!location.tableId) throw new Error('合作表链接缺少子表 ID。');
  const records: CachedFeishuRecord[] = [];
  for (const id of new Set(targets.map(item => item.project.id))) {
    // A missing/deleted record is retained for manual diagnosis, rather than inferred completed.
    try {
      const result = await requestFeishuApi<{ record: CachedFeishuRecord }>(`/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables/${encodeURIComponent(location.tableId)}/records/${encodeURIComponent(id)}`, feishu.accessToken);
      records.push(result.record);
    } catch { /* This record is not eligible for compaction. */ }
  }
  const result = compactCompletedMonitor(state, records, plan.mapping);
  return { ...result, revision: saved.revision };
}
export async function POST(request: NextRequest) {
  const auth = await getRequestUser(request);
  if (!auth) return NextResponse.json({ error: '请先登录。' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '存储整理参数无效。' }, { status: 400 });
  try {
    const body = parsed.data;
    const policy = await readMonitorData<{ enabled: boolean }>(auth.supabase, auth.user.id, 'video_storage_policy');
    if (body.action === 'maintain' && !policy?.value.enabled) return NextResponse.json({ enabled: false });
    let plan: CleanupPlan;
    if (body.action === 'apply') {
      const saved = await readMonitorData<CleanupPlan>(auth.supabase, auth.user.id, `video_cleanup_${body.token}`);
      if (!saved || Date.now() - saved.value.createdAt > 10 * 60_000) throw new Error('整理预览已过期，请重新读取。');
      plan = saved.value;
    } else {
      const rows = await storageRows(auth.supabase, auth.user.id);
      plan = { table: body.table, mapping: body.mapping as FeishuFieldMapping, revision: body.revision, createdAt: Date.now(),
        candidates: monitorRetentionCandidates(rows).map(row => ({ key: row.data_key, revision: row.updated_at })) };
    }
    const result = await compact(auth.supabase, auth.user.id, plan);
    if (body.action === 'preview') {
      const token = crypto.randomUUID();
      await writeMonitorData(auth.supabase, auth.user.id, `video_cleanup_${token}`, plan, null);
      const original = await readMonitorData(auth.supabase, auth.user.id, monitorTableKey(plan.table));
      const previous = new Map((original ? unpackMonitorState(original.value).results : []).map(item => [item.key, item]));
      return NextResponse.json({ token, compactCount: result.count, deleteCount: plan.candidates.length,
        compactItems: result.state?.results.filter(item => item.compactedAt && !previous.get(item.key)?.compactedAt)
          .map(item => ({ key: item.key, name: item.project.name, title: item.video.title })) || [],
        rows: plan.candidates.map(row => ({ kind: row.key.startsWith('video_write_') ? '过期写回预览' : row.key.startsWith('video_cleanup_') ? '过期整理预览' : '超过90天的已完成字幕缓存', key: row.key })) });
    }
    let revision = result.revision;
    if (result.state) {
      result.state.saveId = crypto.randomUUID();
      revision = await saveMonitorCheckpoint(auth.supabase, auth.user.id, monitorTableKey(plan.table), packMonitorState(result.state), result.revision, result.state.saveId);
    }
    // Recheck all tables' active references immediately before deleting a frozen, versioned candidate.
    const eligible = new Map(monitorRetentionCandidates(await storageRows(auth.supabase, auth.user.id)).map(row => [row.data_key, row.updated_at]));
    let deleted = 0;
    for (const row of plan.candidates) {
      if (eligible.get(row.key) !== row.revision) continue;
      const { data, error } = await auth.supabase.from('user_data').delete().eq('user_id', auth.user.id).eq('data_key', row.key).eq('updated_at', row.revision).select('data_key');
      if (error) throw new Error(`整理部分完成：已清理 ${deleted} 条。其余记录保留，请重新读取。`);
      deleted += data?.length || 0;
    }
    if (body.action === 'apply') await writeMonitorData(auth.supabase, auth.user.id, 'video_storage_policy', { enabled: true }, policy?.revision || null);
    return NextResponse.json({ enabled: true, state: result.state, revision, compactCount: result.count, deleted });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '存储整理失败，未清理未完成记录。' }, { status: 409 });
  }
}
