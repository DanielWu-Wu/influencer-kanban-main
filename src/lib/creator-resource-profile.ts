import type { AppSettings } from '@/lib/data';
import { flattenFeishuValue, type CooperationProject } from '@/lib/cooperation-projects';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';
import { fetchFeishuRecordsCached } from '@/lib/feishu-record-cache';
import { extractMappedFeishuChannelUrl } from '@/lib/feishu-field-value';

type FeishuRecord = {
  record_id: string;
  fields: Record<string, unknown>;
};

export type CreatorResourceProfile = {
  recordId: string;
  channelName: string;
  channelUrl: string;
  channelId: string;
  avatarUrl: string;
  emails: string[];
};

export type CreatorResourceMatch = {
  method: 'channelId' | 'channelUrl' | 'channelName' | 'none';
  profiles: CreatorResourceProfile[];
  ambiguous: boolean;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function extractEmailAddresses(value: unknown) {
  const matches = flattenFeishuValue(value).match(EMAIL_PATTERN) || [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase())));
}

export function normalizeCreatorChannelUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return value.trim().replace(/\/+$/, '').toLowerCase();
  }
}

function mappedValue(record: FeishuRecord, mapping: FeishuFieldMapping, key: FeishuFieldKey) {
  const fieldName = mapping[key];
  return fieldName ? flattenFeishuValue(record.fields[fieldName]).trim() : '';
}

function getFeishuImageUrl(value: unknown): string {
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : '';
  if (Array.isArray(value)) return value.map(getFeishuImageUrl).find(Boolean) || '';
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return [item.thumbnail_url, item.url, item.tmp_url, item.link]
      .map(getFeishuImageUrl)
      .find(Boolean) || '';
  }
  return '';
}

export async function loadCreatorResourceProfiles(settings: AppSettings) {
  const url = settings.feishuUrl?.trim() || '';
  const mapping = settings.feishuFieldMapping || {};
  const fieldNames = Array.from(new Set([
    mapping.channelName,
    mapping.channelUrl,
    mapping.channelId,
    mapping.avatar,
    mapping.email,
  ].filter(Boolean))) as string[];
  if (!url || !fieldNames.length) return [];

  const profiles: CreatorResourceProfile[] = [];
  const records = await fetchFeishuRecordsCached(url, { fieldNames });
  for (const record of records) {
    const emailField = mapping.email ? record.fields[mapping.email] : undefined;
    profiles.push({
      recordId: record.record_id,
      channelName: mappedValue(record, mapping, 'channelName'),
      channelUrl: extractMappedFeishuChannelUrl(record.fields, mapping),
      channelId: mappedValue(record, mapping, 'channelId'),
      avatarUrl: getFeishuImageUrl(mapping.avatar ? record.fields[mapping.avatar] : undefined),
      emails: extractEmailAddresses(emailField),
    });
  }
  return profiles;
}

export function matchCreatorResourceProfiles(
  project: Pick<CooperationProject, 'channelId' | 'channelUrl' | 'channelName'>,
  profiles: CreatorResourceProfile[],
): CreatorResourceMatch {
  const channelId = project.channelId.trim().toLowerCase();
  if (channelId) {
    const matches = profiles.filter((profile) => profile.channelId.trim().toLowerCase() === channelId);
    if (matches.length) return { method: 'channelId', profiles: matches, ambiguous: false };
  }

  const channelUrl = normalizeCreatorChannelUrl(project.channelUrl);
  if (channelUrl) {
    const matches = profiles.filter((profile) => normalizeCreatorChannelUrl(profile.channelUrl) === channelUrl);
    if (matches.length) return { method: 'channelUrl', profiles: matches, ambiguous: false };
  }

  const channelName = project.channelName.trim().toLocaleLowerCase();
  if (!channelName || channelName === '未命名红人') {
    return { method: 'none', profiles: [], ambiguous: false };
  }
  const matches = profiles.filter(
    (profile) => profile.channelName.trim().toLocaleLowerCase() === channelName,
  );
  if (matches.length === 1) return { method: 'channelName', profiles: matches, ambiguous: false };
  return {
    method: matches.length ? 'channelName' : 'none',
    profiles: [],
    ambiguous: matches.length > 1,
  };
}

export function collectProfileEmails(profiles: CreatorResourceProfile[]) {
  return Array.from(new Set(profiles.flatMap((profile) => profile.emails)));
}
