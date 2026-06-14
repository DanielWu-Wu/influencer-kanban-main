import { NextRequest, NextResponse } from 'next/server';
import { fetchFeishuApi, parseFeishuBaseUrl } from '@/lib/feishu-base';
import { refreshStoredFeishuAuth } from '@/lib/feishu-cloud-auth';
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
    const { url } = await request.json() as { url?: string };
    if (!url) return NextResponse.json({ error: '请先粘贴飞书多维表格网址。' }, { status: 400 });

    const location = parseFeishuBaseUrl(url);
    const auth = await refreshStoredFeishuAuth(appAuth.supabase);
    const tablesData = await fetchFeishuApi<ListData<FeishuTable>>(
      `/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables?page_size=100`,
      auth.accessToken,
    );
    const tables = tablesData.items || [];
    const selectedTable = location.tableId
      ? tables.find((table) => table.table_id === location.tableId)
      : tables[0];
    if (!selectedTable) throw new Error('没有找到可读取的数据表。');

    const [fieldsData, recordsData] = await Promise.all([
      fetchFeishuApi<ListData<FeishuField>>(
        `/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables/${encodeURIComponent(selectedTable.table_id)}/fields?page_size=100`,
        auth.accessToken,
      ),
      fetchFeishuApi<ListData<FeishuRecord>>(
        `/bitable/v1/apps/${encodeURIComponent(location.appToken)}/tables/${encodeURIComponent(selectedTable.table_id)}/records?page_size=5`,
        auth.accessToken,
      ),
    ]);

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

