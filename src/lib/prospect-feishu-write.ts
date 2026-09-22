import type { FeishuBatchResult } from './feishu-batch';

export type ProspectWriteKind = 'resource' | 'development' | 'quick' | 'invitation';
export type ProspectWriteStatus = 'checking' | 'pending' | 'writing' | 'success' | 'failed' | 'unknown' | 'review';
export type ProspectWriteStep = {
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

/** Each step has one immutable request envelope: retry never repartitions a batch. */
export async function executeProspectWriteTask(task: ProspectWriteTask, io: {
  current: () => boolean;
  save: (task: ProspectWriteTask) => void;
  validate: (step: ProspectWriteStep) => Promise<string | undefined>;
  write: (step: ProspectWriteStep) => Promise<FeishuBatchResult>;
  applied: (step: ProspectWriteStep, task: ProspectWriteTask) => void;
}): Promise<ProspectWriteTask> {
  const next = structuredClone(task);
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
