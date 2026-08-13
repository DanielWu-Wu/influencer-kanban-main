import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isGmailBilingualDraftForeignEdited,
  isGmailBilingualDraftTranslationCurrent,
} from '../src/lib/gmail-bilingual-draft';

const snapshot = {
  foreignBody: '<p>Hello creator</p>',
  chineseBody: '你好，创作者',
  targetLanguage: 'en',
};

test('AI 同时生成的外文和中文可直接视为同步草稿', () => {
  assert.equal(isGmailBilingualDraftTranslationCurrent({
    snapshot,
    chineseBody: snapshot.chineseBody,
    targetLanguage: snapshot.targetLanguage,
  }), true);
});

test('修改中文或目标语言会让翻译依据进入待更新状态', () => {
  assert.equal(isGmailBilingualDraftTranslationCurrent({
    snapshot,
    chineseBody: '你好，创作者！',
    targetLanguage: snapshot.targetLanguage,
  }), false);
  assert.equal(isGmailBilingualDraftTranslationCurrent({
    snapshot,
    chineseBody: snapshot.chineseBody,
    targetLanguage: 'es',
  }), false);
});

test('外文人工润色不会让中文翻译依据失效', () => {
  assert.equal(isGmailBilingualDraftTranslationCurrent({
    snapshot,
    chineseBody: snapshot.chineseBody,
    targetLanguage: snapshot.targetLanguage,
  }), true);
  assert.equal(isGmailBilingualDraftForeignEdited({
    snapshot,
    foreignBody: '<p>Hello creator 😊</p>',
  }), true);
});

test('只调整正文首尾空白不会被误判为人工润色', () => {
  assert.equal(isGmailBilingualDraftTranslationCurrent({
    snapshot,
    chineseBody: `\n${snapshot.chineseBody}  `,
    targetLanguage: snapshot.targetLanguage,
  }), true);
  assert.equal(isGmailBilingualDraftForeignEdited({
    snapshot,
    foreignBody: `  ${snapshot.foreignBody}\n`,
  }), false);
});
