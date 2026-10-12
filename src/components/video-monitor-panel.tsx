'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, ChevronRight, ExternalLink, ImageOff, LoaderCircle, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useSettings } from '@/lib/data';
import { ACCOUNT_SCOPE_CHANGED_EVENT, getAccountCacheScope } from '@/lib/account-cache-scope';
import { fetchFeishuRecordSnapshot, invalidateFeishuRecordsCache } from '@/lib/feishu-record-cache';
import type { VideoWritePreview } from '@/lib/video-monitor-writeback';
import type { FeishuFieldMapping } from '@/lib/feishu-mapping';
import { workspaceFetch } from '@/lib/workspace-request';
import { applyMonitorDecision, createMonitorJob, emptyMonitorState, monitorProjects, restoreMonitorPendingProgress, VIDEO_MONITOR_RUN_LIMIT, type MonitorState, type MonitorResult, type MonitorProject, type MonitorVideo, type MonitorPendingProgress, type VideoAssessment } from '@/lib/video-monitor';
import { monitorSerialQueue, packMonitorState } from '@/lib/video-monitor-storage';
import { conflictingMonitorKeys, monitorCategory, monitorNeedsAttention, preferredMonitorCategory, reconcileMonitorLinks } from '@/lib/video-monitor-workflow';
import { runMonitor, type MonitorSubtitle as SubtitleResult, type MonitorSubtitleBatch as SubtitleBatchResult, type MonitorOptions as Options } from '@/lib/video-monitor-runner';

type LocalSnapshot = { state: MonitorState; revision: string | null };
type CleanupPreview = { token: string; compactCount: number; deleteCount: number; compactItems?: { key: string; name: string; title: string }[]; rows: { kind: string; key: string }[] };
class MonitorRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const timingLabels = { new: '新发布', early: '疑似提前发布', normal: '发布时间符合预期', uncertain: '预计时间待核实' };

function VideoMonitorThumbnail({ video, large = false }: { video: MonitorVideo; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <div className={`${large ? 'video-write-thumbnail' : 'video-monitor-thumbnail'} relative shrink-0 overflow-hidden rounded-md border bg-slate-100`} style={{ width: large ? 320 : 192, maxWidth: '100%', aspectRatio: '16 / 9' }}>
    {failed ? <span className="flex h-full items-center justify-center gap-1 text-xs text-muted-foreground"><ImageOff className="size-4" />暂无封面</span> :
      // Thumbnail URLs derive from existing IDs, including previously saved results.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/${large ? 'hqdefault' : 'mqdefault'}.jpg`} alt={`${video.title}的视频封面`} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />}
  </div>;
}

function writeValueChanged(row: VideoWritePreview['rows'][number], index: number) {
  if (row.skip) return false;
  const normalize = (value: string) => index === 0 ? value.replace(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/, (_, year, month, day) => `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`) : value;
  return normalize(row.before) !== normalize(row.after);
}

type MonitorPanelProps = { url: string; mapping: FeishuFieldMapping; onProjectUpdated?: () => void };
const subscribeScope = (callback: () => void) => {
  window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, callback);
  return () => window.removeEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, callback);
};
export function VideoMonitorPanel(props: MonitorPanelProps) {
  const account = useSyncExternalStore(subscribeScope, getAccountCacheScope, () => 'signed-out');
  return <AccountVideoMonitor key={`${account}:${props.url}`} {...props} />;
}

function AccountVideoMonitor({ url, mapping, onProjectUpdated }: MonitorPanelProps) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<MonitorState>(emptyMonitorState);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState('pending');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => new Set());
  const [batchPreviews, setBatchPreviews] = useState<{ key: string; name: string; preview?: VideoWritePreview; error?: string }[] | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(null);
  const [writePreview, setWritePreview] = useState<VideoWritePreview | null>(null);
  const [writeError, setWriteError] = useState('');
  const writeResultKey = useRef('');
  const [projects, setProjects] = useState<MonitorProject[]>([]);
  const [recovery, setRecovery] = useState<LocalSnapshot | null>(null);
  const [batchRecoveryIds, setBatchRecoveryIds] = useState<string[]>([]);
  const revision = useRef<string | null>(null);
  const current = useRef(state);
  const pending = useRef<Map<string, MonitorResult>>(new Map());
  const pendingCount = useRef(0);
  const saves = useRef(monitorSerialQueue());
  const running = useRef(false);
  const alive = useRef(true);
  const scope = useRef(getAccountCacheScope());
  const localKey = `video-monitor-recovery:${scope.current}:${url}`;
  const pendingKey = `video-monitor-pending:${scope.current}:${url}`;
  useEffect(() => {
    alive.current = true;
    const stop = () => { running.current = false; alive.current = false; setOpen(false); setLoaded(false); };
    window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, stop);
    return () => { stop(); window.removeEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, stop); };
  }, []);

  function checkIdentity() {
    if (!alive.current || scope.current !== getAccountCacheScope()) throw new Error('账号或页面已变化，检测已暂停。');
  }
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    checkIdentity();
    const response = await fetch(path, { signal: AbortSignal.timeout(60000), ...init });
    const result = await response.json().catch(() => ({}));
    checkIdentity();
    if (!response.ok) throw new MonitorRequestError(result.error || `连接失败（${response.status}），请重试。`, response.status);
    return result as T;
  }
  function command<T>(body: unknown) {
    return request<T>('/api/video-monitor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function persist(next: MonitorState) { return saves.current(async () => {
    checkIdentity();
    next.saveId = crypto.randomUUID();
    current.current = next; setState(structuredClone(next));
    try { localStorage.setItem(localKey, JSON.stringify({ state: next, revision: revision.current })); } catch { /* Cloud save remains authoritative. */ }
    const body = JSON.stringify({ table: url, state: packMonitorState(next), revision: revision.current, saveId: next.saveId });
    let saved: { revision: string };
    try { saved = await request('/api/video-monitor', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body }); }
    catch (error) {
      if (error instanceof MonitorRequestError && error.status < 500) throw error;
      // Retry exactly the same save ID; server checks if the first write already succeeded.
      saved = await request('/api/video-monitor', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    }
    revision.current = saved.revision;
    // Cloud acknowledged this exact save; no recovery duplicate is needed.
    try { localStorage.removeItem(localKey); } catch { /* Cloud save succeeded. */ }
    pending.current.clear(); pendingCount.current = 0;
    try { localStorage.removeItem(pendingKey); } catch { /* Cloud save already succeeded. */ }
  }); }
  async function stageVideo(next: MonitorState, changed: MonitorResult[]) {
    checkIdentity();
    current.current = next;
    setState({ ...next, results: [...next.results], job: next.job ? { ...next.job } : undefined });
    changed.forEach(result => pending.current.set(result.key, result));
    pendingCount.current += 1;
    try {
      const progress: MonitorPendingProgress = { version: 1, revision: revision.current,
        startedAt: next.job!.startedAt, cursor: next.job!.cursor, completedVideoIds: next.job!.completedVideoIds, results: [...pending.current.values()] };
      localStorage.setItem(pendingKey, JSON.stringify(progress));
    } catch {
      // If local recovery is unavailable, do not leave this video only in memory.
      await persist(next);
      return;
    }
    if (pendingCount.current >= 50) await persist(next);
  }
  async function load() {
    setCheckedKeys(new Set()); setBatchPreviews(null);
    setLoaded(false); setMessage('正在读取检测记录…');
    try {
      const [saved, snapshot] = await Promise.all([
        request<{ state: MonitorState; revision: string | null }>(`/api/video-monitor?table=${encodeURIComponent(url)}`),
        fetchFeishuRecordSnapshot(url),
      ]);
      checkIdentity();
      revision.current = saved.revision; current.current = saved.state; setState(saved.state);
      setFilter(preferredMonitorCategory(saved.state));
      saves.current = monitorSerialQueue();
      pending.current.clear(); pendingCount.current = 0;
      setProjects(monitorProjects(snapshot.records, mapping));
      setRecovery(null);
      try {
        const local = JSON.parse(localStorage.getItem(localKey) || 'null') as LocalSnapshot | null;
        const acknowledged = !!local?.state.saveId && local.state.saveId === saved.state.saveId;
        if (local && !acknowledged && JSON.stringify(local.state) !== JSON.stringify(saved.state)) {
          if (local.revision === saved.revision) { setRecovery(local); setMessage('发现本机待同步结果，请先恢复。'); }
          else setMessage('本机另有旧快照，云端已更新；本次使用云端记录，不覆盖其他窗口的成果。');
        } else {
          const queued = JSON.parse(localStorage.getItem(pendingKey) || 'null') as MonitorPendingProgress | null;
          const restored = queued && restoreMonitorPendingProgress(saved.state, saved.revision, queued);
          if (restored && (restored.job?.cursor !== saved.state.job?.cursor || queued.results.length)) setRecovery({ state: restored, revision: saved.revision });
          else if (queued && queued.revision !== saved.revision && !acknowledged) setMessage('本机有待同步进度，但云端已由其他窗口更新；未覆盖云端记录。');
          else setMessage('');
        }
      } catch { setMessage('本机快照无法读取，已使用云端记录。'); }
      setLoaded(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : '检测记录读取失败。'); }
  }
  function show() { setOpen(true); if (!busy) void load(); }
  async function recoverLocal() {
    if (busy || !recovery) return;
    setBusy(true); setMessage('正在核对云端记录并恢复本机结果…');
    try {
      const saved = await request<LocalSnapshot>(`/api/video-monitor?table=${encodeURIComponent(url)}`);
      const acknowledged = !!recovery.state.saveId && recovery.state.saveId === saved.state.saveId;
      if (!acknowledged && saved.revision !== recovery.revision) {
        throw new Error('云端记录已变化，未覆盖云端或本机结果。请重新读取后核对。');
      }
      // Recovery is an explicit new attempt after all previous workers have stopped.
      // Do not reuse the failed queue, or every retry would reject without a request.
      saves.current = monitorSerialQueue();
      revision.current = saved.revision;
      if (!acknowledged) {
        const attempt = { state: structuredClone(recovery.state), revision: saved.revision };
        setRecovery(attempt);
        await persist(attempt.state);
      }
      else {
        current.current = saved.state; setState(saved.state);
        try { localStorage.setItem(localKey, JSON.stringify(saved)); } catch { /* Keep existing evidence. */ }
      }
      setRecovery(null); setLoaded(true); setMessage('本机结果已恢复，可以继续检测。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败，本机结果仍保留，可再次点击恢复。');
    } finally { setBusy(false); }
  }
  async function assess(project: MonitorProject, video: MonitorVideo, evidence: MonitorResult['evidence']) {
    checkIdentity();
    const response = await workspaceFetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      action: 'cooperationVideoAssessment', modelProvider: 'custom', customApiUrl: settings.customApiUrl,
      customModelName: settings.customModelName, project: { id: project.id, name: project.name, products: project.products, expected: project.expected }, video, evidence,
    }) });
    const result = await response.json();
    checkIdentity();
    if (!response.ok || !result.data) throw new Error(result.error || 'AI 分析失败。');
    return result.data as VideoAssessment;
  }

  async function assessWithRetry(project: MonitorProject, video: MonitorVideo, evidence: MonitorResult['evidence']) {
    for (let attempt = 0; ; attempt++) {
      try { return await assess(project, video, evidence); }
      catch (error) {
        // Only explicit rate limiting is safe to retry automatically: an ambiguous timeout may have been billed.
        if (attempt >= 2 || !/\b429\b|请求过于频繁|rate.?limit|too many requests/i.test(error instanceof Error ? error.message : '')) throw error;
        setMessage('AI 请求过于频繁，稍等后自动重试…');
        await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
        checkIdentity();
        if (!running.current) throw new Error('已暂停，稍后可继续检测。');
      }
    }
  }
  async function readWithRetry<T>(body: unknown): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await command<T>(body); }
      catch (error) {
        if (attempt >= 2 || !(error instanceof MonitorRequestError) || ![429, 502, 503, 504].includes(error.status)) throw error;
        setMessage('频道读取暂时失败，稍等后自动重试…');
        await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
        checkIdentity();
        if (!running.current) throw new Error('已暂停，稍后可继续检测。');
      }
    }
  }

  async function run(fresh: boolean) {
    if (running.current || !loaded || recovery) return;
    setCheckedKeys(new Set());
    running.current = true; setBusy(true); setMessage('读取完整合作表…');
    const next = structuredClone(current.current);
    try {
      const configured = await request<Options>('/api/secrets/apify-transcript');
      const subtitleLimit = VIDEO_MONITOR_RUN_LIMIT;
      const aiLimit = VIDEO_MONITOR_RUN_LIMIT;
      if (fresh || !next.job) {
        const maintained = await request<{ state?: MonitorState; revision?: string; enabled: boolean }>('/api/video-monitor/cleanup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'maintain', table: url, mapping, revision: revision.current }),
        });
        if (maintained.state) { Object.assign(next, maintained.state); revision.current = maintained.revision || null; }
        // Preserve unfinished paid batch reservations when starting a new scan.
        const batches = next.job?.subtitleBatches || (next.job?.subtitleBatch ? [next.job.subtitleBatch] : []);
        const snapshot = await fetchFeishuRecordSnapshot(url, { force: true });
        checkIdentity();
        const all = monitorProjects(snapshot.records, mapping); setProjects(all);
        Object.assign(next, reconcileMonitorLinks(next, snapshot.records, mapping));
        next.job = createMonitorJob(all, next.continueIds);
        next.job.subtitleBatches = batches;
        await persist(next);
      } else if (next.job.phase === 'done') {
        next.job.phase = next.job.channels.some(c => !c.done) ? 'channels' : 'videos';
        next.job.cursor = 0; next.job.completedVideoIds = [];
        await persist(next);
      }
      setBatchRecoveryIds([]);
      const baselineSubtitles = next.job!.subtitleRequests;
      let aiUsed = 0;
      const automaticDeadline = Date.now() + 30 * 60_000;
      for (let pass = 0; pass < 100 && running.current; pass++) {
        const before = JSON.stringify(next.job!.channels.map(channel => [channel.page, channel.done]));
        const beforeVideos = next.job!.videos.length;
        const beforeCursor = next.job!.cursor;
        const remainingSubtitles = Math.max(0, subtitleLimit - (next.job!.subtitleRequests - baselineSubtitles));
        const reserved = new Set((next.job!.subtitleBatches || []).flat()).size;
        await runMonitor(next, { enabled: configured.enabled, maxSubtitles: remainingSubtitles + reserved, maxAi: Math.max(0, aiLimit - aiUsed) }, {
          active: () => running.current && alive.current, guard: checkIdentity, message: setMessage,
          save: persist, stage: stageVideo,
          assess: async (project, video, evidence) => { aiUsed++; return assessWithRetry(project, video, evidence); },
          recover: setBatchRecoveryIds,
          resolve: channel => readWithRetry({ action: 'resolve', channel }),
          page: (channelId, playlist, page) => readWithRetry({ action: 'page', channelId, playlist, page }),
          subtitles: videoIds => command({ action: 'transcripts', videoIds }),
        });
        const job = next.job!;
        if (job.phase === 'videos' && job.subtitleBatches?.length && Date.now() < automaticDeadline && running.current) {
          setMessage(`字幕任务仍在运行，自动等待后接续 · 已分析 ${job.cursor} / ${job.videos.length} 条视频`);
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        const pendingPages = job.channels.some(channel => channel.id && !channel.done && channel.page
          && (!channel.error || channel.error.includes('本次读取 400 条上传记录')));
        if (!pendingPages || !running.current || (before === JSON.stringify(job.channels.map(channel => [channel.page, channel.done])) && beforeVideos === job.videos.length && beforeCursor === job.cursor)) break;
        job.phase = 'channels';
        setMessage(`继续读取剩余频道页面 · 已分析 ${job.cursor} / ${job.videos.length} 条视频`);
        await persist(next);
      }
      const job = next.job!;
      const partial = job.channels.some(c => !c.done) || next.results.some(r => r.status === 'incomplete' || r.error);
      setMessage(!running.current ? '已暂停。下次继续时复用已保存记录。'
        : job.phase !== 'done' ? '进度已保存。字幕任务仍在运行或已达到自动等待时间，稍后可继续检测。'
        : partial ? `本次自动检测已结束。字幕调用上限 ${subtitleLimit} 条、AI 调用上限 ${aiLimit} 次；仍有资料不完整的视频，可按原因处理。`
        : `本轮检测结束：${job.projects.length} 条合作，${job.channels.length} 个频道。`);
    } catch (error) {
      if (alive.current) {
        setLoaded(false);
        setMessage(error instanceof Error ? error.message : '检测中断，已保留本机进度。');
      }
    } finally { running.current = false; if (alive.current) setBusy(false); }
  }

  async function decide(key: string, status: MonitorResult['status']) {
    if (busy || !loaded || recovery) return;
    setBusy(true);
    try { await persist(applyMonitorDecision(current.current, [key], status)); setCheckedKeys(previous => { const next = new Set(previous); next.delete(key); return next; }); }
    catch (error) { setLoaded(false); setMessage(error instanceof Error ? error.message : '保存失败。'); }
    finally { setBusy(false); }
  }
  async function decideBatch(status: MonitorResult['status']) {
    if (busy || !loaded || recovery) return;
    const keys = current.current.results.filter(result => checkedKeys.has(result.key) && (filter === 'all' || monitorCategory(result) === filter)
      && !result.feishuSyncedAt && !result.writeAttempt).map(result => result.key);
    if (!keys.length) return;
    setBusy(true);
    try {
      await persist(applyMonitorDecision(current.current, keys, status));
      setCheckedKeys(new Set());
      setMessage(`已将 ${keys.length} 个选中项移至${status === 'confirmed' ? '待写回' : status === 'pending' ? '待审核' : '已排除'}，未修改飞书。`);
    } catch (error) {
      setLoaded(false);
      setMessage(`批量结果云端保存失败，请重新读取并恢复本机快照。${error instanceof Error ? error.message : ''}`);
    } finally { setBusy(false); }
  }
  async function previewWrite(item: MonitorResult) {
    if (busy || !loaded || recovery || item.status !== 'confirmed') return;
    if (item.writeAttempt) { await verifyWrite(item); return; }
    setBusy(true); setWriteError(''); setMessage('正在读取飞书原值与最新视频统计…');
    try {
      const result = await request<{ preview: VideoWritePreview }>('/api/video-monitor/writeback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', table: url, key: item.key, mapping }) });
      writeResultKey.current = item.key;
      setWritePreview(result.preview); setMessage('请核对写回预览，确认后才更新飞书。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '写回预览失败。'); }
    finally { setBusy(false); }
  }
  function changeWriteResult(key: string, patch: Partial<MonitorResult>) {
    return persist({ ...current.current, results: current.current.results.map(item => item.key === key ? { ...item, ...patch } : item) });
  }
  async function writeOne(preview: VideoWritePreview, key: string) {
    // Save the token BEFORE the external write, so refresh/lost response can be verified without resubmission.
    try { await changeWriteResult(key, { writeAttempt: { token: preview.token }, writeError: undefined }); }
    catch { setLoaded(false); throw new Error('提交前保存失败，本项未写入飞书。请重新读取并恢复记录。'); }
    let result: { syncedAt: number };
    try {
      result = await request('/api/video-monitor/writeback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'commit', token: preview.token }) });
    } catch (error) {
      const message = error instanceof Error ? error.message : '写回结果待核实。';
      try { await changeWriteResult(key, { writeAttempt: { token: preview.token, error: message }, writeError: message }); }
      catch { setLoaded(false); throw new Error('写回结果与保存状态待核实，请重新读取并恢复。已保留原提交编号，不要重复写入。'); }
      throw error;
    }
    try { await changeWriteResult(key, { feishuSyncedAt: result.syncedAt, writeAttempt: undefined, writeError: undefined }); }
    catch { setLoaded(false); throw new Error('飞书已成功，但完成标记保存失败。请重新读取并恢复，再核对结果，不必重复写飞书。'); }
    setCheckedKeys(previous => { const next = new Set(previous); next.delete(key); return next; });
  }
  async function verifyWrite(item: MonitorResult) {
    if (busy || !item.writeAttempt || !loaded || recovery) return;
    setBusy(true);
    try {
      const result = await request<{ syncedAt?: number; notApplied?: boolean }>('/api/video-monitor/writeback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify', token: item.writeAttempt.token }) });
      if (result.syncedAt) {
        await changeWriteResult(item.key, { feishuSyncedAt: result.syncedAt, writeAttempt: undefined, writeError: undefined });
        invalidateFeishuRecordsCache(url); onProjectUpdated?.(); setMessage('已只读核对飞书，本项已写入，移至已完成。');
      } else if (result.notApplied) {
        await changeWriteResult(item.key, { writeAttempt: undefined, writeError: '已核对未应用，可重新预览并确认写回。' });
        setMessage('已核对未应用，本项可重新预览，不会自动提交。');
      }
    } catch (error) {
      try { await saves.current(async () => checkIdentity()); } catch { setLoaded(false); }
      setMessage(error instanceof Error ? error.message : '核对失败，未再次提交。');
    }
    finally { setBusy(false); }
  }
  async function commitWrite() {
    if (busy || !loaded || recovery || !writePreview || current.current.results.find(item => item.key === writeResultKey.current)?.writeAttempt) return;
    setBusy(true); setWriteError('');
    try {
      await writeOne(writePreview, writeResultKey.current);
      invalidateFeishuRecordsCache(url); onProjectUpdated?.(); setWritePreview(null);
      setMessage('已写回飞书并核对成功，已移至已完成。统计为本次查询快照。');
    } catch (error) { setWriteError(error instanceof Error ? error.message : '写回结果待核实。'); }
    finally { setBusy(false); }
  }
  async function previewBatch() {
    if (busy || !loaded || recovery) return;
    const items = current.current.results.filter(item => checkedKeys.has(item.key) && monitorCategory(item) === filter);
    if (!items.length) return;
    const conflicts = conflictingMonitorKeys(items);
    setBusy(true); setMessage('正在逐条准备写回预览，不会写入飞书…');
    const previews: NonNullable<typeof batchPreviews> = [];
    try {
      for (const item of items) {
        checkIdentity();
        setMessage(`准备写回预览 ${previews.length + 1} / ${items.length}，此时不会写入飞书…`);
        const name = `${item.project.name} · ${item.project.products.join(' / ')}`;
        if (conflicts.has(item.key)) { previews.push({ key: item.key, name, error: '同一合作选择了多个不同视频，请先选定一个。' }); continue; }
        if (item.writeAttempt) { previews.push({ key: item.key, name, error: '上次提交结果待核实，请先在详情点击核对写回结果。' }); continue; }
        try {
          const result = await request<{ preview: VideoWritePreview }>('/api/video-monitor/writeback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', table: url, key: item.key, mapping }) });
          previews.push({ key: item.key, name, preview: result.preview });
        } catch (error) { previews.push({ key: item.key, name, error: error instanceof Error ? error.message : '预览失败' }); }
      }
      setBatchPreviews(previews); setMessage('预览已准备，核对后一次确认写回。');
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : '预览已暂停，未提交。'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function commitBatch() {
    if (busy || !loaded || recovery || !batchPreviews) return;
    const previews = batchPreviews.filter(item => item.preview && !item.error);
    if (!previews.length) return;
    setBusy(true); let succeeded = 0, failed = 0;
    const remaining: NonNullable<typeof batchPreviews> = batchPreviews.filter(item => !item.preview || item.error);
    try {
      for (let i = 0; i < previews.length; i++) {
        const item = previews[i]; checkIdentity();
        setMessage(`写回并核对 ${i + 1} / ${previews.length}，已成功 ${succeeded} 项…`);
        try { await writeOne(item.preview!, item.key); succeeded++; }
        catch (error) {
          failed++; remaining.push({ key: item.key, name: item.name, error: error instanceof Error ? error.message : '结果待核实，请先核对。' });
          // A failed checkpoint poisons the save queue: stop submitting additional external writes.
          try { await saves.current(async () => checkIdentity()); }
          catch { setLoaded(false); remaining.push(...previews.slice(i + 1).map(next => ({ key: next.key, name: next.name, error: '保存中断，本项尚未提交。' }))); break; }
        }
      }
      invalidateFeishuRecordsCache(url); if (succeeded) onProjectUpdated?.();
      setBatchPreviews(remaining.length ? remaining : null);
      setMessage(`成功 ${succeeded} 项，失败 ${failed} 项，预览阻止 ${batchPreviews.length - previews.length} 项。成功项已移至已完成，未完成项保留。`);
    } catch (error) { if (alive.current) setMessage(error instanceof Error ? error.message : '批量写回暂停，请核对已提交结果。'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function previewCleanup() {
    if (busy || !loaded || recovery) return;
    setBusy(true); setMessage('正在只读核对存储清单与飞书记录，不会删除…');
    try {
      const preview = await request<CleanupPreview>('/api/video-monitor/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', table: url, mapping, revision: revision.current }) });
      setCleanupPreview(preview); setMessage('整理清单已准备，确认后才执行。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '整理预览失败。'); }
    finally { setBusy(false); }
  }
  async function applyCleanup() {
    if (busy || !cleanupPreview || !loaded || recovery) return;
    setBusy(true);
    try {
      const result = await request<{ state: MonitorState | null; revision: string | null; compactCount: number; deleted: number }>('/api/video-monitor/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', token: cleanupPreview.token }) });
      if (result.state) { current.current = result.state; setState(result.state); revision.current = result.revision; }
      try { localStorage.removeItem(localKey); localStorage.removeItem(pendingKey); } catch { /* Cloud remains authoritative. */ }
      setCleanupPreview(null); setMessage(`已精简 ${result.compactCount} 项历史、清理 ${result.deleted} 条过期缓存，后续新轮检测沿用此规则。未完成项及结果待核实项保留。`);
    } catch (error) { setLoaded(false); setMessage(error instanceof Error ? error.message : '整理失败，请重新读取。'); }
    finally { setBusy(false); }
  }
  async function retrySubtitle(item: MonitorResult) {
    if (busy) return;
    const recover = item.error?.includes('提交状态不明');
    const runId = recover ? window.prompt('请在 Apify 找到这个视频对应的运行，粘贴 Run ID。不会创建新任务。') : undefined;
    if (recover && !runId) return;
    if (!recover && !window.confirm('重新抓取可能产生 Apify 费用。确定为这一条视频重试？')) return;
    setBusy(true);
    try {
      const result = await command<SubtitleResult>({ action: 'transcript', videoId: item.video.id, retry: !recover, recoverRunId: runId || undefined });
      setMessage(result.error || '字幕任务已接续，请点击继续检测读取结果。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '字幕重试失败。'); }
    finally { setBusy(false); }
  }
  const visible = state.results.filter(r => filter === 'all' || monitorCategory(r) === filter);
  const checkedCount = visible.filter(item => checkedKeys.has(item.key)).length;
  const actionableCheckedCount = visible.filter(item => checkedKeys.has(item.key) && !item.feishuSyncedAt && !item.writeAttempt).length;
  const selectionDisabled = busy || !loaded || !!recovery;
  const selected = visible.find(item => item.key === selectedKey) || visible[0];
  const writeVideo = writePreview ? state.results.find(item => item.key === writeResultKey.current)?.video : undefined;
  const warnings = state.job?.channels.filter(channel => channel.error) || [];
  const statusLabels = { pending: '待审核', ready: '待写回', done: '已完成', incomplete: '需补查', no_match: '暂归非合作', excluded: '已排除' };
  const finishedChannels = state.job?.channels.filter(channel => channel.done).length || 0;
  return <>
    <Button variant="outline" size="sm" className="h-9" onClick={show}><ScanSearch className="mr-1.5 h-3.5 w-3.5" />检测红人视频</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) { setCheckedKeys(new Set()); setBatchPreviews(null); } }}>
      <DialogContent className="flex min-h-0 max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" style={{ width: 'min(1380px, calc(100vw - 2rem))', height: 'min(90vh, 900px)' }}>
        <style>{`@media (min-width: 768px) { .video-monitor-split { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) !important; } .video-monitor-thumbnail { width: 144px !important; } .video-monitor-list { border-right: 1px solid var(--border); border-bottom: 0; } } @media (min-width: 1024px) { .video-monitor-split { grid-template-columns: 520px minmax(0, 1fr) !important; } .video-monitor-thumbnail { width: 192px !important; } } @media (max-width: 767px) { .video-monitor-list { max-height: 240px; } .video-monitor-thumbnail { width: 160px !important; } }`}</style>
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
          <DialogTitle className="text-xl">检测红人视频</DialogTitle>
          <DialogDescription>审核合作 → 核对写回 → 完成归档。仅检测视频链接为空的合作，写回成功后自动移至已完成。</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-col gap-3 border-b bg-slate-50/70 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="font-medium text-foreground">{busy ? '正在检测' : state.job?.phase === 'done' ? '本轮已结束' : state.job ? '可继续检测' : '尚未开始'}</span>
              {state.job && <span className="text-muted-foreground">频道 {finishedChannels}/{state.job.channels.length} · 已收集视频资料 {state.job.videos.length} · 已逐条分析 {state.job.cursor}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!loaded || busy || !!recovery} onClick={() => void run(true)}>开始新一轮检测</Button>
              <Button size="sm" variant="outline" disabled={!loaded || busy || !!recovery} onClick={() => void previewCleanup()}>存储整理</Button>
              {state.job && monitorNeedsAttention(state) && <Button size="sm" variant="outline" disabled={!loaded || busy || !!recovery} onClick={() => void run(false)}>继续自动检测</Button>}
              {busy && <Button size="sm" variant="outline" onClick={() => { running.current = false; setMessage('正在暂停，当前请求完成后保存结果…'); }}>暂停</Button>}
              {!loaded && !busy && <Button size="sm" variant="outline" onClick={() => void load()}>重新读取</Button>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>每次最多抓取 100 条字幕、调用 100 次 AI。</span>
            <span>每 50 条自动接下一批；关闭弹窗可继续，离开页面会暂停。</span>
          </div>
          <p role="status" className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">{busy && <LoaderCircle className="size-4 animate-spin" />}{message || (loaded && state.job?.phase === 'done' && !monitorNeedsAttention(state) ? '本轮工作已完成，必要信息已登记飞书。下次点击开始新一轮检测检查新的发布情况。' : '只检测视频链接为空的 YouTube 合作；上线日期已填写也纳入，无合作日期时查看近 180 天。')}</p>
          {recovery && <div className="flex flex-wrap items-center gap-2 text-sm text-amber-800">发现未同步的本机结果。<Button size="sm" variant="outline" disabled={busy} onClick={() => void recoverLocal()}>恢复本机结果</Button></div>}
          {batchRecoveryIds.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm text-amber-800">字幕批次提交状态待核实。<Button size="sm" variant="outline" disabled={busy} onClick={() => { const runId = window.prompt('请在 Apify 运行记录中找到这批视频的 Run ID，核实后粘贴。不会创建新任务。'); if (!runId) return; setBusy(true); void command<SubtitleBatchResult>({ action: 'transcripts', videoIds: batchRecoveryIds, recoverRunId: runId }).then(() => { setBatchRecoveryIds([]); setMessage('已恢复批次运行编号，点击继续检测读取结果。'); }).catch(error => setMessage(error.message)).finally(() => setBusy(false)); }}>用 Run ID 恢复</Button></div>}
          {warnings.length > 0 && <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><summary className="flex cursor-pointer items-center gap-2 font-medium"><AlertCircle className="size-4" />{warnings.length} 个频道仍需补查或处理异常</summary><div className="mt-2 max-h-28 overflow-y-auto border-t border-amber-200 pt-2">{warnings.map((channel, index) => <p key={`${channel.input}-${index}`} className="py-1">{state.job?.projects.find(project => channel.projectIds.includes(project.id))?.name || channel.input}：{channel.error}</p>)}</div></details>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
          <span className="text-xs text-muted-foreground">待你确认 {state.results.filter(result => result.status === 'pending').length} · 资料不完整 {state.results.filter(result => result.status === 'incomplete').length}</span>
          <ToggleGroup type="single" value={filter} onValueChange={value => { if (value) { setFilter(value); setCheckedKeys(new Set()); } }} variant="outline" size="sm" spacing={2} className="flex-wrap justify-start" aria-label="检测结果分类">{[['pending', '待审核'], ['ready', '待写回'], ['done', '已完成'], ['incomplete', '需补查'], ['excluded', '已排除'], ['no_match', '暂归非合作'], ['all', '全部']].map(([key, label]) => <ToggleGroupItem key={key} value={key}>{label} {key === 'all' ? state.results.length : state.results.filter(result => monitorCategory(result) === key).length}</ToggleGroupItem>)}</ToggleGroup>
          <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">监测已上线合作</summary><div className="absolute right-6 z-10 mt-2 max-h-52 w-80 overflow-y-auto rounded-lg border bg-background p-3 shadow-lg">{projects.map(project => <label key={project.id} className="flex gap-2 py-1.5 text-xs"><input type="checkbox" disabled={busy || !loaded} checked={state.continueIds.includes(project.id)} onChange={event => {
            const ids = event.target.checked ? [...current.current.continueIds, project.id] : current.current.continueIds.filter(id => id !== project.id);
            setBusy(true); void persist({ ...current.current, continueIds: ids }).catch(error => setMessage(error.message)).finally(() => setBusy(false));
          }} /><span>{project.name} · {project.products.join(' / ')} · {project.id}</span></label>)}</div></details>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-slate-50/70 px-6 py-3 text-xs">
          <label className="flex cursor-pointer items-center gap-2"><Checkbox aria-label="全选当前列表" disabled={selectionDisabled || !visible.length} checked={checkedCount === 0 ? false : checkedCount === visible.length ? true : 'indeterminate'} onCheckedChange={value => setCheckedKeys(value === true ? new Set(visible.map(item => item.key)) : new Set())} />全选当前列表</label>
          <span className="text-muted-foreground">已选 {checkedCount} 项</span>
          {filter === 'pending' && <Button size="sm" disabled={selectionDisabled || !checkedCount} onClick={() => void decideBatch('confirmed')}>批量确认合作</Button>}
          {['pending', 'incomplete', 'ready'].includes(filter) && <Button size="sm" variant="outline" disabled={selectionDisabled || !actionableCheckedCount} onClick={() => void decideBatch('excluded')}>批量排除</Button>}
          {['ready', 'done'].includes(filter) && <Button size="sm" disabled={selectionDisabled || !checkedCount} onClick={() => void previewBatch()}>{filter === 'done' ? '批量更新统计' : '批量写回飞书'}</Button>}
          {['ready', 'excluded', 'incomplete'].includes(filter) && <Button size="sm" variant="outline" disabled={selectionDisabled || !actionableCheckedCount} onClick={() => void decideBatch('pending')}>批量返回审核</Button>}
          <Button size="sm" variant="ghost" disabled={!checkedCount || busy} onClick={() => setCheckedKeys(new Set())}>取消选择</Button>
          <span className="text-muted-foreground">每项对应一个视频与合作的关联，未勾选项不受影响。</span>
        </div>
        <div className="video-monitor-split grid min-h-0 flex-1" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className="video-monitor-list min-h-0 overflow-y-auto border-b" aria-label="视频候选列表">
            {!visible.length && <p className="px-6 py-12 text-center text-sm text-muted-foreground">{state.job ? '此分类暂无结果。可切换分类查看其他视频。' : '开始检测后，候选视频会出现在这里。'}</p>}
            {visible.map(item => <div key={item.key} className="flex items-start border-b pl-4">
              <Checkbox className="mt-5 shrink-0" aria-label={`勾选：${item.video.title} · ${item.project.name} · ${item.project.products.join(' / ')}`} disabled={selectionDisabled} checked={checkedKeys.has(item.key)} onCheckedChange={value => setCheckedKeys(previous => { const next = new Set(previous); if (value === true) next.add(item.key); else next.delete(item.key); return next; })} />
              <button type="button" onClick={() => setSelectedKey(item.key)} className={`flex min-w-0 flex-1 items-start gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 ${selected?.key === item.key ? 'bg-blue-50/70' : ''}`} aria-current={selected?.key === item.key ? 'true' : undefined}>
              <VideoMonitorThumbnail key={item.video.id} video={item.video} />
              <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">{item.video.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.project.name} · {item.project.products.join(' / ') || '未填写产品'}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(item.video.publishedAt).toLocaleDateString('zh-CN')} · {item.evidence.length} 条文字依据</p><div className="mt-2 flex items-center justify-between gap-2"><Badge variant={item.status === 'confirmed' ? 'default' : 'outline'} className={item.status === 'incomplete' ? 'border-amber-200 bg-amber-50 text-amber-800' : undefined}>{item.writeAttempt ? '待核实' : statusLabels[monitorCategory(item)]}</Badge><ChevronRight className="size-4 text-muted-foreground" /></div></div>
            </button></div>)}
          </div>
          <div className="min-h-0 overflow-y-auto px-6 py-5" aria-label="视频详情">
            {!selected ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择左侧视频查看详情</div> : <div className="flex flex-col gap-5">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">视频详情</p><h3 className="mt-1 text-base font-semibold leading-6"><a href={`https://www.youtube.com/watch?v=${selected.video.id}`} target="_blank" rel="noopener noreferrer" className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">{selected.video.title}</a></h3></div><Badge variant={selected.status === 'confirmed' ? 'default' : 'outline'} className={selected.status === 'incomplete' ? 'border-amber-200 bg-amber-50 text-amber-800' : undefined}>{selected.writeAttempt ? '待核实' : statusLabels[monitorCategory(selected)]}</Badge></div>
              <div className="grid gap-3 rounded-lg border bg-slate-50/60 p-4 text-sm sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">合作红人</p><p className="mt-1 font-medium">{selected.project.name}</p></div><div><p className="text-xs text-muted-foreground">合作产品</p><p className="mt-1 font-medium">{selected.project.products.join(' / ') || '未填写'}</p></div><div><p className="text-xs text-muted-foreground">实际公开</p><p className="mt-1">{new Date(selected.video.publishedAt).toLocaleString('zh-CN')}</p></div><div><p className="text-xs text-muted-foreground">预计发布时间</p><p className="mt-1">{selected.project.expected || '未填写'} · {selected.assessment ? timingLabels[selected.assessment.timing] : selected.project.expected ? '待核实' : '新发布'}</p></div><div className="sm:col-span-2"><p className="text-xs text-muted-foreground">合作记录 ID</p><p className="mt-1 break-all font-mono text-xs">{selected.project.id}</p></div></div>
              <a className="inline-flex w-fit items-center gap-1 text-sm font-medium text-blue-600 hover:underline" href={`https://www.youtube.com/watch?v=${selected.video.id}`} target="_blank" rel="noreferrer">打开 YouTube 视频<ExternalLink className="size-4" /></a>
              {selected.assessment && <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4 text-sm leading-relaxed"><p className="font-medium">AI 判断说明</p><p className="mt-2">{selected.assessment.explanation}</p><p className="mt-2 text-muted-foreground">{selected.assessment.dateExplanation}</p></div>}
              {selected.error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{selected.error}</div>}
              <details className="rounded-lg border px-4 py-3 text-sm" open><summary className="cursor-pointer font-medium">匹配依据（{selected.evidence.length}）</summary><div className="mt-3 flex flex-col gap-2">{selected.evidence.map((evidence, index) => <p key={index} className="break-words rounded-md bg-slate-50 p-3 text-sm leading-relaxed"><span className="font-medium">{evidence.source} · {evidence.term}</span>{evidence.start !== undefined && <a className="ml-2 text-blue-600 hover:underline" href={`https://www.youtube.com/watch?v=${selected.video.id}&t=${Math.floor(evidence.start)}`} target="_blank" rel="noreferrer">跳到 {Math.floor(evidence.start)} 秒</a>}<br />{evidence.quote}</p>)}{!selected.evidence.length && <p className="text-muted-foreground">未找到文字命中；字幕未取得时不会自动排除合作。</p>}</div></details>
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                {!selected.feishuSyncedAt && !selected.writeAttempt && <>
                {selected.status !== 'confirmed' && <Button size="sm" disabled={selectionDisabled} onClick={() => void decide(selected.key, 'confirmed')}>确认属于此合作</Button>}
                {selected.status !== 'excluded' && <Button variant="outline" size="sm" disabled={selectionDisabled} onClick={() => void decide(selected.key, 'excluded')}>排除</Button>}
                {selected.status !== 'pending' && <Button variant="outline" size="sm" disabled={selectionDisabled} onClick={() => void decide(selected.key, 'pending')}>返回审核</Button>}
                </>}
                {selected.writeAttempt && <Button size="sm" variant="outline" disabled={selectionDisabled} onClick={() => void verifyWrite(selected)}>核对写回结果</Button>}
                {selected.writeError && <p role="alert" className="w-full text-sm text-amber-800">{selected.writeError}</p>}
                {selected.error && /字幕|Apify/.test(selected.error) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void retrySubtitle(selected)}>重试 / 恢复字幕</Button>}
                {selected.status === 'confirmed' && <><span className="text-xs text-emerald-700">{selected.feishuSyncedAt ? `已同步飞书 · ${new Date(selected.feishuSyncedAt).toLocaleString('zh-CN')}` : '仅看板关联，未写飞书'}</span><Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${selected.video.id}`).then(() => setMessage('视频链接已复制，可粘贴到飞书对应合作记录。')).catch(() => setMessage('复制失败，请从视频链接手动复制。'))}>复制视频链接</Button><Button size="sm" disabled={selectionDisabled} onClick={() => void previewWrite(selected)}>{selected.feishuSyncedAt ? '更新飞书数据' : '写回飞书'}</Button></>}
              </div>
            </div>}
          </div>
        </div>
        <p className="shrink-0 border-t px-6 py-2.5 text-xs text-muted-foreground">确认合作仅建立看板关联；点击「写回飞书」并确认预览后才更新表格。</p>
      </DialogContent>
    </Dialog>
    <Dialog open={!!cleanupPreview} onOpenChange={value => { if (!value && !busy) setCleanupPreview(null); }}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>存储整理 · 核对清单</DialogTitle><DialogDescription>不修改飞书。保留未完成事项、未知提交结果和轻量历史；确认后启用后续自动整理规则。</DialogDescription></DialogHeader>
        <p className="text-sm">精简已核对的完成记录及排除记录 {cleanupPreview?.compactCount || 0} 项；清理过期缓存 {cleanupPreview?.deleteCount || 0} 条。</p>
        <p className="text-sm text-muted-foreground">字幕缓存保留90天；未提交或已核实完成的预览保留7天。仍被未完成任务使用的字幕、运行中任务和未知提交预览不清理。每次新一轮检测时执行，不在网页关闭后定时运行。</p>
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">查看将精简的历史记录</summary>{cleanupPreview?.compactItems?.map(item => <p key={item.key} className="mt-2 text-xs text-muted-foreground">{item.name} · {item.title} · 保留合作编号、视频及同步时间</p>)}</details>
        <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm">查看待清理缓存清单</summary>{cleanupPreview?.rows.map(row => <p key={row.key} className="mt-2 break-all text-xs text-muted-foreground">{row.kind} · {row.key}</p>)}</details>
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setCleanupPreview(null)}>取消</Button><Button disabled={busy || !loaded} onClick={() => void applyCleanup()}>{busy ? '正在整理…' : '确认整理并启用规则'}</Button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={!!batchPreviews} onOpenChange={value => { if (!value && !busy) setBatchPreviews(null); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl" showCloseButton={!busy}>
        <DialogHeader><DialogTitle>批量写回飞书 · 核对预览</DialogTitle><DialogDescription>仅提交可写项目，冲突和失败项留在待处理列表。成功项自动移至已完成。</DialogDescription></DialogHeader>
        {batchPreviews?.map(item => <div key={item.key} className="rounded-lg border p-4">
          <h3 className="font-medium">{item.name}</h3>
          {item.error ? <p role="alert" className="mt-2 text-sm text-amber-800">{item.error}</p> : item.preview && <>
            <p className="mt-1 text-sm text-muted-foreground">{item.preview.title} · 记录 {item.preview.recordId}</p>
            <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs" style={{ minWidth: 720 }}>
              <thead><tr><th className="p-2">对照</th>{item.preview.rows.map(row => <th key={row.field} className="p-2">{row.field}</th>)}</tr></thead>
              <tbody><tr className="border-t"><th className="p-2">当前</th>{item.preview.rows.map(row => <td key={row.field} className="break-all p-2 text-muted-foreground">{row.before}</td>)}</tr>
              <tr className="border-t bg-muted/30"><th className="p-2">写入</th>{item.preview.rows.map(row => <td key={row.field} className={`break-all p-2 ${row.skip ? 'text-amber-700' : 'font-medium'}`}>{row.after}</td>)}</tr></tbody>
            </table></div><p className="mt-2 text-xs text-muted-foreground">数据截至 {new Date(item.preview.fetchedAt).toLocaleString('zh-CN')}，预览有效10分钟。</p>
          </>}
        </div>)}
        <div className="flex flex-wrap justify-end gap-2 border-t pt-4"><Button variant="outline" disabled={busy} onClick={() => setBatchPreviews(null)}>返回列表</Button><Button disabled={busy || !loaded || !batchPreviews?.some(item => item.preview && !item.error)} onClick={() => void commitBatch()}>{busy ? '正在写回并核对…' : `确认写回 ${batchPreviews?.filter(item => item.preview && !item.error).length || 0} 项`}</Button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={!!writePreview} onOpenChange={value => { if (!value && !busy) { setWritePreview(null); setWriteError(''); } }}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto p-0 sm:max-w-5xl" style={{ width: 'min(1040px, calc(100vw - 2rem))', maxWidth: 1040 }} showCloseButton={!busy}>
        <DialogHeader className="border-b px-6 py-5"><DialogTitle>写回飞书 · 核对预览</DialogTitle><DialogDescription>先核对视频与数据，确认后更新这条合作记录。</DialogDescription></DialogHeader>
        {writePreview && <>
          <div className="min-w-0 space-y-6 p-6" style={{ minWidth: 0 }}>
          <div className="flex flex-wrap items-center gap-6">
            {writeVideo && <VideoMonitorThumbnail key={writeVideo.id} video={writeVideo} large />}
            <div className="min-w-0 flex-1" style={{ minWidth: 240 }}>
              <p className="text-xl font-semibold leading-snug">{writePreview.title}</p>
              <p className="mt-3 text-sm text-muted-foreground">{writePreview.name}</p>
              <div className="mt-3 flex flex-wrap gap-2">{writePreview.products.map(product => <Badge key={product} variant="secondary" className="font-normal">{product}</Badge>)}</div>
              {writeVideo && <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(writeVideo.id)}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm text-foreground hover:underline">查看视频 <ExternalLink className="size-3.5" /></a>}
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full table-fixed text-left text-sm" style={{ minWidth: 800 }}>
              <colgroup><col style={{ width: 112 }} /><col style={{ width: 160 }} /><col style={{ width: 288 }} /><col /><col /><col /></colgroup>
              <thead className="bg-slate-50"><tr><th scope="col" className="border-r px-4 py-4 font-medium text-muted-foreground">数据</th>{writePreview.rows.map(row => <th scope="col" key={row.field} title={row.label} className="break-words border-r px-4 py-4 font-medium last:border-r-0">{row.field}</th>)}</tr></thead>
              <tbody>
                <tr className="border-t"><th scope="row" className="border-r px-4 py-5 align-top font-medium text-muted-foreground">当前</th>{writePreview.rows.map((row, index) => <td key={row.field} className="border-r px-4 py-5 align-top text-muted-foreground last:border-r-0">{index === 1 && row.before.startsWith('https://') ? <a href={row.before} target="_blank" rel="noopener noreferrer" title={row.before} className="block truncate text-foreground hover:underline">{row.before.replace('https://www.', '')}</a> : row.before}</td>)}</tr>
                <tr className="border-t bg-slate-50/50"><th scope="row" className="border-r px-4 py-5 align-top font-medium">写入</th>{writePreview.rows.map((row, index) => <td key={row.field} className={`border-r px-4 py-5 align-top last:border-r-0 ${row.skip ? 'text-amber-700' : 'font-medium'}`}>
                  {index === 1 && !row.skip ? <a href={row.after} target="_blank" rel="noopener noreferrer" title={row.after} className="block truncate text-foreground hover:underline">{row.after.replace('https://www.', '')}</a> : row.after}
                  {writeValueChanged(row, index) && <span className="mt-2 inline-block rounded-md px-2 py-1 text-xs font-medium" style={{ background: '#e1f5ed', color: '#087f65' }}>更新</span>}
                </td>)}</tr>
              </tbody>
            </table>
          </div>
          {writeError && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{writeError}</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-5">
            <div className="flex items-start gap-2 text-sm"><AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><p>只更新所选合作的5个字段，曝光量为播放数。</p><p className="mt-1 text-xs text-muted-foreground">数据截至 {new Date(writePreview.fetchedAt).toLocaleString('zh-CN')} · 日期按北京时间</p><p className="mt-1 text-xs text-muted-foreground">记录 ID：{writePreview.recordId}</p></div></div>
            <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setWritePreview(null)}>返回列表</Button><Button disabled={busy || !loaded || !!recovery || !!state.results.find(item => item.key === writeResultKey.current)?.writeAttempt} onClick={() => void commitWrite()}>{busy ? '正在写回并核对…' : state.results.find(item => item.key === writeResultKey.current)?.writeAttempt ? '请返回列表核对结果' : '确认写回飞书'}</Button></div>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
