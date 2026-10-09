import { gzipSync, gunzipSync } from 'node:zlib';

type Envelope = { monitorEncoding: 'gzip-base64-v1'; payload: string; saveId?: string };

/** Server-only, lossless envelope; existing JSON snapshots remain readable. */
export function encodeMonitorCloud(value: unknown): unknown {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') < 128_000) return value;
  const payload = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
  const saveId = (value as { saveId?: string })?.saveId;
  return { monitorEncoding: 'gzip-base64-v1', payload, saveId } satisfies Envelope;
}

export function decodeMonitorCloud<T>(value: unknown): T {
  const envelope = value as Partial<Envelope> | null;
  if (envelope?.monitorEncoding !== 'gzip-base64-v1') return value as T;
  if (typeof envelope.payload !== 'string') throw new Error('检测记录压缩内容无效。');
  const json = gunzipSync(Buffer.from(envelope.payload, 'base64'), { maxOutputLength: 16_000_000 }).toString('utf8');
  return JSON.parse(json) as T;
}
