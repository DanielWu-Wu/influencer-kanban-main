'use client';

import { useSyncExternalStore } from 'react';
import { getAccountCacheScope } from './account-cache-scope';
import { detectReplyLanguage } from './email-language';
import { OUTREACH_LANGUAGE_OPTIONS } from './outreach-languages';
import { normalizeMailTranslationText } from './mail-translation-body';

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const storageKey = (scope: string, id: string) => `mail-language-v1:${scope}:${id}`;

export function readMailLanguage(scope: string, id: string, text: string): string {
  if (typeof window === 'undefined') return '';
  try {
    const entry = JSON.parse(localStorage.getItem(storageKey(scope, id)) || 'null');
    return entry?.text === normalizeMailTranslationText(text) && OUTREACH_LANGUAGE_OPTIONS.some(item => item.code === entry.language)
      ? entry.language : '';
  } catch { return ''; }
}

export function saveMailLanguage(scope: string, id: string, text: string, language: string) {
  if (typeof window === 'undefined' || !id || !text || !scope.startsWith(`${getAccountCacheScope()}::`)) return;
  if (!OUTREACH_LANGUAGE_OPTIONS.some(item => item.code === language)) return;
  try { localStorage.setItem(storageKey(scope, id), JSON.stringify({ text: normalizeMailTranslationText(text), language })); }
  catch { return; }
  listeners.forEach(listener => listener());
}

export function useMailLanguage(scope: string, id: string, text: string) {
  return useSyncExternalStore(subscribe,
    () => readMailLanguage(scope, id, text) || detectReplyLanguage(text),
    () => detectReplyLanguage(text));
}

export function useMailLanguageRevision() {
  return useSyncExternalStore(subscribe, () => revision, () => 0);
}
let revision = 0;
listeners.add(() => { revision += 1; });
