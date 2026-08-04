import type { Prospect } from '@/lib/creator-prospecting';

export type FeishuWriteTarget = 'resource' | 'development';

export type EmailSyncPlan =
  | { status: 'checking'; recordId: string }
  | {
      status: 'will_update';
      recordId: string;
      fieldName: string;
      currentValue: string;
      nextValue: string;
      appendedEmail: string;
    }
  | { status: 'already_exists'; currentValue: string; appendedEmail: string }
  | { status: 'missing_mapping' | 'missing_record' | 'missing_email' }
  | { status: 'failed'; message: string };

function normalizedEmailSet(value: string) {
  return Array.from(new Set(
    value
      .split(/[\n,，;；、\s]+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  )).sort().join('|');
}

export function compareProspectWritePlan(
  previous: Prospect,
  refreshed: Prospect,
  target: FeishuWriteTarget,
) {
  const reasons: string[] = [];

  if (target === 'resource') {
    if (
      previous.resourceStatus !== refreshed.resourceStatus
      || (previous.resourceRecordId || '') !== (refreshed.resourceRecordId || '')
      || (previous.duplicateRecordId || '') !== (refreshed.duplicateRecordId || '')
    ) {
      if (refreshed.resourceStatus === 'exists') {
        reasons.push('飞书资源库中已出现这位红人的记录，将停止重复建档。');
      } else if (refreshed.resourceStatus === 'conflict') {
        reasons.push('资源库出现多条精确匹配记录，需要先处理匹配冲突。');
      } else if (refreshed.resourceStatus === 'suspected') {
        reasons.push('资源库出现疑似重复记录，需要重新确认。');
      } else {
        reasons.push('这位红人的资源库匹配结果已经变化。');
      }
    }
    return reasons;
  }

  if (
    previous.developmentStatus !== refreshed.developmentStatus
    || (previous.previousDevelopmentRecordId || '') !== (refreshed.previousDevelopmentRecordId || '')
    || (previous.duplicateRecordId || '') !== (refreshed.duplicateRecordId || '')
  ) {
    if (refreshed.developmentStatus === 'history_exists') {
      reasons.push('飞书中已出现历史开发记录，本次将改为新建一轮独立开发记录。');
    } else if (refreshed.developmentStatus === 'conflict') {
      reasons.push('开发记录表出现多条精确匹配记录，需要先处理匹配冲突。');
    } else if (refreshed.developmentStatus === 'suspected') {
      reasons.push('开发记录表出现疑似重复记录，需要重新确认。');
    } else {
      reasons.push('这位红人的开发记录匹配结果已经变化。');
    }
  }

  if (
    previous.resourceStatus !== refreshed.resourceStatus
    || (previous.resourceRecordId || '') !== (refreshed.resourceRecordId || '')
  ) {
    reasons.push('关联的红人资源库记录已经变化。');
  }

  return reasons;
}

export function isProspectWriteBlocked(
  prospect: Prospect,
  target: FeishuWriteTarget,
) {
  if (target === 'resource') {
    return prospect.resourceStatus !== 'missing' || Boolean(prospect.resourceRecordId);
  }
  return prospect.resourceStatus === 'conflict'
    || prospect.resourceStatus === 'suspected'
    || prospect.developmentStatus === 'conflict'
    || prospect.developmentStatus === 'suspected';
}

export function compareEmailSyncPlan(
  previous: EmailSyncPlan | undefined,
  refreshed: EmailSyncPlan | undefined,
) {
  if (JSON.stringify(previous) === JSON.stringify(refreshed)) {
    return { requiresConfirmation: false, message: '' };
  }

  if (
    previous?.status === 'will_update'
    && refreshed?.status === 'already_exists'
    && previous.appendedEmail.trim().toLowerCase() === refreshed.appendedEmail.trim().toLowerCase()
    && normalizedEmailSet(previous.nextValue) === normalizedEmailSet(refreshed.currentValue)
  ) {
    return {
      requiresConfirmation: false,
      message: '资源库邮箱已经由其他操作补全，本次将自动跳过重复补写。',
    };
  }

  return {
    requiresConfirmation: true,
    message: '资源库邮箱补写内容已经变化，需要重新确认。',
  };
}
