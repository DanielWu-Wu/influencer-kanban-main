import 'server-only';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { DEFAULT_TENCENT_EXMAIL_CONFIG } from './mail-accounts';

export type TencentExmailLogin = {
  email: string;
  password: string;
};

const CONNECTION_TIMEOUT_MS = 12_000;
const SOCKET_TIMEOUT_MS = 20_000;

function createImapClient(login: TencentExmailLogin, verifyOnly = false) {
  return new ImapFlow({
    host: DEFAULT_TENCENT_EXMAIL_CONFIG.incomingHost,
    port: DEFAULT_TENCENT_EXMAIL_CONFIG.incomingPort,
    secure: true,
    auth: { user: login.email, pass: login.password },
    logger: false,
    verifyOnly,
    includeMailboxes: verifyOnly,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    maxLineLength: 2 * 1024 * 1024,
    // 单个入站附件允许 25 MB，MIME 邮件本身还包含编码和邮件头开销。
    maxLiteralSize: 32 * 1024 * 1024,
    maxResponseSize: 30 * 1024 * 1024,
  });
}

function safeConnectionError(error: unknown, protocol: 'IMAP' | 'SMTP') {
  const value = error as { code?: unknown; authenticationFailed?: unknown } | null;
  if (value?.authenticationFailed || value?.code === 'EAUTH') {
    return `${protocol} 认证失败，请检查邮箱地址、客户端密码或授权码。`;
  }
  if (value?.code === 'CONNECT_TIMEOUT' || value?.code === 'ETIMEDOUT') {
    return `${protocol} 连接超时，请稍后重试。`;
  }
  if (value?.code === 'ECONNREFUSED') {
    return `${protocol} 服务器拒绝连接，请确认企业邮箱服务已开启。`;
  }
  return `${protocol} 连接失败，请检查腾讯企业邮箱客户端服务是否已开启。`;
}

export async function withTencentExmailClient<T>(
  login: TencentExmailLogin,
  callback: (client: ImapFlow) => Promise<T>,
) {
  const client = createImapClient(login);
  try {
    await client.connect();
    return await callback(client);
  } catch (error) {
    throw new Error(safeConnectionError(error, 'IMAP'));
  } finally {
    if (client.usable) {
      await client.logout().catch(() => client.close());
    } else {
      client.close();
    }
  }
}

export async function testTencentExmailImap(login: TencentExmailLogin) {
  const client = createImapClient(login, true);
  try {
    await client.connect();
  } catch (error) {
    throw new Error(safeConnectionError(error, 'IMAP'));
  } finally {
    if (client.usable) await client.logout().catch(() => client.close());
    else client.close();
  }
}

export async function testTencentExmailSmtp(login: TencentExmailLogin) {
  const transport = createSmtpTransport(login);
  try {
    await transport.verify();
  } catch (error) {
    throw new Error(safeConnectionError(error, 'SMTP'));
  } finally {
    transport.close();
  }
}

function createSmtpTransport(login: TencentExmailLogin) {
  return nodemailer.createTransport({
    host: DEFAULT_TENCENT_EXMAIL_CONFIG.outgoingHost,
    port: DEFAULT_TENCENT_EXMAIL_CONFIG.outgoingPort,
    secure: true,
    auth: { user: login.email, pass: login.password },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: CONNECTION_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });
}

export async function sendTencentExmailRaw(options: {
  login: TencentExmailLogin;
  raw: Buffer;
  from: string;
  to: string[];
}) {
  const transport = createSmtpTransport(options.login);
  try {
    const result = await transport.sendMail({
      envelope: { from: options.from, to: options.to },
      raw: options.raw,
    });
    return {
      accepted: result.accepted.map(String),
      rejected: result.rejected.map(String),
      messageId: result.messageId,
      response: result.response,
    };
  } catch (error) {
    const message = safeConnectionError(error, 'SMTP');
    throw new Error(message.includes('认证失败') ? message : `邮件发送失败：${message}`);
  } finally {
    transport.close();
  }
}
