import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findPromptTemplateNameConflict,
  getPromptSaveIntent,
  hasPromptSectionChanges,
  updatePromptTemplateContent,
} from '../src/lib/prompt-template-settings';
import type { PromptTemplate } from '../src/lib/ai-prompts';

const builtIn: PromptTemplate = {
  id: 'builtin-draft',
  name: '内置起草',
  type: 'draft',
  content: '系统默认内容',
  builtIn: true,
};

const personal: PromptTemplate = {
  id: 'personal-draft',
  name: '我的起草',
  type: 'draft',
  content: '个人模板内容',
};

test('内置模板未修改时直接应用，修改后要求另存', () => {
  assert.equal(getPromptSaveIntent(builtIn, builtIn.content), 'apply');
  assert.equal(getPromptSaveIntent(builtIn, '修改后的内容'), 'save_as');
});

test('个人模板修改后更新原模板，未修改时直接应用', () => {
  assert.equal(getPromptSaveIntent(personal, personal.content), 'apply');
  assert.equal(getPromptSaveIntent(personal, '修改后的内容'), 'update');
});

test('未保存状态同时比较提示词内容和模板选择', () => {
  assert.equal(hasPromptSectionChanges({
    prompt: 'A', selectedTemplateId: '1', savedPrompt: 'A', savedTemplateId: '1',
  }), false);
  assert.equal(hasPromptSectionChanges({
    prompt: 'B', selectedTemplateId: '1', savedPrompt: 'A', savedTemplateId: '1',
  }), true);
  assert.equal(hasPromptSectionChanges({
    prompt: 'A', selectedTemplateId: '2', savedPrompt: 'A', savedTemplateId: '1',
  }), true);
});

test('模板名称冲突忽略大小写但仍限制在同一提示词类型', () => {
  const templates = [builtIn, personal];
  assert.equal(findPromptTemplateNameConflict(templates, 'draft', ' 我的起草 ')?.id, personal.id);
  assert.equal(findPromptTemplateNameConflict(templates, 'analysis', '我的起草'), undefined);
});

test('更新个人模板只改变目标模板内容', () => {
  const result = updatePromptTemplateContent([builtIn, personal], personal.id, '新内容');
  assert.equal(result[0].content, builtIn.content);
  assert.equal(result[1].content, '新内容');
});
