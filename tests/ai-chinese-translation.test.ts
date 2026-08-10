import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStreamingJsonString,
  validateChineseTranslation,
} from '../src/lib/ai-chinese-translation';

test('接受包含产品名、型号和邮箱的完整中文对照', () => {
  const result = validateChineseTranslation(
    'Hi Carlos, we recently launched a portable solar panel. Would you be interested?',
    '你好，Carlos。我们最近推出了一款便携式太阳能板。你有兴趣在频道中介绍这款产品吗？联系邮箱仍为 edc4kmail@gmail.com。',
  );
  assert.equal(result.valid, true);
});

test('拒绝直接复制的英文原文和中文占比过低的结果', () => {
  const source = 'Hi Carlos, we recently launched a portable solar panel. Would you be interested?';
  assert.equal(validateChineseTranslation(source, source).valid, false);
  assert.equal(validateChineseTranslation(source, `中文：${source}`).valid, false);
});

test('流式提取 translatedReply 并正确处理换行和 Unicode 转义', () => {
  const partial = extractStreamingJsonString(
    '{"translatedReply":"你好，Carlos。\\n我们推出了\\u4e00\\u6b3e',
    'translatedReply',
  );
  assert.equal(partial.found, true);
  assert.equal(partial.complete, false);
  assert.equal(partial.value, '你好，Carlos。\n我们推出了一款');

  const complete = extractStreamingJsonString(
    '{"translatedReply":"你好，Carlos。\\n我们推出了一款产品。","keyPoints":[]}',
    'translatedReply',
  );
  assert.equal(complete.complete, true);
  assert.equal(complete.value, '你好，Carlos。\n我们推出了一款产品。');
});
