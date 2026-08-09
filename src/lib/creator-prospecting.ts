import type {
  ProspectEmailCandidate,
  ProspectEmailSource,
} from './prospect-email-selection';

export const CREATOR_PROSPECTS_STORAGE_KEY = 'influencer-board-creator-prospects';
export const CREATOR_PROSPECTS_DELETED_STORAGE_KEY = 'influencer-board-creator-prospects-deleted';
export const CREATOR_PROSPECTS_SCHEMA_VERSION = 7;

export type ProspectingTab = 'import' | 'invitation' | 'outreach' | 'follow_up';

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
  | 'conflict'
  | 'duplicate'
  | 'error';
export type ProspectResourceStatus =
  | 'unchecked'
  | 'checking'
  | 'exists'
  | 'suspected'
  | 'conflict'
  | 'missing'
  | 'error';
export type ProspectDevelopmentStatus =
  | 'unchecked'
  | 'checking'
  | 'exists'
  | 'history_exists'
  | 'suspected'
  | 'conflict'
  | 'missing'
  | 'error';
export type ProspectPriority = 'high' | 'medium' | 'low';

export type RecentVideo = {
  videoId?: string;
  title: string;
  translatedTitle?: string;
  description?: string;
  publishedAt?: string;
  thumbnail?: string;
  url?: string;
  viewCount?: number | null;
  likeCount?: number | null;
  commentCount?: number | null;
  durationSeconds?: number | null;
};

export type OutreachDraft = {
  subject: string;
  subjectOptions?: Array<{
    subject: string;
    translatedSubject: string;
  }>;
  body: string;
  productImagePlacement?: number;
  productImageIncluded?: boolean;
  translatedBody?: string;
  translatedSummary?: string;
  personalizationNotes?: string[];
  riskNotes?: string[];
  missingInfo?: string[];
  language?: string;
  tone?: string;
};

export type OutreachGenerationStage =
  | 'preparing'
  | 'streaming_body'
  | 'finalizing'
  | 'completed'
  | 'error';

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
  emailSource?: ProspectEmailSource;
  emailCandidates?: ProspectEmailCandidate[];
  emailManuallyLocked?: boolean;
  emailSelectionRequired?: boolean;
  recentVideos?: RecentVideo[];
  youtubeDataStatus?: 'complete' | 'partial' | 'error';
  youtubeDataWarnings?: string[];
  youtubeLastFetchedAt?: string;
  recentVideosStatus?: 'ready' | 'empty' | 'error';
  descriptionStatus?: 'ready' | 'empty';
  workflowStatus: ProspectWorkflowStatus;
  emailStatus: ProspectEmailStatus;
  dedupeStatus: ProspectDedupeStatus;
  duplicateReason?: string;
  duplicateRecordId?: string;
  previousDevelopmentRecordId?: string;
  repeatOutreach?: boolean;
  previousProspectId?: string;
  duplicateConfirmedUnique?: boolean;
  resourceMatchPreview?: {
    recordId: string;
    matchReason: string;
    channelName?: string;
    channelUrl?: string;
    email?: string;
    region?: string;
    platform?: string;
    notes?: string;
  };
  developmentMatchPreview?: {
    recordId: string;
    matchReason: string;
    email?: string;
  };
  resourceStatus: ProspectResourceStatus;
  developmentStatus: ProspectDevelopmentStatus;
  resourceRecordId?: string;
  feishuRecordId?: string;
  targetProduct?: string;
  cooperationType?: string;
  cooperationIdea?: string;
  cooperationIdeaSource?: 'ai' | 'manual';
  cooperationIdeaContextKey?: string;
  contactName?: string;
  contactNameConfidence?: number;
  contactNameSource?: 'ai' | 'manual';
  contactNameInferenceStatus?: 'loading' | 'found' | 'not_found' | 'error';
  outreachLanguage?: string;
  outreachLanguageConfidence?: number;
  outreachLanguageSource?: 'ai' | 'manual';
  outreachLanguageInferenceStatus?: 'loading' | 'found' | 'not_found' | 'error';
  priority?: ProspectPriority;
  contactedBefore?: boolean;
  collaboratedBefore?: boolean;
  competitorCollaboration?: 'yes' | 'no' | 'suspected' | 'unknown';
  historyChecked?: boolean;
  gmailDraftId?: string;
  aiDraft?: OutreachDraft;
  outreachGenerationStage?: OutreachGenerationStage;
  streamingBody?: string;
  generationError?: string;
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
  conflict: { label: '匹配冲突', className: 'text-red-700' },
  duplicate: { label: '已存在', className: 'text-red-700' },
  error: { label: '查重失败', className: 'text-red-700' },
};

export const RESOURCE_STATUS_META: Record<ProspectResourceStatus, { label: string; className: string }> = {
  unchecked: { label: '资源库未查', className: 'text-slate-500' },
  checking: { label: '资源库查重中', className: 'text-blue-600' },
  exists: { label: '资源库已收录', className: 'text-emerald-700' },
  suspected: { label: '资源库疑似收录', className: 'text-amber-700' },
  conflict: { label: '资源库匹配冲突', className: 'text-red-700' },
  missing: { label: '资源库未收录', className: 'text-amber-700' },
  error: { label: '资源库读取失败', className: 'text-red-700' },
};

export const DEVELOPMENT_STATUS_META: Record<ProspectDevelopmentStatus, { label: string; className: string }> = {
  unchecked: { label: '开发记录未查', className: 'text-slate-500' },
  checking: { label: '开发记录查重中', className: 'text-blue-600' },
  exists: { label: '已有开发记录', className: 'text-emerald-700' },
  history_exists: { label: '已有历史记录，本次将新建', className: 'text-amber-700' },
  suspected: { label: '疑似已有开发记录', className: 'text-amber-700' },
  conflict: { label: '开发记录匹配冲突', className: 'text-red-700' },
  missing: { label: '可新建开发记录', className: 'text-blue-700' },
  error: { label: '开发记录读取失败', className: 'text-red-700' },
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
  AD: '安道尔',
  AL: '阿尔巴尼亚',
  AM: '亚美尼亚',
  AT: '奥地利',
  AU: '澳大利亚',
  AX: '奥兰群岛',
  AZ: '阿塞拜疆',
  BA: '波斯尼亚和黑塞哥维那',
  BE: '比利时',
  BG: '保加利亚',
  BY: '白俄罗斯',
  CA: '加拿大',
  CH: '瑞士',
  CY: '塞浦路斯',
  CZ: '捷克',
  DE: '德国',
  DK: '丹麦',
  EE: '爱沙尼亚',
  ES: '西班牙',
  FI: '芬兰',
  FO: '法罗群岛',
  FR: '法国',
  GB: '英国',
  GE: '格鲁吉亚',
  GG: '根西岛',
  GI: '直布罗陀',
  GR: '希腊',
  HR: '克罗地亚',
  HU: '匈牙利',
  IE: '爱尔兰',
  IM: '马恩岛',
  IS: '冰岛',
  IT: '意大利',
  JE: '泽西岛',
  JP: '日本',
  KR: '韩国',
  KZ: '哈萨克斯坦',
  LI: '列支敦士登',
  LT: '立陶宛',
  LU: '卢森堡',
  LV: '拉脱维亚',
  MC: '摩纳哥',
  MD: '摩尔多瓦',
  ME: '黑山',
  MK: '北马其顿',
  MT: '马耳他',
  NL: '荷兰',
  NO: '挪威',
  PL: '波兰',
  PT: '葡萄牙',
  RO: '罗马尼亚',
  RS: '塞尔维亚',
  RU: '俄罗斯',
  SE: '瑞典',
  SI: '斯洛文尼亚',
  SJ: '斯瓦尔巴和扬马延',
  SK: '斯洛伐克',
  SM: '圣马力诺',
  TR: '土耳其',
  UA: '乌克兰',
  UK: '英国',
  US: '美国',
  VA: '梵蒂冈',
  XK: '科索沃',
};

const ZH_REGION_DISPLAY_NAMES = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['zh-CN'], { type: 'region' })
  : null;

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
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) return '未知';
  const configuredLabel = COUNTRY_LABELS[normalized];
  if (configuredLabel) return configuredLabel;
  if (/^[A-Z]{2}$/.test(normalized) && ZH_REGION_DISPLAY_NAMES) {
    const localizedLabel = ZH_REGION_DISPLAY_NAMES.of(normalized);
    if (localizedLabel && localizedLabel !== normalized) return localizedLabel;
  }
  return normalized;
}

export function inferLanguage(prospect: Pick<Prospect, 'title' | 'description' | 'recentVideos' | 'country'>) {
  const countryCode = String(prospect.country || '').trim().toUpperCase();
  const text = [
    prospect.title,
    prospect.description,
    ...(prospect.recentVideos || []).map((video) => `${video.title} ${video.description || ''}`),
  ]
    .join(' ')
    .toLowerCase()
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, ' ');

  if (/[іїєґ]/i.test(text)) return 'uk';
  if (/[ыэёъ]/i.test(text)) return 'ru';
  const cyrillicCount = (text.match(/[\u0400-\u04ff]/g) || []).length;
  if (cyrillicCount >= 3) {
    if (countryCode === 'UA') return 'uk';
    if (['BY', 'KZ', 'RU'].includes(countryCode)) return 'ru';
  }

  const scores: Record<string, number> = {
    es: (text.match(/\b(el|la|los|las|para|con|viaje|coche|gracias|hola)\b/g) || []).length,
    pt: (text.match(/\b(uma|não|você|também|para|viagem|carro|obrigado|olá)\b/g) || []).length,
    nl: (text.match(/\b(het|een|voor|met|reizen|auto|bedankt)\b/g) || []).length,
    de: (text.match(/\b(der|die|das|für|mit|reise|auto|danke)\b/g) || []).length,
    fr: (text.match(/\b(le|la|les|pour|avec|voyage|voiture|merci)\b/g) || []).length,
    en: (text.match(/\b(the|and|for|with|travel|review|thanks)\b/g) || []).length,
  };
  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  if (winner?.[1] > 0) return winner[0];
  const countryFallback: Record<string, string> = {
    AT: 'de',
    BE: 'nl',
    BG: 'bg',
    CA: 'en',
    CH: 'de',
    CZ: 'cs',
    DE: 'de',
    DK: 'da',
    ES: 'es',
    FI: 'fi',
    FR: 'fr',
    GB: 'en',
    GR: 'el',
    HU: 'hu',
    IE: 'en',
    IT: 'it',
    NL: 'nl',
    NO: 'no',
    PL: 'pl',
    PT: 'pt',
    RO: 'ro',
    RU: 'ru',
    SE: 'sv',
    SK: 'sk',
    TR: 'tr',
    UA: 'uk',
    UK: 'en',
    US: 'en',
  };
  return countryFallback[countryCode] || '';
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
    const legacySingleTableRecord = (item.schemaVersion || 0) < 3 && Boolean(item.feishuRecordId);
    const legacyStatusMap: Record<string, ProspectWorkflowStatus> = {
      pending: 'recorded',
      resolved: 'resolved',
      needs_review: 'resolved',
      added_to_feishu: 'dedupe_completed',
      draft_generated: item.gmailDraftId ? 'gmail_draft_saved' : 'outreach_generated',
      error: 'error',
    };
    const now = new Date().toISOString();
    const migratedWorkflowStatus = item.status === 'added_to_feishu' && !item.feishuRecordId
      ? 'resolved'
      : item.workflowStatus || legacyStatusMap[item.status || ''] || 'recorded';
    const workflowStatus = legacySingleTableRecord && migratedWorkflowStatus === 'dedupe_completed'
      ? 'resolved'
      : migratedWorkflowStatus;
    const publicEmail = String(item.publicEmail || '').trim();
    const repairedLanguage = item.languageSource !== 'manual' && item.language === 'pt'
      ? inferLanguage(item) || item.language
      : item.language;
    const shouldRepairOutreachLanguage = item.outreachLanguageSource !== 'manual'
      && item.outreachLanguage === 'pt'
      && repairedLanguage !== 'pt';
    return {
      ...item,
      schemaVersion: CREATOR_PROSPECTS_SCHEMA_VERSION,
      id: item.id || `prospect-${Date.now()}-${index}`,
      inputUrl: item.inputUrl || item.url || item.sourceUrl || '',
      workflowStatus,
      emailStatus: item.emailStatus || (publicEmail ? 'available' : 'missing'),
      emailSource: item.emailSource || (item.emailStatus === 'manual'
        ? 'manual'
        : publicEmail ? 'youtube' : undefined),
      emailCandidates: item.emailCandidates || (
        publicEmail && item.emailStatus !== 'manual'
          ? [{ email: publicEmail, sources: ['youtube'] }]
          : []
      ),
      emailManuallyLocked: item.emailManuallyLocked || item.emailStatus === 'manual',
      emailSelectionRequired: Boolean(item.emailSelectionRequired),
      dedupeStatus: item.status === 'added_to_feishu' && !item.feishuRecordId
        ? 'unchecked'
        : item.dedupeStatus || (
        ['dedupe_completed', 'invitation_pending', 'outreach_pending', 'outreach_generated', 'gmail_draft_saved'].includes(workflowStatus)
          ? 'unique'
          : 'unchecked'
        ),
      resourceStatus: item.resourceStatus || (
        legacySingleTableRecord ? 'exists'
          : item.dedupeStatus === 'duplicate' ? 'exists'
          : item.dedupeStatus === 'suspected' ? 'suspected'
            : item.dedupeStatus === 'unique' ? 'missing'
              : 'unchecked'
      ),
      developmentStatus: item.developmentStatus || (
        legacySingleTableRecord ? 'unchecked' : item.feishuRecordId ? 'exists' : 'unchecked'
      ),
      resourceRecordId: item.resourceRecordId || (legacySingleTableRecord ? item.feishuRecordId : undefined),
      feishuRecordId: legacySingleTableRecord ? undefined : item.feishuRecordId,
      publicEmail,
      language: repairedLanguage,
      languageSource: item.languageSource !== 'manual' && repairedLanguage && repairedLanguage !== item.language
        ? 'inferred'
        : item.languageSource,
      outreachLanguage: shouldRepairOutreachLanguage ? repairedLanguage : item.outreachLanguage,
      outreachLanguageConfidence: shouldRepairOutreachLanguage
        ? undefined
        : item.outreachLanguageConfidence,
      outreachLanguageSource: shouldRepairOutreachLanguage
        ? undefined
        : item.outreachLanguageSource,
      contactNameInferenceStatus: item.contactNameInferenceStatus === 'loading'
        ? undefined
        : item.contactNameInferenceStatus,
      outreachLanguageInferenceStatus: shouldRepairOutreachLanguage
        ? undefined
        : item.outreachLanguageInferenceStatus === 'loading'
        ? undefined
        : item.outreachLanguageInferenceStatus,
      outreachGenerationStage: ['preparing', 'streaming_body', 'finalizing'].includes(item.outreachGenerationStage || '')
        ? undefined
        : item.outreachGenerationStage,
      streamingBody: ['preparing', 'streaming_body', 'finalizing'].includes(item.outreachGenerationStage || '')
        ? undefined
        : item.streamingBody,
      generationError: ['preparing', 'streaming_body', 'finalizing'].includes(item.outreachGenerationStage || '')
        ? undefined
        : item.generationError,
      competitorCollaboration: item.competitorCollaboration || 'unknown',
      recentAverageViews: item.recentAverageViews ?? calculateRecentAverageViews(item.recentVideos),
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || now,
    } as Prospect;
  }).filter((item) => Boolean(item.inputUrl));
}

export function canCreateFeishuRecord(prospect: Prospect) {
  return prospect.workflowStatus === 'resolved'
    && !prospect.emailSelectionRequired
    && prospect.resourceStatus !== 'unchecked'
    && prospect.resourceStatus !== 'checking'
    && prospect.resourceStatus !== 'error'
    && prospect.resourceStatus !== 'suspected'
    && ['missing', 'history_exists'].includes(prospect.developmentStatus)
    && !prospect.feishuRecordId;
}

export function canConfirmInvitation(prospect: Prospect) {
  return prospect.workflowStatus === 'dedupe_completed'
    && !prospect.emailSelectionRequired
    && prospect.developmentStatus === 'exists'
    && Boolean(prospect.feishuRecordId);
}

export function canGenerateOutreach(prospect: Prospect) {
  return prospect.workflowStatus === 'outreach_pending'
    && !prospect.emailSelectionRequired
    && Boolean(prospect.targetProduct?.trim())
    && Boolean(prospect.cooperationType?.trim())
    && Boolean(prospect.cooperationIdea?.trim())
    && Boolean(prospect.outreachLanguage?.trim());
}
