import { NextRequest, NextResponse } from 'next/server';
import { requestFeishuApi, resolveFeishuBaseUrl } from '@/lib/feishu-base';
import { refreshStoredFeishuAuth } from '@/lib/feishu-cloud-auth';
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

export async function POST(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const body = await request.json() as {
      action?: 'list' | 'create' | 'update';
      url?: string;
      recordId?: string;
      fields?: Record<string, unknown>;
      pageSize?: number;
      pageToken?: string;
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

    if (!body.fields || typeof body.fields !== 'object') {
      return NextResponse.json({ error: '缺少需要写入的字段。' }, { status: 400 });
    }

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
          body: JSON.stringify({ fields: body.fields }),
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
          body: JSON.stringify({ fields: body.fields }),
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
