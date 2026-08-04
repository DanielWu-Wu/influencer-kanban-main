import assert from 'node:assert/strict';
import { getEmailSignatureForContext } from '../src/lib/email-content';

const signature = 'Daniel Wu\nAFERIY EU';

assert.equal(
  getEmailSignatureForContext(signature, undefined, 'outreach'),
  signature,
  '旧设置缺少范围时，开发信应继续追加签名',
);
assert.equal(
  getEmailSignatureForContext(signature, undefined, 'regular'),
  signature,
  '旧设置缺少范围时，正常邮件应继续追加签名',
);
assert.equal(
  getEmailSignatureForContext(signature, 'outreach', 'outreach'),
  signature,
  '仅开发信模式应为开发信返回签名',
);
assert.equal(
  getEmailSignatureForContext(signature, 'outreach', 'regular'),
  undefined,
  '仅开发信模式不应为正常邮件返回签名',
);
assert.equal(
  getEmailSignatureForContext(signature, 'regular', 'regular'),
  signature,
  '仅正常邮件模式应为正常邮件返回签名',
);
assert.equal(
  getEmailSignatureForContext(signature, 'regular', 'outreach'),
  undefined,
  '仅正常邮件模式不应为开发信返回签名',
);
assert.equal(
  getEmailSignatureForContext('', 'both', 'outreach'),
  '',
  '空签名应保持为空',
);

console.log('email-signature-scope tests passed');
