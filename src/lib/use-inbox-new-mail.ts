'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAccountCacheScope } from './account-cache-scope';
import { useMailAccounts } from '@/components/mail-account-provider';
import { loadCreatorResourceProfiles } from './creator-resource-profile';
import { normalizeThreadContactEmail } from './gmail-thread-contact';
import { InboxNewMailDetector, INBOX_NEW_MAIL_SNAPSHOT_EVENT, resolveNewInboxMail, type InboxMailSnapshot } from './inbox-new-mail';
import type { AppSettings } from './data';
import type { MailTranslationPrefetchCandidate } from './gmail-translation-prefetch';

export function useInboxNewMail(active: boolean, settings: AppSettings, daily: MailTranslationPrefetchCandidate[]) {
  const { accounts } = useMailAccounts();
  const scope = getAccountCacheScope();
  const [discovered, setDiscovered] = useState<Array<MailTranslationPrefetchCandidate & { accountScope: string }>>([]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const detector = new InboxNewMailDetector();
    // Serialize discovery/body reads; the existing translation queue controls AI concurrency.
    let pending = Promise.resolve();
    const current = (snapshot: InboxMailSnapshot) => !disposed && snapshot.accountScope === scope
      && getAccountCacheScope() === scope && accounts.some((a) => a.mailAccountId === snapshot.mailAccountId
        && a.provider === snapshot.provider && a.connectionStatus === 'connected'
        && a.email.toLowerCase() === snapshot.mailAddress.toLowerCase());
    const receive = (event: Event) => {
      const snapshot = (event as CustomEvent<InboxMailSnapshot>).detail;
      if (!current(snapshot)) return;
      const found = detector.observe(snapshot);
      if (!found.length || !settings.feishuUrl || !settings.feishuFieldMapping?.email) return;
      pending = pending.then(async () => {
        if (!current(snapshot)) return;
        const profiles = await loadCreatorResourceProfiles(settings);
        const emails = new Set(profiles.flatMap((profile) => profile.emails.map(normalizeThreadContactEmail)));
        for (const { thread, message } of found) {
          if (!current(snapshot)) return;
          if (!emails.has(normalizeThreadContactEmail(message.from))) continue;
          try {
            const candidate = await resolveNewInboxMail(snapshot, { thread, message }, emails, () => current(snapshot));
            if (!candidate) continue;
            setDiscovered((previous) => [...previous.filter((item) => item.accountScope === scope && !(item.mailAccountId === candidate.mailAccountId
              && item.threadId === candidate.threadId)), { ...candidate, accountScope: scope }].slice(-100));
          } catch {
            // Discovery failures are retried by the existing five-minute daily-mail check.
          }
        }
      }).catch(() => { /* Existing daily-mail UI reports connection/profile failures. */ });
    };
    window.addEventListener(INBOX_NEW_MAIL_SNAPSHOT_EVENT, receive);
    return () => { disposed = true; window.removeEventListener(INBOX_NEW_MAIL_SNAPSHOT_EVENT, receive); };
  }, [active, scope, accounts, settings]);

  return useMemo(() => {
    const merged = new Map<string, MailTranslationPrefetchCandidate>();
    for (const item of [...discovered.filter((item) => item.accountScope === scope), ...daily]) {
      if (!active || !accounts.some((a) => a.mailAccountId === item.mailAccountId && a.connectionStatus === 'connected')) continue;
      merged.set(`${item.provider}:${item.mailAccountId}:${item.messageId}`, item);
    }
    return [...merged.values()];
  }, [active, accounts, daily, discovered, scope]);
}
