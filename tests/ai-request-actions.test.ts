import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_CONNECTION_TEST_ACTION,
  requiresMailThreadContext,
} from '../src/lib/ai-request-actions';

test('正式邮件 AI 动作必须保留真实邮箱会话校验', () => {
  for (const action of ['analyze', 'draft', 'optimizeDraft', 'templateDraft']) {
    assert.equal(requiresMailThreadContext(action), true, action);
  }
});

test('模型连接测试不依赖 Gmail 或腾讯企业邮箱会话', () => {
  assert.equal(AI_CONNECTION_TEST_ACTION, 'testConnection');
  assert.equal(requiresMailThreadContext(AI_CONNECTION_TEST_ACTION), false);
});
