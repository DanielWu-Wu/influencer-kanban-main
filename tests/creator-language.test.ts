import assert from 'node:assert/strict';
import test from 'node:test';
import { inferLanguage, migrateProspects } from '../src/lib/creator-prospecting';

test('乌克兰语简介不会因为邮箱域名 com 被误判为葡萄牙语', () => {
  assert.equal(inferLanguage({
    title: 'Едельвейс тест',
    description: 'gesser9@gmail.com Україна понад усе. Огляд та тести павербанків та іншої електроніки.',
    recentVideos: [],
    country: 'UA',
  }), 'uk');
});

test('文本不足时使用乌克兰国家代码作为乌克兰语兜底', () => {
  assert.equal(inferLanguage({
    title: 'Tech channel',
    description: 'contact@example.com https://example.com',
    recentVideos: [],
    country: 'UA',
  }), 'uk');
});

test('明确的葡萄牙语文本仍优先于国家兜底', () => {
  assert.equal(inferLanguage({
    title: 'Canal de viagens',
    description: 'Uma viagem de carro para você. Obrigado!',
    recentVideos: [],
    country: 'UA',
  }), 'pt');
});

test('加载时修复此前由 com 造成的葡萄牙语缓存误判', () => {
  const [prospect] = migrateProspects([{
    schemaVersion: 6,
    id: 'ua-channel',
    inputUrl: 'https://www.youtube.com/@ua-channel',
    title: 'Едельвейс тест',
    description: 'contact@gmail.com Україна понад усе.',
    country: 'UA',
    language: 'pt',
    languageSource: 'inferred',
    outreachLanguage: 'pt',
    outreachLanguageSource: 'ai',
    outreachLanguageInferenceStatus: 'found',
    workflowStatus: 'invitation_pending',
    emailStatus: 'available',
    dedupeStatus: 'unique',
    resourceStatus: 'exists',
    developmentStatus: 'exists',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }]);

  assert.equal(prospect.language, 'uk');
  assert.equal(prospect.languageSource, 'inferred');
  assert.equal(prospect.outreachLanguage, 'uk');
  assert.equal(prospect.outreachLanguageSource, undefined);
  assert.equal(prospect.outreachLanguageInferenceStatus, undefined);
});

test('加载时不覆盖人工选择的语言', () => {
  const [prospect] = migrateProspects([{
    schemaVersion: 6,
    id: 'manual-language',
    inputUrl: 'https://www.youtube.com/@manual-language',
    description: 'Україна понад усе.',
    country: 'UA',
    language: 'pt',
    languageSource: 'manual',
    workflowStatus: 'invitation_pending',
    emailStatus: 'available',
    dedupeStatus: 'unique',
    resourceStatus: 'exists',
    developmentStatus: 'exists',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }]);

  assert.equal(prospect.language, 'pt');
  assert.equal(prospect.languageSource, 'manual');
});
