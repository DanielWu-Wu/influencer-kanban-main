import { NextRequest, NextResponse } from 'next/server';
import { repairTextEncoding } from '@/lib/email-text';
import { classifyFollowUpConversation } from '@/lib/outreach-follow-up';
import { containsIgnoredGmailContactEmail } from '@/lib/gmail-thread-contact';

type GmailHeader = { name: string; value: string };
type InlineImagePayload = {
  contentId?: string;
  fileName?: string;
  mimeType?: string;
  dataUrl?: string;
};

function encodeBase64(value: string) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join('\r\n') || '';
}

function htmlToText(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|blockquote|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeHeaderValue(value: string) {
  return value.replace(/[\r\n]/g, ' ').trim();
}

function dataUrlToBase64(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function summarizeGmailError(status: number, details: string) {
  try {
    const payload = JSON.parse(details) as {
      error?: {
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string; message?: string }>;
      };
    };
    const reason = payload.error?.errors?.map((item) => item.reason || item.message).filter(Boolean).join('；');
    return [payload.error?.message, payload.error?.status, reason]
      .filter(Boolean)
      .join('；') || `Gmail 返回 ${status}`;
  } catch {
    return details.trim() || `Gmail 返回 ${status}`;
  }
}

function shouldRetryGmailDraft(status: number, details: string) {
  if ([429, 500, 502, 503, 504].includes(status)) return true;
  const normalized = details.toLowerCase();
  return [
    'ratelimit',
    'rate limit',
    'backenderror',
    'internal error',
    'temporarily',
    'timeout',
  ].some((keyword) => normalized.includes(keyword));
}

function getHeader(headers: GmailHeader[] = [], name: string) {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function getEmailAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase()
    || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase()
    || '';
}

function isAutomatedReply(headers: GmailHeader[], subject: string, from: string) {
  const autoSubmitted = getHeader(headers, 'Auto-Submitted').toLowerCase();
  const precedence = getHeader(headers, 'Precedence').toLowerCase();
  const normalized = `${subject} ${from}`.toLowerCase();
  return autoSubmitted && autoSubmitted !== 'no'
    || ['bulk', 'junk', 'list', 'auto_reply'].includes(precedence)
    || /(automatic reply|auto[- ]?reply|out of office|autoreply|vacation reply|自动回复)/i.test(normalized);
}

function isDeliveryFailure(subject: string, from: string) {
  const normalized = `${subject} ${from}`.toLowerCase();
  return /(mailer-daemon|postmaster|delivery status notification|undeliverable|delivery failed|delivery failure|地址不存在|投递失败)/i.test(normalized);
}

function decodeBase64Url(data: string, charset = 'utf-8') {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const buffer = Buffer.from(normalized, 'base64');
  try {
    return repairTextEncoding(new TextDecoder(charset).decode(buffer));
  } catch {
    return repairTextEncoding(buffer.toString('utf8'));
  }
}

function collectMessageBodies(payload: Record<string, unknown>, text: string[], html: string[]) {
  const headers = (payload.headers as GmailHeader[]) || [];
  const body = (payload.body as Record<string, unknown>) || {};
  const data = typeof body.data === 'string' ? body.data : '';
  const mimeType = String(payload.mimeType || '');
  const charset = getHeader(headers, 'Content-Type').match(/charset=["']?([^;"'\s]+)/i)?.[1] || 'utf-8';

  if (data && mimeType === 'text/plain') text.push(decodeBase64Url(data, charset));
  if (data && mimeType === 'text/html') html.push(decodeBase64Url(data, charset));

  const parts = payload.parts as Record<string, unknown>[] | undefined;
  parts?.forEach((part) => collectMessageBodies(part, text, html));
}

function parseHistoryMessage(message: Record<string, unknown>) {
  const payload = (message.payload || {}) as Record<string, unknown>;
  const headers = (payload.headers as GmailHeader[]) || [];
  const text: string[] = [];
  const html: string[] = [];
  collectMessageBodies(payload, text, html);
  const htmlFallback = repairTextEncoding(html.join('\n'))
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const rawDate = getHeader(headers, 'Date');

  return {
    id: String(message.id || ''),
    threadId: String(message.threadId || ''),
    labelIds: Array.isArray(message.labelIds)
      ? message.labelIds.map((label) => String(label || ''))
      : [],
    rfcMessageId: getHeader(headers, 'Message-ID'),
    references: getHeader(headers, 'References'),
    subject: getHeader(headers, 'Subject') || '无主题',
    from: getHeader(headers, 'From'),
    to: getHeader(headers, 'To'),
    date: rawDate ? new Date(rawDate).toISOString() : '',
    body: repairTextEncoding(text.join('\n\n').trim() || htmlFallback || String(message.snippet || '')),
    automated: isAutomatedReply(headers, getHeader(headers, 'Subject'), getHeader(headers, 'From')),
    deliveryFailure: isDeliveryFailure(getHeader(headers, 'Subject'), getHeader(headers, 'From')),
  };
}

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

    if (action === 'contactHistory') {
      const contactEmail = searchParams.get('email')?.trim();
      const maxResults = Math.min(Number(searchParams.get('maxResults') || 50), 50);
      if (!contactEmail) {
        return NextResponse.json({ error: '缺少联系人邮箱' }, { status: 400 });
      }

      const q = `{from:${contactEmail} to:${contactEmail}}`;
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`,
        { headers },
      );
      if (!listRes.ok) {
        const details = await listRes.text();
        return NextResponse.json(
          { error: '获取联系人历史邮件失败', details },
          { status: listRes.status },
        );
      }

      const listData = await listRes.json();
      const references = (listData.messages || []) as Array<{ id: string }>;
      const messages = await Promise.all(references.map(async ({ id }) => {
        const messageRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers },
        );
        if (!messageRes.ok) return null;
        return parseHistoryMessage(await messageRes.json());
      }));

      return NextResponse.json({
        success: true,
        data: messages
          .filter(Boolean)
          .sort((a, b) => new Date(a!.date || 0).getTime() - new Date(b!.date || 0).getTime()),
      });
    }

    if (action === 'outreachFollowUp') {
      const contactEmail = searchParams.get('email')?.trim().toLowerCase();
      const sentAt = Number(searchParams.get('sentAt') || 0);
      if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return NextResponse.json({ error: '请提供有效的红人邮箱。' }, { status: 400 });
      }
      if (!Number.isFinite(sentAt) || sentAt <= 0) {
        return NextResponse.json({ error: '缺少初次开发信发送日期。' }, { status: 400 });
      }

      const afterDate = new Date(sentAt).toISOString().slice(0, 10).replace(/-/g, '/');
      const q = `{from:${contactEmail} to:${contactEmail}} after:${afterDate}`;
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=${encodeURIComponent(q)}`,
        { headers },
      );
      if (!listRes.ok) {
        const details = await listRes.text();
        return NextResponse.json(
          { error: `读取开发信往来失败：${summarizeGmailError(listRes.status, details)}`, details },
          { status: listRes.status },
        );
      }

      const listData = await listRes.json();
      const references = (listData.messages || []) as Array<{ id: string }>;
      const messages = (await Promise.all(references.map(async ({ id }) => {
        const messageRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers },
        );
        if (!messageRes.ok) return null;
        return parseHistoryMessage(await messageRes.json());
      }))).filter(Boolean);

      const timeline = messages
        .filter((message): message is NonNullable<typeof message> => Boolean(message))
        .filter((message) => new Date(message.date || 0).getTime() >= sentAt)
        .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
      const allOutbound = timeline.filter((message) => {
        const sender = getEmailAddress(message.from);
        const recipients = message.to.toLowerCase();
        return message.labelIds.includes('SENT')
          && !message.labelIds.includes('DRAFT')
          && sender !== contactEmail
          && recipients.includes(contactEmail);
      });
      const incoming = timeline.filter((message) => getEmailAddress(message.from) === contactEmail);
      const deliveryFailures = timeline.filter((message) => message.deliveryFailure);
      const automatedReplies = incoming.filter((message) => message.automated && !message.deliveryFailure);
      const humanReplies = incoming.filter((message) => !message.automated && !message.deliveryFailure);
      const {
        outboundBeforeReply,
        humanRepliesAfterOutreach,
      } = classifyFollowUpConversation(allOutbound, humanReplies);
      const latestReply = humanRepliesAfterOutreach.at(-1);

      return NextResponse.json({
        success: true,
        data: {
          // 红人首次人工回复后的我方邮件属于正常对话，不占用 Follow Up 次数。
          outbound: outboundBeforeReply.slice(0, 3),
          reply: latestReply || null,
          automatedReply: automatedReplies.at(-1) || null,
          deliveryFailure: deliveryFailures.at(-1) || null,
        },
      });
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
    const {
      action,
      accessToken,
      to,
      subject,
      body: emailBody,
      bodyHtml,
      inlineImages,
      threadId,
      inReplyTo,
      references,
      contactEmail,
      maxResults: requestedMaxResults,
    } = body;

    if (!accessToken) {
      return NextResponse.json({ error: '缺少 access token' }, { status: 401 });
    }

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    if (action === 'contactHistory') {
      if (!contactEmail) {
        return NextResponse.json({ error: '缺少联系人邮箱' }, { status: 400 });
      }
      const maxResults = Math.min(Number(requestedMaxResults || 50), 50);
      const q = `{from:${contactEmail} to:${contactEmail}}`;
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(q)}`,
        { headers },
      );
      if (!listRes.ok) {
        const details = await listRes.text();
        return NextResponse.json(
          { error: '获取联系人历史邮件失败', details },
          { status: listRes.status },
        );
      }

      const listData = await listRes.json();
      const messageRefs = (listData.messages || []) as Array<{ id: string }>;
      const messages = await Promise.all(messageRefs.map(async ({ id }) => {
        const messageRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
          { headers },
        );
        if (!messageRes.ok) return null;
        return parseHistoryMessage(await messageRes.json());
      }));

      return NextResponse.json({
        success: true,
        data: messages
          .filter(Boolean)
          .sort((a, b) => new Date(a!.date || 0).getTime() - new Date(b!.date || 0).getTime()),
      });
    }

    if (action === 'draft') {
      if (containsIgnoredGmailContactEmail(String(to || ''))) {
        return NextResponse.json(
          { error: '系统已阻止创建发给 Mailsuite/Mailtrack 通知邮箱的草稿，请重新确认真实红人邮箱。' },
          { status: 400 },
        );
      }
      // 创建草稿
      const commonHeaders = [
        `To: ${sanitizeHeaderValue(String(to || ''))}`,
        `Subject: =?utf-8?B?${Buffer.from(subject).toString('base64')}?=`,
        ...(inReplyTo ? [`In-Reply-To: ${sanitizeHeaderValue(inReplyTo)}`] : []),
        ...(references ? [`References: ${sanitizeHeaderValue(references)}`] : []),
        'MIME-Version: 1.0',
      ];
      const htmlBody = typeof bodyHtml === 'string' ? bodyHtml.trim() : '';
      const validInlineImages = Array.isArray(inlineImages)
        ? (inlineImages as InlineImagePayload[]).map((image) => {
            const parsed = dataUrlToBase64(String(image.dataUrl || ''));
            if (!parsed) return null;
            return {
              contentId: sanitizeHeaderValue(String(image.contentId || 'inline-image')),
              fileName: sanitizeHeaderValue(String(image.fileName || 'inline-image.jpg')),
              mimeType: sanitizeHeaderValue(String(image.mimeType || parsed.mimeType || 'image/jpeg')),
              base64: parsed.base64,
            };
          }).filter(Boolean)
        : [];
      const alternativeBoundary = `alternative-${crypto.randomUUID()}`;
      const relatedBoundary = `related-${crypto.randomUUID()}`;
      const htmlPart = [
        `--${alternativeBoundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(encodeBase64(`<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;word-break:break-word">${htmlBody}</div>`)),
      ];
      const textPart = [
        `--${alternativeBoundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(encodeBase64(String(emailBody || htmlToText(htmlBody)))),
      ];
      const alternativePart = [
        `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`,
        '',
        ...textPart,
        ...htmlPart,
        `--${alternativeBoundary}--`,
      ];
      const rawEmail = htmlBody
        ? (
            validInlineImages.length
              ? [
                  ...commonHeaders,
                  `Content-Type: multipart/related; boundary="${relatedBoundary}"`,
                  '',
                  `--${relatedBoundary}`,
                  ...alternativePart,
                  ...validInlineImages.flatMap((image) => [
                    `--${relatedBoundary}`,
                    `Content-Type: ${image!.mimeType}; name="=?utf-8?B?${encodeBase64(image!.fileName)}?="`,
                    `Content-ID: <${image!.contentId}>`,
                    `Content-Disposition: inline; filename="=?utf-8?B?${encodeBase64(image!.fileName)}?="`,
                    'Content-Transfer-Encoding: base64',
                    '',
                    wrapBase64(image!.base64),
                  ]),
                  `--${relatedBoundary}--`,
                  '',
                ].join('\r\n')
              : [
                  ...commonHeaders,
                  ...alternativePart,
                  '',
                ].join('\r\n')
          )
        : [
            ...commonHeaders,
            'Content-Type: text/plain; charset=utf-8',
            '',
            emailBody,
          ].join('\r\n');

      const encodedEmail = Buffer.from(rawEmail)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      let lastStatus = 500;
      let lastError = '';
      for (let attempt = 0; attempt < 3; attempt += 1) {
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

        if (res.ok) {
          const data = await res.json();
          return NextResponse.json({ success: true, data });
        }

        lastStatus = res.status;
        lastError = await res.text();
        if (!shouldRetryGmailDraft(res.status, lastError) || attempt === 2) break;
        await sleep(600 * (attempt + 1));
      }

      return NextResponse.json(
        {
          error: `创建草稿失败：${summarizeGmailError(lastStatus, lastError)}`,
          details: lastError,
        },
        { status: lastStatus },
      );
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (err) {
    console.error('Gmail draft error:', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
