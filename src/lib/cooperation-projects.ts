import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';
import type { CachedFeishuRecord } from '@/lib/feishu-record-cache';

export const COOPERATION_STAGES = [
  'confirmed',
  'waiting_shipment',
  'in_transit',
  'arrived',
  'filming',
  'filming_complete',
  'published',
] as const;

export type CooperationStage = (typeof COOPERATION_STAGES)[number];
export type CooperationRiskLevel = 'overdue' | 'error' | 'warning';
export type CooperationMilestoneState = 'complete' | 'current' | 'pending' | 'skipped';

export const COOPERATION_STAGE_META: Record<CooperationStage, {
  label: string;
  shortLabel: string;
  colorClass: string;
  dotClass: string;
}> = {
  confirmed: {
    label: '合作已确认',
    shortLabel: '已确认',
    colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    dotClass: 'bg-emerald-500',
  },
  waiting_shipment: {
    label: '待发货',
    shortLabel: '待发货',
    colorClass: 'bg-amber-50 text-amber-700 border-amber-200',
    dotClass: 'bg-amber-500',
  },
  in_transit: {
    label: '运输中',
    shortLabel: '运输中',
    colorClass: 'bg-sky-50 text-sky-700 border-sky-200',
    dotClass: 'bg-sky-500',
  },
  arrived: {
    label: '已到货',
    shortLabel: '已到货',
    colorClass: 'bg-cyan-50 text-cyan-700 border-cyan-200',
    dotClass: 'bg-cyan-500',
  },
  filming: {
    label: '视频拍摄中',
    shortLabel: '拍摄中',
    colorClass: 'bg-blue-50 text-blue-700 border-blue-200',
    dotClass: 'bg-blue-500',
  },
  filming_complete: {
    label: '视频拍摄完成',
    shortLabel: '拍摄完成',
    colorClass: 'bg-violet-50 text-violet-700 border-violet-200',
    dotClass: 'bg-violet-500',
  },
  published: {
    label: '视频已发布',
    shortLabel: '已发布',
    colorClass: 'bg-green-50 text-green-700 border-green-200',
    dotClass: 'bg-green-600',
  },
};

export type CooperationRisk = {
  code: string;
  label: string;
  level: CooperationRiskLevel;
};

export type CooperationMilestone = {
  stage: CooperationStage;
  label: string;
  date?: number;
  inferred?: boolean;
  state: CooperationMilestoneState;
  note?: string;
};

export type CooperationProject = {
  id: string;
  channelName: string;
  email: string;
  channelUrl: string;
  channelId: string;
  avatarUrl?: string;
  emailCandidates?: string[];
  platform: string;
  region: string;
  product: string;
  site: string;
  owner: string;
  operator: string;
  cooperationType: string;
  cooperationCount: string;
  followers: string;
  sampleProvided: boolean | null;
  cooperationDate?: number;
  shippingDate?: number;
  arrivalDate?: number;
  filmingStartDate?: number;
  filmingCompleteDate?: number;
  expectedPublishDate?: number;
  actualPublishDate?: number;
  shippingAddress: string;
  shippingTracking: string;
  discountCode: string;
  logisticsNotified: boolean;
  discountNotified: boolean;
  originalCurrencyCost: string;
  cnyCost: string;
  publishedVideoUrl: string;
  exposureCount: string;
  commentCount: string;
  likeCount: string;
  stage: CooperationStage;
  stageDate?: number;
  stageDateInferred: boolean;
  nextAction: string;
  risks: CooperationRisk[];
  milestones: CooperationMilestone[];
  rawFields: Record<string, unknown>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const FIELD_ALIASES: Partial<Record<FeishuFieldKey, string[]>> = {
  channelName: ['红人频道名字', '红人频道名', '频道名称'],
  email: ['联系邮箱', '邮箱', 'email'],
  channelUrl: ['红人频道主页链接', '频道链接', 'YouTube主页链接'],
  channelId: ['YouTube Channel ID', '频道ID', '频道 ID'],
  promotionPlatform: ['推广平台'],
  region: ['国家', '地区'],
  followers: ['粉丝量', '粉丝数'],
  cooperationDate: ['合作日期'],
  cooperationProduct: ['合作产品'],
  cooperationSite: ['合作站点'],
  promotionOwner: ['推广负责人'],
  operator: ['运营'],
  cooperationType: ['合作类型', '合作形式'],
  cooperationCount: ['第几次合作次数', '合作次数'],
  sampleProvided: ['是否提供样品'],
  expectedPublishDate: ['预计发布视频的时间', '预计上线时间'],
  shippingAddress: ['发货地址'],
  shippingDate: ['发货时间'],
  arrivalDate: ['到货时间'],
  filmingCompleteDate: ['视频拍摄完成时间'],
  shippingTracking: ['运输追踪信息'],
  discountCode: ['折扣码信息', '折扣码', '优惠码', 'discount'],
  logisticsNotified: ['物流信息已告知'],
  discountNotified: ['折扣信息已告知'],
  actualPublishDate: ['实际上线日期'],
  publishedVideoUrl: ['视频上线链接'],
  originalCurrencyCost: ['合作费用（原币）', '合作费用(原币)'],
  cnyCost: ['合作费用（人民币）', '合作费用(人民币)'],
  exposureCount: ['曝光量'],
  commentCount: ['评论量'],
  likeCount: ['点赞量'],
};

function normalizeFieldName(value: string) {
  return value
    .toLowerCase()
    .replace(/[（）()]/g, '')
    .replace(/[\s_\-:：/、，,。·.]/g, '');
}

export function flattenFeishuValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(flattenFeishuValue).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    const preferred = item.text ?? item.name ?? item.email ?? item.link ?? item.url ?? item.value;
    if (preferred !== undefined) return flattenFeishuValue(preferred);
    return Object.values(item).map(flattenFeishuValue).filter(Boolean).join(' ');
  }
  return '';
}

function resolveFieldName(
  record: CachedFeishuRecord,
  mapping: FeishuFieldMapping,
  key: FeishuFieldKey,
) {
  const mapped = mapping[key];
  if (mapped && Object.prototype.hasOwnProperty.call(record.fields, mapped)) return mapped;

  const aliases = FIELD_ALIASES[key] || [];
  const normalizedAliases = new Set(aliases.map(normalizeFieldName));
  return Object.keys(record.fields).find((fieldName) => normalizedAliases.has(normalizeFieldName(fieldName)));
}

function rawMappedValue(
  record: CachedFeishuRecord,
  mapping: FeishuFieldMapping,
  key: FeishuFieldKey,
) {
  const fieldName = resolveFieldName(record, mapping, key);
  return fieldName ? record.fields[fieldName] : undefined;
}

function mappedText(
  record: CachedFeishuRecord,
  mapping: FeishuFieldMapping,
  key: FeishuFieldKey,
) {
  return flattenFeishuValue(rawMappedValue(record, mapping, key)).trim();
}

function extractUrl(value: unknown): string {
  if (typeof value === 'string') {
    const match = value.match(/https?:\/\/[^\s<>"]+/i);
    return match?.[0] || '';
  }
  if (Array.isArray(value)) return value.map(extractUrl).find(Boolean) || '';
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return [item.link, item.url, item.text, item.value]
      .map(extractUrl)
      .find(Boolean) || '';
  }
  return '';
}

export function parseFeishuDate(value: unknown) {
  const text = flattenFeishuValue(value).trim();
  if (!text) return undefined;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = new Date(text).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFeishuBoolean(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const text = flattenFeishuValue(value).trim().toLowerCase();
  if (!text) return false;
  return /^(true|yes|y|1|是|已勾选|已告知|完成)$/.test(text);
}

function parseSampleProvided(value: unknown): boolean | null {
  if (value === null || value === undefined || flattenFeishuValue(value).trim() === '') return null;
  if (typeof value === 'boolean') return value;
  const text = flattenFeishuValue(value).trim().toLowerCase();
  if (/^(false|no|n|0|否|不提供|无需|不需要)$/.test(text)) return false;
  if (/^(true|yes|y|1|是|提供|需要)$/.test(text)) return true;
  return null;
}

function startOfDay(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function stageIndex(stage: CooperationStage) {
  return COOPERATION_STAGES.indexOf(stage);
}

function isReached(value: number | undefined, endOfToday: number) {
  return Boolean(value && value <= endOfToday);
}

function calculateStage(input: {
  sampleProvided: boolean | null;
  cooperationDate?: number;
  shippingDate?: number;
  arrivalDate?: number;
  filmingCompleteDate?: number;
  actualPublishDate?: number;
}, now: number): CooperationStage {
  const today = startOfDay(now);
  const endOfToday = today + DAY_MS - 1;
  if (isReached(input.actualPublishDate, endOfToday)) return 'published';
  if (isReached(input.filmingCompleteDate, endOfToday)) return 'filming_complete';
  if (isReached(input.arrivalDate, endOfToday)) {
    return startOfDay(input.arrivalDate!) === today ? 'arrived' : 'filming';
  }
  if (isReached(input.shippingDate, endOfToday)) return 'in_transit';
  if (input.sampleProvided === true) return 'waiting_shipment';
  if (input.sampleProvided === false && input.cooperationDate) {
    return startOfDay(input.cooperationDate) === today ? 'confirmed' : 'filming';
  }
  return 'confirmed';
}

function buildRisks(input: {
  channelName: string;
  product: string;
  cooperationDate?: number;
  shippingDate?: number;
  arrivalDate?: number;
  filmingCompleteDate?: number;
  expectedPublishDate?: number;
  actualPublishDate?: number;
  publishedVideoUrl: string;
  sampleProvided: boolean | null;
  logisticsNotified: boolean;
}, now: number) {
  const risks: CooperationRisk[] = [];
  const today = startOfDay(now);
  if (!input.channelName) risks.push({ code: 'missing-channel', label: '缺少频道名称', level: 'error' });
  if (!input.product) risks.push({ code: 'missing-product', label: '缺少合作产品', level: 'error' });
  if (!input.cooperationDate) risks.push({ code: 'missing-confirmed-date', label: '缺少合作日期', level: 'warning' });
  if (input.expectedPublishDate && startOfDay(input.expectedPublishDate) < today && !input.actualPublishDate) {
    risks.push({ code: 'publish-overdue', label: '预计上线已逾期', level: 'overdue' });
  }
  if (input.publishedVideoUrl && !input.actualPublishDate) {
    risks.push({ code: 'missing-publish-date', label: '有视频链接但缺实际上线日期', level: 'warning' });
  }
  if (input.shippingDate && input.sampleProvided === true && !input.logisticsNotified) {
    risks.push({ code: 'logistics-not-notified', label: '物流信息尚未告知', level: 'warning' });
  }

  const orderedDates: Array<[string, number | undefined]> = [
    ['合作日期', input.cooperationDate],
    ['发货时间', input.shippingDate],
    ['到货时间', input.arrivalDate],
    ['拍摄完成时间', input.filmingCompleteDate],
    ['实际上线日期', input.actualPublishDate],
  ];
  let previous: [string, number] | undefined;
  for (const [label, value] of orderedDates) {
    if (!value) continue;
    if (previous && value < previous[1]) {
      risks.push({ code: `date-order-${label}`, label: `${label}早于${previous[0]}`, level: 'error' });
    }
    previous = [label, value];
  }

  if (input.arrivalDate && !input.shippingDate && input.sampleProvided !== false) {
    risks.push({ code: 'missing-shipping-date', label: '已到货但缺发货时间', level: 'warning' });
  }
  if (input.filmingCompleteDate && input.sampleProvided !== false && !input.arrivalDate) {
    risks.push({ code: 'missing-arrival-date', label: '拍摄已完成但缺到货时间', level: 'warning' });
  }
  return risks;
}

function buildNextAction(input: {
  stage: CooperationStage;
  sampleProvided: boolean | null;
  shippingTracking: string;
  logisticsNotified: boolean;
  publishedVideoUrl: string;
}) {
  if (input.stage === 'published') return input.publishedVideoUrl ? '合作已完成' : '补充视频链接';
  if (input.stage === 'filming_complete') return '确认视频发布时间';
  if (input.stage === 'filming' || input.stage === 'arrived') return '跟进视频拍摄进度';
  if (input.stage === 'in_transit') {
    if (!input.shippingTracking) return '补充物流追踪信息';
    if (!input.logisticsNotified) return '向红人告知物流信息';
    return '等待样品到货';
  }
  if (input.stage === 'waiting_shipment') return '安排样品发货';
  if (input.sampleProvided === null) return '确认是否需要寄样';
  return input.sampleProvided ? '安排样品发货' : '跟进视频拍摄进度';
}

function buildMilestones(input: {
  stage: CooperationStage;
  sampleProvided: boolean | null;
  cooperationDate?: number;
  shippingDate?: number;
  arrivalDate?: number;
  filmingStartDate?: number;
  filmingCompleteDate?: number;
  actualPublishDate?: number;
}) {
  const currentIndex = stageIndex(input.stage);
  const definitions: Array<{
    stage: CooperationStage;
    date?: number;
    inferred?: boolean;
    skipped?: boolean;
    note?: string;
  }> = [
    { stage: 'confirmed', date: input.cooperationDate },
    {
      stage: 'waiting_shipment',
      date: input.sampleProvided === true ? input.cooperationDate : undefined,
      inferred: input.sampleProvided === true,
      skipped: input.sampleProvided === false,
      note: input.sampleProvided === false ? '无需寄样' : undefined,
    },
    {
      stage: 'in_transit',
      date: input.shippingDate,
      skipped: input.sampleProvided === false,
      note: input.sampleProvided === false ? '无需寄样' : undefined,
    },
    {
      stage: 'arrived',
      date: input.arrivalDate,
      skipped: input.sampleProvided === false,
      note: input.sampleProvided === false ? '无需寄样' : undefined,
    },
    {
      stage: 'filming',
      date: input.filmingStartDate,
      inferred: Boolean(input.filmingStartDate),
      note: input.filmingStartDate ? '自动推断' : undefined,
    },
    { stage: 'filming_complete', date: input.filmingCompleteDate },
    { stage: 'published', date: input.actualPublishDate },
  ];

  return definitions.map<CooperationMilestone>((item) => {
    const index = stageIndex(item.stage);
    let state: CooperationMilestoneState = 'pending';
    if (item.skipped) state = 'skipped';
    else if (item.stage === input.stage) state = 'current';
    else if (index < currentIndex) state = 'complete';
    return {
      stage: item.stage,
      label: COOPERATION_STAGE_META[item.stage].label,
      date: item.date,
      inferred: item.inferred,
      state,
      note: item.note,
    };
  });
}

export function mapFeishuCooperationRecord(
  record: CachedFeishuRecord,
  mapping: FeishuFieldMapping,
  now = Date.now(),
): CooperationProject {
  const channelName = mappedText(record, mapping, 'channelName');
  const product = mappedText(record, mapping, 'cooperationProduct');
  const sampleProvided = parseSampleProvided(rawMappedValue(record, mapping, 'sampleProvided'));
  const cooperationDate = parseFeishuDate(rawMappedValue(record, mapping, 'cooperationDate'));
  const shippingDate = parseFeishuDate(rawMappedValue(record, mapping, 'shippingDate'));
  const arrivalDate = parseFeishuDate(rawMappedValue(record, mapping, 'arrivalDate'));
  const filmingCompleteDate = parseFeishuDate(rawMappedValue(record, mapping, 'filmingCompleteDate'));
  const expectedPublishDate = parseFeishuDate(rawMappedValue(record, mapping, 'expectedPublishDate'));
  const actualPublishDate = parseFeishuDate(rawMappedValue(record, mapping, 'actualPublishDate'));
  const filmingStartDate = sampleProvided === false ? cooperationDate : arrivalDate;
  const publishedVideoUrl = extractUrl(rawMappedValue(record, mapping, 'publishedVideoUrl'));
  const logisticsNotified = parseFeishuBoolean(rawMappedValue(record, mapping, 'logisticsNotified'));
  const discountNotified = parseFeishuBoolean(rawMappedValue(record, mapping, 'discountNotified'));
  const shippingTracking = mappedText(record, mapping, 'shippingTracking');
  const stage = calculateStage({
    sampleProvided,
    cooperationDate,
    shippingDate,
    arrivalDate,
    filmingCompleteDate,
    actualPublishDate,
  }, now);
  const risks = buildRisks({
    channelName,
    product,
    cooperationDate,
    shippingDate,
    arrivalDate,
    filmingCompleteDate,
    expectedPublishDate,
    actualPublishDate,
    publishedVideoUrl,
    sampleProvided,
    logisticsNotified,
  }, now);
  const stageDateMap: Partial<Record<CooperationStage, number | undefined>> = {
    confirmed: cooperationDate,
    waiting_shipment: cooperationDate,
    in_transit: shippingDate,
    arrived: arrivalDate,
    filming: filmingStartDate,
    filming_complete: filmingCompleteDate,
    published: actualPublishDate,
  };

  return {
    id: record.record_id,
    channelName: channelName || '未命名红人',
    email: mappedText(record, mapping, 'email').toLowerCase(),
    channelUrl: extractUrl(rawMappedValue(record, mapping, 'channelUrl')),
    channelId: mappedText(record, mapping, 'channelId'),
    platform: mappedText(record, mapping, 'promotionPlatform') || '未填写',
    region: mappedText(record, mapping, 'region') || '未填写',
    product: product || '未填写合作产品',
    site: mappedText(record, mapping, 'cooperationSite') || '未填写',
    owner: mappedText(record, mapping, 'promotionOwner') || '未分配',
    operator: mappedText(record, mapping, 'operator') || '未填写',
    cooperationType: mappedText(record, mapping, 'cooperationType') || '未填写',
    cooperationCount: mappedText(record, mapping, 'cooperationCount'),
    followers: mappedText(record, mapping, 'followers'),
    sampleProvided,
    cooperationDate,
    shippingDate,
    arrivalDate,
    filmingStartDate,
    filmingCompleteDate,
    expectedPublishDate,
    actualPublishDate,
    shippingAddress: mappedText(record, mapping, 'shippingAddress'),
    shippingTracking,
    discountCode: mappedText(record, mapping, 'discountCode'),
    logisticsNotified,
    discountNotified,
    originalCurrencyCost: mappedText(record, mapping, 'originalCurrencyCost'),
    cnyCost: mappedText(record, mapping, 'cnyCost'),
    publishedVideoUrl,
    exposureCount: mappedText(record, mapping, 'exposureCount'),
    commentCount: mappedText(record, mapping, 'commentCount'),
    likeCount: mappedText(record, mapping, 'likeCount'),
    stage,
    stageDate: stageDateMap[stage],
    stageDateInferred: stage === 'waiting_shipment' || stage === 'filming',
    nextAction: buildNextAction({
      stage,
      sampleProvided,
      shippingTracking,
      logisticsNotified,
      publishedVideoUrl,
    }),
    risks,
    milestones: buildMilestones({
      stage,
      sampleProvided,
      cooperationDate,
      shippingDate,
      arrivalDate,
      filmingStartDate,
      filmingCompleteDate,
      actualPublishDate,
    }),
    rawFields: record.fields,
  };
}

export function formatCooperationDate(value?: number, includeYear = false) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未记录';
  return new Intl.DateTimeFormat('zh-CN', includeYear
    ? { year: 'numeric', month: 'numeric', day: 'numeric' }
    : { month: 'numeric', day: 'numeric' }).format(date);
}

export function formatStageDuration(value?: number, now = Date.now()) {
  if (!value) return '时间未记录';
  const days = Math.max(0, Math.floor((startOfDay(now) - startOfDay(value)) / DAY_MS));
  if (days === 0) return '今天进入';
  return `已停留 ${days} 天`;
}
