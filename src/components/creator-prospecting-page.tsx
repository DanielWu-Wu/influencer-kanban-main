'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Database,
  ExternalLink,
  Loader2,
  MailCheck,
  Send,
  UserPlus,
  Zap,
  Youtube,
} from 'lucide-react';
import { toast } from 'sonner';
import { InfluencerImportTab } from '@/components/creator-prospecting/influencer-import-tab';
import { InvitationConfirmTab } from '@/components/creator-prospecting/invitation-confirm-tab';
import { OutreachEmailTab } from '@/components/creator-prospecting/outreach-email-tab';
import { OutreachFollowUpTab } from '@/components/creator-prospecting/outreach-follow-up-tab';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { generateId, useGmailAuth, useProducts, useSettings, type AppSettings } from '@/lib/data';
import { DEFAULT_OUTREACH_PROMPT } from '@/lib/ai-prompts';
import {
  appendEmailSignature,
  applyPlainTextEmailSignature,
  getEmailSignatureForContext,
  stripConfiguredEmailSignature,
} from '@/lib/email-content';
import { sanitizeOutreachEmailBody } from '@/lib/outreach-draft-sanitizer';
import { outreachLanguageLabel } from '@/lib/outreach-languages';
import {
  buildOutreachEmailHtml,
  getProductInlineImage,
  selectedProductEmailAsset,
} from '@/lib/outreach-email-rendering';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';
import {
  fetchFeishuRecordSnapshot,
  FEISHU_RECORD_CACHE_TTL_MS,
  invalidateFeishuRecordsCache,
  type FeishuRecordSnapshot,
} from '@/lib/feishu-record-cache';
import {
  appendFeishuEmailValue,
  buildFeishuRecordIndex,
  findFeishuRecordMatch,
  flattenFeishuValue,
  normalizeFeishuEmailValue,
  type FeishuRecordMatch,
} from '@/lib/feishu-record-index';
import type { FeishuBatchResult } from '@/lib/feishu-batch';
import {
  compareEmailSyncPlan,
  compareProspectWritePlan,
  isProspectWriteBlocked,
} from '@/lib/feishu-write-guard';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { scopedLocalStorageKey } from '@/lib/account-cache-scope';
import {
  applyManualProspectEmail,
  buildProspectEmailCandidates,
  selectProspectEmailCandidate,
  updateProspectEmailCandidates,
  type ProspectEmailCandidateSource,
  type ProspectEmailSelectionState,
} from '@/lib/prospect-email-selection';
import {
  calculateRecentAverageViews,
  canCreateFeishuRecord,
  countryLabel,
  CREATOR_PROSPECTS_DELETED_STORAGE_KEY,
  CREATOR_PROSPECTS_SCHEMA_VERSION,
  CREATOR_PROSPECTS_STORAGE_KEY,
  extractYouTubeInputs,
  FALLBACK_PRODUCT_OPTIONS,
  inferLanguage,
  migrateProspects,
  normalizeYouTubeKey,
  type OutreachDraft,
  type Prospect,
  type OutreachGenerationStage,
  type ProspectingTab,
  type RecentVideo,
  WORKFLOW_META,
} from '@/lib/creator-prospecting';
import {
  buildOutreachAiContext,
  stripOutreachPreviewData,
  type OutreachAiContext,
} from '@/lib/outreach-context';
import type { GmailAuth } from '@/lib/types';
import { useEmailGenerationTasks } from '@/components/email-generation-task-provider';
import { buildOutreachEmailGenerationTaskKey } from '@/lib/email-generation-tasks';

type YouTubeResolveChannel = {
  inputUrl?: string;
  sourceUrl?: string;
  channelId?: string;
  title?: string;
  description?: string;
  customUrl?: string;
  country?: string;
  avatarUrl?: string;
  subscriberCount?: number | null;
  viewCount?: number | null;
  videoCount?: number | null;
  url?: string;
  publicEmail?: string;
  recentVideos?: RecentVideo[];
  youtubeDataStatus?: 'complete' | 'partial' | 'error';
  youtubeDataWarnings?: string[];
  youtubeLastFetchedAt?: string;
  recentVideosStatus?: 'ready' | 'empty' | 'error';
  descriptionStatus?: 'ready' | 'empty';
};

type YouTubeResolveResponse = {
  success?: boolean;
  channels?: YouTubeResolveChannel[];
  errors?: Array<{ sourceUrl: string; error: string }>;
  error?: string;
};

type FeishuRecord = {
  record_id: string;
  fields: Record<string, unknown>;
};

type ResourceEmailSyncPreview =
  | {
      status: 'checking';
      recordId: string;
    }
  | {
      status: 'will_update';
      recordId: string;
      fieldName: string;
      currentValue: string;
      nextValue: string;
      appendedEmail: string;
    }
  | {
      status: 'already_exists';
      currentValue: string;
      appendedEmail: string;
    }
  | {
      status: 'missing_mapping' | 'missing_record' | 'missing_email';
    }
  | {
      status: 'failed';
      message: string;
    };

type FeishuWritePreview = {
  prospect: Prospect;
  fields: Record<string, unknown>;
  target: 'resource' | 'development';
  resourceEmailSync?: ResourceEmailSyncPreview;
  writeStatus?: 'pending' | 'success' | 'failed';
  writeError?: string;
  validationChanges?: string[];
  validationBlocked?: boolean;
};

type QuickOnboardingPreview = {
  prospect: Prospect;
  resourceAction: 'create' | 'skip' | 'blocked';
  developmentAction: 'create' | 'skip' | 'blocked';
  resourceFields: Record<string, unknown>;
  developmentFields: Record<string, unknown>;
  resourceEmailSync?: ResourceEmailSyncPreview;
  blockedReason?: string;
  resourceStatus?: 'pending' | 'success' | 'failed';
  developmentWriteStatus?: 'pending' | 'success' | 'failed';
  emailSyncStatus?: 'pending' | 'success' | 'failed';
  resourceError?: string;
  developmentError?: string;
  emailSyncError?: string;
  validationChanges?: string[];
};

type FeishuFieldOption = {
  id?: string;
  name?: string;
  text?: string;
  value?: string;
};

type FeishuInspectField = {
  field_name: string;
  type: number;
  property?: {
    options?: FeishuFieldOption[];
  };
  options?: FeishuFieldOption[];
};

type ResourceContentTypeStatus = 'idle' | 'loading' | 'ready' | 'error';
type ResourceContentTypeAiStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'error';

type OutreachStreamEvent =
  | { event: 'stage'; data: { stage?: OutreachGenerationStage; label?: string } }
  | { event: 'delta'; data: { text?: string } }
  | { event: 'final'; data: OutreachDraft }
  | { event: 'error'; data: { message?: string } };

const TAB_META: Array<{
  id: ProspectingTab;
  label: string;
  icon: typeof UserPlus;
}> = [
  { id: 'import', label: '红人录入', icon: UserPlus },
  { id: 'invitation', label: '邀约确认', icon: ClipboardCheck },
  { id: 'outreach', label: '开发信', icon: MailCheck },
  { id: 'follow_up', label: '开发信跟进', icon: Send },
];

function firstValue(...values: Array<string | undefined>) {
  return values.find((value) => Boolean(value?.trim()))?.trim() || '';
}

function getErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === 'object' && 'error' in value) {
    const error = (value as { error?: unknown; details?: unknown }).error;
    if (typeof error === 'string') return error;
    const details = (value as { details?: unknown }).details;
    if (typeof details === 'string' && details.trim()) {
      try {
        const payload = JSON.parse(details) as {
          error?: {
            message?: string;
            status?: string;
            errors?: Array<{ reason?: string; message?: string }>;
          };
        };
        const reason = payload.error?.errors?.map((item) => item.reason || item.message).filter(Boolean).join('；');
        const message = [payload.error?.message, payload.error?.status, reason].filter(Boolean).join('；');
        if (message) return message;
      } catch {
        return details.trim();
      }
    }
  }
  return fallback;
}

function isGmailAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return [
    'unauthenticated',
    'invalid authentication credentials',
    'invalid credentials',
    'oauth',
    'access token',
    'authtoken',
    'autherror',
    '401',
  ].some((keyword) => message.toLowerCase().includes(keyword));
}

function putMappedField(
  fields: Record<string, unknown>,
  mapping: FeishuFieldMapping,
  key: FeishuFieldKey,
  value: unknown,
) {
  const fieldName = mapping[key];
  if (!fieldName || value === undefined || value === null || value === '') return;
  fields[fieldName] = value;
}

function buildFeishuUrlValue(prospect: Prospect) {
  const link = firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl);
  if (!link) return undefined;
  return {
    text: prospect.title || link,
    link,
  };
}

function getProspectChannelUrl(prospect: Prospect) {
  const directUrl = firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl);
  if (/^https?:\/\//i.test(directUrl)) return directUrl;

  if (prospect.channelId) {
    return `https://www.youtube.com/channel/${encodeURIComponent(prospect.channelId)}`;
  }

  const customUrl = firstValue(prospect.customUrl, directUrl);
  if (/^https?:\/\//i.test(customUrl)) return customUrl;
  if (customUrl.startsWith('@')) return `https://www.youtube.com/${customUrl}`;

  return '';
}

function buildResourceFields(
  prospect: Prospect,
  mapping: FeishuFieldMapping,
  contentTypes: string[] = [],
) {
  const fields: Record<string, unknown> = {};
  const notes = '来源：红人开发台';

  putMappedField(fields, mapping, 'channelName', prospect.title);
  putMappedField(fields, mapping, 'platform', 'YouTube');
  putMappedField(fields, mapping, 'region', prospect.country ? countryLabel(prospect.country) : '');
  putMappedField(fields, mapping, 'contentType', contentTypes);
  putMappedField(fields, mapping, 'followers', prospect.subscriberCount);
  putMappedField(fields, mapping, 'channelUrl', buildFeishuUrlValue(prospect));
  putMappedField(fields, mapping, 'channelId', prospect.channelId);
  putMappedField(fields, mapping, 'recentAverageViews', prospect.recentAverageViews);
  putMappedField(fields, mapping, 'email', normalizeFeishuEmailValue(prospect.publicEmail));
  putMappedField(fields, mapping, 'notes', notes);
  return fields;
}

function buildDevelopmentFields(prospect: Prospect, mapping: FeishuFieldMapping) {
  const fields: Record<string, unknown> = {};
  const notes = [
    '来源：红人开发台',
    prospect.targetProduct ? `目标产品：${prospect.targetProduct}` : '',
    prospect.cooperationType ? `合作形式：${prospect.cooperationType}` : '',
    prospect.cooperationIdea ? `合作想法：${prospect.cooperationIdea}` : '',
    prospect.priority ? `优先级：${prospect.priority === 'high' ? '高' : prospect.priority === 'low' ? '低' : '中'}` : '',
    `流程状态：${WORKFLOW_META[prospect.workflowStatus].label}`,
    prospect.gmailDraftId ? `Gmail 草稿 ID：${prospect.gmailDraftId}` : '',
  ].filter(Boolean).join('\n');

  putMappedField(fields, mapping, 'channelName', prospect.title);
  putMappedField(fields, mapping, 'region', prospect.country ? countryLabel(prospect.country) : '');
  putMappedField(fields, mapping, 'channelUrl', buildFeishuUrlValue(prospect));
  putMappedField(fields, mapping, 'email', normalizeFeishuEmailValue(prospect.publicEmail));
  const developmentDate = new Date(prospect.createdAt);
  developmentDate.setHours(0, 0, 0, 0);
  putMappedField(fields, mapping, 'developmentDate', developmentDate.getTime());
  putMappedField(fields, mapping, 'prospectingStatus', WORKFLOW_META[prospect.workflowStatus].label);
  putMappedField(fields, mapping, 'targetProduct', prospect.targetProduct);
  putMappedField(fields, mapping, 'cooperationType', prospect.cooperationType);
  putMappedField(fields, mapping, 'cooperationIdea', prospect.cooperationIdea);
  putMappedField(fields, mapping, 'priority', prospect.priority === 'high' ? '高' : prospect.priority === 'low' ? '低' : '中');
  putMappedField(fields, mapping, 'gmailDraftId', prospect.gmailDraftId);
  putMappedField(fields, mapping, 'notes', notes);
  return fields;
}

function buildDevelopmentSyncFields(prospect: Prospect, mapping: FeishuFieldMapping) {
  const fields: Record<string, unknown> = {};
  putMappedField(fields, mapping, 'email', normalizeFeishuEmailValue(prospect.publicEmail));
  putMappedField(fields, mapping, 'prospectingStatus', WORKFLOW_META[prospect.workflowStatus].label);
  putMappedField(fields, mapping, 'targetProduct', prospect.targetProduct);
  putMappedField(fields, mapping, 'cooperationType', prospect.cooperationType);
  putMappedField(fields, mapping, 'cooperationIdea', prospect.cooperationIdea);
  putMappedField(fields, mapping, 'priority', prospect.priority === 'high' ? '高' : prospect.priority === 'low' ? '低' : '中');
  putMappedField(fields, mapping, 'gmailDraftId', prospect.gmailDraftId);
  return fields;
}

function buildFirstOutreachSentFields(prospect: Prospect, mapping: FeishuFieldMapping) {
  const fields: Record<string, unknown> = {};
  putMappedField(fields, mapping, 'firstOutreach', '已发');
  putMappedField(fields, mapping, 'prospectingStatus', WORKFLOW_META[prospect.workflowStatus].label);
  putMappedField(fields, mapping, 'gmailDraftId', prospect.gmailDraftId);
  return fields;
}

function buildFirstOutreachResourceFields(mapping: FeishuFieldMapping) {
  const fields: Record<string, unknown> = {};
  putMappedField(fields, mapping, 'firstOutreach', '已发');
  return fields;
}

function parseTranslatedTitles(value: string, expectedLength: number) {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed) || parsed.length !== expectedLength) return [];
    return parsed.map((item) => String(item || '').trim());
  } catch {
    return [];
  }
}

async function translateRecentVideoTitles(
  videos: RecentVideo[],
  language: string | undefined,
  settings: Pick<
    AppSettings,
    'translatePrompt' | 'modelProvider' | 'customApiUrl' | 'customModelName'
  >,
) {
  const titles = videos.map((video) => video.title.trim());
  if (!titles.length) return videos;
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: JSON.stringify(titles),
      sourceLang: language || 'auto',
      customPrompt: [
        '你是 YouTube 视频标题翻译助手。',
        '请把输入 JSON 数组中的每个标题翻译成自然、准确、简洁的中文。',
        '保留品牌名、产品型号、人名、数字和专有名词。',
        '只返回严格 JSON 字符串数组，顺序和数量必须与输入完全一致，不要 Markdown，不要解释。',
        settings.translatePrompt ? `翻译风格补充要求：${settings.translatePrompt}` : '',
      ].filter(Boolean).join('\n'),
      modelProvider: settings.modelProvider || 'builtin',
      customApiUrl: settings.customApiUrl || '',
      customModelName: settings.customModelName || '',
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(getErrorMessage(result, '最近视频标题翻译失败。'));
  }
  const translatedTitles = parseTranslatedTitles(
    String(result.data?.translatedText || ''),
    titles.length,
  );
  if (!translatedTitles.length) throw new Error('最近视频标题翻译格式不正确。');
  return videos.map((video, index) => ({
    ...video,
    translatedTitle: translatedTitles[index] || video.title,
  }));
}

async function translateChannelDescription(
  description: string,
  language: string | undefined,
  settings: Pick<
    AppSettings,
    'translatePrompt' | 'modelProvider' | 'customApiUrl' | 'customModelName'
  >,
) {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: description,
      sourceLang: language || 'auto',
      customPrompt: [
        '你是 YouTube 频道简介翻译助手。',
        '请把频道简介完整翻译成自然、准确、易读的简体中文。',
        '保留原文的段落结构、品牌名、产品型号、人名、邮箱和网址。',
        '只返回中文翻译，不要添加标题、解释、总结或 Markdown。',
        settings.translatePrompt ? `翻译风格补充要求：${settings.translatePrompt}` : '',
      ].filter(Boolean).join('\n'),
      modelProvider: settings.modelProvider || 'builtin',
      customApiUrl: settings.customApiUrl || '',
      customModelName: settings.customModelName || '',
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(getErrorMessage(result, '频道简介翻译失败。'));
  }
  const translatedText = String(result.data?.translatedText || '').trim();
  if (!translatedText) throw new Error('AI 没有返回可用的频道简介翻译。');
  return translatedText;
}

async function refreshRecentVideos(
  prospect: Prospect,
  settings: Pick<AppSettings, 'youtubeDefaultRegion' | 'youtubeDefaultLanguage'>,
) {
  const response = await fetch('/api/youtube/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      links: [firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl)],
      regionCode: settings.youtubeDefaultRegion || '',
      relevanceLanguage: settings.youtubeDefaultLanguage || '',
      maxVideos: 8,
    }),
  });
  const result = await response.json() as YouTubeResolveResponse;
  if (!response.ok || !result.success || !result.channels?.[0]) {
    throw new Error(result.error || '最近视频数据刷新失败。');
  }
  return result.channels[0].recentVideos || prospect.recentVideos || [];
}

function formatPreviewValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatPreviewValue).filter(Boolean).join('，');
  if (typeof value === 'number' && value > 1_000_000_000_000) {
    return new Date(value).toLocaleDateString('zh-CN');
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;
    if (typeof objectValue.link === 'string') {
      return [objectValue.text, objectValue.link].filter(Boolean).join('\n');
    }
    return flattenFeishuValue(value);
  }
  return String(value);
}

function prospectEmailSelectionState(prospect: Prospect): ProspectEmailSelectionState {
  return {
    publicEmail: prospect.publicEmail,
    emailStatus: prospect.emailStatus,
    emailSource: prospect.emailSource,
    emailCandidates: prospect.emailCandidates,
    emailManuallyLocked: prospect.emailManuallyLocked,
    emailSelectionRequired: prospect.emailSelectionRequired,
  };
}

function recordEmailCandidates(
  record: FeishuRecord | undefined,
  mapping: FeishuFieldMapping,
  source: ProspectEmailCandidateSource,
) {
  return buildProspectEmailCandidates(
    record && mapping.email ? record.fields[mapping.email] : undefined,
    source,
  );
}

function hasPendingEmailSelection(items: Prospect[]) {
  return items.some((item) => item.emailSelectionRequired);
}

function buildPendingResourceEmailSyncPreview(
  prospect: Prospect,
  emailFieldName: string | undefined,
  resourceUrl: string | undefined,
): ResourceEmailSyncPreview {
  const email = normalizeFeishuEmailValue(prospect.publicEmail);
  if (!email) return { status: 'missing_email' };
  if (!emailFieldName) return { status: 'missing_mapping' };
  if (!prospect.resourceRecordId) return { status: 'missing_record' };
  if (!resourceUrl) {
    return { status: 'failed', message: '资源库未连接，本次只新建开发记录。' };
  }
  return { status: 'checking', recordId: prospect.resourceRecordId };
}

function buildResourceEmailSyncPreview(
  prospect: Prospect,
  resourceRecord: FeishuRecord | undefined,
  emailFieldName: string | undefined,
): ResourceEmailSyncPreview {
  const email = normalizeFeishuEmailValue(prospect.publicEmail);
  if (!email) return { status: 'missing_email' };
  if (!emailFieldName) return { status: 'missing_mapping' };
  if (!prospect.resourceRecordId || !resourceRecord) return { status: 'missing_record' };

  const currentValue = normalizeFeishuEmailValue(resourceRecord.fields[emailFieldName]);
  const nextValue = appendFeishuEmailValue(currentValue, email);
  if (nextValue === currentValue) {
    return {
      status: 'already_exists',
      currentValue,
      appendedEmail: email,
    };
  }

  return {
    status: 'will_update',
    recordId: resourceRecord.record_id,
    fieldName: emailFieldName,
    currentValue,
    nextValue,
    appendedEmail: email,
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function splitContentTypeInput(value: string) {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function FeishuOptionMultiSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: unknown;
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : splitContentTypeInput(formatPreviewValue(value));
  const selectedSet = new Set(selected);

  const toggleOption = (option: string) => {
    onChange(
      selectedSet.has(option)
        ? selected.filter((item) => item !== option)
        : [...selected, option],
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={options.length === 0}
          className="h-auto min-h-9 w-full justify-between gap-2 bg-white px-3 py-2 text-left font-normal"
        >
          <span className={`min-w-0 flex-1 truncate ${selected.length ? 'text-foreground' : 'text-muted-foreground'}`}>
            {selected.length ? selected.join('、') : options.length ? '请选择内容类型' : '未读取到飞书选项'}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0"
      >
        <Command disablePointerSelection>
          <CommandInput placeholder="搜索飞书内容类型" />
          <CommandList
            className="touch-pan-y scroll-auto overscroll-y-contain [scrollbar-gutter:stable]"
            onWheel={(event) => event.stopPropagation()}
          >
            <CommandEmpty>没有匹配的飞书选项</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = selectedSet.has(option);
                return (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => toggleOption(option)}
                    className="gap-2"
                  >
                    <CheckCircle2 className={`h-4 w-4 ${checked ? 'text-primary opacity-100' : 'opacity-20'}`} />
                    <span className="min-w-0 flex-1 truncate">{option}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function extractFeishuOptionName(option: FeishuFieldOption) {
  return String(option.name || option.text || option.value || '').trim();
}

function buildContentTypeAiCacheKey(prospect: Prospect, options: string[]) {
  return JSON.stringify([
    prospect.channelId || prospect.url || prospect.inputUrl,
    prospect.youtubeLastFetchedAt || '',
    prospect.title || '',
    prospect.description || '',
    (prospect.recentVideos || []).slice(0, 8).map((video) => [
      video.title,
      video.translatedTitle || '',
    ]),
    options,
  ]);
}

function compactFeishuWriteFields(fields: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  );
}

function parseOutreachStreamEvents(chunk: string): { events: OutreachStreamEvent[]; rest: string } {
  const parts = chunk.split(/\r?\n\r?\n/);
  const rest = parts.pop() || '';
  const events = parts.flatMap((part) => {
    const eventName = part.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const dataLine = part.match(/^data:\s*(.+)$/m)?.[1]?.trim();
    if (!eventName || !dataLine) return [];
    try {
      return [{ event: eventName, data: JSON.parse(dataLine) } as OutreachStreamEvent];
    } catch {
      return [];
    }
  });
  return { events, rest };
}

function buildResourceMatchPreview(
  record: FeishuRecord | undefined,
  mapping: FeishuFieldMapping,
  matchReason: string,
): Prospect['resourceMatchPreview'] {
  if (!record) return undefined;
  const fieldValue = (key: FeishuFieldKey) => {
    const fieldName = mapping[key];
    return fieldName ? flattenFeishuValue(record.fields[fieldName]).trim() : '';
  };
  return {
    recordId: record.record_id,
    matchReason,
    channelName: fieldValue('channelName'),
    channelUrl: fieldValue('channelUrl'),
    email: fieldValue('email'),
    region: fieldValue('region'),
    platform: fieldValue('platform'),
    notes: fieldValue('notes'),
  };
}

function getMatchedRecord(match: FeishuRecordMatch) {
  return match.kind === 'exact' || match.kind === 'suspected' ? match.record : undefined;
}

function getRequiredDedupeFields(mapping: FeishuFieldMapping) {
  return Array.from(new Set([
    mapping.channelId,
    mapping.channelUrl,
    mapping.email,
    mapping.channelName,
    mapping.region,
    mapping.platform,
    mapping.notes,
  ].filter((name): name is string => Boolean(name))));
}

async function requestFeishuBatch(
  action: 'batchCreate' | 'batchUpdate',
  url: string,
  operationId: string,
  items: Array<{
    clientId: string;
    recordId?: string;
    fields: Record<string, unknown>;
  }>,
) {
  if (!items.length) return [] as FeishuBatchResult[];
  const response = await fetch('/api/feishu/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, url, operationId, items }),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(getErrorMessage(result, '飞书批量写入失败。'));
  }
  return (result.data?.results || []) as FeishuBatchResult[];
}

function loadDeletedProspectIds() {
  try {
    const value = JSON.parse(localStorage.getItem(scopedLocalStorageKey(CREATOR_PROSPECTS_DELETED_STORAGE_KEY)) || '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function saveDeletedProspectIds(ids: string[]) {
  localStorage.setItem(scopedLocalStorageKey(CREATOR_PROSPECTS_DELETED_STORAGE_KEY), JSON.stringify(Array.from(new Set(ids))));
}

function rememberDeletedProspect(id: string) {
  rememberDeletedProspects([id]);
}

function rememberDeletedProspects(ids: string[]) {
  saveDeletedProspectIds([...loadDeletedProspectIds(), ...ids]);
}

export type CreatorProspectingOpenRequest = {
  prospectId: string;
  requestId: number;
};

export function CreatorProspectingPage({
  openProspectRequest,
}: {
  openProspectRequest?: CreatorProspectingOpenRequest;
}) {
  const { settings } = useSettings();
  const { products } = useProducts();
  const { auth, connect } = useGmailAuth();
  const { enqueueTask } = useEmailGenerationTasks();
  const [activeTab, setActiveTab] = useState<ProspectingTab>('import');
  const [input, setInput] = useState('');
  const [userPreference, setUserPreference] = useState('');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudAvailable, setCloudAvailable] = useState(true);
  const videoTranslationAttemptsRef = useRef(new Set<string>());
  const [translatingVideoTitleIds, setTranslatingVideoTitleIds] = useState<string[]>([]);
  const [refreshingYouTubeIds, setRefreshingYouTubeIds] = useState<string[]>([]);
  const [inferringContactNameIds, setInferringContactNameIds] = useState<string[]>([]);
  const [inferringOutreachLanguageIds, setInferringOutreachLanguageIds] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [checkingDedupe, setCheckingDedupe] = useState(false);
  const [writingFeishu, setWritingFeishu] = useState(false);
  const [preparingResourcePreview, setPreparingResourcePreview] = useState(false);
  const [preparingDevelopmentPreview, setPreparingDevelopmentPreview] = useState(false);
  const [preparingQuickPreview, setPreparingQuickPreview] = useState(false);
  const [deletingProspects, setDeletingProspects] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [regeneratingDraftPart, setRegeneratingDraftPart] = useState<{ id: string; part: 'subject' | 'body' } | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [checkingHistoryId, setCheckingHistoryId] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<FeishuWritePreview[]>([]);
  const [quickPreviewItems, setQuickPreviewItems] = useState<QuickOnboardingPreview[]>([]);
  const [resourceContentTypeOptions, setResourceContentTypeOptions] = useState<string[]>([]);
  const [resourceContentTypeStatus, setResourceContentTypeStatus] = useState<ResourceContentTypeStatus>('idle');
  const [resourceContentTypeAiStatus, setResourceContentTypeAiStatus] = useState<ResourceContentTypeAiStatus>('idle');
  const resourceContentTypeCacheRef = useRef(new Map<string, string[]>());
  const resourceContentTypeAiCacheRef = useRef(new Map<string, string[]>());
  const resourceContentTypeManualIdsRef = useRef(new Set<string>());
  const resourcePreviewRunRef = useRef(0);
  const resourceSnapshotRef = useRef<FeishuRecordSnapshot | null>(null);
  const developmentSnapshotRef = useRef<FeishuRecordSnapshot | null>(null);
  const previewOperationIdRef = useRef('');
  const quickOperationIdRef = useRef('');
  const outreachChineseTranslationRunRef = useRef(new Map<string, number>());
  const pendingFeishuProspectIdsRef = useRef(new Set<string>());
  const prospectsRef = useRef<Prospect[]>([]);
  const cloudSyncedUpdatedAtRef = useRef(new Map<string, string>());

  const beginProspectWrite = (ids: string[]) => {
    const overlapping = ids.filter((id) => pendingFeishuProspectIdsRef.current.has(id));
    if (overlapping.length) return false;
    ids.forEach((id) => pendingFeishuProspectIdsRef.current.add(id));
    return true;
  };

  const finishProspectWrite = (ids: string[]) => {
    ids.forEach((id) => pendingFeishuProspectIdsRef.current.delete(id));
  };

  const invalidateResourceSnapshot = () => {
    if (settings.feishuUrl) invalidateFeishuRecordsCache(settings.feishuUrl);
    resourceSnapshotRef.current = null;
  };

  const invalidateDevelopmentSnapshot = () => {
    if (settings.feishuProspectingUrl) invalidateFeishuRecordsCache(settings.feishuProspectingUrl);
    developmentSnapshotRef.current = null;
  };

  useEffect(() => {
    prospectsRef.current = prospects;
  }, [prospects]);

  useEffect(() => {
    if (openProspectRequest) setActiveTab('outreach');
  }, [openProspectRequest]);

  useEffect(() => {
    const deletedIds = new Set(loadDeletedProspectIds());
    const localProspects = (() => {
      try {
        return migrateProspects(JSON.parse(localStorage.getItem(scopedLocalStorageKey(CREATOR_PROSPECTS_STORAGE_KEY)) || '[]'))
          .filter((item) => !deletedIds.has(item.id));
      } catch {
        return [];
      }
    })();
    setProspects(localProspects);
    setLoaded(true);

    const loadCloudProspects = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setCloudReady(true);
        return;
      }
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setCloudReady(true);
        return;
      }
      const { data, error } = await supabase
        .from('creator_prospects')
        .select('data')
        .eq('user_id', authData.user.id)
        .order('updated_at', { ascending: false });
      if (error) {
        console.warn('云端红人开发状态读取失败，将继续使用本地数据:', error.message);
        setCloudAvailable(false);
        setCloudReady(true);
        return;
      }
      const latestDeletedIds = new Set(loadDeletedProspectIds());
      const cloudProspects = migrateProspects((data || []).map((row) => row.data))
        .filter((item) => !latestDeletedIds.has(item.id));
      cloudSyncedUpdatedAtRef.current = new Map(
        cloudProspects.map((item) => [item.id, item.updatedAt]),
      );
      if (cloudProspects.length) {
        setProspects((currentProspects) => {
          const merged = new Map<string, Prospect>();
          [...localProspects, ...cloudProspects, ...currentProspects].forEach((item) => {
            if (latestDeletedIds.has(item.id)) return;
            const current = merged.get(item.id);
            if (!current || item.updatedAt > current.updatedAt) merged.set(item.id, item);
          });
          return Array.from(merged.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        });
      }
      setCloudReady(true);
    };
    void loadCloudProspects();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const flush = () => {
      localStorage.setItem(
        scopedLocalStorageKey(CREATOR_PROSPECTS_STORAGE_KEY),
        JSON.stringify(prospectsRef.current),
      );
    };
    const timeout = window.setTimeout(flush, 250);
    window.addEventListener('pagehide', flush);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('pagehide', flush);
    };
  }, [loaded, prospects]);

  useEffect(() => {
    if (!loaded || !cloudReady || !cloudAvailable || !prospects.length) return;
    const changedProspects = prospects.filter((prospect) => (
      cloudSyncedUpdatedAtRef.current.get(prospect.id) !== prospect.updatedAt
    ));
    if (!changedProspects.length) return;
    const timeout = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;
      const { error } = await supabase.from('creator_prospects').upsert(
        changedProspects.map((prospect) => ({
          id: prospect.id,
          user_id: authData.user!.id,
          data: prospect,
          created_at: prospect.createdAt,
          updated_at: prospect.updatedAt,
        })),
      );
      if (error) {
        console.warn('云端红人开发状态保存失败:', error.message);
        return;
      }
      changedProspects.forEach((prospect) => {
        cloudSyncedUpdatedAtRef.current.set(prospect.id, prospect.updatedAt);
      });
    }, 600);
    return () => window.clearTimeout(timeout);
  }, [cloudAvailable, cloudReady, loaded, prospects]);

  /*
   * Keep localStorage as an offline fallback. Supabase becomes the durable source
   * once the optional creator_prospects migration has been applied.
   */
  useEffect(() => {
    try {
      if (cloudReady && !cloudAvailable) {
        console.info('红人开发台当前使用本地存储；执行 Supabase 迁移后会自动启用云同步。');
      }
    } catch {
      // Logging must never block the workflow.
    }
  }, [cloudAvailable, cloudReady]);

  const updateProspect = (id: string, patch: Partial<Prospect>) => {
    setProspects((current) => current.map((item) => (
      item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
    )));
  };

  const updateProspectEmail = (id: string, value: string) => {
    setProspects((current) => current.map((item) => (
      item.id === id
        ? {
            ...item,
            ...applyManualProspectEmail(prospectEmailSelectionState(item), value),
            updatedAt: new Date().toISOString(),
          }
        : item
    )));
  };

  const selectProspectEmail = (id: string, email: string) => {
    setProspects((current) => current.map((item) => (
      item.id === id
        ? {
            ...item,
            ...selectProspectEmailCandidate(prospectEmailSelectionState(item), email),
            updatedAt: new Date().toISOString(),
          }
        : item
    )));
  };

  const handleTranslateChannelDescription = useCallback(
    async (prospect: Prospect) => {
      const description = prospect.description?.trim();
      if (!description) return '';
      return translateChannelDescription(
        description,
        prospect.language,
        {
          translatePrompt: settings.translatePrompt,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customModelName: settings.customModelName,
        },
      );
    },
    [
      settings.customApiUrl,
      settings.customModelName,
      settings.modelProvider,
      settings.translatePrompt,
    ],
  );

  const handleRefreshYouTubeData = async (prospect: Prospect) => {
    if (refreshingYouTubeIds.includes(prospect.id)) return;
    setRefreshingYouTubeIds((current) => [...current, prospect.id]);
    toast.info(`正在重新抓取 ${prospect.title || '该频道'} 的频道资料。`);
    try {
      const response = await fetch('/api/youtube/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links: [firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl)],
          regionCode: settings.youtubeDefaultRegion || '',
          relevanceLanguage: settings.youtubeDefaultLanguage || '',
          maxVideos: 8,
        }),
      });
      const result = await response.json() as YouTubeResolveResponse;
      const channel = result.channels?.[0];
      if (!response.ok || !result.success || !channel) {
        throw new Error(result.error || result.errors?.[0]?.error || '频道资料重新抓取失败。');
      }

      const recentVideos = channel.recentVideos || [];
      const inferredLanguage = inferLanguage({ ...channel, recentVideos });
      const emailPatch = updateProspectEmailCandidates(
        prospectEmailSelectionState(prospect),
        buildProspectEmailCandidates(channel.publicEmail, 'youtube'),
        { replaceSources: ['youtube'] },
      );
      updateProspect(prospect.id, {
        sourceUrl: channel.sourceUrl || prospect.sourceUrl,
        channelId: channel.channelId || prospect.channelId,
        title: channel.title || prospect.title,
        description: channel.description || '',
        customUrl: channel.customUrl || prospect.customUrl,
        country: channel.country || prospect.country,
        avatarUrl: channel.avatarUrl || prospect.avatarUrl,
        subscriberCount: channel.subscriberCount,
        viewCount: channel.viewCount,
        videoCount: channel.videoCount,
        url: channel.url || prospect.url,
        ...emailPatch,
        recentVideos,
        recentAverageViews: calculateRecentAverageViews(recentVideos),
        language: prospect.languageSource === 'manual'
          ? prospect.language
          : inferredLanguage || prospect.language,
        languageSource: prospect.languageSource === 'manual'
          ? 'manual'
          : inferredLanguage ? 'inferred' : prospect.languageSource,
        youtubeDataStatus: channel.youtubeDataStatus || 'complete',
        youtubeDataWarnings: channel.youtubeDataWarnings || [],
        youtubeLastFetchedAt: channel.youtubeLastFetchedAt || new Date().toISOString(),
        recentVideosStatus: channel.recentVideosStatus || (recentVideos.length ? 'ready' : 'empty'),
        descriptionStatus: channel.descriptionStatus || (channel.description ? 'ready' : 'empty'),
      });

      if (channel.youtubeDataWarnings?.length) {
        toast.warning(`频道资料已更新，但有提示：${channel.youtubeDataWarnings.join('；')}`);
      } else {
        toast.success('频道简介和最近视频已更新。');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '频道资料重新抓取失败。';
      updateProspect(prospect.id, {
        youtubeDataStatus: 'error',
        youtubeDataWarnings: [message],
        youtubeLastFetchedAt: new Date().toISOString(),
      });
      toast.error(message);
    } finally {
      setRefreshingYouTubeIds((current) => current.filter((id) => id !== prospect.id));
    }
  };

  const handleInferContactName = async (prospect: Prospect, force = false) => {
    if (
      !force
      && (
        prospect.contactNameSource === 'manual'
        || ['loading', 'found', 'not_found'].includes(prospect.contactNameInferenceStatus || '')
      )
    ) {
      return;
    }
    setInferringContactNameIds((current) => Array.from(new Set([...current, prospect.id])));
    updateProspect(prospect.id, { contactNameInferenceStatus: 'loading' });
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inferContactName',
          channel: {
            title: prospect.title || '',
            description: prospect.description || '',
          },
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result, '联系人姓名识别失败。'));
      }
      const contactName = String(result.data?.contactName || '').trim();
      const found = result.data?.found === true && Boolean(contactName);
      const confidence = Math.min(
        100,
        Math.max(0, Math.round(Number(result.data?.confidence) || 0)),
      );
      setProspects((current) => current.map((item) => {
        if (item.id !== prospect.id || item.contactNameSource === 'manual') return item;
        return {
          ...item,
          contactName: found ? contactName : '',
          contactNameConfidence: found ? confidence : undefined,
          contactNameSource: found ? 'ai' : undefined,
          contactNameInferenceStatus: found ? 'found' : 'not_found',
          updatedAt: new Date().toISOString(),
        };
      }));
    } catch (error) {
      setProspects((current) => current.map((item) => (
        item.id === prospect.id && item.contactNameSource !== 'manual'
          ? {
              ...item,
              contactNameInferenceStatus: 'error',
              updatedAt: new Date().toISOString(),
            }
          : item
      )));
      toast.error(error instanceof Error ? error.message : '联系人姓名识别失败。');
    } finally {
      setInferringContactNameIds((current) => current.filter((id) => id !== prospect.id));
    }
  };

  const handleInferOutreachLanguage = async (prospect: Prospect, force = false) => {
    if (
      !force
      && (
        prospect.outreachLanguageSource === 'manual'
        || ['loading', 'found', 'not_found'].includes(prospect.outreachLanguageInferenceStatus || '')
      )
    ) {
      return;
    }
    setInferringOutreachLanguageIds((current) => Array.from(new Set([...current, prospect.id])));
    updateProspect(prospect.id, { outreachLanguageInferenceStatus: 'loading' });
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inferOutreachLanguage',
          channel: {
            title: prospect.title || '',
            description: prospect.description || '',
            recentVideos: (prospect.recentVideos || []).slice(0, 8).map((video) => ({
              title: video.title,
            })),
          },
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result, '开发信语言识别失败。'));
      }
      const languageCode = String(result.data?.languageCode || '').trim().toLowerCase().slice(0, 2);
      const found = result.data?.found === true && /^[a-z]{2}$/.test(languageCode);
      const confidence = Math.min(
        100,
        Math.max(0, Math.round(Number(result.data?.confidence) || 0)),
      );
      setProspects((current) => current.map((item) => {
        if (item.id !== prospect.id || item.outreachLanguageSource === 'manual') return item;
        return {
          ...item,
          language: found ? languageCode : item.language,
          languageSource: found ? 'inferred' : item.languageSource,
          outreachLanguage: found ? languageCode : '',
          outreachLanguageConfidence: found ? confidence : undefined,
          outreachLanguageSource: found ? 'ai' : undefined,
          outreachLanguageInferenceStatus: found ? 'found' : 'not_found',
          updatedAt: new Date().toISOString(),
        };
      }));
    } catch (error) {
      setProspects((current) => current.map((item) => (
        item.id === prospect.id && item.outreachLanguageSource !== 'manual'
          ? {
              ...item,
              outreachLanguageInferenceStatus: 'error',
              updatedAt: new Date().toISOString(),
            }
          : item
      )));
      toast.error(error instanceof Error ? error.message : '开发信语言识别失败。');
    } finally {
      setInferringOutreachLanguageIds((current) => current.filter((id) => id !== prospect.id));
    }
  };

  const invitationProspects = useMemo(
    () => prospects.filter((item) => item.workflowStatus === 'invitation_pending'),
    [prospects],
  );
  const outreachProspects = useMemo(
    () => prospects.filter((item) => ['outreach_pending', 'outreach_generated'].includes(item.workflowStatus)),
    [prospects],
  );
  const importProspects = useMemo(
    () => prospects.filter((item) =>
      !['invitation_pending', 'outreach_pending', 'outreach_generated', 'gmail_draft_saved', 'skipped'].includes(item.workflowStatus),
    ),
    [prospects],
  );
  const tabCounts = useMemo(() => ({
    import: importProspects.length,
    invitation: invitationProspects.length,
    outreach: outreachProspects.length,
    follow_up: 0,
  }), [importProspects.length, invitationProspects.length, outreachProspects.length]);
  const hasPendingResourceEmailSync = previewItems.some(
    (item) => item.resourceEmailSync?.status === 'checking',
  );
  const quickFailureCount = quickPreviewItems.reduce((count, item) => (
    count
    + (item.resourceStatus === 'failed' ? 1 : 0)
    + (item.developmentWriteStatus === 'failed' ? 1 : 0)
    + (item.emailSyncStatus === 'failed' ? 1 : 0)
  ), 0);
  const productOptions = useMemo(
    () => {
      const activeProducts = Array.from(new Set(
        products
          .filter((item) => item.status === 'active')
          .map((item) => firstValue(item.model, item.name))
          .filter(Boolean),
      )).slice(0, 20);
      return activeProducts.length ? activeProducts : FALLBACK_PRODUCT_OPTIONS.slice(0, 20);
    },
    [products],
  );
  const getOutreachContext = useCallback(
    (prospect: Prospect): OutreachAiContext => buildOutreachAiContext(
      prospect,
      products,
      settings,
      userPreference,
    ),
    [products, settings, userPreference],
  );
  const handleSuggestCooperationIdea = useCallback(
    async (prospect: Prospect) => {
      const context = stripOutreachPreviewData(getOutreachContext(prospect));
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'suggestCooperationIdea',
          channel: context.channel,
          products: context.products,
          targetProduct: context.targetProduct,
          cooperationType: context.cooperationType,
          userPreference: context.userPreference,
          cooperationIdeaPrompt: settings.aiCooperationIdeaPrompt,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result, 'AI 合作想法生成失败。'));
      }
      const cooperationIdea = String(result.data?.cooperationIdea || '').trim();
      if (!cooperationIdea) throw new Error('AI 没有返回可用的合作想法。');
      return cooperationIdea;
    },
    [
      getOutreachContext,
      settings.aiCooperationIdeaPrompt,
      settings.customApiUrl,
      settings.customModelName,
      settings.modelProvider,
    ],
  );

  useEffect(() => {
    if (!loaded || activeTab !== 'invitation') return;
    const targets = invitationProspects.filter((prospect) => (
      Boolean(prospect.recentVideos?.length)
      && prospect.recentVideos!.some((video) => (
        !video.translatedTitle
        || !Object.prototype.hasOwnProperty.call(video, 'likeCount')
        || !Object.prototype.hasOwnProperty.call(video, 'commentCount')
      ))
      && !videoTranslationAttemptsRef.current.has(prospect.id)
    ));
    if (!targets.length) return;

    targets.forEach((prospect) => videoTranslationAttemptsRef.current.add(prospect.id));
    const targetIds = targets.map((prospect) => prospect.id);
    setTranslatingVideoTitleIds((current) => Array.from(new Set([...current, ...targetIds])));

    void Promise.all(targets.map(async (prospect) => {
      try {
        const cachedVideos = prospect.recentVideos || [];
        const needsStatisticsRefresh = cachedVideos.some((video) => (
          !Object.prototype.hasOwnProperty.call(video, 'likeCount')
          || !Object.prototype.hasOwnProperty.call(video, 'commentCount')
          || !Object.prototype.hasOwnProperty.call(video, 'durationSeconds')
        ));
        const videosWithStatistics = needsStatisticsRefresh
          ? await refreshRecentVideos(prospect, {
              youtubeDefaultRegion: settings.youtubeDefaultRegion,
              youtubeDefaultLanguage: settings.youtubeDefaultLanguage,
            })
          : cachedVideos;
        let recentVideos = videosWithStatistics;
        try {
          recentVideos = await translateRecentVideoTitles(
            videosWithStatistics,
            prospect.language,
            {
              translatePrompt: settings.translatePrompt,
              modelProvider: settings.modelProvider,
              customApiUrl: settings.customApiUrl,
              customModelName: settings.customModelName,
            },
          );
        } catch (error) {
          console.warn(
            `${prospect.title || prospect.inputUrl} 的视频标题翻译失败，将显示原标题:`,
            error instanceof Error ? error.message : error,
          );
        }
        setProspects((current) => current.map((item) => (
          item.id === prospect.id
            ? { ...item, recentVideos, updatedAt: new Date().toISOString() }
            : item
        )));
      } catch (error) {
        console.warn(
          `${prospect.title || prospect.inputUrl} 的最近视频数据刷新失败:`,
          error instanceof Error ? error.message : error,
        );
      } finally {
        setTranslatingVideoTitleIds((current) => current.filter((id) => id !== prospect.id));
      }
    }));
  }, [
    activeTab,
    invitationProspects,
    loaded,
    settings.customApiUrl,
    settings.customModelName,
    settings.modelProvider,
    settings.translatePrompt,
    settings.youtubeDefaultLanguage,
    settings.youtubeDefaultRegion,
  ]);

  const syncFeishuProspect = async (
    prospect: Prospect,
    patch: Partial<Prospect> = {},
    signal?: AbortSignal,
  ) => {
    if (!settings.feishuProspectingUrl || !prospect.feishuRecordId) return true;
    const next = { ...prospect, ...patch } as Prospect;
    const fields = buildDevelopmentSyncFields(next, settings.feishuProspectingFieldMapping || {});
    if (!Object.keys(fields).length) return true;
    try {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          action: 'update',
          url: settings.feishuProspectingUrl,
          recordId: prospect.feishuRecordId,
          fields,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(getErrorMessage(result, '飞书状态同步失败。'));
      updateProspect(prospect.id, { syncError: undefined });
      return true;
    } catch (error) {
      updateProspect(prospect.id, { syncError: error instanceof Error ? error.message : '飞书状态同步失败。' });
      return false;
    }
  };

  const writeFirstOutreachSent = async (prospect: Prospect, patch: Partial<Prospect> = {}) => {
    if (!settings.feishuProspectingUrl || !settings.feishuUrl) {
      return {
        success: false,
        error: '请先在设置中连接“红人信息数据库”和“红人开发情况表”。',
      };
    }
    const next = { ...prospect, ...patch } as Prospect;
    if (!next.feishuRecordId || !next.resourceRecordId) {
      return {
        success: false,
        error: '这条线索还没有同时关联资源库记录和开发记录，暂时不能双表写回“初次开发信”。',
      };
    }
    const developmentMapping = settings.feishuProspectingFieldMapping || {};
    const resourceMapping = settings.feishuFieldMapping || {};
    if (!developmentMapping.firstOutreach || !resourceMapping.firstOutreach) {
      return {
        success: false,
        error: '请先在两个飞书表的字段映射中都配置“初次开发信”字段。',
      };
    }
    const developmentFields = buildFirstOutreachSentFields(next, developmentMapping);
    const resourceFields = buildFirstOutreachResourceFields(resourceMapping);
    if (!Object.keys(developmentFields).length || !Object.keys(resourceFields).length) {
      return {
        success: false,
        error: '没有可写入的飞书字段，请检查字段映射。',
      };
    }
    try {
      const writes = [
        {
          label: '红人信息数据库',
          url: settings.feishuUrl,
          recordId: next.resourceRecordId,
          fields: resourceFields,
        },
        {
          label: '红人开发情况表',
          url: settings.feishuProspectingUrl,
          recordId: next.feishuRecordId,
          fields: developmentFields,
        },
      ];
      const results = await Promise.all(writes.map(async (write) => {
        const response = await fetch('/api/feishu/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update',
            url: write.url,
            recordId: write.recordId,
            fields: write.fields,
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(`${write.label}：${getErrorMessage(result, '飞书写回失败。')}`);
        }
        return result;
      }));
      if (results.length !== writes.length) throw new Error('飞书写回结果不完整。');
      updateProspect(next.id, { syncError: undefined });
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '飞书写回失败。';
      updateProspect(next.id, { syncError: message });
      return { success: false, error: message };
    }
  };

  async function handleResolve() {
    const links = extractYouTubeInputs(input);
    if (!links.length) {
      toast.error('请先粘贴至少一个 YouTube 频道链接、@handle 或频道 ID。');
      return;
    }
    const existingByKey = new Map(prospects.map((item) => [
      normalizeYouTubeKey(firstValue(item.inputUrl, item.sourceUrl, item.url)),
      item,
    ]));
    const now = new Date().toISOString();
    const additions: Prospect[] = links.map((link) => {
      const previousProspect = existingByKey.get(normalizeYouTubeKey(link));
      return {
        schemaVersion: CREATOR_PROSPECTS_SCHEMA_VERSION,
        id: generateId(),
        inputUrl: link,
        workflowStatus: 'recorded',
        emailStatus: 'missing',
        dedupeStatus: 'unchecked',
        resourceStatus: 'unchecked',
        developmentStatus: 'unchecked',
        repeatOutreach: Boolean(previousProspect),
        previousProspectId: previousProspect?.id,
        duplicateReason: previousProspect
          ? '开发台中存在历史线索，本次将作为新的开发轮次继续处理'
          : undefined,
        competitorCollaboration: 'unknown',
        createdAt: now,
        updatedAt: now,
      };
    });
    setProspects((current) => [...additions, ...current]);
    setSelectedIds(additions.map((item) => item.id));
    setResolving(true);
    const repeatCount = additions.filter((item) => item.repeatOutreach).length;
    toast.info(repeatCount
      ? `正在识别 ${additions.length} 个频道，其中 ${repeatCount} 个将作为重复开发的新轮次。`
      : `正在识别 ${additions.length} 个 YouTube 频道。`);

    try {
      const response = await fetch('/api/youtube/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links,
          regionCode: settings.youtubeDefaultRegion || '',
          relevanceLanguage: settings.youtubeDefaultLanguage || '',
          maxVideos: 8,
        }),
      });
      const result = await response.json() as YouTubeResolveResponse;
      if (!response.ok || !result.success) throw new Error(result.error || 'YouTube 频道识别失败。');

      const resolvedProspects = additions.flatMap((item) => {
        const inputKey = normalizeYouTubeKey(item.inputUrl);
        const channel = result.channels?.find((candidate) => (
          normalizeYouTubeKey(candidate.inputUrl || '') === inputKey
          || normalizeYouTubeKey(candidate.sourceUrl || '') === inputKey
          || normalizeYouTubeKey(candidate.url || '') === inputKey
        ));
        if (!channel) return [];
        const recentVideos = channel.recentVideos || [];
        const language = inferLanguage({ ...channel, recentVideos });
        const emailPatch = updateProspectEmailCandidates(
          prospectEmailSelectionState(item),
          buildProspectEmailCandidates(channel.publicEmail, 'youtube'),
          { replaceSources: ['youtube'] },
        );
        return [{
          ...item,
          ...channel,
          ...emailPatch,
          recentVideos,
          language,
          languageSource: language ? 'inferred' as const : undefined,
          recentAverageViews: calculateRecentAverageViews(recentVideos),
          workflowStatus: 'resolved' as const,
          emailStatus: emailPatch.emailStatus || (emailPatch.publicEmail ? 'available' as const : 'missing' as const),
          dedupeStatus: 'unchecked' as const,
          error: emailPatch.publicEmail ? undefined : '未在公开简介中发现邮箱，可继续确认邀约，但保存 Gmail 草稿前必须补充。',
          updatedAt: new Date().toISOString(),
        }];
      });
      const resolvedById = new Map(resolvedProspects.map((item) => [item.id, item]));
      const additionIds = new Set(additions.map((item) => item.id));

      setProspects((current) => current.map((item) => {
        if (!additionIds.has(item.id)) return item;
        const resolved = resolvedById.get(item.id);
        if (resolved) return resolved;
        const inputKey = normalizeYouTubeKey(item.inputUrl);
        const matchedError = result.errors?.find((error) => normalizeYouTubeKey(error.sourceUrl) === inputKey);
        return {
          ...item,
          workflowStatus: 'error',
          error: matchedError?.error || 'YouTube 已返回识别结果，但未能关联到这条输入，请点击“识别频道”重试。',
          updatedAt: new Date().toISOString(),
        };
      }));
      setInput('');
      const successCount = resolvedProspects.length;
      const failureCount = additions.length - successCount;
      if (successCount) {
        toast.success(`识别完成：成功 ${successCount} 个${failureCount ? `，失败 ${failureCount} 个` : ''}。`);
      } else {
        toast.error(`本次 ${additions.length} 个频道均未能稳定写入列表，请根据错误提示重试。`);
      }
      if (resolvedProspects.length) {
        setResolving(false);
        void handleCheckDedupe(resolvedProspects);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'YouTube 频道识别失败。';
      setProspects((current) => current.map((item) => (
        additions.some((addition) => addition.id === item.id)
          ? { ...item, workflowStatus: 'error', error: message, updatedAt: new Date().toISOString() }
          : item
      )));
      toast.error(message);
    } finally {
      setResolving(false);
    }
  }

  const loadDedupeSnapshot = async (
    url: string,
    label: string,
    mapping: FeishuFieldMapping,
    force = false,
  ) => {
    if (!url) throw new Error(`请先在设置中连接${label}。`);
    const startedAt = performance.now();
    const snapshot = await fetchFeishuRecordSnapshot(url, {
      force,
      fieldNames: getRequiredDedupeFields(mapping),
    });
    return {
      snapshot,
      elapsedMs: Math.round(performance.now() - startedAt),
    };
  };

  const runDedupe = async (
    items: Prospect[],
    options: { force?: boolean; showToast?: boolean } = {},
  ) => {
    const targets = items.filter((item) => item.workflowStatus === 'resolved');
    if (!targets.length) {
      toast.error('请选择已识别的频道进行飞书查重。');
      return null;
    }
    setCheckingDedupe(true);
    const targetIds = new Set(targets.map((item) => item.id));
    setProspects((current) => current.map((item) => (
      targetIds.has(item.id)
        ? {
            ...item,
            dedupeStatus: 'checking',
            resourceStatus: 'checking',
            developmentStatus: 'checking',
            updatedAt: new Date().toISOString(),
          }
        : item
    )));
    const totalStartedAt = performance.now();
    try {
      if (!settings.feishuUrl || !settings.feishuProspectingUrl) {
        throw new Error('请先在设置中分别连接“红人信息数据库”和“红人开发情况表”。');
      }
      const resourceMapping = settings.feishuFieldMapping || {};
      const developmentMapping = settings.feishuProspectingFieldMapping || {};
      const [resourceLoad, developmentLoad] = await Promise.all([
        loadDedupeSnapshot(
          settings.feishuUrl,
          '红人信息数据库',
          resourceMapping,
          options.force,
        ),
        loadDedupeSnapshot(
          settings.feishuProspectingUrl,
          '红人开发情况表',
          developmentMapping,
          options.force,
        ),
      ]);
      resourceSnapshotRef.current = resourceLoad.snapshot;
      developmentSnapshotRef.current = developmentLoad.snapshot;
      const matchStartedAt = performance.now();
      const resourceIndex = buildFeishuRecordIndex(
        resourceLoad.snapshot.records,
        resourceMapping,
      );
      const developmentIndex = buildFeishuRecordIndex(
        developmentLoad.snapshot.records,
        developmentMapping,
      );
      const patches = new Map<string, Partial<Prospect>>();
      for (const prospect of targets) {
        const resourceMatch = findFeishuRecordMatch(prospect, resourceIndex);
        const developmentMatch = findFeishuRecordMatch(prospect, developmentIndex);
        const resourceRecord = getMatchedRecord(resourceMatch);
        const developmentRecord = getMatchedRecord(developmentMatch);
        const resourceStatus = resourceMatch.kind === 'exact'
          ? 'exists'
          : resourceMatch.kind === 'suspected'
            ? 'suspected'
            : resourceMatch.kind === 'conflict'
              ? 'conflict'
              : 'missing';
        const developmentStatus = developmentMatch.kind === 'exact'
          ? 'history_exists'
          : developmentMatch.kind === 'suspected'
            ? 'suspected'
            : developmentMatch.kind === 'conflict'
              ? 'conflict'
              : 'missing';
        const hasConflict = resourceMatch.kind === 'conflict'
          || developmentMatch.kind === 'conflict';
        const hasSuspected = resourceMatch.kind === 'suspected'
          || developmentMatch.kind === 'suspected';
        const previousDevelopmentRecordId = developmentMatch.kind === 'exact'
          ? developmentMatch.record.record_id
          : undefined;
        const emailPatch = updateProspectEmailCandidates(
          prospectEmailSelectionState(prospect),
          [
            ...(resourceMatch.kind === 'exact'
              ? recordEmailCandidates(resourceRecord, resourceMapping, 'resource')
              : []),
            ...(developmentMatch.kind === 'exact'
              ? recordEmailCandidates(developmentRecord, developmentMapping, 'development')
              : []),
          ],
          { replaceSources: ['resource', 'development'] },
        );
        const reason = developmentMatch.kind === 'conflict'
          ? `开发记录匹配冲突：${developmentMatch.reason}，请先清理重复记录`
          : resourceMatch.kind === 'conflict'
            ? `资源库匹配冲突：${resourceMatch.reason}，请先清理重复记录`
            : developmentMatch.kind === 'exact'
              ? `发现历史开发记录：${developmentMatch.reason}；本轮将新建独立开发记录`
              : developmentMatch.kind === 'suspected'
                ? `开发记录疑似重复：${developmentMatch.reason}`
                : resourceMatch.kind === 'suspected'
                  ? `资源库疑似重复：${resourceMatch.reason}`
                  : resourceMatch.kind === 'exact'
                    ? `资源库已收录：${resourceMatch.reason}`
                    : '资源库未收录，可人工确认加入；不影响创建开发记录';
        patches.set(prospect.id, {
          ...emailPatch,
          workflowStatus: 'resolved',
          dedupeStatus: hasConflict
            ? 'conflict'
            : developmentMatch.kind === 'exact'
              ? 'duplicate'
              : hasSuspected
                ? 'suspected'
                : 'unique',
          resourceStatus,
          developmentStatus,
          resourceRecordId: resourceMatch.kind === 'exact' || resourceMatch.kind === 'suspected'
            ? resourceRecord?.record_id
            : undefined,
          feishuRecordId: undefined,
          previousDevelopmentRecordId,
          repeatOutreach: prospect.repeatOutreach || Boolean(previousDevelopmentRecordId),
          duplicateRecordId: developmentMatch.kind === 'suspected'
            ? developmentRecord?.record_id
            : resourceMatch.kind === 'suspected'
              ? resourceRecord?.record_id
              : undefined,
          resourceMatchPreview: resourceMatch.kind === 'suspected'
            ? buildResourceMatchPreview(resourceMatch.record, resourceMapping, resourceMatch.reason)
            : undefined,
          developmentMatchPreview: developmentMatch.kind === 'suspected'
            ? {
                recordId: developmentMatch.record.record_id,
                matchReason: developmentMatch.reason,
                email: developmentMapping.email
                  ? flattenFeishuValue(developmentMatch.record.fields[developmentMapping.email]).trim()
                  : '',
              }
            : undefined,
          duplicateReason: reason,
          duplicateConfirmedUnique: false,
          error: undefined,
          updatedAt: new Date().toISOString(),
        });
      }
      setProspects((current) => current.map((prospect) => {
        const patch = patches.get(prospect.id);
        return patch ? { ...prospect, ...patch } : prospect;
      }));
      const matchElapsedMs = Math.round(performance.now() - matchStartedAt);
      const totalElapsedMs = Math.round(performance.now() - totalStartedAt);
      if (options.showToast !== false) {
        toast.success(
          `双表查重完成 ${targets.length} 个：资源库 ${resourceLoad.elapsedMs}ms${resourceLoad.snapshot.cacheHit ? '（缓存）' : ''}，开发表 ${developmentLoad.elapsedMs}ms${developmentLoad.snapshot.cacheHit ? '（缓存）' : ''}，索引匹配 ${matchElapsedMs}ms，总计 ${totalElapsedMs}ms。`,
        );
      }
      return patches;
    } catch (error) {
      const message = error instanceof Error ? error.message : '飞书查重失败。';
      setProspects((current) => current.map((item) => (
        targetIds.has(item.id)
          ? {
              ...item,
              dedupeStatus: 'error',
              resourceStatus: 'error',
              developmentStatus: 'error',
              error: message,
              updatedAt: new Date().toISOString(),
            }
          : item
      )));
      toast.error(message);
      return null;
    } finally {
      setCheckingDedupe(false);
    }
  };

  const handleCheckDedupe = async (items: Prospect[]) => {
    await runDedupe(items, { showToast: true });
  };

  const openDevelopmentPreview = async (items: Prospect[]) => {
    if (hasPendingEmailSelection(items)) {
      toast.error('请先为提示“多个邮箱”的红人选择一个邮箱，再新建开发记录。');
      return;
    }
    setPreparingDevelopmentPreview(true);
    const targets = items.filter(canCreateFeishuRecord);
    if (!targets.length) {
      setPreparingDevelopmentPreview(false);
      toast.error('没有可创建的线索。请先完成识别和飞书查重，并排除重复记录。');
      return;
    }
    const mapping = settings.feishuProspectingFieldMapping || {};
    const resourceMapping = settings.feishuFieldMapping || {};
    const resourceUrl = settings.feishuUrl;
    let resourceIndex: ReturnType<typeof buildFeishuRecordIndex> | undefined;
    let resourceSnapshotError = '';
    if (resourceUrl && targets.some((prospect) => prospect.resourceRecordId)) {
      try {
        const loadedSnapshot = await loadDedupeSnapshot(
          resourceUrl,
          '红人信息数据库',
          resourceMapping,
        );
        resourceSnapshotRef.current = loadedSnapshot.snapshot;
        resourceIndex = buildFeishuRecordIndex(
          loadedSnapshot.snapshot.records,
          resourceMapping,
        );
      } catch (error) {
        resourceSnapshotError = error instanceof Error
          ? error.message
          : '资源库快照读取失败，本次只新建开发记录。';
      }
    }
    const previews = targets
      .map((prospect) => {
        const pendingSync = buildPendingResourceEmailSyncPreview(
          prospect,
          resourceMapping.email,
          resourceUrl,
        );
        const resourceEmailSync = pendingSync.status === 'checking'
          ? resourceSnapshotError
            ? { status: 'failed' as const, message: resourceSnapshotError }
            : buildResourceEmailSyncPreview(
                prospect,
                resourceIndex?.recordById.get(pendingSync.recordId),
                resourceMapping.email,
              )
          : pendingSync;
        return {
          prospect,
          target: 'development' as const,
          fields: buildDevelopmentFields({ ...prospect, workflowStatus: 'dedupe_completed' }, mapping),
          resourceEmailSync,
          writeStatus: 'pending' as const,
        };
      })
      .filter((item) => Object.keys(item.fields).length > 0);
    if (!previews.length) {
      setPreparingDevelopmentPreview(false);
      toast.error('没有可写入字段，请先检查“红人开发情况表”的字段映射。');
      return;
    }
    previewOperationIdRef.current = crypto.randomUUID();
    setPreviewItems(previews);
    setPreparingDevelopmentPreview(false);
  };

  const loadContentTypeOptions = async (fieldName?: string) => {
    if (!settings.feishuUrl || !fieldName) return [];
    const cacheKey = `${settings.feishuUrl}::${fieldName}`;
    const cached = resourceContentTypeCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const response = await fetch('/api/feishu/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: settings.feishuUrl, fieldsOnly: true }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(getErrorMessage(result, '读取飞书内容类型选项失败。'));
    }
    const fields = (result.data?.fields || []) as FeishuInspectField[];
    const field = fields.find((item) => item.field_name === fieldName);
    const rawOptions = field?.property?.options || field?.options || [];
    const options = rawOptions.map(extractFeishuOptionName).filter(Boolean);
    resourceContentTypeCacheRef.current.set(cacheKey, options);
    return options;
  };

  const classifyResourceContentTypes = async (
    prospect: Prospect,
    options: string[],
  ) => {
    const cacheKey = buildContentTypeAiCacheKey(prospect, options);
    if (resourceContentTypeAiCacheRef.current.has(cacheKey)) {
      return resourceContentTypeAiCacheRef.current.get(cacheKey) || [];
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          action: 'classifyCreatorContentTypes',
          allowedOptions: options,
          channel: {
            title: prospect.title || '',
            description: prospect.description || '',
            country: prospect.country || '',
            language: prospect.language || '',
            recentVideos: (prospect.recentVideos || []).slice(0, 8).map((video) => ({
              title: video.title || '',
              translatedTitle: video.translatedTitle || '',
            })),
          },
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result, 'AI 内容类型判断失败。'));
      }
      const allowedOptionSet = new Set(options);
      const rawSelectedOptions: unknown[] = Array.isArray(result.data?.selectedOptions)
        ? result.data.selectedOptions
        : [];
      const selectedOptions = rawSelectedOptions.length
        ? Array.from(new Set<string>(
            rawSelectedOptions
              .map((option) => String(option || '').trim())
              .filter((option) => allowedOptionSet.has(option)),
          )).slice(0, 3)
        : [];
      resourceContentTypeAiCacheRef.current.set(cacheKey, selectedOptions);
      return selectedOptions;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('AI 内容类型判断超时，请手动选择。');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const openResourcePreview = async (items: Prospect[]) => {
    if (hasPendingEmailSelection(items)) {
      toast.error('请先为提示“多个邮箱”的红人选择一个邮箱，再加入资源库。');
      return;
    }
    setPreparingResourcePreview(true);
    const targets = items.filter((item) => (
      item.resourceStatus === 'missing'
      && !item.resourceRecordId
    ));
    if (!targets.length) {
      setPreparingResourcePreview(false);
      toast.error('所选红人没有需要加入资源库的记录。');
      return;
    }
    const mapping = settings.feishuFieldMapping || {};
    const cacheKey = settings.feishuUrl && mapping.contentType
      ? `${settings.feishuUrl}::${mapping.contentType}`
      : '';
    const cachedOptions = cacheKey
      ? resourceContentTypeCacheRef.current.get(cacheKey)
      : undefined;
    const initialOptions = cachedOptions || [];
    const previews = targets
      .map((prospect) => ({
        prospect,
        target: 'resource' as const,
        fields: buildResourceFields(
          prospect,
          mapping,
          [],
        ),
      }))
      .filter((item) => Object.keys(item.fields).length > 0);
    if (!previews.length) {
      setPreparingResourcePreview(false);
      toast.error('没有可写入字段，请先检查“红人信息数据库”的字段映射。');
      return;
    }
    const runId = resourcePreviewRunRef.current + 1;
    resourcePreviewRunRef.current = runId;
    resourceContentTypeManualIdsRef.current.clear();
    setResourceContentTypeOptions(initialOptions);
    setResourceContentTypeAiStatus('idle');
    setResourceContentTypeStatus(
      cachedOptions
        ? 'ready'
        : settings.feishuUrl && mapping.contentType
          ? 'loading'
          : 'idle',
    );
    previewOperationIdRef.current = crypto.randomUUID();
    setPreviewItems(previews);
    setPreparingResourcePreview(false);

    const classifyAndApply = async (contentTypeOptions: string[]) => {
      if (!contentTypeOptions.length || !mapping.contentType) return;
      setResourceContentTypeAiStatus('loading');
      let successCount = 0;
      let failureCount = 0;
      let firstError = '';
      await mapWithConcurrency(targets, 3, async (prospect) => {
        try {
          const selectedOptions = await classifyResourceContentTypes(prospect, contentTypeOptions);
          if (runId !== resourcePreviewRunRef.current) return;
          successCount += 1;
          setPreviewItems((current) => current.map((item) => {
            if (
              item.prospect.id !== prospect.id
              || item.target !== 'resource'
              || resourceContentTypeManualIdsRef.current.has(prospect.id)
            ) {
              return item;
            }
            return {
              ...item,
              fields: {
                ...item.fields,
                [mapping.contentType!]: selectedOptions,
              },
            };
          }));
        } catch (error) {
          if (runId !== resourcePreviewRunRef.current) return;
          failureCount += 1;
          if (!firstError) {
            firstError = error instanceof Error ? error.message : 'AI 内容类型判断失败。';
          }
        }
      });
      if (runId !== resourcePreviewRunRef.current) return;
      setResourceContentTypeAiStatus(
        successCount
          ? failureCount
            ? 'partial'
            : 'ready'
          : 'error',
      );
      if (failureCount) {
        toast.warning(
          successCount
            ? `部分红人的 AI 内容类型判断未完成：${firstError}`
            : firstError,
        );
      }
    };

    if (cachedOptions) {
      void classifyAndApply(cachedOptions);
      return;
    }
    if (!settings.feishuUrl || !mapping.contentType) return;

    try {
      const contentTypeOptions = await loadContentTypeOptions(mapping.contentType);
      if (runId !== resourcePreviewRunRef.current) return;
      setResourceContentTypeOptions(contentTypeOptions);
      setResourceContentTypeStatus('ready');
      void classifyAndApply(contentTypeOptions);
    } catch (error) {
      if (runId !== resourcePreviewRunRef.current) return;
      setResourceContentTypeStatus('error');
      toast.warning(error instanceof Error ? error.message : '内容类型选项读取失败，请检查飞书字段配置。');
    }
  };

  const openQuickOnboardingPreview = async (items: Prospect[]) => {
    const targets = items.filter((item) => item.workflowStatus === 'resolved');
    if (!targets.length) {
      toast.error('请选择已经识别成功的红人。');
      return;
    }
    setPreparingQuickPreview(true);
    try {
      const patches = await runDedupe(targets, { showToast: false });
      if (!patches) throw new Error('双表查重未完成，快速建档已停止。');
      const refreshedTargets = targets.map((prospect) => ({
        ...prospect,
        ...(patches.get(prospect.id) || {}),
      }));
      if (hasPendingEmailSelection(refreshedTargets)) {
        throw new Error('发现多个候选邮箱，请先在邮箱框完成选择，再快速建档。');
      }
      const resourceMapping = settings.feishuFieldMapping || {};
      const developmentMapping = settings.feishuProspectingFieldMapping || {};
      const resourceSnapshot = resourceSnapshotRef.current;
      const resourceIndex = resourceSnapshot
        ? buildFeishuRecordIndex(resourceSnapshot.records, resourceMapping)
        : undefined;
      const previews = refreshedTargets.map((prospect): QuickOnboardingPreview => {
        const blockedReason = prospect.resourceStatus === 'conflict'
          || prospect.developmentStatus === 'conflict'
          ? prospect.duplicateReason || '飞书匹配到多条记录，请先清理冲突。'
          : prospect.resourceStatus === 'suspected'
            || prospect.developmentStatus === 'suspected'
            ? prospect.duplicateReason || '存在疑似重复记录，请先人工确认。'
            : undefined;
        const resourceAction = blockedReason
          ? 'blocked'
          : prospect.resourceStatus === 'missing' && !prospect.resourceRecordId
            ? 'create'
            : prospect.resourceStatus === 'exists'
              ? 'skip'
              : 'blocked';
        const developmentAction = blockedReason
          ? 'blocked'
          : ['missing', 'history_exists'].includes(prospect.developmentStatus)
            && !prospect.feishuRecordId
            ? 'create'
            : prospect.developmentStatus === 'exists' && prospect.feishuRecordId
              ? 'skip'
              : 'blocked';
        const pendingEmailSync = resourceAction === 'skip' && developmentAction === 'create'
          ? buildPendingResourceEmailSyncPreview(
              prospect,
              resourceMapping.email,
              settings.feishuUrl,
            )
          : undefined;
        const resourceEmailSync = pendingEmailSync?.status === 'checking'
          ? buildResourceEmailSyncPreview(
              prospect,
              resourceIndex?.recordById.get(pendingEmailSync.recordId),
              resourceMapping.email,
            )
          : pendingEmailSync;
        return {
          prospect,
          resourceAction,
          developmentAction,
          resourceFields: resourceAction === 'create'
            ? buildResourceFields(prospect, resourceMapping, [])
            : {},
          developmentFields: developmentAction === 'create'
            ? buildDevelopmentFields(
                { ...prospect, workflowStatus: 'dedupe_completed' },
                developmentMapping,
              )
            : {},
          resourceEmailSync,
          blockedReason,
          resourceStatus: resourceAction === 'create' ? 'pending' : undefined,
          developmentWriteStatus: developmentAction === 'create' ? 'pending' : undefined,
          emailSyncStatus: resourceEmailSync?.status === 'will_update' ? 'pending' : undefined,
        };
      });
      quickOperationIdRef.current = crypto.randomUUID();
      setQuickPreviewItems(previews);

      const resourceTargets = previews.filter((item) => item.resourceAction === 'create');
      if (!resourceTargets.length || !settings.feishuUrl || !resourceMapping.contentType) return;
      const runId = resourcePreviewRunRef.current + 1;
      resourcePreviewRunRef.current = runId;
      resourceContentTypeManualIdsRef.current.clear();
      const options = await loadContentTypeOptions(resourceMapping.contentType);
      if (runId !== resourcePreviewRunRef.current || !options.length) return;
      setResourceContentTypeOptions(options);
      setResourceContentTypeAiStatus('loading');
      let successCount = 0;
      let failureCount = 0;
      await mapWithConcurrency(resourceTargets, 3, async (item) => {
        try {
          const selectedOptions = await classifyResourceContentTypes(item.prospect, options);
          if (
            runId !== resourcePreviewRunRef.current
            || resourceContentTypeManualIdsRef.current.has(item.prospect.id)
          ) {
            return;
          }
          successCount += 1;
          setQuickPreviewItems((current) => current.map((preview) => (
            preview.prospect.id === item.prospect.id
              ? {
                  ...preview,
                  resourceFields: {
                    ...preview.resourceFields,
                    [resourceMapping.contentType!]: selectedOptions,
                  },
                }
              : preview
          )));
        } catch {
          failureCount += 1;
        }
      });
      if (runId === resourcePreviewRunRef.current) {
        setResourceContentTypeAiStatus(
          successCount ? (failureCount ? 'partial' : 'ready') : 'error',
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '快速建档预览准备失败。');
    } finally {
      setPreparingQuickPreview(false);
    }
  };

  const updateQuickResourceField = (
    prospectId: string,
    fieldName: string,
    value: unknown,
  ) => {
    if (fieldName === settings.feishuFieldMapping?.contentType) {
      resourceContentTypeManualIdsRef.current.add(prospectId);
    }
    setQuickPreviewItems((current) => current.map((item) => (
      item.prospect.id === prospectId
        ? {
            ...item,
            resourceFields: { ...item.resourceFields, [fieldName]: value },
          }
        : item
    )));
  };

  const closeQuickPreview = () => {
    resourcePreviewRunRef.current += 1;
    setQuickPreviewItems([]);
    setResourceContentTypeOptions([]);
    setResourceContentTypeAiStatus('idle');
    resourceContentTypeManualIdsRef.current.clear();
  };

  const confirmQuickOnboarding = async () => {
    if (!quickPreviewItems.length) return;
    if (!settings.feishuUrl || !settings.feishuProspectingUrl) {
      toast.error('请先连接红人信息数据库和红人开发情况表。');
      return;
    }
    let submittedQuickItems = quickPreviewItems;
    const submittedIds = submittedQuickItems.map((item) => item.prospect.id);
    if (!beginProspectWrite(submittedIds)) {
      toast.warning('所选红人已有飞书写入正在后台处理，请等待完成后再试。');
      return;
    }
    const snapshotsExpired = [resourceSnapshotRef.current, developmentSnapshotRef.current]
      .some((snapshot) => !snapshot || Date.now() - snapshot.fetchedAt >= FEISHU_RECORD_CACHE_TTL_MS);
    if (snapshotsExpired) {
      const patches = await runDedupe(
        submittedQuickItems.map((item) => item.prospect),
        { force: true, showToast: false },
      );
      if (!patches) {
        finishProspectWrite(submittedIds);
        toast.error('飞书快照刷新失败，本次没有执行快速建档。');
        return;
      }
      const refreshed = submittedQuickItems.map((item) => ({
        ...item.prospect,
        ...(patches.get(item.prospect.id) || {}),
      }));
      const validationChanges = new Map<string, string[]>();
      refreshed.forEach((prospect, index) => {
        const item = submittedQuickItems[index];
        const reasons = [
          ...(item.resourceAction === 'create'
            ? compareProspectWritePlan(item.prospect, prospect, 'resource')
            : []),
          ...(item.developmentAction === 'create'
            ? compareProspectWritePlan(item.prospect, prospect, 'development')
            : []),
        ];
        if (reasons.length) validationChanges.set(prospect.id, Array.from(new Set(reasons)));
      });
      if (!validationChanges.size) {
        const resourceMapping = settings.feishuFieldMapping || {};
        const resourceSnapshot = resourceSnapshotRef.current;
        const resourceIndex = resourceSnapshot
          ? buildFeishuRecordIndex(resourceSnapshot.records, resourceMapping)
          : undefined;
        submittedQuickItems = submittedQuickItems.map((item, index) => {
          const prospect = refreshed[index];
          if (item.developmentAction !== 'create' || item.resourceAction !== 'skip') {
            return { ...item, prospect };
          }
          const pending = buildPendingResourceEmailSyncPreview(
            prospect,
            resourceMapping.email,
            settings.feishuUrl,
          );
          const nextSync = pending.status === 'checking'
            ? buildResourceEmailSyncPreview(
                prospect,
                resourceIndex?.recordById.get(pending.recordId),
                resourceMapping.email,
              )
            : pending;
          const emailChange = compareEmailSyncPlan(item.resourceEmailSync, nextSync);
          if (emailChange.requiresConfirmation) {
            validationChanges.set(prospect.id, [
              ...(validationChanges.get(prospect.id) || []),
              emailChange.message,
            ]);
          }
          return { ...item, prospect, resourceEmailSync: nextSync };
        });
      }
      if (validationChanges.size) {
        finishProspectWrite(submittedIds);
        await openQuickOnboardingPreview(refreshed);
        setQuickPreviewItems((current) => current.map((item) => ({
          ...item,
          validationChanges: validationChanges.get(item.prospect.id),
        })));
        toast.warning(`有 ${validationChanges.size} 位红人的写入计划发生变化，请查看预览中的具体原因。`);
        return;
      }
    }

    resourcePreviewRunRef.current += 1;
    setQuickPreviewItems([]);
    toast.info(`已提交 ${submittedQuickItems.length} 个红人，正在后台快速建档。`);
    const operationId = quickOperationIdRef.current || crypto.randomUUID();
    const resourceItems = submittedQuickItems.filter((item) => (
      item.resourceAction === 'create' && item.resourceStatus !== 'success'
    ));
    const developmentItems = submittedQuickItems.filter((item) => (
      item.developmentAction === 'create' && item.developmentWriteStatus !== 'success'
    ));
    const [resourceOutcome, developmentOutcome] = await Promise.allSettled([
      requestFeishuBatch(
        'batchCreate',
        settings.feishuUrl,
        operationId,
        resourceItems.map((item) => ({
          clientId: item.prospect.id,
          fields: compactFeishuWriteFields(item.resourceFields),
        })),
      ),
      requestFeishuBatch(
        'batchCreate',
        settings.feishuProspectingUrl,
        operationId,
        developmentItems.map((item) => ({
          clientId: item.prospect.id,
          fields: compactFeishuWriteFields(item.developmentFields),
        })),
      ),
    ]);
    const failedOutcome = (outcome: PromiseSettledResult<FeishuBatchResult[]>) => (
      outcome.status === 'rejected'
        ? outcome.reason instanceof Error ? outcome.reason.message : '飞书批量写入失败。'
        : ''
    );
    const resourceResults: FeishuBatchResult[] = resourceOutcome.status === 'fulfilled'
      ? resourceOutcome.value
      : resourceItems.map((item) => ({
          clientId: item.prospect.id,
          status: 'failed' as const,
          error: failedOutcome(resourceOutcome),
        }));
    const developmentResults: FeishuBatchResult[] = developmentOutcome.status === 'fulfilled'
      ? developmentOutcome.value
      : developmentItems.map((item) => ({
          clientId: item.prospect.id,
          status: 'failed' as const,
          error: failedOutcome(developmentOutcome),
        }));
    const resourceSuccesses = new Map(
      resourceResults
        .filter((result) => result.status === 'success' && result.recordId)
        .map((result) => [result.clientId, result.recordId!]),
    );
    const developmentSuccesses = new Map(
      developmentResults
        .filter((result) => result.status === 'success' && result.recordId)
        .map((result) => [result.clientId, result.recordId!]),
    );
    if (resourceSuccesses.size) invalidateResourceSnapshot();
    if (developmentSuccesses.size) invalidateDevelopmentSnapshot();

    const emailItems = submittedQuickItems.filter((item) => (
      (developmentSuccesses.has(item.prospect.id) || item.developmentWriteStatus === 'success')
      && item.resourceAction === 'skip'
      && item.resourceEmailSync?.status === 'will_update'
      && item.emailSyncStatus !== 'success'
    ));
    let emailResults: FeishuBatchResult[] = [];
    if (emailItems.length) {
      try {
        emailResults = await requestFeishuBatch(
          'batchUpdate',
          settings.feishuUrl,
          `${operationId}:email`,
          emailItems.map((item) => {
            const sync = item.resourceEmailSync!;
            if (sync.status !== 'will_update') throw new Error('邮箱同步预览状态无效。');
            return {
              clientId: item.prospect.id,
              recordId: sync.recordId,
              fields: { [sync.fieldName]: sync.nextValue },
            };
          }),
        );
        if (emailResults.some((result) => result.status === 'success')) {
          invalidateResourceSnapshot();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '资源库邮箱同步失败。';
        emailResults = emailItems.map((item) => ({
          clientId: item.prospect.id,
          status: 'failed',
          error: message,
        }));
      }
    }

    setProspects((current) => current.map((prospect) => {
      const resourceRecordId = resourceSuccesses.get(prospect.id);
      const developmentRecordId = developmentSuccesses.get(prospect.id);
      if (!resourceRecordId && !developmentRecordId) return prospect;
      return {
        ...prospect,
        ...(resourceRecordId
          ? {
              resourceStatus: 'exists' as const,
              resourceRecordId,
            }
          : {}),
        ...(developmentRecordId
          ? {
              workflowStatus: 'dedupe_completed' as const,
              developmentStatus: 'exists' as const,
              feishuRecordId: developmentRecordId,
            }
          : {}),
        duplicateReason: developmentRecordId
          ? prospect.previousDevelopmentRecordId
            ? '快速建档已创建本轮开发记录，并保留历史开发记录关联'
            : '快速建档已创建红人开发记录'
          : prospect.duplicateReason,
        updatedAt: new Date().toISOString(),
      };
    }));

    const failedQuickItems = submittedQuickItems.map((item) => {
      const resourceResult = resourceResults.find((result) => result.clientId === item.prospect.id);
      const developmentResult = developmentResults.find((result) => result.clientId === item.prospect.id);
      const emailResult = emailResults.find((result) => result.clientId === item.prospect.id);
      return {
        ...item,
        resourceStatus: resourceResult
          ? resourceResult.status === 'success' ? 'success' : 'failed'
          : item.resourceStatus,
        developmentWriteStatus: developmentResult
          ? developmentResult.status === 'success' ? 'success' : 'failed'
          : item.developmentWriteStatus,
        resourceError: resourceResult?.status === 'failed' ? resourceResult.error : undefined,
        developmentError: developmentResult?.status === 'failed' ? developmentResult.error : undefined,
        emailSyncError: emailResult?.status === 'failed' ? emailResult.error : undefined,
        emailSyncStatus: emailResult
          ? emailResult.status === 'success' ? 'success' : 'failed'
          : item.emailSyncStatus,
      };
    }).filter((item) => (
      item.resourceStatus === 'failed'
      || item.developmentWriteStatus === 'failed'
      || item.emailSyncStatus === 'failed'
    ));
    setQuickPreviewItems(failedQuickItems);
    setWritingFeishu(false);
    finishProspectWrite(submittedIds);

    const failureCount = [...resourceResults, ...developmentResults, ...emailResults]
      .filter((result) => result.status === 'failed').length;
    if (failureCount) {
      toast.warning(`快速建档已保留成功结果，仍有 ${failureCount} 项失败；失败项已重新打开。`);
    } else {
      toast.success(`快速建档完成：资源记录 ${resourceSuccesses.size} 条，开发记录 ${developmentSuccesses.size} 条。`);
      closeQuickPreview();
    }
  };

  const confirmWriteFeishu = async () => {
    if (!previewItems.length) return;
    if (previewItems.some((item) => item.resourceEmailSync?.status === 'checking')) {
      toast.warning('资源库邮箱同步还在检查中，请稍等几秒再确认。');
      return;
    }
    const actionablePreviewItems = previewItems.filter((item) => !item.validationBlocked);
    if (!actionablePreviewItems.length) {
      toast.error('当前预览中的记录已经被飞书最新数据阻止，不能重复创建。');
      return;
    }
    const target = actionablePreviewItems[0].target;
    const targetUrl = target === 'resource' ? settings.feishuUrl : settings.feishuProspectingUrl;
    if (!targetUrl) return;

    let submittedItems = actionablePreviewItems;
    const submittedIds = submittedItems.map((item) => item.prospect.id);
    if (!beginProspectWrite(submittedIds)) {
      toast.warning('所选红人已有飞书写入正在后台处理，请等待完成后再试。');
      return;
    }
    const operationId = previewOperationIdRef.current || crypto.randomUUID();
    resourcePreviewRunRef.current += 1;
    setPreviewItems([]);
    toast.info(`已提交 ${submittedItems.length} 条记录，正在后台检查并写入飞书。`);

    // 先让 React 完成弹窗关闭与页面解锁，再开始可能较慢的飞书快照刷新。
    await new Promise<void>((resolve) => {
      let settled = false;
      const release = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      window.requestAnimationFrame(release);
      window.setTimeout(release, 50);
    });

    const relevantSnapshots = target === 'resource'
      ? [resourceSnapshotRef.current]
      : [developmentSnapshotRef.current, resourceSnapshotRef.current];
    const snapshotExpired = relevantSnapshots.some((snapshot) => (
      !snapshot || Date.now() - snapshot.fetchedAt >= FEISHU_RECORD_CACHE_TTL_MS
    ));
    if (snapshotExpired) {
      const patches = await runDedupe(
        submittedItems.map((item) => item.prospect),
        { force: true, showToast: false },
      );
      if (!patches) {
        finishProspectWrite(submittedIds);
        setPreviewItems(submittedItems);
        setWritingFeishu(false);
        toast.error('飞书快照刷新失败，本次没有执行写入；原预览已恢复。');
        return;
      }
      const refreshedProspects = submittedItems.map((item) => ({
        ...item.prospect,
        ...(patches.get(item.prospect.id) || {}),
      }));
      const validationChanges = new Map<string, string[]>();
      refreshedProspects.forEach((prospect, index) => {
        const reasons = compareProspectWritePlan(
          submittedItems[index].prospect,
          prospect,
          target,
        );
        if (reasons.length) validationChanges.set(prospect.id, reasons);
      });
      if (target === 'development') {
        const resourceMapping = settings.feishuFieldMapping || {};
        const resourceSnapshot = resourceSnapshotRef.current;
        const resourceIndex = resourceSnapshot
          ? buildFeishuRecordIndex(resourceSnapshot.records, resourceMapping)
          : undefined;
        const refreshedPreviewItems = submittedItems.map((item, index) => {
          const prospect = refreshedProspects[index];
          const pending = buildPendingResourceEmailSyncPreview(
            prospect,
            resourceMapping.email,
            settings.feishuUrl,
          );
          const nextSync = pending.status === 'checking'
            ? buildResourceEmailSyncPreview(
                prospect,
                resourceIndex?.recordById.get(pending.recordId),
                resourceMapping.email,
              )
            : pending;
          const emailChange = compareEmailSyncPlan(item.resourceEmailSync, nextSync);
          if (emailChange.requiresConfirmation) {
            validationChanges.set(prospect.id, [
              ...(validationChanges.get(prospect.id) || []),
              emailChange.message,
            ]);
          }
          return { ...item, prospect, resourceEmailSync: nextSync };
        });
        submittedItems = refreshedPreviewItems;
      }
      if (validationChanges.size) {
        finishProspectWrite(submittedIds);
        setWritingFeishu(false);
        previewOperationIdRef.current = crypto.randomUUID();
        setPreviewItems(submittedItems.map((item, index) => ({
          ...item,
          prospect: refreshedProspects[index],
          validationChanges: validationChanges.get(item.prospect.id),
          validationBlocked: isProspectWriteBlocked(refreshedProspects[index], target),
        })));
        toast.warning(`有 ${validationChanges.size} 位红人的写入计划发生变化，请查看预览中的具体原因。`);
        return;
      }
    }

    const activeItems = submittedItems.filter((item) => item.writeStatus !== 'success');
    const successes: Array<{ id: string; recordId: string }> = [];
    const failures: Array<{ id: string; error: string }> = [];
    const resourceEmailFailures: Array<{ id: string; error: string }> = [];
    let resourceEmailSyncCount = 0;
    try {
      const results = await requestFeishuBatch(
        'batchCreate',
        targetUrl,
        operationId,
        activeItems.map((item) => ({
          clientId: item.prospect.id,
          fields: compactFeishuWriteFields(item.fields),
        })),
      );
      for (const item of activeItems) {
        const result = results.find((entry) => entry.clientId === item.prospect.id);
        if (result?.status === 'success' && result.recordId) {
          successes.push({ id: item.prospect.id, recordId: result.recordId });
        } else {
          failures.push({
            id: item.prospect.id,
            error: result?.error || '飞书未返回该记录的创建结果。',
          });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '飞书批量写入失败。';
      activeItems.forEach((item) => failures.push({ id: item.prospect.id, error: message }));
    }

    if (successes.length) {
      if (target === 'resource') invalidateResourceSnapshot();
      else invalidateDevelopmentSnapshot();
    }
    if (target === 'development' && settings.feishuUrl) {
      const successIds = new Set(successes.map((item) => item.id));
      const emailSyncItems = submittedItems.filter((item) => (
        (successIds.has(item.prospect.id) || item.writeStatus === 'success')
        && item.resourceEmailSync?.status === 'will_update'
      ));
      if (emailSyncItems.length) {
        try {
          const syncResults = await requestFeishuBatch(
            'batchUpdate',
            settings.feishuUrl,
            `${operationId}:email`,
            emailSyncItems.map((item) => {
              const sync = item.resourceEmailSync!;
              if (sync.status !== 'will_update') throw new Error('邮箱同步预览状态无效。');
              return {
                clientId: item.prospect.id,
                recordId: sync.recordId,
                fields: { [sync.fieldName]: sync.nextValue },
              };
            }),
          );
          for (const item of emailSyncItems) {
            const result = syncResults.find((entry) => entry.clientId === item.prospect.id);
            if (result?.status === 'success') {
              resourceEmailSyncCount += 1;
            } else {
              resourceEmailFailures.push(
                {
                  id: item.prospect.id,
                  error: `${item.prospect.title || item.prospect.inputUrl}：${result?.error || '资源库邮箱同步失败'}`,
                },
              );
            }
          }
          if (resourceEmailSyncCount) invalidateResourceSnapshot();
        } catch (error) {
          const message = error instanceof Error ? error.message : '资源库邮箱同步失败';
          emailSyncItems.forEach((item) => {
            resourceEmailFailures.push({
              id: item.prospect.id,
              error: `${item.prospect.title || item.prospect.inputUrl}：${message}`,
            });
          });
        }
      }
    }

    setProspects((current) => current.map((item) => {
      const success = successes.find((entry) => entry.id === item.id);
      return success
        ? {
            ...item,
            ...(target === 'resource'
              ? {
                  resourceStatus: 'exists' as const,
                  resourceRecordId: success.recordId,
                  duplicateReason: '已由用户确认加入红人资源库',
                }
              : {
                  workflowStatus: 'dedupe_completed' as const,
                  developmentStatus: 'exists' as const,
                  feishuRecordId: success.recordId,
                  duplicateReason: item.previousDevelopmentRecordId
                    ? '已新建本轮开发记录，并保留历史开发记录关联'
                    : '已新建红人开发记录',
                }),
            updatedAt: new Date().toISOString(),
          }
        : item;
    }));
    const failureById = new Map(failures.map((failure) => [failure.id, failure.error]));
    const emailFailureById = new Map(
      resourceEmailFailures.map((failure) => [failure.id, failure.error]),
    );
    const successById = new Map(successes.map((success) => [success.id, success.recordId]));
    const failedItems: FeishuWritePreview[] = [];
    for (const item of submittedItems) {
      const error = failureById.get(item.prospect.id);
      if (error) {
        failedItems.push({ ...item, writeStatus: 'failed', writeError: error });
        continue;
      }
      const emailError = emailFailureById.get(item.prospect.id);
      if (!emailError) continue;
      const recordId = successById.get(item.prospect.id);
      failedItems.push({
        ...item,
        prospect: recordId
          ? {
              ...item.prospect,
              workflowStatus: 'dedupe_completed' as const,
              developmentStatus: 'exists' as const,
              feishuRecordId: recordId,
            }
          : item.prospect,
        writeStatus: 'success' as const,
        writeError: `开发记录已创建；${emailError}`,
      });
    }
    setPreviewItems(failedItems);
    if (!failedItems.length) {
      setResourceContentTypeOptions([]);
      setResourceContentTypeStatus('idle');
    }
    setWritingFeishu(false);
    finishProspectWrite(submittedIds);
    if (failures.length) {
      toast.error(`已创建 ${successes.length} 个，失败 ${failures.length} 个。${failures[0].error}`);
    } else if (resourceEmailFailures.length) {
      toast.warning(`开发记录已创建 ${successes.length} 条，但资源库邮箱同步失败 ${resourceEmailFailures.length} 条；失败项已重新打开。${resourceEmailFailures[0].error}`);
    } else {
      toast.success(
        target === 'resource'
          ? `已在红人资源库新增 ${successes.length} 条记录。`
          : `已在红人开发情况表新增 ${successes.length} 条开发记录${resourceEmailSyncCount ? `，并同步补全 ${resourceEmailSyncCount} 条资源库邮箱` : ''}。`,
      );
    }
  };

  const updatePreviewField = (prospectId: string, fieldName: string, value: unknown) => {
    if (fieldName === settings.feishuFieldMapping?.contentType) {
      resourceContentTypeManualIdsRef.current.add(prospectId);
    }
    setPreviewItems((current) => current.map((item) => (
      item.prospect.id === prospectId
        ? {
            ...item,
            fields: {
              ...item.fields,
              [fieldName]: value,
            },
          }
        : item
    )));
  };

  const closeWritePreview = () => {
    resourcePreviewRunRef.current += 1;
    setPreviewItems([]);
    setResourceContentTypeOptions([]);
    setResourceContentTypeStatus('idle');
    setResourceContentTypeAiStatus('idle');
    resourceContentTypeManualIdsRef.current.clear();
  };

  const handleConfirmInvitation = async (items: Prospect[]) => {
    if (hasPendingEmailSelection(items)) {
      toast.error('请先完成邮箱选择，再进入邀约确认。');
      return;
    }
    const targets = items.filter((item) => item.workflowStatus === 'dedupe_completed' && item.feishuRecordId);
    if (!targets.length) {
      toast.error('请选择已在飞书新建记录的线索。');
      return;
    }
    if (targets.length > 1 && !window.confirm(`确认将 ${targets.length} 个红人移入“邀约确认”吗？`)) return;
    const ids = new Set(targets.map((item) => item.id));
    const submittedIds = Array.from(ids);
    if (!beginProspectWrite(submittedIds)) {
      toast.warning('所选红人已有飞书写入正在后台处理，请等待完成后再提交下一阶段。');
      return;
    }
    setProspects((current) => current.map((item) => (
      ids.has(item.id)
        ? { ...item, workflowStatus: 'invitation_pending', priority: item.priority || 'medium', updatedAt: new Date().toISOString() }
        : item
    )));
    setSelectedIds((current) => current.filter((id) => !ids.has(id)));
    setActiveTab('invitation');
    if (!settings.feishuProspectingUrl) {
      finishProspectWrite(submittedIds);
      toast.warning(`已将 ${targets.length} 个红人移入邀约确认；未连接飞书，状态仅保存在本地。`);
      return;
    }
    try {
      const mapping = settings.feishuProspectingFieldMapping || {};
      const syncItems = targets.flatMap((prospect) => {
        const fields = buildDevelopmentSyncFields(
          { ...prospect, workflowStatus: 'invitation_pending' },
          mapping,
        );
        return prospect.feishuRecordId && Object.keys(fields).length
          ? [{
              clientId: prospect.id,
              recordId: prospect.feishuRecordId,
              fields,
            }]
          : [];
      });
      const results = await requestFeishuBatch(
        'batchUpdate',
        settings.feishuProspectingUrl,
        crypto.randomUUID(),
        syncItems,
      );
      const failedById = new Map(
        results
          .filter((result) => result.status === 'failed')
          .map((result) => [result.clientId, result.error || '飞书状态同步失败。']),
      );
      setProspects((current) => current.map((item) => (
        ids.has(item.id)
          ? { ...item, syncError: failedById.get(item.id) }
          : item
      )));
      if (results.some((result) => result.status === 'success')) {
        invalidateDevelopmentSnapshot();
      }
      if (failedById.size) {
        toast.warning(`已切换到邀约确认；${failedById.size} 条飞书状态同步失败，可稍后重试。`);
      } else {
        toast.success(`已将 ${targets.length} 个红人移入邀约确认。`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '飞书状态同步失败。';
      setProspects((current) => current.map((item) => (
        ids.has(item.id) ? { ...item, syncError: message } : item
      )));
      toast.warning(`已切换到邀约确认；飞书状态同步失败，可稍后重试。${message}`);
    } finally {
      finishProspectWrite(submittedIds);
    }
  };

  const handleSaveInvitation = async (prospect: Prospect) => {
    updateProspect(prospect.id, {
      emailStatus: prospect.publicEmail?.trim() ? prospect.emailStatus === 'available' ? 'available' : 'manual' : 'missing',
    });
    const synced = await syncFeishuProspect(prospect);
    toast[ synced ? 'success' : 'warning' ](synced ? '邀约方向已保存。' : '邀约方向已保存在本地，飞书同步失败，可稍后重试。');
  };

  const handleConfirmOutreach = async (prospect: Prospect) => {
    if (
      !prospect.targetProduct?.trim()
      || !prospect.cooperationType?.trim()
      || !prospect.cooperationIdea?.trim()
      || !prospect.outreachLanguage?.trim()
    ) {
      toast.error('请先确认目标产品、合作形式、开发信语言和合作想法。');
      return;
    }
    const nextProspect: Prospect = { ...prospect, workflowStatus: 'outreach_pending' };
    updateProspect(prospect.id, { workflowStatus: 'outreach_pending', error: undefined });
    setActiveTab('outreach');
    toast.success('邀约方向已确认，正在生成开发信。');
    void syncFeishuProspect(prospect, { workflowStatus: 'outreach_pending' });
    void handleGenerateOutreach(nextProspect);
  };

  const handleCheckHistory = async (prospect: Prospect) => {
    if (!auth?.accessToken || !prospect.publicEmail) {
      toast.error('请先连接 Gmail 并补充邮箱。');
      return;
    }
    setCheckingHistoryId(prospect.id);
    try {
      const response = await fetch('/api/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'contactHistory',
          accessToken: auth.accessToken,
          contactEmail: prospect.publicEmail,
          maxResults: 20,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(getErrorMessage(result, 'Gmail 历史检查失败。'));
      const messages = Array.isArray(result.data) ? result.data : [];
      updateProspect(prospect.id, { contactedBefore: messages.length > 0, historyChecked: true });
      toast.success(messages.length ? `找到 ${messages.length} 封历史邮件。` : '没有找到该邮箱的历史邮件。');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Gmail 历史检查失败。');
    } finally {
      setCheckingHistoryId(null);
    }
  };

  const handleGenerateOutreach = (prospect: Prospect) => {
    if (
      !prospect.targetProduct
      || !prospect.cooperationType
      || !prospect.cooperationIdea
      || !prospect.outreachLanguage
    ) {
      toast.error('请先返回邀约确认，补齐产品、合作形式、开发信语言和合作想法。');
      return;
    }
    const outreachContext = stripOutreachPreviewData(getOutreachContext(prospect));
    const requestBody = {
      action: 'outreach',
      ...outreachContext,
      outreachPrompt: settings.aiOutreachPrompt,
      modelProvider: settings.modelProvider,
      customApiUrl: settings.customApiUrl,
      customApiKey: settings.customApiKey,
      customModelName: settings.customModelName,
    };
    const generateOneShot = async (signal: AbortSignal) => {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(requestBody),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(getErrorMessage(result, '开发信生成失败。'));
      return result.data as OutreachDraft;
    };
    enqueueTask({
      key: buildOutreachEmailGenerationTaskKey(prospect.id),
      kind: 'outreach_email',
      title: prospect.title || '该频道',
      description: '开发信生成',
      avatarUrl: prospect.avatarUrl,
      navigation: {
        view: 'prospecting',
        prospectId: prospect.id,
      },
      initialStage: '等待生成',
      run: async ({ signal, report }) => {
        setGeneratingId(prospect.id);
        report('正在准备开发信上下文');
        updateProspect(prospect.id, {
      aiDraft: {
        subject: '',
        body: '',
        translatedBody: '',
        translatedSummary: '',
        personalizationNotes: [],
        riskNotes: [],
        missingInfo: [],
      },
      streamingBody: '',
      outreachGenerationStage: 'preparing',
      generationError: undefined,
      error: undefined,
        });
        let streamUiTimeout: number | undefined;
        try {
      const response = await fetch('/api/ai/outreach-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(requestBody),
      });
      if (!response.ok || !response.body) throw new Error('流式生成暂不可用，正在切换到普通生成。');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedBody = '';
      let pendingStreamingBody = '';
      let lastStreamUiAt = 0;
      const finalDraftRef: { current?: OutreachDraft } = {};
      let streamError = '';

      const handleStreamEvent = (event: OutreachStreamEvent) => {
        if (event.event === 'stage' && event.data.stage) {
          updateProspect(prospect.id, { outreachGenerationStage: event.data.stage });
          report(event.data.stage === 'finalizing'
            ? '正在整理标题和中文翻译'
            : '正在生成开发信');
        }
        if (event.event === 'delta') {
          const text = event.data.text || '';
          if (!text) return;
          streamedBody += text;
          const cleanStreamingBody = stripConfiguredEmailSignature(
            sanitizeOutreachEmailBody(streamedBody),
            settings.emailSignature,
          );
          pendingStreamingBody = cleanStreamingBody;
          const flushStreamUi = () => {
            streamUiTimeout = undefined;
            lastStreamUiAt = performance.now();
            updateProspect(prospect.id, {
              streamingBody: pendingStreamingBody,
              outreachGenerationStage: 'streaming_body',
              aiDraft: {
                subject: '',
                body: pendingStreamingBody,
                translatedBody: '',
                translatedSummary: '',
                personalizationNotes: [],
                riskNotes: [],
                missingInfo: [],
              },
            });
            report('正在生成开发信正文');
          };
          const elapsed = performance.now() - lastStreamUiAt;
          if (elapsed >= 80) {
            if (streamUiTimeout) window.clearTimeout(streamUiTimeout);
            flushStreamUi();
          } else if (!streamUiTimeout) {
            streamUiTimeout = window.setTimeout(flushStreamUi, 80 - elapsed);
          }
        }
        if (event.event === 'final') {
          finalDraftRef.current = event.data;
        }
        if (event.event === 'error') {
          streamError = event.data.message || '流式生成失败。';
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseOutreachStreamEvents(buffer);
        buffer = parsed.rest;
        parsed.events.forEach(handleStreamEvent);
      }
      const parsed = parseOutreachStreamEvents(`${buffer}\n\n`);
      parsed.events.forEach(handleStreamEvent);

      if (streamError) throw new Error(streamError);
      const completedDraft = finalDraftRef.current;
      if (!completedDraft) throw new Error('流式生成未返回完整草稿。');

      const draft: OutreachDraft = {
        ...completedDraft,
        body: stripConfiguredEmailSignature(
          sanitizeOutreachEmailBody(completedDraft.body || streamedBody),
          settings.emailSignature,
        ),
      };
      if (streamUiTimeout) {
        window.clearTimeout(streamUiTimeout);
        streamUiTimeout = undefined;
      }
      updateProspect(prospect.id, {
        aiDraft: draft,
        workflowStatus: 'outreach_generated',
        outreachGenerationStage: 'completed',
        streamingBody: undefined,
        generationError: undefined,
        error: undefined,
      });
      await syncFeishuProspect(
        prospect,
        { workflowStatus: 'outreach_generated', aiDraft: draft },
        signal,
      );
      return { prospectId: prospect.id, draft };
    } catch (error) {
      if (streamUiTimeout) {
        window.clearTimeout(streamUiTimeout);
        streamUiTimeout = undefined;
      }
      if (signal.aborted) return undefined;
      try {
        updateProspect(prospect.id, { outreachGenerationStage: 'finalizing' });
        report('流式生成不可用，正在使用兼容模式');
        const generatedDraft = await generateOneShot(signal);
        const draft: OutreachDraft = {
          ...generatedDraft,
          body: stripConfiguredEmailSignature(
            sanitizeOutreachEmailBody(generatedDraft.body),
            settings.emailSignature,
          ),
        };
        updateProspect(prospect.id, {
          aiDraft: draft,
          workflowStatus: 'outreach_generated',
          outreachGenerationStage: 'completed',
          streamingBody: undefined,
          generationError: undefined,
          error: undefined,
        });
        await syncFeishuProspect(
          prospect,
          { workflowStatus: 'outreach_generated', aiDraft: draft },
          signal,
        );
        return { prospectId: prospect.id, draft };
      } catch (fallbackError) {
        if (signal.aborted) return undefined;
        const message = fallbackError instanceof Error
          ? fallbackError.message
          : error instanceof Error
            ? error.message
            : '开发信生成失败。';
        updateProspect(prospect.id, {
          outreachGenerationStage: 'error',
          generationError: message,
          error: message,
        });
        throw fallbackError;
      }
    } finally {
      setGeneratingId((current) => current === prospect.id ? null : current);
    }
      },
    });
  };

  const handleRegenerateOutreachPart = async (prospect: Prospect, part: 'subject' | 'body') => {
    if (!prospect.aiDraft) {
      toast.error('请先生成开发信，再单独重新生成标题或正文。');
      return;
    }
    if (
      !prospect.targetProduct
      || !prospect.cooperationType
      || !prospect.cooperationIdea
      || !prospect.outreachLanguage
    ) {
      toast.error('请先返回邀约确认，补齐产品、合作形式、开发信语言和合作想法。');
      return;
    }
    setRegeneratingDraftPart({ id: prospect.id, part });
    try {
      const outreachContext = stripOutreachPreviewData(getOutreachContext(prospect));
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'outreach',
          ...outreachContext,
          outreachPrompt: settings.aiOutreachPrompt,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result, part === 'subject' ? '邮件标题重新生成失败。' : '邮件正文重新生成失败。'));
      }
      const nextDraft = result.data as OutreachDraft;
      const currentDraft = prospect.aiDraft;
      const mergedDraft: OutreachDraft = part === 'subject'
        ? {
            ...currentDraft,
            subject: nextDraft.subject || currentDraft.subject,
            subjectOptions: nextDraft.subjectOptions?.length ? nextDraft.subjectOptions : currentDraft.subjectOptions,
          }
        : {
            ...currentDraft,
            body: nextDraft.body || currentDraft.body,
            translatedBody: nextDraft.translatedBody || nextDraft.translatedSummary || currentDraft.translatedBody,
            translatedSummary: nextDraft.translatedSummary || currentDraft.translatedSummary,
            personalizationNotes: nextDraft.personalizationNotes || currentDraft.personalizationNotes,
            riskNotes: nextDraft.riskNotes || currentDraft.riskNotes,
            missingInfo: nextDraft.missingInfo || currentDraft.missingInfo,
            language: nextDraft.language || currentDraft.language,
            tone: nextDraft.tone || currentDraft.tone,
          };
      const patch: Partial<Prospect> = {
        aiDraft: mergedDraft,
        workflowStatus: 'outreach_generated',
        error: undefined,
      };
      updateProspect(prospect.id, patch);
      await syncFeishuProspect(prospect, patch);
      toast.success(part === 'subject' ? '邮件标题已重新生成，正文未变动。' : '邮件正文已重新生成，标题未变动。');
    } catch (error) {
      updateProspect(prospect.id, { error: error instanceof Error ? error.message : '开发信局部重新生成失败。' });
      toast.error(error instanceof Error ? error.message : '开发信局部重新生成失败。');
    } finally {
      setRegeneratingDraftPart(null);
    }
  };

  const handleTranslateEditedOutreach = async (prospectId: string, chineseBody: string) => {
    const normalizedChineseBody = chineseBody.trim();
    const prospect = prospectsRef.current.find((item) => item.id === prospectId);
    if (!prospect?.aiDraft || !normalizedChineseBody) {
      toast.error('中文邮件内容为空，无法自动更新外文正文。');
      return false;
    }

    const targetLang = prospect.outreachLanguage || prospect.aiDraft.language || prospect.language || 'en';
    const runId = (outreachChineseTranslationRunRef.current.get(prospectId) || 0) + 1;
    outreachChineseTranslationRunRef.current.set(prospectId, runId);

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'translateEditedReply',
          editedChineseReply: normalizedChineseBody,
          targetLang,
          targetLangName: outreachLanguageLabel(targetLang),
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result, '中文邮件自动翻译失败。'));
      }

      const latestProspect = prospectsRef.current.find((item) => item.id === prospectId);
      if (
        outreachChineseTranslationRunRef.current.get(prospectId) !== runId
        || latestProspect?.aiDraft?.translatedBody?.trim() !== normalizedChineseBody
      ) {
        return false;
      }

      const translatedBody = sanitizeOutreachEmailBody(result.data?.suggestedReply);
      if (!translatedBody) throw new Error('AI 没有返回可用的外文正文。');
      updateProspect(prospectId, {
        aiDraft: {
          ...latestProspect.aiDraft,
          body: translatedBody,
        },
        error: undefined,
      });
      toast.success(`已根据中文修改更新为${outreachLanguageLabel(targetLang)}开发信。`);
      return true;
    } catch (error) {
      if (outreachChineseTranslationRunRef.current.get(prospectId) === runId) {
        toast.error(error instanceof Error ? error.message : '中文邮件自动翻译失败。');
      }
      return false;
    }
  };

  const handleSaveGmailDraft = async (prospect: Prospect) => {
    if (!auth?.accessToken) {
      toast.error('请先连接 Gmail，再保存草稿。');
      return;
    }
    if (!prospect.publicEmail?.trim()) {
      toast.error('邮箱缺失，不能创建 Gmail 草稿。');
      return;
    }
    if (!prospect.aiDraft?.subject.trim() || !prospect.aiDraft.body.trim()) {
      toast.error('请先生成并确认开发信内容。');
      return;
    }
    const sanitizedBody = stripConfiguredEmailSignature(
      sanitizeOutreachEmailBody(prospect.aiDraft.body),
      settings.emailSignature,
    );
    const draft: OutreachDraft = {
      ...prospect.aiDraft,
      body: sanitizedBody,
    };
    const emailSignature = getEmailSignatureForContext(
      settings.emailSignature,
      settings.emailSignatureScope,
      'outreach',
    );
    if (sanitizedBody !== prospect.aiDraft.body) {
      updateProspect(prospect.id, { aiDraft: draft });
    }
    setSavingDraftId(prospect.id);
    try {
      const productAsset = selectedProductEmailAsset(products, prospect.targetProduct);
      const inlineProductImage = draft.productImageIncluded === false
        ? undefined
        : getProductInlineImage(productAsset);
      const renderedBodyHtml = buildOutreachEmailHtml({
        body: draft.body,
        product: productAsset,
        imageSrc: inlineProductImage ? `cid:${inlineProductImage.contentId}` : undefined,
        imagePlacement: draft.productImagePlacement,
        includeImage: Boolean(inlineProductImage),
      });
      const createGmailDraft = async (accessToken: string) => {
        const response = await fetch('/api/gmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'draft',
            accessToken,
            to: prospect.publicEmail,
            subject: draft.subject,
            body: applyPlainTextEmailSignature(draft.body, emailSignature),
            bodyHtml: appendEmailSignature(renderedBodyHtml, emailSignature),
            inlineImages: inlineProductImage ? [inlineProductImage] : [],
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          const message = getErrorMessage(result, '保存 Gmail 草稿失败。');
          const draftError = new Error(`${response.status} ${message}`);
          throw draftError;
        }
        return result;
      };
      let result;
      try {
        result = await createGmailDraft(auth.accessToken);
      } catch (error) {
        if (!isGmailAuthError(error)) throw error;
        toast.info('Gmail 授权已过期，正在自动刷新后重试。');
        const refreshResponse = await fetch('/api/auth/refresh?force=1', { method: 'POST' });
        const refreshResult = await refreshResponse.json();
        if (!refreshResponse.ok || !refreshResult.success || !refreshResult.data?.accessToken) {
          throw new Error('Gmail 授权已失效，请到“设置 > Gmail 邮件”重新连接 Gmail。');
        }
        const freshAuth = refreshResult.data as GmailAuth;
        connect(freshAuth);
        result = await createGmailDraft(freshAuth.accessToken || '');
      }
      if (!result.success) throw new Error('保存 Gmail 草稿失败。');
      const gmailDraftId = String(result.data?.id || result.data?.message?.id || '');
      const patch: Partial<Prospect> = {
        workflowStatus: 'gmail_draft_saved',
        gmailDraftId,
        error: undefined,
      };
      updateProspect(prospect.id, patch);
      const synced = await syncFeishuProspect(prospect, patch);
      const firstOutreachResult = await writeFirstOutreachSent(prospect, patch);
      if (firstOutreachResult.success) {
        toast.success(
          `红人 ${prospect.title || '该红人'} 的开发信已保存到 Gmail 草稿箱，并已在飞书双表标记为“已发”。请前往 Gmail 手动检查和发送。`,
        );
      } else {
        toast.warning(
          `Gmail 草稿已保存，但飞书“已发”标记失败：${firstOutreachResult.error || (synced ? '未知原因' : '飞书状态同步失败')}。邮件没有被自动发送。`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存 Gmail 草稿失败。');
    } finally {
      setSavingDraftId(null);
    }
  };

  const handleBackToImport = async (prospect: Prospect) => {
    updateProspect(prospect.id, { workflowStatus: 'dedupe_completed' });
    await syncFeishuProspect(prospect, { workflowStatus: 'dedupe_completed' });
    setActiveTab('import');
  };

  const handleBackToInvitation = async (prospect: Prospect) => {
    updateProspect(prospect.id, { workflowStatus: 'invitation_pending' });
    await syncFeishuProspect(prospect, { workflowStatus: 'invitation_pending' });
    setActiveTab('invitation');
  };

  const handleSkip = async (prospect: Prospect) => {
    if (!window.confirm(`确认跳过 ${prospect.title || '该红人'} 吗？`)) return;
    updateProspect(prospect.id, { workflowStatus: 'skipped' });
    await syncFeishuProspect(prospect, { workflowStatus: 'skipped' });
    toast.success('已标记为跳过。');
  };

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleRemoveProspects = async (ids: string[]) => {
    if (deletingProspects) return;
    const uniqueIds = Array.from(new Set(ids)).filter((id) => prospects.some((item) => item.id === id));
    if (!uniqueIds.length) return;

    setDeletingProspects(true);
    rememberDeletedProspects(uniqueIds);
    setProspects((current) => current.filter((item) => !uniqueIds.includes(item.id)));
    setSelectedIds((current) => current.filter((item) => !uniqueIds.includes(item)));

    try {
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        const { data: authData } = await supabase.auth.getUser();
        if (authData.user) {
          const { error } = await supabase
            .from('creator_prospects')
            .delete()
            .in('id', uniqueIds)
            .eq('user_id', authData.user.id);
          if (error) throw error;
        }
      }
      toast.success(`已从开发台删除 ${uniqueIds.length} 条线索。`);
    } catch (error) {
      console.warn('云端红人线索批量删除失败:', error instanceof Error ? error.message : error);
      toast.warning('已从当前列表删除；云端清理暂时失败，下次打开也会继续隐藏这些记录。');
    } finally {
      setDeletingProspects(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="material-toolbar flex flex-wrap items-start justify-between gap-4 border-b border-border/55 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-red-100/80 bg-red-50/85 text-red-600 shadow-sm">
            <Youtube className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">红人开发台</h1>
            <p className="text-sm text-muted-foreground">从频道录入到 Gmail 草稿的人工确认式线索流程</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          只创建 Gmail 草稿，不会自动发送邮件
        </div>
      </header>

      <nav className="material-toolbar flex border-b border-border/55 px-4" aria-label="红人开发流程">
        {TAB_META.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative flex min-h-12 items-center gap-2 px-4 text-sm font-medium transition-colors ${
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[10px]">{tabCounts[tab.id]}</Badge>
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" />}
            </button>
          );
        })}
      </nav>

      <main className="flex min-h-0 flex-1 flex-col p-4">
        {activeTab === 'import' && (
          <InfluencerImportTab
            prospects={importProspects}
            selectedIds={selectedIds}
            input={input}
            preference={userPreference}
            resolving={resolving}
            checkingDedupe={checkingDedupe}
            writingFeishu={writingFeishu}
            preparingResourcePreview={preparingResourcePreview}
            preparingDevelopmentPreview={preparingDevelopmentPreview}
            preparingQuickPreview={preparingQuickPreview}
            deletingProspects={deletingProspects}
            onInputChange={setInput}
            onPreferenceChange={setUserPreference}
            onResolve={handleResolve}
            onCheckDedupe={handleCheckDedupe}
            onAddResources={openResourcePreview}
            onCreateRecords={openDevelopmentPreview}
            onQuickOnboard={openQuickOnboardingPreview}
            onConfirmInvitation={handleConfirmInvitation}
            onEmailChange={updateProspectEmail}
            onEmailSelect={selectProspectEmail}
            onToggleSelected={(id, checked) => setSelectedIds((current) => (
              checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id)
            ))}
            onToggleAll={(ids, checked) => setSelectedIds((current) => (
              checked
                ? Array.from(new Set([...current, ...ids]))
                : current.filter((id) => !ids.includes(id))
            ))}
            onConfirmSuspected={(id) => updateProspect(id, {
              dedupeStatus: 'unique',
              resourceStatus: prospects.find((item) => item.id === id)?.resourceStatus === 'suspected' ? 'missing' : prospects.find((item) => item.id === id)?.resourceStatus,
              developmentStatus: prospects.find((item) => item.id === id)?.developmentStatus === 'suspected' ? 'missing' : prospects.find((item) => item.id === id)?.developmentStatus,
              resourceRecordId: prospects.find((item) => item.id === id)?.resourceStatus === 'suspected' ? undefined : prospects.find((item) => item.id === id)?.resourceRecordId,
              duplicateConfirmedUnique: true,
              duplicateRecordId: undefined,
              duplicateReason: '疑似重复已由人工确认，不关联现有记录',
              resourceMatchPreview: undefined,
              developmentMatchPreview: undefined,
            })}
            onUseExistingResource={(id) => {
              const prospect = prospects.find((item) => item.id === id);
              if (!prospect?.resourceRecordId) return;
              const resourceEmailCandidates = buildProspectEmailCandidates(
                prospect.resourceMatchPreview?.email,
                'resource',
              );
              const emailPatch = updateProspectEmailCandidates(
                prospectEmailSelectionState(prospect),
                resourceEmailCandidates,
                { replaceSources: ['resource'] },
              );
              const shouldFillEmail = !prospect.publicEmail?.trim() && Boolean(emailPatch.publicEmail);
              updateProspect(id, {
                ...emailPatch,
                resourceStatus: 'exists',
                duplicateReason: '已由用户确认关联红人资源库中的现有记录',
                resourceMatchPreview: undefined,
                ...(shouldFillEmail
                  ? {
                      error: prospect.error?.includes('邮箱') ? undefined : prospect.error,
                    }
                  : {}),
              });
              toast.success(shouldFillEmail
                ? '已关联资源库记录，并已自动填入资源库邮箱。'
                : emailPatch.emailSelectionRequired
                  ? '已关联资源库记录；发现多个邮箱，请在邮箱框中选择。'
                  : prospect.emailManuallyLocked && resourceEmailCandidates.length
                    ? '已关联资源库记录；当前手动邮箱保持不变。'
                : '已关联资源库现有记录，不会重复建档。');
            }}
            onUseExisting={(id) => {
              const prospect = prospects.find((item) => item.id === id);
              if (!prospect?.duplicateRecordId) return;
              const developmentEmailCandidates = buildProspectEmailCandidates(
                prospect.developmentMatchPreview?.email,
                'development',
              );
              const emailPatch = updateProspectEmailCandidates(
                prospectEmailSelectionState(prospect),
                developmentEmailCandidates,
                { replaceSources: ['development'] },
              );
              updateProspect(id, {
                ...emailPatch,
                workflowStatus: 'resolved',
                developmentStatus: 'history_exists',
                previousDevelopmentRecordId: prospect.duplicateRecordId,
                feishuRecordId: undefined,
                repeatOutreach: true,
                duplicateReason: '已确认为历史开发记录；本轮将新建独立开发记录',
                developmentMatchPreview: undefined,
              });
              toast.success(emailPatch.emailSelectionRequired
                ? '已关联历史开发记录；发现多个邮箱，请在邮箱框中选择。'
                : !prospect.publicEmail?.trim() && emailPatch.publicEmail
                  ? '已关联历史开发记录，并已自动填入历史邮箱。'
                  : prospect.emailManuallyLocked && developmentEmailCandidates.length
                    ? '已关联历史开发记录；当前手动邮箱保持不变。'
                    : '已关联为历史开发记录，可以新建本轮开发记录。');
            }}
            onRemove={(id) => {
              rememberDeletedProspect(id);
              setProspects((current) => current.filter((item) => item.id !== id));
              setSelectedIds((current) => current.filter((item) => item !== id));
              const supabase = getSupabaseBrowserClient();
              if (supabase) {
                void supabase.auth.getUser().then(({ data: authData }) => {
                  if (!authData.user) return null;
                  return supabase
                    .from('creator_prospects')
                    .delete()
                    .eq('id', id)
                    .eq('user_id', authData.user.id);
                }).then((result) => {
                  if (result?.error) {
                    console.warn('云端红人线索删除失败:', result.error.message);
                    toast.warning('已从当前列表删除；云端清理暂时失败，下次打开也会继续隐藏这条记录。');
                  }
                });
              }
            }}
            onRemoveMany={handleRemoveProspects}
            onClearInput={() => setInput('')}
          />
        )}
        {activeTab === 'invitation' && (
          <InvitationConfirmTab
            prospects={invitationProspects}
            productOptions={productOptions}
            outreachPrompt={settings.aiOutreachPrompt || DEFAULT_OUTREACH_PROMPT}
            getOutreachContext={getOutreachContext}
            translatingVideoTitleIds={translatingVideoTitleIds}
            refreshingYouTubeIds={refreshingYouTubeIds}
            inferringContactNameIds={inferringContactNameIds}
            inferringOutreachLanguageIds={inferringOutreachLanguageIds}
            checkingHistoryId={checkingHistoryId}
            onPatch={updateProspect}
            onEmailChange={updateProspectEmail}
            onSave={handleSaveInvitation}
            onConfirmOutreach={handleConfirmOutreach}
            onBack={handleBackToImport}
            onSkip={handleSkip}
            onCheckHistory={handleCheckHistory}
            onRefreshYouTubeData={handleRefreshYouTubeData}
            onTranslateChannelDescription={handleTranslateChannelDescription}
            onSuggestCooperationIdea={handleSuggestCooperationIdea}
            onInferContactName={handleInferContactName}
            onInferOutreachLanguage={handleInferOutreachLanguage}
          />
        )}
        {activeTab === 'outreach' && (
          <OutreachEmailTab
            prospects={outreachProspects}
            products={products}
            emailSignature={getEmailSignatureForContext(
              settings.emailSignature,
              settings.emailSignatureScope,
              'outreach',
            )}
            generatingId={generatingId}
            regeneratingPart={regeneratingDraftPart}
            savingDraftId={savingDraftId}
            onPatch={updateProspect}
            onEmailChange={updateProspectEmail}
            onGenerate={handleGenerateOutreach}
            openProspectRequest={openProspectRequest}
            onRegeneratePart={handleRegenerateOutreachPart}
            onTranslateChinese={handleTranslateEditedOutreach}
            onSaveDraft={handleSaveGmailDraft}
            onBack={handleBackToInvitation}
            onSkip={handleSkip}
          />
        )}
        {activeTab === 'follow_up' && (
          <OutreachFollowUpTab
            settings={settings}
            auth={auth}
            onAuthRefresh={connect}
          />
        )}
      </main>

      <Dialog open={quickPreviewItems.length > 0} onOpenChange={(open) => !open && closeQuickPreview()}>
        <DialogContent className="flex max-h-[84vh] max-w-4xl flex-col overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-sky-600" />
              快速建档统一预览
            </DialogTitle>
            <DialogDescription>
              一次确认后，资源库和开发记录表会分别批量写入。疑似重复或匹配冲突的红人不会自动写入。
            </DialogDescription>
            {resourceContentTypeAiStatus === 'loading' && (
              <div className="flex items-center gap-2 rounded-md border border-violet-100 bg-violet-50/80 px-3 py-2 text-xs text-violet-800">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                预览已可操作，AI 正在后台补充资源库内容类型。
              </div>
            )}
            {quickFailureCount > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                已保留成功结果；当前还有 {quickFailureCount} 项失败，确认按钮只会重试失败项。
              </div>
            )}
          </DialogHeader>
          <div className="mx-6 min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border bg-slate-50/80 p-3">
            {quickPreviewItems.map((item) => {
              const contentTypeField = settings.feishuFieldMapping?.contentType;
              const contentTypeValue = contentTypeField
                ? item.resourceFields[contentTypeField]
                : undefined;
              return (
                <div key={item.prospect.id} className="rounded-lg border bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">
                      {item.prospect.title || item.prospect.inputUrl}
                    </p>
                    {item.blockedReason ? (
                      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-700">已阻止</Badge>
                    ) : (
                      <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">可建档</Badge>
                    )}
                  </div>
                  {item.blockedReason && (
                    <p className="mt-2 rounded-md border border-red-100 bg-red-50/70 px-2.5 py-2 text-xs text-red-700">
                      {item.blockedReason}
                    </p>
                  )}
                  {item.validationChanges?.length ? (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                      <p className="font-medium">这位红人的写入计划已更新：</p>
                      {item.validationChanges.map((change) => (
                        <p key={change} className="mt-1">• {change}</p>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                    <div className="rounded-md border bg-slate-50/70 p-2.5">
                      <p className="text-xs font-medium text-slate-500">红人资源库</p>
                      <p className="mt-1 font-medium">
                        {item.resourceAction === 'create'
                          ? item.resourceStatus === 'success' ? '已创建' : item.resourceStatus === 'failed' ? '创建失败，待重试' : '将创建资源记录'
                          : item.resourceAction === 'skip' ? '已存在，跳过创建' : '已阻止'}
                      </p>
                      {item.resourceError && <p className="mt-1 text-xs text-red-600">{item.resourceError}</p>}
                      {item.resourceAction === 'create' && contentTypeField && (
                        <div className="mt-2">
                          <p className="mb-1 text-xs text-muted-foreground">内容类型</p>
                          <FeishuOptionMultiSelect
                            options={resourceContentTypeOptions}
                            value={contentTypeValue}
                            onChange={(value) => updateQuickResourceField(
                              item.prospect.id,
                              contentTypeField,
                              value,
                            )}
                          />
                        </div>
                      )}
                    </div>
                    <div className="rounded-md border bg-slate-50/70 p-2.5">
                      <p className="text-xs font-medium text-slate-500">本轮开发记录</p>
                      <p className="mt-1 font-medium">
                        {item.developmentAction === 'create'
                          ? item.developmentWriteStatus === 'success' ? '已创建' : item.developmentWriteStatus === 'failed' ? '创建失败，待重试' : item.prospect.previousDevelopmentRecordId ? '将创建新一轮记录（保留历史）' : '将创建开发记录'
                          : item.developmentAction === 'skip' ? '当前记录已存在，跳过创建' : '已阻止'}
                      </p>
                      {item.developmentError && <p className="mt-1 text-xs text-red-600">{item.developmentError}</p>}
                      {item.resourceEmailSync?.status === 'will_update' && (
                        <p className="mt-2 text-xs text-sky-700">
                          {item.emailSyncStatus === 'success'
                            ? '资源库邮箱已补全'
                            : item.emailSyncStatus === 'failed'
                              ? `邮箱补全失败，待重试：${item.emailSyncError || ''}`
                              : `将补全资源库邮箱：${item.resourceEmailSync.appendedEmail}`}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter className="border-t bg-white/95 px-6 py-4">
            <Button variant="outline" onClick={closeQuickPreview} disabled={writingFeishu}>取消</Button>
            <Button
              onClick={confirmQuickOnboarding}
              disabled={writingFeishu || !quickPreviewItems.some((item) => (
                (item.resourceAction === 'create' && item.resourceStatus !== 'success')
                || (item.developmentAction === 'create' && item.developmentWriteStatus !== 'success')
                || item.emailSyncStatus === 'failed'
              ))}
            >
              {writingFeishu
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Zap className="mr-2 h-4 w-4" />}
              {writingFeishu
                ? '正在批量写入…'
                : quickFailureCount
                  ? `仅重试失败项（${quickFailureCount}）`
                  : '确认快速建档'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewItems.length > 0} onOpenChange={(open) => !open && closeWritePreview()}>
        <DialogContent className="flex max-h-[82vh] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>
              {previewItems[0]?.target === 'resource' ? '确认加入红人资源库' : '确认新建红人开发记录'}
            </DialogTitle>
            <DialogDescription>
              {previewItems[0]?.target === 'resource'
                ? '只有资源库未收录的红人才会出现在这里。确认后写入“红人信息数据库”。'
                : '确认后将在“红人开发情况表”新建本轮记录；发现历史开发记录时会保留关联，但不会覆盖旧记录。'}
              单条失败不会影响其他记录。
            </DialogDescription>
            {previewItems[0]?.target === 'development' && (
              <div className="rounded-md border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs text-sky-800">
                开发记录预览已生成；资源库邮箱同步直接复用本次查重快照，不再逐条读取记录。
              </div>
            )}
            {previewItems[0]?.target === 'resource' && resourceContentTypeStatus === 'loading' && (
              <div className="flex items-center gap-2 rounded-md border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs text-sky-800">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                预览已生成，正在后台读取飞书“内容类型”选项…
              </div>
            )}
            {previewItems[0]?.target === 'resource' && resourceContentTypeStatus === 'error' && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                内容类型选项读取失败；你仍可确认写入其他字段。
              </div>
            )}
            {previewItems[0]?.target === 'resource' && resourceContentTypeAiStatus === 'loading' && (
              <div className="flex items-center gap-2 rounded-md border border-violet-100 bg-violet-50/80 px-3 py-2 text-xs text-violet-800">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                飞书选项已读取，AI 正在根据频道简介和最近视频判断内容类型…
              </div>
            )}
            {previewItems[0]?.target === 'resource' && resourceContentTypeAiStatus === 'error' && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                AI 未能完成内容类型判断，请手动选择；其他字段不受影响。
              </div>
            )}
            {previewItems[0]?.target === 'resource' && resourceContentTypeAiStatus === 'partial' && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                部分红人的 AI 判断未完成，请检查内容类型后再确认。
              </div>
            )}
          </DialogHeader>
          <div className="mx-6 min-h-0 flex-1 overflow-y-auto rounded-lg border bg-slate-50/80">
            {previewItems.map((item) => {
              const channelName = item.prospect.title || item.prospect.inputUrl;
              const channelUrl = getProspectChannelUrl(item.prospect);

              return (
                <div key={item.prospect.id} className="border-b p-3 last:border-b-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {channelUrl ? (
                        <a
                          href={channelUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-preview-channel-link
                          className="group flex min-w-0 items-center gap-1 font-semibold text-slate-900 underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                          title={`打开 ${channelName} 的 YouTube 频道`}
                          aria-label={`打开 ${channelName} 的 YouTube 频道（新标签页）`}
                        >
                          <span className="truncate">{channelName}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                        </a>
                      ) : (
                        <p className="truncate font-semibold">{channelName}</p>
                      )}
                      {item.target === 'development' && item.prospect.previousDevelopmentRecordId ? (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">重复开发 · 将新建</Badge>
                      ) : null}
                      {item.writeStatus === 'success' && item.writeError ? (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">记录已创建 · 仅重试同步</Badge>
                      ) : null}
                    </div>
                    <Badge variant="outline" className="shrink-0">{Object.keys(item.fields).length} 个字段</Badge>
                  </div>
                  {item.validationChanges?.length ? (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                      <p className="font-medium">这位红人的写入计划已更新：</p>
                      {item.validationChanges.map((change) => (
                        <p key={change} className="mt-1">• {change}</p>
                      ))}
                    </div>
                  ) : null}
                  {item.validationBlocked ? (
                    <Badge variant="outline" className="mt-2 border-red-200 bg-red-50 text-red-700">
                      已阻止重复写入
                    </Badge>
                  ) : null}
                  {item.target === 'development' && item.prospect.previousDevelopmentRecordId ? (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                    已关联历史开发记录 {item.prospect.previousDevelopmentRecordId}。确认后只新建本轮记录，不修改历史记录。
                  </p>
                ) : null}
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  {Object.entries(item.fields).map(([key, value]) => {
                    const isEditableResourceNote = item.target === 'resource'
                      && key === settings.feishuFieldMapping?.notes;
                    const isEditableResourceContentType = item.target === 'resource'
                      && key === settings.feishuFieldMapping?.contentType;
                    return (
                      <div key={key} className={`rounded-md bg-white px-2 py-1.5 ${isEditableResourceNote ? 'sm:col-span-2' : ''}`}>
                        <dt className="text-xs text-muted-foreground">{key}</dt>
                        {isEditableResourceContentType ? (
                          <dd className="mt-1">
                            <FeishuOptionMultiSelect
                              options={resourceContentTypeOptions}
                              value={value}
                              onChange={(nextValue) => updatePreviewField(
                                item.prospect.id,
                                key,
                                nextValue,
                              )}
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              {resourceContentTypeStatus === 'loading'
                                ? '正在后台读取飞书“内容类型”选项…'
                                : resourceContentTypeAiStatus === 'loading'
                                  ? 'AI 正在判断；你现在手动选择后，AI 不会覆盖你的选择。'
                                : resourceContentTypeOptions.length
                                ? '由 AI 根据频道资料推荐，选项来自飞书；你可在确认前修改。'
                                : '未读取到飞书选项，请检查内容类型字段映射和飞书表格配置。'}
                            </p>
                          </dd>
                        ) : isEditableResourceNote ? (
                          <dd className="mt-1">
                            <Textarea
                              value={formatPreviewValue(value)}
                              onChange={(event) => updatePreviewField(item.prospect.id, key, event.target.value)}
                              placeholder="可补充人工备注，例如内容方向、合作判断或来源说明"
                              className="min-h-20 resize-y bg-white"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              会写入红人资源库的备注字段，可在确认前修改。
                            </p>
                          </dd>
                        ) : (
                          <dd className="mt-0.5 max-h-16 overflow-auto whitespace-pre-wrap">{formatPreviewValue(value)}</dd>
                        )}
                      </div>
                    );
                  })}
                </dl>
                {item.target === 'development' && item.resourceEmailSync && (
                  <div className="mt-3 rounded-md border border-sky-100 bg-sky-50/80 p-3 text-sm text-slate-700">
                    <p className="font-medium text-slate-900">资源库邮箱同步</p>
                    {item.resourceEmailSync.status === 'checking' && (
                      <div className="mt-1 flex items-center gap-2 text-xs text-sky-700">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        正在检查资源库邮箱是否需要补写…
                      </div>
                    )}
                    {item.resourceEmailSync.status === 'will_update' && (
                      <div className="mt-1 space-y-1">
                        <p>确认后会把当前邮箱补写到红人资源库，不覆盖原有邮箱。</p>
                        <p className="text-xs text-muted-foreground">
                          当前资源库邮箱：{item.resourceEmailSync.currentValue || '空'}
                        </p>
                        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
                          写入后：{item.resourceEmailSync.nextValue}
                        </p>
                      </div>
                    )}
                    {item.resourceEmailSync.status === 'already_exists' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        资源库已包含 {item.resourceEmailSync.appendedEmail}，不会重复追加。
                      </p>
                    )}
                    {item.resourceEmailSync.status === 'missing_mapping' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        资源库未配置“联系邮箱”字段映射，本次只新建开发记录。
                      </p>
                    )}
                    {item.resourceEmailSync.status === 'missing_record' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        当前线索未关联资源库记录，本次只新建开发记录。
                      </p>
                    )}
                    {item.resourceEmailSync.status === 'missing_email' && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        当前线索邮箱为空，本次不补写资源库邮箱。
                      </p>
                    )}
                    {item.resourceEmailSync.status === 'failed' && (
                      <div className="mt-1 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <p>
                          邮箱同步预览失败：{item.resourceEmailSync.message}
                          本次仍可新建开发记录，但不会补写资源库邮箱。
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {item.writeError && (
                  <p className="mt-3 rounded-md border border-red-100 bg-red-50/70 px-2.5 py-2 text-xs text-red-700">
                    写入失败：{item.writeError}
                  </p>
                )}
                </div>
              );
            })}
          </div>
          <DialogFooter className="border-t bg-white/95 px-6 py-4">
            <Button variant="outline" onClick={closeWritePreview} disabled={writingFeishu}>取消</Button>
            <Button
              onClick={confirmWriteFeishu}
              disabled={writingFeishu || hasPendingResourceEmailSync || previewItems.every((item) => item.validationBlocked)}
            >
              {writingFeishu || hasPendingResourceEmailSync ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              {hasPendingResourceEmailSync
                ? '正在检查邮箱同步…'
                : writingFeishu
                  ? '正在写入飞书…'
                  : previewItems.every((item) => item.validationBlocked)
                    ? '没有可写入记录'
                    : previewItems.some((item) => item.writeStatus === 'failed' || item.writeError)
                    ? `仅重试失败项（${previewItems.length}）`
                    : `确认新建 ${previewItems.length} 条`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
