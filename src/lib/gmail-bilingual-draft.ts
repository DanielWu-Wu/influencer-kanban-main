export type GmailBilingualDraftSnapshot = {
  foreignBody: string;
  chineseBody: string;
  targetLanguage: string;
};

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
