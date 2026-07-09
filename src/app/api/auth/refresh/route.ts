import { NextRequest, NextResponse } from 'next/server';
import { refreshStoredGmailAuth, toBrowserGmailAuth } from '@/lib/gmail-cloud-auth';
import { getRequestUser } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) return NextResponse.json({ error: '未登录。' }, { status: 401 });

  try {
    const force = new URL(request.url).searchParams.get('force') === '1';
    const auth = await refreshStoredGmailAuth(appAuth.supabase, { force });
    return NextResponse.json({ success: true, data: toBrowserGmailAuth(auth) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Token 刷新失败。' },
      { status: 400 },
    );
  }
}
