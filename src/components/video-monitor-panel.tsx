'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertCircle, ChevronRight, ExternalLink, ImageOff, LoaderCircle, ScanSearch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
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
import { runMonitor, type MonitorSubtitle as SubtitleResult, type MonitorSubtitleBatch as SubtitleBatchResult, type MonitorOptions as Options } from '@/lib/video-monitor-runner';

type LocalSnapshot = { state: MonitorState; revision: string | null };
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
  const [batchDecision, setBatchDecision] = useState<'confirmed' | 'excluded' | null>(null);
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
    // Keep the last good local snapshot as evidence, rather than deleting it.
    try { localStorage.setItem(localKey, JSON.stringify({ state: next, revision: saved.revision })); } catch { /* No private credentials are in this snapshot. */ }
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
    setCheckedKeys(new Set()); setBatchDecision(null);
    setLoaded(false); setMessage('正在读取检测记录…');
    try {
      const [saved, snapshot] = await Promise.all([
        request<{ state: MonitorState; revision: string | null }>(`/api/video-monitor?table=${encodeURIComponent(url)}`),
        fetchFeishuRecordSnapshot(url),
      ]);
      checkIdentity();
      revision.current = saved.revision; current.current = saved.state; setState(saved.state);
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
        // Preserve unfinished paid batch reservations when starting a new scan.
        const batches = next.job?.subtitleBatches || (next.job?.subtitleBatch ? [next.job.subtitleBatch] : []);
        const snapshot = await fetchFeishuRecordSnapshot(url, { force: true });
        checkIdentity();
        const all = monitorProjects(snapshot.records, mapping); setProjects(all);
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
    if (busy) return;
    setBusy(true);
    try { await persist(applyMonitorDecision(current.current, [key], status)); setCheckedKeys(previous => { const next = new Set(previous); next.delete(key); return next; }); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败。'); }
    finally { setBusy(false); }
  }
  async function decideBatch() {
    if (busy || !loaded || recovery || !batchDecision) return;
    const keys = current.current.results.filter(result => checkedKeys.has(result.key) && (filter === 'all' || result.status === filter)).map(result => result.key);
    if (!keys.length) { setBatchDecision(null); return; }
    setBusy(true);
    try {
      await persist(applyMonitorDecision(current.current, keys, batchDecision));
      setCheckedKeys(new Set()); setBatchDecision(null);
      setMessage(`已将 ${keys.length} 个选中项标为${batchDecision === 'confirmed' ? '已确认' : '已排除'}，仅更新看板，未写入飞书。`);
    } catch (error) {
      setLoaded(false); setBatchDecision(null);
      setMessage(`批量结果云端保存失败，请重新读取并恢复本机快照。${error instanceof Error ? error.message : ''}`);
    } finally { setBusy(false); }
  }
  async function previewWrite(item: MonitorResult) {
    if (busy || !loaded || recovery || item.status !== 'confirmed') return;
    setBusy(true); setWriteError(''); setMessage('正在读取飞书原值与最新视频统计…');
    try {
      const result = await request<{ preview: VideoWritePreview }>('/api/video-monitor/writeback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', table: url, key: item.key, mapping }) });
      writeResultKey.current = item.key;
      setWritePreview(result.preview); setMessage('请核对写回预览，确认后才更新飞书。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '写回预览失败。'); }
    finally { setBusy(false); }
  }
  async function commitWrite() {
    if (busy || !writePreview) return;
    setBusy(true); setWriteError('');
    try {
      const result = await request<{ syncedAt: number }>('/api/video-monitor/writeback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'commit', token: writePreview.token }) });
      invalidateFeishuRecordsCache(url);
      onProjectUpdated?.();
      setWritePreview(null);
      try {
        await persist({ ...current.current, results: current.current.results.map(item => item.key === writeResultKey.current ? { ...item, feishuSyncedAt: result.syncedAt } : item) });
        setMessage('已写回飞书并核对成功，合作项目正在刷新。统计数据为本次查询的快照。');
      } catch {
        setLoaded(false);
        setMessage('飞书已写入成功，但看板同步标记保存失败。请重新读取并恢复本机记录，不必重复写飞书。');
      }
    } catch (error) { setWriteError(error instanceof Error ? error.message : '写回失败，请核对飞书后重试。'); }
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
  const visible = state.results.filter(r => filter === 'all' || r.status === filter);
  const checkedCount = visible.filter(item => checkedKeys.has(item.key)).length;
  const selectionDisabled = busy || !loaded || !!recovery;
  const selected = visible.find(item => item.key === selectedKey) || visible[0];
  const writeVideo = writePreview ? state.results.find(item => item.key === writeResultKey.current)?.video : undefined;
  const warnings = state.job?.channels.filter(channel => channel.error) || [];
  const statusLabels: Record<MonitorResult['status'], string> = { pending: '待确认', confirmed: '已确认', incomplete: '资料不完整', no_match: '暂归非合作', excluded: '已排除' };
  const finishedChannels = state.job?.channels.filter(channel => channel.done).length || 0;
  return <>
    <Button variant="outline" size="sm" className="h-9" onClick={show}><ScanSearch className="mr-1.5 h-3.5 w-3.5" />检测红人视频</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) { setCheckedKeys(new Set()); setBatchDecision(null); } }}>
      <DialogContent className="flex min-h-0 max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none" style={{ width: 'min(1380px, calc(100vw - 2rem))', height: 'min(90vh, 900px)' }}>
        <style>{`@media (min-width: 768px) { .video-monitor-split { grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) !important; } .video-monitor-thumbnail { width: 144px !important; } .video-monitor-list { border-right: 1px solid var(--border); border-bottom: 0; } } @media (min-width: 1024px) { .video-monitor-split { grid-template-columns: 520px minmax(0, 1fr) !important; } .video-monitor-thumbnail { width: 192px !important; } } @media (max-width: 767px) { .video-monitor-list { max-height: 240px; } .video-monitor-thumbnail { width: 160px !important; } }`}</style>
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
          <DialogTitle className="text-xl">检测红人视频</DialogTitle>
          <DialogDescription>从合作日期起检查公开视频；结果由你确认，不自动写入飞书。</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 flex-col gap-3 border-b bg-slate-50/70 px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="font-medium text-foreground">{busy ? '正在检测' : state.job?.phase === 'done' ? '本轮已结束' : state.job ? '可继续检测' : '尚未开始'}</span>
              {state.job && <span className="text-muted-foreground">频道 {finishedChannels}/{state.job.channels.length} · 已收集视频资料 {state.job.videos.length} · 已逐条分析 {state.job.cursor}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={!loaded || busy || !!recovery} onClick={() => void run(true)}>开始新一轮检测</Button>
              {state.job && <Button size="sm" variant="outline" disabled={!loaded || busy || !!recovery} onClick={() => void run(false)}>继续自动检测</Button>}
              {busy && <Button size="sm" variant="outline" onClick={() => { running.current = false; setMessage('正在暂停，当前请求完成后保存结果…'); }}>暂停</Button>}
              {!loaded && !busy && <Button size="sm" variant="outline" onClick={() => void load()}>重新读取</Button>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>每次最多抓取 100 条字幕、调用 100 次 AI。</span>
            <span>每 50 条自动接下一批；关闭弹窗可继续，离开页面会暂停。</span>
          </div>
          <p role="status" className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">{busy && <LoaderCircle className="size-4 animate-spin" />}{message || '只检测上线日期和视频链接均为空的 YouTube 合作；无合作日期时查看近 180 天。'}</p>
          {recovery && <div className="flex flex-wrap items-center gap-2 text-sm text-amber-800">发现未同步的本机结果。<Button size="sm" variant="outline" disabled={busy} onClick={() => void recoverLocal()}>恢复本机结果</Button></div>}
          {batchRecoveryIds.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm text-amber-800">字幕批次提交状态待核实。<Button size="sm" variant="outline" disabled={busy} onClick={() => { const runId = window.prompt('请在 Apify 运行记录中找到这批视频的 Run ID，核实后粘贴。不会创建新任务。'); if (!runId) return; setBusy(true); void command<SubtitleBatchResult>({ action: 'transcripts', videoIds: batchRecoveryIds, recoverRunId: runId }).then(() => { setBatchRecoveryIds([]); setMessage('已恢复批次运行编号，点击继续检测读取结果。'); }).catch(error => setMessage(error.message)).finally(() => setBusy(false)); }}>用 Run ID 恢复</Button></div>}
          {warnings.length > 0 && <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><summary className="flex cursor-pointer items-center gap-2 font-medium"><AlertCircle className="size-4" />{warnings.length} 个频道仍需补查或处理异常</summary><div className="mt-2 max-h-28 overflow-y-auto border-t border-amber-200 pt-2">{warnings.map((channel, index) => <p key={`${channel.input}-${index}`} className="py-1">{state.job?.projects.find(project => channel.projectIds.includes(project.id))?.name || channel.input}：{channel.error}</p>)}</div></details>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
          <span className="text-xs text-muted-foreground">待你确认 {state.results.filter(result => result.status === 'pending').length} · 资料不完整 {state.results.filter(result => result.status === 'incomplete').length}</span>
          <ToggleGroup type="single" value={filter} onValueChange={value => { if (value) { setFilter(value); setCheckedKeys(new Set()); } }} variant="outline" size="sm" spacing={2} className="flex-wrap justify-start" aria-label="检测结果分类">{[['pending', '待确认'], ['confirmed', '已确认'], ['incomplete', '资料不完整'], ['no_match', '暂归非合作'], ['excluded', '已排除'], ['all', '全部']].map(([key, label]) => <ToggleGroupItem key={key} value={key}>{label} {key === 'all' ? state.results.length : state.results.filter(result => result.status === key).length}</ToggleGroupItem>)}</ToggleGroup>
          <details className="text-sm text-muted-foreground"><summary className="cursor-pointer">监测已上线合作</summary><div className="absolute right-6 z-10 mt-2 max-h-52 w-80 overflow-y-auto rounded-lg border bg-background p-3 shadow-lg">{projects.map(project => <label key={project.id} className="flex gap-2 py-1.5 text-xs"><input type="checkbox" disabled={busy || !loaded} checked={state.continueIds.includes(project.id)} onChange={event => {
            const ids = event.target.checked ? [...current.current.continueIds, project.id] : current.current.continueIds.filter(id => id !== project.id);
            setBusy(true); void persist({ ...current.current, continueIds: ids }).catch(error => setMessage(error.message)).finally(() => setBusy(false));
          }} /><span>{project.name} · {project.products.join(' / ')} · {project.id}</span></label>)}</div></details>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b bg-slate-50/70 px-6 py-3 text-xs">
          <label className="flex cursor-pointer items-center gap-2"><Checkbox aria-label="全选当前列表" disabled={selectionDisabled || !visible.length} checked={checkedCount === 0 ? false : checkedCount === visible.length ? true : 'indeterminate'} onCheckedChange={value => setCheckedKeys(value === true ? new Set(visible.map(item => item.key)) : new Set())} />全选当前列表</label>
          <span className="text-muted-foreground">已选 {checkedCount} 项</span>
          <Button size="sm" disabled={selectionDisabled || !checkedCount} onClick={() => setBatchDecision('confirmed')}>批量确认合作</Button>
          <Button size="sm" variant="outline" disabled={selectionDisabled || !checkedCount} onClick={() => setBatchDecision('excluded')}>批量排除</Button>
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
              <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-medium leading-5 text-foreground">{item.video.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.project.name} · {item.project.products.join(' / ') || '未填写产品'}</p><p className="mt-2 text-xs text-muted-foreground">{new Date(item.video.publishedAt).toLocaleDateString('zh-CN')} · {item.evidence.length} 条文字依据</p><div className="mt-2 flex items-center justify-between gap-2"><Badge variant={item.status === 'confirmed' ? 'default' : 'outline'} className={item.status === 'incomplete' ? 'border-amber-200 bg-amber-50 text-amber-800' : undefined}>{statusLabels[item.status]}</Badge><ChevronRight className="size-4 text-muted-foreground" /></div></div>
            </button></div>)}
          </div>
          <div className="min-h-0 overflow-y-auto px-6 py-5" aria-label="视频详情">
            {!selected ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择左侧视频查看详情</div> : <div className="flex flex-col gap-5">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">视频详情</p><h3 className="mt-1 text-base font-semibold leading-6"><a href={`https://www.youtube.com/watch?v=${selected.video.id}`} target="_blank" rel="noopener noreferrer" className="rounded-sm text-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">{selected.video.title}</a></h3></div><Badge variant={selected.status === 'confirmed' ? 'default' : 'outline'} className={selected.status === 'incomplete' ? 'border-amber-200 bg-amber-50 text-amber-800' : undefined}>{statusLabels[selected.status]}</Badge></div>
              <div className="grid gap-3 rounded-lg border bg-slate-50/60 p-4 text-sm sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">合作红人</p><p className="mt-1 font-medium">{selected.project.name}</p></div><div><p className="text-xs text-muted-foreground">合作产品</p><p className="mt-1 font-medium">{selected.project.products.join(' / ') || '未填写'}</p></div><div><p className="text-xs text-muted-foreground">实际公开</p><p className="mt-1">{new Date(selected.video.publishedAt).toLocaleString('zh-CN')}</p></div><div><p className="text-xs text-muted-foreground">预计发布时间</p><p className="mt-1">{selected.project.expected || '未填写'} · {selected.assessment ? timingLabels[selected.assessment.timing] : selected.project.expected ? '待核实' : '新发布'}</p></div><div className="sm:col-span-2"><p className="text-xs text-muted-foreground">合作记录 ID</p><p className="mt-1 break-all font-mono text-xs">{selected.project.id}</p></div></div>
              <a className="inline-flex w-fit items-center gap-1 text-sm font-medium text-blue-600 hover:underline" href={`https://www.youtube.com/watch?v=${selected.video.id}`} target="_blank" rel="noreferrer">打开 YouTube 视频<ExternalLink className="size-4" /></a>
              {selected.assessment && <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4 text-sm leading-relaxed"><p className="font-medium">AI 判断说明</p><p className="mt-2">{selected.assessment.explanation}</p><p className="mt-2 text-muted-foreground">{selected.assessment.dateExplanation}</p></div>}
              {selected.error && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{selected.error}</div>}
              <details className="rounded-lg border px-4 py-3 text-sm" open><summary className="cursor-pointer font-medium">匹配依据（{selected.evidence.length}）</summary><div className="mt-3 flex flex-col gap-2">{selected.evidence.map((evidence, index) => <p key={index} className="break-words rounded-md bg-slate-50 p-3 text-sm leading-relaxed"><span className="font-medium">{evidence.source} · {evidence.term}</span>{evidence.start !== undefined && <a className="ml-2 text-blue-600 hover:underline" href={`https://www.youtube.com/watch?v=${selected.video.id}&t=${Math.floor(evidence.start)}`} target="_blank" rel="noreferrer">跳到 {Math.floor(evidence.start)} 秒</a>}<br />{evidence.quote}</p>)}{!selected.evidence.length && <p className="text-muted-foreground">未找到文字命中；字幕未取得时不会自动排除合作。</p>}</div></details>
              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                {selected.status !== 'confirmed' && <Button size="sm" disabled={busy} onClick={() => void decide(selected.key, 'confirmed')}>确认属于此合作</Button>}
                {selected.status !== 'excluded' && <Button variant="outline" size="sm" disabled={busy} onClick={() => void decide(selected.key, 'excluded')}>排除</Button>}
                {selected.status !== 'pending' && <Button variant="outline" size="sm" disabled={busy} onClick={() => void decide(selected.key, 'pending')}>改为待确认</Button>}
                {selected.error && /字幕|Apify/.test(selected.error) && <Button variant="outline" size="sm" disabled={busy} onClick={() => void retrySubtitle(selected)}>重试 / 恢复字幕</Button>}
                {selected.status === 'confirmed' && <><span className="text-xs text-emerald-700">{selected.feishuSyncedAt ? `已同步飞书 · ${new Date(selected.feishuSyncedAt).toLocaleString('zh-CN')}` : '仅看板关联，未写飞书'}</span><Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${selected.video.id}`).then(() => setMessage('视频链接已复制，可粘贴到飞书对应合作记录。')).catch(() => setMessage('复制失败，请从视频链接手动复制。'))}>复制视频链接</Button><Button size="sm" disabled={selectionDisabled} onClick={() => void previewWrite(selected)}>{selected.feishuSyncedAt ? '更新飞书数据' : '写回飞书'}</Button></>}
              </div>
            </div>}
          </div>
        </div>
        <p className="shrink-0 border-t px-6 py-2.5 text-xs text-muted-foreground">确认合作仅建立看板关联；点击「写回飞书」并确认预览后才更新表格。</p>
      </DialogContent>
    </Dialog>
    <AlertDialog open={!!batchDecision} onOpenChange={value => { if (!value && !busy) setBatchDecision(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{batchDecision === 'confirmed' ? '确认批量关联合作？' : '确认批量排除？'}</AlertDialogTitle>
          <AlertDialogDescription>将处理 {checkedCount} 个选中项。每项代表视频与对应合作项目的关联，不会处理未勾选项，也不会自动写入飞书。请确认这些判断适用于全部选中项。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy || !checkedCount || !loaded || !!recovery} onClick={event => { event.preventDefault(); void decideBatch(); }}>{busy ? '正在保存…' : `确认处理 ${checkedCount} 项`}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
            <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setWritePreview(null)}>取消</Button><Button disabled={busy} onClick={() => void commitWrite()}>{busy ? '正在写回并核对…' : '确认写回飞书'}</Button></div>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
