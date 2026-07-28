import type { FeishuFieldMapping } from '@/lib/feishu-mapping';

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"']+/i;

export function extractFeishuUrl(value: unknown): string {
  if (typeof value === 'string') {
    return value.match(HTTP_URL_PATTERN)?.[0] || '';
  }
  if (Array.isArray(value)) {
    return value.map(extractFeishuUrl).find(Boolean) || '';
  }
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return [item.link, item.url, item.href, item.value, item.text]
      .map(extractFeishuUrl)
      .find(Boolean) || '';
  }
  return '';
}

export function extractMappedFeishuChannelUrl(
  fields: Record<string, unknown>,
  mapping: Pick<FeishuFieldMapping, 'channelUrl' | 'channelName'>,
) {
  return (
    extractFeishuUrl(mapping.channelUrl ? fields[mapping.channelUrl] : undefined)
    || extractFeishuUrl(mapping.channelName ? fields[mapping.channelName] : undefined)
  );
}
