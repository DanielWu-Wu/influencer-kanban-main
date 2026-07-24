'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  Loader2,
  MailCheck,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';
import {
  appendEmailSignature,
  applyPlainTextEmailSignature,
  stripConfiguredEmailSignature,
  textToEmailHtml,
} from '@/lib/email-content';
import type { AppSettings } from '@/lib/data';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';
import type { GmailAuth } from '@/lib/types';
import { buildChannelAvatarLookup, resolveChannelAvatar } from '@/lib/youtube-channel-avatar';

type FeishuRecord = { record_id: string; fields: Record<string, unknown> };
type GmailMessage = {
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
type FollowUpCheck = {
  outbound: GmailMessage[];
  reply: GmailMessage | null;
  automatedReply: GmailMessage | null;
  deliveryFailure: GmailMessage | null;
};
type FollowUpStage = 2 | 3;
type FollowUpRecord = {
  recordId: string;
  channelName: string;
  avatarUrl: string;
  email: string;
  channelUrl: string;
  channelId: string;
  developmentDate: number;
  firstOutreach: string;
  secondOutreachDate: number;
  secondOutreach: string;
  thirdOutreachDate: number;
  thirdOutreach: string;
  hasReply: string;
  language: string;
  targetProduct: string;
  cooperationType: string;
  cooperationIdea: string;
  check?: FollowUpCheck;
  checkedAt?: number;
  checkError?: string;
  synced?: boolean;
};
type FollowUpDraft = {
  stage: FollowUpStage;
  status: 'checking' | 'generating' | 'saving' | 'saved' | 'error';
  body: string;
  translatedBody: string;
  language: string;
  gmailDraftId?: string;
  generatedAt?: number;
  error?: string;
};
type WritePreview = {
  record: FollowUpRecord;
  fields: Array<{ label: string; value: string }>;
  payload: Record<string, unknown>;
};
type MarkSentPreview = {
  record: FollowUpRecord;
  stage: FollowUpStage;
  sentAt: number;
};
type Props = {
  settings: AppSettings;
  auth: GmailAuth | null;
  onAuthRefresh: (auth: GmailAuth) => void;
};

const RANGE_OPTIONS = [7, 10, 14, 30] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const FOLLOW_UP_DRAFT_CACHE_KEY = 'influencer_follow_up_drafts_v1';
const FOLLOW_UP_DRAFT_CACHE_MAX_AGE = 30 * DAY_MS;

function followUpDraftKey(recordId: string, stage: FollowUpStage) {
  return `${recordId}:${stage}`;
}

function dateInputTimestamp(value: string, endOfDay = false) {
  if (!value) return 0;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date.getTime();
}

function loadFollowUpDraftCache(storageKey: string) {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, FollowUpDraft>;
    const expiresBefore = Date.now() - FOLLOW_UP_DRAFT_CACHE_MAX_AGE;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, draft]) => (
        draft?.status === 'saved'
        && (draft.stage === 2 || draft.stage === 3)
        && Boolean(draft.body?.trim())
        && Number(draft.generatedAt || 0) >= expiresBefore
      )),
    );
  } catch {
    return {};
  }
}

function flattenFeishuValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenFeishuValue).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return flattenFeishuValue(item.text || item.name || item.email || item.link || Object.values(item));
  }
  return '';
}

function mappedValue(record: FeishuRecord, mapping: FeishuFieldMapping, key: FeishuFieldKey) {
  const fieldName = mapping[key];
  return fieldName ? flattenFeishuValue(record.fields[fieldName]).trim() : '';
}

function getFeishuImageUrl(value: unknown): string {
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : '';
  if (Array.isArray(value)) return value.map(getFeishuImageUrl).find(Boolean) || '';
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return [item.thumbnail_url, item.url, item.tmp_url, item.link]
      .map(getFeishuImageUrl)
      .find(Boolean) || '';
  }
  return '';
}

function channelInitials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '红人';
}

function parseFeishuDate(value: unknown) {
  const text = flattenFeishuValue(value).trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = new Date(text).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: number | string | undefined) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime()) || date.getTime() <= 0) return '未记录';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}

function formatCheckTime(value: number | undefined) {
  if (!value) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isSent(value: string) {
  return /已发|发送|sent/i.test(value);
}

function isGmailAuthError(error: unknown) {
  return /UNAUTHENTICATED|invalid authentication|invalid credentials|OAuth|access token|401|authError/i.test(
    error instanceof Error ? error.message : String(error || ''),
  );
}

function mappedSentCount(record: FollowUpRecord) {
  if (record.thirdOutreachDate || isSent(record.thirdOutreach)) return 3;
  if (record.secondOutreachDate || isSent(record.secondOutreach)) return 2;
  return 1;
}

function effectiveSentCount(record: FollowUpRecord) {
  return record.check ? record.check.outbound.length : mappedSentCount(record);
}

function unsyncedGmailStage(record: FollowUpRecord): FollowUpStage | null {
  const mapped = mappedSentCount(record);
  const gmail = record.check?.outbound.length || 0;
  if (gmail >= 3 && mapped < 3) return 3;
  if (gmail >= 2 && mapped < 2) return 2;
  return null;
}

function stageLabel(stage: FollowUpStage) {
  return stage === 2 ? '一次 Follow Up' : '二次 Follow Up';
}

function canGenerateStage(
  record: FollowUpRecord,
  stage: FollowUpStage,
  drafts: Record<string, FollowUpDraft>,
) {
  if (!record.email || record.check?.reply) return false;
  const sentCount = effectiveSentCount(record);
  if (sentCount !== stage - 1) return false;
  const draft = drafts[followUpDraftKey(record.recordId, stage)];
  return !draft || draft.status === 'error';
}

function buildWritePreview(
  record: FollowUpRecord,
  mapping: FeishuFieldMapping,
): WritePreview | null {
  if (!record.check || record.check.outbound.length === 0) return null;
  const fields: Array<{ label: string; value: string }> = [];
  const payload: Record<string, unknown> = {};
  const append = (key: FeishuFieldKey, label: string, value: string | number) => {
    const fieldName = mapping[key];
    if (!fieldName) return;
    payload[fieldName] = value;
    fields.push({ label, value: typeof value === 'number' ? formatDate(value) : value });
  };
  append('firstOutreach', '初次开发信', '已发');
  if (record.check.outbound.length >= 2) {
    append('secondOutreachDate', '一次 Follow Up 日期', new Date(record.check.outbound[1].date).getTime());
    append('secondOutreach', '一次 Follow Up', '已发');
  }
  if (record.check.outbound.length >= 3) {
    append('thirdOutreachDate', '二次 Follow Up 日期', new Date(record.check.outbound[2].date).getTime());
    append('thirdOutreach', '二次 Follow Up', '已发');
  }
  append('hasReply', '是否回复', record.check.reply ? '已回复' : '未回复');
  return fields.length ? { record, fields, payload } : null;
}

function followUpStatus(record: FollowUpRecord) {
  if (record.check?.reply) {
    return { tone: 'success', title: '已回复，停止跟进', detail: `${formatDate(record.check.reply.date)} 收到人工回复` };
  }
  if (record.checkError) return { tone: 'danger', title: '检查失败', detail: record.checkError };
  if (record.check && record.check.outbound.length === 0) {
    return { tone: 'warning', title: '未找到初次开发信', detail: '请到 Gmail 人工核对后再继续' };
  }
  const unsyncedStage = unsyncedGmailStage(record);
  if (unsyncedStage) {
    return {
      tone: 'warning',
      title: `Gmail 检测到${stageLabel(unsyncedStage)}已发送`,
      detail: '请确认后补写飞书状态和实际日期',
    };
  }
  const checkedWithoutReply = Boolean(record.check && !record.check.reply);
  const sentCount = effectiveSentCount(record);
  const elapsed = Math.floor((startOfToday() - record.developmentDate) / DAY_MS);
  if (sentCount >= 3) {
    return checkedWithoutReply
      ? { tone: 'neutral', title: '已检查，暂无人工回复', detail: '二次 Follow Up 已完成，当前没有新的跟进计划' }
      : { tone: 'neutral', title: '二次 Follow Up 完成，等待回复', detail: '当前没有新的跟进计划' };
  }
  if (sentCount === 2) {
    const remaining = 7 - elapsed;
    if (remaining > 0) {
      return checkedWithoutReply
        ? { tone: 'neutral', title: '已检查，暂无人工回复', detail: `下一步：${remaining} 天后进行二次 Follow Up` }
        : { tone: 'neutral', title: `等待二次 Follow Up，还剩 ${remaining} 天`, detail: '第 7 天进行二次 Follow Up' };
    }
    return {
      tone: elapsed === 7 ? 'warning' : 'danger',
      title: checkedWithoutReply ? '已检查，暂无人工回复' : elapsed === 7 ? '今天应二次 Follow Up' : `二次 Follow Up 已逾期 ${elapsed - 7} 天`,
      detail: checkedWithoutReply
        ? (elapsed === 7 ? '今天可生成二次 Follow Up 草稿' : `二次 Follow Up 已逾期 ${elapsed - 7} 天，可生成跟进草稿`)
        : '请先检查回复，再决定是否跟进',
    };
  }
  const remaining = 3 - elapsed;
  if (remaining > 0) {
    return checkedWithoutReply
      ? { tone: 'neutral', title: '已检查，暂无人工回复', detail: `下一步：${remaining} 天后进行一次 Follow Up` }
      : { tone: 'neutral', title: `等待一次 Follow Up，还剩 ${remaining} 天`, detail: '第 3 天进行一次 Follow Up' };
  }
  return {
    tone: elapsed === 3 ? 'warning' : 'danger',
    title: checkedWithoutReply ? '已检查，暂无人工回复' : elapsed === 3 ? '今天应一次 Follow Up' : `一次 Follow Up 已逾期 ${elapsed - 3} 天`,
    detail: checkedWithoutReply
      ? (elapsed === 3 ? '今天可生成一次 Follow Up 草稿' : `一次 Follow Up 已逾期 ${elapsed - 3} 天，可生成跟进草稿`)
      : '请先检查回复，再决定是否跟进',
  };
}

function StageCell({ label, sentAt, sent }: { label: string; sentAt?: number | string; sent: boolean }) {
  return (
    <div className="min-w-[112px] space-y-1">
      <p className="text-xs font-medium text-foreground">{label}</p>
      {sentAt ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />已发 {formatDate(sentAt)}
        </span>
      ) : sent ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />已标记发送
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">未发送</span>
      )}
    </div>
  );
}

function FollowUpDraftPreview({ draft, compact = false }: { draft: FollowUpDraft; compact?: boolean }) {
  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div>
        <p className="text-xs font-medium text-foreground">源语言邮件</p>
        <p className={`${compact ? 'mt-1 max-h-28 overflow-auto text-xs leading-5' : 'mt-2 max-h-52 overflow-auto text-sm leading-6'} whitespace-pre-wrap text-muted-foreground`}>
          {draft.body}
        </p>
      </div>
      <div className="border-t border-border/70 pt-3">
        <p className="text-xs font-medium text-foreground">中文翻译</p>
        <p className={`${compact ? 'mt-1 max-h-28 overflow-auto text-xs leading-5' : 'mt-2 max-h-52 overflow-auto text-sm leading-6'} whitespace-pre-wrap text-muted-foreground`}>
          {draft.translatedBody || 'AI 未返回中文翻译。'}
        </p>
      </div>
      <p className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        已保存至 Gmail 草稿 · 未发送
      </p>
    </div>
  );
}

function StageActionCell({
  label,
  sentAt,
  sent,
  draft,
  canGenerate,
  onGenerate,
  onOpenDraft,
}: {
  label: string;
  sentAt?: number | string;
  sent: boolean;
  draft?: FollowUpDraft;
  canGenerate: boolean;
  onGenerate: () => void;
  onOpenDraft: () => void;
}) {
  const isSentNow = Boolean(sentAt || sent);
  const progressLabel = draft?.status === 'checking'
    ? '读取邮件…'
    : draft?.status === 'generating'
      ? 'AI 起草…'
      : draft?.status === 'saving'
        ? '保存草稿…'
        : '';

  return (
    <div className="min-w-[142px] space-y-1.5">
      <StageCell label={label} sentAt={sentAt} sent={sent} />
      {!isSentNow && draft?.status === 'saved' ? (
        <HoverCard openDelay={200} closeDelay={120}>
          <HoverCardTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenDraft}
              className="h-7 border-emerald-200 bg-emerald-50 px-2 text-xs text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              已生成草稿
            </Button>
          </HoverCardTrigger>
          <HoverCardContent align="start" side="top" className="w-[420px] p-4">
            <p className="mb-3 text-sm font-semibold">{stageLabel(draft.stage)}邮件</p>
            <FollowUpDraftPreview draft={draft} compact />
          </HoverCardContent>
        </HoverCard>
      ) : null}
      {!isSentNow && progressLabel ? (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {progressLabel}
        </Button>
      ) : null}
      {!isSentNow && draft?.status === 'error' && canGenerate ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGenerate}
          className="h-7 border-red-200 px-2 text-xs text-red-700 hover:bg-red-50 hover:text-red-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          生成失败 · 重试
        </Button>
      ) : null}
      {!isSentNow && !draft && canGenerate ? (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onGenerate}>
          <Sparkles className="h-3.5 w-3.5" />
          起草邮件
        </Button>
      ) : null}
    </div>
  );
}

function StatusCell({ record }: { record: FollowUpRecord }) {
  const status = followUpStatus(record);
  const className = status.tone === 'success'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : status.tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : status.tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <div className="min-w-[210px] space-y-1">
    <Badge variant="outline" className={className}>{status.title}</Badge>
    <p className="text-xs leading-5 text-muted-foreground">{status.detail}</p>
    {record.checkedAt && record.check && !record.check.reply ? (
      <p className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />已于 {formatCheckTime(record.checkedAt)} 检查
      </p>
    ) : null}
      {record.check?.automatedReply ? <p className="text-xs text-amber-700">检测到自动回复，不停止跟进</p> : null}
      {record.check?.deliveryFailure ? <p className="text-xs text-red-700">检测到退信，请核对邮箱</p> : null}
    </div>
  );
}

export function OutreachFollowUpTab({ settings, auth, onAuthRefresh }: Props) {
  const mapping = useMemo(
    () => settings.feishuProspectingFieldMapping || {},
    [settings.feishuProspectingFieldMapping],
  );
  const [rangeDays, setRangeDays] = useState<(typeof RANGE_OPTIONS)[number]>(10);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [records, setRecords] = useState<FollowUpRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [checkingIds, setCheckingIds] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FollowUpDraft>>({});
  const [draftCacheReady, setDraftCacheReady] = useState(false);
  const [draftBatchProgress, setDraftBatchProgress] = useState<{
    stage: FollowUpStage;
    completed: number;
    total: number;
  } | null>(null);
  const [resultDraftKey, setResultDraftKey] = useState<string | null>(null);
  const [writePreview, setWritePreview] = useState<WritePreview | null>(null);
  const [writeAllConfirmOpen, setWriteAllConfirmOpen] = useState(false);
  const [writeAllProgress, setWriteAllProgress] = useState<{
    completed: number;
    total: number;
    success: number;
    failed: number;
  } | null>(null);
  const [markSentPreview, setMarkSentPreview] = useState<MarkSentPreview | null>(null);
  const [writingId, setWritingId] = useState<string | null>(null);
  const avatarLookupIdsRef = useRef(new Set<string>());
  const skipDraftCacheSaveRef = useRef(false);
  const resourceMapping = useMemo(
    () => settings.feishuFieldMapping || {},
    [settings.feishuFieldMapping],
  );
  const draftStorageKey = useMemo(
    () => `${FOLLOW_UP_DRAFT_CACHE_KEY}:${auth?.email || 'anonymous'}`,
    [auth?.email],
  );
  const canLoad = Boolean(settings.feishuProspectingUrl && mapping.developmentDate);
  const customStartAt = dateInputTimestamp(customStartDate);
  const customEndAt = dateInputTimestamp(customEndDate, true);
  const hasCustomRange = Boolean(customStartAt && customEndAt);
  const rangeStartAt = hasCustomRange
    ? customStartAt
    : startOfToday() - (rangeDays - 1) * DAY_MS;
  const rangeEndAt = hasCustomRange
    ? customEndAt
    : startOfToday() + DAY_MS - 1;
  const fieldNames = useMemo(() => Array.from(new Set([
    mapping.channelName,
    mapping.avatar,
    mapping.email,
    mapping.channelUrl,
    mapping.channelId,
    mapping.developmentDate,
    mapping.firstOutreach,
    mapping.secondOutreachDate,
    mapping.secondOutreach,
    mapping.thirdOutreachDate,
    mapping.thirdOutreach,
    mapping.hasReply,
    mapping.language,
    mapping.targetProduct,
    mapping.cooperationType,
    mapping.cooperationIdea,
  ].filter(Boolean))) as string[], [mapping]);
  const writeAllTargets = useMemo(
    () => records.flatMap((record) => {
      if (record.synced) return [];
      const preview = buildWritePreview(record, mapping);
      return preview ? [preview] : [];
    }),
    [mapping, records],
  );

  useEffect(() => {
    skipDraftCacheSaveRef.current = true;
    setDraftCacheReady(false);
    setDrafts(loadFollowUpDraftCache(draftStorageKey));
    setDraftCacheReady(true);
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftCacheReady) return;
    if (skipDraftCacheSaveRef.current) {
      skipDraftCacheSaveRef.current = false;
      return;
    }
    const savedDrafts = Object.fromEntries(
      Object.entries(drafts).filter(([, draft]) => draft.status === 'saved'),
    );
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify(savedDrafts));
    } catch {
      // 浏览器空间不足时不影响本次已经保存到 Gmail 的草稿。
    }
  }, [draftCacheReady, draftStorageKey, drafts]);

  const loadRecords = useCallback(async () => {
    if (!settings.feishuProspectingUrl || !mapping.developmentDate) {
      setRecords([]);
      setLoadError('请先在“设置 > 飞书”配置红人开发情况表，并映射“开发日期”字段。');
      return;
    }
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'search',
          url: settings.feishuProspectingUrl,
          pageSize: 500,
          fieldNames,
          filter: {
            conjunction: 'and',
            conditions: [{
              field_name: mapping.developmentDate,
              operator: 'isGreater',
              value: ['ExactDate', String(rangeStartAt - 1)],
            }],
          },
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(String(result.error || '读取飞书开发记录失败。'));
      const next = ((result.data?.items || []) as FeishuRecord[]).map((record) => ({
        recordId: record.record_id,
        channelName: mappedValue(record, mapping, 'channelName') || '未填写红人名称',
        avatarUrl: getFeishuImageUrl(mapping.avatar ? record.fields[mapping.avatar] : undefined),
        email: mappedValue(record, mapping, 'email').toLowerCase(),
        channelUrl: mappedValue(record, mapping, 'channelUrl'),
        channelId: mappedValue(record, mapping, 'channelId'),
        developmentDate: parseFeishuDate(record.fields[mapping.developmentDate || '']),
        firstOutreach: mappedValue(record, mapping, 'firstOutreach'),
        secondOutreachDate: parseFeishuDate(mapping.secondOutreachDate ? record.fields[mapping.secondOutreachDate] : undefined),
        secondOutreach: mappedValue(record, mapping, 'secondOutreach'),
        thirdOutreachDate: parseFeishuDate(mapping.thirdOutreachDate ? record.fields[mapping.thirdOutreachDate] : undefined),
        thirdOutreach: mappedValue(record, mapping, 'thirdOutreach'),
        hasReply: mappedValue(record, mapping, 'hasReply'),
        language: mappedValue(record, mapping, 'language'),
        targetProduct: mappedValue(record, mapping, 'targetProduct'),
        cooperationType: mappedValue(record, mapping, 'cooperationType'),
        cooperationIdea: mappedValue(record, mapping, 'cooperationIdea'),
      })).filter((record) => (
        record.developmentDate >= rangeStartAt
        && record.developmentDate <= rangeEndAt
      ))
        .sort((a, b) => b.developmentDate - a.developmentDate);
      avatarLookupIdsRef.current.clear();
      setRecords(next);
    } catch (error) {
      setRecords([]);
      setLoadError(error instanceof Error ? error.message : '读取飞书开发记录失败。');
    } finally {
      setLoading(false);
    }
  }, [fieldNames, mapping, rangeEndAt, rangeStartAt, settings.feishuProspectingUrl]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    const targets = records.filter((record) => (
      !record.avatarUrl && !avatarLookupIdsRef.current.has(record.recordId)
    ));
    if (!targets.length) return;

    let cancelled = false;
    targets.forEach((record) => avatarLookupIdsRef.current.add(record.recordId));

    const resourceFieldNames = Array.from(new Set([
      resourceMapping.channelName,
      resourceMapping.email,
      resourceMapping.avatar,
      resourceMapping.channelUrl,
      resourceMapping.channelId,
    ].filter(Boolean))) as string[];

    const loadResourceProfiles = async () => {
      const profiles = new Map<string, { avatarUrl: string; channelUrl: string; channelId: string }>();
      if (!settings.feishuUrl || !resourceFieldNames.length) return profiles;
      const remainingEmails = new Set(targets.map((record) => record.email).filter(Boolean));
      const remainingNames = new Set(targets.map((record) => record.channelName).filter(Boolean));
      let pageToken = '';
      for (let page = 0; page < 10 && (remainingEmails.size || remainingNames.size); page += 1) {
        const response = await fetch('/api/feishu/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'search',
            url: settings.feishuUrl,
            pageSize: 500,
            pageToken,
            fieldNames: resourceFieldNames,
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) break;
        const data = result.data as { items?: FeishuRecord[]; has_more?: boolean; page_token?: string };
        for (const item of data.items || []) {
          const email = mappedValue(item, resourceMapping, 'email').toLowerCase();
          const channelName = mappedValue(item, resourceMapping, 'channelName');
          if (!remainingEmails.has(email) && !remainingNames.has(channelName)) continue;
          const profile = {
            avatarUrl: getFeishuImageUrl(resourceMapping.avatar ? item.fields[resourceMapping.avatar] : undefined),
            channelUrl: mappedValue(item, resourceMapping, 'channelUrl'),
            channelId: mappedValue(item, resourceMapping, 'channelId'),
          };
          if (email) profiles.set(`email:${email}`, profile);
          if (channelName) profiles.set(`name:${channelName}`, profile);
          remainingEmails.delete(email);
          remainingNames.delete(channelName);
        }
        if (!data.has_more || !data.page_token) break;
        pageToken = data.page_token;
      }
      return profiles;
    };

    const enrichAvatar = async (
      record: FollowUpRecord,
      resourceProfiles: Map<string, { avatarUrl: string; channelUrl: string; channelId: string }>,
    ) => {
      const resourceProfile = resourceProfiles.get(`email:${record.email}`)
        || resourceProfiles.get(`name:${record.channelName}`)
        || null;
      if (resourceProfile?.avatarUrl) return { recordId: record.recordId, avatarUrl: resourceProfile.avatarUrl };

      const lookup = buildChannelAvatarLookup({
        channelId: resourceProfile?.channelId || record.channelId,
        channelUrl: resourceProfile?.channelUrl || record.channelUrl,
      });
      if (!lookup) return null;
      const resolved = await resolveChannelAvatar(lookup);
      return resolved.status === 'ready' && resolved.avatarUrl
        ? { recordId: record.recordId, avatarUrl: resolved.avatarUrl }
        : null;
    };

    const resolveAll = async () => {
      const resourceProfiles = await loadResourceProfiles().catch(() => new Map());
      if (cancelled) return;
      let nextIndex = 0;
      const resolved = new Map<string, string>();
      const worker = async () => {
        while (nextIndex < targets.length) {
          const target = targets[nextIndex++];
          const result = await enrichAvatar(target, resourceProfiles).catch(() => null);
          if (result) resolved.set(result.recordId, result.avatarUrl);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
      if (cancelled || !resolved.size) return;
      setRecords((current) => current.map((record) => (
        resolved.has(record.recordId) ? { ...record, avatarUrl: resolved.get(record.recordId) || record.avatarUrl } : record
      )));
    };

    void resolveAll();
    return () => { cancelled = true; };
  }, [records, resourceMapping, settings.feishuUrl]);

  const requestCheck = useCallback(async (record: FollowUpRecord, token: string) => {
    if (!record.email) throw new Error('该红人没有可用于 Gmail 检查的邮箱。');
    const query = new URLSearchParams({
      action: 'outreachFollowUp',
      token,
      email: record.email,
      sentAt: String(record.developmentDate),
    });
    const response = await fetch(`/api/gmail?${query}`);
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error([result.error, result.details].filter(Boolean).join(' ') || '检查 Gmail 回复失败。');
    }
    return result.data as FollowUpCheck;
  }, []);

  const refreshGmailAuth = useCallback(async () => {
    const response = await fetch('/api/auth/refresh?force=1', { method: 'POST' });
    const result = await response.json();
    const accessToken = String(result.data?.accessToken || '');
    if (!response.ok || !result.success || !accessToken) {
      throw new Error('Gmail 授权已失效，请到“设置 > Gmail 邮件”重新连接 Gmail。');
    }
    const fresh = result.data as GmailAuth;
    onAuthRefresh(fresh);
    return accessToken;
  }, [onAuthRefresh]);

  const checkRecord = useCallback(async (record: FollowUpRecord, showFeedback = true) => {
    if (!auth?.accessToken) throw new Error('请先在“设置 > Gmail 邮件”连接 Gmail。');
    setCheckingIds((current) => Array.from(new Set([...current, record.recordId])));
    try {
      let check: FollowUpCheck;
      try {
        check = await requestCheck(record, auth.accessToken);
      } catch (error) {
        if (!isGmailAuthError(error)) throw error;
        check = await requestCheck(record, await refreshGmailAuth());
      }
      setRecords((current) => current.map((item) => (
        item.recordId === record.recordId
          ? { ...item, check, checkedAt: Date.now(), checkError: undefined, synced: false }
          : item
      )));
      if (showFeedback) {
        toast.success(check.reply
          ? `已检查 ${record.channelName}：收到人工回复，后续跟进已停止。`
          : `已检查 ${record.channelName}：暂未发现人工回复，已保留当前跟进计划。`);
      }
      return check;
    } catch (error) {
      const checkError = error instanceof Error ? error.message : '检查 Gmail 回复失败。';
      setRecords((current) => current.map((item) => (
        item.recordId === record.recordId ? { ...item, checkError } : item
      )));
      throw error;
    } finally {
      setCheckingIds((current) => current.filter((id) => id !== record.recordId));
    }
  }, [auth?.accessToken, refreshGmailAuth, requestCheck]);

  const handleCheckAll = async () => {
    if (!auth?.accessToken) {
      toast.error('请先在“设置 > Gmail 邮件”连接 Gmail。');
      return;
    }
    const targets = records.filter((record) => Boolean(record.email));
    if (!targets.length) {
      toast.error('当前筛选范围内没有可检查邮箱的红人。');
      return;
    }
    setBatchProgress({ completed: 0, total: targets.length });
    let nextIndex = 0;
    let replied = 0;
    let failed = 0;
    const worker = async () => {
      while (nextIndex < targets.length) {
        const record = targets[nextIndex++];
        try {
          if ((await checkRecord(record, false)).reply) replied += 1;
        } catch {
          failed += 1;
        } finally {
          setBatchProgress((current) => current
            ? { ...current, completed: current.completed + 1 }
            : null);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, worker));
    setBatchProgress(null);
    toast.success(`检查完成：已回复 ${replied} 位，待处理 ${targets.length - replied - failed} 位，失败 ${failed} 位。`);
  };

  const updateDraft = useCallback((
    recordId: string,
    stage: FollowUpStage,
    patch: Partial<FollowUpDraft>,
  ) => {
    const key = followUpDraftKey(recordId, stage);
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], stage, ...patch } as FollowUpDraft,
    }));
  }, []);

  const clearDraft = useCallback((recordId: string, stage: FollowUpStage) => {
    const key = followUpDraftKey(recordId, stage);
    setDrafts((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([itemKey]) => itemKey !== key)),
    }));
  }, []);

  const createGmailDraft = async (
    record: FollowUpRecord,
    draft: FollowUpDraft,
    check: FollowUpCheck,
    accessToken: string,
  ) => {
    const initialEmail = check.outbound[0];
    const latestOutbound = check.outbound.at(-1);
    if (!draft?.body.trim() || !initialEmail || !latestOutbound?.threadId) {
      throw new Error('跟进草稿或原 Gmail 邮件线程不完整，请重新检查回复。');
    }
    const references = [latestOutbound.references, latestOutbound.rfcMessageId]
      .filter(Boolean)
      .join(' ');
    const subject = /^re:/i.test(initialEmail.subject) ? initialEmail.subject : `Re: ${initialEmail.subject}`;
    const cleanBody = stripConfiguredEmailSignature(draft.body, settings.emailSignature);
    const bodyHtml = appendEmailSignature(textToEmailHtml(cleanBody), settings.emailSignature);
    const response = await fetch('/api/gmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'draft',
        accessToken,
        to: record.email,
        subject,
        body: applyPlainTextEmailSignature(cleanBody, settings.emailSignature),
        bodyHtml,
        threadId: latestOutbound.threadId,
        inReplyTo: latestOutbound.rfcMessageId,
        references,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      const error = new Error([result.error, result.details].filter(Boolean).join(' ') || '保存 Gmail 草稿失败。');
      throw error;
    }
    return result;
  };

  const generateAndSaveFollowUp = async (
    record: FollowUpRecord,
    stage: FollowUpStage,
    options: { showResult?: boolean; showFeedback?: boolean } = {},
  ): Promise<'success' | 'skipped' | 'failed'> => {
    const { showResult = true, showFeedback = true } = options;
    const key = followUpDraftKey(record.recordId, stage);
    if (!auth?.accessToken) {
      const message = '请先在“设置 > Gmail 邮件”连接 Gmail。';
      updateDraft(record.recordId, stage, {
        status: 'error',
        body: '',
        translatedBody: '',
        language: record.language,
        error: message,
      });
      if (showFeedback) toast.error(message);
      return 'failed';
    }

    setDrafts((current) => ({
      ...current,
      [key]: {
        stage,
        status: 'checking',
        body: '',
        translatedBody: '',
        language: record.language,
      },
    }));

    try {
      const check = await checkRecord(record, false);
      if (check.reply) {
        clearDraft(record.recordId, stage);
        if (showFeedback) toast.info(`${record.channelName} 已有人工回复，已停止 Follow Up。`);
        return 'skipped';
      }
      if (!check.outbound[0]) {
        throw new Error('Gmail 中没有找到初次开发信，无法起草 Follow Up。');
      }
      if (check.outbound.length >= stage) {
        clearDraft(record.recordId, stage);
        if (showFeedback) toast.info(`${stageLabel(stage)}已实际发送，无需重复起草。`);
        return 'skipped';
      }
      if (check.outbound.length < stage - 1) {
        clearDraft(record.recordId, stage);
        if (showFeedback) {
          toast.warning(stage === 3
            ? '只有 Gmail 确认一次 Follow Up 已发送后，才能起草二次 Follow Up。'
            : 'Gmail 中没有找到初次开发信。');
        }
        return 'skipped';
      }

      updateDraft(record.recordId, stage, { status: 'generating', error: undefined });
      const aiResponse = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'followUpOutreach',
          stage,
          channelName: record.channelName,
          preferredLanguage: record.language,
          targetProduct: record.targetProduct,
          cooperationType: record.cooperationType,
          cooperationIdea: record.cooperationIdea,
          initialEmail: check.outbound[0],
          previousFollowUp: stage === 3 ? check.outbound[1] : undefined,
          followUpPrompt: stage === 2
            ? settings.aiOutreachFollowUp1Prompt
            : settings.aiOutreachFollowUp2Prompt,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const aiResult = await aiResponse.json();
      if (!aiResponse.ok || !aiResult.success) {
        throw new Error(String(aiResult.error || '生成跟进邮件失败。'));
      }
      const generatedDraft: FollowUpDraft = {
        stage,
        status: 'saving',
        body: stripConfiguredEmailSignature(
          String(aiResult.data?.body || '').trim(),
          settings.emailSignature,
        ),
        translatedBody: String(aiResult.data?.translatedBody || '').trim(),
        language: String(aiResult.data?.language || record.language || '').trim(),
      };
      if (!generatedDraft.body) throw new Error('AI 没有返回可用的跟进邮件正文。');
      setDrafts((current) => ({ ...current, [key]: generatedDraft }));

      let gmailResult;
      try {
        gmailResult = await createGmailDraft(record, generatedDraft, check, auth.accessToken);
      } catch (error) {
        if (!isGmailAuthError(error)) throw error;
        gmailResult = await createGmailDraft(
          record,
          generatedDraft,
          check,
          await refreshGmailAuth(),
        );
      }
      const savedDraft: FollowUpDraft = {
        ...generatedDraft,
        status: 'saved',
        gmailDraftId: String(gmailResult.data?.id || gmailResult.data?.message?.id || ''),
        generatedAt: Date.now(),
      };
      setDrafts((current) => ({ ...current, [key]: savedDraft }));
      if (showResult) setResultDraftKey(key);
      if (showFeedback) {
        toast.success(`${stageLabel(stage)}已生成并保存到 Gmail 草稿，邮件尚未发送。`);
      }
      return 'success';
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成或保存 Gmail 草稿失败。';
      updateDraft(record.recordId, stage, {
        status: 'error',
        error: message,
      });
      if (showFeedback) toast.error(message);
      return 'failed';
    }
  };

  const handleGenerateAll = async (stage: FollowUpStage) => {
    if (draftBatchProgress) return;
    if (!auth?.accessToken) {
      toast.error('请先在“设置 > Gmail 邮件”连接 Gmail。');
      return;
    }
    const targets = records.filter((record) => canGenerateStage(record, stage, drafts));
    if (!targets.length) {
      toast.info(`当前筛选范围内没有可生成的${stageLabel(stage)}。`);
      return;
    }

    setDraftBatchProgress({ stage, completed: 0, total: targets.length });
    let nextIndex = 0;
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const worker = async () => {
      while (nextIndex < targets.length) {
        const record = targets[nextIndex];
        nextIndex += 1;
        const outcome = await generateAndSaveFollowUp(record, stage, {
          showResult: false,
          showFeedback: false,
        });
        if (outcome === 'success') successCount += 1;
        else if (outcome === 'skipped') skippedCount += 1;
        else failedCount += 1;
        setDraftBatchProgress((current) => current
          ? { ...current, completed: current.completed + 1 }
          : null);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, targets.length) }, worker));
    setDraftBatchProgress(null);
    const summary = `成功 ${successCount}，跳过 ${skippedCount}，失败 ${failedCount}`;
    if (failedCount) toast.warning(`${stageLabel(stage)}批量起草完成：${summary}。`);
    else toast.success(`${stageLabel(stage)}批量起草完成：${summary}。`);
  };

  const openWritePreview = (record: FollowUpRecord) => {
    if (!record.check || record.check.outbound.length === 0) {
      toast.error('请先成功检查 Gmail，并确认已找到初次开发信。');
      return;
    }
    const preview = buildWritePreview(record, mapping);
    if (!preview) {
      toast.error('当前飞书字段映射中没有可写回的跟进字段。');
      return;
    }
    setWritePreview(preview);
  };

  const confirmWrite = async () => {
    if (!writePreview || !settings.feishuProspectingUrl) return;
    setWritingId(writePreview.record.recordId);
    try {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          url: settings.feishuProspectingUrl,
          recordId: writePreview.record.recordId,
          fields: writePreview.payload,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(String(result.error || '写回飞书失败。'));
      setRecords((current) => current.map((record) => (
        record.recordId === writePreview.record.recordId ? { ...record, synced: true } : record
      )));
      setWritePreview(null);
      toast.success('已写回当前红人的飞书开发记录。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '写回飞书失败。');
    } finally {
      setWritingId(null);
    }
  };

  const confirmWriteAll = async () => {
    if (!settings.feishuProspectingUrl || !writeAllTargets.length || writeAllProgress) return;
    setWriteAllProgress({
      completed: 0,
      total: writeAllTargets.length,
      success: 0,
      failed: 0,
    });
    let nextIndex = 0;
    let successCount = 0;
    let failedCount = 0;
    const successfulIds = new Set<string>();
    const worker = async () => {
      while (nextIndex < writeAllTargets.length) {
        const preview = writeAllTargets[nextIndex];
        nextIndex += 1;
        let success = false;
        try {
          const response = await fetch('/api/feishu/records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update',
              url: settings.feishuProspectingUrl,
              recordId: preview.record.recordId,
              fields: preview.payload,
            }),
          });
          const result = await response.json();
          if (!response.ok || !result.success) throw new Error(String(result.error || '写回飞书失败。'));
          successfulIds.add(preview.record.recordId);
          successCount += 1;
          success = true;
        } catch {
          // 单条失败不会中断整批，完成后统一汇总。
          failedCount += 1;
        } finally {
          setWriteAllProgress((current) => current ? {
            ...current,
            completed: current.completed + 1,
            success: current.success + (success ? 1 : 0),
            failed: current.failed + (success ? 0 : 1),
          } : null);
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(2, writeAllTargets.length) },
      worker,
    ));
    setRecords((current) => current.map((record) => (
      successfulIds.has(record.recordId) ? { ...record, synced: true } : record
    )));
    setWriteAllProgress(null);
    const summary = `成功 ${successCount}，失败 ${failedCount}`;
    if (failedCount) toast.warning(`批量写回完成：${summary}。失败记录可在列表中重试。`);
    else toast.success(`批量写回完成：${summary}。`);
    setWriteAllConfirmOpen(false);
  };

  const openMarkSent = (record: FollowUpRecord, stage: FollowUpStage) => {
    const gmailMessage = record.check?.outbound[stage - 1];
    setMarkSentPreview({
      record,
      stage,
      sentAt: gmailMessage?.date ? new Date(gmailMessage.date).getTime() : Date.now(),
    });
  };

  const confirmMarkSent = async () => {
    if (!markSentPreview || !settings.feishuProspectingUrl) return;
    const { record, stage, sentAt } = markSentPreview;
    const statusKey: FeishuFieldKey = stage === 2 ? 'secondOutreach' : 'thirdOutreach';
    const dateKey: FeishuFieldKey = stage === 2 ? 'secondOutreachDate' : 'thirdOutreachDate';
    const statusField = mapping[statusKey];
    const dateField = mapping[dateKey];
    if (!statusField || !dateField) {
      toast.error(`请先在飞书字段映射中配置“${stageLabel(stage)}开发信”和“${stageLabel(stage)}日期”。`);
      return;
    }
    setWritingId(record.recordId);
    try {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          url: settings.feishuProspectingUrl,
          recordId: record.recordId,
          fields: {
            [statusField]: '已发',
            [dateField]: sentAt,
          },
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(String(result.error || '写回飞书失败。'));
      setRecords((current) => current.map((item) => item.recordId === record.recordId
        ? {
            ...item,
            ...(stage === 2
              ? { secondOutreach: '已发', secondOutreachDate: sentAt }
              : { thirdOutreach: '已发', thirdOutreachDate: sentAt }),
          }
        : item));
      setMarkSentPreview(null);
      toast.success(`${stageLabel(stage)}已标记发送，并已写入飞书实际日期。`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '写回飞书失败。');
    } finally {
      setWritingId(null);
    }
  };

  const firstFollowUpEligibleCount = records.filter(
    (record) => canGenerateStage(record, 2, drafts),
  ).length;
  const secondFollowUpEligibleCount = records.filter(
    (record) => canGenerateStage(record, 3, drafts),
  ).length;
  const resultDraft = resultDraftKey ? drafts[resultDraftKey] : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
      <section className="rounded-lg border border-border/70 bg-slate-50/60 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold">开发信跟进</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            第 3 天进行一次 Follow Up，第 7 天进行二次 Follow Up；红人回复后的正常往来不计入 Follow Up。
          </p>
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
          <div
            className={`flex items-center gap-1 rounded-md border bg-background p-0.5 ${
              hasCustomRange ? 'border-primary/50 ring-1 ring-primary/15' : 'border-border'
            }`}
            role="group"
            aria-label="自定义开发日期范围"
          >
            <CalendarDays className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <Input
              type="date"
              value={customStartDate}
              max={customEndDate || undefined}
              onChange={(event) => {
                const nextStart = event.target.value;
                if (!nextStart) {
                  setCustomStartDate('');
                  setCustomEndDate('');
                  return;
                }
                setCustomStartDate(nextStart);
                if (!customEndDate || nextStart > customEndDate) setCustomEndDate(nextStart);
              }}
              className="h-8 w-[8.5rem] border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
              aria-label="开发日期开始"
              title="开发日期开始"
            />
            <span className="text-xs text-muted-foreground">至</span>
            <Input
              type="date"
              value={customEndDate}
              min={customStartDate || undefined}
              onChange={(event) => {
                const nextEnd = event.target.value;
                if (!nextEnd) {
                  setCustomStartDate('');
                  setCustomEndDate('');
                  return;
                }
                setCustomEndDate(nextEnd);
                if (!customStartDate || nextEnd < customStartDate) setCustomStartDate(nextEnd);
              }}
              className="h-8 w-[8.5rem] border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
              aria-label="开发日期结束"
              title="开发日期结束"
            />
          </div>
          <div className="flex rounded-md border border-border bg-background p-0.5" role="group" aria-label="开发日期范围">
            {RANGE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => {
                  setCustomStartDate('');
                  setCustomEndDate('');
                  setRangeDays(days);
                }}
                className={`min-h-8 rounded px-2.5 text-xs font-medium transition-colors ${
                  !hasCustomRange && rangeDays === days
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                最近 {days} 天
              </button>
            ))}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadRecords()} disabled={loading || Boolean(draftBatchProgress)}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              刷新列表
            </Button>
            <Button size="sm" onClick={() => void handleCheckAll()} disabled={loading || Boolean(batchProgress) || Boolean(draftBatchProgress) || !records.length}>
              {batchProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
              {batchProgress ? `正在检查 ${batchProgress.completed} / ${batchProgress.total}` : '检查全部'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setWriteAllConfirmOpen(true)}
              disabled={
                loading
                || Boolean(batchProgress)
                || Boolean(draftBatchProgress)
                || Boolean(writeAllProgress)
                || writeAllTargets.length === 0
              }
            >
              {writeAllProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {writeAllProgress
                ? `正在写回 ${writeAllProgress.completed}/${writeAllProgress.total}`
                : '写回全部'}
            </Button>
          </div>
        </div>
      </section>

      {!canLoad ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          请先在“设置 &gt; 飞书”配置红人开发情况表，并映射“开发日期”。
        </div>
      ) : null}
      {loadError && canLoad ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{loadError}</p>
            <Button variant="link" className="h-auto px-0 text-red-800" onClick={() => void loadRecords()}>重新读取</Button>
          </div>
        </div>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-background">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1280px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-muted-foreground">
              <tr className="border-b border-border/70">
                <th className="px-4 py-3 font-medium">红人</th>
                <th className="px-4 py-3 font-medium">初次开发信</th>
                <th className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    <span>一次 Follow Up</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs font-medium"
                      onClick={() => void handleGenerateAll(2)}
                      disabled={
                        loading
                        || Boolean(batchProgress)
                        || Boolean(draftBatchProgress)
                        || firstFollowUpEligibleCount === 0
                      }
                    >
                      {draftBatchProgress?.stage === 2 ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {draftBatchProgress?.stage === 2
                        ? `${draftBatchProgress.completed}/${draftBatchProgress.total}`
                        : `一键生成 (${firstFollowUpEligibleCount})`}
                    </Button>
                  </div>
                </th>
                <th className="px-4 py-3 font-medium">
                  <div className="flex items-center gap-2">
                    <span>二次 Follow Up</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs font-medium"
                      onClick={() => void handleGenerateAll(3)}
                      disabled={
                        loading
                        || Boolean(batchProgress)
                        || Boolean(draftBatchProgress)
                        || secondFollowUpEligibleCount === 0
                      }
                    >
                      {draftBatchProgress?.stage === 3 ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {draftBatchProgress?.stage === 3
                        ? `${draftBatchProgress.completed}/${draftBatchProgress.total}`
                        : `一键生成 (${secondFollowUpEligibleCount})`}
                    </Button>
                  </div>
                </th>
                <th className="px-4 py-3 font-medium">回复情况</th>
                <th className="px-4 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />正在读取飞书开发记录…</td></tr>
              ) : null}
              {!loading && !loadError && canLoad && records.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">当前筛选时间范围内没有开发记录。</td></tr>
              ) : null}
              {!loading ? records.map((record) => {
                const checking = checkingIds.includes(record.recordId);
                const unsyncedStage = unsyncedGmailStage(record);
                const sentCount = effectiveSentCount(record);
                const firstDraftKey = followUpDraftKey(record.recordId, 2);
                const secondDraftKey = followUpDraftKey(record.recordId, 3);
                const firstDraft = !record.check?.reply && sentCount === 1
                  ? drafts[firstDraftKey]
                  : undefined;
                const secondDraft = !record.check?.reply && sentCount === 2
                  ? drafts[secondDraftKey]
                  : undefined;
                const firstSentAt = record.check
                  ? record.check.outbound[1]?.date
                  : record.secondOutreachDate;
                const secondSentAt = record.check
                  ? record.check.outbound[2]?.date
                  : record.thirdOutreachDate;
                return (
                  <tr key={record.recordId} className="align-top hover:bg-slate-50/60">
                    <td className="px-4 py-4">
                      <div className="flex min-w-[220px] items-start gap-3">
                        <Avatar className="h-10 w-10 shrink-0 rounded-md">
                          <AvatarImage src={record.avatarUrl} alt={`${record.channelName} 频道头像`} />
                          <AvatarFallback className="rounded-md bg-sky-100 text-xs font-medium text-sky-800">{channelInitials(record.channelName)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{record.channelName}</p>
                          <p className="mt-1 max-w-[210px] truncate text-xs text-muted-foreground">{record.email || '未填写邮箱'}</p>
                          <p className="mt-1 text-xs text-muted-foreground">初次发送：{formatDate(record.developmentDate)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <StageCell label="初次开发信" sentAt={record.check?.outbound[0]?.date || record.developmentDate} sent />
                    </td>
                    <td className="px-4 py-4">
                      <StageActionCell
                        label="第 3 天"
                        sentAt={firstSentAt}
                        sent={record.check ? Boolean(record.check.outbound[1]) : isSent(record.secondOutreach)}
                        draft={firstDraft}
                        canGenerate={canGenerateStage(record, 2, drafts)}
                        onGenerate={() => void generateAndSaveFollowUp(record, 2)}
                        onOpenDraft={() => setResultDraftKey(firstDraftKey)}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <StageActionCell
                        label="第 7 天"
                        sentAt={secondSentAt}
                        sent={record.check ? Boolean(record.check.outbound[2]) : isSent(record.thirdOutreach)}
                        draft={secondDraft}
                        canGenerate={canGenerateStage(record, 3, drafts)}
                        onGenerate={() => void generateAndSaveFollowUp(record, 3)}
                        onOpenDraft={() => setResultDraftKey(secondDraftKey)}
                      />
                    </td>
                    <td className="px-4 py-4"><StatusCell record={record} /></td>
                    <td className="px-4 py-4">
                      <div className="flex min-w-[176px] flex-col items-start gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void checkRecord(record).catch((error) => toast.error(error instanceof Error ? error.message : '检查 Gmail 回复失败。'))}
                          disabled={checking || !record.email}
                        >
                          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <MailCheck className="h-4 w-4" />}
                          {record.check ? '重新检查回复' : '检查回复'}
                        </Button>

                        {unsyncedStage ? (
                          <Button size="sm" onClick={() => openMarkSent(record, unsyncedStage)}>
                            <CheckCircle2 className="h-4 w-4" />同步{stageLabel(unsyncedStage)}已发送
                          </Button>
                        ) : null}

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openWritePreview(record)}
                          disabled={record.synced || !record.check || record.check.outbound.length === 0 || checking}
                        >
                          <Send className="h-4 w-4" />{record.synced ? '已写回飞书' : '写回检查结果'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              }) : null}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={Boolean(resultDraftKey && resultDraft?.status === 'saved')}
        onOpenChange={(open) => !open && setResultDraftKey(null)}
      >
        <DialogContent className="flex max-h-[82vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <DialogTitle>{resultDraft ? `${stageLabel(resultDraft.stage)}已生成` : 'Follow Up 已生成'}</DialogTitle>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                已保存至 Gmail 草稿
              </Badge>
            </div>
            <DialogDescription>
              邮件已保存到原开发信线程，尚未发送。
            </DialogDescription>
          </DialogHeader>
          {resultDraft ? (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border/70 bg-slate-50/60 p-4">
              <FollowUpDraftPreview draft={resultDraft} />
            </div>
          ) : null}
          <DialogFooter className="items-center sm:justify-between">
            <p className="text-left text-xs text-muted-foreground">
              关闭后，将鼠标移到该行的“已生成草稿”上即可再次查看。
            </p>
            <Button type="button" onClick={() => setResultDraftKey(null)}>完成</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={writeAllConfirmOpen}
        onOpenChange={(open) => !writeAllProgress && setWriteAllConfirmOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认写回全部检查结果</AlertDialogTitle>
            <AlertDialogDescription>
              将把当前日期范围内已完成 Gmail 检查的 {writeAllTargets.length} 条结果同步到“红人开发情况表”。
              未检查、检查失败或没有找到初次开发信的记录不会写入。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-border bg-slate-50 p-3 text-sm">
            {writeAllProgress ? (
              <div className="space-y-2">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">写回进度</span>
                  <span className="font-medium">{writeAllProgress.completed} / {writeAllProgress.total}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">当前结果</span>
                  <span className="font-medium text-emerald-700">
                    成功 {writeAllProgress.success}，失败 {writeAllProgress.failed}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">待写回记录</span>
                  <span className="font-medium">{writeAllTargets.length} 条</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">写回内容</span>
                  <span className="text-right font-medium">开发信状态、Follow Up 状态与日期、是否回复</span>
                </div>
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(writeAllProgress)}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void confirmWriteAll();
              }}
              disabled={Boolean(writeAllProgress) || writeAllTargets.length === 0}
            >
              {writeAllProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {writeAllProgress ? '正在写回' : `确认写回 ${writeAllTargets.length} 条`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(writePreview)} onOpenChange={(open) => !open && !writingId && setWritePreview(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认写回飞书开发记录</AlertDialogTitle>
            <AlertDialogDescription>
              将把 Gmail 检查结果写入 {writePreview?.record.channelName || '当前红人'} 的开发记录。此操作不会发送邮件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 rounded-md border border-border bg-slate-50 p-3 text-sm">
            {writePreview?.fields.map((field) => (
              <div key={field.label} className="flex justify-between gap-4"><span className="text-muted-foreground">{field.label}</span><span className="font-medium">{field.value}</span></div>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(writingId)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmWrite(); }} disabled={Boolean(writingId)}>
              {writingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}确认写回
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(markSentPreview)} onOpenChange={(open) => !open && !writingId && setMarkSentPreview(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认{markSentPreview ? stageLabel(markSentPreview.stage) : ''}已实际发送</AlertDialogTitle>
            <AlertDialogDescription>
              请确认你已经在 Gmail 中真实发送邮件。系统只会更新飞书记录，不会代你发送邮件。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 rounded-md border border-border bg-slate-50 p-3 text-sm">
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">红人</span><span className="font-medium">{markSentPreview?.record.channelName}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">邮箱</span><span className="font-medium">{markSentPreview?.record.email}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">飞书状态</span><span className="font-medium">已发</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">实际发送日期</span><span className="font-medium">{formatDate(markSentPreview?.sentAt)}</span></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(writingId)}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmMarkSent(); }} disabled={Boolean(writingId)}>
              {writingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}确认并写回飞书
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
