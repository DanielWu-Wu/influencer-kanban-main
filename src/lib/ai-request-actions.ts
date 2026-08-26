export const AI_CONNECTION_TEST_ACTION = 'testConnection';

const MAIL_THREAD_REQUIRED_ACTIONS = new Set([
  'analyze',
  'draft',
  'optimizeDraft',
  'templateDraft',
]);

export function requiresMailThreadContext(action: string) {
  return MAIL_THREAD_REQUIRED_ACTIONS.has(action);
}
