export const CREATOR_PROSPECTS_STORAGE_KEY = 'influencer-board-creator-prospects';
export const CREATOR_PROSPECTS_SCHEMA_VERSION = 2;

export type ProspectingTab = 'import' | 'invitation' | 'outreach';

export type ProspectWorkflowStatus =
  | 'recorded'
  | 'resolved'
  | 'dedupe_completed'
  | 'invitation_pending'
  | 'outreach_pending'
  | 'outreach_generated'
  | 'gmail_draft_saved'
  | 'duplicate'
  | 'skipped'
  | 'error';

export type ProspectEmailStatus = 'available' | 'manual' | 'missing';
export type ProspectDedupeStatus =
  | 'unchecked'
  | 'checking'
  | 'unique'
  | 'suspected'
  | 'duplicate'
  | 'error';
export type ProspectPriority = 'high' | 'medium' | 'low';

export type RecentVideo = {
  videoId?: string;
  title: string;
  description?: string;
  publishedAt?: string;
  thumbnail?: string;
  url?: string;
  viewCount?: number | null;
};

export type OutreachDraft = {
  subject: string;
  body: string;
  translatedBody?: string;
  translatedSummary?: string;
  personalizationNotes?: string[];
  riskNotes?: string[];
  missingInfo?: string[];
  language?: string;
  tone?: string;
};

export type Prospect = {
  schemaVersion: number;
  id: string;
  inputUrl: string;
  sourceUrl?: string;
  channelId?: string;
  title?: string;
  description?: string;
  customUrl?: string;
  country?: string;
  language?: string;
  languageSource?: 'youtube' | 'inferred' | 'manual';
  avatarUrl?: string;
  subscriberCount?: number | null;
  viewCount?: number | null;
  videoCount?: number | null;
  recentAverageViews?: number | null;
  url?: string;
  publicEmail?: string;
  recentVideos?: RecentVideo[];
  workflowStatus: ProspectWorkflowStatus;
  emailStatus: ProspectEmailStatus;
  dedupeStatus: ProspectDedupeStatus;
  duplicateReason?: string;
  duplicateRecordId?: string;
  duplicateConfirmedUnique?: boolean;
  feishuRecordId?: string;
  targetProduct?: string;
  cooperationType?: string;
  cooperationIdea?: string;
  priority?: ProspectPriority;
  contactedBefore?: boolean;
  collaboratedBefore?: boolean;
  competitorCollaboration?: 'yes' | 'no' | 'suspected' | 'unknown';
  historyChecked?: boolean;
  gmailDraftId?: string;
  aiDraft?: OutreachDraft;
  error?: string;
  syncError?: string;
  createdAt: string;
  updatedAt: string;
};

type LegacyProspect = Partial<Prospect> & {
  id?: string;
  inputUrl?: string;
  status?: string;
};

export const WORKFLOW_META: Record<ProspectWorkflowStatus, { label: string; className: string }> = {
  recorded: { label: '已录入', className: 'border-slate-200 bg-slate-50 text-slate-700' },
  resolved: { label: '已识别', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  dedupe_completed: { label: '飞书查重完成', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  invitation_pending: { label: '待确认邀约方向', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  outreach_pending: { label: '待生成开发信', className: 'border-indigo-200 bg-indigo-50 text-indigo-700' },
  outreach_generated: { label: '开发信已生成', className: 'border-violet-200 bg-violet-50 text-violet-700' },
  gmail_draft_saved: { label: 'Gmail 草稿已保存', className: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  duplicate: { label: '重复记录', className: 'border-red-200 bg-red-50 text-red-700' },
  skipped: { label: '已跳过', className: 'border-slate-200 bg-slate-100 text-slate-500' },
  error: { label: '处理失败', className: 'border-red-200 bg-red-50 text-red-700' },
};

export const DEDUPE_META: Record<ProspectDedupeStatus, { label: string; className: string }> = {
  unchecked: { label: '未查重', className: 'text-slate-500' },
  checking: { label: '查重中', className: 'text-blue-600' },
  unique: { label: '未记录', className: 'text-emerald-700' },
  suspected: { label: '疑似重复', className: 'text-amber-700' },
  duplicate: { label: '已存在', className: 'text-red-700' },
  error: { label: '查重失败', className: 'text-red-700' },
};

export const COOPERATION_TYPES = [
  '送样测评',
  '送样+联盟',
  '付费测评',
  '联盟营销',
  'PR媒体测评',
  '长期合作',
];

export const FALLBACK_PRODUCT_OPTIONS = [
  'Nomad1800 Pro',
  'P280',
  'P310',
  'P210',
  'Nano100',
  '太阳能板组合',
  '其他',
];

export const COUNTRY_LABELS: Record<string, string> = {
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

export function normalizeYouTubeKey(value: string) {
  return String(value || '')
    .trim()
    .replace(/[<>"'，,。]+$/g, '')
    .replace(/^["'<]+/g, '')
    .replace(/[?#].*$/g, '')
    .replace(/^https?:\/\/(www\.|m\.)?/i, '')
    .replace(/\/+$/g, '')
    .replace(/\/(about|community|featured|playlists|shorts|streams|videos)$/i, '')
    .toLowerCase();
}

export function extractYouTubeInputs(text: string) {
  const accepted = text
    .split(/[\s,，]+/g)
    .map((item) => item.trim().replace(/^["'<]+|[>"'。]+$/g, ''))
    .filter((item) => {
      const lower = item.toLowerCase();
      return lower.includes('youtube.com')
        || lower.includes('youtu.be')
        || item.startsWith('@')
        || /^UC[\w-]{20,}$/i.test(item);
    });
  return Array.from(new Map(accepted.map((item) => [normalizeYouTubeKey(item), item])).values());
}

export function formatCompactNumber(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function countryLabel(code?: string) {
  if (!code) return '未知';
  return COUNTRY_LABELS[code.toUpperCase()] || code.toUpperCase();
}

export function inferLanguage(prospect: Pick<Prospect, 'title' | 'description' | 'recentVideos' | 'country'>) {
  const text = [
    prospect.title,
    prospect.description,
    ...(prospect.recentVideos || []).map((video) => `${video.title} ${video.description || ''}`),
  ].join(' ').toLowerCase();
  const scores: Record<string, number> = {
    es: (text.match(/\b(el|la|los|las|para|con|viaje|coche|gracias|hola)\b/g) || []).length,
    pt: (text.match(/\b(uma|para|com|viagem|carro|obrigado|olá)\b/g) || []).length,
    nl: (text.match(/\b(het|een|voor|met|reizen|auto|bedankt)\b/g) || []).length,
    de: (text.match(/\b(der|die|das|für|mit|reise|auto|danke)\b/g) || []).length,
    fr: (text.match(/\b(le|la|les|pour|avec|voyage|voiture|merci)\b/g) || []).length,
    en: (text.match(/\b(the|and|for|with|travel|review|thanks)\b/g) || []).length,
  };
  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (winner?.[1] > 0) return winner[0];
  const countryFallback: Record<string, string> = { ES: 'es', PT: 'pt', NL: 'nl', DE: 'de', FR: 'fr', IT: 'it', GB: 'en', US: 'en' };
  return countryFallback[String(prospect.country || '').toUpperCase()] || '';
}

export function calculateRecentAverageViews(videos?: RecentVideo[]) {
  const values = (videos || [])
    .map((video) => video.viewCount)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function migrateProspects(value: unknown): Prospect[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw, index) => {
    const item = (raw || {}) as LegacyProspect;
    const legacyStatusMap: Record<string, ProspectWorkflowStatus> = {
      pending: 'recorded',
      resolved: 'resolved',
      needs_review: 'resolved',
      added_to_feishu: 'dedupe_completed',
      draft_generated: item.gmailDraftId ? 'gmail_draft_saved' : 'outreach_generated',
      error: 'error',
    };
    const now = new Date().toISOString();
    const workflowStatus = item.status === 'added_to_feishu' && !item.feishuRecordId
      ? 'resolved'
      : item.workflowStatus || legacyStatusMap[item.status || ''] || 'recorded';
    const publicEmail = String(item.publicEmail || '').trim();
    return {
      ...item,
      schemaVersion: CREATOR_PROSPECTS_SCHEMA_VERSION,
      id: item.id || `prospect-${Date.now()}-${index}`,
      inputUrl: item.inputUrl || item.url || item.sourceUrl || '',
      workflowStatus,
      emailStatus: item.emailStatus || (publicEmail ? 'available' : 'missing'),
      dedupeStatus: item.status === 'added_to_feishu' && !item.feishuRecordId
        ? 'unchecked'
        : item.dedupeStatus || (
        ['dedupe_completed', 'invitation_pending', 'outreach_pending', 'outreach_generated', 'gmail_draft_saved'].includes(workflowStatus)
          ? 'unique'
          : 'unchecked'
        ),
      publicEmail,
      competitorCollaboration: item.competitorCollaboration || 'unknown',
      recentAverageViews: item.recentAverageViews ?? calculateRecentAverageViews(item.recentVideos),
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now,
    } as Prospect;
  }).filter((item) => Boolean(item.inputUrl));
}

export function canCreateFeishuRecord(prospect: Prospect) {
  return prospect.workflowStatus === 'resolved'
    && prospect.dedupeStatus === 'unique'
    && !prospect.feishuRecordId;
}

export function canConfirmInvitation(prospect: Prospect) {
  return prospect.workflowStatus === 'dedupe_completed' && Boolean(prospect.feishuRecordId);
}

export function canGenerateOutreach(prospect: Prospect) {
  return prospect.workflowStatus === 'outreach_pending'
    && Boolean(prospect.targetProduct?.trim())
    && Boolean(prospect.cooperationType?.trim())
    && Boolean(prospect.cooperationIdea?.trim());
}
