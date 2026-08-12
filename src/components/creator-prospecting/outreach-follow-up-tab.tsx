'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  Languages,
  Loader2,
  MailCheck,
  PencilLine,
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  useFollowUpDrafts,
  type FollowUpDraftTask,
} from '@/components/follow-up-draft-provider';
import type { AppSettings } from '@/lib/data';
import { chunkFeishuItems, type FeishuBatchResult } from '@/lib/feishu-batch';
import { extractMappedFeishuChannelUrl } from '@/lib/feishu-field-value';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';
import { fetchFeishuRecordsCached } from '@/lib/feishu-record-cache';
import { buildFollowUpWriteChanges } from '@/lib/outreach-follow-up-sync';
import {
  canSaveFollowUpDraft,
  evaluateFollowUpEligibility,
  followUpTaskKey,
  isFollowUpSent,
  mappedFollowUpSentCount,
  type FollowUpCheck,
  type FollowUpSourceRecord,
  type FollowUpStage,
} from '@/lib/follow-up-draft-workflow';
import type { GmailAuth } from '@/lib/types';
import {
  buildChannelAvatarLookup,
  channelAvatarLookupPriority,
  resolveChannelAvatars,
} from '@/lib/youtube-channel-avatar';

type FeishuRecord = { record_id: string; fields: Record<string, unknown> };
type ResourceAvatarProfile = {
  avatarUrl: string;
  channelName: string;
  channelUrl: string;
  channelId: string;
};
type FollowUpRecord = FollowUpSourceRecord & {
  channelName: string;
  avatarUrl: string;
  channelUrl: string;
  channelId: string;
  hasReply: string;
  check?: FollowUpCheck;
  checkedAt?: number;
  checkError?: string;
  synced?: boolean;
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

function dateInputTimestamp(value: string, endOfDay = false) {
  if (!value) return 0;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date.getTime();
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

function stringifyFeishuValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(stringifyFeishuValue).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map(stringifyFeishuValue)
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function extractEmailAddresses(value: unknown) {
  const matches = stringifyFeishuValue(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase())));
}

function avatarProfilePriority(profile: ResourceAvatarProfile) {
  return profile.avatarUrl ? 4 : channelAvatarLookupPriority(profile);
}

function keepBestAvatarProfile(
  profiles: Map<string, ResourceAvatarProfile>,
  key: string,
  candidate: ResourceAvatarProfile,
) {
  if (!key) return;
  const current = profiles.get(key);
  if (!current || avatarProfilePriority(candidate) > avatarProfilePriority(current)) {
    profiles.set(key, candidate);
  }
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
  return isFollowUpSent(value);
}

function isGmailAuthError(error: unknown) {
  return /UNAUTHENTICATED|invalid authentication|invalid credentials|OAuth|access token|401|authError/i.test(
    error instanceof Error ? error.message : String(error || ''),
  );
}

function mappedSentCount(record: FollowUpRecord) {
  return mappedFollowUpSentCount(record);
}

function effectiveSentCount(record: FollowUpRecord) {
  return Math.max(mappedSentCount(record), record.check?.outbound.length || 0);
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
  tasks: Record<string, FollowUpDraftTask>,
) {
  const task = tasks[followUpTaskKey(record.recordId, stage)];
  if (task && task.status !== 'error') return false;
  const previousTask = tasks[followUpTaskKey(record.recordId, 2)];
  return evaluateFollowUpEligibility({
    record,
    stage,
    check: record.check,
    previousBody: previousTask?.body,
    previousStageSaved: previousTask?.status === 'saved' || previousTask?.status === 'feishu_error',
  }).allowed;
}

function buildWritePreview(
  record: FollowUpRecord,
  mapping: FeishuFieldMapping,
): WritePreview | null {
  const changes = buildFollowUpWriteChanges(record, mapping);
  return changes ? { record, ...changes } : null;
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

function FollowUpReviewEditor({
  task,
  onChineseChange,
  onTranslate,
  onSave,
  onRegenerate,
}: {
  task: FollowUpDraftTask;
  onChineseChange: (value: string) => void;
  onTranslate: () => void;
  onSave: () => void;
  onRegenerate: () => void;
}) {
  const translating = task.status === 'translating';
  const saving = task.status === 'saving';
  const saved = task.status === 'saved';
  const feishuError = task.status === 'feishu_error';
  const canSave = canSaveFollowUpDraft({
    status: task.status,
    body: task.body,
    chineseBody: task.chineseBody,
    chineseDirty: task.chineseDirty,
    gmailDraftId: task.gmailDraftId,
  });

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <Field>
        <FieldLabel>目标语言邮件正文</FieldLabel>
        <FieldDescription>这是最终准备写入 Gmail 草稿的正文；修改中文并确认翻译后会自动更新。</FieldDescription>
        <ScrollArea className="h-52 rounded-lg border bg-muted/30 p-4">
          <p className="whitespace-pre-wrap text-sm leading-6">{task.body || '尚未生成外文正文。'}</p>
        </ScrollArea>
      </Field>

      <Separator />

      <Field data-invalid={Boolean(task.error) || undefined}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <FieldLabel htmlFor={`follow-up-chinese-${task.key}`}>中文审核稿</FieldLabel>
            <FieldDescription>直接修改中文；完成后点击“根据中文更新外文”。</FieldDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!task.chineseDirty || translating || saving || saved || feishuError || !task.chineseBody.trim()}
            onClick={onTranslate}
          >
            {translating ? <Spinner /> : <Languages data-icon="inline-start" />}
            {translating ? '正在翻译' : '根据中文更新外文'}
          </Button>
        </div>
        <Textarea
          id={`follow-up-chinese-${task.key}`}
          value={task.chineseBody}
          readOnly={saving || saved || feishuError}
          aria-invalid={Boolean(task.error) || undefined}
          className="min-h-48 resize-y bg-background leading-6"
          onChange={(event) => onChineseChange(event.target.value)}
        />
        {task.chineseDirty ? (
          <FieldDescription className="text-amber-700">中文已修改；更新外文成功前不能保存 Gmail 草稿。</FieldDescription>
        ) : null}
        <FieldError>{task.error}</FieldError>
      </Field>

      {task.warning ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>检查提醒</AlertTitle>
          <AlertDescription>{task.warning}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">
          保存成功后会自动把飞书中的对应 Follow Up 标记为“已发”并写入今天日期；Gmail 邮件仍不会自动发送。
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          {!saved && !feishuError ? (
            <Button type="button" variant="outline" disabled={translating || saving} onClick={onRegenerate}>
              <RefreshCw data-icon="inline-start" />重新生成
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={feishuError ? saving : !canSave || translating || saving}
            onClick={onSave}
          >
            {saving ? <Spinner /> : feishuError ? <RefreshCw data-icon="inline-start" /> : <Send data-icon="inline-start" />}
            {saving
              ? '正在保存'
              : feishuError
                ? '重试写回飞书'
                : saved
                  ? '已保存并写回飞书'
                  : '保存到 Gmail 草稿'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function StageActionCell({
  label,
  sentAt,
  sent,
  task,
  canGenerate,
  onGenerate,
  onOpenTask,
}: {
  label: string;
  sentAt?: number | string;
  sent: boolean;
  task?: FollowUpDraftTask;
  canGenerate: boolean;
  onGenerate: () => void;
  onOpenTask: () => void;
}) {
  const isSentNow = Boolean(sentAt || sent);
  const retryBlockedByMailbox = task?.status === 'error' && [
    'human_reply',
    'delivery_failure',
    'missing_initial_email',
    'already_sent_in_gmail',
    'stage_already_complete',
  ].includes(task.errorCode || '');
  const progressLabel = task?.status === 'checking'
    ? '正在检查…'
    : task?.status === 'generating'
      ? 'AI 正在生成…'
      : task?.status === 'translating'
        ? '正在翻译…'
        : task?.status === 'saving'
        ? '正在保存草稿…'
        : '';

  return (
    <div className="flex min-w-[152px] flex-col gap-1.5">
      <StageCell label={label} sentAt={sentAt} sent={sent} />
      {task && (task.status === 'generated' || task.status === 'ready') ? (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onOpenTask}>
          <PencilLine data-icon="inline-start" />查看待确认
        </Button>
      ) : null}
      {task?.status === 'saved' ? (
        <Badge variant="secondary">草稿已保存 · 飞书已标记</Badge>
      ) : null}
      {task?.status === 'feishu_error' ? (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onOpenTask}>
          <AlertTriangle data-icon="inline-start" />飞书写回失败 · 重试
        </Button>
      ) : null}
      {!isSentNow && progressLabel ? (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled>
          <Loader2 data-icon="inline-start" className="animate-spin" />
          {progressLabel}
        </Button>
      ) : null}
      {!isSentNow && task?.status === 'error' && canGenerate && !retryBlockedByMailbox ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGenerate}
          className="h-7 px-2 text-xs"
        >
          <RefreshCw data-icon="inline-start" />
          生成失败 · 重试
        </Button>
      ) : null}
      {!isSentNow && task?.status === 'error' && (!canGenerate || retryBlockedByMailbox) ? (
        <p className={`max-w-44 text-xs ${task.errorCode === 'human_reply' ? 'text-amber-700' : 'text-destructive'}`}>
          {task.error}
        </p>
      ) : null}
      {!isSentNow && !task && canGenerate ? (
        <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onGenerate}>
          <Sparkles data-icon="inline-start" />
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
  const {
    tasks,
    batchProgress: draftBatchProgress,
    generateTask,
    generateMany,
    updateChinese,
    translateTask,
    saveTask,
    clearTask,
  } = useFollowUpDrafts();
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
  const [resultDraftKey, setResultDraftKey] = useState<string | null>(null);
  const [batchReviewStage, setBatchReviewStage] = useState<FollowUpStage | null>(null);
  const [batchReviewKey, setBatchReviewKey] = useState<string | null>(null);
  const [regenerateKey, setRegenerateKey] = useState<string | null>(null);
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
  const writeAllOperationIdRef = useRef('');
  const resourceMapping = useMemo(
    () => settings.feishuFieldMapping || {},
    [settings.feishuFieldMapping],
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
        channelUrl: extractMappedFeishuChannelUrl(record.fields, mapping),
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
    const handleFollowUpWrite = (event: Event) => {
      const detail = (event as CustomEvent<{ recordId: string; stage: FollowUpStage; sentAt: number }>).detail;
      if (!detail?.recordId) return;
      setRecords((current) => current.map((record) => record.recordId === detail.recordId
        ? {
            ...record,
            ...(detail.stage === 2
              ? { secondOutreach: '已发', secondOutreachDate: detail.sentAt }
              : { thirdOutreach: '已发', thirdOutreachDate: detail.sentAt }),
          }
        : record));
    };
    window.addEventListener('follow-up-feishu-updated', handleFollowUpWrite);
    return () => window.removeEventListener('follow-up-feishu-updated', handleFollowUpWrite);
  }, []);

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
      const profiles = new Map<string, ResourceAvatarProfile>();
      if (!settings.feishuUrl || !resourceFieldNames.length) return profiles;
      const targetEmails = new Set(targets.map((record) => record.email).filter(Boolean));
      const targetNames = new Set(
        targets.map((record) => record.channelName.trim().toLocaleLowerCase()).filter(Boolean),
      );
      const items = await fetchFeishuRecordsCached(settings.feishuUrl, {
        fieldNames: resourceFieldNames,
      });
      for (const item of items) {
        const emails = extractEmailAddresses(
          resourceMapping.email ? item.fields[resourceMapping.email] : undefined,
        );
        const channelName = mappedValue(item, resourceMapping, 'channelName');
        const normalizedName = channelName.trim().toLocaleLowerCase();
        const matchedEmails = emails.filter((email) => targetEmails.has(email));
        if (!matchedEmails.length && !targetNames.has(normalizedName)) continue;
        const profile: ResourceAvatarProfile = {
          avatarUrl: getFeishuImageUrl(
            resourceMapping.avatar ? item.fields[resourceMapping.avatar] : undefined,
          ),
          channelName,
          channelUrl: extractMappedFeishuChannelUrl(item.fields, resourceMapping),
          channelId: mappedValue(item, resourceMapping, 'channelId'),
        };
        matchedEmails.forEach((email) => keepBestAvatarProfile(profiles, `email:${email}`, profile));
        if (normalizedName) keepBestAvatarProfile(profiles, `name:${normalizedName}`, profile);
      }
      return profiles;
    };

    const resolveAll = async () => {
      const resourceProfiles = await loadResourceProfiles().catch(() => new Map());
      if (cancelled) return;
      const resolved = new Map<string, string>();
      const pendingByLookup = new Map<string, {
        lookup: NonNullable<ReturnType<typeof buildChannelAvatarLookup>>;
        recordIds: string[];
      }>();
      targets.forEach((record) => {
        const resourceProfile = resourceProfiles.get(`email:${record.email}`)
          || resourceProfiles.get(`name:${record.channelName.trim().toLocaleLowerCase()}`)
          || null;
        if (resourceProfile?.avatarUrl) {
          resolved.set(record.recordId, resourceProfile.avatarUrl);
          return;
        }
        const lookup = buildChannelAvatarLookup({
          channelId: resourceProfile?.channelId || record.channelId,
          channelUrl: resourceProfile?.channelUrl || record.channelUrl,
          channelName: resourceProfile?.channelName || record.channelName,
        });
        if (!lookup) return;
        const pending = pendingByLookup.get(lookup.key);
        if (pending) pending.recordIds.push(record.recordId);
        else pendingByLookup.set(lookup.key, { lookup, recordIds: [record.recordId] });
      });
      const pendingItems = Array.from(pendingByLookup.values());
      const avatarResults = await resolveChannelAvatars(
        pendingItems.map((item) => item.lookup),
        {
          regionCode: settings.youtubeDefaultRegion || '',
          relevanceLanguage: settings.youtubeDefaultLanguage || '',
        },
      );
      pendingItems.forEach((item) => {
        const avatar = avatarResults.get(item.lookup.key);
        if (avatar?.status !== 'ready' || !avatar.avatarUrl) return;
        item.recordIds.forEach((recordId) => resolved.set(recordId, avatar.avatarUrl || ''));
      });
      if (cancelled || !resolved.size) return;
      setRecords((current) => current.map((record) => (
        resolved.has(record.recordId) ? { ...record, avatarUrl: resolved.get(record.recordId) || record.avatarUrl } : record
      )));
    };

    void resolveAll();
    return () => { cancelled = true; };
  }, [
    records,
    resourceMapping,
    settings.feishuUrl,
    settings.youtubeDefaultLanguage,
    settings.youtubeDefaultRegion,
  ]);

  const requestCheck = useCallback(async (record: FollowUpRecord) => {
    if (!record.email) throw new Error('该红人没有可用于 Gmail 检查的邮箱。');
    const query = new URLSearchParams({
      action: 'outreachFollowUp',
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
        check = await requestCheck(record);
      } catch (error) {
        if (!isGmailAuthError(error)) throw error;
        await refreshGmailAuth();
        check = await requestCheck(record);
      }
      setRecords((current) => current.map((item) => (
        item.recordId === record.recordId
          ? { ...item, check, checkedAt: Date.now(), checkError: undefined, synced: false }
          : item
      )));
      if (showFeedback) {
        toast.success(check.reply
          ? `已检查 ${record.channelName}：已收到对方回信，无需跟进开发信。`
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

  const handleGenerate = async (record: FollowUpRecord, stage: FollowUpStage) => {
    if (!auth?.accessToken) {
      toast.error('请先在“设置 > Gmail 邮件”连接 Gmail。');
      return;
    }
    await generateTask(record, stage);
  };

  const handleGenerateAll = async (stage: FollowUpStage) => {
    if (!auth?.accessToken) {
      toast.error('请先在“设置 > Gmail 邮件”连接 Gmail。');
      return;
    }
    await generateMany(records.filter((record) => canGenerateStage(record, stage, tasks)), stage);
  };

  const confirmRegenerate = async () => {
    if (!regenerateKey) return;
    const task = tasks[regenerateKey];
    if (!task) return;
    setRegenerateKey(null);
    setResultDraftKey(null);
    clearTask(regenerateKey);
    await generateTask(task.source, task.stage);
  };

  const openWritePreview = (record: FollowUpRecord) => {
    if (!record.check || record.check.outbound.length === 0) {
      toast.error('请先成功检查 Gmail，并确认已找到初次开发信。');
      return;
    }
    const preview = buildWritePreview(record, mapping);
    if (!preview) {
      toast.info('Gmail 检查结果与飞书现有内容一致，无需写回；若字段未配置，请检查飞书映射。');
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
    const operationId = writeAllOperationIdRef.current || crypto.randomUUID();
    writeAllOperationIdRef.current = operationId;
    setWriteAllProgress({
      completed: 0,
      total: writeAllTargets.length,
      success: 0,
      failed: 0,
    });
    let successCount = 0;
    let failedCount = 0;
    const successfulIds = new Set<string>();
    const batches = chunkFeishuItems(writeAllTargets);
    for (const batch of batches) {
      let batchResults: FeishuBatchResult[] = [];
      try {
        const response = await fetch('/api/feishu/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'batchUpdate',
            url: settings.feishuProspectingUrl,
            operationId,
            items: batch.map((preview) => ({
              clientId: preview.record.recordId,
              recordId: preview.record.recordId,
              fields: preview.payload,
            })),
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(String(result.error || '批量写回飞书失败。'));
        }
        batchResults = (result.data?.results || []) as FeishuBatchResult[];
      } catch (error) {
        const message = error instanceof Error ? error.message : '批量写回飞书失败。';
        batchResults = batch.map((preview) => ({
          clientId: preview.record.recordId,
          status: 'failed',
          error: message,
        }));
      }

      const resultsById = new Map(batchResults.map((result) => [result.clientId, result]));
      let batchSuccess = 0;
      let batchFailed = 0;
      batch.forEach((preview) => {
        const result = resultsById.get(preview.record.recordId);
        if (result?.status === 'success') {
          successfulIds.add(preview.record.recordId);
          batchSuccess += 1;
        } else {
          batchFailed += 1;
        }
      });
      successCount += batchSuccess;
      failedCount += batchFailed;
      setWriteAllProgress((current) => current ? {
        ...current,
        completed: current.completed + batch.length,
        success: current.success + batchSuccess,
        failed: current.failed + batchFailed,
      } : null);
    }
    setRecords((current) => current.map((record) => (
      successfulIds.has(record.recordId) ? { ...record, synced: true } : record
    )));
    if (failedCount === 0) writeAllOperationIdRef.current = '';
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
    (record) => canGenerateStage(record, 2, tasks),
  ).length;
  const secondFollowUpEligibleCount = records.filter(
    (record) => canGenerateStage(record, 3, tasks),
  ).length;
  const visibleRecordIds = new Set(records.map((record) => record.recordId));
  const reviewTasksByStage = (stage: FollowUpStage) => Object.values(tasks).filter((task) => (
    task.stage === stage
    && visibleRecordIds.has(task.source.recordId)
    && (task.status === 'generated' || task.status === 'ready' || task.status === 'feishu_error')
  ));
  const firstReviewTasks = reviewTasksByStage(2);
  const secondReviewTasks = reviewTasksByStage(3);
  const firstDraftBatchProgress = draftBatchProgress[2];
  const secondDraftBatchProgress = draftBatchProgress[3];
  const anyDraftBatchProgress = Boolean(firstDraftBatchProgress || secondDraftBatchProgress);
  const resultDraft = resultDraftKey ? tasks[resultDraftKey] : undefined;
  const batchReviewTasks = batchReviewStage ? reviewTasksByStage(batchReviewStage) : [];
  const selectedBatchTask = batchReviewTasks.find((task) => task.key === batchReviewKey)
    || batchReviewTasks[0];
  const selectedBatchIndex = selectedBatchTask
    ? batchReviewTasks.findIndex((task) => task.key === selectedBatchTask.key)
    : -1;

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
            <Button variant="outline" size="sm" onClick={() => void loadRecords()} disabled={loading || anyDraftBatchProgress}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              刷新列表
            </Button>
            <Button size="sm" onClick={() => void handleCheckAll()} disabled={loading || Boolean(batchProgress) || anyDraftBatchProgress || !records.length}>
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
                || anyDraftBatchProgress
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
                      onClick={() => {
                        if (firstReviewTasks.length) {
                          setBatchReviewStage(2);
                          setBatchReviewKey(firstReviewTasks[0]?.key || null);
                        } else {
                          void handleGenerateAll(2);
                        }
                      }}
                      disabled={
                        loading
                        || Boolean(batchProgress)
                        || anyDraftBatchProgress
                        || (firstReviewTasks.length === 0 && firstFollowUpEligibleCount === 0)
                      }
                    >
                      {firstDraftBatchProgress ? (
                        <Loader2 data-icon="inline-start" className="animate-spin" />
                      ) : firstReviewTasks.length ? (
                        <PencilLine data-icon="inline-start" />
                      ) : (
                        <Sparkles data-icon="inline-start" />
                      )}
                      {firstDraftBatchProgress
                        ? `${firstDraftBatchProgress.completed}/${firstDraftBatchProgress.total}`
                        : firstReviewTasks.length
                          ? `查看全部 (${firstReviewTasks.length})`
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
                      onClick={() => {
                        if (secondReviewTasks.length) {
                          setBatchReviewStage(3);
                          setBatchReviewKey(secondReviewTasks[0]?.key || null);
                        } else {
                          void handleGenerateAll(3);
                        }
                      }}
                      disabled={
                        loading
                        || Boolean(batchProgress)
                        || anyDraftBatchProgress
                        || (secondReviewTasks.length === 0 && secondFollowUpEligibleCount === 0)
                      }
                    >
                      {secondDraftBatchProgress ? (
                        <Loader2 data-icon="inline-start" className="animate-spin" />
                      ) : secondReviewTasks.length ? (
                        <PencilLine data-icon="inline-start" />
                      ) : (
                        <Sparkles data-icon="inline-start" />
                      )}
                      {secondDraftBatchProgress
                        ? `${secondDraftBatchProgress.completed}/${secondDraftBatchProgress.total}`
                        : secondReviewTasks.length
                          ? `查看全部 (${secondReviewTasks.length})`
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
                const firstDraftKey = followUpTaskKey(record.recordId, 2);
                const secondDraftKey = followUpTaskKey(record.recordId, 3);
                const firstTask = tasks[firstDraftKey];
                const secondTask = tasks[secondDraftKey];
                const firstSentAt = record.check?.outbound[1]?.date || record.secondOutreachDate;
                const secondSentAt = record.check?.outbound[2]?.date || record.thirdOutreachDate;
                return (
                  <tr key={record.recordId} className="align-top hover:bg-slate-50/60">
                    <td className="px-4 py-4">
                      <div className="flex min-w-[220px] items-start gap-3">
                        <Avatar className="h-10 w-10 shrink-0 rounded-md">
                          <AvatarImage
                            src={record.avatarUrl}
                            alt={`${record.channelName} 频道头像`}
                            onError={() => {
                              setRecords((current) => current.map((item) => (
                                item.recordId === record.recordId ? { ...item, avatarUrl: '' } : item
                              )));
                            }}
                          />
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
                        sent={Boolean(record.check?.outbound[1]) || isSent(record.secondOutreach)}
                        task={firstTask}
                        canGenerate={canGenerateStage(record, 2, tasks)}
                        onGenerate={() => void handleGenerate(record, 2)}
                        onOpenTask={() => setResultDraftKey(firstDraftKey)}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <StageActionCell
                        label="第 7 天"
                        sentAt={secondSentAt}
                        sent={Boolean(record.check?.outbound[2]) || isSent(record.thirdOutreach)}
                        task={secondTask}
                        canGenerate={canGenerateStage(record, 3, tasks)}
                        onGenerate={() => void handleGenerate(record, 3)}
                        onOpenTask={() => setResultDraftKey(secondDraftKey)}
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
        open={Boolean(resultDraftKey && resultDraft)}
        onOpenChange={(open) => !open && setResultDraftKey(null)}
      >
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <DialogTitle>{resultDraft ? `${resultDraft.source.channelName} · ${stageLabel(resultDraft.stage)}` : '审核 Follow Up 邮件'}</DialogTitle>
              <Badge variant="outline">
                {resultDraft?.status === 'feishu_error'
                  ? 'Gmail 草稿已保存 · 飞书待重试'
                  : resultDraft?.status === 'saved'
                    ? '草稿已保存 · 飞书已标记'
                    : '待确认 · 未写入 Gmail'}
              </Badge>
            </div>
            <DialogDescription>
              {resultDraft ? `${resultDraft.source.email} · 原线程主题：${resultDraft.subject || '未读取'}` : '审核后再保存 Gmail 草稿。'}
            </DialogDescription>
          </DialogHeader>
          {resultDraft ? (
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <FollowUpReviewEditor
                task={resultDraft}
                onChineseChange={(value) => updateChinese(resultDraft.key, value)}
                onTranslate={() => { void translateTask(resultDraft.key); }}
                onSave={() => {
                  void saveTask(resultDraft.key).then((saved) => {
                    if (saved) setResultDraftKey(null);
                  });
                }}
                onRegenerate={() => setRegenerateKey(resultDraft.key)}
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(batchReviewStage)}
        onOpenChange={(open) => {
          if (!open) {
            setBatchReviewStage(null);
            setBatchReviewKey(null);
          }
        }}
      >
        <DialogContent className="flex h-[88vh] max-h-[900px] flex-col overflow-hidden p-0 sm:w-[calc(100%-4rem)] sm:max-w-7xl">
          <DialogHeader className="px-6 pt-6">
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <DialogTitle>{batchReviewStage ? `${stageLabel(batchReviewStage)}批量审核` : '批量审核'}</DialogTitle>
              <Badge variant="secondary">待处理 {batchReviewTasks.length} 封</Badge>
            </div>
            <DialogDescription>
              每封邮件需要单独确认并保存；飞书写回失败的项目只会重试飞书，不会重复创建 Gmail 草稿。
            </DialogDescription>
          </DialogHeader>
          {selectedBatchTask ? (
            <div className="grid min-h-0 flex-1 grid-cols-[288px_minmax(0,1fr)] border-t">
              <ScrollArea className="border-r bg-muted/20">
                <div className="flex flex-col gap-2 p-3">
                  {batchReviewTasks.map((task, index) => (
                    <Button
                      key={task.key}
                      type="button"
                      variant={task.key === selectedBatchTask.key ? 'secondary' : 'ghost'}
                      className="h-auto justify-start whitespace-normal px-3 py-2 text-left"
                      onClick={() => setBatchReviewKey(task.key)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{index + 1}. {task.source.channelName}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {task.status === 'feishu_error' ? 'Gmail 已保存 · 飞书待重试' : task.source.email}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
              <div className="flex min-h-0 flex-col">
                <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{selectedBatchTask.source.channelName}</p>
                    <p className="truncate text-xs text-muted-foreground">{selectedBatchTask.source.email} · {selectedBatchTask.subject}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="上一封"
                      disabled={selectedBatchIndex <= 0}
                      onClick={() => setBatchReviewKey(batchReviewTasks[selectedBatchIndex - 1]?.key || null)}
                    >
                      <ArrowLeft />
                    </Button>
                    <span className="text-xs text-muted-foreground">{selectedBatchIndex + 1} / {batchReviewTasks.length}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="下一封"
                      disabled={selectedBatchIndex < 0 || selectedBatchIndex >= batchReviewTasks.length - 1}
                      onClick={() => setBatchReviewKey(batchReviewTasks[selectedBatchIndex + 1]?.key || null)}
                    >
                      <ArrowRight />
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                  <FollowUpReviewEditor
                    task={selectedBatchTask}
                    onChineseChange={(value) => updateChinese(selectedBatchTask.key, value)}
                    onTranslate={() => { void translateTask(selectedBatchTask.key); }}
                    onSave={() => { void saveTask(selectedBatchTask.key); }}
                    onRegenerate={() => setRegenerateKey(selectedBatchTask.key)}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 border-t p-8 text-center">
              <CheckCircle2 className="size-8 text-emerald-600" />
              <p className="font-medium">当前批次已全部处理</p>
              <p className="text-sm text-muted-foreground">已保存的 Gmail 草稿不会在待审核列表中重复出现。</p>
              <Button type="button" onClick={() => setBatchReviewStage(null)}>完成</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(regenerateKey)} onOpenChange={(open) => !open && setRegenerateKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重新生成这封 Follow Up？</AlertDialogTitle>
            <AlertDialogDescription>当前外文和中文修改都会被新的 AI 结果替换，此操作不会创建 Gmail 草稿或写入飞书。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续审核</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void confirmRegenerate(); }}>
              <RefreshCw data-icon="inline-start" />确认重新生成
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={writeAllConfirmOpen}
        onOpenChange={(open) => !writeAllProgress && setWriteAllConfirmOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认写回全部检查结果</AlertDialogTitle>
            <AlertDialogDescription>
              将把当前日期范围内已完成 Gmail 检查的 {writeAllTargets.length} 条结果同步到“红人开发情况表”。
              与飞书现有内容完全一致、未检查、检查失败或没有找到初次开发信的记录不会写入。
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
