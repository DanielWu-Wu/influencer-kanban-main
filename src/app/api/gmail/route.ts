import { NextRequest, NextResponse } from 'next/server';

// Gmail API 代理 - 获取邮件列表和详情
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action'); // 'threads' | 'message' | 'profile'
    const accessToken = searchParams.get('token');
    const messageId = searchParams.get('messageId');

    if (!accessToken) {
      return NextResponse.json({ error: '缺少 access token' }, { status: 401 });
    }

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    if (action === 'profile') {
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers });
      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: '获取用户信息失败', details: err }, { status: res.status });
      }
      const data = await res.json();
      return NextResponse.json({ success: true, data });
    }

    if (action === 'threads') {
      const maxResults = searchParams.get('maxResults') || '20';
      const pageToken = searchParams.get('pageToken');
      const q = searchParams.get('q'); // search query

      let url = `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${maxResults}`;
      if (pageToken) url += `&pageToken=${pageToken}`;
      if (q) url += `&q=${encodeURIComponent(q)}`;

      const res = await fetch(url, { headers });
      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: '获取邮件列表失败', details: err }, { status: res.status });
      }
      const data = await res.json();

      // 获取每个 thread 的详细信息
      if (data.threads && data.threads.length > 0) {
        const threadDetails = await Promise.all(
          data.threads.map(async (thread: { id: string }) => {
            const threadRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,
              { headers }
            );
            if (!threadRes.ok) return thread;
            return await threadRes.json();
          })
        );
        data.threads = threadDetails;
      }

      return NextResponse.json({ success: true, data });
    }

    if (action === 'message') {
      if (!messageId) {
        return NextResponse.json({ error: '缺少 messageId' }, { status: 400 });
      }
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
        { headers }
      );
      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: '获取邮件详情失败', details: err }, { status: res.status });
      }
      const data = await res.json();
      return NextResponse.json({ success: true, data });
    }

    if (action === 'thread') {
      const threadId = searchParams.get('threadId');
      if (!threadId) {
        return NextResponse.json({ error: '缺少 threadId' }, { status: 400 });
      }
      const res = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
        { headers }
      );
      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: '获取对话详情失败', details: err }, { status: res.status });
      }
      const data = await res.json();
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (err) {
    console.error('Gmail API proxy error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 保存草稿
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, accessToken, to, subject, body: emailBody, threadId } = body;

    if (!accessToken) {
      return NextResponse.json({ error: '缺少 access token' }, { status: 401 });
    }

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    if (action === 'draft') {
      // 创建草稿
      const rawEmail = [
        `To: ${to}`,
        `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        emailBody,
      ].join('\r\n');

      const encodedEmail = Buffer.from(rawEmail)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: {
            raw: encodedEmail,
            threadId: threadId || undefined,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        return NextResponse.json({ error: '创建草稿失败', details: err }, { status: res.status });
      }

      const data = await res.json();
      return NextResponse.json({ success: true, data });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (err) {
    console.error('Gmail draft error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
