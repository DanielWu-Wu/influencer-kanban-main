'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BadgePercent,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FilePenLine,
  Languages,
  MailCheck,
  MailPlus,
  PackageCheck,
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
import { generateId, useSettings } from '@/lib/data';

type PromptValues = Record<PromptType, string>;

type PromptManagerMode = 'general' | 'drafting';

const PAGE_CONFIG: Record<PromptManagerMode, {
  title: string;
  description: string;
  sectionTypes: PromptType[];
}> = {
  general: {
    title: '提示词管理',
    description: '设置邮件翻译和合作分析规则，并保存常用模板',
    sectionTypes: ['translate', 'analysis'],
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
  draft: DEFAULT_DRAFT_PROMPT,
  outreach: DEFAULT_OUTREACH_PROMPT,
  outreachFollowUp1: DEFAULT_OUTREACH_FOLLOW_UP_1_PROMPT,
  outreachFollowUp2: DEFAULT_OUTREACH_FOLLOW_UP_2_PROMPT,
  logisticsNotice: DEFAULT_LOGISTICS_NOTICE_PROMPT,
  discountNotice: DEFAULT_DISCOUNT_NOTICE_PROMPT,
};

export default function PromptManager({ mode = 'general' }: { mode?: PromptManagerMode }) {
  const pageConfig = PAGE_CONFIG[mode];
  const { settings, updateSettings, loading } = useSettings();
  const [prompts, setPrompts] = useState<PromptValues>(initialPrompts);
  const [customTemplates, setCustomTemplates] = useState<PromptTemplate[]>([]);
  const [templateNames, setTemplateNames] = useState<Record<PromptType, string>>({
    translate: '',
    analysis: '',
    draft: '',
    outreach: '',
    outreachFollowUp1: '',
    outreachFollowUp2: '',
    logisticsNotice: '',
    discountNotice: '',
  });
  const [selectedTemplates, setSelectedTemplates] = useState<Record<PromptType, string>>({
    translate: 'builtin-translate-standard',
    analysis: 'builtin-analysis-youtube',
    draft: 'builtin-draft-business',
    outreach: 'builtin-outreach-youtube',
    outreachFollowUp1: 'builtin-outreach-follow-up-1',
    outreachFollowUp2: 'builtin-outreach-follow-up-2',
    logisticsNotice: 'builtin-logistics-notice',
    discountNotice: 'builtin-discount-notice',
  });
  const [expandedSection, setExpandedSection] = useState<PromptType | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loading) return;
    setPrompts({
      translate: settings.translatePrompt || DEFAULT_TRANSLATE_PROMPT,
      analysis: settings.aiAnalysisPrompt || DEFAULT_ANALYSIS_PROMPT,
      draft: settings.aiDraftPrompt || settings.aiEmailPrompt || DEFAULT_DRAFT_PROMPT,
      outreach: settings.aiOutreachPrompt || DEFAULT_OUTREACH_PROMPT,
      outreachFollowUp1:
        settings.aiOutreachFollowUp1Prompt || DEFAULT_OUTREACH_FOLLOW_UP_1_PROMPT,
      outreachFollowUp2:
        settings.aiOutreachFollowUp2Prompt || DEFAULT_OUTREACH_FOLLOW_UP_2_PROMPT,
      logisticsNotice: settings.aiLogisticsNoticePrompt || DEFAULT_LOGISTICS_NOTICE_PROMPT,
      discountNotice: settings.aiDiscountNoticePrompt || DEFAULT_DISCOUNT_NOTICE_PROMPT,
    });
  }, [
    loading,
    settings.aiAnalysisPrompt,
    settings.aiDraftPrompt,
    settings.aiDiscountNoticePrompt,
    settings.aiEmailPrompt,
    settings.aiLogisticsNoticePrompt,
    settings.aiOutreachPrompt,
    settings.aiOutreachFollowUp1Prompt,
    settings.aiOutreachFollowUp2Prompt,
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
    if (mode === 'general') {
      updateSettings({
        translatePrompt: prompts.translate,
        aiAnalysisPrompt: prompts.analysis,
        promptTemplates: customTemplates,
      });
    } else {
      updateSettings({
        aiDraftPrompt: prompts.draft,
        aiEmailPrompt: prompts.draft,
        aiOutreachPrompt: prompts.outreach,
        aiOutreachFollowUp1Prompt: prompts.outreachFollowUp1,
        aiOutreachFollowUp2Prompt: prompts.outreachFollowUp2,
        aiLogisticsNoticePrompt: prompts.logisticsNotice,
        aiDiscountNoticePrompt: prompts.discountNotice,
        promptTemplates: customTemplates,
      });
    }
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
    setSelectedTemplates((current) => ({
      ...current,
      [type]: duplicate?.id || nextTemplates[nextTemplates.length - 1].id,
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
        <Button onClick={handleSaveAll} size="sm" className="h-9 gap-1.5 rounded-lg shadow-apple">
          {saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {saved ? '已保存' : '保存全部'}
        </Button>
      </div>

      <Separator className="mb-4 shrink-0 bg-white/60" />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {PROMPT_SECTIONS.filter((section) => pageConfig.sectionTypes.includes(section.type)).map((section) => {
          const Icon = section.icon;
          const expanded = expandedSection === section.type;
          const templates = allTemplates.filter((template) => template.type === section.type);
          const selected = allTemplates.find(
            (template) => template.id === selectedTemplates[section.type],
          );
          const modified = prompts[section.type] !== section.defaultValue;

          return (
            <Card key={section.type} className="overflow-hidden rounded-xl border-border/55 bg-white/84 shadow-[var(--glass-shadow-soft)] backdrop-blur-xl">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => setExpandedSection(expanded ? null : section.type)}
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
                      {modified && <Badge variant="secondary" className="rounded-md bg-white/75">已修改</Badge>}
                      {expanded
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>
              </button>

              {expanded && (
                <CardContent className="space-y-4 pt-0">
                  <div className="rounded-lg border border-border/55 bg-white/64 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm font-medium">提示词模板</label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 rounded-lg text-muted-foreground hover:bg-white/80"
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
                        className="h-9 min-w-0 flex-1 rounded-lg border border-white/65 bg-white/75 px-3 text-sm outline-none"
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
                        className="h-9 w-9 rounded-lg border-white/70 bg-white/65"
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
                        className="rounded-lg border-white/65 bg-white/75"
                        onChange={(event) => setTemplateNames((current) => ({
                          ...current,
                          [section.type]: event.target.value,
                        }))}
                      />
                      <Button
                        variant="outline"
                        className="h-9 shrink-0 gap-1.5 rounded-lg border-white/70 bg-white/65"
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
                    className="resize-y rounded-lg border-white/65 bg-white/75 font-mono text-sm leading-relaxed"
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
