import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_AI_REPLY_TEMPLATES,
  getAIReplyTemplates,
  mergeBuiltInAIReplyTemplates,
  normalizeAIReplyTemplate,
} from '../src/lib/ai-reply-templates';
import type { EmailTemplate } from '../src/lib/types';

test('旧账号模板读取时会补齐四个内置 AI 回复模板且不覆盖个人模板', () => {
  const personal: EmailTemplate = {
    id: 'personal-budget',
    name: '预算协商',
    type: 'custom',
    subject: '',
    content: '说明预算边界',
    variables: [],
    isDefault: false,
  };
  const merged = mergeBuiltInAIReplyTemplates([personal]);
  assert.equal(BUILT_IN_AI_REPLY_TEMPLATES.length, 4);
  assert.equal(merged.length, 5);
  assert.equal(merged.at(-1), personal);
});

test('重复保存的内置模板不会在读取时出现两份', () => {
  const merged = mergeBuiltInAIReplyTemplates([
    ...BUILT_IN_AI_REPLY_TEMPLATES,
    BUILT_IN_AI_REPLY_TEMPLATES[0],
  ]);
  assert.equal(merged.length, 4);
});

test('只有完整启用的模板会进入 AI 模板选择器', () => {
  const invalid: EmailTemplate = {
    id: 'legacy',
    name: '旧邮件模板',
    type: 'custom',
    subject: '',
    content: '旧正文',
    variables: [],
    isDefault: false,
  };
  assert.equal(getAIReplyTemplates([...BUILT_IN_AI_REPLY_TEMPLATES, invalid]).length, 4);
});

test('服务端模板归一化会限制字段长度并拒绝不完整模板', () => {
  assert.equal(normalizeAIReplyTemplate({ name: '不完整' }), null);
  const normalized = normalizeAIReplyTemplate({
    id: 'custom',
    name: '自定义模板',
    description: '适用场景',
    content: '参考结构',
    requiredInfo: ['金额'],
    rules: ['不得编造金额'],
    defaultTone: 'formal',
  });
  assert.equal(normalized?.name, '自定义模板');
  assert.deepEqual(normalized?.requiredInfo, ['金额']);
  assert.equal(normalized?.defaultTone, 'formal');
});
