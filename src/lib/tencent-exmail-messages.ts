import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import { simpleParser, type AddressObject } from 'mailparser';
import type {
  FetchMessageObject,
  ListResponse,
  SearchObject,
} from 'imapflow';
import type { GmailAttachment, GmailMessage, GmailThread } from './types';
import { hasAutomaticMailHeaders } from './inbox-new-mail';
import type { MailAccount, MailFolderMapping } from './mail-accounts';
import {
  sendTencentExmailRaw,
  withTencentExmailClient,
  type TencentExmailLogin,
} from './tencent-exmail-client';
import { classifyFollowUpConversation } from './outreach-follow-up';
import type { FollowUpCheck, FollowUpMessage } from './follow-up-draft-workflow';
import { containsIgnoredGmailContactEmail } from './gmail-thread-contact';
import { resolveLatestMatchingMailboxAnswerAt } from './daily-gmail-todos';
import {
  extractRfcMessageIds,
  groupStrictMailConversations,
} from './mail-conversation';
import { ExpiringRequestCache } from './expiring-request-cache';
import {
  mailTimestampToIso,
  resolveImapMessageTimestamp,
} from './mail-message-time';
import { resolveMailTranslationBody } from './mail-translation-body';
import { selectTencentTranslationBodyPart } from './tencent-translation-body';

const MAX_LIST_RESULTS = 50;
const MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
const MAX_INLINE_ATTACHMENT_PREVIEW_BYTES = 256 * 1024;
const TENCENT_THREAD_CACHE_TTL_MS = 60_000;

export type TencentOutgoingAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
  contentId?: string;
  inline?: boolean;
};

export type TencentMailboxView = 'inbox' | 'unread' | 'starred' | 'sent' | 'drafts';

function addressText(value?: AddressObject | AddressObject[]) {
  if (!value) return '';
  const list = Array.isArray(value) ? value : [value];
  const formatted = list.flatMap((item) => item.value || []).map((item) => (
    item.name ? `${item.name} <${item.address || ''}>` : item.address || ''
  )).filter(Boolean).join(', ');
  if (!formatted.includes('\uFFFD')) return formatted;
  const readableAddresses = list
    .flatMap((item) => item.value || [])
    .map((item) => String(item.address || '').trim())
    .filter(Boolean);
  return readableAddresses.join(', ') || '未知联系人';
}

function envelopeAddressText(value?: Array<{ name?: string; address?: string }>) {
  return (value || []).map((item) => (
    item.name ? `${item.name} <${item.address || ''}>` : item.address || ''
  )).filter(Boolean).join(', ');
}

function isAutomatedConversationCandidate(message: GmailMessage) {
  return containsIgnoredGmailContactEmail(`${message.from}, ${message.to}, ${message.cc || ''}`)
    || /(?:automatic reply|out of office|vacation|auto.?reply|自动回复|邮件投递|delivery status notification)/i.test(
      `${message.subject} ${message.from}`,
    );
}

function buildThreadRef(account: MailAccount, folder: string, uid: number, messageId?: string) {
  const stable = messageId || `${folder}:${uid}`;
  const digest = createHash('sha256').update(stable).digest('base64url').slice(0, 24);
  return `${account.mailAccountId}:${digest}`;
}

function folderBySpecialUse(folders: ListResponse[], specialUse: string) {
  return folders.find((folder) => folder.specialUse?.toLowerCase() === specialUse.toLowerCase())?.path;
}

function folderByNames(folders: ListResponse[], names: string[]) {
  const normalizedNames = names.map((name) => name.toLowerCase());
  return folders.find((folder) => normalizedNames.includes(folder.name.toLowerCase()))?.path;
}

export function identifyTencentFolders(
  folders: ListResponse[],
  saved: MailFolderMapping = {},
): Required<Pick<MailFolderMapping, 'inbox'>> & MailFolderMapping {
  return {
    inbox: saved.inbox || folders.find((folder) => folder.path.toUpperCase() === 'INBOX')?.path || 'INBOX',
    sent: saved.sent || folderBySpecialUse(folders, '\\Sent') || folderByNames(folders, ['sent', 'sent messages', 'sent mail', '已发送', '发件箱']),
    drafts: saved.drafts || folderBySpecialUse(folders, '\\Drafts') || folderByNames(folders, ['drafts', 'draft', '草稿箱']),
    trash: saved.trash || folderBySpecialUse(folders, '\\Trash') || folderByNames(folders, ['trash', 'deleted messages', '已删除', '垃圾箱']),
    spam: saved.spam || folderBySpecialUse(folders, '\\Junk') || folderByNames(folders, ['junk', 'spam', '垃圾邮件']),
  };
}

function resolveViewFolder(view: TencentMailboxView, mapping: MailFolderMapping) {
  if (view === 'sent') return mapping.sent;
  if (view === 'drafts') return mapping.drafts;
  return mapping.inbox;
}

function buildSearch(view: TencentMailboxView, query: string): SearchObject {
  const normalizedQuery = query.trim();
  // 腾讯企业邮箱对 IMAP TEXT 的兼容性不一致，拆成常见字段的 OR 条件后，
  // 发件人、收件人、主题和正文都能被大多数企业邮箱服务器正确处理。
  const search: SearchObject = normalizedQuery
    ? { or: [{ from: normalizedQuery }, { to: normalizedQuery }, { subject: normalizedQuery }, { body: normalizedQuery }] }
    : { all: true };
  if (view === 'unread') search.seen = false;
  if (view === 'starred') search.flagged = true;
  return search;
}

export async function listTencentFolders(login: TencentExmailLogin) {
  return withTencentExmailClient(login, async (client) => {
    const folders = await client.list({ statusQuery: { messages: true, unseen: true } });
    return folders.map((folder) => ({
      path: folder.path,
      name: folder.name,
      specialUse: folder.specialUse,
      subscribed: folder.subscribed,
      messages: folder.status?.messages || 0,
      unseen: folder.status?.unseen || 0,
    }));
  });
}

export async function findTencentMessageByRfcMessageId(options: {
  login: TencentExmailLogin;
  account: MailAccount;
  rfcMessageId: string;
}) {
  const messageId = extractRfcMessageIds(options.rfcMessageId)[0];
  if (!messageId) return null;
  return withTencentExmailClient(options.login, async (client) => {
    const folders = await client.list();
    const mapping = identifyTencentFolders(folders, options.account.folderMapping);
    const excludedFolders = new Set([mapping.trash, mapping.spam].filter(Boolean));
    const preferredFolders = [mapping.inbox, mapping.sent]
      .filter(Boolean) as string[];
    const targetFolders = Array.from(new Set([
      ...preferredFolders,
      ...folders.map((folder) => folder.path),
    ])).filter((folder) => !excludedFolders.has(folder));
    for (const folder of targetFolders) {
      await client.mailboxOpen(folder, { readOnly: true });
      const matches = await client.search({ header: { 'message-id': `<${messageId}>` } }, { uid: true });
      const uid = matches ? matches.at(-1) : undefined;
      if (uid) return { folderRef: folder, providerMessageRef: String(uid) };
    }
    return null;
  });
}

export async function listTencentThreads(options: {
  login: TencentExmailLogin;
  account: MailAccount;
  view: TencentMailboxView;
  query?: string;
  page?: number;
  maxResults?: number;
}) {
  return withTencentExmailClient(options.login, async (client) => {
    const folders = await client.list();
    const mapping = identifyTencentFolders(folders, options.account.folderMapping);
    const maxResults = Math.min(MAX_LIST_RESULTS, Math.max(1, options.maxResults || MAX_LIST_RESULTS));
    const page = Math.max(0, options.page || 0);
    const query = (options.query || '').trim();
    const globalSearch = Boolean(query);
    const viewFolder = resolveViewFolder(options.view, mapping);
    if (!viewFolder) throw new Error('未识别到对应邮件文件夹，请在邮箱设置中手动指定。');
    const targetFolders = globalSearch
      ? Array.from(new Set([mapping.inbox, mapping.sent, mapping.drafts].filter(Boolean))) as string[]
      : [viewFolder];
    const messages = [] as GmailThread[];
    let total = 0;
    let hasNextPage = false;

    for (const folder of targetFolders) {
      await client.mailboxOpen(folder, { readOnly: true });
      const matches = await client.search(
        buildSearch(globalSearch ? 'inbox' : options.view, query),
        { uid: true },
      );
      const allUids = matches || [];
      total += allUids.length;
      let pageUids: number[];
      if (globalSearch) {
        const fetchLimit = Math.min(1000, (page + 2) * maxResults);
        pageUids = allUids.slice(-fetchLimit).reverse();
      } else {
        const end = Math.max(0, allUids.length - page * maxResults);
        const start = Math.max(0, end - maxResults);
        pageUids = allUids.slice(start, end).reverse();
        hasNextPage = start > 0;
      }
      if (!pageUids.length) continue;

      for await (const item of client.fetch(pageUids, {
          uid: true,
          flags: true,
          envelope: true,
          internalDate: true,
          size: true,
          source: { maxLength: 256 * 1024 },
        }, { uid: true })) {
          let parsed: Awaited<ReturnType<typeof simpleParser>> | null = null;
          if (item.source) {
            try {
              parsed = await simpleParser(item.source);
            } catch {
              parsed = null;
            }
          }
          const subject = parsed?.subject || item.envelope?.subject || '(无主题)';
          const date = mailTimestampToIso(resolveImapMessageTimestamp({
            internalDate: item.internalDate,
            parsedDate: parsed?.date,
            envelopeDate: item.envelope?.date,
          }));
          const from = addressText(parsed?.from) || envelopeAddressText(item.envelope?.from);
          const to = addressText(parsed?.to) || envelopeAddressText(item.envelope?.to);
          const messageId = parsed?.messageId || item.envelope?.messageId || `${options.account.mailAccountId}:${folder}:${item.uid}`;
          const threadId = buildThreadRef(options.account, folder, item.uid, messageId);
          const body = parsed?.text || '';
          const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 240);
          const labels = folder === mapping.sent
            ? ['SENT']
            : folder === mapping.drafts
              ? ['DRAFT']
              : ['INBOX'];
          const message: GmailMessage = {
            id: `${options.account.mailAccountId}:${folder}:${item.uid}`,
            threadId,
            from,
            to,
            cc: addressText(parsed?.cc) || envelopeAddressText(item.envelope?.cc),
            bcc: addressText(parsed?.bcc) || envelopeAddressText(item.envelope?.bcc),
            replyTo: addressText(parsed?.replyTo) || envelopeAddressText(item.envelope?.replyTo),
            subject,
            snippet,
            body,
            date,
            isRead: Boolean(item.flags?.has('\\Seen')),
            labels,
            hasAttachments: Boolean(parsed?.attachments.length),
            rfcMessageId: messageId,
            inReplyTo: parsed?.inReplyTo,
            references: Array.isArray(parsed?.references) ? parsed.references.join(' ') : parsed?.references,
            provider: 'tencent_exmail',
            mailAccountId: options.account.mailAccountId,
            providerMessageRef: String(item.uid),
            folderRef: folder,
          };
          messages.push({
            id: threadId,
            subject,
            snippet,
            messages: [message],
            participantCount: new Set([from, to].filter(Boolean)).size,
            lastMessageDate: message.date,
            hasUnread: !message.isRead,
            labels,
            isStarred: Boolean(item.flags?.has('\\Flagged')),
            provider: 'tencent_exmail',
            mailAccountId: options.account.mailAccountId,
            folderRef: folder,
          });
        }
      }
    const threadByMessageId = new Map(messages.map((thread) => [thread.messages[0].id, thread]));
    const groupedThreads = groupStrictMailConversations(messages.map((thread) => {
      const message = thread.messages[0];
      return {
        ...message,
        automated: isAutomatedConversationCandidate(message),
        deliveryFailure: /(?:mailer-daemon|postmaster|undeliverable|delivery failed|退信|投递失败|无法送达)/i.test(
          `${message.subject} ${message.from}`,
        ),
      };
    })).map((group) => {
      const latest = group.messages.at(-1)!;
      const folderRef = latest.folderRef || viewFolder;
      const threadId = buildThreadRef(
        options.account,
        folderRef,
        Number(latest.providerMessageRef || 0),
        group.identity,
      );
      const threadMessages = group.messages.map((message) => ({ ...message, threadId }));
      return {
        id: threadId,
        subject: latest.subject,
        snippet: latest.snippet,
        messages: threadMessages,
        participantCount: new Set(threadMessages.flatMap((message) => [message.from, message.to, message.cc]).filter(Boolean)).size,
        lastMessageDate: latest.date,
        hasUnread: threadMessages.some((message) => !message.isRead),
        labels: Array.from(new Set(threadMessages.flatMap((message) => message.labels))),
        isStarred: group.messages.some((message) => threadByMessageId.get(message.id)?.isStarred),
        provider: 'tencent_exmail' as const,
        mailAccountId: options.account.mailAccountId,
        folderRef,
      } satisfies GmailThread;
    });
    const threads = globalSearch
      ? groupedThreads.slice(page * maxResults, (page + 1) * maxResults)
      : groupedThreads;
    if (globalSearch) {
      hasNextPage = total > (page + 1) * maxResults && (page + 1) * maxResults < 1000;
    }
    return {
      threads,
      page,
      hasNextPage,
      total,
      folderMapping: mapping,
      groupedBy: 'thread' as const,
    };
  });
}

async function loadTencentThread(options: {
  login: TencentExmailLogin;
  account: MailAccount;
  folder: string;
  uid: number;
}): Promise<GmailThread> {
  return withTencentExmailClient(options.login, async (client) => {
    const folders = await client.list();
    const mapping = identifyTencentFolders(folders, options.account.folderMapping);
    const warnings = new Set<string>();
    const labelsForFolder = (folder: string) => {
      if (folder === mapping.sent) return ['SENT'];
      if (folder === mapping.drafts) return ['DRAFT'];
      if (folder === mapping.inbox) return ['INBOX'];
      return [];
    };
    const parseFullMessage = async (folder: string, item: FetchMessageObject) => {
      if (!item.source) return null;
      const uid = item.uid;
      try {
        const parsed = await simpleParser(item.source, { skipHtmlToText: true });
        const messageId = parsed.messageId || `${options.account.mailAccountId}:${folder}:${uid}`;
        const htmlBody = typeof parsed.html === 'string' ? parsed.html : parsed.textAsHtml;
        const body = resolveMailTranslationBody(parsed.text || '', htmlBody || '');
        const attachments: GmailAttachment[] = parsed.attachments.map((attachment, index) => ({
          id: `${uid}:${index}`,
          filename: attachment.filename || `附件-${index + 1}`,
          mimeType: attachment.contentType || 'application/octet-stream',
          size: attachment.size || attachment.content.length,
          dataUrl: attachment.content.length <= MAX_INLINE_ATTACHMENT_PREVIEW_BYTES
            ? `data:${attachment.contentType || 'application/octet-stream'};base64,${attachment.content.toString('base64')}`
            : undefined,
          contentId: attachment.contentId,
          inline: attachment.contentDisposition === 'inline' || Boolean(attachment.contentId),
        }));
        return {
          parsed,
          starred: Boolean(item.flags?.has('\\Flagged')),
          message: {
            id: `${options.account.mailAccountId}:${folder}:${uid}`,
            threadId: '',
            from: addressText(parsed.from),
            to: addressText(parsed.to),
            cc: addressText(parsed.cc),
            bcc: addressText(parsed.bcc),
            replyTo: addressText(parsed.replyTo),
            subject: parsed.subject || '(无主题)',
            snippet: body.replace(/\s+/g, ' ').trim().slice(0, 240),
            body,
            htmlBody,
            attachments,
            automated: hasAutomaticMailHeaders(headerText(parsed, 'auto-submitted'), headerText(parsed, 'precedence')),
            date: mailTimestampToIso(resolveImapMessageTimestamp({
              internalDate: item.internalDate,
              parsedDate: parsed.date,
            })),
            isRead: Boolean(item.flags?.has('\\Seen')),
            labels: labelsForFolder(folder),
            hasAttachments: attachments.length > 0,
            rfcMessageId: messageId,
            inReplyTo: parsed.inReplyTo,
            references: Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references,
            provider: 'tencent_exmail' as const,
            mailAccountId: options.account.mailAccountId,
            providerMessageRef: String(uid),
            folderRef: folder,
          } satisfies GmailMessage,
        };
      } catch {
        warnings.add('部分历史邮件正文解析失败，当前已显示可正常读取的邮件。');
        return null;
      }
    };
    const readFullMessages = async (folder: string, uids: number[]) => {
      if (!uids.length) return [];
      await client.mailboxOpen(folder, { readOnly: true });
      const messages: NonNullable<Awaited<ReturnType<typeof parseFullMessage>>>[] = [];
      for await (const item of client.fetch(uids, {
          uid: true,
          flags: true,
          source: { maxLength: MAX_MESSAGE_BYTES },
          internalDate: true,
        }, { uid: true })) {
        const parsed = await parseFullMessage(folder, item);
        if (parsed) messages.push(parsed);
      }
      return messages;
    };

    const selected = (await readFullMessages(options.folder, [options.uid]))[0];
    if (!selected) throw new Error('邮件不存在或已被移动。');
    const metadataPool: GmailMessage[] = [selected.message];
    const targetFolders = Array.from(new Set([mapping.inbox, mapping.sent, mapping.drafts].filter(Boolean))) as string[];
    const loadedKeys = new Set([selected.message.id]);
    const searchedHeaderIds = new Set<string>();
    for (let round = 0; round < 3; round += 1) {
      const nextHeaderIds = metadataPool
        .flatMap((message) => [
          ...extractRfcMessageIds(message.rfcMessageId),
          ...extractRfcMessageIds(message.inReplyTo),
          ...extractRfcMessageIds(message.references),
        ])
        .filter((id) => !searchedHeaderIds.has(id))
        .slice(0, 25);
      if (!nextHeaderIds.length) break;
      nextHeaderIds.forEach((id) => searchedHeaderIds.add(id));
      for (const folder of targetFolders) {
        await client.mailboxOpen(folder, { readOnly: true });
        const headerQueries: SearchObject[] = nextHeaderIds.flatMap((id): SearchObject[] => {
          const headerId = `<${id}>`;
          return [
            { header: { 'message-id': headerId } },
            { header: { 'in-reply-to': headerId } },
            { header: { references: headerId } },
          ];
        });
        let matches: number[] = [];
        try {
          matches = await client.search({ or: headerQueries }, { uid: true }) || [];
        } catch {
          warnings.add('部分历史邮件关系暂时读取失败，当前邮件仍可正常查看。');
          continue;
        }
        const candidateUids = matches.slice(-100).filter((uid) => (
          !loadedKeys.has(`${options.account.mailAccountId}:${folder}:${uid}`)
        ));
        if (!candidateUids.length) continue;
        try {
          for await (const item of client.fetch(candidateUids, {
              uid: true,
              flags: true,
              envelope: true,
              headers: [
                'message-id',
                'in-reply-to',
                'references',
                'from',
                'to',
                'cc',
                'bcc',
                'reply-to',
                'subject',
                'date',
                'auto-submitted',
                'precedence',
              ],
              internalDate: true,
            }, { uid: true })) {
            const key = `${options.account.mailAccountId}:${folder}:${item.uid}`;
            if (loadedKeys.has(key)) continue;
            try {
              const parsed = item.headers ? await simpleParser(item.headers) : null;
              const messageId = parsed?.messageId || item.envelope?.messageId
                || `${options.account.mailAccountId}:${folder}:${item.uid}`;
              const message: GmailMessage = {
                id: key,
                threadId: '',
                from: addressText(parsed?.from) || envelopeAddressText(item.envelope?.from),
                to: addressText(parsed?.to) || envelopeAddressText(item.envelope?.to),
                cc: addressText(parsed?.cc) || envelopeAddressText(item.envelope?.cc),
                bcc: addressText(parsed?.bcc) || envelopeAddressText(item.envelope?.bcc),
                replyTo: addressText(parsed?.replyTo) || envelopeAddressText(item.envelope?.replyTo),
                subject: parsed?.subject || item.envelope?.subject || '(无主题)',
                snippet: '',
                body: '',
                date: mailTimestampToIso(resolveImapMessageTimestamp({
                  internalDate: item.internalDate,
                  parsedDate: parsed?.date,
                  envelopeDate: item.envelope?.date,
                })),
                isRead: Boolean(item.flags?.has('\\Seen')),
                labels: labelsForFolder(folder),
                hasAttachments: false,
                rfcMessageId: messageId,
                inReplyTo: parsed?.inReplyTo || item.envelope?.inReplyTo,
                references: Array.isArray(parsed?.references) ? parsed.references.join(' ') : parsed?.references,
                provider: 'tencent_exmail',
                mailAccountId: options.account.mailAccountId,
                providerMessageRef: String(item.uid),
                folderRef: folder,
              };
              loadedKeys.add(key);
              metadataPool.push(message);
            } catch {
              warnings.add('部分历史邮件关系头解析失败，未将其自动并入当前会话。');
            }
          }
        } catch {
          warnings.add('部分历史邮件关系暂时读取失败，当前邮件仍可正常查看。');
        }
      }
    }

    const groupedMetadata = groupStrictMailConversations(metadataPool.map((message) => ({
      ...message,
      automated: isAutomatedConversationCandidate(message),
      deliveryFailure: /(?:mailer-daemon|postmaster|undeliverable|delivery failed|退信|投递失败|无法送达)/i.test(
        `${message.subject} ${message.from}`,
      ),
    })));
    const selectedRfcId = extractRfcMessageIds(selected.message.rfcMessageId)[0];
    const selectedMetadataGroup = groupedMetadata.find((group) => group.messages.some((message) => (
      message.id === selected.message.id
      || (selectedRfcId && extractRfcMessageIds(message.rfcMessageId).includes(selectedRfcId))
    ))) || { identity: selectedRfcId || selected.message.id, messages: [selected.message] };

    const fullMessagePool: Array<{
      parsed: Awaited<ReturnType<typeof simpleParser>>;
      starred: boolean;
      message: GmailMessage;
    }> = [selected];
    const finalUidsByFolder = new Map<string, number[]>();
    selectedMetadataGroup.messages.forEach((message) => {
      if (message.id === selected.message.id) return;
      const folder = message.folderRef || '';
      const uid = Number(message.providerMessageRef || 0);
      if (!folder || !Number.isSafeInteger(uid) || uid <= 0) return;
      finalUidsByFolder.set(folder, [...(finalUidsByFolder.get(folder) || []), uid]);
    });
    for (const [folder, uids] of finalUidsByFolder) {
      try {
        fullMessagePool.push(...await readFullMessages(folder, Array.from(new Set(uids))));
      } catch {
        warnings.add('部分历史邮件正文暂时读取失败，当前已显示可正常读取的邮件。');
      }
    }

    const groupedFullMessages = groupStrictMailConversations(fullMessagePool.map((candidate) => ({
      ...candidate.message,
      automated: isAutomatedConversationCandidate(candidate.message),
      deliveryFailure: /(?:mailer-daemon|postmaster|undeliverable|delivery failed|退信|投递失败|无法送达)/i.test(
        `${candidate.message.subject} ${candidate.message.from}`,
      ),
    })));
    const selectedGroup = groupedFullMessages.find((group) => group.messages.some((message) => (
      message.id === selected.message.id
      || (selectedRfcId && extractRfcMessageIds(message.rfcMessageId).includes(selectedRfcId))
    ))) || { identity: selectedRfcId || selected.message.id, messages: [selected.message] };
    const sorted = selectedGroup.messages;
    const root = sorted[0] || selected.message;
    const threadId = buildThreadRef(
      options.account,
      root.folderRef || options.folder,
      Number(root.providerMessageRef || options.uid),
      selectedGroup.identity,
    );
    const messages = sorted.map((message) => ({ ...message, threadId }));
    const latest = messages.at(-1) || selected.message;
    return {
      id: threadId,
      subject: latest.subject,
      snippet: latest.snippet,
      messages,
      participantCount: new Set(messages.flatMap((message) => [message.from, message.to, message.cc]).filter(Boolean)).size,
      lastMessageDate: latest.date,
      hasUnread: messages.some((message) => !message.isRead),
      labels: Array.from(new Set(messages.flatMap((message) => message.labels))),
      isStarred: fullMessagePool.some((candidate) => (
        candidate.starred && messages.some((message) => message.id === candidate.message.id)
      )),
      provider: 'tencent_exmail' as const,
      mailAccountId: options.account.mailAccountId,
      folderRef: latest.folderRef,
      loadWarning: warnings.size ? Array.from(warnings).join('；') : undefined,
    } satisfies GmailThread;
  });
}

const tencentThreadCache = new ExpiringRequestCache<GmailThread>(TENCENT_THREAD_CACHE_TTL_MS);

function tencentThreadCachePrefix(cacheScope: string, mailAccountId: string) {
  return `${cacheScope}|${mailAccountId}|`;
}

export function invalidateTencentThreadCache(cacheScope: string, mailAccountId: string) {
  tencentThreadCache.invalidatePrefix(tencentThreadCachePrefix(cacheScope, mailAccountId));
}

export async function getTencentThread(options: {
  login: TencentExmailLogin;
  account: MailAccount;
  folder: string;
  uid: number;
  cacheScope: string;
  forceRefresh?: boolean;
}) {
  const cacheKey = `${tencentThreadCachePrefix(options.cacheScope, options.account.mailAccountId)}${options.folder}|${options.uid}`;
  return tencentThreadCache.load(
    cacheKey,
    () => loadTencentThread(options),
    {
      force: options.forceRefresh,
      shouldCache: (thread) => !thread.loadWarning,
    },
  );
}

export async function getTencentAttachment(options: {
  login: TencentExmailLogin;
  folder: string;
  uid: number;
  attachmentId: string;
}) {
  return withTencentExmailClient(options.login, async (client) => {
    await client.mailboxOpen(options.folder, { readOnly: true });
    const item = await client.fetchOne(options.uid, {
      source: { maxLength: MAX_MESSAGE_BYTES },
    }, { uid: true });
    if (!item || !item.source) throw new Error('邮件不存在或已被移动。');
    const parsed = await simpleParser(item.source);
    const index = Number(options.attachmentId.split(':').at(-1));
    if (!Number.isSafeInteger(index) || index < 0 || !parsed.attachments[index]) {
      throw new Error('附件不存在或已被移动。');
    }
    const attachment = parsed.attachments[index];
    return {
      filename: attachment.filename || `附件-${index + 1}`,
      mimeType: attachment.contentType || 'application/octet-stream',
      content: attachment.content,
    };
  });
}

type TencentSentEnvelope = {
  to: Array<{ address?: string }>;
  date: Date;
  inReplyTo?: string;
  references?: string;
};

async function readTextStream(content: AsyncIterable<Buffer | string>) {
  const chunks: Buffer[] = [];
  for await (const chunk of content) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function listTencentDailyTodoMessages(options: {
  login: TencentExmailLogin;
  account: MailAccount;
  since: Date;
  maxResults?: number;
}) {
  return withTencentExmailClient(options.login, async (client) => {
    const folders = await client.list();
    const mapping = identifyTencentFolders(folders, options.account.folderMapping);
    const inbox = mapping.inbox;
    const maxResults = Math.min(MAX_LIST_RESULTS, Math.max(1, options.maxResults || MAX_LIST_RESULTS));

    const recentSentItems: TencentSentEnvelope[] = [];
    if (mapping.sent) {
      await client.mailboxOpen(mapping.sent, { readOnly: true });
      const sentUids = await client.search({ since: options.since }, { uid: true });
      const recentSentUids = (sentUids || []).slice(-MAX_LIST_RESULTS);
      if (recentSentUids.length) {
        for await (const item of client.fetch(recentSentUids, {
          envelope: true,
          internalDate: true,
          headers: ['message-id', 'in-reply-to', 'references'],
        }, { uid: true })) {
          const parsed = item.headers ? await simpleParser(item.headers).catch(() => null) : null;
          recentSentItems.push({
            to: item.envelope?.to || [],
            date: new Date(resolveImapMessageTimestamp({
              internalDate: item.internalDate,
              parsedDate: parsed?.date,
              envelopeDate: item.envelope?.date,
            }) || 0),
            inReplyTo: parsed?.inReplyTo || String(item.envelope?.inReplyTo || '') || undefined,
            references: Array.isArray(parsed?.references)
              ? parsed.references.join(' ')
              : String(parsed?.references || '') || undefined,
          });
        }
      }
    }

    await client.mailboxOpen(inbox, { readOnly: true });
    const inboxUids = await client.search({ since: options.since }, { uid: true });
    const recentInboxUids = (inboxUids || []).slice(-maxResults).reverse();
    const messages: Array<{
      messageId: string;
      threadId: string;
      from: string;
      subject: string;
      snippet: string;
      body: string;
      date: string;
      answeredAt?: string;
      rfcMessageId?: string;
      inReplyTo?: string;
      references?: string;
      folderRef: string;
      providerMessageRef: string;
    }> = [];

    const inboxMetadata: FetchMessageObject[] = [];
    if (recentInboxUids.length) {
      for await (const item of client.fetch(recentInboxUids, {
        uid: true,
        flags: true,
        envelope: true,
        bodyStructure: true,
        headers: [
          'message-id',
          'in-reply-to',
          'references',
          'from',
          'to',
          'subject',
          'date',
          'auto-submitted',
          'precedence',
        ],
        internalDate: true,
      }, { uid: true })) {
        inboxMetadata.push(item);
      }
    }

    for (const item of inboxMetadata) {
      const uid = item.uid;
      if (!item.headers) continue;
      const parsed = await simpleParser(item.headers).catch(() => null);
      if (!parsed) continue;
      const message = followUpMessageFromParsed({
        account: options.account,
        folder: inbox,
        uid,
        parsed,
        internalDate: item.internalDate,
        labels: ['INBOX'],
      });
      if (isTencentAutomated(parsed, message) || isTencentDeliveryFailure(message)) continue;
      const senderEmail = parsedAddress(parsed.from);
      const answeredAt = resolveLatestMatchingMailboxAnswerAt(recentSentItems.map((item) => ({
        recipients: item.to.map((recipient) => String(recipient.address || '')),
        date: item.date.toISOString(),
        inReplyTo: item.inReplyTo,
        references: item.references,
      })), {
        senderEmail,
        date: message.date,
        messageId: parsed.messageId,
      });
      let body = '';
      const bodyPart = selectTencentTranslationBodyPart(item.bodyStructure);
      try {
        if (bodyPart?.part) {
          const downloaded = await client.download(uid, bodyPart.part, {
            uid: true,
          });
          body = await readTextStream(downloaded.content);
          body = bodyPart.type.toLowerCase() === 'text/html'
            ? resolveMailTranslationBody('', body)
            : resolveMailTranslationBody(body);
        } else {
          const full = await client.fetchOne(uid, { source: { maxLength: MAX_MESSAGE_BYTES } }, { uid: true });
          if (full && full.source) {
            const content = await simpleParser(full.source, { skipHtmlToText: true });
            body = resolveMailTranslationBody(content.text || '', typeof content.html === 'string' ? content.html : '');
          }
        }
      } catch {
        body = '';
      }
      messages.push({
        messageId: message.id,
        threadId: message.threadId,
        from: message.from,
        subject: message.subject,
        snippet: body.replace(/\s+/g, ' ').trim().slice(0, 240),
        body,
        date: message.date,
        answeredAt,
        rfcMessageId: message.rfcMessageId,
        inReplyTo: message.inReplyTo,
        references: message.references,
        folderRef: inbox,
        providerMessageRef: String(uid),
      });
    }
    return messages.sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
  });
}

export async function listTencentContactHistory(options: {
  login: TencentExmailLogin;
  account: MailAccount;
  contactEmail: string;
  maxResults?: number;
}) {
  const contactEmail = options.contactEmail.trim().toLowerCase();
  const maxResults = Math.min(20, Math.max(1, options.maxResults || 10));
  return withTencentExmailClient(options.login, async (client) => {
    const folders = await client.list();
    const mapping = identifyTencentFolders(folders, options.account.folderMapping);
    const excludedFolders = new Set([mapping.drafts, mapping.trash, mapping.spam].filter(Boolean));
    const targets = Array.from(new Set(folders
      .map((folder) => folder.path)
      .filter((folder) => !excludedFolders.has(folder))));
    const messages: Array<FollowUpMessage & { automated: boolean; deliveryFailure: boolean }> = [];

    for (const folder of targets) {
      await client.mailboxOpen(folder, { readOnly: true });
      const uids = await client.search({ or: [{ from: contactEmail }, { to: contactEmail }] }, { uid: true });
      for (const uid of (uids || []).slice(-maxResults)) {
        const item = await client.fetchOne(uid, {
          uid: true,
          source: { maxLength: MAX_MESSAGE_BYTES },
          internalDate: true,
        }, { uid: true });
        if (!item || !item.source) continue;
        const parsed = await simpleParser(item.source);
        const message = followUpMessageFromParsed({
          account: options.account,
          folder,
          uid,
          parsed,
          internalDate: item.internalDate,
          labels: [folder === mapping.sent ? 'SENT' : 'INBOX'],
        });
        messages.push({
          ...message,
          automated: isTencentAutomated(parsed, message),
          deliveryFailure: isTencentDeliveryFailure(message),
        });
      }
    }

    return messages
      .sort((left, right) => Date.parse(left.date) - Date.parse(right.date))
      .slice(-maxResults);
  });
}

export async function updateTencentMessageFlags(options: {
  login: TencentExmailLogin;
  folder: string;
  uid: number;
  read?: boolean;
  starred?: boolean;
}) {
  return withTencentExmailClient(options.login, async (client) => {
    await client.mailboxOpen(options.folder);
    if (typeof options.read === 'boolean') {
      const method = options.read ? client.messageFlagsAdd.bind(client) : client.messageFlagsRemove.bind(client);
      await method(options.uid, ['\\Seen'], { uid: true });
    }
    if (typeof options.starred === 'boolean') {
      const method = options.starred ? client.messageFlagsAdd.bind(client) : client.messageFlagsRemove.bind(client);
      await method(options.uid, ['\\Flagged'], { uid: true });
    }
    return { success: true };
  });
}

function extractRecipientEmails(...values: Array<string | undefined>) {
  const emails = values.flatMap((value) => String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
    .map((value) => value.trim().toLowerCase());
  if (!emails.length || emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new Error('请提供有效的收件人邮箱。');
  }
  if (emails.some((email) => containsIgnoredGmailContactEmail(email))) {
    throw new Error('系统已阻止发给 Mailsuite/Mailtrack 通知邮箱，请重新确认真实红人邮箱。');
  }
  return Array.from(new Set(emails));
}

function createTencentMessageId(email: string) {
  const domain = email.split('@')[1] || 'exmail.local';
  return `<${randomUUID()}@${domain}>`;
}

async function buildTencentRawMessage(options: {
  from: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  messageId?: string;
  attachments?: TencentOutgoingAttachment[];
  inlineImages?: Array<{ filename: string; mimeType: string; contentId: string; data: string }>;
}) {
  const messageId = options.messageId || createTencentMessageId(options.from);
  const raw = await new MailComposer({
    from: options.from,
    to: options.to,
    cc: options.cc,
    bcc: options.bcc,
    subject: options.subject,
    html: options.html,
    text: options.text,
    inReplyTo: options.inReplyTo,
    references: options.references,
    messageId,
    attachments: [
      ...(options.attachments || []).map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        cid: attachment.contentId,
        content: attachment.content,
        contentDisposition: attachment.inline ? 'inline' as const : 'attachment' as const,
      })),
      ...(options.inlineImages || []).map((image) => ({
        filename: image.filename,
        contentType: image.mimeType,
        cid: image.contentId,
        content: Buffer.from(image.data, 'base64'),
        contentDisposition: 'inline' as const,
      })),
    ],
    date: new Date(),
  }).compile().build();
  return { raw, messageId };
}

export async function saveTencentDraft(options: {
  login: TencentExmailLogin;
  account: MailAccount;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  inlineImages?: Array<{ filename: string; mimeType: string; contentId: string; data: string }>;
  attachments?: TencentOutgoingAttachment[];
  previousDraft?: { folderRef: string; uid: number };
}) {
  extractRecipientEmails(options.to, options.cc, options.bcc);
  return withTencentExmailClient(options.login, async (client) => {
    const folders = await client.list();
    const mapping = identifyTencentFolders(folders, options.account.folderMapping);
    if (!mapping.drafts) throw new Error('未识别到腾讯企业邮箱草稿箱，请先在邮箱设置中指定。');
    const { raw, messageId } = await buildTencentRawMessage({
      ...options,
      from: options.login.email,
    });
    const appended = await client.append(mapping.drafts, raw, ['\\Draft'], new Date());
    if (!appended) throw new Error('腾讯企业邮箱未确认草稿保存成功。');
    let cleanupWarning = '';
    if (options.previousDraft?.folderRef === mapping.drafts && options.previousDraft.uid) {
      try {
        await client.mailboxOpen(mapping.drafts);
        await client.messageDelete(options.previousDraft.uid, { uid: true });
      } catch {
        cleanupWarning = '新草稿已保存，但旧草稿未能自动清理，请在草稿箱中确认。';
      }
    }
    return {
      draftRef: `${options.account.mailAccountId}:${mapping.drafts}:${appended.uid || 'unknown'}`,
      folderRef: mapping.drafts,
      uid: appended.uid ? String(appended.uid) : undefined,
      messageId,
      cleanupWarning: cleanupWarning || undefined,
    };
  });
}

export async function sendTencentMessage(options: {
  login: TencentExmailLogin;
  account: MailAccount;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  messageId?: string;
  attachments?: TencentOutgoingAttachment[];
}) {
  const recipients = extractRecipientEmails(options.to, options.cc, options.bcc);
  const { raw, messageId } = await buildTencentRawMessage({
    ...options,
    from: options.login.email,
    messageId: options.messageId,
  });

  try {
    const existingSentCopy = await withTencentExmailClient(options.login, async (client) => {
      const folders = await client.list();
      const mapping = identifyTencentFolders(folders, options.account.folderMapping);
      if (!mapping.sent) return null;
      await client.mailboxOpen(mapping.sent, { readOnly: true });
      const existing = await client.search({ header: { 'message-id': messageId } }, { uid: true });
      const uid = existing ? existing.at(-1) : undefined;
      return uid ? { folderRef: mapping.sent, uid: String(uid) } : null;
    });
    if (existingSentCopy) {
      return {
        messageId,
        accepted: recipients,
        rejected: [],
        alreadySent: true,
        sentCopy: { ...existingSentCopy, synced: true },
      };
    }
  } catch {
    // 幂等预检查失败不应阻止用户正常发信，SMTP 结果仍是最终依据。
  }

  const smtp = await sendTencentExmailRaw({
    login: options.login,
    raw,
    from: options.login.email,
    to: recipients,
  });

  let sentCopy: { folderRef?: string; uid?: string; synced: boolean; warning?: string } = { synced: false };
  try {
    sentCopy = await withTencentExmailClient(options.login, async (client) => {
      const folders = await client.list();
      const mapping = identifyTencentFolders(folders, options.account.folderMapping);
      if (!mapping.sent) {
        return { synced: false, warning: '邮件已发送，但未识别到腾讯邮箱“已发送”文件夹。' };
      }
      await client.mailboxOpen(mapping.sent);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const existing = await client.search({ header: { 'message-id': messageId } }, { uid: true });
        const existingUid = existing ? existing.at(-1) : undefined;
        if (existingUid) return { folderRef: mapping.sent, uid: String(existingUid), synced: true };
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750));
      }
      const appended = await client.append(mapping.sent, raw, ['\\Seen'], new Date());
      if (!appended) {
        return { synced: false, warning: '邮件已发送，但腾讯邮箱未确认“已发送”副本同步成功。' };
      }
      return {
        folderRef: mapping.sent,
        uid: appended.uid ? String(appended.uid) : undefined,
        synced: true,
      };
    });
  } catch (error) {
    sentCopy = {
      synced: false,
      warning: `邮件已发送，但同步“已发送”文件夹失败：${error instanceof Error ? error.message : '未知错误'}`,
    };
  }

  return {
    messageId,
    accepted: smtp.accepted,
    rejected: smtp.rejected,
    sentCopy,
  };
}

function parsedAddress(value: AddressObject | AddressObject[] | undefined) {
  const first = (Array.isArray(value) ? value : value ? [value] : [])[0];
  return first?.value?.[0]?.address?.trim().toLowerCase() || '';
}

function headerText(parsed: Awaited<ReturnType<typeof simpleParser>>, name: string) {
  const value = parsed.headers.get(name.toLowerCase());
  return value === undefined ? '' : String(value);
}

function followUpMessageFromParsed(options: {
  account: MailAccount;
  folder: string;
  uid: number;
  parsed: Awaited<ReturnType<typeof simpleParser>>;
  internalDate?: Date | string;
  labels: string[];
}) : FollowUpMessage {
  const date = mailTimestampToIso(resolveImapMessageTimestamp({
    internalDate: options.internalDate,
    parsedDate: options.parsed.date,
  }));
  const messageId = options.parsed.messageId || `${options.account.mailAccountId}:${options.folder}:${options.uid}`;
  const references = Array.isArray(options.parsed.references)
    ? options.parsed.references.join(' ')
    : String(options.parsed.references || '');
  const body = options.parsed.text || options.parsed.html || '';
  return {
    id: `${options.account.mailAccountId}:${options.folder}:${options.uid}`,
    threadId: buildThreadRef(options.account, options.folder, options.uid, options.parsed.messageId),
    labelIds: options.labels,
    rfcMessageId: messageId,
    inReplyTo: options.parsed.inReplyTo,
    references,
    subject: options.parsed.subject || '(无主题)',
    from: addressText(options.parsed.from),
    to: addressText(options.parsed.to),
    date,
    body,
    providerMessageRef: String(options.uid),
    folderRef: options.folder,
  };
}

function isTencentAutomated(parsed: Awaited<ReturnType<typeof simpleParser>>, message: FollowUpMessage) {
  const autoSubmitted = headerText(parsed, 'auto-submitted');
  const precedence = headerText(parsed, 'precedence');
  return Boolean(autoSubmitted && !/^no$/i.test(autoSubmitted.trim()))
    || /^(bulk|list|junk)$/i.test(precedence.trim())
    || /(?:自动回复|automatic reply|out of office|vacation|autoreply)/i.test(`${message.subject} ${message.from}`);
}

function isTencentDeliveryFailure(message: FollowUpMessage) {
  return /(?:mailer-daemon|postmaster|delivery status notification|undeliverable|delivery failed|delivery failure|退信|投递失败|无法送达|邮箱不存在)/i.test(
    `${message.subject} ${message.from}`,
  );
}

export async function checkTencentFollowUp(options: {
  login: TencentExmailLogin;
  account: MailAccount;
  contactEmail: string;
  sentAt: number;
}) : Promise<FollowUpCheck> {
  const contactEmail = options.contactEmail.trim().toLowerCase();
  return withTencentExmailClient(options.login, async (client) => {
    const folders = await client.list();
    const mapping = identifyTencentFolders(folders, options.account.folderMapping);
    const folderTargets = Array.from(new Set([mapping.sent, mapping.inbox].filter(Boolean))) as string[];
    const messages: Array<{ message: FollowUpMessage; parsed: Awaited<ReturnType<typeof simpleParser>> }> = [];

    for (const folder of folderTargets) {
      await client.mailboxOpen(folder, { readOnly: true });
      const uids = await client.search({
        or: [{ from: contactEmail }, { to: contactEmail }],
        since: new Date(options.sentAt),
      }, { uid: true });
      const recentUids = (uids || []).slice(-50);
      for (const uid of recentUids) {
        const item = await client.fetchOne(uid, {
          uid: true,
          source: { maxLength: MAX_MESSAGE_BYTES },
          internalDate: true,
        }, { uid: true });
        if (!item || !item.source) continue;
        const parsed = await simpleParser(item.source);
        const message = followUpMessageFromParsed({
          account: options.account,
          folder,
          uid,
          parsed,
          internalDate: item.internalDate,
          labels: [folder === mapping.sent ? 'SENT' : 'INBOX'],
        });
        if (new Date(message.date).getTime() >= options.sentAt) messages.push({ message, parsed });
      }
    }

    const allOutbound = messages
      .filter(({ message, parsed }) => message.labelIds?.includes('SENT')
        && !headerText(parsed, 'x-draft')
        && parsedAddress(parsed.from) !== contactEmail
        && message.to.toLowerCase().includes(contactEmail))
      .map(({ message }) => message)
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const incoming = messages
      .filter(({ message, parsed }) => message.labelIds?.includes('INBOX') && parsedAddress(parsed.from) === contactEmail)
      .sort((a, b) => Date.parse(a.message.date) - Date.parse(b.message.date));
    const automatedReplies = incoming.filter(({ message, parsed }) => isTencentAutomated(parsed, message));
    const humanReplies = incoming.filter(({ message, parsed }) => !isTencentAutomated(parsed, message) && !isTencentDeliveryFailure(message));
    const deliveryFailures = messages.filter(({ message }) => isTencentDeliveryFailure(message)).map(({ message }) => message);
    const { outboundBeforeReply, humanRepliesAfterOutreach } = classifyFollowUpConversation(allOutbound, humanReplies.map(({ message }) => message));
    return {
      outbound: outboundBeforeReply.slice(0, 3),
      reply: humanRepliesAfterOutreach.at(-1) || null,
      automatedReply: automatedReplies.at(-1)?.message || null,
      deliveryFailure: deliveryFailures.at(-1) || null,
    };
  });
}

export function normalizeTencentThreadSubject(subject: string) {
  return subject.replace(/^\s*((re|fw|fwd|答复|回复|转发)\s*:\s*)+/gi, '').trim().toLowerCase();
}
