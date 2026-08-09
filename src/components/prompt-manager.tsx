'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BadgePercent,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FilePenLine,
  Languages,
  Lightbulb,
  MailCheck,
  MailPlus,
  PackageCheck,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast, Toaster } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  BUILT_IN_PROMPT_TEMPLATES,
  DEFAULT_ANALYSIS_PROMPT,
  DEFAULT_COOPERATION_IDEA_PROMPT,
  DEFAULT_DISCOUNT_NOTICE_PROMPT,
  DEFAULT_DRAFT_PROMPT,
  DEFAULT_LOGISTICS_NOTICE_PROMPT,
  DEFAULT_OUTREACH_PROMPT,
  DEFAULT_OUTREACH_FOLLOW_UP_1_PROMPT,
  DEFAULT_OUTREACH_FOLLOW_UP_2_PROMPT,
  DEFAULT_TRANSLATE_PROMPT,
  type PromptTemplate,
  type PromptType,
} from '@/lib/ai-prompts';
import { generateId, useSettings, type AppSettings } from '@/lib/data';
import {
  findPromptTemplateNameConflict,
  getPromptSaveIntent,
  hasPromptSectionChanges,
  updatePromptTemplateContent,
} from '@/lib/prompt-template-settings';

type PromptValues = Record<PromptType, string>;

type PromptManagerMode = 'general' | 'drafting';

const PAGE_CONFIG: Record<PromptManagerMode, {
  title: string;
  description: string;
  sectionTypes: PromptType[];
}> = {
  general: {
    title: '提示词管理',
    description: '设置邮件翻译、合作分析和红人合作想法规则，并保存常用模板',
    sectionTypes: ['translate', 'analysis', 'cooperationIdea'],
  },
  drafting: {
    title: 'AI 起草邮件提示词',
    description: '统一管理邮件回复、开发信跟进、物流和折扣告知的起草规则',
    sectionTypes: [
      'draft',
      'outreach',
      'outreachFollowUp1',
      'outreachFollowUp2',
      'logisticsNotice',
      'discountNotice',
    ],
  },
};

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
    type: 'cooperationIdea',
    title: '红人合作想法提示词',
    description: '控制 AI 如何结合频道、产品和合作形式生成合作切入建议',
    icon: Lightbulb,
    defaultValue: DEFAULT_COOPERATION_IDEA_PROMPT,
    rows: 12,
  },
  {
    type: 'draft',
    title: '邮件起草提示词',
    description: '控制 AI 如何根据你的想法起草正式回复',
    icon: FilePenLine,
    defaultValue: DEFAULT_DRAFT_PROMPT,
    rows: 13,
  },
  {
    type: 'outreach',
    title: '冷开发信生成提示词',
    description: '控制 AI 如何根据 YouTube 频道资料生成个性化首次开发信',
    icon: MailPlus,
    defaultValue: DEFAULT_OUTREACH_PROMPT,
    rows: 13,
  },
  {
    type: 'outreachFollowUp1',
    title: '开发信一次Follow Up提示词',
    description: '控制 AI 如何在首次开发信未回复时进行第一次自然跟进',
    icon: MailCheck,
    defaultValue: DEFAULT_OUTREACH_FOLLOW_UP_1_PROMPT,
    rows: 12,
  },
  {
    type: 'outreachFollowUp2',
    title: '开发信二次Follow Up提示词',
    description: '控制 AI 如何在仍未回复时进行克制、礼貌的第二次跟进',
    icon: Clock3,
    defaultValue: DEFAULT_OUTREACH_FOLLOW_UP_2_PROMPT,
    rows: 12,
  },
  {
    type: 'logisticsNotice',
    title: '红人包裹物流告知提示词',
    description: '控制 AI 如何告知承运商、物流单号和预计送达信息',
    icon: PackageCheck,
    defaultValue: DEFAULT_LOGISTICS_NOTICE_PROMPT,
    rows: 12,
  },
  {
    type: 'discountNotice',
    title: '红人折扣信息告知提示词',
    description: '控制 AI 如何说明折扣码、适用范围和使用规则',
    icon: BadgePercent,
    defaultValue: DEFAULT_DISCOUNT_NOTICE_PROMPT,
    rows: 12,
  },
];

const initialPrompts: PromptValues = {
  translate: DEFAULT_TRANSLATE_PROMPT,
  analysis: DEFAULT_ANALYSIS_PROMPT,
  cooperationIdea: DEFAULT_COOPERATION_IDEA_PROMPT,
  draft: DEFAULT_DRAFT_PROMPT,
  outreach: DEFAULT_OUTREACH_PROMPT,
  outreachFollowUp1: DEFAULT_OUTREACH_FOLLOW_UP_1_PROMPT,
  outreachFollowUp2: DEFAULT_OUTREACH_FOLLOW_UP_2_PROMPT,
  logisticsNotice: DEFAULT_LOGISTICS_NOTICE_PROMPT,
  discountNotice: DEFAULT_DISCOUNT_NOTICE_PROMPT,
};

const DEFAULT_SELECTED_PROMPT_TEMPLATES: Record<PromptType, string> = {
  translate: 'builtin-translate-standard',
  analysis: 'builtin-analysis-youtube',
  cooperationIdea: 'builtin-cooperation-idea-youtube',
  draft: 'builtin-draft-business',
  outreach: 'builtin-outreach-youtube',
  outreachFollowUp1: 'builtin-outreach-follow-up-1',
  outreachFollowUp2: 'builtin-outreach-follow-up-2',
  logisticsNotice: 'builtin-logistics-notice',
  discountNotice: 'builtin-discount-notice',
};

function getSavedPromptValues(settings: AppSettings): PromptValues {
  return {
    translate: settings.translatePrompt || DEFAULT_TRANSLATE_PROMPT,
    analysis: settings.aiAnalysisPrompt || DEFAULT_ANALYSIS_PROMPT,
    cooperationIdea:
      settings.aiCooperationIdeaPrompt || DEFAULT_COOPERATION_IDEA_PROMPT,
    draft: settings.aiDraftPrompt || settings.aiEmailPrompt || DEFAULT_DRAFT_PROMPT,
    outreach: settings.aiOutreachPrompt || DEFAULT_OUTREACH_PROMPT,
    outreachFollowUp1:
      settings.aiOutreachFollowUp1Prompt || DEFAULT_OUTREACH_FOLLOW_UP_1_PROMPT,
    outreachFollowUp2:
      settings.aiOutreachFollowUp2Prompt || DEFAULT_OUTREACH_FOLLOW_UP_2_PROMPT,
    logisticsNotice: settings.aiLogisticsNoticePrompt || DEFAULT_LOGISTICS_NOTICE_PROMPT,
    discountNotice: settings.aiDiscountNoticePrompt || DEFAULT_DISCOUNT_NOTICE_PROMPT,
  };
}

function getPromptSettingsPatch(type: PromptType, content: string): Partial<AppSettings> {
  if (type === 'translate') return { translatePrompt: content };
  if (type === 'analysis') return { aiAnalysisPrompt: content };
  if (type === 'cooperationIdea') return { aiCooperationIdeaPrompt: content };
  if (type === 'draft') return { aiDraftPrompt: content, aiEmailPrompt: content };
  if (type === 'outreach') return { aiOutreachPrompt: content };
  if (type === 'outreachFollowUp1') return { aiOutreachFollowUp1Prompt: content };
  if (type === 'outreachFollowUp2') return { aiOutreachFollowUp2Prompt: content };
  if (type === 'logisticsNotice') return { aiLogisticsNoticePrompt: content };
  return { aiDiscountNoticePrompt: content };
}

export default function PromptManager({ mode = 'general' }: { mode?: PromptManagerMode }) {
  const pageConfig = PAGE_CONFIG[mode];
  const { settings, updateSettings, saveSettings, loading } = useSettings();
  const [prompts, setPrompts] = useState<PromptValues>(initialPrompts);
  const [savedPrompts, setSavedPrompts] = useState<PromptValues>(initialPrompts);
  const [customTemplates, setCustomTemplates] = useState<PromptTemplate[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<Record<PromptType, string>>(
    () => ({ ...DEFAULT_SELECTED_PROMPT_TEMPLATES }),
  );
  const [savedSelectedTemplates, setSavedSelectedTemplates] = useState<Record<PromptType, string>>(
    () => ({ ...DEFAULT_SELECTED_PROMPT_TEMPLATES }),
  );
  const promptsHydratedRef = useRef(false);
  const selectedTemplatesHydratedRef = useRef(false);
  const [expandedSection, setExpandedSection] = useState<PromptType | null>(null);
  const [savingType, setSavingType] = useState<PromptType | null>(null);
  const [saveErrors, setSaveErrors] = useState<Partial<Record<PromptType, string>>>({});
  const [saveAsType, setSaveAsType] = useState<PromptType | null>(null);
  const [saveAsName, setSaveAsName] = useState('');
  const [saveAsError, setSaveAsError] = useState('');
  const [pendingTemplateChange, setPendingTemplateChange] = useState<{
    type: PromptType;
    templateId: string;
  } | null>(null);
  const [deleteType, setDeleteType] = useState<PromptType | null>(null);

  useEffect(() => {
    if (loading || promptsHydratedRef.current) return;
    const savedValues = getSavedPromptValues(settings);
    setPrompts(savedValues);
    setSavedPrompts(savedValues);
    promptsHydratedRef.current = true;
  }, [loading, settings]);

  useEffect(() => {
    if (!loading) setCustomTemplates(settings.promptTemplates || []);
  }, [loading, settings.promptTemplates]);

  useEffect(() => {
    if (loading || selectedTemplatesHydratedRef.current) return;
    const availableTemplates = [
      ...BUILT_IN_PROMPT_TEMPLATES,
      ...(settings.promptTemplates || []),
    ];
    const savedSelections = settings.selectedPromptTemplates || {};
    const savedPromptValues = getSavedPromptValues(settings);
    const restoredSelections = { ...DEFAULT_SELECTED_PROMPT_TEMPLATES };

    for (const type of Object.keys(restoredSelections) as PromptType[]) {
      const savedTemplateId = savedSelections[type];
      const savedTemplateExists = savedTemplateId && availableTemplates.some(
        (template) => template.id === savedTemplateId && template.type === type,
      );
      if (savedTemplateExists && savedTemplateId) {
        restoredSelections[type] = savedTemplateId;
        continue;
      }
      const contentMatchedTemplate = availableTemplates.find(
        (template) =>
          template.type === type
          && template.content.trim() === savedPromptValues[type].trim(),
      );
      if (contentMatchedTemplate) {
        restoredSelections[type] = contentMatchedTemplate.id;
      }
    }

    setSelectedTemplates(restoredSelections);
    setSavedSelectedTemplates(restoredSelections);
    selectedTemplatesHydratedRef.current = true;
    const selectionNeedsMigration = (Object.keys(restoredSelections) as PromptType[])
      .some((type) => savedSelections[type] !== restoredSelections[type]);
    if (selectionNeedsMigration) {
      updateSettings({ selectedPromptTemplates: restoredSelections });
    }
  }, [loading, settings, updateSettings]);

  const allTemplates = useMemo(
    () => [...BUILT_IN_PROMPT_TEMPLATES, ...customTemplates],
    [customTemplates],
  );

  const sectionHasChanges = (type: PromptType) => hasPromptSectionChanges({
    prompt: prompts[type],
    selectedTemplateId: selectedTemplates[type],
    savedPrompt: savedPrompts[type],
    savedTemplateId: savedSelectedTemplates[type],
  });

  const applyTemplate = (type: PromptType, templateId: string) => {
    setSelectedTemplates((current) => ({ ...current, [type]: templateId }));
    const template = allTemplates.find((item) => item.id === templateId);
    if (template) setPrompts((current) => ({ ...current, [type]: template.content }));
    setSaveErrors((current) => ({ ...current, [type]: '' }));
  };

  const requestTemplateChange = (type: PromptType, templateId: string) => {
    if (sectionHasChanges(type)) {
      setPendingTemplateChange({ type, templateId });
      return;
    }
    applyTemplate(type, templateId);
  };

  const persistSection = async ({
    type,
    content,
    templateId,
    nextTemplates = customTemplates,
    successMessage,
  }: {
    type: PromptType;
    content: string;
    templateId: string;
    nextTemplates?: PromptTemplate[];
    successMessage: string;
  }) => {
    const nextSelections = { ...savedSelectedTemplates, [type]: templateId };
    setSavingType(type);
    setSaveErrors((current) => ({ ...current, [type]: '' }));
    try {
      await saveSettings({
        ...getPromptSettingsPatch(type, content),
        promptTemplates: nextTemplates,
        selectedPromptTemplates: nextSelections,
      });
      setCustomTemplates(nextTemplates);
      setPrompts((current) => ({ ...current, [type]: content }));
      setSavedPrompts((current) => ({ ...current, [type]: content }));
      setSelectedTemplates((current) => ({ ...current, [type]: templateId }));
      setSavedSelectedTemplates(nextSelections);
      toast.success(successMessage);
      return true;
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '提示词保存失败，请重试。';
      setSaveErrors((current) => ({ ...current, [type]: message }));
      toast.error(message);
      return false;
    } finally {
      setSavingType(null);
    }
  };

  const openSaveAs = (type: PromptType) => {
    const selected = allTemplates.find((template) => template.id === selectedTemplates[type]);
    setSaveAsType(type);
    setSaveAsName(selected
      ? `${selected.name}${selected.builtIn ? '（个人版）' : '（副本）'}`
      : '我的提示词模板');
    setSaveAsError('');
  };

  const saveAsNewTemplate = async () => {
    if (!saveAsType) return;
    const name = saveAsName.trim();
    if (!name) {
      setSaveAsError('请填写模板名称。');
      return;
    }
    if (!prompts[saveAsType].trim()) {
      setSaveAsError('提示词内容不能为空。');
      return;
    }
    if (findPromptTemplateNameConflict(allTemplates, saveAsType, name)) {
      setSaveAsError('该类型下已经存在同名模板，请换一个名称。');
      return;
    }
    const template: PromptTemplate = {
      id: `prompt-${generateId()}`,
      name,
      type: saveAsType,
      content: prompts[saveAsType],
    };
    const saved = await persistSection({
      type: saveAsType,
      content: template.content,
      templateId: template.id,
      nextTemplates: [...customTemplates, template],
      successMessage: '新模板已保存并应用。',
    });
    if (saved) {
      setSaveAsType(null);
      setSaveAsName('');
      setSaveAsError('');
    }
  };

  const saveAndApply = async (type: PromptType) => {
    const content = prompts[type];
    if (!content.trim()) {
      setSaveErrors((current) => ({ ...current, [type]: '提示词内容不能为空。' }));
      return;
    }
    const selected = allTemplates.find((template) => template.id === selectedTemplates[type]);
    const intent = getPromptSaveIntent(selected, content);
    if (intent === 'save_as') {
      openSaveAs(type);
      return;
    }
    const nextTemplates = intent === 'update' && selected
      ? updatePromptTemplateContent(customTemplates, selected.id, content)
      : customTemplates;
    await persistSection({
      type,
      content,
      templateId: selected?.id || DEFAULT_SELECTED_PROMPT_TEMPLATES[type],
      nextTemplates,
      successMessage: intent === 'update' ? '个人模板已更新并应用。' : '提示词已保存并生效。',
    });
  };

  const deleteTemplate = async (type: PromptType) => {
    const templateId = selectedTemplates[type];
    const template = customTemplates.find((item) => item.id === templateId);
    if (!template) return;
    const nextTemplates = customTemplates.filter((item) => item.id !== templateId);
    const fallback = BUILT_IN_PROMPT_TEMPLATES.find((item) => item.type === type);
    if (!fallback) return;
    const saved = await persistSection({
      type,
      content: fallback.content,
      templateId: fallback.id,
      nextTemplates,
      successMessage: '个人模板已删除，系统默认提示词已生效。',
    });
    if (saved) setDeleteType(null);
  };

  const unsavedCount = pageConfig.sectionTypes.filter((type) => {
    const selected = allTemplates.find((template) => template.id === selectedTemplates[type]);
    return sectionHasChanges(type) || getPromptSaveIntent(selected, prompts[type]) !== 'apply';
  }).length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Toaster richColors position="top-center" />
      <div className="material-toolbar mb-4 flex shrink-0 items-center justify-between rounded-xl border border-border/50 px-4 py-3 shadow-[var(--glass-shadow-soft)]">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Sparkles className="h-5 w-5" />
            {pageConfig.title}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pageConfig.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unsavedCount > 0 ? (
            <Badge variant="secondary">{unsavedCount} 项待处理</Badge>
          ) : (
            <Badge variant="outline"><CheckCircle2 />全部已保存</Badge>
          )}
          <p className="hidden text-xs text-muted-foreground lg:block">请在每一项内保存并生效</p>
        </div>
      </div>

      <Separator className="mb-4 shrink-0 bg-white/60" />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {PROMPT_SECTIONS.filter((section) => pageConfig.sectionTypes.includes(section.type)).map((section) => {
          const Icon = section.icon;
          const expanded = expandedSection === section.type;
          const templates = allTemplates.filter((template) => template.type === section.type);
          const builtInTemplates = templates.filter((template) => template.builtIn);
          const personalTemplates = templates.filter((template) => !template.builtIn);
          const selected = allTemplates.find(
            (template) => template.id === selectedTemplates[section.type],
          );
          const hasChanges = sectionHasChanges(section.type);
          const saveIntent = getPromptSaveIntent(selected, prompts[section.type]);
          const needsAction = hasChanges || saveIntent !== 'apply';
          const saving = savingType === section.type;
          const primaryLabel = saveIntent === 'update'
            ? '更新模板并应用'
            : saveIntent === 'save_as'
              ? '另存并应用'
              : needsAction ? '保存并应用' : '已保存并生效';

          return (
            <Card key={section.type} className="overflow-hidden rounded-xl border-border/55 bg-white/84 shadow-[var(--glass-shadow-soft)] backdrop-blur-xl">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setExpandedSection(expanded ? null : section.type)}
                aria-expanded={expanded}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/10">
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
                      {needsAction && <Badge variant="secondary">有未保存修改</Badge>}
                      {expanded
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>
              </button>

              {expanded && (
                <CardContent className="flex flex-col gap-4 pt-0">
                  <div className="rounded-lg border border-border/55 bg-white/64 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm font-medium">提示词模板</label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 rounded-lg text-muted-foreground hover:bg-white/80"
                        onClick={() => {
                          setPrompts((current) => ({
                            ...current,
                            [section.type]: section.defaultValue,
                          }));
                          setSelectedTemplates((current) => ({
                            ...current,
                            [section.type]: DEFAULT_SELECTED_PROMPT_TEMPLATES[section.type],
                          }));
                          setSaveErrors((current) => ({ ...current, [section.type]: '' }));
                        }}
                      >
                        <RotateCcw data-icon="inline-start" />
                        加载系统默认
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Select
                        value={selectedTemplates[section.type]}
                        onValueChange={(value) => requestTemplateChange(section.type, value)}
                      >
                        <SelectTrigger className="min-w-0 flex-1" aria-label={`${section.title}模板`}>
                          <SelectValue placeholder="选择提示词模板" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>内置模板</SelectLabel>
                            {builtInTemplates.map((template) => (
                              <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                            ))}
                          </SelectGroup>
                          {personalTemplates.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>我的模板</SelectLabel>
                              {personalTemplates.map((template) => (
                                <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-lg border-white/70 bg-white/65"
                        title="删除当前自定义模板"
                        aria-label="删除当前自定义模板"
                        disabled={!selected || selected.builtIn}
                        onClick={() => setDeleteType(section.type)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {selected?.builtIn
                        ? '内置模板不会被覆盖；修改后会另存为当前账号的个人模板。'
                        : '修改个人模板后，点击“更新模板并应用”即可一次完成。'}
                    </p>
                  </div>

                  <Textarea
                    value={prompts[section.type]}
                    rows={section.rows}
                    className="resize-y rounded-lg border-white/65 bg-white/75 font-mono text-sm leading-relaxed"
                    onChange={(event) => setPrompts((current) => ({
                      ...current,
                      [section.type]: event.target.value,
                    }))}
                    placeholder={`输入${section.title}...`}
                    aria-invalid={Boolean(saveErrors[section.type]) || undefined}
                  />

                  <div className="flex flex-col gap-3 rounded-lg border bg-muted/35 p-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 text-xs">
                      {saveErrors[section.type] ? (
                        <p role="alert" className="text-destructive">{saveErrors[section.type]}</p>
                      ) : saving ? (
                        <p className="text-muted-foreground">正在保存到当前账号…</p>
                      ) : needsAction ? (
                        <p className="text-amber-700">修改尚未保存，当前 AI 仍使用上一次保存的内容。</p>
                      ) : (
                        <p className="text-emerald-700">当前内容已保存到当前账号并生效。</p>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {needsAction && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          onClick={() => {
                            setPrompts((current) => ({ ...current, [section.type]: savedPrompts[section.type] }));
                            setSelectedTemplates((current) => ({
                              ...current,
                              [section.type]: savedSelectedTemplates[section.type],
                            }));
                            setSaveErrors((current) => ({ ...current, [section.type]: '' }));
                          }}
                        >
                          <Undo2 data-icon="inline-start" />
                          放弃修改
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saving || !prompts[section.type].trim()}
                        onClick={() => openSaveAs(section.type)}
                      >
                        <Plus data-icon="inline-start" />
                        另存为新模板
                      </Button>
                      <Button
                        size="sm"
                        disabled={saving || !needsAction || !prompts[section.type].trim()}
                        onClick={() => { void saveAndApply(section.type); }}
                      >
                        {saving ? <Spinner /> : <Save data-icon="inline-start" />}
                        {saving ? '正在保存' : primaryLabel}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Dialog
        open={Boolean(saveAsType)}
        onOpenChange={(open) => {
          if (!open && !savingType) {
            setSaveAsType(null);
            setSaveAsName('');
            setSaveAsError('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>另存为个人模板</DialogTitle>
            <DialogDescription>
              当前编辑内容会保存为新模板，并立即成为该功能正在使用的提示词。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(saveAsError) || undefined}>
              <FieldLabel htmlFor="prompt-template-name">模板名称</FieldLabel>
              <Input
                id="prompt-template-name"
                value={saveAsName}
                maxLength={100}
                autoFocus
                aria-invalid={Boolean(saveAsError) || undefined}
                onChange={(event) => {
                  setSaveAsName(event.target.value);
                  setSaveAsError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !savingType) void saveAsNewTemplate();
                }}
              />
              <FieldDescription>名称只用于当前账号识别模板，不会出现在邮件中。</FieldDescription>
              <FieldError>{saveAsError}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={Boolean(savingType)}
              onClick={() => {
                setSaveAsType(null);
                setSaveAsName('');
                setSaveAsError('');
              }}
            >
              取消
            </Button>
            <Button
              disabled={Boolean(savingType) || !saveAsName.trim()}
              onClick={() => { void saveAsNewTemplate(); }}
            >
              {savingType ? <Spinner /> : <Save data-icon="inline-start" />}
              {savingType ? '正在保存' : '保存并应用'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(pendingTemplateChange)}
        onOpenChange={(open) => !open && setPendingTemplateChange(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃当前未保存修改？</AlertDialogTitle>
            <AlertDialogDescription>
              切换模板会替换编辑框中的内容。尚未保存的修改将无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingTemplateChange) return;
                applyTemplate(pendingTemplateChange.type, pendingTemplateChange.templateId);
                setPendingTemplateChange(null);
              }}
            >
              放弃并切换
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(deleteType)}
        onOpenChange={(open) => {
          if (!open && !savingType) setDeleteType(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个个人模板？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后将自动恢复并应用该功能的系统默认提示词。此操作不能撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(savingType)}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={Boolean(savingType)}
              onClick={(event) => {
                event.preventDefault();
                if (deleteType) void deleteTemplate(deleteType);
              }}
            >
              {savingType ? <Spinner /> : <Trash2 data-icon="inline-start" />}
              {savingType ? '正在删除' : '确认删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
