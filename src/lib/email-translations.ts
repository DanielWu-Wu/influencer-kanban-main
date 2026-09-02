import type { EmailTranslation } from '@/lib/types';
import { isUsableMailTranslation, normalizeMailTranslationText } from './mail-translation-body';

export function findUsableEmailTranslation(
  translations: EmailTranslation[], storageMessageIds: string[], originalText: string,
) {
  const source = normalizeMailTranslationText(originalText);
  if (!source) return undefined;
  return translations.find((item) => storageMessageIds.includes(item.messageId)
    && normalizeMailTranslationText(item.originalText) === source
    && item.targetLang === 'zh'
    && isUsableMailTranslation(source, item.translatedText));
}

export function upsertEmailTranslation(
  translations: EmailTranslation[],
  translation: EmailTranslation,
) {
  return [
    translation,
    ...translations.filter((item) => item.messageId !== translation.messageId),
  ];
}
