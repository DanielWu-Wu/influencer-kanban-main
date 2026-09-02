import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIsolatedEmailDocument, clampEmailBodyHeight, EMAIL_BODY_SANDBOX } from '../src/lib/isolated-email-document';
import { isSafeEditorStyle, isSafeEditorUrl } from '../src/lib/email-editor-html';

test('邮件沙箱仅允许测量和人工外链，不开放脚本表单下载或顶层跳转', () => {
  assert.deepEqual(EMAIL_BODY_SANDBOX.split(' '), ['allow-same-origin', 'allow-popups', 'allow-popups-to-escape-sandbox']);
});
test('邮件高度夹在120至6000，异常高度安全回退', () => {
  for (const [input, expected] of [[0, 120], [120.1, 121], [720, 720], [20000, 6000], [NaN, 120], [Infinity, 120]]) {
    assert.equal(clampEmailBodyHeight(input), expected);
  }
});
test('隔离文档的安全策略先于邮件样式，标题不能注入HTML', () => {
  const doc = buildIsolatedEmailDocument('<style>p{margin:99px}</style><p>hello</p>', '</title><script>alert(1)</script>', false);
  assert.ok(doc.indexOf('Content-Security-Policy') < doc.indexOf('p{margin:99px}'));
  assert.ok(!doc.includes('<script>'));
  assert.ok(doc.includes("script-src 'none'"));
  assert.ok(doc.includes("form-action 'none'"));
  assert.ok(doc.includes('name="referrer" content="no-referrer"'));
});
test('已发送邮件的CSP封锁远程资源，允许现有内嵌图片', () => {
  const blocked = buildIsolatedEmailDocument('', 'mail', true);
  const allowed = buildIsolatedEmailDocument('', 'mail', false);
  assert.ok(blocked.includes('img-src data: blob:;'));
  assert.ok(!blocked.includes('https:'));
  assert.ok(allowed.includes('img-src data: blob: https: http:;'));
});
test('编辑器只保留安全格式，不接受定位层级变量动画与CSS资源', () => {
  assert.ok(isSafeEditorStyle('color', 'red'));
  assert.ok(isSafeEditorStyle('border', '1px solid red'));
  for (const [name, value] of [['position', 'fixed'], ['z-index', '99999'], ['transform', 'scale(20)'], ['animation', 'grow 1s'], ['--color', 'red'], ['color', 'var(--primary)'], ['background-color', 'url(https://evil.test)'], ['font-family', '\\000061bc']]) {
    assert.equal(isSafeEditorStyle(name, value), false);
  }
});
test('编辑器拒绝执行协议及SVG文档，保留邮箱链接与内嵌图片', () => {
  assert.ok(isSafeEditorUrl('mailto:test@example.com'));
  assert.ok(isSafeEditorUrl('https://example.com'));
  assert.ok(isSafeEditorUrl('cid:product', true));
  assert.ok(isSafeEditorUrl('data:image/png;base64,AAAA', true));
  for (const url of ['javascript:alert(1)', 'data:text/html,test', '/api/account', 'data:image/svg+xml,<svg/>']) {
    assert.equal(isSafeEditorUrl(url, true), false);
    assert.equal(isSafeEditorUrl(url), false);
  }
});
