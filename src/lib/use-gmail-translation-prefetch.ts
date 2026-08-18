'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useEmailTranslations, useGmailAuth, useSettings } from '@/lib/data';
import { repairTextEncoding, splitEmailForTranslation } from '@/lib/email-text';
import {
  GMAIL_PRIMARY_INBOX_REFRESHED_EVENT,
  GmailTranslationPrefetchQueue,
  getGmailTranslationScopeKey,
  registerGmailTranslationPrefetchQueue,
  requestGmailTranslation,
  selectGmailTranslationPrefetchCandidates,
  type GmailTranslationPrefetchCandidate,
} from '@/lib/gmail-translation-prefetch';

export function useGmailTranslationPrefetch(active: boolean) {
  const { auth } = useGmailAuth();
  const { settings } = useSettings();
  const { translations, addTranslation } = useEmailTranslations();
  const translationsRef = useRef(translations);
  const addTranslationRef = useRef(addTranslation);
  const settingsRef = useRef(settings);
  const scopeRef = useRef('');
  const queueRef = useRef<GmailTranslationPrefetchQueue | null>(null);
  const requestInFlightRef = useRef(false);

  useEffect(() => {
    translationsRef.current = translations;
  }, [translations]);

  useEffect(() => {
    addTranslationRef.current = addTranslation;
  }, [addTranslation]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const refreshCandidates = useCallback(async () => {
    const scopeKey = scopeRef.current;
    const queue = queueRef.current;
    if (!scopeKey || !queue || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    try {
      const response = await fetch('/api/gmail?action=translation-candidates&maxResults=3', {
        cache: 'no-store',
      });
      const result = await response.json().catch(() => null) as {
        success?: boolean;
        data?: GmailTranslationPrefetchCandidate[];
      } | null;
      if (!response.ok || !result?.success || !Array.isArray(result.data)) return;
      if (scopeRef.current !== scopeKey || queueRef.current !== queue) return;
      const cachedMessageIds = translationsRef.current.map((translation) => translation.messageId);
      queue.enqueue(selectGmailTranslationPrefetchCandidates(result.data, cachedMessageIds, 3));
    } finally {
      requestInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active || !auth?.isConnected || !auth.email) {
      scopeRef.current = '';
      queueRef.current?.stop();
      queueRef.current = null;
      return undefined;
    }

    const scopeKey = getGmailTranslationScopeKey(auth.email);
    scopeRef.current = scopeKey;
    const queue = new GmailTranslationPrefetchQueue(async (candidate) => {
      if (scopeRef.current !== scopeKey) return;
      if (translationsRef.current.some((translation) => translation.messageId === candidate.messageId)) return;
      const originalText = repairTextEncoding(candidate.body);
      const currentText = splitEmailForTranslation(originalText).currentText || originalText;
      if (!currentText.trim()) throw new Error('这封邮件没有可翻译的正文。');
      const result = await requestGmailTranslation({
        scopeKey,
        messageId: candidate.messageId,
        text: currentText,
        settings: settingsRef.current,
      });
      if (scopeRef.current !== scopeKey) return;
      addTranslationRef.current({
        messageId: candidate.messageId,
        originalText,
        translatedText: result.translatedText,
        sourceLang: result.sourceLang,
        targetLang: 'zh',
      });
    });
    queueRef.current = queue;
    const unregister = registerGmailTranslationPrefetchQueue(scopeKey, queue);
    void refreshCandidates();

    const handlePrimaryInboxRefresh = () => {
      void refreshCandidates();
    };
    window.addEventListener(GMAIL_PRIMARY_INBOX_REFRESHED_EVENT, handlePrimaryInboxRefresh);

    return () => {
      window.removeEventListener(GMAIL_PRIMARY_INBOX_REFRESHED_EVENT, handlePrimaryInboxRefresh);
      unregister();
      queue.stop();
      if (queueRef.current === queue) queueRef.current = null;
      if (scopeRef.current === scopeKey) scopeRef.current = '';
      requestInFlightRef.current = false;
    };
  }, [active, auth?.email, auth?.isConnected, refreshCandidates]);
}
