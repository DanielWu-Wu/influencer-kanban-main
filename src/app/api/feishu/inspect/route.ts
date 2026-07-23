import { NextRequest, NextResponse } from 'next/server';
import { fetchFeishuApi, resolveFeishuBaseUrl } from '@/lib/feishu-base';
import { refreshStoredFeishuAuth } from '@/lib/feishu-cloud-auth';
import { cacheFeishuFieldTypes } from '@/lib/feishu-field-cache';
import { getRequestUser } from '@/lib/supabase/server';

type ListData<T> = {
  items?: T[];
  total?: number;
};

type FeishuTable = {
  table_id: string;
  name: string;
};

type FeishuField = {
  field_id: string;
  field_name: string;
  type: number;
};

type FeishuRecord = {
  record_id: string;
  fields: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const { url, fieldsOnly } = await request.json() as { url?: string; fieldsOnly?: boolean };
    if (!url) return NextResponse.json({ error: '请先粘贴飞书多维表格网址。' }, { status: 400 });

    const auth = await refreshStoredFeishuAuth(appAuth.supabase);
    const location = await resolveFeishuBaseUrl(url, auth.accessToken);
    if (fieldsOnly && location.tableId) {
      const fieldsData = await fetchFeishuApi<ListData<FeishuField>>(
        `/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables/${encodeURIComponent(location.tableId)}/fields?page_size=100`,
        auth.accessToken,
      );
      cacheFeishuFieldTypes(
        `${appAuth.user.id}:${location.appToken}:${location.tableId}`,
        fieldsData.items || [],
      );
      return NextResponse.json({
        success: true,
        data: {
          appToken: location.appToken,
          selectedTable: { table_id: location.tableId, name: '' },
          tables: [],
          fields: fieldsData.items || [],
          totalRecords: 0,
          sampleRecords: [],
        },
      });
    }

    const tablesData = await fetchFeishuApi<ListData<FeishuTable>>(
      `/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables?page_size=100`,
      auth.accessToken,
    );
    const tables = tablesData.items || [];
    const selectedTable = location.tableId
      ? tables.find((table) => table.table_id === location.tableId)
      : tables[0];
    if (!selectedTable) throw new Error('没有找到可读取的数据表。');

    const fieldsPromise = fetchFeishuApi<ListData<FeishuField>>(
      `/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables/${encodeURIComponent(selectedTable.table_id)}/fields?page_size=100`,
      auth.accessToken,
    );
    const recordsPromise = fieldsOnly
      ? Promise.resolve({ items: [], total: 0 } as ListData<FeishuRecord>)
      : fetchFeishuApi<ListData<FeishuRecord>>(
          `/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables/${encodeURIComponent(selectedTable.table_id)}/records?page_size=5`,
          auth.accessToken,
        );
    const [fieldsData, recordsData] = await Promise.all([fieldsPromise, recordsPromise]);
    cacheFeishuFieldTypes(
      `${appAuth.user.id}:${location.appToken}:${selectedTable.table_id}`,
      fieldsData.items || [],
    );

    return NextResponse.json({
      success: true,
      data: {
        appToken: location.appToken,
        selectedTable,
        tables,
        fields: fieldsData.items || [],
        totalRecords: recordsData.total ?? (recordsData.items || []).length,
        sampleRecords: recordsData.items || [],
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '飞书只读检查失败。' },
      { status: 400 },
    );
  }
}
