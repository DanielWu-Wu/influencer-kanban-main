import { NextRequest, NextResponse } from 'next/server';
import { requireOwnedMailAccount } from '@/lib/mail-account-server';
import { getRequestUser } from '@/lib/supabase/server';
import { resolveTencentExmailCredentials } from '@/lib/tencent-exmail-credentials';
import { testTencentExmailSmtp } from '@/lib/tencent-exmail-client';
import { upsertStoredMailAccount } from '@/lib/mail-account-storage';
import { parseMailAttachmentRefs } from '@/lib/mail-attachment-storage';
import {
  cleanupExpiredMailAttachments,
  deleteOwnedMailAttachments,
  downloadOwnedMailAttachments,
  publishIncomingMailAttachment,
} from '@/lib/mail-attachment-storage-server';
import {
  getTencentThread,
  invalidateTencentThreadCache,
  findTencentMessageByRfcMessageId,
  getTencentAttachment,
  checkTencentFollowUp,
  listTencentDailyTodoMessages,
  listTencentContactHistory,
  listTencentFolders,
  listTencentThreads,
  saveTencentDraft,
  sendTencentMessage,
  updateTencentMessageFlags,
  type TencentMailboxView,
} from '@/lib/tencent-exmail-messages';

export const runtime = 'nodejs';
export const maxDuration = 45;

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function resolveRequestContext(request: NextRequest, mailAccountId: string) {
  const appAuth = await getRequestUser(request);
  if (!appAuth) throw new Error('未登录。');
  const account = await requireOwnedMailAccount(appAuth.supabase, mailAccountId, 'tencent_exmail');
  const login = await resolveTencentExmailCredentials(appAuth.supabase, account.mailAccountId);
  return { appAuth, account, login };
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : '腾讯企业邮箱操作失败。';
  const status = message === '未登录。'
    ? 401
    : message.includes('不存在') || message.includes('不属于')
      ? 404
      : message.includes('格式') || message.includes('缺少')
        ? 400
        : 502;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  const searchParams = new URL(request.url).searchParams;
  const action = searchParams.get('action') || 'threads';
  const mailAccountId = searchParams.get('mailAccountId') || '';
  try {
    const { appAuth, account, login } = await resolveRequestContext(request, mailAccountId);
    if (action === 'folders') {
      return NextResponse.json({ success: true, data: await listTencentFolders(login) });
    }
    if (action === 'thread') {
      const folder = searchParams.get('folder') || '';
      const uid = positiveInteger(searchParams.get('uid'), 0);
      const rfcMessageId = searchParams.get('rfcMessageId') || '';
      const forceRefresh = searchParams.get('forceRefresh') === '1';
      if (!folder || !uid) return NextResponse.json({ error: '缺少邮件文件夹或邮件编号。' }, { status: 400 });
      let located = { folderRef: folder, providerMessageRef: String(uid) };
      let thread;
      try {
        thread = await getTencentThread({
          login,
          account,
          folder,
          uid,
          cacheScope: appAuth.user.id,
          forceRefresh,
        });
      } catch (originalError) {
        const relocated = rfcMessageId
          ? await findTencentMessageByRfcMessageId({ login, account, rfcMessageId })
          : null;
        if (!relocated || (relocated.folderRef === folder && relocated.providerMessageRef === String(uid))) {
          throw originalError;
        }
        located = relocated;
        thread = await getTencentThread({
          login,
          account,
          folder: located.folderRef,
          uid: positiveInteger(located.providerMessageRef, 0),
          cacheScope: appAuth.user.id,
          forceRefresh,
        });
      }
      return NextResponse.json({
        success: true,
        data: thread,
        located,
      });
    }
    if (action === 'projectConversation') {
      const rfcMessageId = searchParams.get('rfcMessageId') || '';
      const originalFolder = searchParams.get('folder') || '';
      const originalUid = positiveInteger(searchParams.get('uid'), 0);
      const relocated = rfcMessageId
        ? await findTencentMessageByRfcMessageId({ login, account, rfcMessageId })
        : null;
      const located = relocated || (originalFolder && originalUid
        ? { folderRef: originalFolder, providerMessageRef: String(originalUid) }
        : null);
      if (!located) {
        return NextResponse.json({ error: '项目绑定的腾讯邮件会话已失效。' }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        data: await getTencentThread({
          login,
          account,
          folder: located.folderRef,
          uid: positiveInteger(located.providerMessageRef, 0),
          cacheScope: appAuth.user.id,
        }),
      });
    }
    if (action === 'attachment') {
      const folder = searchParams.get('folder') || '';
      const uid = positiveInteger(searchParams.get('uid'), 0);
      const attachmentId = searchParams.get('attachmentId') || '';
      if (!folder || !uid || !attachmentId) {
        return NextResponse.json({ error: '缺少附件定位信息。' }, { status: 400 });
      }
      await cleanupExpiredMailAttachments(appAuth.supabase, appAuth.user.id);
      const attachment = await getTencentAttachment({ login, folder, uid, attachmentId });
      const published = await publishIncomingMailAttachment({
        supabase: appAuth.supabase,
        userId: appAuth.user.id,
        ...attachment,
      });
      return NextResponse.json({ success: true, data: published });
    }
    if (action === 'followUp') {
      const contactEmail = searchParams.get('email')?.trim().toLowerCase() || '';
      const sentAt = Number(searchParams.get('sentAt') || 0);
      if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return NextResponse.json({ error: '请提供有效的红人邮箱。' }, { status: 400 });
      }
      if (!Number.isFinite(sentAt) || sentAt <= 0) {
        return NextResponse.json({ error: '缺少初次开发信发送日期。' }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        data: await checkTencentFollowUp({ login, account, contactEmail, sentAt }),
      });
    }
    if (action === 'dailyTodos') {
      const hours = Math.min(168, Math.max(1, positiveInteger(searchParams.get('hours'), 72)));
      return NextResponse.json({
        success: true,
        data: await listTencentDailyTodoMessages({
          login,
          account,
          since: new Date(Date.now() - hours * 60 * 60 * 1000),
          maxResults: positiveInteger(searchParams.get('maxResults'), 50),
        }),
      });
    }
    if (action === 'contactHistory') {
      const contactEmail = searchParams.get('email')?.trim().toLowerCase() || '';
      if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
        return NextResponse.json({ error: '请提供有效的联系人邮箱。' }, { status: 400 });
      }
      return NextResponse.json({
        success: true,
        data: await listTencentContactHistory({
          login,
          account,
          contactEmail,
          maxResults: positiveInteger(searchParams.get('maxResults'), 10),
        }),
      });
    }
    const view = String(searchParams.get('view') || 'inbox') as TencentMailboxView;
    if (!['inbox', 'unread', 'starred', 'sent', 'drafts'].includes(view)) {
      return NextResponse.json({ error: '不支持的邮箱视图。' }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      data: await listTencentThreads({
        login,
        account,
        view,
        query: searchParams.get('q') || '',
        page: Math.max(0, Number(searchParams.get('page') || 0) || 0),
        maxResults: positiveInteger(searchParams.get('maxResults'), 50),
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || '');
  const mailAccountId = String(body.mailAccountId || '');
  try {
    const { appAuth, account, login } = await resolveRequestContext(request, mailAccountId);
    if (action === 'verifySmtp') {
      await testTencentExmailSmtp(login);
      const testedAt = new Date().toISOString();
      const updatedAccount = {
        ...account,
        capabilities: { ...account.capabilities, send: true },
        lastTestedAt: testedAt,
        lastError: undefined,
        updatedAt: testedAt,
      };
      await upsertStoredMailAccount(appAuth.supabase, appAuth.user.id, updatedAccount);
      return NextResponse.json({ success: true, data: { account: updatedAccount } });
    }
    if (action === 'flags') {
      const folder = String(body.folder || '');
      const uid = positiveInteger(body.uid, 0);
      if (!folder || !uid) return NextResponse.json({ error: '缺少邮件文件夹或邮件编号。' }, { status: 400 });
      const data = await updateTencentMessageFlags({
        login,
        folder,
        uid,
        read: typeof body.read === 'boolean' ? body.read : undefined,
        starred: typeof body.starred === 'boolean' ? body.starred : undefined,
      });
      invalidateTencentThreadCache(appAuth.user.id, account.mailAccountId);
      return NextResponse.json({
        success: true,
        data,
      });
    }
    if (action === 'draft') {
      const to = String(body.to || '').trim();
      const subject = String(body.subject || '').trim();
      const html = String(body.html || '').trim();
      if (!to || !subject || !html) {
        return NextResponse.json({ error: '收件人、主题和邮件正文不能为空。' }, { status: 400 });
      }
      const attachmentRefs = parseMailAttachmentRefs(body.attachments);
      await cleanupExpiredMailAttachments(appAuth.supabase, appAuth.user.id);
      const attachments = await downloadOwnedMailAttachments(
        appAuth.supabase,
        appAuth.user.id,
        attachmentRefs,
      );
      const previousDraft = body.previousDraft && typeof body.previousDraft === 'object'
        ? body.previousDraft as Record<string, unknown>
        : null;
      const data = await saveTencentDraft({
          login,
          account,
          to,
          cc: String(body.cc || '').trim() || undefined,
          bcc: String(body.bcc || '').trim() || undefined,
          subject,
          html,
          text: String(body.text || '').trim() || undefined,
          inReplyTo: String(body.inReplyTo || '').trim() || undefined,
          references: String(body.references || '').trim() || undefined,
          inlineImages: Array.isArray(body.inlineImages)
            ? body.inlineImages.flatMap((item) => {
                if (!item || typeof item !== 'object') return [];
                const image = item as Record<string, unknown>;
                const filename = String(image.filename || '').trim();
                const mimeType = String(image.mimeType || '').trim();
                const contentId = String(image.contentId || '').trim();
                const data = String(image.data || '').trim();
                if (!filename || !mimeType.startsWith('image/') || !contentId || !data || data.length > 14_000_000) return [];
                return [{ filename, mimeType, contentId, data }];
              })
            : undefined,
          attachments,
          previousDraft: previousDraft
            ? {
                folderRef: String(previousDraft.folderRef || ''),
                uid: positiveInteger(previousDraft.providerMessageRef, 0),
              }
            : undefined,
        });
      invalidateTencentThreadCache(appAuth.user.id, account.mailAccountId);
      await deleteOwnedMailAttachments(appAuth.supabase, appAuth.user.id, attachmentRefs);
      return NextResponse.json({ success: true, data });
    }
    if (action === 'send') {
      const to = String(body.to || '').trim();
      const subject = String(body.subject || '').trim();
      const html = String(body.html || '').trim();
      if (!to || !subject || !html) {
        return NextResponse.json({ error: '收件人、主题和邮件正文不能为空。' }, { status: 400 });
      }
      if (!account.capabilities.send) {
        await testTencentExmailSmtp(login);
        const testedAt = new Date().toISOString();
        await upsertStoredMailAccount(appAuth.supabase, appAuth.user.id, {
          ...account,
          capabilities: { ...account.capabilities, send: true },
          lastTestedAt: testedAt,
          lastError: undefined,
          updatedAt: testedAt,
        });
      }
      const attachmentRefs = parseMailAttachmentRefs(body.attachments);
      await cleanupExpiredMailAttachments(appAuth.supabase, appAuth.user.id);
      const attachments = await downloadOwnedMailAttachments(
        appAuth.supabase,
        appAuth.user.id,
        attachmentRefs,
      );
      const data = await sendTencentMessage({
        login,
        account,
        to,
        cc: String(body.cc || '').trim() || undefined,
        bcc: String(body.bcc || '').trim() || undefined,
        subject,
        html,
        text: String(body.text || '').trim() || undefined,
        inReplyTo: String(body.inReplyTo || '').trim() || undefined,
        references: String(body.references || '').trim() || undefined,
        messageId: String(body.messageId || '').trim() || undefined,
        attachments,
      });
      invalidateTencentThreadCache(appAuth.user.id, account.mailAccountId);
      await deleteOwnedMailAttachments(appAuth.supabase, appAuth.user.id, attachmentRefs);
      return NextResponse.json({ success: true, data });
    }
    return NextResponse.json({ error: '不支持的腾讯邮箱操作。' }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
