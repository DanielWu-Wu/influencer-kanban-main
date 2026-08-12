import test from 'node:test';
import assert from 'node:assert/strict';
import { isGmailBilingualDraftSynchronized } from '../src/lib/gmail-bilingual-draft';

const snapshot = {
  foreignBody: '<p>Hello creator</p>',
  chineseBody: '你好，创作者',
  targetLanguage: 'en',
};

test('AI 同时生成的外文和中文可直接视为同步草稿', () => {
  assert.equal(isGmailBilingualDraftSynchronized({
    snapshot,
    foreignBody: snapshot.foreignBody,
    chineseBody: snapshot.chineseBody,
    targetLanguage: snapshot.targetLanguage,
  }), true);
});

test('修改中文、外文或目标语言都会让草稿进入待同步状态', () => {
  assert.equal(isGmailBilingualDraftSynchronized({
    snapshot,
    foreignBody: snapshot.foreignBody,
    chineseBody: '你好，创作者！',
    targetLanguage: snapshot.targetLanguage,
  }), false);
  assert.equal(isGmailBilingualDraftSynchronized({
    snapshot,
    foreignBody: '<p>Hello creator!</p>',
    chineseBody: snapshot.chineseBody,
    targetLanguage: snapshot.targetLanguage,
  }), false);
  assert.equal(isGmailBilingualDraftSynchronized({
    snapshot,
    foreignBody: snapshot.foreignBody,
    chineseBody: snapshot.chineseBody,
    targetLanguage: 'es',
  }), false);
});

test('只打开中文编辑器或修改后恢复原文不会制造虚假的未同步状态', () => {
  assert.equal(isGmailBilingualDraftSynchronized({
    snapshot,
    foreignBody: `  ${snapshot.foreignBody}\n`,
    chineseBody: `\n${snapshot.chineseBody}  `,
    targetLanguage: snapshot.targetLanguage,
  }), true);
});
