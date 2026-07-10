export type FeishuFieldKey =
  | 'channelName'
  | 'avatar'
  | 'platform'
  | 'region'
  | 'followers'
  | 'contentType'
  | 'engagementRate'
  | 'channelUrl'
  | 'channelId'
  | 'language'
  | 'recentAverageViews'
  | 'description'
  | 'email'
  | 'developmentDate'
  | 'firstOutreach'
  | 'secondOutreachDate'
  | 'secondOutreach'
  | 'thirdOutreachDate'
  | 'thirdOutreach'
  | 'hasReply'
  | 'collaborationStatus'
  | 'prospectingStatus'
  | 'targetProduct'
  | 'cooperationType'
  | 'cooperationIdea'
  | 'priority'
  | 'gmailDraftId'
  | 'notes'
  | 'campaignName'
  | 'quote'
  | 'totalCost'
  | 'shippingInfo'
  | 'expectedPublishDate'
  | 'discountCode'
  | 'collaborationProgress'
  | 'parentRecord';

export type FeishuFieldMapping = Partial<Record<FeishuFieldKey, string>>;

export type FeishuFieldInfo = {
  field_id: string;
  field_name: string;
  type: number;
};

export const FEISHU_FIELD_TARGETS: Array<{
  key: FeishuFieldKey;
  label: string;
  description: string;
  keywords: string[];
  required?: boolean;
}> = [
  {
    key: 'channelName',
    label: '红人频道名',
    description: '用于在看板和邮件里识别红人',
    keywords: ['红人频道名', '频道名称', '频道名', 'channel name', 'channel'],
    required: true,
  },
  {
    key: 'avatar',
    label: '频道头像',
    description: '用于在红人开发和跟进列表中快速识别频道',
    keywords: ['频道头像', '红人头像', '头像', 'avatar', 'thumbnail', '缩略图'],
  },
  {
    key: 'email',
    label: '联系邮箱',
    description: '用于 Gmail 自动匹配红人',
    keywords: ['联系邮箱', '邮箱', 'email', 'mail'],
    required: true,
  },
  {
    key: 'developmentDate',
    label: '开发日期',
    description: '用于记录首次建立开发记录的日期',
    keywords: ['开发日期', '开发时间', 'outreach date', 'development date'],
  },
  {
    key: 'channelUrl',
    label: '频道链接',
    description: '用于打开 YouTube 频道和后续接 YouTube API',
    keywords: ['频道链接', '频道地址', 'youtube', 'url', 'link'],
    required: true,
  },
  {
    key: 'channelId',
    label: 'YouTube Channel ID',
    description: '用于稳定查重，不受频道改名或 handle 变化影响',
    keywords: ['youtube channel id', 'channel id', '频道id', '频道 ID'],
  },
  {
    key: 'language',
    label: '频道语言',
    description: '用于选择开发信语言和市场策略',
    keywords: ['频道语言', '语言', 'language', 'locale'],
  },
  {
    key: 'recentAverageViews',
    label: '最近视频平均播放量',
    description: '用于评估频道近期真实影响力',
    keywords: ['最近视频平均播放量', '平均播放量', '均播', 'average views'],
  },
  {
    key: 'region',
    label: '地区',
    description: '用于按国家或市场筛选红人',
    keywords: ['地区', '国家', '市场', 'region', 'country', 'market'],
  },
  {
    key: 'followers',
    label: '粉丝数',
    description: '用于评估红人规模',
    keywords: ['粉丝数', '订阅', 'followers', 'subscribers'],
  },
  {
    key: 'platform',
    label: '平台',
    description: '用于区分 YouTube、TikTok 等来源',
    keywords: ['平台', 'platform'],
  },
  {
    key: 'contentType',
    label: '内容类型',
    description: '用于判断频道内容是否适合当前产品',
    keywords: ['内容类型', '类目', '品类', 'category', 'content type'],
  },
  {
    key: 'engagementRate',
    label: '互动率',
    description: '用于评估频道质量',
    keywords: ['互动率', '互动', 'engagement'],
  },
  {
    key: 'firstOutreach',
    label: '初次开发信',
    description: '用于记录是否已发首封邮件',
    keywords: ['初次开发信', '首次开发信', '首封', 'first outreach'],
  },
  {
    key: 'secondOutreachDate',
    label: '二次跟进日期',
    description: '记录二次跟进开发信实际发送的日期',
    keywords: ['二次跟进日期', '二次跟进时间', 'second follow date'],
  },
  {
    key: 'secondOutreach',
    label: '二次跟进开发信',
    description: '用于判断是否需要继续跟进',
    keywords: ['二次跟进开发信', '二次跟进', 'second follow'],
  },
  {
    key: 'thirdOutreachDate',
    label: '三次跟进日期',
    description: '记录三次跟进开发信实际发送的日期',
    keywords: ['三次跟进日期', '三次跟进时间', 'third follow date'],
  },
  {
    key: 'thirdOutreach',
    label: '三次跟进开发信',
    description: '用于判断是否停止开发',
    keywords: ['三次跟进开发信', '三次跟进', 'third follow'],
  },
  {
    key: 'hasReply',
    label: '红人是否有回复',
    description: '用于统计回复率',
    keywords: ['红人是否有回复', '是否有回复', '已回复', 'reply'],
  },
  {
    key: 'collaborationStatus',
    label: '合作状态',
    description: '用于同步看板阶段',
    keywords: ['合作状态', '状态', 'status'],
    required: true,
  },
  {
    key: 'prospectingStatus',
    label: '开发流程状态',
    description: '用于同步红人录入、邀约确认和 Gmail 草稿阶段',
    keywords: ['开发流程状态', '开发状态', '线索状态', 'prospecting status'],
  },
  {
    key: 'targetProduct',
    label: '目标产品',
    description: '本次邀约希望推广的产品',
    keywords: ['目标产品', '主推产品', '产品', 'target product'],
  },
  {
    key: 'cooperationType',
    label: '合作形式',
    description: '送样、付费、联盟或长期合作等邀约形式',
    keywords: ['合作形式', '合作方式', 'cooperation type'],
  },
  {
    key: 'cooperationIdea',
    label: '合作想法',
    description: '人工确认的合作切入角度和内容建议',
    keywords: ['合作想法', '合作角度', '邀约想法', 'cooperation idea'],
  },
  {
    key: 'priority',
    label: '开发优先级',
    description: '红人开发优先级',
    keywords: ['开发优先级', '优先级', 'priority'],
  },
  {
    key: 'gmailDraftId',
    label: 'Gmail 草稿 ID',
    description: '用于记录已创建的 Gmail 草稿并避免重复创建',
    keywords: ['gmail 草稿 id', '草稿 id', 'gmail draft id'],
  },
  {
    key: 'collaborationProgress',
    label: '合作进度',
    description: '用于记录更细的推进情况',
    keywords: ['合作进度', '进度', 'progress'],
  },
  {
    key: 'quote',
    label: '合作报价',
    description: '用于谈判和预算判断',
    keywords: ['合作报价', '报价', '价格', 'price', 'quote', 'rate'],
  },
  {
    key: 'totalCost',
    label: '合作总费用',
    description: '用于统计真实投入',
    keywords: ['合作总费用', '总费用', '成本', 'cost'],
  },
  {
    key: 'campaignName',
    label: 'Campaign 名',
    description: '用于区分产品、站点或活动',
    keywords: ['campaign 名', 'campaign', '活动名', '项目名'],
  },
  {
    key: 'shippingInfo',
    label: '配送信息',
    description: '用于样品寄送和物流跟进',
    keywords: ['配送信息', '物流', '地址', 'tracking', 'shipping'],
  },
  {
    key: 'expectedPublishDate',
    label: '预计上线时间',
    description: '用于发布提醒和复盘',
    keywords: ['预计上线时间', '上线时间', '发布时间', 'publish'],
  },
  {
    key: 'discountCode',
    label: '折扣码信息',
    description: '用于上线后记录优惠码或联盟链接',
    keywords: ['折扣码信息', '折扣码', '优惠码', 'discount'],
  },
  {
    key: 'notes',
    label: '备注',
    description: '用于 AI 分析合作背景',
    keywords: ['备注', 'note', 'notes'],
  },
  {
    key: 'parentRecord',
    label: '父记录',
    description: '用于表格内部关联关系',
    keywords: ['父记录', 'parent'],
  },
];

function normalizeFieldName(value: string) {
  return value
    .toLowerCase()
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[\s_\-:：/、，,。·.]/g, '');
}

export function compactFeishuFieldMapping(mapping: FeishuFieldMapping) {
  return Object.fromEntries(
    Object.entries(mapping).filter(([, value]) => Boolean(value)),
  ) as FeishuFieldMapping;
}

export function autoMapFeishuFields(
  fields: FeishuFieldInfo[],
  existingMapping: FeishuFieldMapping = {},
) {
  const fieldNames = new Set(fields.map((field) => field.field_name));
  const next: FeishuFieldMapping = {};

  for (const target of FEISHU_FIELD_TARGETS) {
    const existing = existingMapping[target.key];
    if (existing && fieldNames.has(existing)) {
      next[target.key] = existing;
      continue;
    }

    const normalizedKeywords = target.keywords.map(normalizeFieldName);
    const exact = fields.find((field) =>
      normalizedKeywords.includes(normalizeFieldName(field.field_name)),
    );
    const fuzzy = exact || fields.find((field) => {
      const normalizedField = normalizeFieldName(field.field_name);
      return normalizedKeywords.some((keyword) =>
        normalizedField.includes(keyword) || keyword.includes(normalizedField),
      );
    });

    if (fuzzy) next[target.key] = fuzzy.field_name;
  }

  return next;
}
