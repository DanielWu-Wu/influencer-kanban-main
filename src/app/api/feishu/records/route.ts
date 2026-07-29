import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { requestFeishuApi, resolveFeishuBaseUrl } from '@/lib/feishu-base';
import {
  chunkFeishuItems,
  normalizeBatchOperationId,
  normalizeFeishuFieldsWithTypes,
  type FeishuBatchCreateItem,
  type FeishuBatchResult,
  type FeishuBatchUpdateItem,
} from '@/lib/feishu-batch';
import { refreshStoredFeishuAuth } from '@/lib/feishu-cloud-auth';
import {
  cacheFeishuFieldTypes,
  readCachedFeishuFieldTypes,
} from '@/lib/feishu-field-cache';
import { getRequestUser } from '@/lib/supabase/server';

type TableList = {
  items?: Array<{ table_id: string; name: string }>;
};

type RecordList = {
  items?: Array<{ record_id: string; fields: Record<string, unknown> }>;
  page_token?: string;
  has_more?: boolean;
  total?: number;
};

type RecordSearchFilter = {
  conjunction?: 'and' | 'or';
  conditions?: Array<{
    field_name: string;
    operator: string;
    value?: string[];
  }>;
};

type FieldList = {
  items?: Array<{ field_name: string; type: number }>;
};

async function resolveTableId(
  appToken: string,
  tableId: string | undefined,
  accessToken: string,
) {
  if (tableId) return tableId;
  const data = await requestFeishuApi<TableList>(
    `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?page_size=100`,
    accessToken,
  );
  const first = data.items?.[0];
  if (!first) throw new Error('没有找到可操作的数据表。');
  return first.table_id;
}

async function normalizeFieldsForWrite(
  appToken: string,
  tableId: string,
  accessToken: string,
  fields: Record<string, unknown>,
  cacheKey: string,
) {
  const fieldTypes = await loadFieldTypes(
    appToken,
    tableId,
    accessToken,
    cacheKey,
  );
  return normalizeFeishuFieldsWithTypes(fields, fieldTypes);
}

async function loadFieldTypes(
  appToken: string,
  tableId: string,
  accessToken: string,
  cacheKey: string,
) {
  let fieldTypes = readCachedFeishuFieldTypes(cacheKey);
  if (!fieldTypes) {
    const fieldsData = await requestFeishuApi<FieldList>(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields?page_size=100`,
      accessToken,
    );
    cacheFeishuFieldTypes(cacheKey, fieldsData.items || []);
    fieldTypes = readCachedFeishuFieldTypes(cacheKey);
  }
  if (!fieldTypes) throw new Error('飞书字段类型缓存失败。');
  return fieldTypes;
}

function stableClientToken(seed: string) {
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('');
  hash[12] = '4';
  hash[16] = ['8', '9', 'a', 'b'][Number.parseInt(hash[16], 16) % 4];
  const hex = hash.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function validateBatchItems(
  action: 'batchCreate' | 'batchUpdate',
  items: unknown,
): Array<FeishuBatchCreateItem | FeishuBatchUpdateItem> {
  if (!Array.isArray(items) || !items.length) throw new Error('缺少需要批量写入的记录。');
  if (items.length > 1_000) throw new Error('单次批量操作最多支持 1,000 条记录。');
  const clientIds = new Set<string>();
  return items.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 条批量记录格式不正确。`);
    const candidate = item as Partial<FeishuBatchUpdateItem>;
    if (!candidate.clientId?.trim()) throw new Error(`第 ${index + 1} 条记录缺少 clientId。`);
    const clientId = candidate.clientId.trim();
    if (clientIds.has(clientId)) throw new Error(`批量记录 clientId“${clientId}”重复。`);
    clientIds.add(clientId);
    if (!candidate.fields || typeof candidate.fields !== 'object') {
      throw new Error(`第 ${index + 1} 条记录缺少写入字段。`);
    }
    if (action === 'batchUpdate' && !candidate.recordId?.trim()) {
      throw new Error(`第 ${index + 1} 条更新记录缺少 recordId。`);
    }
    return {
      clientId,
      fields: candidate.fields,
      ...(action === 'batchUpdate' ? { recordId: candidate.recordId!.trim() } : {}),
    };
  });
}

export async function POST(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const body = await request.json() as {
      action?: 'list' | 'search' | 'get' | 'create' | 'update' | 'batchCreate' | 'batchUpdate';
      url?: string;
      recordId?: string;
      fields?: Record<string, unknown>;
      operationId?: string;
      items?: unknown[];
      pageSize?: number;
      pageToken?: string;
      filter?: RecordSearchFilter;
      fieldNames?: string[];
    };
    if (!body.url) return NextResponse.json({ error: '缺少多维表格网址。' }, { status: 400 });

    const auth = await refreshStoredFeishuAuth(appAuth.supabase);
    const location = await resolveFeishuBaseUrl(body.url, auth.accessToken);
    const tableId = await resolveTableId(
      location.appToken,
      location.tableId,
      auth.accessToken,
    );
    const basePath = `/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables/${encodeURIComponent(tableId)}/records`;

    if (body.action === 'list') {
      const pageSize = Math.max(1, Math.min(body.pageSize || 100, 500));
      const query = new URLSearchParams({ page_size: String(pageSize) });
      if (body.pageToken) query.set('page_token', body.pageToken);
      const data = await requestFeishuApi<RecordList>(
        `${basePath}?${query.toString()}`,
        auth.accessToken,
      );
      return NextResponse.json({ success: true, data });
    }

    if (body.action === 'search') {
      const pageSize = Math.max(1, Math.min(body.pageSize || 100, 500));
      const query = new URLSearchParams({ page_size: String(pageSize) });
      if (body.pageToken) query.set('page_token', body.pageToken);
      const data = await requestFeishuApi<RecordList>(
        `${basePath}/search?${query.toString()}`,
        auth.accessToken,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({
            filter: body.filter,
            field_names: body.fieldNames,
          }),
        },
      );
      return NextResponse.json({ success: true, data });
    }

    if (body.action === 'get') {
      if (!body.recordId) {
        return NextResponse.json({ error: '缺少需要读取的记录 ID。' }, { status: 400 });
      }
      const data = await requestFeishuApi<{ record: { record_id: string; fields: Record<string, unknown> } }>(
        `${basePath}/${encodeURIComponent(body.recordId)}`,
        auth.accessToken,
      );
      return NextResponse.json({ success: true, data });
    }

    if (body.action === 'batchCreate' || body.action === 'batchUpdate') {
      const operationId = normalizeBatchOperationId(body.operationId || '');
      const items = validateBatchItems(body.action, body.items);
      const fieldTypes = await loadFieldTypes(
        location.appToken,
        tableId,
        auth.accessToken,
        `${appAuth.user.id}:${location.appToken}:${tableId}`,
      );
      const normalizedItems = items.map((item) => ({
        ...item,
        fields: normalizeFeishuFieldsWithTypes(item.fields, fieldTypes),
      }));
      const results: FeishuBatchResult[] = [];
      const batches = chunkFeishuItems(normalizedItems);

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
        const batch = batches[batchIndex];
        const clientIds = batch.map((item) => item.clientId).sort().join(',');
        const clientToken = stableClientToken(
          `${appAuth.user.id}:${operationId}:${location.appToken}:${tableId}:${batchIndex}:${clientIds}`,
        );
        try {
          const endpoint = body.action === 'batchCreate' ? 'batch_create' : 'batch_update';
          const data = await requestFeishuApi<{
            records?: Array<{ record_id?: string; id?: string }>;
          }>(
            `${basePath}/${endpoint}?client_token=${encodeURIComponent(clientToken)}`,
            auth.accessToken,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${auth.accessToken}`,
                'Content-Type': 'application/json; charset=utf-8',
              },
              body: JSON.stringify({
                records: batch.map((item) => ({
                  ...(body.action === 'batchUpdate'
                    ? { record_id: (item as FeishuBatchUpdateItem).recordId }
                    : {}),
                  fields: item.fields,
                })),
              }),
            },
          );
          const records = data.records || [];
          batch.forEach((item, itemIndex) => {
            const returned = records[itemIndex];
            const recordId = returned?.record_id
              || returned?.id
              || (body.action === 'batchUpdate' ? (item as FeishuBatchUpdateItem).recordId : '');
            results.push(recordId
              ? { clientId: item.clientId, status: 'success', recordId }
              : { clientId: item.clientId, status: 'failed', error: '飞书未返回记录 ID。' });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : '飞书批量写入失败。';
          batch.forEach((item) => {
            results.push({ clientId: item.clientId, status: 'failed', error: message });
          });
        }
      }

      const orderedResults = items.map((item) => (
        results.find((result) => result.clientId === item.clientId)
        || { clientId: item.clientId, status: 'failed' as const, error: '飞书未返回该记录的处理结果。' }
      ));
      return NextResponse.json({
        success: true,
        data: {
          complete: orderedResults.every((result) => result.status === 'success'),
          results: orderedResults,
        },
      });
    }

    if (!body.fields || typeof body.fields !== 'object') {
      return NextResponse.json({ error: '缺少需要写入的字段。' }, { status: 400 });
    }
    const normalizedFields = await normalizeFieldsForWrite(
      location.appToken,
      tableId,
      auth.accessToken,
      body.fields,
      `${appAuth.user.id}:${location.appToken}:${tableId}`,
    );

    if (body.action === 'create') {
      const data = await requestFeishuApi<{ record: unknown }>(
        basePath,
        auth.accessToken,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ fields: normalizedFields }),
        },
      );
      return NextResponse.json({ success: true, data });
    }

    if (body.action === 'update') {
      if (!body.recordId) {
        return NextResponse.json({ error: '缺少需要更新的记录 ID。' }, { status: 400 });
      }
      const data = await requestFeishuApi<{ record: unknown }>(
        `${basePath}/${encodeURIComponent(body.recordId)}`,
        auth.accessToken,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ fields: normalizedFields }),
        },
      );
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ error: '不支持的操作。' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '飞书记录操作失败。' },
      { status: 400 },
    );
  }
}
