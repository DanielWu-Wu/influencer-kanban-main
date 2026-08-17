export const EMAIL_GENERATION_TASK_RETENTION_MS = 24 * 60 * 60 * 1000;
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
  | 'cancelled';

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
  error?: string;
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
