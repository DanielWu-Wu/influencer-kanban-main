export const EMAIL_TRANSLATION_RETRY_OPERATION = 'translate_chinese_to_foreign';

export type EmailTranslationSource =
  | 'gmail_ai_reply'
  | 'gmail_template_reply'
  | 'outreach_email';

export interface EmailTranslationRetryInput {
  operation: typeof EMAIL_TRANSLATION_RETRY_OPERATION;
  source: EmailTranslationSource;
  chineseBody: string;
  targetLang: string;
  targetLangName: string;
}

export interface EmailTranslationTaskResult {
  source: EmailTranslationSource;
  chineseBody: string;
  targetLang: string;
  targetLangName: string;
  foreignBody: string;
}

export interface EmailTranslationRequestOptions {
  chineseBody: string;
  targetLang: string;
  targetLangName: string;
  modelProvider?: string;
  customApiUrl?: string;
  customApiKey?: string;
  customModelName?: string;
  signal?: AbortSignal;
}

export async function requestEmailTranslation(options: EmailTranslationRequestOptions) {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal,
    body: JSON.stringify({
      action: 'translateEditedReply',
      editedChineseReply: options.chineseBody,
      targetLang: options.targetLang,
      targetLangName: options.targetLangName,
      modelProvider: options.modelProvider,
      customApiUrl: options.customApiUrl,
      customApiKey: options.customApiKey,
      customModelName: options.customModelName,
    }),
  });
  const result = await response.json().catch(() => ({})) as {
    success?: boolean;
    data?: { suggestedReply?: string };
    error?: string;
  };
  if (!response.ok || !result.success) {
    throw new Error(result.error || '中文邮件翻译失败。');
  }
  const foreignBody = String(result.data?.suggestedReply || '').trim();
  if (!foreignBody) throw new Error('AI 没有返回可用的外文正文。');
  return foreignBody;
}

export function normalizeEmailTranslationText(value: string) {
  return String(value || '').trim();
}

export function isEmailTranslationRetryInput(value: unknown): value is EmailTranslationRetryInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const input = value as Record<string, unknown>;
  return input.operation === EMAIL_TRANSLATION_RETRY_OPERATION
    && (input.source === 'gmail_ai_reply'
      || input.source === 'gmail_template_reply'
      || input.source === 'outreach_email')
    && typeof input.chineseBody === 'string'
    && typeof input.targetLang === 'string'
    && typeof input.targetLangName === 'string';
}

export function isEmailTranslationTaskResult(value: unknown): value is EmailTranslationTaskResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (result.source === 'gmail_ai_reply'
      || result.source === 'gmail_template_reply'
      || result.source === 'outreach_email')
    && typeof result.chineseBody === 'string'
    && typeof result.targetLang === 'string'
    && typeof result.targetLangName === 'string'
    && typeof result.foreignBody === 'string';
}

export function canApplyEmailTranslationResult(options: {
  result: EmailTranslationTaskResult;
  chineseBody: string;
  targetLang: string;
}) {
  return normalizeEmailTranslationText(options.result.chineseBody)
      === normalizeEmailTranslationText(options.chineseBody)
    && options.result.targetLang.trim() === options.targetLang.trim();
}
