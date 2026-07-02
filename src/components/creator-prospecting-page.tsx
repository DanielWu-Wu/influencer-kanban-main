'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Database,
  Loader2,
  MailCheck,
  UserPlus,
  Youtube,
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { InfluencerImportTab } from '@/components/creator-prospecting/influencer-import-tab';
import { InvitationConfirmTab } from '@/components/creator-prospecting/invitation-confirm-tab';
import { OutreachEmailTab } from '@/components/creator-prospecting/outreach-email-tab';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { generateId, useGmailAuth, useProducts, useSettings } from '@/lib/data';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';
import {
  calculateRecentAverageViews,
  canCreateFeishuRecord,
  CREATOR_PROSPECTS_SCHEMA_VERSION,
  CREATOR_PROSPECTS_STORAGE_KEY,
  extractYouTubeInputs,
  FALLBACK_PRODUCT_OPTIONS,
  inferLanguage,
  migrateProspects,
  normalizeYouTubeKey,
  type OutreachDraft,
  type Prospect,
  type ProspectingTab,
  type RecentVideo,
  WORKFLOW_META,
} from '@/lib/creator-prospecting';
import type { Product } from '@/lib/types';

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

type FeishuWritePreview = {
  prospect: Prospect;
  fields: Record<string, unknown>;
};

const TAB_META: Array<{
  id: ProspectingTab;
  label: string;
  icon: typeof UserPlus;
}> = [
  { id: 'import', label: '红人录入', icon: UserPlus },
  { id: 'invitation', label: '邀约确认', icon: ClipboardCheck },
  { id: 'outreach', label: '开发信', icon: MailCheck },
];

function firstValue(...values: Array<string | undefined>) {
  return values.find((value) => Boolean(value?.trim()))?.trim() || '';
}

function getErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === 'object' && 'error' in value) {
    const error = (value as { error?: unknown }).error;
    if (typeof error === 'string') return error;
  }
  return fallback;
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

function summarizeVideos(videos?: RecentVideo[]) {
  return (videos || [])
    .slice(0, 8)
    .map((video, index) => `${index + 1}. ${video.title}${video.url ? `\n${video.url}` : ''}`)
    .join('\n');
}

function buildFeishuFields(prospect: Prospect, mapping: FeishuFieldMapping) {
  const fields: Record<string, unknown> = {};
  const notes = [
    '来源：红人开发台',
    prospect.avatarUrl ? `频道头像：${prospect.avatarUrl}` : '',
    prospect.cooperationIdea ? `合作想法：${prospect.cooperationIdea}` : '',
    summarizeVideos(prospect.recentVideos),
  ].filter(Boolean).join('\n');

  putMappedField(fields, mapping, 'channelName', prospect.title);
  putMappedField(fields, mapping, 'platform', 'YouTube');
  putMappedField(fields, mapping, 'region', prospect.country || '');
  putMappedField(fields, mapping, 'followers', prospect.subscriberCount);
  putMappedField(fields, mapping, 'channelUrl', firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl));
  putMappedField(fields, mapping, 'channelId', prospect.channelId);
  putMappedField(fields, mapping, 'language', prospect.language);
  putMappedField(fields, mapping, 'recentAverageViews', prospect.recentAverageViews);
  putMappedField(fields, mapping, 'description', prospect.description);
  putMappedField(fields, mapping, 'email', prospect.publicEmail);
  putMappedField(fields, mapping, 'collaborationStatus', '暂未合作');
  putMappedField(fields, mapping, 'prospectingStatus', WORKFLOW_META[prospect.workflowStatus].label);
  putMappedField(fields, mapping, 'targetProduct', prospect.targetProduct);
  putMappedField(fields, mapping, 'cooperationType', prospect.cooperationType);
  putMappedField(fields, mapping, 'cooperationIdea', prospect.cooperationIdea);
  putMappedField(fields, mapping, 'priority', prospect.priority === 'high' ? '高' : prospect.priority === 'low' ? '低' : '中');
  putMappedField(fields, mapping, 'gmailDraftId', prospect.gmailDraftId);
  putMappedField(fields, mapping, 'notes', notes);
  return fields;
}

function productsForAi(products: Product[], targetProduct?: string) {
  return products
    .filter((product) => product.status === 'active')
    .sort((a, b) => Number(b.name === targetProduct || b.model === targetProduct) - Number(a.name === targetProduct || a.model === targetProduct))
    .slice(0, 6)
    .map((product) => ({
      name: product.name,
      model: product.model,
      productUrl: product.productUrl,
      sellingPoints: product.sellingPoints,
      technicalSpecifications: product.technicalSpecifications,
      imageAndResourceLinks: product.imageAndResourceLinks,
      marketProfiles: product.marketProfiles,
    }));
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

export function CreatorProspectingPage() {
  const { settings } = useSettings();
  const { products } = useProducts();
  const { auth } = useGmailAuth();
  const [activeTab, setActiveTab] = useState<ProspectingTab>('import');
  const [input, setInput] = useState('');
  const [userPreference, setUserPreference] = useState('');
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [checkingDedupe, setCheckingDedupe] = useState(false);
  const [writingFeishu, setWritingFeishu] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [checkingHistoryId, setCheckingHistoryId] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<FeishuWritePreview[]>([]);

  useEffect(() => {
    try {
      setProspects(migrateProspects(JSON.parse(localStorage.getItem(CREATOR_PROSPECTS_STORAGE_KEY) || '[]')));
    } catch {
      setProspects([]);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!loaded) return;
    localStorage.setItem(CREATOR_PROSPECTS_STORAGE_KEY, JSON.stringify(prospects));
  }, [loaded, prospects]);

  const updateProspect = (id: string, patch: Partial<Prospect>) => {
    setProspects((current) => current.map((item) => (
      item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
    )));
  };

  const invitationProspects = useMemo(
    () => prospects.filter((item) => item.workflowStatus === 'invitation_pending'),
    [prospects],
  );
  const outreachProspects = useMemo(
    () => prospects.filter((item) => ['outreach_pending', 'outreach_generated', 'gmail_draft_saved'].includes(item.workflowStatus)),
    [prospects],
  );
  const tabCounts = useMemo(() => ({
    import: prospects.filter((item) => !['invitation_pending', 'outreach_pending', 'outreach_generated', 'gmail_draft_saved', 'skipped'].includes(item.workflowStatus)).length,
    invitation: invitationProspects.length,
    outreach: outreachProspects.length,
  }), [invitationProspects.length, outreachProspects.length, prospects]);
  const productOptions = useMemo(
    () => Array.from(new Set([
      ...products.filter((item) => item.status === 'active').flatMap((item) => [item.model, item.name]).filter(Boolean),
      ...FALLBACK_PRODUCT_OPTIONS,
    ])),
    [products],
  );

  const syncFeishuProspect = async (prospect: Prospect, patch: Partial<Prospect> = {}) => {
    if (!settings.feishuUrl || !prospect.feishuRecordId) return true;
    const next = { ...prospect, ...patch } as Prospect;
    const fields = buildFeishuFields(next, settings.feishuFieldMapping || {});
    if (!Object.keys(fields).length) return true;
    try {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          url: settings.feishuUrl,
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

  const handleResolve = async () => {
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

      setProspects((current) => current.map((item) => {
        const inputKey = normalizeYouTubeKey(item.inputUrl);
        const channel = result.channels?.find((candidate) => (
          normalizeYouTubeKey(candidate.inputUrl || '') === inputKey
          || normalizeYouTubeKey(candidate.sourceUrl || '') === inputKey
          || normalizeYouTubeKey(candidate.url || '') === inputKey
        ));
        const matchedError = result.errors?.find((error) => normalizeYouTubeKey(error.sourceUrl) === inputKey);
        if (channel) {
          const recentVideos = channel.recentVideos || [];
          const language = inferLanguage({ ...channel, recentVideos });
          return {
            ...item,
            ...channel,
            recentVideos,
            language,
            languageSource: language ? 'inferred' : undefined,
            recentAverageViews: calculateRecentAverageViews(recentVideos),
            workflowStatus: 'resolved',
            emailStatus: channel.publicEmail ? 'available' : 'missing',
            dedupeStatus: 'unchecked',
            error: channel.publicEmail ? undefined : '未在公开简介中发现邮箱，可继续确认邀约，但保存 Gmail 草稿前必须补充。',
            updatedAt: new Date().toISOString(),
          };
        }
        if (matchedError) {
          return { ...item, workflowStatus: 'error', error: matchedError.error, updatedAt: new Date().toISOString() };
        }
        return item;
      }));
      setInput('');
      const failures = result.errors?.length || 0;
      toast.success(`识别完成：成功 ${result.channels?.length || 0} 个${failures ? `，失败 ${failures} 个` : ''}。`);
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
  };

  const loadFeishuRecords = async () => {
    if (!settings.feishuUrl) throw new Error('请先在设置中连接飞书红人资源库。');
    const records: FeishuRecord[] = [];
    let pageToken = '';
    for (let page = 0; page < 10; page += 1) {
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          url: settings.feishuUrl,
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

  const handleCheckDedupe = async (items: Prospect[]) => {
    const targets = items.filter((item) => item.workflowStatus === 'resolved');
    if (!targets.length) {
      toast.error('请选择已识别的频道进行飞书查重。');
      return;
    }
    setCheckingDedupe(true);
    targets.forEach((item) => updateProspect(item.id, { dedupeStatus: 'checking' }));
    try {
      const records = await loadFeishuRecords();
      const mapping = settings.feishuFieldMapping || {};
      setProspects((current) => current.map((prospect) => {
        if (!targets.some((item) => item.id === prospect.id)) return prospect;
        const channelId = String(prospect.channelId || '').toLowerCase();
        const urlKey = normalizeYouTubeKey(firstValue(prospect.url, prospect.sourceUrl, prospect.inputUrl));
        const handle = extractHandle(prospect.customUrl || prospect.sourceUrl || prospect.inputUrl);
        const title = String(prospect.title || '').trim().toLowerCase();
        let suspected: FeishuRecord | undefined;
        let suspectedReason = '';

        for (const record of records) {
          const recordChannelId = flattenFeishuValue(mapping.channelId ? record.fields[mapping.channelId] : '').trim().toLowerCase();
          const recordUrl = normalizeYouTubeKey(flattenFeishuValue(mapping.channelUrl ? record.fields[mapping.channelUrl] : ''));
          const recordName = flattenFeishuValue(mapping.channelName ? record.fields[mapping.channelName] : '').trim().toLowerCase();
          const recordHandle = extractHandle(recordUrl);
          if (channelId && recordChannelId && channelId === recordChannelId) {
            return {
              ...prospect,
              workflowStatus: 'duplicate',
              dedupeStatus: 'duplicate',
              duplicateRecordId: record.record_id,
              duplicateReason: 'Channel ID 与飞书现有记录一致',
              updatedAt: new Date().toISOString(),
            };
          }
          if (urlKey && recordUrl && urlKey === recordUrl) {
            return {
              ...prospect,
              workflowStatus: 'duplicate',
              dedupeStatus: 'duplicate',
              duplicateRecordId: record.record_id,
              duplicateReason: '标准化 YouTube 链接与飞书现有记录一致',
              updatedAt: new Date().toISOString(),
            };
          }
          if (!suspected && handle && recordHandle && handle === recordHandle) {
            suspected = record;
            suspectedReason = 'handle 与飞书记录相同，请人工确认';
          } else if (!suspected && title && recordName && title === recordName) {
            suspected = record;
            suspectedReason = '频道名与飞书记录相同，请人工确认';
          }
        }
        if (suspected) {
          return {
            ...prospect,
            dedupeStatus: 'suspected',
            duplicateRecordId: suspected.record_id,
            duplicateReason: suspectedReason,
            duplicateConfirmedUnique: false,
            updatedAt: new Date().toISOString(),
          };
        }
        return {
          ...prospect,
          dedupeStatus: 'unique',
          duplicateRecordId: undefined,
          duplicateReason: undefined,
          duplicateConfirmedUnique: false,
          updatedAt: new Date().toISOString(),
        };
      }));
      toast.success(`飞书查重完成，共检查 ${targets.length} 个频道。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '飞书查重失败。';
      targets.forEach((item) => updateProspect(item.id, { dedupeStatus: 'error', error: message }));
      toast.error(message);
    } finally {
      setCheckingDedupe(false);
    }
  };

  const openFeishuPreview = (items: Prospect[]) => {
    const targets = items.filter(canCreateFeishuRecord);
    if (!targets.length) {
      toast.error('没有可创建的线索。请先完成识别和飞书查重，并排除重复记录。');
      return;
    }
    const mapping = settings.feishuFieldMapping || {};
    const previews = targets
      .map((prospect) => ({
        prospect,
        fields: buildFeishuFields({ ...prospect, workflowStatus: 'dedupe_completed' }, mapping),
      }))
      .filter((item) => Object.keys(item.fields).length > 0);
    if (!previews.length) {
      toast.error('没有可写入字段，请先检查飞书字段映射。');
      return;
    }
    setPreviewItems(previews);
  };

  const confirmWriteFeishu = async () => {
    if (!settings.feishuUrl || !previewItems.length) return;
    setWritingFeishu(true);
    const successes: Array<{ id: string; recordId: string }> = [];
    const failures: string[] = [];
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
        if (!response.ok || !result.success) throw new Error(getErrorMessage(result, '写入飞书失败。'));
        const recordId = extractRecordId(result);
        if (!recordId) throw new Error('飞书已创建记录，但未返回记录 ID。');
        successes.push({ id: item.prospect.id, recordId });
      } catch (error) {
        failures.push(`${item.prospect.title || item.prospect.inputUrl}：${error instanceof Error ? error.message : '写入失败'}`);
      }
    }
    setProspects((current) => current.map((item) => {
      const success = successes.find((entry) => entry.id === item.id);
      return success
        ? {
            ...item,
            workflowStatus: 'dedupe_completed',
            feishuRecordId: success.recordId,
            updatedAt: new Date().toISOString(),
          }
        : item;
    }));
    setPreviewItems([]);
    setWritingFeishu(false);
    if (failures.length) {
      toast.error(`已创建 ${successes.length} 个，失败 ${failures.length} 个。${failures[0]}`);
    } else {
      toast.success(`已在飞书新建 ${successes.length} 条线索记录。`);
    }
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
    if (!prospect.targetProduct?.trim() || !prospect.cooperationType?.trim() || !prospect.cooperationIdea?.trim()) {
      toast.error('请先确认目标产品、合作形式和合作想法。');
      return;
    }
    updateProspect(prospect.id, { workflowStatus: 'outreach_pending' });
    await syncFeishuProspect(prospect, { workflowStatus: 'outreach_pending' });
    setActiveTab('outreach');
    toast.success('邀约方向已确认，可以生成开发信。');
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
    if (!prospect.targetProduct || !prospect.cooperationType || !prospect.cooperationIdea) {
      toast.error('请先返回邀约确认，补齐产品、合作形式和合作想法。');
      return;
    }
    setGeneratingId(prospect.id);
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
            language: prospect.language,
            subscriberCount: prospect.subscriberCount,
            videoCount: prospect.videoCount,
            viewCount: prospect.viewCount,
            recentAverageViews: prospect.recentAverageViews,
            recentVideos: prospect.recentVideos || [],
          },
          products: productsForAi(products, prospect.targetProduct),
          targetProduct: prospect.targetProduct,
          cooperationType: prospect.cooperationType,
          cooperationIdea: prospect.cooperationIdea,
          priority: prospect.priority,
          brandName: settings.brandName,
          senderName: settings.senderName,
          emailSignature: settings.emailSignature,
          preferredLanguage: prospect.language || settings.youtubeDefaultLanguage || 'en',
          userPreference,
          outreachPrompt: settings.aiOutreachPrompt,
          modelProvider: settings.modelProvider,
          customApiUrl: settings.customApiUrl,
          customApiKey: settings.customApiKey,
          customModelName: settings.customModelName,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(getErrorMessage(result, '开发信生成失败。'));
      const draft = result.data as OutreachDraft;
      updateProspect(prospect.id, { aiDraft: draft, workflowStatus: 'outreach_generated', error: undefined });
      await syncFeishuProspect(prospect, { workflowStatus: 'outreach_generated', aiDraft: draft });
      toast.success(`已生成 ${prospect.title || '该频道'} 的开发信。`);
    } catch (error) {
      updateProspect(prospect.id, { error: error instanceof Error ? error.message : '开发信生成失败。' });
      toast.error(error instanceof Error ? error.message : '开发信生成失败。');
    } finally {
      setGeneratingId(null);
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
      if (!response.ok || !result.success) throw new Error(getErrorMessage(result, '保存 Gmail 草稿失败。'));
      const gmailDraftId = String(result.data?.id || result.data?.message?.id || '');
      const patch: Partial<Prospect> = {
        workflowStatus: 'gmail_draft_saved',
        gmailDraftId,
        error: undefined,
      };
      updateProspect(prospect.id, patch);
      const synced = await syncFeishuProspect(prospect, patch);
      toast[ synced ? 'success' : 'warning' ](
        synced
          ? 'Gmail 草稿已保存，飞书状态已更新。请前往 Gmail 手动检查和发送。'
          : 'Gmail 草稿已保存，但飞书状态同步失败。邮件没有被自动发送。',
      );
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
            prospects={prospects}
            selectedIds={selectedIds}
            input={input}
            preference={userPreference}
            resolving={resolving}
            checkingDedupe={checkingDedupe}
            writingFeishu={writingFeishu}
            onInputChange={setInput}
            onPreferenceChange={setUserPreference}
            onResolve={handleResolve}
            onCheckDedupe={handleCheckDedupe}
            onCreateRecords={openFeishuPreview}
            onConfirmInvitation={handleConfirmInvitation}
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
              duplicateConfirmedUnique: true,
              duplicateReason: '疑似重复已由人工确认可创建',
            })}
            onUseExisting={(id) => {
              const prospect = prospects.find((item) => item.id === id);
              if (!prospect?.duplicateRecordId) return;
              updateProspect(id, {
                workflowStatus: 'dedupe_completed',
                feishuRecordId: prospect.duplicateRecordId,
                duplicateReason: '已关联飞书现有记录，不会重复创建',
              });
              toast.success('已关联飞书现有记录，可以继续确认邀约方向。');
            }}
            onRemove={(id) => {
              setProspects((current) => current.filter((item) => item.id !== id));
              setSelectedIds((current) => current.filter((item) => item !== id));
            }}
            onClearInput={() => setInput('')}
          />
        )}
        {activeTab === 'invitation' && (
          <InvitationConfirmTab
            prospects={invitationProspects}
            productOptions={productOptions}
            checkingHistoryId={checkingHistoryId}
            onPatch={updateProspect}
            onSave={handleSaveInvitation}
            onConfirmOutreach={handleConfirmOutreach}
            onBack={handleBackToImport}
            onSkip={handleSkip}
            onCheckHistory={handleCheckHistory}
          />
        )}
        {activeTab === 'outreach' && (
          <OutreachEmailTab
            prospects={outreachProspects}
            generatingId={generatingId}
            savingDraftId={savingDraftId}
            onPatch={updateProspect}
            onGenerate={handleGenerateOutreach}
            onSaveDraft={handleSaveGmailDraft}
            onBack={handleBackToInvitation}
            onSkip={handleSkip}
          />
        )}
      </main>

      <Dialog open={previewItems.length > 0} onOpenChange={(open) => !open && setPreviewItems([])}>
        <DialogContent className="max-h-[82vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>确认新建飞书线索记录</DialogTitle>
            <DialogDescription>
              已通过查重的线索才会出现在这里。确认后将逐条创建，单条失败不会影响其他记录。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 overflow-auto rounded-lg border bg-slate-50/80">
            {previewItems.map((item) => (
              <div key={item.prospect.id} className="border-b p-3 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{item.prospect.title || item.prospect.inputUrl}</p>
                  <Badge variant="outline">{Object.keys(item.fields).length} 个字段</Badge>
                </div>
                <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                  {Object.entries(item.fields).map(([key, value]) => (
                    <div key={key} className="rounded-md bg-white px-2 py-1.5">
                      <dt className="text-xs text-muted-foreground">{key}</dt>
                      <dd className="mt-0.5 max-h-16 overflow-auto whitespace-pre-wrap">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewItems([])} disabled={writingFeishu}>取消</Button>
            <Button onClick={confirmWriteFeishu} disabled={writingFeishu}>
              {writingFeishu ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
              确认新建 {previewItems.length} 条
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
