import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canApplyEmailTranslationResult,
  canApplyRestoredEmailTranslationResult,
  isEmailTranslationRetryInput,
  isEmailTranslationTaskRestorableForContext,
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

test('从进度记录精确恢复时采用任务内的新中文和外文，而不是页面初版中文', () => {
  assert.equal(canApplyRestoredEmailTranslationResult({
    result,
    chineseBody: '这是页面刚恢复出来的初版中文。',
    targetLang: 'es',
    restoringRequestedTask: true,
    localDraftDirty: false,
  }), true);
});

test('打开进度记录后如果用户又编辑了正文，迟到结果仍不能覆盖人工修改', () => {
  assert.equal(canApplyRestoredEmailTranslationResult({
    result,
    chineseBody: '这是用户后来再次修改的中文。',
    targetLang: 'es',
    restoringRequestedTask: true,
    localDraftDirty: true,
  }), false);
});

test('从进度记录打开时只允许恢复同邮箱、同线程和同回复方式的翻译任务', () => {
  const task = {
    kind: 'email_translation',
    key: 'email_translation:thread-v2:ai:thread-1:message-1',
    provider: 'gmail',
    mailAccountId: 'gmail:owner@example.com',
    result,
  };
  const context = {
    key: task.key,
    provider: 'gmail' as const,
    mailAccountId: task.mailAccountId,
    source: 'gmail_ai_reply' as const,
  };

  assert.equal(isEmailTranslationTaskRestorableForContext(task, context), true);
  assert.equal(isEmailTranslationTaskRestorableForContext(
    { ...task, mailAccountId: 'gmail:other@example.com' },
    context,
  ), false);
  assert.equal(isEmailTranslationTaskRestorableForContext(
    { ...task, key: 'email_translation:thread-v2:ai:thread-2:message-1' },
    context,
  ), false);
  assert.equal(isEmailTranslationTaskRestorableForContext(task, {
    ...context,
    source: 'gmail_template_reply',
  }), false);
});

test('腾讯翻译任务运行中也可通过受限重试输入校验恢复上下文', () => {
  const task = {
    kind: 'email_translation',
    key: 'email_translation:thread-v2:tencent-1:template:thread-1:message-1',
    provider: 'tencent_exmail',
    mailAccountId: 'tencent-1',
    retryInput: {
      operation: 'translate_chinese_to_foreign',
      source: 'tencent_template_reply',
      chineseBody: '请确认发布时间。',
      targetLang: 'es',
      targetLangName: '西班牙语',
    },
  };

  assert.equal(isEmailTranslationTaskRestorableForContext(task, {
    key: task.key,
    provider: 'tencent_exmail',
    mailAccountId: task.mailAccountId,
    source: 'tencent_template_reply',
  }), true);

  const aiReplyTask = {
    ...task,
    key: 'email_translation:thread-v2:tencent-1:ai:thread-1:message-1',
    retryInput: {
      ...task.retryInput,
      source: 'tencent_ai_reply',
    },
  };
  assert.equal(isEmailTranslationTaskRestorableForContext(aiReplyTask, {
    key: aiReplyTask.key,
    provider: 'tencent_exmail',
    mailAccountId: aiReplyTask.mailAccountId,
    source: 'tencent_ai_reply',
  }), true);
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
