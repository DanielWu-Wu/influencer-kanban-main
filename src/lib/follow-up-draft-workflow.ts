import type { FeishuFieldMapping } from '@/lib/feishu-mapping';

export type FollowUpStage = 2 | 3;

export type FollowUpMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  rfcMessageId: string;
  references: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
};

export type FollowUpCheck = {
  outbound: FollowUpMessage[];
  reply: FollowUpMessage | null;
  automatedReply: FollowUpMessage | null;
  deliveryFailure: FollowUpMessage | null;
};

export type FollowUpSourceRecord = {
  recordId: string;
  channelName: string;
  email: string;
  developmentDate: number;
  firstOutreach: string;
  secondOutreachDate: number;
  secondOutreach: string;
  thirdOutreachDate: number;
  thirdOutreach: string;
  language: string;
  targetProduct: string;
  cooperationType: string;
  cooperationIdea: string;
};

export type FollowUpEligibility = {
  allowed: boolean;
  dueAt: number;
  code:
    | 'eligible'
    | 'missing_email'
    | 'invalid_date'
    | 'not_due'
    | 'stage_already_complete'
    | 'previous_stage_incomplete'
    | 'needs_gmail_check'
    | 'missing_initial_email'
    | 'already_sent_in_gmail'
    | 'human_reply'
    | 'delivery_failure'
    | 'missing_previous_body';
  reason: string;
  warning?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfLocalDay(value: number) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function followUpDueAt(developmentDate: number, stage: FollowUpStage) {
  const start = startOfLocalDay(developmentDate);
  return start ? start + (stage === 2 ? 3 : 7) * DAY_MS : 0;
}

export function isFollowUpSent(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || /^(未发|未发送|尚未发送|否|false|no|0)$/.test(normalized)) return false;
  return /已发|已发送|sent|true|yes|^1$/.test(normalized);
}

export function mappedFollowUpSentCount(record: FollowUpSourceRecord) {
  if (record.thirdOutreachDate || isFollowUpSent(record.thirdOutreach)) return 3;
  if (record.secondOutreachDate || isFollowUpSent(record.secondOutreach)) return 2;
  return 1;
}

export function evaluateFollowUpEligibility({
  record,
  stage,
  now = Date.now(),
  check,
  previousBody,
  previousStageSaved = false,
}: {
  record: FollowUpSourceRecord;
  stage: FollowUpStage;
  now?: number;
  check?: FollowUpCheck;
  previousBody?: string;
  previousStageSaved?: boolean;
}): FollowUpEligibility {
  const dueAt = followUpDueAt(record.developmentDate, stage);
  if (!record.email.trim()) {
    return { allowed: false, dueAt, code: 'missing_email', reason: '缺少有效邮箱，不能生成跟进邮件。' };
  }
  if (!dueAt) {
    return { allowed: false, dueAt, code: 'invalid_date', reason: '开发日期无效，不能计算跟进时间。' };
  }
  if (startOfLocalDay(now) < dueAt) {
    return { allowed: false, dueAt, code: 'not_due', reason: `尚未到第 ${stage === 2 ? 3 : 7} 天跟进时间。` };
  }

  const mappedCount = mappedFollowUpSentCount(record);
  if (mappedCount >= stage) {
    return { allowed: false, dueAt, code: 'stage_already_complete', reason: '该阶段已经按运营流程完成。' };
  }
  if (stage === 3 && mappedCount < 2 && !previousStageSaved) {
    return { allowed: false, dueAt, code: 'previous_stage_incomplete', reason: '请先完成第1次跟进。' };
  }
  if (!check) {
    return { allowed: true, dueAt, code: 'needs_gmail_check', reason: '生成前需要重新检查 Gmail。' };
  }
  if (check.reply) {
    return { allowed: false, dueAt, code: 'human_reply', reason: '已经收到人工回复，后续跟进已停止。' };
  }
  if (check.deliveryFailure) {
    return { allowed: false, dueAt, code: 'delivery_failure', reason: '检测到退信，请修正邮箱后再继续。' };
  }
  if (!check.outbound[0]) {
    return { allowed: false, dueAt, code: 'missing_initial_email', reason: 'Gmail 中没有找到初次开发信。' };
  }
  if (check.outbound.length >= stage) {
    return { allowed: false, dueAt, code: 'already_sent_in_gmail', reason: 'Gmail 已存在该阶段邮件，不会重复生成。' };
  }
  if (stage === 3 && !check.outbound[1]?.body?.trim() && !previousBody?.trim()) {
    return { allowed: false, dueAt, code: 'missing_previous_body', reason: '没有找到第1次跟进正文，不能生成第2次跟进。' };
  }
  return {
    allowed: true,
    dueAt,
    code: 'eligible',
    reason: '可以生成跟进邮件。',
    warning: check.automatedReply ? '检测到自动回复，但不会停止跟进。' : undefined,
  };
}

export function canSaveFollowUpDraft({
  status,
  body,
  chineseBody,
  chineseDirty,
  gmailDraftId,
}: {
  status: string;
  body: string;
  chineseBody: string;
  chineseDirty: boolean;
  gmailDraftId?: string;
}) {
  return (status === 'generated' || status === 'ready')
    && Boolean(body.trim())
    && Boolean(chineseBody.trim())
    && !chineseDirty
    && !gmailDraftId;
}

export function followUpTaskKey(recordId: string, stage: FollowUpStage) {
  return `${recordId}:${stage}`;
}

export function buildFollowUpSentPayload(
  stage: FollowUpStage,
  sentAt: number,
  mapping: FeishuFieldMapping,
) {
  const statusField = stage === 2 ? mapping.secondOutreach : mapping.thirdOutreach;
  const dateField = stage === 2 ? mapping.secondOutreachDate : mapping.thirdOutreachDate;
  if (!statusField || !dateField) return null;
  return { [statusField]: '已发', [dateField]: sentAt };
}

export function followUpSaveMode({
  status,
  gmailDraftId,
  canSave,
}: {
  status: string;
  gmailDraftId?: string;
  canSave: boolean;
}): 'create_gmail' | 'retry_feishu' | 'blocked' {
  if (status === 'feishu_error' && gmailDraftId) return 'retry_feishu';
  if (!gmailDraftId && canSave) return 'create_gmail';
  return 'blocked';
}
