export type GmailBilingualDraftSnapshot = {
  foreignBody: string;
  chineseBody: string;
  targetLanguage: string;
};

function normalizeDraftText(value: string) {
  return value.trim();
}

export function isGmailBilingualDraftSynchronized({
  snapshot,
  foreignBody,
  chineseBody,
  targetLanguage,
}: {
  snapshot: GmailBilingualDraftSnapshot | null;
  foreignBody: string;
  chineseBody: string;
  targetLanguage: string;
}) {
  if (!snapshot) return false;
  return normalizeDraftText(snapshot.foreignBody) === normalizeDraftText(foreignBody)
    && normalizeDraftText(snapshot.chineseBody) === normalizeDraftText(chineseBody)
    && snapshot.targetLanguage === targetLanguage;
}
