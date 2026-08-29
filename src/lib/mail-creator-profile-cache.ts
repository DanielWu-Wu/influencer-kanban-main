import {
  ACCOUNT_SCOPE_CHANGED_EVENT,
  getAccountCacheScope,
} from '@/lib/account-cache-scope';
import type { FeishuFieldMapping } from '@/lib/feishu-mapping';

export type MailCreatorProfile = {
  recordId: string;
  email: string;
  matchedBy: string;
  channelName: string;
  channelUrl: string;
  channelId: string;
  region: string;
  platform: string;
  followers: string;
  collaborationStatus: string;
  hasReply: string;
};

export type MailCreatorProfileCacheEntry = {
  profile: MailCreatorProfile | null;
  matchedAt: number;
};

export type MailCreatorProfileLookupInput = {
  accountScope?: string;
  provider: 'gmail' | 'tencent_exmail';
  mailAccountId: string;
  threadId: string;
  contactEmails: string[];
  feishuUrl: string;
  mapping: FeishuFieldMapping;
};

export type NormalizedMailCreatorProfileLookup = {
  accountScope: string;
  provider: 'gmail' | 'tencent_exmail';
  mailAccountId: string;
  threadId: string;
  contactEmails: string[];
  feishuUrl: string;
  mapping: FeishuFieldMapping;
};

export const MAIL_CREATOR_PROFILE_CACHE_MAX_ENTRIES = 100;

const profileCache = new Map<string, MailCreatorProfileCacheEntry>();

function normalizeContactEmails(emails: string[]) {
  return Array.from(new Set(
    emails
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )).sort();
}

function normalizeMapping(mapping: FeishuFieldMapping) {
  return Object.entries(mapping)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))
    .map(([key, value]) => [key, value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
}

export function buildMailCreatorProfileLookupKey(input: MailCreatorProfileLookupInput) {
  return JSON.stringify({
    accountScope: input.accountScope || getAccountCacheScope(),
    provider: input.provider,
    mailAccountId: input.mailAccountId.trim(),
    threadId: input.threadId.trim(),
    contactEmails: normalizeContactEmails(input.contactEmails),
    feishuUrl: input.feishuUrl.trim(),
    mapping: normalizeMapping(input.mapping),
  });
}

export function parseMailCreatorProfileLookupKey(
  key: string,
): NormalizedMailCreatorProfileLookup | null {
  try {
    const parsed = JSON.parse(key) as Omit<NormalizedMailCreatorProfileLookup, 'mapping'> & {
      mapping: Array<[string, string]>;
    };
    if (
      !parsed.accountScope
      || !parsed.mailAccountId
      || !parsed.threadId
      || !parsed.feishuUrl
      || !Array.isArray(parsed.contactEmails)
      || !Array.isArray(parsed.mapping)
      || (parsed.provider !== 'gmail' && parsed.provider !== 'tencent_exmail')
    ) {
      return null;
    }
    return {
      ...parsed,
      mapping: Object.fromEntries(parsed.mapping) as FeishuFieldMapping,
    };
  } catch {
    return null;
  }
}

export function readMailCreatorProfileCache(key: string) {
  const cached = profileCache.get(key);
  if (!cached) return undefined;
  profileCache.delete(key);
  profileCache.set(key, cached);
  return cached;
}

export function writeMailCreatorProfileCache(
  key: string,
  profile: MailCreatorProfile | null,
  matchedAt = Date.now(),
) {
  profileCache.delete(key);
  profileCache.set(key, { profile, matchedAt });
  while (profileCache.size > MAIL_CREATOR_PROFILE_CACHE_MAX_ENTRIES) {
    const oldestKey = profileCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    profileCache.delete(oldestKey);
  }
}

export function clearMailCreatorProfileCache() {
  profileCache.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, clearMailCreatorProfileCache);
}
