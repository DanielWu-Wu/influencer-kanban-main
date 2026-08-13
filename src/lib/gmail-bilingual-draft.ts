export type GmailBilingualDraftSnapshot = {
  foreignBody: string;
  chineseBody: string;
  targetLanguage: string;
};

export type GmailTemplateDraftTone = 'friendly' | 'formal' | 'casual';

export type GmailTemplateDraftResult = {
  suggestedReply: string;
  translatedReply: string;
  tone: GmailTemplateDraftTone;
};

export function buildGmailTemplateDraftResult({
  suggestedReply,
  translatedReply,
  tone,
}: {
  suggestedReply: unknown;
  translatedReply: unknown;
  tone: unknown;
}): GmailTemplateDraftResult {
  const normalizedTone: GmailTemplateDraftTone = tone === 'formal' || tone === 'casual'
    ? tone
    : 'friendly';
  return {
    suggestedReply: String(suggestedReply || '').trim(),
    translatedReply: String(translatedReply || '').trim(),
    tone: normalizedTone,
  };
}

function normalizeDraftText(value: string) {
  return value.trim();
}

export function isGmailBilingualDraftTranslationCurrent({
  snapshot,
  chineseBody,
  targetLanguage,
}: {
  snapshot: GmailBilingualDraftSnapshot | null;
  chineseBody: string;
  targetLanguage: string;
}) {
  if (!snapshot) return false;
  return normalizeDraftText(snapshot.chineseBody) === normalizeDraftText(chineseBody)
    && snapshot.targetLanguage === targetLanguage;
}

export function isGmailBilingualDraftForeignEdited({
  snapshot,
  foreignBody,
}: {
  snapshot: GmailBilingualDraftSnapshot | null;
  foreignBody: string;
}) {
  if (!snapshot) return false;
  return normalizeDraftText(snapshot.foreignBody) !== normalizeDraftText(foreignBody);
}
