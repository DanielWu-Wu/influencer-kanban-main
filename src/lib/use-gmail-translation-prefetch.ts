'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useEmailTranslations, useSettings } from '@/lib/data';
import { getAccountCacheScope } from '@/lib/account-cache-scope';
import { repairTextEncoding, splitEmailForTranslation } from '@/lib/email-text';
import {
  GmailTranslationPrefetchQueue,
  getLegacyGmailTranslationScopeKey,
  getMailTranslationScopeKey,
  getMailTranslationStorageMessageId,
  registerGmailTranslationPrefetchQueue,
  requestGmailTranslation,
  type MailTranslationPrefetchCandidate,
} from '@/lib/gmail-translation-prefetch';

function sortCandidates(candidates: MailTranslationPrefetchCandidate[]) {
  return [...candidates].sort((left, right) => {
    const dateDifference = Date.parse(right.date) - Date.parse(left.date);
    return dateDifference || right.messageId.localeCompare(left.messageId);
  });
}

export function useMailTranslationPrefetch(
  active: boolean,
  candidates: MailTranslationPrefetchCandidate[],
) {
  const { settings } = useSettings();
  const { translations, addTranslation } = useEmailTranslations();
  const translationsRef = useRef(translations);
  const addTranslationRef = useRef(addTranslation);
  const settingsRef = useRef(settings);
  const queueRef = useRef<GmailTranslationPrefetchQueue | null>(null);
  const accountScope = getAccountCacheScope();
  const sortedCandidates = useMemo(() => sortCandidates(candidates), [candidates]);

  useEffect(() => {
    translationsRef.current = translations;
  }, [translations]);

  useEffect(() => {
    addTranslationRef.current = addTranslation;
  }, [addTranslation]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!active) {
      queueRef.current?.stop();
      queueRef.current = null;
      return undefined;
    }

    let disposed = false;
    const queue = new GmailTranslationPrefetchQueue(async (candidate) => {
      if (disposed || getAccountCacheScope() !== accountScope) return;
      const originalText = repairTextEncoding(candidate.body);
      const scopeKey = getMailTranslationScopeKey(candidate.mailAccountId, accountScope);
      const storageMessageId = getMailTranslationStorageMessageId(scopeKey, candidate.messageId);
      const cached = translationsRef.current.find((translation) => (
        translation.messageId === storageMessageId
        && translation.originalText === originalText
      ));
      if (cached) return;

      if (candidate.provider === 'gmail') {
        const legacyScopeKey = getLegacyGmailTranslationScopeKey(candidate.mailAddress, accountScope);
        const legacyStorageMessageId = getMailTranslationStorageMessageId(legacyScopeKey, candidate.messageId);
        const legacy = translationsRef.current.find((translation) => (
          translation.messageId === legacyStorageMessageId
          && translation.originalText === originalText
        ));
        if (legacy) {
          if (disposed || getAccountCacheScope() !== accountScope) return;
          addTranslationRef.current({
            messageId: storageMessageId,
            originalText,
            translatedText: legacy.translatedText,
            sourceLang: legacy.sourceLang,
            targetLang: legacy.targetLang,
          });
          return;
        }
      }

      const currentText = splitEmailForTranslation(originalText).currentText || originalText;
      if (!currentText.trim()) throw new Error('这封邮件没有可翻译的正文。');
      const result = await requestGmailTranslation({
        scopeKey,
        messageId: candidate.messageId,
        text: currentText,
        settings: settingsRef.current,
      });
      if (disposed || getAccountCacheScope() !== accountScope) return;
      addTranslationRef.current({
        messageId: storageMessageId,
        originalText,
        translatedText: result.translatedText,
        sourceLang: result.sourceLang,
        targetLang: 'zh',
      });
    });
    queueRef.current = queue;

    return () => {
      disposed = true;
      queue.stop();
      if (queueRef.current === queue) queueRef.current = null;
    };
  }, [accountScope, active]);

  useEffect(() => {
    const queue = queueRef.current;
    if (!active || !queue) return;
    const pending = sortedCandidates.filter((candidate) => {
      const originalText = repairTextEncoding(candidate.body);
      const scopeKey = getMailTranslationScopeKey(candidate.mailAccountId, accountScope);
      const storageMessageId = getMailTranslationStorageMessageId(scopeKey, candidate.messageId);
      if (translations.some((translation) => (
        translation.messageId === storageMessageId
        && translation.originalText === originalText
      ))) return false;
      return true;
    });
    queue.synchronize(pending);
  }, [accountScope, active, sortedCandidates, translations]);

  useEffect(() => {
    const queue = queueRef.current;
    if (!active || !queue) return undefined;
    const unregister = [...new Set(sortedCandidates.map((candidate) => (
      getMailTranslationScopeKey(candidate.mailAccountId, accountScope)
    )))].map((scopeKey) => registerGmailTranslationPrefetchQueue(scopeKey, queue));
    return () => unregister.forEach((cleanup) => cleanup());
  }, [accountScope, active, sortedCandidates]);
}

// 保留旧导出名称，避免历史调用方在同一未提交现场中失效。
export const useGmailTranslationPrefetch = useMailTranslationPrefetch;
