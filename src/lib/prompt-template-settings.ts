import type { PromptTemplate, PromptType } from './ai-prompts';

export type PromptSaveIntent = 'apply' | 'save_as' | 'update';

export function hasPromptSectionChanges({
  prompt,
  selectedTemplateId,
  savedPrompt,
  savedTemplateId,
}: {
  prompt: string;
  selectedTemplateId: string;
  savedPrompt: string;
  savedTemplateId: string;
}) {
  return prompt !== savedPrompt || selectedTemplateId !== savedTemplateId;
}

export function getPromptSaveIntent(
  selectedTemplate: PromptTemplate | undefined,
  prompt: string,
): PromptSaveIntent {
  if (!selectedTemplate || selectedTemplate.builtIn) {
    return selectedTemplate && prompt === selectedTemplate.content ? 'apply' : 'save_as';
  }
  return prompt === selectedTemplate.content ? 'apply' : 'update';
}

export function findPromptTemplateNameConflict(
  templates: PromptTemplate[],
  type: PromptType,
  name: string,
) {
  const normalized = name.trim().toLocaleLowerCase();
  if (!normalized) return undefined;
  return templates.find((template) => (
    template.type === type && template.name.trim().toLocaleLowerCase() === normalized
  ));
}

export function updatePromptTemplateContent(
  templates: PromptTemplate[],
  templateId: string,
  content: string,
) {
  return templates.map((template) => (
    template.id === templateId ? { ...template, content } : template
  ));
}
