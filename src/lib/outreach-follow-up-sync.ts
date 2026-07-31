import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';

type FollowUpSyncMessage = {
  date: string;
};

export type FollowUpSyncRecord = {
  firstOutreach: string;
  secondOutreachDate: number;
  secondOutreach: string;
  thirdOutreachDate: number;
  thirdOutreach: string;
  hasReply: string;
  check?: {
    outbound: FollowUpSyncMessage[];
    reply: unknown | null;
  };
};

export type FollowUpWriteChanges = {
  fields: Array<{ label: string; value: string }>;
  payload: Record<string, unknown>;
};

function isSent(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || /^(未发|未发送|尚未发送|否|false|no|0)$/.test(normalized)) return false;
  return /已发|已发送|sent|true|yes|^1$/.test(normalized);
}

function isSameCalendarDate(current: number, next: number) {
  if (!current || !next) return false;
  const currentDate = new Date(current);
  const nextDate = new Date(next);
  if (Number.isNaN(currentDate.getTime()) || Number.isNaN(nextDate.getTime())) return false;
  return currentDate.getFullYear() === nextDate.getFullYear()
    && currentDate.getMonth() === nextDate.getMonth()
    && currentDate.getDate() === nextDate.getDate();
}

function replyStatusMatches(value: string, hasReply: boolean) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (hasReply) return ['已回复', '是', 'true', 'yes', '1'].includes(normalized);
  return ['未回复', '否', 'false', 'no', '0'].includes(normalized);
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(value);
}

export function buildFollowUpWriteChanges(
  record: FollowUpSyncRecord,
  mapping: FeishuFieldMapping,
): FollowUpWriteChanges | null {
  if (!record.check || record.check.outbound.length === 0) return null;
  const fields: FollowUpWriteChanges['fields'] = [];
  const payload: Record<string, unknown> = {};
  const append = (
    key: FeishuFieldKey,
    label: string,
    value: string | number,
    unchanged: boolean,
  ) => {
    const fieldName = mapping[key];
    if (!fieldName || unchanged) return;
    payload[fieldName] = value;
    fields.push({ label, value: typeof value === 'number' ? formatDate(value) : value });
  };

  append('firstOutreach', '初次开发信', '已发', isSent(record.firstOutreach));

  if (record.check.outbound.length >= 2) {
    const sentAt = new Date(record.check.outbound[1].date).getTime();
    append(
      'secondOutreachDate',
      '一次 Follow Up 日期',
      sentAt,
      isSameCalendarDate(record.secondOutreachDate, sentAt),
    );
    append('secondOutreach', '一次 Follow Up', '已发', isSent(record.secondOutreach));
  }

  if (record.check.outbound.length >= 3) {
    const sentAt = new Date(record.check.outbound[2].date).getTime();
    append(
      'thirdOutreachDate',
      '二次 Follow Up 日期',
      sentAt,
      isSameCalendarDate(record.thirdOutreachDate, sentAt),
    );
    append('thirdOutreach', '二次 Follow Up', '已发', isSent(record.thirdOutreach));
  }

  const hasReply = Boolean(record.check.reply);
  append(
    'hasReply',
    '是否回复',
    hasReply ? '已回复' : '未回复',
    replyStatusMatches(record.hasReply, hasReply),
  );

  return fields.length ? { fields, payload } : null;
}
