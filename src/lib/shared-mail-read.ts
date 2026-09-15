import { ACCOUNT_SCOPE_CHANGED_EVENT, getAccountCacheScope } from './account-cache-scope';
import { MailReadCoordinator } from './mail-read-coordinator';
import type { GmailThread } from './types';
import { extractRfcMessageIds } from './mail-conversation';
import { workspaceFetch } from './workspace-request';

export const MAIL_READ_INVALIDATED_EVENT = 'mail-read-invalidated';
export const MAIL_THREAD_CHANGED_EVENT = 'mail-thread-version-changed';
export const MAIL_FLAGS_CHANGED_EVENT = 'mail-thread-flags-changed';
export const mailReads = new MailReadCoordinator();
let gmailAddress = '';
let readEpoch = 0;
const tokenAccounts = new Map<string, { owner: string; address: string }>();
const tencentThreadKeys = new Map<string, Set<string>>();
export function bindGmailReadAccount(email: string, token: string) {
  gmailAddress = email.trim().toLowerCase();
  tokenAccounts.set(token, { owner: getAccountCacheScope(), address: gmailAddress });
  while (tokenAccounts.size > 8) tokenAccounts.delete(tokenAccounts.keys().next().value!);
}
export function mailReadScope(provider: string, accountId: string) {
  return JSON.stringify([getAccountCacheScope(), provider, accountId]);
}
export function currentGmailReadScope() { return mailReadScope('gmail', `gmail:${gmailAddress}`); }
export function currentGmailReadAccountId() { return gmailAddress ? `gmail:${gmailAddress}` : ''; }
export function mailReadContext() { return JSON.stringify([getAccountCacheScope(), gmailAddress, readEpoch]); }
export function invalidateMailReads() {
  readEpoch += 1;
  mailReads.clear();
  tencentThreadKeys.clear();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MAIL_READ_INVALIDATED_EVENT));
}
if (typeof window !== 'undefined') {
  for (const event of [ACCOUNT_SCOPE_CHANGED_EVENT, 'gmail-auth-cache-reset']) {
    window.addEventListener(event, () => {
      invalidateMailReads();
      gmailAddress = '';
      tokenAccounts.clear();
    });
  }
}

type Packet = { status: number; body: unknown; retryAfter: string | null };
type Json = Record<string, unknown>;
function version(raw: Json) {
  return JSON.stringify([raw.historyId || '', (raw.messages as Json[] || []).map((m) => [m.id, m.historyId, m.labelIds])]);
}
function watchGmailVersion(scope: string, raw: Json) {
  if (!raw.id || !Array.isArray(raw.messages)) return false;
  const fullKey = `gmail:threads/${raw.id}:full`;
  const previous = mailReads.peek<string>(scope, `version:${raw.id}`, 86_400_000);
  const next = version(raw);
  if (previous && previous !== next) {
    mailReads.forget(scope, fullKey);
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MAIL_THREAD_CHANGED_EVENT, { detail: { threadId: String(raw.id) } }));
  }
  mailReads.seed(scope, `version:${raw.id}`, next);
  return Boolean(previous && previous !== next);
}
function seedTencentBodies(scope: string, thread: GmailThread) {
  if (thread.isPartial || thread.loadWarning) return;
  for (const m of thread.messages) {
    if (!m.folderRef || !m.providerMessageRef) continue;
    mailReads.seed(scope, `body:${JSON.stringify([m.folderRef, m.providerMessageRef, m.rfcMessageId || '', m.mailboxVersion || ''])}`, {
      status: 200, body: { success: true, data: { body: m.body, messageId: m.id } }, retryAfter: null,
    });
  }
}
function observeTencentMessages(scope: string, messages: Array<{ id?: string; messageId?: string; rfcMessageId?: string; inReplyTo?: string; references?: string; folderRef?: string; mailboxVersion?: string }>) {
  for (const key of tencentThreadKeys.get(scope) || []) {
    const packet = mailReads.peek<Packet>(scope, key);
    const thread = (packet?.body as { data?: GmailThread } | undefined)?.data;
    if (!thread) continue;
    const ids = new Set(thread.messages.map((m) => m.id));
    const rfcIds = new Set(thread.messages.flatMap((m) => extractRfcMessageIds(m.rfcMessageId || '')));
    if (messages.some((m) => (m.mailboxVersion && thread.messages.some((old) => old.folderRef === m.folderRef && old.mailboxVersion !== m.mailboxVersion))
      || (!ids.has(m.id || m.messageId || '') && extractRfcMessageIds(`${m.inReplyTo || ''} ${m.references || ''}`).some((id) => rfcIds.has(id))))) {
      mailReads.forget(scope, key);
    }
  }
}
function invalidateFlags(url: URL, init: RequestInit) {
  const payload = typeof init.body === 'string' ? JSON.parse(init.body) as Json : {};
  if (url.pathname === '/api/mail/tencent' && payload.action === 'flags') {
    const scope = mailReadScope('tencent_exmail', String(payload.mailAccountId || ''));
    mailReads.forget(scope, `thread:${JSON.stringify([String(payload.folder || ''), String(payload.uid || '')])}`);
    for (const [key, packet] of mailReads.entries<Packet>(scope)) {
      if (!key.startsWith('thread:')) continue;
      const thread = (packet?.body as { data?: GmailThread })?.data;
      if (thread?.messages.some((m) => m.folderRef === payload.folder && m.providerMessageRef === String(payload.uid))) mailReads.forget(scope, key);
    }
    return true;
  }
  const target = url.pathname.match(/\/users\/me\/(threads|messages)\/([^/]+)\/modify$/);
  if (!target) return false;
  const token = new Headers(init.headers).get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  const account = tokenAccounts.get(token);
  if (!account) return false;
  const scope = mailReadScope('gmail', `gmail:${account.address}`);
  const threads = new Set<string>(target[1] === 'threads' ? [target[2]] : []);
  for (const [key, packet] of mailReads.entries<Packet>(scope)) {
    if (!key.startsWith('gmail:threads/')) continue;
    const raw = packet.body as Json;
    if (Array.isArray(raw?.messages) && raw.messages.some((m: Json) => m.id === target[2])) threads.add(String(raw.id));
  }
  for (const id of threads) {
    for (const format of ['full', 'metadata']) mailReads.forget(scope, `gmail:threads/${id}:${format}`);
    mailReads.forget(scope, `validated:${id}`);
  }
  if (!threads.size) mailReads.invalidate(scope);
  // Local parsed view caches must follow flags; unrelated shared mail bodies stay reusable.
  if (typeof window !== 'undefined') {
    for (const threadId of threads) window.dispatchEvent(new CustomEvent(MAIL_FLAGS_CHANGED_EVENT, { detail: { threadId } }));
    if (!threads.size) window.dispatchEvent(new Event(MAIL_READ_INVALIDATED_EVENT));
  }
  return true;
}

/** Explicitly imported by mail consumers; never replaces window.fetch. Writes are never cached/retried. */
export async function sharedMailFetch(input: RequestInfo | URL, init: RequestInit = {}, options: {
  force?: boolean; priority?: number; reuseMetadata?: boolean; timeoutMs?: number;
} = {}): Promise<Response> {
  if (input instanceof Request) return fetch(input, init);
  const url = new URL(String(input), 'https://mail.local');
  const direct = url.hostname === 'gmail.googleapis.com';
  const gmailProxy = url.pathname === '/api/gmail';
  const tencent = url.pathname === '/api/mail/tencent';
  const mailAccountChange = url.pathname.startsWith('/api/mail/accounts');
  if (!direct && !gmailProxy && !tencent && !mailAccountChange) return workspaceFetch(input, init);
  if ((init.method || 'GET').toUpperCase() !== 'GET') {
    if (gmailProxy && typeof init.body === 'string') {
      try { if (JSON.parse(init.body).action === 'contactHistory') return fetch(input, init); } catch { /* malformed writes are handled by the existing endpoint */ }
    }
    // Invalidate even on ambiguous write failure: a provider may have accepted the write.
    try { return await fetch(input, init); } finally {
      let flagsOnly = false;
      try { flagsOnly = invalidateFlags(url, init); } catch { /* Fall back to conservative invalidation. */ }
      if (!flagsOnly) invalidateMailReads();
    }
  }
  if (mailAccountChange) return fetch(input, init);
  const epoch = readEpoch;
  const token = new Headers(init.headers).get('Authorization')?.replace(/^Bearer\s+/i, '') || '';
  const bound = direct ? tokenAccounts.get(token) : undefined;
  if (direct && (!bound || bound.owner !== getAccountCacheScope())) {
    throw new Error('Gmail 读取身份已变化，请重新打开邮箱。');
  }
  const accountId = tencent ? url.searchParams.get('mailAccountId') || '' : `gmail:${bound?.address || gmailAddress}`;
  if (!accountId || accountId === 'gmail:') throw new Error('邮箱读取身份尚未就绪。');
  const scope = mailReadScope(tencent ? 'tencent_exmail' : 'gmail', accountId);
  const action = url.searchParams.get('action') || '';
  // Only body/detail and list reads share short-lived results. Business checks stay fresh.
  let resource = `${url.pathname}?${[...url.searchParams].sort().map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
  let proxyShape = false;
  let isGmailThread = false;
  let format = '';
  if (direct) {
    const match = url.pathname.match(/\/users\/me\/(threads|messages)\/([^/]+)$/);
    if (match) {
      format = url.searchParams.get('format') || 'full';
      resource = `gmail:${match[1]}/${match[2]}:${format}`;
      isGmailThread = match[1] === 'threads';
    }
  } else if (gmailProxy && (action === 'thread' || action === 'message')) {
    format = url.searchParams.get('format') === 'metadata' ? 'metadata' : 'full';
    resource = `gmail:${action === 'thread' ? 'threads' : 'messages'}/${url.searchParams.get(action === 'thread' ? 'threadId' : 'messageId')}:${format}`;
    proxyShape = true;
    isGmailThread = action === 'thread';
  }
  if (tencent && action === 'messageBody') resource = `body:${JSON.stringify([
    url.searchParams.get('folder'), url.searchParams.get('uid'), url.searchParams.get('rfcMessageId') || '',
    url.searchParams.get('mailboxVersion') || '',
  ])}`;
  if (tencent && action === 'thread') resource = `thread:${JSON.stringify([url.searchParams.get('folder'), url.searchParams.get('uid')])}`;
  const forced = options.force || url.searchParams.get('forceRefresh') === '1';
  const detail = (isGmailThread && format === 'full') || (tencent && ['thread', 'messageBody'].includes(action));
  // Revalidate retained bodies before reuse, without occupying a queue slot while waiting for another read.
  if (!forced && isGmailThread && format === 'full' && !mailReads.peek(scope, resource)
    && mailReads.peek(scope, resource, 15 * 60_000)) {
    const metadataUrl = new URL(url);
    metadataUrl.searchParams.set('format', 'metadata');
    const check = await sharedMailFetch(direct ? metadataUrl : `${metadataUrl.pathname}${metadataUrl.search}`, init,
      { priority: options.priority ?? 0, reuseMetadata: true, timeoutMs: options.timeoutMs });
    if (!check.ok) return check;
  }
  const previousBody = isGmailThread && format === 'full' ? mailReads.peek<Packet>(scope, resource, 15 * 60_000) : undefined;
  const threadId = isGmailThread ? resource.split('/').at(-1)?.replace(/:full$/, '') : '';
  const validatedBody = previousBody && mailReads.peek<string>(scope, `validated:${threadId}`) === version(previousBody.body as Json);
  // Long body retention is safe only after a fresh Gmail version check, or immutable IMAP UIDVALIDITY + UID + Message-ID.
  const ttl = validatedBody || (tencent && action === 'messageBody' && url.searchParams.get('mailboxVersion') && url.searchParams.get('rfcMessageId'))
    ? 15 * 60_000 : 60_000;
  const signal = init.signal;
  if (signal?.aborted) throw new DOMException('读取已取消', 'AbortError');
  const promise = mailReads.load<Packet>(scope, resource, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 40_000);
    try {
      // The browser owns freshness. Do not let a second server cache serve an older Tencent conversation.
      const target = tencent && action === 'thread' ? (() => {
        const fresh = new URL(url);
        fresh.searchParams.set('forceRefresh', '1');
        return `${fresh.pathname}${fresh.search}`;
      })() : input;
      const response = await fetch(target, { ...init, cache: 'no-store', signal: controller.signal });
      const body = await response.json();
      const packet = { status: response.status, body: proxyShape && response.ok ? body.data : body, retryAfter: response.headers.get('Retry-After') };
      if (response.status === 429 || (response.status === 403 && /rate.?limit|quota.?exceeded|quota exceeded/i.test(JSON.stringify(body)))) {
        const seconds = Number(packet.retryAfter);
        const until = packet.retryAfter ? Date.parse(packet.retryAfter) - Date.now() : 0;
        mailReads.cooldown(scope, Math.max(60_000, Number.isFinite(seconds) ? seconds * 1000 : until || 0));
      }
      return packet;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('邮件读取超时，请重试。');
      throw error;
    } finally { clearTimeout(timeout); }
  }, { force: forced || (!detail && !options.reuseMetadata), ttl, priority: options.priority ?? (detail ? 0 : 1), cache: (p) => p.status === 200
    && !(p.body as Json)?.loadWarning && !((p.body as Json)?.data as Json)?.loadWarning
    && !((p.body as Json)?.data as Json)?.isPartial });
  // One viewer cancelling must not abort a shared request needed by another consumer.
  const packet = await new Promise<Packet>((resolve, reject) => {
    const abort = () => reject(new DOMException('读取已取消', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal?.removeEventListener('abort', abort));
  });
  if (epoch !== readEpoch) throw new Error('邮箱状态已变化，请重新读取。');
  if (packet.status === 200 && isGmailThread) {
    const changed = watchGmailVersion(scope, packet.body as Json);
    if (changed && format === 'full') mailReads.seed(scope, resource, packet);
    if (format === 'metadata') mailReads.seed(scope, `validated:${(packet.body as Json).id}`, version(packet.body as Json));
  }
  if (packet.status === 200 && tencent && action === 'thread' && (packet.body as Json).data) {
    const thread = (packet.body as Json).data as GmailThread;
    const expected = extractRfcMessageIds(url.searchParams.get('rfcMessageId') || '')[0];
    if (expected && !thread.messages.some((m) => extractRfcMessageIds(m.rfcMessageId || '').includes(expected))) {
      mailReads.forget(scope, resource);
      throw new Error('邮件编号已变化，请刷新后重新打开。');
    }
    const keys = tencentThreadKeys.get(scope) || new Set<string>();
    keys.add(resource);
    while (keys.size > 100) keys.delete(keys.values().next().value!);
    tencentThreadKeys.set(scope, keys);
    seedTencentBodies(scope, thread);
  } else if (packet.status === 200 && tencent) {
    const data = (packet.body as Json).data as { threads?: GmailThread[] } | undefined;
    if (data?.threads) observeTencentMessages(scope, data.threads.flatMap((t) => t.messages));
    if (action === 'dailyTodos' && Array.isArray(data)) observeTencentMessages(scope, data);
  }
  const body = proxyShape && packet.status === 200 ? { success: true, data: packet.body } : packet.body;
  return new Response(JSON.stringify(body), { status: packet.status, headers: { 'Content-Type': 'application/json', ...(packet.retryAfter ? { 'Retry-After': packet.retryAfter } : {}) } });
}
