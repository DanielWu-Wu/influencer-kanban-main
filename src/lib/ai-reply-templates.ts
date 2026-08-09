import type { EmailTemplate } from './types';

export type AIReplyTemplate = EmailTemplate & {
  aiEnabled: true;
  description: string;
  requiredInfo: string[];
  rules: string[];
  defaultTone: 'friendly' | 'formal' | 'casual';
};

export const BUILT_IN_AI_REPLY_TEMPLATES: AIReplyTemplate[] = [
  {
    id: 'ai-reply-logistics',
    name: '物流告知模板',
    type: 'shipping',
    subject: '',
    description: '告知样品已寄出、物流单号、查询方式和预计送达安排。',
    content: '先说明样品已经寄出，再提供承运商、物流单号和查询方式；如有可靠信息，再补充预计到达时间、收件注意事项及下一步安排。',
    requiredInfo: ['是否已经发货', '承运商与物流单号', '预计送达时间（如已知）'],
    rules: [
      '物流信息必须以用户输入或邮件历史中的事实为准，不得猜测物流单号或送达日期。',
      '如果关键信息缺失，在邮件中自然说明稍后补充，不要保留占位符。',
      '语气简洁、可靠，明确下一步由谁跟进。',
    ],
    variables: [],
    isDefault: true,
    aiEnabled: true,
    defaultTone: 'friendly',
  },
  {
    id: 'ai-reply-discount',
    name: '折扣信息告知模板',
    type: 'discount',
    subject: '',
    description: '说明专属折扣码、优惠内容、有效期和对外展示方式。',
    content: '先说明已为对方准备折扣信息，再清楚列出折扣码、优惠幅度、适用范围与有效期；最后说明建议放置位置或使用方式。',
    requiredInfo: ['折扣码', '优惠幅度或权益', '适用产品与有效期（如有限制）'],
    rules: [
      '金额、折扣比例、有效期和适用范围不得自行补充。',
      '把限制条件写清楚，但不要使用夸大销量或收益的承诺。',
      '结尾邀请对方确认折扣信息是否适合其内容计划。',
    ],
    variables: [],
    isDefault: true,
    aiEnabled: true,
    defaultTone: 'friendly',
  },
  {
    id: 'ai-reply-cooperation-model',
    name: '常规合作模式解释模板',
    type: 'cooperation',
    subject: '',
    description: '向红人解释样品、内容形式、时间节点、审核和结算等合作流程。',
    content: '简要回应对方当前问题，再按自然顺序解释合作形式、产品安排、内容要求、时间节点、必要审核和费用结算；最后明确仍需双方确认的事项。',
    requiredInfo: ['合作形式', '产品或费用安排', '内容与发布时间要求'],
    rules: [
      '不得把尚未确认的预算、交付物、发布时间或审核权写成已达成。',
      '不要使用强硬命令式语言，优先表达双方可协商。',
      '信息较多时使用短段落或简洁列表，提高可读性。',
    ],
    variables: [],
    isDefault: true,
    aiEnabled: true,
    defaultTone: 'formal',
  },
  {
    id: 'ai-reply-affiliate-invite',
    name: '联盟项目邀请模板',
    type: 'affiliate',
    subject: '',
    description: '邀请红人加入联盟项目，并解释佣金、链接、结算和加入方式。',
    content: '结合当前合作自然引出联盟邀请，说明加入价值、佣金或奖励机制、专属链接或折扣码、结算规则和加入步骤；最后询问对方是否愿意了解或加入。',
    requiredInfo: ['佣金或奖励规则', '加入方式', '结算或追踪方式（如已知）'],
    rules: [
      '不得承诺没有依据的收入、销量、佣金比例或结算周期。',
      '联盟邀请应是可选项，不得暗示对方必须加入才能继续当前合作。',
      '缺少具体规则时只做意向邀请，并提示后续可提供完整细节。',
    ],
    variables: [],
    isDefault: true,
    aiEnabled: true,
    defaultTone: 'friendly',
  },
];

const BUILT_IN_IDS = new Set(BUILT_IN_AI_REPLY_TEMPLATES.map((template) => template.id));

export function mergeBuiltInAIReplyTemplates(templates: EmailTemplate[]) {
  const personalTemplates = templates.filter((template) => !BUILT_IN_IDS.has(template.id));
  return [...BUILT_IN_AI_REPLY_TEMPLATES, ...personalTemplates];
}

export function getAIReplyTemplates(templates: EmailTemplate[]) {
  return templates.filter((template): template is AIReplyTemplate => (
    template.aiEnabled === true
    && Boolean(template.description?.trim())
    && Array.isArray(template.requiredInfo)
    && Array.isArray(template.rules)
    && Boolean(template.defaultTone)
  ));
}

export function isBuiltInAIReplyTemplate(id: string) {
  return BUILT_IN_IDS.has(id);
}

export function normalizeAIReplyTemplate(value: unknown): AIReplyTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const template = value as Record<string, unknown>;
  const name = String(template.name || '').trim().slice(0, 100);
  const description = String(template.description || '').trim().slice(0, 1_000);
  const content = String(template.content || '').trim().slice(0, 8_000);
  const requiredInfo = Array.isArray(template.requiredInfo)
    ? template.requiredInfo.slice(0, 20).map((item) => String(item || '').trim().slice(0, 300)).filter(Boolean)
    : [];
  const rules = Array.isArray(template.rules)
    ? template.rules.slice(0, 20).map((item) => String(item || '').trim().slice(0, 500)).filter(Boolean)
    : [];
  const requestedTone = String(template.defaultTone || 'friendly');
  const defaultTone = requestedTone === 'formal' || requestedTone === 'casual'
    ? requestedTone
    : 'friendly';

  if (!name || !description || !content || !rules.length) return null;
  return {
    id: String(template.id || 'ai-reply-custom').slice(0, 200),
    name,
    type: 'custom',
    subject: '',
    description,
    content,
    requiredInfo,
    rules,
    variables: [],
    isDefault: Boolean(template.isDefault),
    aiEnabled: true,
    defaultTone,
  };
}
