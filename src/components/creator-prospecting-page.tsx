'use client';

import { sharedMailFetch as fetch } from '@/lib/shared-mail-read';
import { WorkspaceRequestError } from '@/lib/workspace-request';

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
import { Input } from '@/components/ui/input';
import { ProspectWriteStatusLine } from '@/components/creator-prospecting/prospect-write-status';
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
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { getAccountCacheScope, scopedLocalStorageKey } from '@/lib/account-cache-scope';
import { executeProspectWriteTask, recoverProspectWriteTask, writeTaskContextMatches, type ProspectWriteKind, type ProspectWriteStep, type ProspectWriteTask } from '@/lib/prospect-feishu-write';
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
  shouldAdvanceProspectingStage,
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
import { useMailAccounts } from '@/components/mail-account-provider';
import { useUserDataStore } from '@/components/user-data-provider';
import { USER_DATA_KEYS } from '@/lib/account-data-keys';
import {
  parseMailAccountBindings,
  upsertMailAccountBinding,
} from '@/lib/mail-account-bindings';
import { getMailProviderLabel } from '@/lib/mail-accounts';
import {
  buildOutreachEmailGenerationTaskKey,
  buildOutreachEmailTranslationTaskKey,
  EMAIL_GENERATION_PROGRESS,
} from '@/lib/email-generation-tasks';
import {
  EMAIL_TRANSLATION_RETRY_OPERATION,
  canApplyEmailTranslationResult,
  isEmailTranslationTaskResult,
  requestEmailTranslation,
  type EmailTranslationRetryInput,
} from '@/lib/email-translation-tasks';

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
    return items.map((item): FeishuBatchResult => ({ clientId: item.clientId, status: 'failed',
      outcomeCertain: result.outcomeCertain === true, error: getErrorMessage(result, '飞书批量写入失败。') }));
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
  retryRequested?: boolean;
  retryInput?: unknown;
};

export function CreatorProspectingPage({
  openProspectRequest,
}: {
  openProspectRequest?: CreatorProspectingOpenRequest;
}) {
  const { settings } = useSettings();
  const { products } = useProducts();
  const { auth, connect } = useGmailAuth();
  const { accounts } = useMailAccounts();
  const { data: accountData, save: saveAccountData } = useUserDataStore();
  const { enqueueTask, getLatestTaskByKey, tasks: emailGenerationTasks } = useEmailGenerationTasks();
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
  const writingFeishu = false;
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
  const appliedOutreachTranslationTaskRef = useRef(new Set<string>());
  const pendingFeishuProspectIdsRef = useRef(new Set<string>());
  const prospectsRef = useRef<Prospect[]>([]);
  const componentAccountScope = useRef(getAccountCacheScope()).current;
  const writeMountedRef = useRef(true);
  const writeContext = {
    scope: getAccountCacheScope(), resourceUrl: settings.feishuUrl || '',
    developmentUrl: settings.feishuProspectingUrl || '',
    mappingSignature: JSON.stringify([settings.feishuFieldMapping || {}, settings.feishuProspectingFieldMapping || {}]),
  };
  const writeContextRef = useRef(writeContext);
  const previewContextRef = useRef<ProspectWriteTask | null>(null);
  writeContextRef.current = writeContext;
  useEffect(() => { writeMountedRef.current = true; return () => { writeMountedRef.current = false; }; }, []);
  const [writeReviewId, setWriteReviewId] = useState<string | null>(null);
  const [writeReviewTaskId, setWriteReviewTaskId] = useState<string | null>(null);
  const [verifiedRecordId, setVerifiedRecordId] = useState('');
  const [writeReviewRecords, setWriteReviewRecords] = useState<Record<string, FeishuRecord[]>>({});
  const [writeReviewError, setWriteReviewError] = useState('');
  const [writeReviewBusy, setWriteReviewBusy] = useState(false);
  const writeReviewRunRef = useRef(0);
  const checkedInterruptedTasksRef = useRef(new Set<string>());
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


  useEffect(() => {
    prospectsRef.current = prospects;
  }, [prospects]);

  useEffect(() => {
    if (!loaded || !cloudReady) return;
    for (const prospect of prospects) {
      const task = prospect.feishuWriteTask;
      if (!task || task.status !== 'unknown' || checkedInterruptedTasksRef.current.has(task.id)
        || !writeTaskContextMatches(task, writeContextRef.current)) continue;
      checkedInterruptedTasksRef.current.add(task.id);
      const step = task.steps.find((s) => s.status === 'unknown');
      if (!step) continue;
      // Recovery performs reads only. An unknown create is never inferred from a similar record.
      void fetchFeishuRecordSnapshot(step.url, { force: true }).then((snapshot) => {
        if (!writeMountedRef.current || task.scope !== getAccountCacheScope()
          || !writeTaskContextMatches(task, writeContextRef.current)) return;
        const record = snapshot.records.find((r) => r.record_id === step.recordId);
        const matches = record && Object.entries(step.fields).every(([field, value]) => flattenFeishuValue(record.fields[field]) === flattenFeishuValue(value));
        setProspects((current) => current.map((p) => p.id === prospect.id && p.feishuWriteTask?.id === task.id && p.feishuWriteTask.status === 'unknown'
          ? { ...p, feishuWriteTask: { ...p.feishuWriteTask, error: matches
            ? '已读取到目标值，请点击核实结果确认；不会自动重复写入。'
            : '已只读核对飞书，结果仍需确认。请核实准确记录编号，勿重复建档。' }, updatedAt: new Date().toISOString() } : p));
      }).catch(() => { /* Keep the durable unknown state and its manual verification action. */ });
    }
  }, [loaded, cloudReady, prospects]);

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
      if (!authData.user || authData.user.id !== componentAccountScope || getAccountCacheScope() !== componentAccountScope) {
        setCloudReady(true);
        return;
      }
      const { data, error } = await supabase
        .from('creator_prospects')
        .select('data')
        .eq('user_id', authData.user.id)
        .order('updated_at', { ascending: false });
      if (!writeMountedRef.current || getAccountCacheScope() !== componentAccountScope) return;
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
  }, [componentAccountScope]);

  useEffect(() => {
    if (!loaded) return;
    const flush = () => {
      if (getAccountCacheScope() !== componentAccountScope) return;
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
  }, [componentAccountScope, loaded, prospects]);

  useEffect(() => {
    if (!loaded || !cloudReady || !cloudAvailable || !prospects.length) return;
    const changedProspects = prospects.filter((prospect) => (
      cloudSyncedUpdatedAtRef.current.get(prospect.id) !== prospect.updatedAt
    ));
    if (!changedProspects.length) return;
    const timeout = window.setTimeout(async () => {
      if (getAccountCacheScope() !== componentAccountScope || !writeMountedRef.current) return;
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user || authData.user.id !== componentAccountScope || getAccountCacheScope() !== componentAccountScope || !writeMountedRef.current) return;
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
  }, [componentAccountScope, cloudAvailable, cloudReady, loaded, prospects]);

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

  useEffect(() => {
    if (!loaded) return;
    prospectsRef.current.forEach((prospect) => {
      const task = getLatestTaskByKey(buildOutreachEmailTranslationTaskKey(prospect.id));
      if (task?.status !== 'completed' || !isEmailTranslationTaskResult(task.result)) return;
      if (!prospect.aiDraft) return;
      const translationResult = task.result;
      const currentChineseBody = prospect.aiDraft?.translatedBody || prospect.aiDraft?.translatedSummary || '';
      const currentTargetLang = prospect.outreachLanguage
        || prospect.aiDraft?.language
        || prospect.language
        || 'en';
      if (!canApplyEmailTranslationResult({
        result: translationResult,
        chineseBody: currentChineseBody,
        targetLang: currentTargetLang,
      })) return;
      if (appliedOutreachTranslationTaskRef.current.has(task.id)) return;
      const translatedBody = stripConfiguredEmailSignature(
        sanitizeOutreachEmailBody(translationResult.foreignBody),
        settings.emailSignature,
      );
      if (!translatedBody) return;
      appliedOutreachTranslationTaskRef.current.add(task.id);
      if (prospect.aiDraft?.body === translatedBody
        && prospect.aiDraft.synchronizedChineseBody === translationResult.chineseBody
        && prospect.aiDraft.synchronizedTargetLanguage === translationResult.targetLang) return;
      updateProspect(prospect.id, {
        aiDraft: {
          ...prospect.aiDraft,
          body: translatedBody,
          synchronizedChineseBody: translationResult.chineseBody,
          synchronizedTargetLanguage: translationResult.targetLang,
        },
        error: undefined,
      });
    });
  }, [emailGenerationTasks, getLatestTaskByKey, loaded, settings.emailSignature, prospects.length]);

  useEffect(() => {
    const prospectId = openProspectRequest?.prospectId;
    if (!prospectId || openProspectRequest.retryRequested) return;
    const task = getLatestTaskByKey(buildOutreachEmailGenerationTaskKey(prospectId));
    if (!task) return;
    const prospect = prospectsRef.current.find((item) => item.id === prospectId);
    if (!prospect) return;
    if (task.status === 'completed') {
      const result = task.result as { prospectId?: string; draft?: OutreachDraft } | undefined;
      if (
        result?.prospectId === prospectId
        && result.draft
        && prospect.workflowStatus !== 'outreach_generated'
      ) {
        updateProspect(prospectId, {
          aiDraft: result.draft,
          workflowStatus: 'outreach_generated',
          outreachGenerationStage: 'completed',
          streamingBody: undefined,
          generationError: undefined,
          error: undefined,
        });
      }
      return;
    }
    if (task.status === 'interrupted' && prospect.workflowStatus !== 'outreach_generated') {
      updateProspect(prospectId, {
        outreachGenerationStage: 'error',
        generationError: '任务已中断，请重新点击生成。',
        error: '任务已中断，请重新点击生成。',
      });
    }
  }, [getLatestTaskByKey, loaded, openProspectRequest, prospects.length]);

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
    if (!previewContextRef.current || !writeTaskContextMatches(previewContextRef.current, writeContextRef.current)) {
      toast.error('账号或配置已变化，请重新查看预览。'); return;
    }
    const items = quickPreviewItems.filter((item) => !item.blockedReason);
    const overrides = new Map(items.map((item) => [item.prospect.id, { resource: item.resourceFields, development: item.developmentFields }]));
    closeQuickPreview();
    await startQuietFeishuWrite(items.map((item) => item.prospect), 'quick', overrides);
  };

  const confirmWriteFeishu = async () => {
    if (!previewContextRef.current || !writeTaskContextMatches(previewContextRef.current, writeContextRef.current)) {
      toast.error('账号或配置已变化，请重新查看预览。'); return;
    }
    const items = previewItems.filter((item) => !item.validationBlocked);
    if (!items.length) return;
    const kind = items[0].target;
    const overrides = new Map(items.map((item) => [item.prospect.id, { [item.target]: item.fields }]));
    closeWritePreview();
    await startQuietFeishuWrite(items.map((item) => item.prospect), kind, overrides);
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

  const saveWriteTask = (id: string, task: ProspectWriteTask, patch: Partial<Prospect> = {}) => {
    if (!writeMountedRef.current || task.scope !== getAccountCacheScope() || task.scope !== componentAccountScope) throw new Error('账号已变化，已停止处理。');
    const next = prospectsRef.current.map((item) => item.id === id
      ? { ...item, ...patch, ...(item.feishuWriteBacklog?.some((t) => t.id === task.id)
        ? { feishuWriteBacklog: item.feishuWriteBacklog.map((t) => t.id === task.id ? structuredClone(task) : t) }
        : { feishuWriteTask: structuredClone(task) }), updatedAt: new Date().toISOString() } : item);
    // Commit the journal synchronously before any external write; quota failures block writes.
    localStorage.setItem(scopedLocalStorageKey(CREATOR_PROSPECTS_STORAGE_KEY), JSON.stringify(next));
    prospectsRef.current = next;
    setProspects(next);
  };

  const applyWriteStep = (id: string, task: ProspectWriteTask, step: ProspectWriteStep) => {
    const patch: Partial<Prospect> = step.key === 'resource'
      ? { resourceStatus: 'exists', resourceRecordId: step.recordId }
      : step.key === 'development'
        ? { workflowStatus: 'dedupe_completed', developmentStatus: 'exists', feishuRecordId: step.recordId }
        : { syncError: undefined };
    saveWriteTask(id, task, patch);
    invalidateFeishuRecordsCache(step.url);
  };

  const executeQuietTask = async (id: string, task: ProspectWriteTask) => {
    const current = () => writeMountedRef.current && writeTaskContextMatches(task, writeContextRef.current)
      && task.scope === getAccountCacheScope();
    if (!current()) throw new Error('账号、目标表或字段映射已变化，请恢复原配置后处理此任务。');
    const result = await executeProspectWriteTask(task, {
      current,
      save: (next) => saveWriteTask(id, next),
      applied: (step, next) => applyWriteStep(id, next, step),
      validate: async (step) => {
        const snapshot = await fetchFeishuRecordSnapshot(step.url, { force: true });
        if (step.action === 'batchCreate') {
          const mapping = step.key === 'resource' ? settings.feishuFieldMapping || {} : settings.feishuProspectingFieldMapping || {};
          const prospect = task.identity;
          if (!prospect) return '原线索不存在，已停止写入。';
          const match = findFeishuRecordMatch(prospect, buildFeishuRecordIndex(snapshot.records, mapping));
          if (match.kind === 'conflict' || (match.kind === 'suspected' && !step.acceptedSuspectedIds?.includes(match.record.record_id))) return '发现疑似重复或多条匹配，需先确认关联。';
          if (match.kind === 'exact' && !step.knownRecordIds?.includes(match.record.record_id)) return '飞书出现新的匹配记录，请核实后再处理。';
        } else {
          const record = snapshot.records.find((item) => item.record_id === step.recordId);
          if (!record) return '目标记录已不存在，已停止写入。';
          for (const [field, before] of Object.entries(step.before || {})) {
            if (flattenFeishuValue(record.fields[field]) !== flattenFeishuValue(before)) return '飞书中的原值已变化，请查看差异后重新确认。';
          }
        }
        return undefined;
      },
      write: async (step) => {
        const results = await requestFeishuBatch(step.action, step.url, step.operationId,
          [{ clientId: id, recordId: step.recordId, fields: step.fields }]);
        return results.find((result) => result.clientId === id)
          || { clientId: id, status: 'failed', outcomeCertain: false, error: '没有收到该条写入结果。' };
      },
    });
    if (!current() && writeMountedRef.current && task.scope === getAccountCacheScope()) {
      const stopped = recoverProspectWriteTask(result)!;
      stopped.error = '目标表或映射已变化，已停止后续操作；请恢复原配置后核实。';
      saveWriteTask(id, stopped);
      return stopped;
    }
    return result;
  };

  const startQuietFeishuWrite = async (items: Prospect[], kind: ProspectWriteKind,
    overrides = new Map<string, Partial<Record<ProspectWriteStep['key'], Record<string, unknown>>>>()) => {
    const context = structuredClone(writeContext);
    const mapping = structuredClone(settings.feishuProspectingFieldMapping || {});
    const resourceMapping = structuredClone(settings.feishuFieldMapping || {});
    const frozen = structuredClone(items).filter((item) => beginProspectWrite([item.id]));
    let preparationSnapshots: Promise<[FeishuRecordSnapshot, FeishuRecordSnapshot]> | undefined;
    let successCount = 0;
    const moved: string[] = [];
    // Two independent rows may progress; the same row is locked before the first await.
    await mapWithConcurrency(frozen, 2, async (source) => {
      const live = prospectsRef.current.find((item) => item.id === source.id);
      if (!live) { finishProspectWrite([source.id]); return; }
      const task: ProspectWriteTask = { id: crypto.randomUUID(), ...context, kind, status: 'checking', steps: [],
        identity: { inputUrl: source.inputUrl, title: source.title, channelId: source.channelId, url: source.url, publicEmail: source.publicEmail, customUrl: source.customUrl } };
      const current = () => writeMountedRef.current && writeTaskContextMatches(task, writeContextRef.current) && context.scope === getAccountCacheScope();
      try {
        const previous = live.feishuWriteTask;
        const mayAdvance = kind === 'invitation' && source.feishuRecordId && previous?.steps.some((s) => s.key === 'development' && s.status === 'success');
        if (previous && previous.status !== 'success' && previous.steps.length && !mayAdvance) return;
        saveWriteTask(source.id, task, mayAdvance && previous && previous.status !== 'success'
          ? { feishuWriteBacklog: [...(live.feishuWriteBacklog || []), previous] } : {});
        if (source.emailSelectionRequired) throw new Error('请先在该行选择准确邮箱。');
        if (!['resolved', 'dedupe_completed'].includes(source.workflowStatus)) throw new Error('请先完成频道识别；已进入后续阶段的记录不能重复建档。');
        if (!context.resourceUrl || !context.developmentUrl) throw new Error('请先连接资源库和开发记录表。');
        if (!mapping.channelUrl || !(resourceMapping.channelUrl || resourceMapping.channelId)) throw new Error('请先配置频道链接字段映射，以便准确查重。');
        preparationSnapshots ||= Promise.all([
          fetchFeishuRecordSnapshot(context.resourceUrl, { force: true }),
          fetchFeishuRecordSnapshot(context.developmentUrl, { force: true }),
        ]);
        const [resources, developments] = await preparationSnapshots;
        if (!current()) return;
        const acceptedSuspectedIds = [...(source.ignoredSuspectedRecordIds || []),
          ...(source.resourceStatus === 'exists' && source.resourceRecordId ? [source.resourceRecordId] : []),
          ...(source.developmentStatus === 'history_exists' && source.previousDevelopmentRecordId ? [source.previousDevelopmentRecordId] : [])];
        const confirmedMatch = (match: FeishuRecordMatch, linkedId?: string): FeishuRecordMatch => {
          if (match.kind !== 'suspected') return match;
          if (linkedId === match.record.record_id) return { ...match, kind: 'exact' };
          if (source.ignoredSuspectedRecordIds?.includes(match.record.record_id)) return { kind: 'none' };
          return match;
        };
        const resourceMatch = confirmedMatch(findFeishuRecordMatch(source, buildFeishuRecordIndex(resources.records, resourceMapping)), source.resourceStatus === 'exists' ? source.resourceRecordId : undefined);
        const developmentMatch = confirmedMatch(findFeishuRecordMatch(source, buildFeishuRecordIndex(developments.records, mapping)), source.developmentStatus === 'history_exists' ? source.previousDevelopmentRecordId : undefined);
        const resource = resourceMatch.kind === 'exact' ? resourceMatch.record : undefined;
        const development = developmentMatch.kind === 'exact' ? developmentMatch.record : undefined;
        if ([resourceMatch.kind, developmentMatch.kind].some((value) => value === 'suspected' || value === 'conflict')) {
          task.status = 'review'; task.error = '有疑似重复或匹配冲突，请先飞书查重并确认关联。'; saveWriteTask(source.id, task, {
            resourceStatus: resourceMatch.kind === 'exact' ? 'exists' : resourceMatch.kind === 'none' ? 'missing' : resourceMatch.kind,
            developmentStatus: developmentMatch.kind === 'exact' ? 'history_exists' : developmentMatch.kind === 'none' ? 'missing' : developmentMatch.kind,
            resourceRecordId: resourceMatch.kind === 'suspected' || resourceMatch.kind === 'exact' ? resourceMatch.record.record_id : undefined,
            duplicateRecordId: developmentMatch.kind === 'suspected' ? developmentMatch.record.record_id : resourceMatch.kind === 'suspected' ? resourceMatch.record.record_id : undefined,
            resourceMatchPreview: resourceMatch.kind === 'suspected' ? buildResourceMatchPreview(resourceMatch.record, resourceMapping, resourceMatch.reason) : undefined,
            developmentMatchPreview: developmentMatch.kind === 'suspected' ? { recordId: developmentMatch.record.record_id, matchReason: developmentMatch.reason } : undefined,
          }); return;
        }
        const emailPatch = updateProspectEmailCandidates(prospectEmailSelectionState(source), [
          ...recordEmailCandidates(resource, resourceMapping, 'resource'),
          ...recordEmailCandidates(development, mapping, 'development'),
        ], { replaceSources: ['resource', 'development'] });
        if (emailPatch.emailSelectionRequired || normalizeFeishuEmailValue(emailPatch.publicEmail) !== normalizeFeishuEmailValue(source.publicEmail)) {
          task.status = 'review'; task.error = '发现不同邮箱，请在该行选择后重新操作。'; saveWriteTask(source.id, task, emailPatch); return;
        }
        const add = (key: ProspectWriteStep['key'], url: string, fields: Record<string, unknown>, record?: FeishuRecord) => {
          const compact = compactFeishuWriteFields(overrides.get(source.id)?.[key] || fields);
          if (!Object.keys(compact).length) throw new Error('没有可写入字段，请检查字段映射。');
          task.steps.push({ key, url, fields: compact, action: record ? 'batchUpdate' : 'batchCreate',
            recordId: record?.record_id, operationId: `${task.id}:${key}`, status: 'pending',
            acceptedSuspectedIds,
            before: record ? Object.fromEntries(Object.keys(compact).map((field) => [field, record.fields[field] ?? ''])) : undefined,
            knownRecordIds: key === 'resource' ? resources.records.map((r) => r.record_id) : developments.records.map((r) => r.record_id) });
        };
        if (kind === 'invitation') {
          if (source.workflowStatus !== 'dedupe_completed' || !source.feishuRecordId) throw new Error('请等待开发记录创建成功，再确认待开发。');
          const record = developments.records.find((r) => r.record_id === source.feishuRecordId);
          if (!record) throw new Error('原开发记录未找到，不能同步阶段。');
          // Only the deliberate stage change is written, not unrelated unsaved fields.
          const fields: Record<string, unknown> = {};
          putMappedField(fields, mapping, 'prospectingStatus', WORKFLOW_META.invitation_pending.label);
          add('invitation', context.developmentUrl, fields, record);
          saveWriteTask(source.id, task, { workflowStatus: 'invitation_pending', priority: source.priority || 'medium' });
          moved.push(source.id);
        } else {
          if ((kind === 'resource' || kind === 'quick') && !resource && !source.resourceRecordId) {
            add('resource', context.resourceUrl, buildResourceFields(source, resourceMapping, source.resourceContentTypes || []));
          }
          if ((kind === 'development' || kind === 'quick') && !source.feishuRecordId) {
            add('development', context.developmentUrl, buildDevelopmentFields({ ...source, workflowStatus: 'dedupe_completed' }, mapping));
          }
          if ((kind === 'development' || kind === 'quick') && resource) {
            const sync = buildResourceEmailSyncPreview({ ...source, resourceRecordId: resource.record_id }, resource, resourceMapping.email);
            if (sync.status === 'will_update') add('email', context.resourceUrl, { [sync.fieldName]: sync.nextValue }, resource);
          }
          const identityChanged = (source.resourceRecordId && resource?.record_id !== source.resourceRecordId)
            || (source.previousDevelopmentRecordId && development?.record_id !== source.previousDevelopmentRecordId)
            || (!source.previousDevelopmentRecordId && development && !source.feishuRecordId);
          if (identityChanged) {
            task.status = 'review'; task.error = '关联或历史开发记录发生变化，请查看本轮写入内容后确认。'; saveWriteTask(source.id, task); return;
          }
          saveWriteTask(source.id, task, resource ? { resourceRecordId: resource.record_id, resourceStatus: 'exists' } : {});
        }
        const result = await executeQuietTask(source.id, task);
        if (result.status === 'success') successCount++;
      } catch (error) {
        if (current()) {
          // Preserve the persisted writing state if storage fails after submission.
          const stored = prospectsRef.current.find((p) => p.id === source.id)?.feishuWriteTask;
          const next = recoverProspectWriteTask(stored || task)!;
          const uncertain = next.steps.some((step) => step.status === 'writing' || step.status === 'unknown');
          next.status = uncertain ? 'unknown' : 'failed'; next.error = error instanceof Error ? error.message : '处理失败';
          try { saveWriteTask(source.id, next); } catch { toast.error('无法保存写入状态，已停止后续操作。请勿重复建档。'); }
        }
      } finally {
        if (writeMountedRef.current && context.scope === getAccountCacheScope() && !writeTaskContextMatches(task, writeContextRef.current)) {
          const stored = prospectsRef.current.find((p) => p.id === source.id)?.feishuWriteTask;
          if (stored?.id === task.id) {
            const stopped = recoverProspectWriteTask(stored)!;
            stopped.error = '目标表或映射已变化，已停止处理；请恢复原配置后继续。';
            try { saveWriteTask(source.id, stopped); } catch { /* Keep the last durable journal. */ }
          }
        }
        finishProspectWrite([source.id]);
      }
    });
    if (context.scope !== getAccountCacheScope() || !writeMountedRef.current) return;
    if (moved.length) {
      setSelectedIds((ids) => ids.filter((id) => !moved.includes(id)));
      if (shouldAdvanceProspectingStage(importProspects.map((p) => p.id), moved)) setActiveTab('invitation');
    }
    if (items.length > 1) toast.info(`本次处理 ${items.length} 条，完成 ${successCount} 条；其余请查看行内状态。`);
  };

  const retryQuietTask = async (prospect: Prospect) => {
    const task = prospect.feishuWriteTask;
    if (!task) return;
    if (!task.steps.length) {
      if (task.status === 'review') {
        previewContextRef.current = structuredClone(task);
        if (task.kind === 'resource') await openResourcePreview([prospect]);
        else if (task.kind === 'quick') await openQuickOnboardingPreview([prospect]);
        else await openDevelopmentPreview([prospect]);
      } else await startQuietFeishuWrite([prospect], task.kind);
      return;
    }
    if (!beginProspectWrite([prospect.id])) return;
    try {
      if (task.status === 'unknown' || task.status === 'review') {
        if (!writeTaskContextMatches(task, writeContextRef.current)) throw new Error('账号、目标表或字段映射已变化，请恢复原配置后核实。');
        const run = ++writeReviewRunRef.current;
        setVerifiedRecordId(''); setWriteReviewId(prospect.id); setWriteReviewTaskId(task.id); setWriteReviewRecords({}); setWriteReviewError(''); setWriteReviewBusy(true);
        try {
          const urls = Array.from(new Set(task.steps.filter((s) => s.status !== 'success').map((s) => s.url)));
          const snapshots = await Promise.all(urls.map(async (url) => [url, (await fetchFeishuRecordSnapshot(url, { force: true })).records] as const));
          if (run === writeReviewRunRef.current && task.scope === getAccountCacheScope()) setWriteReviewRecords(Object.fromEntries(snapshots));
        } catch { if (run === writeReviewRunRef.current) setWriteReviewError('读取飞书现状失败，请关闭后重新核实。'); }
        finally { if (run === writeReviewRunRef.current) setWriteReviewBusy(false); }
        return;
      }
      await executeQuietTask(prospect.id, task);
    } catch (error) { toast.error(error instanceof Error ? error.message : '无法继续处理'); }
    finally { finishProspectWrite([prospect.id]); }
  };

  const confirmQuietReview = async () => {
    const prospect = prospectsRef.current.find((p) => p.id === writeReviewId);
    const selectedTask = [prospect?.feishuWriteTask, ...(prospect?.feishuWriteBacklog || [])].find((t) => t?.id === writeReviewTaskId);
    const task = selectedTask && structuredClone(selectedTask);
    if (!prospect || !task || !beginProspectWrite([prospect.id])) return;
    setWriteReviewBusy(true); setWriteReviewError('');
    try {
      if (!writeTaskContextMatches(task, writeContextRef.current) || task.scope !== getAccountCacheScope()) throw new Error('账号或配置已变化，不能执行旧任务。');
      const step = task.steps.find((s) => s.status !== 'success');
      if (!step) return;
      const snapshot = await fetchFeishuRecordSnapshot(step.url, { force: true });
      if (task.scope !== getAccountCacheScope() || !writeTaskContextMatches(task, writeContextRef.current)) return;
      if (task.status === 'unknown' || step.status === 'unknown' || step.status === 'writing') {
        const id = step.recordId || verifiedRecordId.trim();
        const record = snapshot.records.find((r) => r.record_id === id);
        if (!record || (step.action === 'batchCreate' && step.knownRecordIds?.includes(id))) throw new Error('请填写本次新建记录的准确编号，不能关联已有历史记录。');
        if (!Object.entries(step.fields).every(([field, value]) => flattenFeishuValue(record.fields[field]) === flattenFeishuValue(value))) throw new Error('该记录与本次提交内容不一致，不能确认成功。');
        step.recordId = id; step.status = 'success'; step.error = undefined;
        applyWriteStep(prospect.id, task, step);
        task.status = task.steps.every((s) => s.status === 'success') ? 'success' : 'failed';
        task.error = task.status === 'success' ? undefined : '已核实成功；请点击重试继续未完成步骤。';
        saveWriteTask(prospect.id, task);
      } else {
        if (step.action === 'batchUpdate') {
          const record = snapshot.records.find((r) => r.record_id === step.recordId);
          const shown = writeReviewRecords[step.url]?.find((r) => r.record_id === step.recordId);
          if (!record || !shown || !Object.keys(step.fields).every((f) => flattenFeishuValue(record.fields[f]) === flattenFeishuValue(shown.fields[f]))) throw new Error('原值又有变化，请关闭后重新查看。');
          step.before = Object.fromEntries(Object.keys(step.fields).map((f) => [f, record.fields[f] ?? '']));
        }
        step.status = 'pending'; task.status = 'pending'; task.error = undefined;
        saveWriteTask(prospect.id, task);
        await executeQuietTask(prospect.id, task);
      }
      setWriteReviewId(null);
    } catch (error) { setWriteReviewError(error instanceof Error ? error.message : '核实失败'); }
    finally { setWriteReviewBusy(false); finishProspectWrite([prospect.id]); }
  };

  const handleConfirmInvitation = async (items: Prospect[]) => {
    await startQuietFeishuWrite(items, 'invitation');
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
    const shouldAdvance = shouldAdvanceProspectingStage(
      invitationProspects.map((item) => item.id),
      [prospect.id],
    );
    updateProspect(prospect.id, { workflowStatus: 'outreach_pending', error: undefined });
    if (shouldAdvance) setActiveTab('outreach');
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
        report('正在准备开发信上下文', undefined, EMAIL_GENERATION_PROGRESS.preparing);
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
        let streamAccepted = false;
        try {
      const response = await fetch('/api/ai/outreach-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(requestBody),
      });
      if (!response.ok || !response.body) throw new Error('流式生成暂不可用，正在切换到普通生成。');
      streamAccepted = true;

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
          report(
            event.data.stage === 'finalizing'
              ? '正在整理标题和中文翻译'
              : '正在生成开发信',
            undefined,
            event.data.stage === 'finalizing'
              ? EMAIL_GENERATION_PROGRESS.translatingOrAnalyzing
              : EMAIL_GENERATION_PROGRESS.generatingBody,
          );
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
        synchronizedChineseBody: String(completedDraft.translatedBody || completedDraft.translatedSummary || '').trim(),
        synchronizedTargetLanguage: prospect.outreachLanguage || completedDraft.language || prospect.language || 'en',
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
      if (error instanceof WorkspaceRequestError || streamAccepted) {
        const failure = error instanceof WorkspaceRequestError ? error : new WorkspaceRequestError('生成连接中断，请检查已接收的内容后重试。');
        updateProspect(prospect.id, { outreachGenerationStage: undefined, generationError: failure.message });
        throw failure;
      }
      try {
        updateProspect(prospect.id, { outreachGenerationStage: 'finalizing' });
        report(
          '流式生成不可用，正在使用兼容模式',
          undefined,
          EMAIL_GENERATION_PROGRESS.generatingBody,
        );
        const generatedDraft = await generateOneShot(signal);
        const draft: OutreachDraft = {
          ...generatedDraft,
          body: stripConfiguredEmailSignature(
            sanitizeOutreachEmailBody(generatedDraft.body),
            settings.emailSignature,
          ),
          synchronizedChineseBody: String(generatedDraft.translatedBody || generatedDraft.translatedSummary || '').trim(),
          synchronizedTargetLanguage: prospect.outreachLanguage || generatedDraft.language || prospect.language || 'en',
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

  const handleTranslateEditedOutreach = async (
    prospectId: string,
    chineseBody: string,
    requestedTargetLang?: string,
  ) => {
    const normalizedChineseBody = chineseBody.trim();
    const prospect = prospectsRef.current.find((item) => item.id === prospectId);
    if (!prospect?.aiDraft || !normalizedChineseBody) {
      toast.error('中文邮件内容为空，无法自动更新外文正文。');
      return false;
    }

    const targetLang = requestedTargetLang
      || prospect.outreachLanguage
      || prospect.aiDraft.language
      || prospect.language
      || 'en';
    const targetLangName = outreachLanguageLabel(targetLang);
    const retryInput: EmailTranslationRetryInput = {
      operation: EMAIL_TRANSLATION_RETRY_OPERATION,
      source: 'outreach_email',
      chineseBody: normalizedChineseBody,
      targetLang,
      targetLangName,
    };
    const taskId = enqueueTask({
      key: buildOutreachEmailTranslationTaskKey(prospectId),
      kind: 'email_translation',
      title: prospect.title || '该频道',
      description: '根据中文更新外文',
      avatarUrl: prospect.avatarUrl,
      navigation: {
        view: 'prospecting',
        prospectId,
      },
      initialStage: `等待翻译为${targetLangName}`,
      retryInput,
      run: async ({ signal, report }) => {
        report(
          `正在翻译为${targetLangName}`,
          undefined,
          EMAIL_GENERATION_PROGRESS.translatingOrAnalyzing,
        );
        const foreignBody = await requestEmailTranslation({
          chineseBody: normalizedChineseBody,
          targetLang,
          targetLangName,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
          signal,
        });
        return {
          source: 'outreach_email' as const,
          chineseBody: normalizedChineseBody,
          targetLang,
          targetLangName,
          foreignBody,
        };
      },
    });
    return Boolean(taskId);
  };

  const handleSaveGmailDraft = async (prospect: Prospect, mailAccountId: string) => {
    const targetAccount = accounts.find((account) => account.mailAccountId === mailAccountId);
    if (!targetAccount || targetAccount.connectionStatus !== 'connected' || !targetAccount.capabilities.drafts) {
      toast.error('所选邮箱当前不能保存草稿，请重新选择。');
      return;
    }
    if (targetAccount.provider === 'gmail' && !auth?.accessToken) {
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
      let result: { success?: boolean; data?: { id?: string; message?: { id?: string }; draftRef?: string; folderRef?: string } };
      if (targetAccount.provider === 'gmail') {
        try {
          result = await createGmailDraft(auth?.accessToken || '');
        } catch (error) {
          if (!isGmailAuthError(error)) throw error;
          toast.info('Gmail 授权已过期，正在自动刷新后重试。');
          const refreshResponse = await fetch('/api/auth/refresh?force=1', { method: 'POST' });
          const refreshResult = await refreshResponse.json();
          if (!refreshResponse.ok || !refreshResult.success || !refreshResult.data?.accessToken) {
            throw new Error('Gmail 授权已失效，请到“设置 > 邮箱账号管理”重新连接 Gmail。');
          }
          const freshAuth = refreshResult.data as GmailAuth;
          connect(freshAuth);
          result = await createGmailDraft(freshAuth.accessToken || '');
        }
      } else {
        const response = await fetch('/api/mail/tencent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'draft',
            mailAccountId: targetAccount.mailAccountId,
            to: prospect.publicEmail,
            subject: draft.subject,
            text: applyPlainTextEmailSignature(draft.body, emailSignature),
            html: appendEmailSignature(renderedBodyHtml, emailSignature),
            inlineImages: inlineProductImage ? [{
              filename: inlineProductImage.fileName,
              mimeType: inlineProductImage.mimeType,
              contentId: inlineProductImage.contentId,
              data: inlineProductImage.dataUrl.replace(/^data:[^;]+;base64,/, ''),
            }] : [],
          }),
        });
        result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error((result as { error?: string }).error || '保存腾讯企业邮箱草稿失败。');
        }
      }
      if (!result.success) throw new Error('保存邮件草稿失败。');
      const draftRef = String(result.data?.draftRef || result.data?.id || result.data?.message?.id || '');
      const gmailDraftId = targetAccount.provider === 'gmail' ? draftRef : '';
      const patch: Partial<Prospect> = {
        workflowStatus: 'gmail_draft_saved',
        ...(targetAccount.provider === 'gmail' ? { gmailDraftId } : {}),
        error: undefined,
      };
      updateProspect(prospect.id, patch);
      if (shouldAdvanceProspectingStage(
        outreachProspects.map((item) => item.id),
        [prospect.id],
      )) {
        setActiveTab('follow_up');
      }
      const currentBindings = parseMailAccountBindings(accountData[USER_DATA_KEYS.MAIL_ACCOUNT_BINDINGS]);
      saveAccountData(USER_DATA_KEYS.MAIL_ACCOUNT_BINDINGS, upsertMailAccountBinding(currentBindings, {
        prospectId: prospect.id,
        feishuRecordId: prospect.feishuRecordId,
        contactEmail: prospect.publicEmail.trim().toLowerCase(),
        mailAccountId: targetAccount.mailAccountId,
        provider: targetAccount.provider,
        mailAddress: targetAccount.email,
        draftRef,
        folderRef: result.data?.folderRef,
      }));
      const synced = await syncFeishuProspect(prospect, patch);
      const firstOutreachResult = await writeFirstOutreachSent(prospect, patch);
      if (firstOutreachResult.success) {
        toast.success(
          `红人 ${prospect.title || '该红人'} 的开发信已保存到${getMailProviderLabel(targetAccount.provider)}草稿箱，并已在飞书双表标记为“已发”。邮件尚未发送。`,
        );
      } else {
        toast.warning(
          `${getMailProviderLabel(targetAccount.provider)}草稿已保存，但飞书“已发”标记失败：${firstOutreachResult.error || (synced ? '未知原因' : '飞书状态同步失败')}。邮件没有被自动发送。`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存邮件草稿失败。');
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
    const nextTab = activeTab === 'invitation'
      && shouldAdvanceProspectingStage(invitationProspects.map((item) => item.id), [prospect.id])
      ? 'outreach'
      : activeTab === 'outreach'
        && shouldAdvanceProspectingStage(outreachProspects.map((item) => item.id), [prospect.id])
        ? 'follow_up'
        : null;
    updateProspect(prospect.id, { workflowStatus: 'skipped' });
    if (nextTab) setActiveTab(nextTab);
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

      {writeReviewId && (() => {
        const prospect = prospects.find((p) => p.id === writeReviewId);
        const task = [prospect?.feishuWriteTask, ...(prospect?.feishuWriteBacklog || [])].find((t) => t?.id === writeReviewTaskId);
        if (!task || !prospect) return null;
        const step = task.steps.find((s) => s.status !== 'success');
        return <Dialog open onOpenChange={(open) => { if (!open) { writeReviewRunRef.current++; setWriteReviewId(null); } }}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{task.status === 'unknown' ? '核实写入结果' : '确认变化的写入内容'}</DialogTitle>
              <DialogDescription>{prospect.title || prospect.inputUrl} · {task.error}</DialogDescription></DialogHeader>
            {task.steps.filter((s) => s.status !== 'success').map((s) => <div key={s.key} className="flex flex-col gap-2 rounded-lg border p-3">
              <p className="font-medium">{s.key === 'resource' ? '资源库建档' : s.key === 'development' ? '新建本轮开发记录' : s.key === 'email' ? '补充资源库邮箱' : '更新邀约阶段'}</p>
              {s.recordId ? <p className="text-xs text-muted-foreground">目标记录：{s.recordId}</p> : null}
              {Object.entries(s.fields).map(([field, value]) => <div key={field} className="text-sm break-all">
                <p>{field}：{formatPreviewValue(value)}</p>
                {s.action === 'batchUpdate' ? <p className="text-muted-foreground">飞书当前值：{formatPreviewValue(writeReviewRecords[s.url]?.find((r) => r.record_id === s.recordId)?.fields[field])}</p> : null}
              </div>)}
              {/^https:\/\//.test(s.url) ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sm underline">打开目标飞书表</a> : null}
            </div>)}
            {task.status === 'unknown' && step?.action === 'batchCreate' ? <div className="flex flex-col gap-2">
              <p className="text-sm">先在飞书核实本次新记录，填写准确记录 ID（rec…）。系统会校验内容，不按相似姓名关联，也不会再次创建。</p>
              <Input aria-label="已核实的飞书记录编号" value={verifiedRecordId} onChange={(event) => { setVerifiedRecordId(event.target.value); setWriteReviewError(''); }} />
            </div> : null}
            {writeReviewError ? <p role="alert" className="text-sm text-destructive">{writeReviewError}</p> : null}
            <DialogFooter><Button variant="outline" onClick={() => setWriteReviewId(null)}>暂不处理</Button>
              <Button disabled={writeReviewBusy || Boolean(writeReviewError) || !step || !writeReviewRecords[step.url]} onClick={() => void confirmQuietReview()}>
                {writeReviewBusy ? '正在核对…' : task.status === 'unknown' ? '确认已写入并校验' : '确认以上内容并继续'}
              </Button></DialogFooter>
          </DialogContent>
        </Dialog>;
      })()}

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
        {activeTab === 'import' ? <p className="mb-2 text-xs text-muted-foreground">点击即后台写入；新建开发记录会向准确关联的资源库追加已选邮箱，保留原邮箱。异常请查看该行状态。</p> : null}
        {activeTab !== 'import' ? prospects.filter((p) => (p.feishuWriteTask && p.feishuWriteTask.status !== 'success') || p.feishuWriteBacklog?.some((t) => t.status !== 'success')).map((p) => (
          <div key={p.id} className="mb-2 flex items-center gap-3 text-sm"><span>{p.title || p.inputUrl}</span><ProspectWriteStatusLine prospect={p} onRetry={retryQuietTask} /></div>
        )) : null}
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
            onAddResources={(items) => void startQuietFeishuWrite(items, 'resource')}
            onCreateRecords={(items) => void startQuietFeishuWrite(items, 'development')}
            onQuickOnboard={(items) => void startQuietFeishuWrite(items, 'quick')}
            onRetryWrite={retryQuietTask}
            onContentTypesChange={(id, value) => updateProspect(id, { resourceContentTypes: splitContentTypeInput(value) })}
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
              ignoredSuspectedRecordIds: Array.from(new Set([
                ...(prospects.find((item) => item.id === id)?.ignoredSuspectedRecordIds || []),
                prospects.find((item) => item.id === id)?.resourceMatchPreview?.recordId,
                prospects.find((item) => item.id === id)?.developmentMatchPreview?.recordId,
                prospects.find((item) => item.id === id)?.duplicateRecordId,
              ].filter((value): value is string => Boolean(value)))),
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
