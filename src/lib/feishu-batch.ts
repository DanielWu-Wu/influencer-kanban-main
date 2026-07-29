export const FEISHU_BATCH_SIZE = 50;

export type FeishuBatchCreateItem = {
  clientId: string;
  fields: Record<string, unknown>;
};

export type FeishuBatchUpdateItem = FeishuBatchCreateItem & {
  recordId: string;
};

export type FeishuBatchResult = {
  clientId: string;
  status: 'success' | 'failed';
  recordId?: string;
  error?: string;
};

export function chunkFeishuItems<T>(items: T[], size = FEISHU_BATCH_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function normalizeBatchOperationId(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error('缺少批量操作标识。');
  if (normalized.length > 120) throw new Error('批量操作标识过长。');
  return normalized;
}

export function normalizeFeishuFieldsWithTypes(
  fields: Record<string, unknown>,
  fieldTypes: Map<string, number>,
) {
  const missingFieldNames = Object.keys(fields).filter((fieldName) => !fieldTypes.has(fieldName));
  if (missingFieldNames.length) {
    throw new Error(
      `飞书中找不到字段“${missingFieldNames.join('、')}”。字段可能已改名或删除，请到设置中对目标子表执行“只读检查子表”，确认映射后重新保存。`,
    );
  }
  return Object.fromEntries(
    Object.entries(fields).map(([fieldName, value]) => {
      if (fieldTypes.get(fieldName) !== 4) return [fieldName, value];
      if (Array.isArray(value)) return [fieldName, value];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [fieldName, [String(value)]];
      }
      return [fieldName, value];
    }),
  );
}
