import type { EmailTranslation } from '@/lib/types';

export function upsertEmailTranslation(
  translations: EmailTranslation[],
  translation: EmailTranslation,
) {
  return [
    translation,
    ...translations.filter((item) => item.messageId !== translation.messageId),
  ];
}
