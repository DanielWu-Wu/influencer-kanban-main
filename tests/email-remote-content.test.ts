import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasRemoteEmailResourceReference,
  isRemoteEmailResourceUrl,
  shouldBlockRemoteEmailContent,
  stripRemoteCssResources,
} from '../src/lib/email-remote-content';

test('识别会自动联网的邮件资源地址', () => {
  assert.equal(isRemoteEmailResourceUrl('https://track.example/pixel.gif'), true);
  assert.equal(isRemoteEmailResourceUrl('http://cdn.example/logo.png'), true);
  assert.equal(isRemoteEmailResourceUrl('//cdn.example/logo.png'), true);
  assert.equal(isRemoteEmailResourceUrl('cid:product-main-image'), false);
  assert.equal(isRemoteEmailResourceUrl('data:image/png;base64,AAAA'), false);
  assert.equal(isRemoteEmailResourceUrl('blob:https://app.example/image'), false);
  assert.equal(isRemoteEmailResourceUrl('/local-image.png'), false);
});

test('识别 srcset 等复合属性中的远程资源', () => {
  assert.equal(hasRemoteEmailResourceReference('data:image/png;base64,AAAA 1x, https://cdn.example/logo.png 2x'), true);
  assert.equal(hasRemoteEmailResourceReference('cid:product-main-image 1x, data:image/png;base64,AAAA 2x'), false);
  assert.equal(hasRemoteEmailResourceReference('blob:https://app.example/image 1x'), false);
});

test('只有未获临时授权的 SENT 邮件启用远程资源保护', () => {
  assert.equal(shouldBlockRemoteEmailContent(['SENT'], false), true);
  assert.equal(shouldBlockRemoteEmailContent(['SENT'], true), false);
  assert.equal(shouldBlockRemoteEmailContent(['INBOX', 'UNREAD'], false), false);
});

test('移除 CSS 中的远程图片和样式导入但保留内嵌图片及排版', () => {
  const result = stripRemoteCssResources([
    '@import url("https://cdn.example/email.css");',
    '.hero { background-image: url(https://track.example/pixel.gif); background-color: #fff; }',
    '.product { background-image: url("data:image/png;base64,AAAA"); color: #111; }',
    '.inline { background-image: url(cid:product-main-image); }',
  ].join('\n'));

  assert.equal(result.blockedRemoteResourceCount, 2);
  assert.equal(result.css.includes('https://cdn.example/email.css'), false);
  assert.equal(result.css.includes('https://track.example/pixel.gif'), false);
  assert.equal(result.css.includes('background-color: #fff'), true);
  assert.equal(result.css.includes('data:image/png;base64,AAAA'), true);
  assert.equal(result.css.includes('cid:product-main-image'), true);
});
