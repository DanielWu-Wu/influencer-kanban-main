import type { FeishuFieldKey, FeishuFieldMapping } from './feishu-mapping';
import { FEISHU_FIELD_TARGETS } from './feishu-mapping';

export type RecordAssistantEventType = 'email_sent' | 'status_changed' | 'draft_saved';

export type RecordAssistantEvent = {
  type: RecordAssistantEventType;
  source: 'gmail' | 'kanban' | 'manual';
  title: string;
  summary: string;
  occurredAt?: string;
  influencer?: {
    id?: string;
    channelName?: string;
    email?: string;
    previousStatus?: string;
    previousStatusLabel?: string;
    newStatus?: string;
    statusLabel?: string;
  };
  email?: {
    to?: string;
    from?: string;
    subject?: string;
    body?: string;
  };
};

export type RecordAssistantRuleUpdate = {
  fieldKey: FeishuFieldKey;
  valueTemplate: string;
  enabled: boolean;
};

export type RecordAssistantRule = {
  id: string;
  eventType: RecordAssistantEventType;
  label: string;
  enabled: boolean;
  updates: RecordAssistantRuleUpdate[];
};

export type RecordAssistantSettings = {
  enabled: boolean;
  rules: RecordAssistantRule[];
};

export type PendingRecordUpdate = {
  fieldKey: FeishuFieldKey;
  fieldLabel: string;
  fieldName?: string;
  value: string;
  valueTemplate: string;
  enabled: boolean;
};

export type PendingRecordSync = {
  id: string;
  event: RecordAssistantEvent;
  updates: PendingRecordUpdate[];
  createdAt: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed' | 'dismissed';
  error?: string;
  recordId?: string;
  matchedBy?: string;
};

export type RecordAssistantLog = PendingRecordSync & {
  finishedAt: string;
};

export const RECORD_ASSISTANT_EVENT_OPTIONS: Array<{
  value: RecordAssistantEventType;
  label: string;
}> = [
  { value: 'email_sent', label: '邮件发送成功' },
  { value: 'status_changed', label: '红人状态变更' },
  { value: 'draft_saved', label: '邮件保存草稿' },
];

export const FEISHU_FIELD_LABELS = Object.fromEntries(
  FEISHU_FIELD_TARGETS.map((target) => [target.key, target.label]),
) as Record<FeishuFieldKey, string>;

export const DEFAULT_RECORD_ASSISTANT_SETTINGS: RecordAssistantSettings = {
  enabled: true,
  rules: [
    {
      id: 'rule-email-sent',
      eventType: 'email_sent',
      label: '发送邮件后记录开发进度',
      enabled: true,
      updates: [
        {
          fieldKey: 'firstOutreach',
          valueTemplate: '已发',
          enabled: true,
        },
        {
          fieldKey: 'collaborationProgress',
          valueTemplate: '{{today}} 已发送邮件：{{subject}}',
          enabled: true,
        },
      ],
    },
    {
      id: 'rule-status-changed',
      eventType: 'status_changed',
      label: '看板状态变更后同步合作状态',
      enabled: true,
      updates: [
        {
          fieldKey: 'collaborationStatus',
          valueTemplate: '{{feishuStatus}}',
          enabled: true,
        },
        {
          fieldKey: 'collaborationProgress',
          valueTemplate: '{{today}} 看板状态更新为：{{statusLabel}}',
          enabled: true,
        },
      ],
    },
  ],
};

type AssistantBuildSettings = {
  feishuFieldMapping?: FeishuFieldMapping;
  recordAssistantSettings?: RecordAssistantSettings;
};

function cloneSettings(settings: RecordAssistantSettings) {
  return {
    ...settings,
    rules: settings.rules.map((rule) => ({
      ...rule,
      updates: rule.updates.map((update) => ({ ...update })),
    })),
  };
}

export function mergeRecordAssistantSettings(settings?: RecordAssistantSettings) {
  if (!settings) return cloneSettings(DEFAULT_RECORD_ASSISTANT_SETTINGS);

  const customRules = settings.rules || [];
  const mergedDefaultRules = DEFAULT_RECORD_ASSISTANT_SETTINGS.rules.map((defaultRule) => {
    const customRule = customRules.find((rule) => rule.id === defaultRule.id);
    if (!customRule) return cloneSettings({ enabled: true, rules: [defaultRule] }).rules[0];
    return {
      ...defaultRule,
      ...customRule,
      updates: customRule.updates?.length ? customRule.updates : defaultRule.updates,
    };
  });
  const extraRules = customRules.filter(
    (customRule) => !DEFAULT_RECORD_ASSISTANT_SETTINGS.rules.some((rule) => rule.id === customRule.id),
  );

  return {
    enabled: settings.enabled ?? true,
    rules: [...mergedDefaultRules, ...extraRules].map((rule) => ({
      ...rule,
      updates: rule.updates.map((update) => ({ ...update })),
    })),
  };
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatDate(value: Date) {
  return value.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function getFeishuStatusValue(status?: string) {
  if (!status) return '';
  if (['interested', 'negotiating', 'confirmed', 'sampling', 'filming'].includes(status)) {
    return '合作中';
  }
  if (['published', 'archived'].includes(status)) {
    return '我合作完毕的';
  }
  return '暂无合作';
}

function getTokenValues(event: RecordAssistantEvent) {
  const occurredAt = event.occurredAt ? new Date(event.occurredAt) : new Date();
  return {
    today: formatDate(occurredAt),
    now: occurredAt.toLocaleString('zh-CN'),
    eventTitle: event.title,
    eventSummary: event.summary,
    channelName: event.influencer?.channelName || '',
    email: event.influencer?.email || event.email?.to || event.email?.from || '',
    recipient: event.email?.to || '',
    sender: event.email?.from || '',
    subject: event.email?.subject || '',
    body: event.email?.body || '',
    previousStatus: event.influencer?.previousStatus || '',
    previousStatusLabel: event.influencer?.previousStatusLabel || '',
    newStatus: event.influencer?.newStatus || '',
    statusLabel: event.influencer?.statusLabel || '',
    feishuStatus: getFeishuStatusValue(event.influencer?.newStatus),
  };
}

export function renderRecordAssistantTemplate(template: string, event: RecordAssistantEvent) {
  const values = getTokenValues(event);
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: keyof typeof values) => {
    return values[key] ?? '';
  });
}

export function buildRecordSyncFromEvent(
  event: RecordAssistantEvent,
  settings: AssistantBuildSettings,
) {
  const assistantSettings = mergeRecordAssistantSettings(settings.recordAssistantSettings);
  if (!assistantSettings.enabled) return null;

  const mapping = settings.feishuFieldMapping || {};
  const updates = assistantSettings.rules
    .filter((rule) => rule.enabled && rule.eventType === event.type)
    .flatMap((rule) => rule.updates)
    .filter((update) => update.enabled)
    .map((update) => ({
      ...update,
      fieldLabel: FEISHU_FIELD_LABELS[update.fieldKey] || update.fieldKey,
      fieldName: mapping[update.fieldKey],
      value: renderRecordAssistantTemplate(update.valueTemplate, event).trim(),
    }))
    .filter((update) => update.value);

  if (!updates.length) return null;

  return {
    id: createId('record-sync'),
    event: {
      ...event,
      occurredAt: event.occurredAt || new Date().toISOString(),
    },
    updates,
    createdAt: new Date().toISOString(),
    status: 'pending' as const,
  } satisfies PendingRecordSync;
}

export function formatRecordAssistantEventType(type: RecordAssistantEventType) {
  return RECORD_ASSISTANT_EVENT_OPTIONS.find((item) => item.value === type)?.label || type;
}

export function normalizeEmail(value?: string) {
  return (value || '')
    .match(/<([^>]+)>/)?.[1]
    ?.toLowerCase()
    .trim() || (value || '').toLowerCase().trim();
}
