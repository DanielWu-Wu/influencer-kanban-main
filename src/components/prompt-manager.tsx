'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FilePenLine,
  Languages,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  BUILT_IN_PROMPT_TEMPLATES,
  DEFAULT_ANALYSIS_PROMPT,
  DEFAULT_DRAFT_PROMPT,
  DEFAULT_TRANSLATE_PROMPT,
  type PromptTemplate,
  type PromptType,
} from '@/lib/ai-prompts';
import { generateId, useSettings } from '@/lib/data';

type PromptValues = Record<PromptType, string>;

const PROMPT_SECTIONS: Array<{
  type: PromptType;
  title: string;
  description: string;
  icon: typeof Languages;
  defaultValue: string;
  rows: number;
}> = [
  {
    type: 'translate',
    title: '邮件翻译提示词',
    description: '控制 AI 如何把外文邮件翻译成中文',
    icon: Languages,
    defaultValue: DEFAULT_TRANSLATE_PROMPT,
    rows: 9,
  },
  {
    type: 'analysis',
    title: '合作分析提示词',
    description: '控制 AI 如何判断红人意图、合作进度、风险和回复策略',
    icon: BarChart3,
    defaultValue: DEFAULT_ANALYSIS_PROMPT,
    rows: 13,
  },
  {
    type: 'draft',
    title: '邮件起草提示词',
    description: '控制 AI 如何根据你的想法起草正式回复',
    icon: FilePenLine,
    defaultValue: DEFAULT_DRAFT_PROMPT,
    rows: 13,
  },
];

export default function PromptManager() {
  const { settings, updateSettings, loading } = useSettings();
  const [prompts, setPrompts] = useState<PromptValues>({
    translate: DEFAULT_TRANSLATE_PROMPT,
    analysis: DEFAULT_ANALYSIS_PROMPT,
    draft: DEFAULT_DRAFT_PROMPT,
  });
  const [customTemplates, setCustomTemplates] = useState<PromptTemplate[]>([]);
  const [templateNames, setTemplateNames] = useState<Record<PromptType, string>>({
    translate: '',
    analysis: '',
    draft: '',
  });
  const [selectedTemplates, setSelectedTemplates] = useState<Record<PromptType, string>>({
    translate: 'builtin-translate-standard',
    analysis: 'builtin-analysis-youtube',
    draft: 'builtin-draft-business',
  });
  const [expandedSection, setExpandedSection] = useState<PromptType | null>('analysis');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loading) return;
    setPrompts({
      translate: settings.translatePrompt || DEFAULT_TRANSLATE_PROMPT,
      analysis: settings.aiAnalysisPrompt || DEFAULT_ANALYSIS_PROMPT,
      draft: settings.aiDraftPrompt || settings.aiEmailPrompt || DEFAULT_DRAFT_PROMPT,
    });
  }, [
    loading,
    settings.aiAnalysisPrompt,
    settings.aiDraftPrompt,
    settings.aiEmailPrompt,
    settings.translatePrompt,
  ]);

  useEffect(() => {
    if (!loading) setCustomTemplates(settings.promptTemplates || []);
  }, [loading, settings.promptTemplates]);

  const allTemplates = useMemo(
    () => [...BUILT_IN_PROMPT_TEMPLATES, ...customTemplates],
    [customTemplates],
  );

  const persistTemplates = (templates: PromptTemplate[]) => {
    setCustomTemplates(templates);
    updateSettings({ promptTemplates: templates });
  };

  const handleSaveAll = () => {
    updateSettings({
      translatePrompt: prompts.translate,
      aiAnalysisPrompt: prompts.analysis,
      aiDraftPrompt: prompts.draft,
      aiEmailPrompt: prompts.draft,
      promptTemplates: customTemplates,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2000);
  };

  const saveTemplate = (type: PromptType) => {
    const name = templateNames[type].trim();
    if (!name) {
      toast.error('请先填写模板名称');
      return;
    }
    const duplicate = customTemplates.find(
      (template) => template.type === type && template.name.toLowerCase() === name.toLowerCase(),
    );
    const nextTemplates = duplicate
      ? customTemplates.map((template) =>
          template.id === duplicate.id ? { ...template, content: prompts[type] } : template)
      : [
          ...customTemplates,
          { id: `prompt-${generateId()}`, name, type, content: prompts[type] },
        ];
    persistTemplates(nextTemplates);
    if (duplicate) setSelectedTemplates((current) => ({ ...current, [type]: duplicate.id }));
    else setSelectedTemplates((current) => ({
      ...current,
      [type]: nextTemplates[nextTemplates.length - 1].id,
    }));
    setTemplateNames((current) => ({ ...current, [type]: '' }));
    toast.success(duplicate ? '模板已更新' : '模板已保存');
  };

  const applyTemplate = (type: PromptType, templateId: string) => {
    setSelectedTemplates((current) => ({ ...current, [type]: templateId }));
    const template = allTemplates.find((item) => item.id === templateId);
    if (template) setPrompts((current) => ({ ...current, [type]: template.content }));
  };

  const deleteTemplate = (type: PromptType) => {
    const templateId = selectedTemplates[type];
    const template = customTemplates.find((item) => item.id === templateId);
    if (!template) {
      toast.error('内置模板不能删除');
      return;
    }
    persistTemplates(customTemplates.filter((item) => item.id !== templateId));
    const fallback = BUILT_IN_PROMPT_TEMPLATES.find((item) => item.type === type);
    if (fallback) {
      setSelectedTemplates((current) => ({ ...current, [type]: fallback.id }));
      setPrompts((current) => ({ ...current, [type]: fallback.content }));
    }
    toast.success('模板已删除');
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Toaster richColors position="top-center" />
      <div className="mb-4 flex shrink-0 items-center justify-between px-1">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5" />
            提示词管理
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            分别设置翻译、合作判断和邮件起草规则，并保存常用模板
          </p>
        </div>
        <Button onClick={handleSaveAll} size="sm" className="gap-1.5">
          {saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? '已保存' : '保存全部'}
        </Button>
      </div>

      <Separator className="mb-4 shrink-0" />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {PROMPT_SECTIONS.map((section) => {
          const Icon = section.icon;
          const expanded = expandedSection === section.type;
          const templates = allTemplates.filter((template) => template.type === section.type);
          const selected = allTemplates.find(
            (template) => template.id === selectedTemplates[section.type],
          );
          const modified = prompts[section.type] !== section.defaultValue;

          return (
            <Card key={section.type} className="overflow-hidden">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setExpandedSection(expanded ? null : section.type)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-base">{section.title}</CardTitle>
                        <CardDescription className="mt-0.5 text-xs">
                          {section.description}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {modified && <Badge variant="secondary">已修改</Badge>}
                      {expanded
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>
              </button>

              {expanded && (
                <CardContent className="space-y-4 pt-0">
                  <div className="rounded-md border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm font-medium">提示词模板</label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 text-muted-foreground"
                        onClick={() => setPrompts((current) => ({
                          ...current,
                          [section.type]: section.defaultValue,
                        }))}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        恢复默认
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <select
                        value={selectedTemplates[section.type]}
                        className="h-9 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
                        onChange={(event) => applyTemplate(section.type, event.target.value)}
                      >
                        {templates.map((template) => (
                          <option key={template.id} value={template.id}>
                            {template.builtIn ? `内置 · ${template.name}` : template.name}
                          </option>
                        ))}
                      </select>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-9 w-9"
                        title="删除当前自定义模板"
                        disabled={!selected || selected.builtIn}
                        onClick={() => deleteTemplate(section.type)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Input
                        value={templateNames[section.type]}
                        placeholder="输入新模板名称"
                        onChange={(event) => setTemplateNames((current) => ({
                          ...current,
                          [section.type]: event.target.value,
                        }))}
                      />
                      <Button
                        variant="outline"
                        className="shrink-0 gap-1.5"
                        onClick={() => saveTemplate(section.type)}
                      >
                        <Plus className="h-4 w-4" />
                        保存为模板
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      使用同名模板保存时会更新原模板；内置模板始终保留。
                    </p>
                  </div>

                  <Textarea
                    value={prompts[section.type]}
                    rows={section.rows}
                    className="resize-y font-mono text-sm leading-relaxed"
                    onChange={(event) => setPrompts((current) => ({
                      ...current,
                      [section.type]: event.target.value,
                    }))}
                    placeholder={`输入${section.title}...`}
                  />
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
