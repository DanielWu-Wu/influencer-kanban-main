export type MailMessageHeader = {
  name: string;
  value: string;
};

export function parseMailTimestamp(value: unknown): number {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  if (typeof value !== 'string') return 0;
  const normalized = value.trim();
  if (!normalized) return 0;

  if (/^\d+$/.test(normalized)) {
    const timestamp = Number(normalized);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
  }

  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function headerValues(headers: MailMessageHeader[], name: string) {
  const normalizedName = name.toLowerCase();
  return headers
    .filter((header) => header.name.toLowerCase() === normalizedName)
    .map((header) => header.value);
}

function parseReceivedTimestamp(value: string) {
  const separatorIndex = value.lastIndexOf(';');
  const dateValue = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : value;
  return parseMailTimestamp(dateValue.replace(/\s+/g, ' ').trim());
}

/**
 * Gmail 的 internalDate 对普通 SMTP 来信可能沿用发件人填写的 Date 头。
 * 收件邮件优先采用 Gmail 接收服务器写入的最上层 Received 时间；
 * 已发送和草稿则优先采用邮箱内部时间。
 */
export function resolveGmailMessageTimestamp(options: {
  headers?: MailMessageHeader[];
  internalDate?: unknown;
  labelIds?: string[];
}) {
  const headers = options.headers || [];
  const labels = options.labelIds || [];
  const internalTimestamp = parseMailTimestamp(options.internalDate);
  const isMailboxCreatedCopy = labels.includes('SENT') || labels.includes('DRAFT');

  if (!isMailboxCreatedCopy) {
    for (const received of headerValues(headers, 'Received')) {
      const timestamp = parseReceivedTimestamp(received);
      if (timestamp) return timestamp;
    }
  }

  if (internalTimestamp) return internalTimestamp;
  return parseMailTimestamp(headerValues(headers, 'Date')[0]);
}

/** IMAP INTERNALDATE 是邮件进入当前邮箱文件夹的服务器时间，应优先于发件人 Date 头。 */
export function resolveImapMessageTimestamp(options: {
  internalDate?: unknown;
  parsedDate?: unknown;
  envelopeDate?: unknown;
}) {
  return parseMailTimestamp(options.internalDate)
    || parseMailTimestamp(options.parsedDate)
    || parseMailTimestamp(options.envelopeDate);
}

export function mailTimestampToIso(timestamp: number) {
  return timestamp > 0 ? new Date(timestamp).toISOString() : '';
}
