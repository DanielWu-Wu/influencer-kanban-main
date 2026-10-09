import type { FeishuBatchResult } from './feishu-batch';

export type ProspectWriteKind = 'resource' | 'development' | 'quick' | 'invitation';
export type ProspectWriteStatus = 'checking' | 'pending' | 'writing' | 'success' | 'failed' | 'unknown' | 'review';
export type ProspectWriteStep = {
  batch?: {
    operationId: string;
    items: Array<{ clientId: string; recordId?: string; fields: Record<string, unknown> }>;
  };
  key: 'resource' | 'development' | 'email' | 'invitation';
  url: string;
  action: 'batchCreate' | 'batchUpdate';
  operationId: string;
  fields: Record<string, unknown>;
  before?: Record<string, unknown>;
  knownRecordIds?: string[];
  acceptedSuspectedIds?: string[];
  recordId?: string;
  status: ProspectWriteStatus;
  error?: string;
};
export type ProspectWriteTask = {
  advanceToInvitation?: boolean;
  progress?: string;
  preparationMs?: number;
  identity?: { inputUrl: string; channelId?: string; title?: string; url?: string; publicEmail?: string; customUrl?: string };
  id: string;
  scope: string;
  kind: ProspectWriteKind;
  status: ProspectWriteStatus;
  resourceUrl: string;
  developmentUrl: string;
  mappingSignature: string;
  steps: ProspectWriteStep[];
  error?: string;
};

export function recoverProspectWriteTask(task?: ProspectWriteTask): ProspectWriteTask | undefined {
  if (!task) return undefined;
  const steps = task.steps.map((step) => step.status === 'writing'
    ? { ...step, status: 'unknown' as const, error: '页面中断，写入结果待核实，不能直接重建。' }
    : step);
  const interrupted = task.status === 'writing' || task.status === 'checking';
  return { ...task, steps, status: steps.some((step) => step.status === 'unknown') ? 'unknown' : interrupted ? 'failed' : task.status,
    error: interrupted ? '上次处理未完成，请核实后继续。' : task.error };
}

export function writeTaskContextMatches(task: ProspectWriteTask, context: Pick<ProspectWriteTask, 'scope' | 'resourceUrl' | 'developmentUrl' | 'mappingSignature'>) {
  return task.scope === context.scope && task.resourceUrl === context.resourceUrl
    && task.developmentUrl === context.developmentUrl && task.mappingSignature === context.mappingSignature;
}

/** Unknown submissions retain their envelope. Certified failures may retry this row alone. */
export async function executeProspectWriteTask(task: ProspectWriteTask, io: {
  current: () => boolean;
  save: (task: ProspectWriteTask) => void;
  validate: (step: ProspectWriteStep) => Promise<string | undefined>;
  write: (step: ProspectWriteStep) => Promise<FeishuBatchResult>;
  applied: (step: ProspectWriteStep, task: ProspectWriteTask) => void;
}): Promise<ProspectWriteTask> {
  const next = structuredClone(task);
  for (const step of next.steps) {
    // The per-row operationId predates batching and has not been submitted as a
    // single request. Only certified failures (never unknown creates) can split.
    // Updating one row after review must not resubmit other rows' stale values.
    if (step.batch && (
      (step.status === 'failed' && step.batch.items.length > 1)
      || (step.action === 'batchUpdate' && !['success', 'unknown', 'writing'].includes(step.status))
    )) delete step.batch;
  }
  const save = () => { if (io.current()) io.save(structuredClone(next)); };
  for (let i = 0; i < next.steps.length; i++) {
    if (!io.current()) return next;
    const step = next.steps[i];
    if (step.status === 'success') continue;
    if (step.status === 'unknown' || step.status === 'writing') {
      next.status = 'unknown'; save(); return next;
    }
    let reason: string | undefined;
    try { reason = await io.validate(step); } catch (error) {
      step.status = 'failed'; step.error = error instanceof Error ? error.message : '写入前检查失败';
      next.status = 'failed'; next.error = step.error; save(); return next;
    }
    if (!io.current()) return next;
    if (reason) { step.status = 'review'; next.status = 'review'; next.error = reason; save(); return next; }
    step.status = 'writing'; step.error = undefined; next.status = 'writing'; next.error = undefined;
    // Persistence is required before sending a write, not a debounced best effort.
    save();
    let result: FeishuBatchResult;
    try { result = await io.write(structuredClone(step)); } catch {
      result = { clientId: next.id, status: 'failed', outcomeCertain: false, error: '响应中断，结果待核实。' };
    }
    if (!io.current()) return next;
    if (result.status === 'success' && result.recordId) {
      step.recordId = result.recordId; step.status = 'success'; save();
      io.applied(structuredClone(step), structuredClone(next));
    } else {
      step.status = result.outcomeCertain === true ? 'failed' : 'unknown';
      step.error = result.error || '飞书未返回明确写入结果。';
      next.status = step.status; next.error = step.error; save(); return next;
    }
  }
  next.status = 'success'; next.error = undefined; save(); return next;
}

type TaskEntry = { clientId: string; task: ProspectWriteTask };
type BatchIo = {
  current: (task: ProspectWriteTask) => boolean;
  save: (id: string, task: ProspectWriteTask) => void;
  validate: (step: ProspectWriteStep, task: ProspectWriteTask) => Promise<string | undefined>;
  write: (step: ProspectWriteStep) => Promise<FeishuBatchResult[]>;
  applied: (id: string, step: ProspectWriteStep, task: ProspectWriteTask) => void;
};

/** Batch each dependency wave. Persist the immutable envelope before submitting it. */
export async function executeProspectWriteTaskBatch(entries: TaskEntry[], io: BatchIo) {
  const tasks = structuredClone(entries);
  const stopped = new Set<string>();
  while (true) {
    const ready: Array<TaskEntry & { step: ProspectWriteStep }> = [];
    // Bound reads rather than launching one request per selected creator at once.
    for (let offset = 0; offset < tasks.length; offset += 4) {
      await Promise.all(tasks.slice(offset, offset + 4).map(async (entry) => {
        if (stopped.has(entry.clientId) || !io.current(entry.task)) return;
        const step = entry.task.steps.find((item) => item.status !== 'success');
        if (!step) {
          entry.task.status = 'success'; entry.task.error = undefined; entry.task.progress = undefined;
          io.save(entry.clientId, entry.task); stopped.add(entry.clientId); return;
        }
        if (['writing', 'unknown'].includes(step.status)) {
          entry.task.status = 'unknown'; io.save(entry.clientId, entry.task); stopped.add(entry.clientId); return;
        }
        try {
          const reason = await io.validate(step, entry.task);
          if (!io.current(entry.task)) return;
          if (reason) {
            step.status = 'review'; entry.task.status = 'review'; entry.task.error = reason;
            io.save(entry.clientId, entry.task); stopped.add(entry.clientId); return;
          }
          ready.push({ ...entry, step });
        } catch (error) {
          step.status = 'failed'; entry.task.status = 'failed';
          entry.task.error = error instanceof Error ? error.message : '写入前检查失败。';
          io.save(entry.clientId, entry.task); stopped.add(entry.clientId);
        }
      }));
    }
    if (!ready.length) break;
    const groups = new Map<string, typeof ready>();
    const updateTargets = new Set<string>();
    for (const entry of ready) {
      if (entry.step.action === 'batchUpdate') {
        const target = JSON.stringify([entry.step.url, entry.step.recordId]);
        if (updateTargets.has(target)) {
          entry.step.status = 'review'; entry.task.status = 'review';
          entry.task.error = '本批次另一个任务也在更新同一资源记录，请核对最新邮箱后继续。';
          io.save(entry.clientId, entry.task); stopped.add(entry.clientId); continue;
        }
        updateTargets.add(target);
      }
      const key = JSON.stringify([entry.step.url, entry.step.action, entry.step.batch?.operationId || 'new']);
      const group = groups.get(key) || []; group.push(entry); groups.set(key, group);
    }
    for (const group of groups.values()) {
      // Envelopes live in each row's journal; bound their size for browser storage.
      for (let offset = 0; offset < group.length; offset += 20) {
        const chunk = group.slice(offset, offset + 20);
        if (!chunk.every((entry) => io.current(entry.task))) continue;
        const batch = chunk[0].step.batch || {
          operationId: `${chunk[0].step.operationId}:batch`,
          items: chunk.map(({ clientId, step }) => ({ clientId, recordId: step.recordId, fields: step.fields })),
        };
        // If persistence fails, no external request may be submitted.
        for (const entry of chunk) {
          entry.step.batch = structuredClone(batch); entry.step.status = 'writing'; entry.step.error = undefined;
          entry.task.status = 'writing'; entry.task.error = undefined;
          entry.task.progress = entry.step.key === 'resource' ? '正在创建资源库记录'
            : entry.step.key === 'development' ? '正在创建本轮开发记录'
            : entry.step.key === 'email' ? '正在补写资源库邮箱' : '正在同步邀约阶段';
          io.save(entry.clientId, entry.task);
        }
        let results: FeishuBatchResult[];
        try { results = await io.write(chunk[0].step); }
        catch { results = []; }
        for (const entry of chunk) {
          if (!io.current(entry.task)) continue;
          const result = results.find((item) => item.clientId === entry.clientId);
          if (result?.status === 'success' && result.recordId) {
            entry.step.recordId = result.recordId; entry.step.status = 'success';
            io.save(entry.clientId, entry.task);
            io.applied(entry.clientId, entry.step, entry.task);
          } else {
            entry.step.status = result?.outcomeCertain === true ? 'failed' : 'unknown';
            entry.step.error = result?.error || '响应中断，写入结果待核实。';
            entry.task.status = entry.step.status; entry.task.error = entry.step.error;
            io.save(entry.clientId, entry.task); stopped.add(entry.clientId);
          }
        }
      }
    }
  }
  return tasks;
}
