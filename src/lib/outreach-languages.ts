export const OUTREACH_LANGUAGE_OPTIONS = [
  { code: 'en', label: '英语' },
  { code: 'pl', label: '波兰语' },
  { code: 'es', label: '西班牙语' },
  { code: 'nl', label: '荷兰语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'it', label: '意大利语' },
  { code: 'ca', label: '加泰罗尼亚语' },
  { code: 'cs', label: '捷克语' },
  { code: 'sk', label: '斯洛伐克语' },
  { code: 'hu', label: '匈牙利语' },
  { code: 'ro', label: '罗马尼亚语' },
  { code: 'da', label: '丹麦语' },
  { code: 'sv', label: '瑞典语' },
  { code: 'no', label: '挪威语' },
  { code: 'fi', label: '芬兰语' },
  { code: 'uk', label: '乌克兰语' },
  { code: 'ru', label: '俄语' },
  { code: 'tr', label: '土耳其语' },
  { code: 'el', label: '希腊语' },
  { code: 'ar', label: '阿拉伯语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'zh', label: '中文' },
] as const;

const LANGUAGE_LABELS = new Map<string, string>(
  OUTREACH_LANGUAGE_OPTIONS.map((item) => [item.code, item.label]),
);

export function normalizeLanguageCode(value?: string) {
  return String(value || '').trim().toLowerCase().slice(0, 2);
}

export function outreachLanguageLabel(code?: string) {
  const normalized = normalizeLanguageCode(code);
  if (!normalized) return '未选择';
  const known = LANGUAGE_LABELS.get(normalized);
  if (known) return known;
  try {
    return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(normalized) || normalized.toUpperCase();
  } catch {
    return normalized.toUpperCase();
  }
}
