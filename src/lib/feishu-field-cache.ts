const FIELD_TYPE_CACHE_TTL_MS = 5 * 60 * 1000;
const FIELD_TYPE_CACHE_MAX_ENTRIES = 100;

const fieldTypeCache = new Map<string, {
  expiresAt: number;
  fieldTypes: Map<string, number>;
}>();

export type FeishuFieldType = {
  field_name: string;
  type: number;
};

export function readCachedFeishuFieldTypes(cacheKey: string) {
  const cached = fieldTypeCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    fieldTypeCache.delete(cacheKey);
    return null;
  }
  return cached.fieldTypes;
}

export function cacheFeishuFieldTypes(
  cacheKey: string,
  fields: FeishuFieldType[],
) {
  if (fieldTypeCache.size >= FIELD_TYPE_CACHE_MAX_ENTRIES) {
    const oldestKey = fieldTypeCache.keys().next().value;
    if (oldestKey) fieldTypeCache.delete(oldestKey);
  }
  fieldTypeCache.set(cacheKey, {
    expiresAt: Date.now() + FIELD_TYPE_CACHE_TTL_MS,
    fieldTypes: new Map(fields.map((field) => [field.field_name, field.type])),
  });
}
