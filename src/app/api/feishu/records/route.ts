import { NextRequest, NextResponse } from 'next/server';
import { requestFeishuApi, resolveFeishuBaseUrl } from '@/lib/feishu-base';
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

const FEISHU_MULTI_SELECT_FIELD_TYPE = 4;

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
  return Object.fromEntries(
    Object.entries(fields).map(([fieldName, value]) => {
      if (fieldTypes.get(fieldName) !== FEISHU_MULTI_SELECT_FIELD_TYPE) {
        return [fieldName, value];
      }
      if (Array.isArray(value)) return [fieldName, value];
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return [fieldName, [String(value)]];
      }
      return [fieldName, value];
    }),
  );
}

export async function POST(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const body = await request.json() as {
      action?: 'list' | 'search' | 'get' | 'create' | 'update';
      url?: string;
      recordId?: string;
      fields?: Record<string, unknown>;
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
