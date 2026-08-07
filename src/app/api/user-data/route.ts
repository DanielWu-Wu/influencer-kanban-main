import { NextRequest, NextResponse } from 'next/server';
import { PUBLIC_USER_DATA_KEYS, type UserDataKey } from '@/lib/account-data-keys';
import { getRequestUser } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const account = await getRequestUser(request);
  if (!account) return NextResponse.json({ error: '账号无权访问业务数据。' }, { status: 403 });

  const keys = Array.from(PUBLIC_USER_DATA_KEYS);
  const { data, error } = await account.supabase
    .from('user_data')
    .select('data_key,data')
    .eq('user_id', account.user.id)
    .in('data_key', keys);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    data: Object.fromEntries((data || []).map((row) => [row.data_key, row.data])),
  });
}

export async function PUT(request: NextRequest) {
  const account = await getRequestUser(request);
  if (!account) return NextResponse.json({ error: '账号无权访问业务数据。' }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { key?: unknown; data?: unknown };
  const key = typeof body.key === 'string' ? body.key as UserDataKey : null;
  if (!key || !PUBLIC_USER_DATA_KEYS.has(key)) {
    return NextResponse.json({ error: '不支持的数据类型。' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await account.supabase.from('user_data').upsert({
    user_id: account.user.id,
    data_key: key,
    data: body.data ?? null,
    updated_at: now,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
