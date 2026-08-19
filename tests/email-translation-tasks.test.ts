import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canApplyEmailTranslationResult,
  isEmailTranslationRetryInput,
  isEmailTranslationTaskResult,
} from '../src/lib/email-translation-tasks';

const result = {
  source: 'gmail_ai_reply' as const,
  chineseBody: '  请确认发布时间。  ',
  targetLang: 'es',
  targetLangName: '西班牙语',
  foreignBody: 'Confirma la fecha de publicación, por favor.',
};

test('中文只改变首尾空格时仍可应用翻译结果', () => {
  assert.equal(canApplyEmailTranslationResult({
    result,
    chineseBody: '请确认发布时间。',
    targetLang: 'es',
  }), true);
});

test('中文正文变化时拒绝旧翻译结果', () => {
  assert.equal(canApplyEmailTranslationResult({
    result,
    chineseBody: '请确认视频发布时间。',
    targetLang: 'es',
  }), false);
});

test('目标语言变化时拒绝旧翻译结果', () => {
  assert.equal(canApplyEmailTranslationResult({
    result,
    chineseBody: '请确认发布时间。',
    targetLang: 'en',
  }), false);
});

test('翻译任务输入和结果使用受限的可恢复结构', () => {
  assert.equal(isEmailTranslationRetryInput({
    operation: 'translate_chinese_to_foreign',
    source: 'outreach_email',
    chineseBody: '请确认收货地址。',
    targetLang: 'nl',
    targetLangName: '荷兰语',
  }), true);
  assert.equal(isEmailTranslationTaskResult(result), true);
  assert.equal(isEmailTranslationRetryInput({ operation: 'translate_chinese_to_foreign', chineseBody: 'x' }), false);
});
