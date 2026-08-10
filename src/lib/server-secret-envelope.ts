import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type ServerSecretEnvelope = {
  version: 1;
  algorithm: 'aes-256-gcm';
  iv: string;
  authTag: string;
  ciphertext: string;
};

function getEncryptionKey() {
  const configured = process.env.APP_SECRET_ENCRYPTION_KEY?.trim();
  if (!configured || configured.length < 24) {
    throw new Error('服务器尚未配置 APP_SECRET_ENCRYPTION_KEY，无法安全保存企业应用密钥。');
  }
  return createHash('sha256').update(configured, 'utf8').digest();
}

export function encryptServerSecret(value: string): ServerSecretEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

export function decryptServerSecret(envelope: ServerSecretEnvelope) {
  if (envelope?.version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
    throw new Error('企业应用密钥格式无法识别，请重新保存飞书应用凭证。');
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(envelope.iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch (error) {
    if (error instanceof Error && error.message.includes('APP_SECRET_ENCRYPTION_KEY')) throw error;
    throw new Error('无法解密当前飞书应用密钥，请确认服务器加密密钥未被更换。');
  }
}
