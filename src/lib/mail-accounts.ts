export type MailProvider = 'gmail' | 'tencent_exmail';

export type MailAccountConnectionStatus =
  | 'connected'
  | 'disconnected'
  | 'error';

export type MailAccountCapabilities = {
  receive: boolean;
  drafts: boolean;
  send: boolean;
};

export type MailFolderMapping = Partial<Record<
  'inbox' | 'sent' | 'drafts' | 'trash' | 'spam',
  string
>>;

export type MailAccount = {
  mailAccountId: string;
  provider: MailProvider;
  email: string;
  displayName: string;
  connectionStatus: MailAccountConnectionStatus;
  isDefault: boolean;
  capabilities: MailAccountCapabilities;
  lastTestedAt?: string;
  lastError?: string;
  folderMapping?: MailFolderMapping;
  incomingHost?: string;
  incomingPort?: number;
  outgoingHost?: string;
  outgoingPort?: number;
  secure?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MailContext = Pick<
  MailAccount,
  'provider' | 'mailAccountId' | 'email' | 'capabilities'
>;

export type MailMessageLocator = {
  provider: MailProvider;
  mailAccountId: string;
  threadRef?: string;
  messageRef: string;
  folderRef?: string;
  rfcMessageId?: string;
};

export type MailDraftLocator = {
  provider: MailProvider;
  mailAccountId: string;
  draftRef: string;
  folderRef?: string;
  providerMessageRef?: string;
};

export type MailAttachmentRef = {
  bucket: 'mail-attachments-temp';
  path: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type OutgoingMailRequest = {
  mailAccountId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  html: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
  threadRef?: string;
  draft?: MailDraftLocator;
  attachments?: MailAttachmentRef[];
  businessSource?: string;
};

export const DEFAULT_TENCENT_EXMAIL_CONFIG = {
  incomingHost: 'imap.exmail.qq.com',
  incomingPort: 993,
  outgoingHost: 'smtp.exmail.qq.com',
  outgoingPort: 465,
  secure: true,
} as const;

export function normalizeMailAddress(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function buildMailAccountId(provider: MailProvider, email: unknown) {
  const normalizedEmail = normalizeMailAddress(email);
  if (!normalizedEmail) throw new Error('邮箱地址不能为空。');
  return `${provider}:${normalizedEmail}`;
}

export function getMailProviderLabel(provider: MailProvider) {
  return provider === 'gmail' ? 'Gmail' : '腾讯企业邮箱';
}

export function isMailAccount(value: unknown): value is MailAccount {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MailAccount>;
  return Boolean(
    (candidate.provider === 'gmail' || candidate.provider === 'tencent_exmail')
    && typeof candidate.mailAccountId === 'string'
    && typeof candidate.email === 'string'
    && typeof candidate.displayName === 'string'
    && candidate.capabilities
    && typeof candidate.capabilities.receive === 'boolean'
    && typeof candidate.capabilities.drafts === 'boolean'
    && typeof candidate.capabilities.send === 'boolean'
    && typeof candidate.createdAt === 'string'
    && typeof candidate.updatedAt === 'string',
  );
}

export function parseMailAccounts(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, MailAccount>();
  value.forEach((item) => {
    if (!isMailAccount(item)) return;
    unique.set(item.mailAccountId, item);
  });
  return Array.from(unique.values());
}

export function createLegacyGmailAccount(email: string, now = new Date().toISOString()): MailAccount {
  const normalizedEmail = normalizeMailAddress(email);
  return {
    mailAccountId: buildMailAccountId('gmail', normalizedEmail),
    provider: 'gmail',
    email: normalizedEmail,
    displayName: 'Gmail',
    connectionStatus: 'connected',
    isDefault: true,
    capabilities: { receive: true, drafts: true, send: true },
    createdAt: now,
    updatedAt: now,
  };
}

export function sortMailAccounts(accounts: MailAccount[]) {
  return [...accounts].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    if (left.provider !== right.provider) return left.provider === 'gmail' ? -1 : 1;
    return left.email.localeCompare(right.email);
  });
}
