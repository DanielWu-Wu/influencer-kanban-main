import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAIProviderPreset,
  hasAIConfigErrors,
  inferAIProviderPreset,
  validateAIProviderConfig,
} from '../src/lib/ai-provider-config';

test('可根据旧配置地址自动识别模型服务商', () => {
  assert.equal(inferAIProviderPreset('https://api.deepseek.com/chat/completions'), 'deepseek');
  assert.equal(inferAIProviderPreset('https://api.openai.com/v1/chat/completions'), 'openai');
  assert.equal(inferAIProviderPreset('https://relay.example.com/v1/chat/completions'), 'custom');
});

test('选择官方服务时自动填充完整地址和推荐模型', () => {
  assert.deepEqual(
    applyAIProviderPreset('deepseek', '', '', 'custom'),
    {
      apiUrl: 'https://api.deepseek.com/chat/completions',
      modelName: 'deepseek-v4-flash',
    },
  );
});

test('同一服务商重新选择时保留有效的人工模型选择', () => {
  assert.equal(
    applyAIProviderPreset(
      'deepseek',
      'https://api.deepseek.com/chat/completions',
      'deepseek-v4-pro',
      'deepseek',
    ).modelName,
    'deepseek-v4-pro',
  );
});

test('自定义接口不会被官方预设静默覆盖', () => {
  assert.deepEqual(
    applyAIProviderPreset(
      'custom',
      'https://relay.example.com/v1/chat/completions',
      'relay-model',
      'deepseek',
    ),
    {
      apiUrl: 'https://relay.example.com/v1/chat/completions',
      modelName: 'relay-model',
    },
  );
});

test('校验完整请求地址、密钥和模型名称', () => {
  const errors = validateAIProviderConfig({
    apiUrl: 'https://api.example.com/v1',
    modelName: 'bad model',
    hasApiKey: false,
  });

  assert.equal(hasAIConfigErrors(errors), true);
  assert.match(errors.apiUrl || '', /chat\/completions/);
  assert.match(errors.apiKey || '', /API Key/);
  assert.match(errors.modelName || '', /空格/);
});

test('允许 localhost 使用 HTTP 进行本机调试', () => {
  assert.deepEqual(
    validateAIProviderConfig({
      apiUrl: 'http://localhost:11434/v1/chat/completions',
      modelName: 'local-model',
      hasApiKey: true,
    }),
    {},
  );
});

