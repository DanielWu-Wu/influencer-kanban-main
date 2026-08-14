import type { GmailThread } from './types';

export const GMAIL_INBOX_CACHE_FRESH_MS = 60_000;
const GMAIL_INBOX_CACHE_MAX_ENTRIES = 40;

export interface GmailInboxCacheEntry {
  threads: GmailThread[];
  nextPageToken: string | null;
  normalUnreadCount: number | null;
  lastSyncedAt: string;
  fetchedAt: number;
}

const gmailInboxCache = new Map<string, GmailInboxCacheEntry>();

export function createGmailInboxCacheKey(options: {
  accountScope: string;
  gmailEmail?: string;
  viewKey: string;
  pageIndex: number;
}) {
  return [
    options.accountScope,
    options.gmailEmail?.trim().toLowerCase() || 'unknown-gmail',
    options.viewKey,
    String(options.pageIndex),
  ].join('::');
}

export function readGmailInboxCache(key: string) {
  return gmailInboxCache.get(key) || null;
}

export function isGmailInboxCacheKeyCurrent(
  candidateKey: string | null,
  currentKey: string | null,
): candidateKey is string {
  return Boolean(candidateKey && currentKey && candidateKey === currentKey);
}

export function writeGmailInboxCache(key: string, entry: GmailInboxCacheEntry) {
  gmailInboxCache.delete(key);
  gmailInboxCache.set(key, entry);
  while (gmailInboxCache.size > GMAIL_INBOX_CACHE_MAX_ENTRIES) {
    const oldestKey = gmailInboxCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    gmailInboxCache.delete(oldestKey);
  }
}

export function isGmailInboxCacheFresh(
  entry: GmailInboxCacheEntry,
  now = Date.now(),
) {
  return now - entry.fetchedAt < GMAIL_INBOX_CACHE_FRESH_MS;
}

export function clearGmailInboxCache() {
  gmailInboxCache.clear();
}
