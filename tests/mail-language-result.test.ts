import test from 'node:test';
import assert from 'node:assert/strict';
import { detectReplyLanguage } from '../src/lib/email-language';
import { parseTranslationLanguage } from '../src/lib/translation-language-protocol';
import { readMailLanguage, saveMailLanguage } from '../src/lib/mail-language-result';

test('瑞典语中的 ä ö 不作为德语独有证据，弱证据保持待确认', () => {
  assert.equal(detectReplyLanguage('Hej Daniel, tack för ditt mejl. Jag skulle gärna testa. Mycket spännande och jag är intresserad.'), 'sv');
  assert.equal(detectReplyLanguage('ä ö ä ö'), '');
  assert.equal(detectReplyLanguage('hej kan med'), '');
});

test('流式翻译头跨任意分块不会进入译文，缺失头不冒充AI识别', () => {
  const content = '[LANG:sv]\n你好，丹尼尔。\n谢谢。';
  let emitted = '';
  for (let i = 1; i <= content.length; i++) {
    const next = parseTranslationLanguage(content.slice(0, i), false).translatedText;
    emitted += next.slice(emitted.length);
  }
  assert.equal(emitted, '你好，丹尼尔。\n谢谢。');
  assert.equal(parseTranslationLanguage(content).sourceLang, 'sv');
  assert.equal(parseTranslationLanguage('你好').sourceLang, 'auto');
  assert.equal(parseTranslationLanguage('[LANG:unknown]\n你好').sourceLang, 'auto');
});

test('语言结果隔离邮件、邮箱、账号和正文，并可重新读取', () => {
  const values = new Map<string, string>();
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try {
    saveMailLanguage('signed-out::gmail:a', 'm1', 'original', 'sv');
    assert.equal(readMailLanguage('signed-out::gmail:a', 'm1', 'original'), 'sv');
    assert.equal(readMailLanguage('signed-out::gmail:a', 'm2', 'original'), '');
    assert.equal(readMailLanguage('signed-out::tencent:a', 'm1', 'original'), '');
    assert.equal(readMailLanguage('other::gmail:a', 'm1', 'original'), '');
    assert.equal(readMailLanguage('signed-out::gmail:a', 'm1', 'changed'), '');
    saveMailLanguage('other::gmail:a', 'm1', 'original', 'de');
    assert.equal(readMailLanguage('other::gmail:a', 'm1', 'original'), '');
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
