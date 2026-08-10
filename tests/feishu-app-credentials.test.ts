import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFeishuCredentialFingerprint,
  normalizeFeishuAppCredentials,
} from '../src/lib/feishu-app-credentials';
import {
  decryptServerSecret,
  encryptServerSecret,
} from '../src/lib/server-secret-envelope';

test('飞书应用凭证会去除首尾空格并校验完整性', () => {
  assert.deepEqual(
    normalizeFeishuAppCredentials('  cli_example_app  ', '  example-secret-123  '),
    { appId: 'cli_example_app', appSecret: 'example-secret-123' },
  );
  assert.throws(() => normalizeFeishuAppCredentials('bad', 'short'), /格式不正确/);
});

test('飞书应用指纹稳定且能区分不同企业应用', () => {
  const first = buildFeishuCredentialFingerprint('cli_example_app', 'secret-a');
  assert.equal(first, buildFeishuCredentialFingerprint('cli_example_app', 'secret-a'));
  assert.notEqual(first, buildFeishuCredentialFingerprint('cli_example_app', 'secret-b'));
  assert.notEqual(first, buildFeishuCredentialFingerprint('cli_other_app', 'secret-a'));
});

test('App Secret 加密后可恢复，密文被修改时会拒绝读取', () => {
  const previousKey = process.env.APP_SECRET_ENCRYPTION_KEY;
  process.env.APP_SECRET_ENCRYPTION_KEY = 'test-only-feishu-secret-encryption-key-2026';
  try {
    const envelope = encryptServerSecret('very-private-app-secret');
    assert.notEqual(envelope.ciphertext, 'very-private-app-secret');
    assert.equal(decryptServerSecret(envelope), 'very-private-app-secret');

    assert.throws(
      () => decryptServerSecret({ ...envelope, ciphertext: `${envelope.ciphertext}A` }),
      /无法解密/,
    );
  } finally {
    if (previousKey === undefined) delete process.env.APP_SECRET_ENCRYPTION_KEY;
    else process.env.APP_SECRET_ENCRYPTION_KEY = previousKey;
  }
});

