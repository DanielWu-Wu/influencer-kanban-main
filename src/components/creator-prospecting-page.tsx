'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Loader2,
  MailCheck,
  Send,
  UserPlus,
  Youtube,
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { InfluencerImportTab } from '@/components/creator-prospecting/influencer-import-tab';
import { InvitationConfirmTab } from '@/components/creator-prospecting/invitation-confirm-tab';
import { OutreachEmailTab } from '@/components/creator-prospecting/outreach-email-tab';
import { OutreachFollowUpTab } from '@/components/creator-prospecting/outreach-follow-up-tab';
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
import { Textarea } from '@/components/ui/textarea';
import { generateId, useGmailAuth, useProducts, useSettings, type AppSettings } from '@/lib/data';
import { DEFAULT_OUTREACH_PROMPT } from '@/lib/ai-prompts';
import { appendEmailSignature } from '@/lib/email-content';
import { sanitizeOutreachEmailBody } from '@/lib/outreach-draft-sanitizer';
import {
  buildOutreachEmailHtml,
  getProductInlineImage,
  selectedProductEmailAsset,
} from '@/lib/outreach-email-rendering';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  calculateRecentAverageViews,
  canCreateFeishuRecord,
  countryLabel,
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

function appendPlainTextSignature(body: string, signature?: string) {
  const content = body.trimEnd();
  const signatureText = signature?.trim();
  if (!signatureText || content.endsWith(signatureText)) return content;
  return `${content}\n\n${signatureText}`;
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
  putMappedField(fields, mapping, 'email', prospect.publicEmail);
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
  putMappedField(fields, mapping, 'email', prospect.publicEmail);
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
  putMappedField(fields, mapping, 'email', prospect.publicEmail);
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

function flattenFeishuValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenFeishuValue).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return flattenFeishuValue(object.link || object.text || object.name || Object.values(object));
  }
  return '';
}

function extractHandle(value?: string) {
  const match = String(value || '').match(/(?:youtube\.com\/)?@([^/?#]+)/i);
  return match?.[1]?.toLowerCase() || String(value || '').replace(/^@/, '').toLowerCase();
}

function extractRecordId(result: unknown) {
  const data = (result as { data?: { record?: { record_id?: string; id?: string } } })?.data;
  return data?.record?.record_id || data?.record?.id || '';
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
  }
  return String(value);
}

function normalizeEmailForCompare(value: string) {
  return value.trim().toLowerCase();
}

function splitEmailValues(value: string) {
  return value
    .split(/[\n,，;；、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstValidEmail(value: string | undefined) {
  return splitEmailValues(value || '').find((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || '';
}

function formatFeishuEmailValue(value: unknown) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return formatPreviewValue(value).trim();
}

function appendEmailValue(currentValue: string, email: string) {
  const trimmedCurrentValue = currentValue.trim();
  const trimmedEmail = email.trim();
  if (!trimmedCurrentValue) return trimmedEmail;
  const existingEmails = splitEmailValues(trimmedCurrentValue).map(normalizeEmailForCompare);
  if (existingEmails.includes(normalizeEmailForCompare(trimmedEmail))) return trimmedCurrentValue;
  return `${trimmedCurrentValue}\n${trimmedEmail}`;
}

function buildPendingResourceEmailSyncPreview(
  prospect: Prospect,
  emailFieldName: string | undefined,
  resourceUrl: string | undefined,
): ResourceEmailSyncPreview {
  const email = prospect.publicEmail?.trim();
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
  const email = prospect.publicEmail?.trim();
  if (!email) return { status: 'missing_email' };
  if (!emailFieldName) return { status: 'missing_mapping' };
  if (!prospect.resourceRecordId || !resourceRecord) return { status: 'missing_record' };

  const currentValue = formatFeishuEmailValue(resourceRecord.fields[emailFieldName]);
  const nextValue = appendEmailValue(currentValue, email);
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

function prospectContentText(prospect: Prospect) {
  return [
    prospect.title,
    prospect.description,
    prospect.country,
    prospect.language,
    ...(prospect.recentVideos || []).flatMap((video) => [
      video.title,
      video.translatedTitle,
    ]),
  ].filter(Boolean).join(' ').toLowerCase();
}

const CONTENT_TYPE_KEYWORDS: Array<{ pattern: RegExp; keywords: string[] }> = [
  { pattern: /房车|camper|rv/i, keywords: ['rv', 'camper', 'camping', 'husbil', 'husvagn', 'motorhome', 'caravan', 'vanlife', 'wohnmobil', 'autocaravan', 'furgon', 'campervan'] },
  { pattern: /off\s*grid|离网/i, keywords: ['off grid', 'off-grid', 'solar', 'photovoltaic', 'battery', 'power station', 'energy storage', 'independent energy', 'self sufficient', 'zonnepaneel'] },
  { pattern: /工具|tools?/i, keywords: ['tool', 'tools', 'workshop', 'garage', 'repair', 'renovation', 'construction', 'woodworking'] },
  { pattern: /diy|手工/i, keywords: ['diy', 'do it yourself', 'zelf', 'själv', 'gör', 'build', 'bygg', 'klussen', 'bricolage', 'maker'] },
  { pattern: /科技|tech/i, keywords: ['tech', 'technology', 'gadget', 'electronics', 'smart home', 'domotica', 'device'] },
  { pattern: /越野|overland/i, keywords: ['overland', 'offroad', 'off-road', '4x4', 'expedition', 'adventure vehicle'] },
  { pattern: /农场|homestead/i, keywords: ['homestead', 'farm', 'garden', 'self sufficiency', 'permaculture', 'smallholding'] },
  { pattern: /应急|prepper/i, keywords: ['prepper', 'prepping', 'emergency', 'survival', 'backup power'] },
  { pattern: /海上|sailing|marine/i, keywords: ['sailing', 'boat', 'yacht', 'marine', 'sea', 'sailboat'] },
  { pattern: /新闻|news/i, keywords: ['news', 'politics', 'current affairs'] },
];

function inferContentTypesFromOptions(prospect: Prospect, options: string[]) {
  const text = prospectContentText(prospect);
  return options.filter((option) => {
    const normalized = option.toLowerCase();
    if (text.includes(normalized)) return true;
    const rule = CONTENT_TYPE_KEYWORDS.find((item) => item.pattern.test(option));
    return Boolean(rule?.keywords.some((keyword) => text.includes(keyword)));
  });
}

function extractFeishuOptionName(option: FeishuFieldOption) {
  return String(option.name || option.text || option.value || '').trim();
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

function findRecordMatch(
  prospect: Prospect,
  records: FeishuRecord[],
  mapping: FeishuFieldMapping,
) {
  const channelId = String(prospect.channelId || '').trim().toLowerCase();
  const urlKey = normalizeYouTubeKey(firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl));
  const handle = extractHandle(prospect.customUrl || prospect.sourceUrl || prospect.inputUrl);
  const email = String(prospect.publicEmail || '').trim().toLowerCase();
  const title = String(prospect.title || '').trim().toLowerCase();
  let suspected: FeishuRecord | undefined;
  let suspectedReason = '';

  for (const record of records) {
    const recordChannelId = flattenFeishuValue(mapping.channelId ? record.fields[mapping.channelId] : '').trim().toLowerCase();
    const recordUrl = normalizeYouTubeKey(flattenFeishuValue(mapping.channelUrl ? record.fields[mapping.channelUrl] : ''));
    const recordEmail = flattenFeishuValue(mapping.email ? record.fields[mapping.email] : '').trim().toLowerCase();
    const recordName = flattenFeishuValue(mapping.channelName ? record.fields[mapping.channelName] : '').trim().toLowerCase();
    const recordHandle = extractHandle(recordUrl);
    if (channelId && recordChannelId && channelId === recordChannelId) {
      return { exact: record, reason: 'Channel ID 一致' };
    }
    if (urlKey && recordUrl && urlKey === recordUrl) {
      return { exact: record, reason: '标准化 YouTube 链接一致' };
    }
    if (email && recordEmail && email === recordEmail) {
      return { exact: record, reason: '联系邮箱一致' };
    }
    if (!suspected && handle && recordHandle && handle === recordHandle) {
      suspected = record;
      suspectedReason = 'handle 相同，请人工确认';
    } else if (!suspected && title && recordName && title === recordName) {
      suspected = record;
      suspectedReason = '频道名相同，请人工确认';
    }
  }
  return suspected ? { suspected, reason: suspectedReason } : {};
}

export function CreatorProspectingPage() {
  const { settings } = useSettings();
  const { products } = useProducts();
  const { auth, connect } = useGmailAuth();
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
  const [inferringContactNameIds, setInferringContactNameIds] = useState<string[]>([]);
  const [inferringOutreachLanguageIds, setInferringOutreachLanguageIds] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [checkingDedupe, setCheckingDedupe] = useState(false);
  const [writingFeishu, setWritingFeishu] = useState(false);
  const [preparingDevelopmentPreview, setPreparingDevelopmentPreview] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [regeneratingDraftPart, setRegeneratingDraftPart] = useState<{ id: string; part: 'subject' | 'body' } | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [checkingHistoryId, setCheckingHistoryId] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<FeishuWritePreview[]>([]);

  useEffect(() => {
    const localProspects = (() => {
      try {
        return migrateProspects(JSON.parse(localStorage.getItem(CREATOR_PROSPECTS_STORAGE_KEY) || '[]'));
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
      const cloudProspects = migrateProspects((data || []).map((row) => row.data));
      if (cloudProspects.length) {
        const merged = new Map<string, Prospect>();
        [...localProspects, ...cloudProspects].forEach((item) => {
          const current = merged.get(item.id);
          if (!current || item.updatedAt > current.updatedAt) merged.set(item.id, item);
        });
        setProspects(Array.from(merged.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      }
      setCloudReady(true);
    };
    void loadCloudProspects();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(CREATOR_PROSPECTS_STORAGE_KEY, JSON.stringify(prospects));
  }, [loaded, prospects]);

  useEffect(() => {
    if (!loaded || !cloudReady || !cloudAvailable || !prospects.length) return;
    const timeout = window.setTimeout(async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) return;
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) return;
      const { error } = await supabase.from('creator_prospects').upsert(
        prospects.map((prospect) => ({
          id: prospect.id,
          user_id: authData.user!.id,
          data: prospect,
          created_at: prospect.createdAt,
          updated_at: prospect.updatedAt,
        })),
      );
      if (error) console.warn('云端红人开发状态保存失败:', error.message);
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

  const syncFeishuProspect = async (prospect: Prospect, patch: Partial<Prospect> = {}) => {
    if (!settings.feishuProspectingUrl || !prospect.feishuRecordId) return true;
    const next = { ...prospect, ...patch } as Prospect;
    const fields = buildDevelopmentSyncFields(next, settings.feishuProspectingFieldMapping || {});
    if (!Object.keys(fields).length) return true;
    try {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    const existingKeys = new Set(prospects.map((item) => normalizeYouTubeKey(firstValue(item.inputUrl, item.sourceUrl, item.url))));
    const uniqueLinks = links.filter((link) => !existingKeys.has(normalizeYouTubeKey(link)));
    if (!uniqueLinks.length) {
      toast.info('这些链接已经在当前线索池中。');
      return;
    }
    const now = new Date().toISOString();
    const additions: Prospect[] = uniqueLinks.map((link) => ({
      schemaVersion: CREATOR_PROSPECTS_SCHEMA_VERSION,
      id: generateId(),
      inputUrl: link,
      workflowStatus: 'recorded',
      emailStatus: 'missing',
      dedupeStatus: 'unchecked',
      resourceStatus: 'unchecked',
      developmentStatus: 'unchecked',
      competitorCollaboration: 'unknown',
      createdAt: now,
      updatedAt: now,
    }));
    setProspects((current) => [...additions, ...current]);
    setSelectedIds(additions.map((item) => item.id));
    setResolving(true);
    toast.info(`正在识别 ${uniqueLinks.length} 个 YouTube 频道。`);

    try {
      const response = await fetch('/api/youtube/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links: uniqueLinks,
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
        return [{
          ...item,
          ...channel,
          recentVideos,
          language,
          languageSource: language ? 'inferred' as const : undefined,
          recentAverageViews: calculateRecentAverageViews(recentVideos),
          workflowStatus: 'resolved' as const,
          emailStatus: channel.publicEmail ? 'available' as const : 'missing' as const,
          dedupeStatus: 'unchecked' as const,
          error: channel.publicEmail ? undefined : '未在公开简介中发现邮箱，可继续确认邀约，但保存 Gmail 草稿前必须补充。',
          updatedAt: new Date().toISOString(),
        }];
      });
      const resolvedById = new Map(resolvedProspects.map((item) => [item.id, item]));

      setProspects((current) => current.map((item) => {
        const resolved = resolvedById.get(item.id);
        if (resolved) return resolved;
        const inputKey = normalizeYouTubeKey(item.inputUrl);
        const matchedError = result.errors?.find((error) => normalizeYouTubeKey(error.sourceUrl) === inputKey);
        if (matchedError) {
          return { ...item, workflowStatus: 'error', error: matchedError.error, updatedAt: new Date().toISOString() };
        }
        return item;
      }));
      setInput('');
      const failures = result.errors?.length || 0;
      toast.success(`识别完成：成功 ${result.channels?.length || 0} 个${failures ? `，失败 ${failures} 个` : ''}。`);
      if (resolvedProspects.length) {
        setResolving(false);
        await handleCheckDedupe(resolvedProspects);
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

  const loadFeishuRecords = async (url: string, label: string) => {
    if (!url) throw new Error(`请先在设置中连接${label}。`);
    const records: FeishuRecord[] = [];
    let pageToken = '';
    for (let page = 0; page < 10; page += 1) {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          url,
          pageSize: 500,
          pageToken,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(getErrorMessage(result, '飞书记录读取失败。'));
      const data = result.data as { items?: FeishuRecord[]; has_more?: boolean; page_token?: string };
      records.push(...(data.items || []));
      if (!data.has_more || !data.page_token) break;
      pageToken = data.page_token;
    }
    return records;
  };

  const loadFeishuRecord = async (url: string, recordId: string, label: string) => {
    if (!url) throw new Error(`请先在设置中连接${label}。`);
    const response = await fetch('/api/feishu/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'get',
        url,
        recordId,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(getErrorMessage(result, '飞书记录读取失败。'));
    const record = (result.data?.record || result.data) as FeishuRecord | undefined;
    if (!record?.record_id) throw new Error('飞书未返回有效的资源库记录。');
    return record;
  };

  const handleCheckDedupe = async (items: Prospect[]) => {
    const targets = items.filter((item) => item.workflowStatus === 'resolved');
    if (!targets.length) {
      toast.error('请选择已识别的频道进行飞书查重。');
      return;
    }
    setCheckingDedupe(true);
    targets.forEach((item) => updateProspect(item.id, {
      dedupeStatus: 'checking',
      resourceStatus: 'checking',
      developmentStatus: 'checking',
    }));
    try {
      if (!settings.feishuUrl || !settings.feishuProspectingUrl) {
        throw new Error('请先在设置中分别连接“红人信息数据库”和“红人开发情况表”。');
      }
      const [resourceRecords, developmentRecords] = await Promise.all([
        loadFeishuRecords(settings.feishuUrl, '红人信息数据库'),
        loadFeishuRecords(settings.feishuProspectingUrl, '红人开发情况表'),
      ]);
      const resourceMapping = settings.feishuFieldMapping || {};
      const developmentMapping = settings.feishuProspectingFieldMapping || {};
      setProspects((current) => current.map((prospect) => {
        if (!targets.some((item) => item.id === prospect.id)) return prospect;
        const resourceMatch = findRecordMatch(prospect, resourceRecords, resourceMapping);
        const developmentMatch = findRecordMatch(prospect, developmentRecords, developmentMapping);
        const resourceStatus = resourceMatch.exact
          ? 'exists'
          : resourceMatch.suspected
            ? 'suspected'
            : 'missing';
        const developmentStatus = developmentMatch.exact
          ? 'exists'
          : developmentMatch.suspected
            ? 'suspected'
            : 'missing';
        const linkedDevelopmentId = developmentMatch.exact?.record_id;
        return {
          ...prospect,
          workflowStatus: linkedDevelopmentId ? 'dedupe_completed' : 'resolved',
          dedupeStatus: developmentMatch.exact
            ? 'duplicate'
            : developmentMatch.suspected || resourceMatch.suspected
              ? 'suspected'
              : 'unique',
          resourceStatus,
          developmentStatus,
          resourceRecordId: resourceMatch.exact?.record_id || resourceMatch.suspected?.record_id,
          feishuRecordId: linkedDevelopmentId,
          duplicateRecordId: developmentMatch.suspected?.record_id || resourceMatch.suspected?.record_id,
          resourceMatchPreview: resourceMatch.suspected
            ? buildResourceMatchPreview(resourceMatch.suspected, resourceMapping, resourceMatch.reason)
            : undefined,
          duplicateReason: developmentMatch.exact
            ? `已关联现有开发记录：${developmentMatch.reason}`
            : developmentMatch.suspected
              ? `开发记录疑似重复：${developmentMatch.reason}`
              : resourceMatch.suspected
                ? `资源库疑似重复：${resourceMatch.reason}`
                : resourceMatch.exact
                  ? `资源库已收录：${resourceMatch.reason}`
                  : '资源库未收录，可人工确认加入；不影响创建开发记录',
          duplicateConfirmedUnique: false,
          updatedAt: new Date().toISOString(),
        };
      }));
      toast.success(`双表查重完成：已同时检查资源库和开发记录表中的 ${targets.length} 个频道。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '飞书查重失败。';
      targets.forEach((item) => updateProspect(item.id, {
        dedupeStatus: 'error',
        resourceStatus: 'error',
        developmentStatus: 'error',
        error: message,
      }));
      toast.error(message);
    } finally {
      setCheckingDedupe(false);
    }
  };

  const openDevelopmentPreview = async (items: Prospect[]) => {
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
    const previews = targets
      .map((prospect) => ({
        prospect,
        target: 'development' as const,
        fields: buildDevelopmentFields({ ...prospect, workflowStatus: 'dedupe_completed' }, mapping),
        resourceEmailSync: buildPendingResourceEmailSyncPreview(
          prospect,
          resourceMapping.email,
          resourceUrl,
        ),
      }))
      .filter((item) => Object.keys(item.fields).length > 0);
    if (!previews.length) {
      setPreparingDevelopmentPreview(false);
      toast.error('没有可写入字段，请先检查“红人开发情况表”的字段映射。');
      return;
    }
    setPreviewItems(previews);
    setPreparingDevelopmentPreview(false);

    const syncTargets = previews.filter((item) => item.resourceEmailSync?.status === 'checking');
    if (!syncTargets.length || !resourceUrl) return;

    void mapWithConcurrency(syncTargets, 3, async (item) => {
      const syncPreview = item.resourceEmailSync;
      if (syncPreview?.status !== 'checking') return;
      try {
        const resourceRecord = await loadFeishuRecord(resourceUrl, syncPreview.recordId, '红人信息数据库');
        const nextPreview = buildResourceEmailSyncPreview(
          item.prospect,
          resourceRecord,
          resourceMapping.email,
        );
        setPreviewItems((current) => current.map((currentItem) => (
          currentItem.prospect.id === item.prospect.id
            ? { ...currentItem, resourceEmailSync: nextPreview }
            : currentItem
        )));
      } catch (error) {
        setPreviewItems((current) => current.map((currentItem) => (
          currentItem.prospect.id === item.prospect.id
            ? {
                ...currentItem,
                resourceEmailSync: {
                  status: 'failed',
                  message: error instanceof Error ? error.message : '资源库邮箱同步预览失败，本次只新建开发记录。',
                },
              }
            : currentItem
        )));
      }
    });
  };

  const loadContentTypeOptions = async (fieldName?: string) => {
    if (!settings.feishuUrl || !fieldName) return [];
    const response = await fetch('/api/feishu/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: settings.feishuUrl }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(getErrorMessage(result, '读取飞书内容类型选项失败。'));
    }
    const fields = (result.data?.fields || []) as FeishuInspectField[];
    const field = fields.find((item) => item.field_name === fieldName);
    const rawOptions = field?.property?.options || field?.options || [];
    return rawOptions.map(extractFeishuOptionName).filter(Boolean);
  };

  const openResourcePreview = async (items: Prospect[]) => {
    const targets = items.filter((item) => (
      item.resourceStatus === 'missing'
      && !item.resourceRecordId
    ));
    if (!targets.length) {
      toast.error('所选红人没有需要加入资源库的记录。');
      return;
    }
    const mapping = settings.feishuFieldMapping || {};
    let contentTypeOptions: string[] = [];
    try {
      contentTypeOptions = await loadContentTypeOptions(mapping.contentType);
    } catch (error) {
      toast.warning(error instanceof Error ? error.message : '内容类型选项读取失败，本次可手动填写。');
    }
    const previews = targets
      .map((prospect) => ({
        prospect,
        target: 'resource' as const,
        fields: buildResourceFields(
          prospect,
          mapping,
          inferContentTypesFromOptions(prospect, contentTypeOptions),
        ),
      }))
      .filter((item) => Object.keys(item.fields).length > 0);
    if (!previews.length) {
      toast.error('没有可写入字段，请先检查“红人信息数据库”的字段映射。');
      return;
    }
    setPreviewItems(previews);
  };

  const confirmWriteFeishu = async () => {
    if (!previewItems.length) return;
    if (previewItems.some((item) => item.resourceEmailSync?.status === 'checking')) {
      toast.warning('资源库邮箱同步还在检查中，请稍等几秒再确认。');
      return;
    }
    const target = previewItems[0].target;
    const targetUrl = target === 'resource' ? settings.feishuUrl : settings.feishuProspectingUrl;
    if (!targetUrl) return;
    setWritingFeishu(true);
    const successes: Array<{ id: string; recordId: string }> = [];
    const failures: string[] = [];
    const resourceEmailFailures: string[] = [];
    let resourceEmailSyncCount = 0;
    for (const item of previewItems) {
      try {
        const fields = compactFeishuWriteFields(item.fields);
        const response = await fetch('/api/feishu/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            url: targetUrl,
            fields,
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(getErrorMessage(result, '写入飞书失败。'));
        const recordId = extractRecordId(result);
        if (!recordId) throw new Error('飞书已创建记录，但未返回记录 ID。');
        successes.push({ id: item.prospect.id, recordId });
        if (target === 'development' && item.resourceEmailSync?.status === 'will_update') {
          try {
            const syncResponse = await fetch('/api/feishu/records', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'update',
                url: settings.feishuUrl,
                recordId: item.resourceEmailSync.recordId,
                fields: {
                  [item.resourceEmailSync.fieldName]: item.resourceEmailSync.nextValue,
                },
              }),
            });
            const syncResult = await syncResponse.json();
            if (!syncResponse.ok || !syncResult.success) {
              throw new Error(getErrorMessage(syncResult, '资源库邮箱同步失败。'));
            }
            resourceEmailSyncCount += 1;
          } catch (error) {
            resourceEmailFailures.push(
              `${item.prospect.title || item.prospect.inputUrl}：${error instanceof Error ? error.message : '资源库邮箱同步失败'}`,
            );
          }
        }
      } catch (error) {
        failures.push(`${item.prospect.title || item.prospect.inputUrl}：${error instanceof Error ? error.message : '写入失败'}`);
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
                  duplicateReason: '已新建红人开发记录',
                }),
            updatedAt: new Date().toISOString(),
          }
        : item;
    }));
    setPreviewItems([]);
    setWritingFeishu(false);
    if (failures.length) {
      toast.error(`已创建 ${successes.length} 个，失败 ${failures.length} 个。${failures[0]}`);
    } else if (resourceEmailFailures.length) {
      toast.warning(`开发记录已创建 ${successes.length} 条，但资源库邮箱同步失败 ${resourceEmailFailures.length} 条。${resourceEmailFailures[0]}`);
    } else {
      toast.success(
        target === 'resource'
          ? `已在红人资源库新增 ${successes.length} 条记录。`
          : `已在红人开发情况表新增 ${successes.length} 条开发记录${resourceEmailSyncCount ? `，并同步补全 ${resourceEmailSyncCount} 条资源库邮箱` : ''}。`,
      );
    }
  };

  const updatePreviewField = (prospectId: string, fieldName: string, value: unknown) => {
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

  const handleConfirmInvitation = async (items: Prospect[]) => {
    const targets = items.filter((item) => item.workflowStatus === 'dedupe_completed' && item.feishuRecordId);
    if (!targets.length) {
      toast.error('请选择已在飞书新建记录的线索。');
      return;
    }
    if (targets.length > 1 && !window.confirm(`确认将 ${targets.length} 个红人移入“邀约确认”吗？`)) return;
    const ids = new Set(targets.map((item) => item.id));
    setProspects((current) => current.map((item) => (
      ids.has(item.id)
        ? { ...item, workflowStatus: 'invitation_pending', priority: item.priority || 'medium', updatedAt: new Date().toISOString() }
        : item
    )));
    await Promise.all(targets.map((item) => syncFeishuProspect(item, { workflowStatus: 'invitation_pending' })));
    setActiveTab('invitation');
    toast.success(`已将 ${targets.length} 个红人移入邀约确认。`);
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

  const handleGenerateOutreach = async (prospect: Prospect) => {
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
    const generateOneShot = async () => {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(getErrorMessage(result, '开发信生成失败。'));
      return result.data as OutreachDraft;
    };
    setGeneratingId(prospect.id);
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
    try {
      const response = await fetch('/api/ai/outreach-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok || !response.body) throw new Error('流式生成暂不可用，正在切换到普通生成。');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedBody = '';
      const finalDraftRef: { current?: OutreachDraft } = {};
      let streamError = '';

      const handleStreamEvent = (event: OutreachStreamEvent) => {
        if (event.event === 'stage' && event.data.stage) {
          updateProspect(prospect.id, { outreachGenerationStage: event.data.stage });
        }
        if (event.event === 'delta') {
          const text = event.data.text || '';
          if (!text) return;
          streamedBody += text;
          const cleanStreamingBody = sanitizeOutreachEmailBody(streamedBody);
          updateProspect(prospect.id, {
            streamingBody: cleanStreamingBody,
            outreachGenerationStage: 'streaming_body',
            aiDraft: {
              subject: '',
              body: cleanStreamingBody,
              translatedBody: '',
              translatedSummary: '',
              personalizationNotes: [],
              riskNotes: [],
              missingInfo: [],
            },
          });
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
        body: sanitizeOutreachEmailBody(completedDraft.body || streamedBody),
      };
      updateProspect(prospect.id, {
        aiDraft: draft,
        workflowStatus: 'outreach_generated',
        outreachGenerationStage: 'completed',
        streamingBody: undefined,
        generationError: undefined,
        error: undefined,
      });
      await syncFeishuProspect(prospect, { workflowStatus: 'outreach_generated', aiDraft: draft });
      toast.success(`已生成 ${prospect.title || '该频道'} 的开发信。`);
    } catch (error) {
      try {
        updateProspect(prospect.id, { outreachGenerationStage: 'finalizing' });
        const generatedDraft = await generateOneShot();
        const draft: OutreachDraft = {
          ...generatedDraft,
          body: sanitizeOutreachEmailBody(generatedDraft.body),
        };
        updateProspect(prospect.id, {
          aiDraft: draft,
          workflowStatus: 'outreach_generated',
          outreachGenerationStage: 'completed',
          streamingBody: undefined,
          generationError: undefined,
          error: undefined,
        });
        await syncFeishuProspect(prospect, { workflowStatus: 'outreach_generated', aiDraft: draft });
        toast.success(`已生成 ${prospect.title || '该频道'} 的开发信。`);
      } catch (fallbackError) {
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
        toast.error(message);
      }
    } finally {
      setGeneratingId(null);
    }
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
    const sanitizedBody = sanitizeOutreachEmailBody(prospect.aiDraft.body);
    const draft: OutreachDraft = {
      ...prospect.aiDraft,
      body: sanitizedBody,
    };
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
            body: appendPlainTextSignature(draft.body, settings.emailSignature),
            bodyHtml: appendEmailSignature(renderedBodyHtml, settings.emailSignature),
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

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-white/60 bg-white/60 shadow-apple backdrop-blur-xl">
      <Toaster richColors position="top-center" />
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
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

      <nav className="flex border-b border-border/70 bg-slate-50/55 px-4" aria-label="红人开发流程">
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
            preparingDevelopmentPreview={preparingDevelopmentPreview}
            onInputChange={setInput}
            onPreferenceChange={setUserPreference}
            onResolve={handleResolve}
            onCheckDedupe={handleCheckDedupe}
            onAddResources={openResourcePreview}
            onCreateRecords={openDevelopmentPreview}
            onConfirmInvitation={handleConfirmInvitation}
            onPatch={updateProspect}
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
            })}
            onUseExistingResource={(id) => {
              const prospect = prospects.find((item) => item.id === id);
              if (!prospect?.resourceRecordId) return;
              const resourceEmail = firstValidEmail(prospect.resourceMatchPreview?.email);
              const shouldFillEmail = !prospect.publicEmail?.trim() && Boolean(resourceEmail);
              updateProspect(id, {
                resourceStatus: 'exists',
                duplicateReason: '已由用户确认关联红人资源库中的现有记录',
                resourceMatchPreview: undefined,
                ...(shouldFillEmail
                  ? {
                      publicEmail: resourceEmail,
                      emailStatus: 'available' as const,
                      error: prospect.error?.includes('邮箱') ? undefined : prospect.error,
                    }
                  : {}),
              });
              toast.success(shouldFillEmail
                ? '已关联资源库记录，并已自动填入资源库邮箱。'
                : '已关联资源库现有记录，不会重复建档。');
            }}
            onUseExisting={(id) => {
              const prospect = prospects.find((item) => item.id === id);
              if (!prospect?.duplicateRecordId) return;
              updateProspect(id, {
                workflowStatus: 'dedupe_completed',
                developmentStatus: 'exists',
                feishuRecordId: prospect.duplicateRecordId,
                duplicateReason: '已关联红人开发情况表中的现有记录，不会重复创建',
              });
              toast.success('已关联现有开发记录，可以继续确认邀约方向。');
            }}
            onRemove={(id) => {
              setProspects((current) => current.filter((item) => item.id !== id));
              setSelectedIds((current) => current.filter((item) => item !== id));
              const supabase = getSupabaseBrowserClient();
              if (supabase) {
                void supabase.from('creator_prospects').delete().eq('id', id).then(({ error }) => {
                  if (error) console.warn('云端红人线索删除失败:', error.message);
                });
              }
            }}
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
            inferringContactNameIds={inferringContactNameIds}
            inferringOutreachLanguageIds={inferringOutreachLanguageIds}
            checkingHistoryId={checkingHistoryId}
            onPatch={updateProspect}
            onSave={handleSaveInvitation}
            onConfirmOutreach={handleConfirmOutreach}
            onBack={handleBackToImport}
            onSkip={handleSkip}
            onCheckHistory={handleCheckHistory}
            onInferContactName={handleInferContactName}
            onInferOutreachLanguage={handleInferOutreachLanguage}
          />
        )}
        {activeTab === 'outreach' && (
          <OutreachEmailTab
            prospects={outreachProspects}
            products={products}
            emailSignature={settings.emailSignature}
            generatingId={generatingId}
            regeneratingPart={regeneratingDraftPart}
            savingDraftId={savingDraftId}
            onPatch={updateProspect}
            onGenerate={handleGenerateOutreach}
            onRegeneratePart={handleRegenerateOutreachPart}
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

      <Dialog open={previewItems.length > 0} onOpenChange={(open) => !open && setPreviewItems([])}>
        <DialogContent className="flex max-h-[82vh] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>
              {previewItems[0]?.target === 'resource' ? '确认加入红人资源库' : '确认新建红人开发记录'}
            </DialogTitle>
            <DialogDescription>
              {previewItems[0]?.target === 'resource'
                ? '只有资源库未收录的红人才会出现在这里。确认后写入“红人信息数据库”。'
                : '只有开发记录表中不存在的红人才会出现在这里。确认后写入“红人开发情况表”。'}
              单条失败不会影响其他记录。
            </DialogDescription>
            {previewItems[0]?.target === 'development' && (
              <div className="rounded-md border border-sky-100 bg-sky-50/80 px-3 py-2 text-xs text-sky-800">
                开发记录预览已生成；资源库邮箱同步会在弹窗内后台检查，检查完成后再确认写入。
              </div>
            )}
          </DialogHeader>
          <div className="mx-6 min-h-0 flex-1 overflow-y-auto rounded-lg border bg-slate-50/80">
            {previewItems.map((item) => (
              <div key={item.prospect.id} className="border-b p-3 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{item.prospect.title || item.prospect.inputUrl}</p>
                  <Badge variant="outline">{Object.keys(item.fields).length} 个字段</Badge>
                </div>
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
                            <Input
                              value={formatPreviewValue(value)}
                              onChange={(event) => updatePreviewField(
                                item.prospect.id,
                                key,
                                splitContentTypeInput(event.target.value),
                              )}
                              placeholder="例如：房车RV，Camper, Off Grid"
                              className="h-9 bg-white"
                            />
                            <p className="mt-1 text-xs text-muted-foreground">
                              会按飞书内容类型标签写入，多个标签用逗号分隔。
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
              </div>
            ))}
          </div>
          <DialogFooter className="border-t bg-white/95 px-6 py-4">
            <Button variant="outline" onClick={() => setPreviewItems([])} disabled={writingFeishu}>取消</Button>
            <Button onClick={confirmWriteFeishu} disabled={writingFeishu || hasPendingResourceEmailSync}>
              {writingFeishu || hasPendingResourceEmailSync ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              {hasPendingResourceEmailSync ? '正在检查邮箱同步…' : `确认新建 ${previewItems.length} 条`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
