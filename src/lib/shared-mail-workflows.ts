import { sharedMailFetch, mailReads, currentGmailReadScope, currentGmailReadAccountId, mailReadContext } from './shared-mail-read';
import { parseSharedGmailMessage, classifySharedGmailFollowUp } from './gmail-history-message';
import { containsIgnoredGmailContactEmail } from './gmail-thread-contact';
import { resolveLatestGmailAnswerAt } from './daily-gmail-todos';
import type { MailProvider } from './mail-accounts';
import type { FollowUpCheck, FollowUpMessage } from './follow-up-draft-workflow';

type Raw = Record<string, unknown>;
export class SharedMailReadError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function read(url: string, priority = 1, force = false, context = mailReadContext(), reuseMetadata = false) {
  if (context !== mailReadContext()) throw new Error('邮箱状态已变化，请重新读取。');
  const target = url.startsWith('/api/gmail?') ? `${url}&mailAccountId=${encodeURIComponent(currentGmailReadAccountId())}` : url;
  const response = await sharedMailFetch(target, {}, { priority, force, reuseMetadata });
  const result = await response.json();
  if (context !== mailReadContext()) throw new Error('邮箱状态已变化，请重新读取。');
  if (!response.ok || !result.success) throw new SharedMailReadError([result.error, result.details].filter(Boolean).join(' ') || '邮件读取失败，请重试。', response.status);
  return result;
}
async function gmailThread(id: string, priority: number, context: string, forceCheck = false) {
  const url = `/api/gmail?action=thread&threadId=${encodeURIComponent(id)}`;
  // Metadata is always fresh; a changed historyId invalidates the shared full body.
  if (mailReads.peek(currentGmailReadScope(), `gmail:threads/${id}:full`, 15 * 60_000)) {
    await read(`${url}&format=metadata`, priority, forceCheck, context, !forceCheck);
  }
  return (await read(url, priority, false, context)).data as Raw;
}
async function gmailReferences(kind: 'daily' | 'followUp', extra: Record<string, string>, context: string) {
  const references = new Map<string, { id: string; threadId?: string }>();
  let pageToken = '';
  const seen = new Set<string>();
  do {
    const params = new URLSearchParams({ action: 'readReferences', kind, ...extra, ...(pageToken ? { pageToken } : {}) });
    const result = await read(`/api/gmail?${params}`, 2, true, context);
    for (const item of result.data.references) references.set(item.id, item);
    pageToken = result.data.nextPageToken || '';
    if (pageToken && (seen.has(pageToken) || references.size >= 500)) throw new Error('邮件查询尚未完整（超过本轮安全上限），本轮保留旧结果，请缩小检查范围。');
    seen.add(pageToken);
  } while (pageToken);
  return [...references.values()];
}

export async function readSharedGmailDaily(force = false) {
  const context = mailReadContext();
  const references = await gmailReferences('daily', {}, context);
  const messages = await Promise.all(references.map(async ({ id }) => {
    const raw = await gmailThread(id, 2, context, force);
    const all = ((raw.messages || []) as Raw[]).map(parseSharedGmailMessage);
    const latest = all.filter((m) => !m.labelIds.includes('SENT') && !m.automated && !m.deliveryFailure
      && !containsIgnoredGmailContactEmail(m.from)).sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
    return latest ? { ...latest, messageId: latest.id, answeredAt: resolveLatestGmailAnswerAt(all, latest.date) } : null;
  }));
  return messages.filter((m): m is NonNullable<typeof m> => m !== null);
}

export async function readSharedTencentBody(accountId: string, message: {
  folderRef?: string; providerMessageRef?: string; rfcMessageId?: string; mailboxVersion?: string;
}) {
  if (!message.folderRef || !message.providerMessageRef) throw new Error('缺少邮件定位信息，无法读取完整正文。');
  const params = new URLSearchParams({ action: 'messageBody', mailAccountId: accountId,
    folder: message.folderRef, uid: message.providerMessageRef, rfcMessageId: message.rfcMessageId || '', mailboxVersion: message.mailboxVersion || '' });
  return String((await read(`/api/mail/tencent?${params}`, 2)).data.body || '');
}

export async function readSharedFollowUp(record: {
  provider: MailProvider; mailAccountId: string; email: string; developmentDate: number;
}): Promise<FollowUpCheck> {
  const context = mailReadContext();
  if (record.provider === 'gmail') {
    if (record.mailAccountId !== currentGmailReadAccountId()) throw new Error('该红人绑定的 Gmail 与当前邮箱不同，请先连接正确邮箱。');
    const refs = await gmailReferences('followUp', { email: record.email, sentAt: String(record.developmentDate) }, context);
    const ids = new Set(refs.map((r) => r.id));
    const threads = [...new Set(refs.map((r) => r.threadId).filter((id): id is string => Boolean(id)))];
    if (refs.some((r) => !r.threadId)) throw new Error('往来邮件缺少会话编号，本次不能确认跟进状态。');
    const raw = await Promise.all(threads.map((id) => gmailThread(id, 2, context, true)));
    const messages = raw.flatMap((t) => (t.messages || []) as Raw[]).filter((m) => ids.has(String(m.id))).map(parseSharedGmailMessage);
    if (new Set(messages.map((m) => m.id)).size !== ids.size) throw new Error('部分往来邮件未完整读取，本次不能确认跟进状态。');
    return classifySharedGmailFollowUp(messages, record.email.trim().toLowerCase(), record.developmentDate);
  }
  const params = new URLSearchParams({ action: 'followUp', metadataOnly: '1', mailAccountId: record.mailAccountId,
    email: record.email, sentAt: String(record.developmentDate) });
  const check = (await read(`/api/mail/tencent?${params}`, 2, true, context)).data as FollowUpCheck;
  const hydrate = async (m: FollowUpMessage | null) => {
    if (context !== mailReadContext()) throw new Error('邮箱状态已变化，请重新检查跟进。');
    return m ? { ...m, body: await readSharedTencentBody(record.mailAccountId, m) } : null;
  };
  const outbound = await Promise.all(check.outbound.map(hydrate));
  return { outbound: outbound.filter((m): m is FollowUpMessage => m !== null), reply: await hydrate(check.reply),
    automatedReply: await hydrate(check.automatedReply), deliveryFailure: await hydrate(check.deliveryFailure) };
}
