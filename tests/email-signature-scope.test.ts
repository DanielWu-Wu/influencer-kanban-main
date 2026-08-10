import assert from 'node:assert/strict';
import {
  applyPlainTextEmailSignature,
  getEmailSignatureForContext,
  stripConfiguredEmailSignature,
} from '../src/lib/email-content';

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

assert.equal(
  stripConfiguredEmailSignature(
    'Quedo atento a tu respuesta.\n\nUn cordial saludo,\nDaniel',
    'Daniel Wu\nDigital Marketing Specialist | Aferiy\nAFERIY EU',
  ),
  'Quedo atento a tu respuesta.\n\nUn cordial saludo,',
  '应删除签名姓名的名字缩写，同时保留自然结束语',
);
assert.equal(
  stripConfiguredEmailSignature(
    'Gracias por tu tiempo.\n\n*Daniel Wu*',
    'Daniel Wu\nDigital Marketing Specialist | Aferiy',
  ),
  'Gracias por tu tiempo.',
  '应删除带简单 Markdown 标记的完整姓名',
);
assert.equal(
  stripConfiguredEmailSignature(
    'Muchas gracias.\n\nMaría José',
    'María José García\nInfluencer Marketing Manager',
  ),
  'Muchas gracias.',
  '应支持团队成员的多段名字',
);
assert.equal(
  stripConfiguredEmailSignature(
    'Thank you.\n\nAlex',
    'Kind regards,\nAlex Chen\nCreator Partnerships',
  ),
  'Thank you.',
  '签名先写结束语时仍应识别后续姓名',
);
assert.equal(
  stripConfiguredEmailSignature(
    'Please ask Daniel to confirm the address.\n\nUn cordial saludo,',
    'Daniel Wu\nDigital Marketing Specialist | Aferiy',
  ),
  'Please ask Daniel to confirm the address.\n\nUn cordial saludo,',
  '正文中的本人姓名不在末尾署名位置时不得删除',
);
assert.equal(
  stripConfiguredEmailSignature(
    'Thank you.\n\nMichael',
    'Daniel Wu\nDigital Marketing Specialist | Aferiy',
  ),
  'Thank you.\n\nMichael',
  '不得删除不属于当前账号签名的其他姓名',
);
assert.equal(
  stripConfiguredEmailSignature('Thank you.\n\nDaniel', ''),
  'Thank you.\n\nDaniel',
  '账号未配置签名时不得猜测或删除姓名',
);
assert.equal(
  applyPlainTextEmailSignature(
    'Quedo atento.\n\nUn cordial saludo,\nDaniel',
    signature,
  ),
  `Quedo atento.\n\nUn cordial saludo,\n\n${signature}`,
  '追加签名前应先移除 AI 生成的姓名，并且只追加一次完整签名',
);

console.log('email-signature-scope tests passed');
