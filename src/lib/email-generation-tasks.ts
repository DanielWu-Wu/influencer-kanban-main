export const EMAIL_GENERATION_TASK_RETENTION_MS = 24 * 60 * 60 * 1000;
export const EMAIL_GENERATION_TASKS_SCHEMA_VERSION = 1;
export const EMAIL_GENERATION_TASK_OPEN_EVENT = 'email-generation-task-open';
export const EMAIL_GENERATION_TOASTER_ID = 'email-generation-tasks';

export type EmailGenerationTaskKind =
  | 'gmail_ai_reply'
  | 'gmail_template_reply'
  | 'outreach_email';

export type EmailGenerationTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export type EmailGenerationTaskNavigation =
  | {
      view: 'gmail';
      threadId: string;
      messageId?: string;
      composerMode: 'ai' | 'template';
    }
  | {
      view: 'prospecting';
      prospectId: string;
    };

export interface EmailGenerationTask {
  id: string;
  key: string;
  kind: EmailGenerationTaskKind;
  status: EmailGenerationTaskStatus;
  accountUserId: string;
  gmailEmail: string;
  title: string;
  description: string;
  avatarUrl?: string;
  stage: string;
  navigation: EmailGenerationTaskNavigation;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  partialResult?: unknown;
  rollbackResult?: unknown;
  retryInput?: unknown;
  error?: string;
}

export interface EmailGenerationTaskCloudSnapshot {
  version: number;
  tasks: EmailGenerationTask[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneJsonValue(value: unknown) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return undefined;
  }
}

function parseNavigation(value: unknown): EmailGenerationTaskNavigation | null {
  if (!isRecord(value) || typeof value.view !== 'string') return null;
  if (
    value.view === 'gmail'
    && typeof value.threadId === 'string'
    && (value.composerMode === 'ai' || value.composerMode === 'template')
  ) {
    return {
      view: 'gmail',
      threadId: value.threadId,
      messageId: typeof value.messageId === 'string' ? value.messageId : undefined,
      composerMode: value.composerMode,
    };
  }
  if (value.view === 'prospecting' && typeof value.prospectId === 'string') {
    return { view: 'prospecting', prospectId: value.prospectId };
  }
  return null;
}

function parseTask(value: unknown): EmailGenerationTask | null {
  if (!isRecord(value)) return null;
  const navigation = parseNavigation(value.navigation);
  const validKind = value.kind === 'gmail_ai_reply'
    || value.kind === 'gmail_template_reply'
    || value.kind === 'outreach_email';
  const validStatus = value.status === 'queued'
    || value.status === 'running'
    || value.status === 'completed'
    || value.status === 'failed'
    || value.status === 'cancelled'
    || value.status === 'interrupted';
  if (
    typeof value.id !== 'string'
    || typeof value.key !== 'string'
    || !validKind
    || !validStatus
    || typeof value.accountUserId !== 'string'
    || typeof value.gmailEmail !== 'string'
    || typeof value.title !== 'string'
    || typeof value.description !== 'string'
    || typeof value.stage !== 'string'
    || !navigation
    || typeof value.createdAt !== 'number'
  ) return null;
  return {
    id: value.id,
    key: value.key,
    kind: value.kind as EmailGenerationTaskKind,
    status: value.status as EmailGenerationTaskStatus,
    accountUserId: value.accountUserId,
    gmailEmail: value.gmailEmail,
    title: value.title,
    description: value.description,
    avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : undefined,
    stage: value.stage,
    navigation,
    createdAt: value.createdAt,
    startedAt: typeof value.startedAt === 'number' ? value.startedAt : undefined,
    completedAt: typeof value.completedAt === 'number' ? value.completedAt : undefined,
    result: cloneJsonValue(value.result),
    partialResult: cloneJsonValue(value.partialResult),
    rollbackResult: cloneJsonValue(value.rollbackResult),
    retryInput: cloneJsonValue(value.retryInput),
    error: typeof value.error === 'string' ? value.error : undefined,
  };
}

export function readEmailGenerationTaskSnapshot(value: unknown): EmailGenerationTask[] {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.tasks)
      ? value.tasks
      : [];
  return candidates.map(parseTask).filter((task): task is EmailGenerationTask => Boolean(task));
}

export function serializeEmailGenerationTasks(tasks: EmailGenerationTask[]): EmailGenerationTaskCloudSnapshot {
  return {
    version: EMAIL_GENERATION_TASKS_SCHEMA_VERSION,
    tasks: readEmailGenerationTaskSnapshot({ tasks }),
  };
}

export function markInterruptedEmailGenerationTasks(
  tasks: EmailGenerationTask[],
  now = Date.now(),
) {
  return tasks.map((task) => (
    task.status === 'queued' || task.status === 'running'
      ? {
          ...task,
          status: 'interrupted' as const,
          stage: '页面已关闭或会话已中断，可重试',
          completedAt: now,
          error: undefined,
        }
      : task
  ));
}

export function normalizeEmailGenerationConcurrency(value: number) {
  if (!Number.isFinite(value)) return 2;
  return Math.min(10, Math.max(2, Math.round(value)));
}

export function selectStartableEmailTaskIds(
  tasks: EmailGenerationTask[],
  concurrency: number,
) {
  const normalizedConcurrency = normalizeEmailGenerationConcurrency(concurrency);
  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const availableSlots = Math.max(0, normalizedConcurrency - runningCount);
  if (availableSlots === 0) return [];

  return tasks
    .filter((task) => task.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, availableSlots)
    .map((task) => task.id);
}

export function pruneExpiredEmailGenerationTasks(
  tasks: EmailGenerationTask[],
  now = Date.now(),
) {
  return tasks.filter((task) => {
    if (task.status === 'queued' || task.status === 'running') return true;
    return now - (task.completedAt || task.createdAt) < EMAIL_GENERATION_TASK_RETENTION_MS;
  });
}

export function buildGmailEmailGenerationTaskKey(input: {
  kind: 'gmail_ai_reply' | 'gmail_template_reply';
  threadId: string;
  messageId?: string;
}) {
  return [input.kind, input.threadId, input.messageId || 'latest'].join(':');
}

export function buildOutreachEmailGenerationTaskKey(prospectId: string) {
  return `outreach_email:${prospectId}`;
}

export function buildEmailGenerationTaskScopeKey(
  accountUserId: string | undefined,
  gmailEmail: string | undefined,
) {
  return `${String(accountUserId || '').trim()}:${String(gmailEmail || 'no-gmail').trim().toLowerCase()}`;
}
