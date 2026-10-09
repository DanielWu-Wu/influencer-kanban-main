import type { Prospect } from './creator-prospecting';
import { extractFeishuEmails } from './feishu-record-index';

export type ProspectBatchDefaults = {
  targetProduct?: string;
  cooperationType?: string;
  outreachLanguage?: string;
  notes?: string;
};

/** A new round copies creator facts, never the previous round's draft or write journal. */
export function createProspectOutreachRound(source: Prospect, id: string, now: string): Prospect {
  const creator = structuredClone(source);
  const roundFields: Array<keyof Prospect> = [
    'feishuRecordId', 'feishuWriteTask', 'feishuWriteBacklog', 'aiDraft', 'gmailDraftId',
    'streamingBody', 'outreachGenerationStage', 'generationError', 'error', 'syncError',
    'stageSyncNotice', 'cooperationIdea', 'cooperationIdeaSource', 'cooperationIdeaContextKey',
    'targetProduct', 'cooperationType', 'outreachNotes',
  ];
  for (const field of roundFields) delete creator[field];
  return {
    ...creator, id, outreachRoundId: id, outreachRoundStartedAt: now, previousProspectId: source.id,
    previousDevelopmentRecordId: source.feishuRecordId || source.previousDevelopmentRecordId,
    repeatOutreach: true, workflowStatus: 'resolved',
    developmentStatus: source.feishuRecordId || source.previousDevelopmentRecordId ? 'history_exists' : 'unchecked',
    priority: 'medium', createdAt: now, updatedAt: now,
  };
}

export function applyProspectBatchDefaults(source: Prospect, defaults: ProspectBatchDefaults): Prospect {
  return {
    ...source,
    targetProduct: source.targetProduct?.trim() || defaults.targetProduct?.trim() || undefined,
    cooperationType: source.cooperationType?.trim() || defaults.cooperationType?.trim() || undefined,
    outreachLanguage: source.outreachLanguage?.trim() || defaults.outreachLanguage?.trim() || undefined,
    outreachLanguageSource: source.outreachLanguage?.trim() ? source.outreachLanguageSource
      : defaults.outreachLanguage?.trim() ? 'manual' : source.outreachLanguageSource,
    outreachNotes: source.outreachNotes ?? defaults.notes?.trim(),
  };
}

export function canStartProspectRound(prospect: Prospect) {
  const task = prospect.feishuWriteTask;
  return !['recorded', 'error'].includes(prospect.workflowStatus)
    && !prospect.emailSelectionRequired
    && hasConfirmedProspectEmail(prospect)
    && (!task || task.status === 'success' || (Boolean(prospect.feishuRecordId) && !['checking', 'writing', 'unknown'].includes(task.status)))
    && !prospect.feishuWriteBacklog?.some((item) => ['checking', 'writing', 'unknown'].includes(item.status));
}

export function hasConfirmedProspectEmail(prospect: Prospect) {
  const value = prospect.publicEmail?.trim() || '';
  const emails = extractFeishuEmails(value);
  return !prospect.emailSelectionRequired && emails.length === 1 && emails[0].toLowerCase() === value.toLowerCase();
}

export function canConfirmProspectDirection(prospect: Prospect) {
  return prospect.workflowStatus === 'invitation_pending' && hasConfirmedProspectEmail(prospect)
    && Boolean(prospect.targetProduct?.trim() && prospect.cooperationType?.trim()
      && prospect.cooperationIdea?.trim() && prospect.outreachLanguage?.trim());
}

/** Classification failure is advisory; manual values including an intentional blank win. */
export async function resolveProspectContentTypes(
  prospect: Prospect,
  classify: () => Promise<string[]>,
): Promise<{ values: string[]; notice?: string }> {
  if (prospect.resourceContentTypesManual || prospect.resourceContentTypes?.length) {
    return { values: prospect.resourceContentTypes || [] };
  }
  try {
    const values = await classify();
    return { values, notice: values.length ? undefined : '频道类型未填写，已继续建档。' };
  } catch {
    return { values: [], notice: 'AI 频道分类未完成，频道类型留空，已继续建档。' };
  }
}
