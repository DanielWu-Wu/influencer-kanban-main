'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  Info,
  Loader2,
  MailPlus,
  RefreshCw,
  Sparkles,
  Trash2,
  UserPlus,
  Youtube,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { generateId, useGmailAuth, useProducts, useSettings } from '@/lib/data';
import type { Product } from '@/lib/types';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';

const STORAGE_KEY = 'influencer-board-creator-prospects';

type ProspectStatus =
  | 'pending'
  | 'resolved'
  | 'needs_review'
  | 'added_to_feishu'
  | 'draft_generated'
  | 'error';

type RecentVideo = {
  videoId?: string;
  title: string;
  description?: string;
  publishedAt?: string;
  thumbnail?: string;
  url?: string;
};

type OutreachDraft = {
  subject: string;
  body: string;
  translatedSummary?: string;
  personalizationNotes?: string[];
  missingInfo?: string[];
  language?: string;
  tone?: string;
};

type Prospect = {
  id: string;
  inputUrl: string;
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
  status: ProspectStatus;
  error?: string;
  aiDraft?: OutreachDraft;
  createdAt: string;
  updatedAt: string;
};

type YouTubeResolveChannel = Omit<Prospect, 'id' | 'inputUrl' | 'status' | 'createdAt' | 'updatedAt' | 'aiDraft'> & {
  confidence?: 'high' | 'medium' | 'low';
  inputUrl?: string;
};

type YouTubeResolveResponse = {
  success?: boolean;
  channels?: YouTubeResolveChannel[];
  errors?: Array<{ sourceUrl: string; error: string }>;
  error?: string;
};

type FeishuWritePreview = {
  prospect: Prospect;
  fields: Record<string, unknown>;
};

function ButtonHelpTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="absolute -right-1.5 -top-1.5 z-10 inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 shadow-sm transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          <Info className="h-2.5 w-2.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" sideOffset={6} className="max-w-64 bg-slate-950 px-3 py-2 text-xs leading-relaxed text-white">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

const STATUS_META: Record<ProspectStatus, { label: string; className: string }> = {
  pending: { label: '待识别', className: 'border-slate-200 bg-slate-50 text-slate-600' },
  resolved: { label: '已识别', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  needs_review: { label: '需人工确认', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  added_to_feishu: { label: '已加入飞书', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  draft_generated: { label: '已生成草稿', className: 'border-violet-200 bg-violet-50 text-violet-700' },
  error: { label: '失败', className: 'border-red-200 bg-red-50 text-red-700' },
};

const COUNTRY_LABELS: Record<string, string> = {
  ES: '西班牙',
  NL: '荷兰',
  PT: '葡萄牙',
  PL: '波兰',
  BE: '比利时',
  DE: '德国',
  FR: '法国',
  IT: '意大利',
  US: '美国',
  GB: '英国',
};

function loadProspects() {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as Prospect[];
  } catch {
    return [];
  }
}

function saveProspects(prospects: Prospect[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prospects));
}

function normalizeInputKey(value: string) {
  return value
    .trim()
    .replace(/[<>"'，,。]+$/g, '')
    .replace(/^["'<]+/g, '')
    .replace(/[?#].*$/g, '')
    .replace(/^https?:\/\/(www\.|m\.)?/i, '')
    .replace(/\/+$/g, '')
    .replace(/\/(about|community|featured|playlists|shorts|streams|videos)$/i, '')
    .toLowerCase();
}

function extractYouTubeInputs(text: string) {
  const rawItems = text
    .split(/[\s,，]+/g)
    .map((item) => item.trim().replace(/^["'<]+|[>"'。]+$/g, ''))
    .filter(Boolean);
  const accepted = rawItems.filter((item) => {
    const lower = item.toLowerCase();
    return lower.includes('youtube.com') || lower.includes('youtu.be') || item.startsWith('@') || /^UC[\w-]{20,}$/i.test(item);
  });
  return Array.from(new Map(accepted.map((item) => [normalizeInputKey(item), item])).values());
}

function formatNumber(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '未公开';
  if (value >= 10000) {
    const wan = value / 10000;
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, '')}万`;
  }
  return value.toLocaleString('zh-CN');
}

function countryLabel(country?: string) {
  if (!country) return '未填写';
  return COUNTRY_LABELS[country.toUpperCase()] || country.toUpperCase();
}

function shortDate(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function summarizeVideos(videos: RecentVideo[] = []) {
  if (!videos.length) return '最近视频：未读取到公开视频。';
  return videos
    .slice(0, 5)
    .map((video, index) => `${index + 1}. ${video.title}${shortDate(video.publishedAt) ? `（${shortDate(video.publishedAt)}）` : ''}`)
    .join('\n');
}

function firstValue(...values: Array<string | undefined>) {
  return values.find((value) => value && value.trim())?.trim() || '';
}

function maybeFollowerValue(fieldName: string, count?: number | null) {
  if (count === null || count === undefined || Number.isNaN(count)) return undefined;
  if (fieldName.includes('万')) return Number((count / 10000).toFixed(1));
  return count;
}

function putMappedField(
  fields: Record<string, unknown>,
  mapping: FeishuFieldMapping,
  key: FeishuFieldKey,
  value: unknown,
) {
  const fieldName = mapping[key];
  if (!fieldName) return;
  if (value === undefined || value === null || value === '') return;
  fields[fieldName] = value;
}

function buildFeishuFields(prospect: Prospect, mapping: FeishuFieldMapping) {
  const fields: Record<string, unknown> = {};
  const followerField = mapping.followers || '';
  const notes = [
    '来源：红人开发台',
    prospect.avatarUrl ? `频道头像：${prospect.avatarUrl}` : '',
    prospect.videoCount !== undefined && prospect.videoCount !== null ? `视频数：${prospect.videoCount}` : '',
    prospect.viewCount !== undefined && prospect.viewCount !== null ? `总观看量：${prospect.viewCount}` : '',
    summarizeVideos(prospect.recentVideos),
  ].filter(Boolean).join('\n');

  putMappedField(fields, mapping, 'channelName', prospect.title);
  putMappedField(fields, mapping, 'platform', 'YouTube');
  putMappedField(fields, mapping, 'region', countryLabel(prospect.country));
  putMappedField(fields, mapping, 'followers', maybeFollowerValue(followerField, prospect.subscriberCount));
  putMappedField(fields, mapping, 'channelUrl', firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl));
  putMappedField(fields, mapping, 'email', prospect.publicEmail);
  putMappedField(fields, mapping, 'collaborationStatus', '暂未合作');
  putMappedField(fields, mapping, 'notes', notes);

  return fields;
}

function productsForAi(products: Product[]) {
  return products
    .filter((product) => product.status === 'active')
    .slice(0, 5)
    .map((product) => ({
      name: product.name,
      model: product.model,
      productUrl: product.productUrl,
      sellingPoints: product.sellingPoints,
      technicalSpecifications: product.technicalSpecifications,
      imageAndResourceLinks: product.imageAndResourceLinks,
      marketProfiles: product.marketProfiles?.map((profile) => ({
        targetMarket: profile.targetMarket,
        siteName: profile.siteName,
        localProductUrl: profile.localProductUrl,
        targetInfluencerType: profile.targetInfluencerType,
        promotionBudget: profile.promotionBudget,
        cooperationRequirements: profile.cooperationRequirements,
        mustMention: profile.mustMention,
        prohibitedContent: profile.prohibitedContent,
        localAssetLinks: profile.localAssetLinks,
      })),
    }));
}

function getErrorMessage(result: unknown, fallback: string) {
  if (result && typeof result === 'object' && 'error' in result) {
    const error = (result as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  return fallback;
}

export function CreatorProspectingPage() {
  const { settings } = useSettings();
  const { products } = useProducts();
  const { auth } = useGmailAuth();
  const [input, setInput] = useState('');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [writingFeishu, setWritingFeishu] = useState(false);
  const [previewItems, setPreviewItems] = useState<FeishuWritePreview[]>([]);
  const [userPreference, setUserPreference] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    setProspects(loadProspects());
  }, []);

  useEffect(() => {
    saveProspects(prospects);
  }, [prospects]);

  const selectedProspects = useMemo(
    () => prospects.filter((prospect) => selectedIds.includes(prospect.id)),
    [prospects, selectedIds],
  );

  const stats = useMemo(() => ({
    total: prospects.length,
    resolved: prospects.filter((item) => item.status === 'resolved' || item.status === 'needs_review').length,
    feishu: prospects.filter((item) => item.status === 'added_to_feishu').length,
    drafts: prospects.filter((item) => item.status === 'draft_generated').length,
  }), [prospects]);

  const updateProspect = (id: string, updater: (prospect: Prospect) => Prospect) => {
    setProspects((current) => current.map((item) => (item.id === id ? updater(item) : item)));
  };

  const removeProspect = (id: string) => {
    setProspects((current) => current.filter((item) => item.id !== id));
    setSelectedIds((current) => current.filter((item) => item !== id));
  };

  const handleResolve = async () => {
    const links = extractYouTubeInputs(input);
    if (!links.length) {
      setNotice({ type: 'error', text: '请先粘贴至少一个 YouTube 频道链接、@handle 或频道 ID。' });
      return;
    }

    const existingKeys = new Set(prospects.map((item) => normalizeInputKey(firstValue(item.inputUrl, item.sourceUrl, item.url))));
    const now = new Date().toISOString();
    const newProspects = links
      .filter((link) => !existingKeys.has(normalizeInputKey(link)))
      .map((link) => ({
        id: generateId(),
        inputUrl: link,
        status: 'pending' as ProspectStatus,
        createdAt: now,
        updatedAt: now,
      }));

    const nextProspects = [...newProspects, ...prospects];
    setProspects(nextProspects);
    setResolving(true);
    setNotice({ type: 'info', text: `正在识别 ${links.length} 个 YouTube 频道。` });

    try {
      const response = await fetch('/api/youtube/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          links,
          regionCode: settings.youtubeDefaultRegion || '',
          relevanceLanguage: settings.youtubeDefaultLanguage || '',
          maxVideos: 5,
        }),
      });
      const result = await response.json() as YouTubeResolveResponse;
      if (!response.ok || !result.success) {
        const message = result.error || 'YouTube 频道识别失败。';
        setProspects((current) => current.map((item) => (
          links.some((link) => normalizeInputKey(link) === normalizeInputKey(item.inputUrl))
            ? { ...item, status: 'error', error: message, updatedAt: new Date().toISOString() }
            : item
        )));
        setNotice({ type: 'error', text: message });
        return;
      }

      setProspects((current) => current.map((item) => {
        const inputKey = normalizeInputKey(item.inputUrl);
        const channel = result.channels?.find((candidate) => (
          normalizeInputKey(candidate.inputUrl || '') === inputKey
          || normalizeInputKey(candidate.sourceUrl || '') === inputKey
          || normalizeInputKey(candidate.url || '') === inputKey
          || (item.channelId && candidate.channelId === item.channelId)
        ));
        const matchedError = result.errors?.find((error) => normalizeInputKey(error.sourceUrl) === inputKey);
        if (channel) {
          return {
            ...item,
            ...channel,
            status: channel.publicEmail ? 'resolved' : 'needs_review',
            error: channel.publicEmail ? undefined : '频道简介里没有公开邮箱，需要人工补充后才能保存 Gmail 草稿。',
            updatedAt: new Date().toISOString(),
          };
        }
        if (matchedError) {
          return {
            ...item,
            status: 'error',
            error: matchedError.error,
            updatedAt: new Date().toISOString(),
          };
        }
        return item;
      }));

      const okCount = result.channels?.length || 0;
      const errorCount = result.errors?.length || 0;
      setNotice({
        type: errorCount ? 'info' : 'success',
        text: `识别完成：成功 ${okCount} 个${errorCount ? `，失败 ${errorCount} 个` : ''}。`,
      });
      setInput('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'YouTube 频道识别失败。';
      setNotice({ type: 'error', text: message });
    } finally {
      setResolving(false);
    }
  };

  const handleGenerateOutreach = async (prospect: Prospect) => {
    if (!prospect.title && !prospect.description) {
      setNotice({ type: 'error', text: '请先识别频道资料，再生成开发信。' });
      return;
    }
    setGeneratingId(prospect.id);
    setNotice({ type: 'info', text: `正在为 ${prospect.title || '该频道'} 生成个性化开发信。` });

    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'outreach',
          channel: {
            title: prospect.title,
            url: firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl),
            description: prospect.description,
            country: prospect.country,
            subscriberCount: prospect.subscriberCount,
            videoCount: prospect.videoCount,
            viewCount: prospect.viewCount,
            recentVideos: prospect.recentVideos || [],
          },
          products: productsForAi(products),
          brandName: settings.brandName,
          senderName: settings.senderName,
          emailSignature: settings.emailSignature,
          preferredLanguage: settings.youtubeDefaultLanguage || settings.youtubeDefaultRegion || 'en',
          userPreference,
          outreachPrompt: settings.aiOutreachPrompt,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result, '开发信生成失败。'));
      }
      const draft = result.data as OutreachDraft;
      updateProspect(prospect.id, (item) => ({
        ...item,
        aiDraft: draft,
        updatedAt: new Date().toISOString(),
      }));
      setNotice({ type: 'success', text: `已生成 ${prospect.title || '该频道'} 的开发信草稿。` });
    } catch (error) {
      const message = error instanceof Error ? error.message : '开发信生成失败。';
      updateProspect(prospect.id, (item) => ({
        ...item,
        status: 'error',
        error: message,
        updatedAt: new Date().toISOString(),
      }));
      setNotice({ type: 'error', text: message });
    } finally {
      setGeneratingId(null);
    }
  };

  const handleSaveGmailDraft = async (prospect: Prospect) => {
    if (!auth?.accessToken) {
      setNotice({ type: 'error', text: '请先连接 Gmail，再保存草稿。' });
      return;
    }
    if (!prospect.publicEmail) {
      setNotice({ type: 'error', text: '这个频道没有公开邮箱，请先人工补充邮箱。' });
      return;
    }
    if (!prospect.aiDraft?.subject || !prospect.aiDraft.body) {
      setNotice({ type: 'error', text: '请先生成开发信，再保存为 Gmail 草稿。' });
      return;
    }

    setSavingDraftId(prospect.id);
    try {
      const response = await fetch('/api/gmail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draft',
          accessToken: auth.accessToken,
          to: prospect.publicEmail,
          subject: prospect.aiDraft.subject,
          body: prospect.aiDraft.body,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(getErrorMessage(result, '保存 Gmail 草稿失败。'));
      }
      updateProspect(prospect.id, (item) => ({
        ...item,
        status: 'draft_generated',
        updatedAt: new Date().toISOString(),
      }));
      setNotice({ type: 'success', text: `已保存 ${prospect.title || '该频道'} 的 Gmail 草稿。` });
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存 Gmail 草稿失败。' });
    } finally {
      setSavingDraftId(null);
    }
  };

  const openFeishuPreview = (items: Prospect[]) => {
    if (!settings.feishuUrl) {
      setNotice({ type: 'error', text: '请先在设置里连接飞书红人资源库。' });
      return;
    }
    const mapping = settings.feishuFieldMapping || {};
    const previews = items
      .filter((item) => item.status !== 'error')
      .map((item) => ({
        prospect: item,
        fields: buildFeishuFields(item, mapping),
      }))
      .filter((item) => Object.keys(item.fields).length > 0);

    if (!previews.length) {
      setNotice({ type: 'error', text: '没有可写入的字段。请先检查飞书字段映射。' });
      return;
    }
    setPreviewItems(previews);
  };

  const confirmWriteFeishu = async () => {
    if (!settings.feishuUrl || !previewItems.length) return;
    setWritingFeishu(true);
    const okIds: string[] = [];
    const failed: string[] = [];

    for (const item of previewItems) {
      try {
        const response = await fetch('/api/feishu/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create',
            url: settings.feishuUrl,
            fields: item.fields,
          }),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(getErrorMessage(result, '写入飞书失败。'));
        }
        okIds.push(item.prospect.id);
      } catch (error) {
        failed.push(`${item.prospect.title || item.prospect.inputUrl}：${error instanceof Error ? error.message : '写入失败'}`);
      }
    }

    setProspects((current) => current.map((item) => (
      okIds.includes(item.id)
        ? { ...item, status: 'added_to_feishu', updatedAt: new Date().toISOString() }
        : item
    )));
    setPreviewItems([]);
    setWritingFeishu(false);
    setNotice({
      type: failed.length ? 'error' : 'success',
      text: failed.length
        ? `已写入 ${okIds.length} 个，失败 ${failed.length} 个：${failed[0]}`
        : `已写入 ${okIds.length} 个红人到飞书。`,
    });
  };

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((current) => (
      checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id)
    ));
  };

  const allSelected = prospects.length > 0 && selectedIds.length === prospects.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-white/60 bg-white/60 p-4 shadow-apple backdrop-blur-xl lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
              <Youtube className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">红人开发台</h1>
              <p className="text-sm text-muted-foreground">粘贴 YouTube 频道链接，识别资料，生成开发信，并确认后写入飞书或 Gmail 草稿。</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
            <p className="text-muted-foreground">线索</p>
            <p className="text-base font-semibold">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
            <p className="text-muted-foreground">已识别</p>
            <p className="text-base font-semibold">{stats.resolved}</p>
          </div>
          <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
            <p className="text-muted-foreground">飞书</p>
            <p className="text-base font-semibold">{stats.feishu}</p>
          </div>
          <div className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
            <p className="text-muted-foreground">草稿</p>
            <p className="text-base font-semibold">{stats.drafts}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.4fr)]">
        <div className="rounded-lg border border-white/60 bg-white/60 p-4 shadow-apple backdrop-blur-xl">
          <div className="mb-3 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">批量导入频道链接</h2>
          </div>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="每行一个链接，例如：https://www.youtube.com/@creator 或 https://www.youtube.com/channel/UC..."
            className="min-h-36 resize-none bg-white/70"
          />
          <Textarea
            value={userPreference}
            onChange={(event) => setUserPreference(event.target.value)}
            placeholder="可选：写开发信时的额外偏好，例如主推产品、预算范围、语气、希望强调的点..."
            className="mt-3 min-h-24 resize-none bg-white/70"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={handleResolve} disabled={resolving} className="rounded-lg">
              {resolving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              识别频道
            </Button>
            <div className="relative inline-flex">
              <Button variant="outline" onClick={() => setInput('')} className="rounded-lg">
                清空输入
              </Button>
              <ButtonHelpTooltip label="清空输入说明">
                清空上方频道链接输入框；不会删除下方已识别线索、已选线索或已生成草稿。
              </ButtonHelpTooltip>
            </div>
            {selectedProspects.length > 0 && (
              <div className="relative inline-flex">
                <Button variant="outline" onClick={() => openFeishuPreview(selectedProspects)} className="rounded-lg">
                  <Database className="mr-2 h-4 w-4" />
                  写入选中
                </Button>
                <ButtonHelpTooltip label="写入选中说明">
                  将你勾选的红人线索写入当前连接的飞书表；点击后会先弹出写入预览，确认后才真正写入。
                </ButtonHelpTooltip>
              </div>
            )}
          </div>

          {notice && (
            <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              notice.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : notice.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-blue-200 bg-blue-50 text-blue-700'
            }`}>
              {notice.type === 'error' ? <AlertTriangle className="mt-0.5 h-4 w-4" /> : <CheckCircle2 className="mt-0.5 h-4 w-4" />}
              <span>{notice.text}</span>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-white/60 bg-white/60 p-4 shadow-apple backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(checked) => setSelectedIds(checked ? prospects.map((item) => item.id) : [])}
                aria-label="选择全部线索"
              />
              <h2 className="text-sm font-semibold">待开发线索</h2>
              <span className="text-xs text-muted-foreground">已选 {selectedIds.length} 个</span>
            </div>
            {prospects.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setProspects([]);
                  setSelectedIds([]);
                }}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                清空队列
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {prospects.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed border-white/70 bg-white/45 text-center shadow-apple backdrop-blur-xl">
            <Youtube className="mb-3 h-10 w-10 text-muted-foreground" />
            <h3 className="font-semibold">还没有待开发红人</h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">把外部工具筛选到的 YouTube 频道链接粘贴进来，系统会帮你整理频道资料、头像、最近视频和开发信草稿。</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {prospects.map((prospect) => {
              const meta = STATUS_META[prospect.status];
              const channelUrl = firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl);
              return (
                <div key={prospect.id} className="rounded-lg border border-white/60 bg-white/70 p-4 shadow-apple backdrop-blur-xl">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <div className="flex items-start gap-3 lg:w-[34%]">
                      <Checkbox
                        checked={selectedIds.includes(prospect.id)}
                        onCheckedChange={(checked) => toggleSelected(prospect.id, Boolean(checked))}
                        aria-label={`选择 ${prospect.title || prospect.inputUrl}`}
                        className="mt-9"
                      />
                      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-white/80 bg-slate-100">
                        {prospect.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={prospect.avatarUrl} alt={`${prospect.title || 'YouTube'} 频道头像`} className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <Youtube className="h-7 w-7" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-base font-semibold">{prospect.title || prospect.inputUrl}</h3>
                          <Badge variant="outline" className={meta.className}>{meta.label}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>地区：{countryLabel(prospect.country)}</span>
                          <span>平台：YouTube</span>
                          <span>粉丝：{formatNumber(prospect.subscriberCount)}</span>
                        </div>
                        {channelUrl && (
                          <a href={channelUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            打开频道
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                        <p className="mt-2 text-xs text-muted-foreground">邮箱：{prospect.publicEmail || '未在简介中发现公开邮箱'}</p>
                        {prospect.error && <p className="mt-2 text-xs text-amber-700">{prospect.error}</p>}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="rounded-lg border border-white/70 bg-white/70 p-3">
                        <p className="text-xs font-semibold text-muted-foreground">最近 4 个视频</p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                          {(prospect.recentVideos || []).slice(0, 4).map((video) => (
                            <a
                              key={video.videoId || video.url || video.title}
                              href={video.url || channelUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="group cursor-pointer overflow-hidden rounded-lg border border-slate-100 bg-white/75 text-xs shadow-sm transition-all duration-200 ease-out hover:border-primary/40 hover:bg-white/90 hover:shadow-md active:scale-[0.99] motion-reduce:transition-none motion-reduce:active:scale-100"
                            >
                              <div className="relative aspect-video overflow-hidden bg-slate-100">
                                {video.thumbnail ? (
                                  <img
                                    src={video.thumbnail}
                                    alt={video.title || 'YouTube video thumbnail'}
                                    loading="lazy"
                                    className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03]"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                                    <Youtube className="h-5 w-5" aria-hidden="true" />
                                  </div>
                                )}
                              </div>
                              <div className="space-y-1 p-2">
                                <span className="line-clamp-2 min-h-8 font-medium leading-4">{video.title || '未命名视频'}</span>
                                <span className="block text-muted-foreground">{shortDate(video.publishedAt)}</span>
                              </div>
                            </a>
                          ))}
                          {!(prospect.recentVideos || []).length && (
                            <p className="rounded-lg border border-dashed border-slate-200 bg-white/60 p-3 text-xs text-muted-foreground sm:col-span-2 xl:col-span-4">
                              暂未读取到最近公开视频。
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-row flex-wrap gap-2 lg:w-44 lg:flex-col">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGenerateOutreach(prospect)}
                        disabled={generatingId === prospect.id || prospect.status === 'pending'}
                        className="rounded-lg"
                      >
                        {generatingId === prospect.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        生成开发信
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openFeishuPreview([prospect])}
                        disabled={prospect.status === 'pending' || prospect.status === 'error'}
                        className="rounded-lg"
                      >
                        <Database className="mr-2 h-4 w-4" />
                        加入飞书
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSaveGmailDraft(prospect)}
                        disabled={savingDraftId === prospect.id}
                        className="rounded-lg"
                      >
                        {savingDraftId === prospect.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}
                        保存草稿
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => removeProspect(prospect.id)} className="rounded-lg text-muted-foreground">
                        <Trash2 className="mr-2 h-4 w-4" />
                        删除
                      </Button>
                    </div>
                  </div>

                  {prospect.aiDraft && (
                    <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-blue-700">AI 开发信草稿</p>
                          <p className="mt-1 truncate text-sm font-semibold">{prospect.aiDraft.subject}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigator.clipboard?.writeText(`${prospect.aiDraft?.subject}\n\n${prospect.aiDraft?.body}`)}
                        >
                          <Copy className="mr-1 h-4 w-4" />
                          复制
                        </Button>
                      </div>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-white/70 p-3 text-sm leading-6">{prospect.aiDraft.body}</pre>
                      {prospect.aiDraft.translatedSummary && (
                        <div className="mt-2 rounded-md bg-white/70 p-3 text-sm">
                          <p className="font-medium">中文说明</p>
                          <p className="mt-1 text-muted-foreground">{prospect.aiDraft.translatedSummary}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={previewItems.length > 0} onOpenChange={(open) => !open && setPreviewItems([])}>
        <DialogContent className="max-h-[82vh] max-w-3xl overflow-hidden rounded-lg">
          <DialogHeader>
            <DialogTitle>确认写入飞书</DialogTitle>
            <DialogDescription>
              以下内容会新增到当前连接的红人资源库。请确认无误后再执行。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto rounded-lg border bg-slate-50/80 p-3">
            <div className="space-y-3">
              {previewItems.map((item) => (
                <div key={item.prospect.id} className="rounded-lg border bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-semibold">{item.prospect.title || item.prospect.inputUrl}</p>
                    <Badge variant="outline">{Object.keys(item.fields).length} 个字段</Badge>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    {Object.entries(item.fields).map(([key, value]) => (
                      <div key={key} className="rounded-md bg-slate-50 px-2 py-1.5">
                        <dt className="text-xs text-muted-foreground">{key}</dt>
                        <dd className="mt-0.5 max-h-20 overflow-auto whitespace-pre-wrap">{String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewItems([])} disabled={writingFeishu}>
              取消
            </Button>
            <Button onClick={confirmWriteFeishu} disabled={writingFeishu}>
              {writingFeishu ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              确认写入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
