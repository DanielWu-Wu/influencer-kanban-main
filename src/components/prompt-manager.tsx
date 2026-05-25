'use client';

import { useState, useEffect } from 'react';
import { useSettings } from '@/lib/data';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  MessageSquare, Languages, Save, RotateCcw,
  ChevronDown, ChevronUp, Info, Sparkles, Lightbulb,
  CheckCircle2, AlertCircle
} from 'lucide-react';

const DEFAULT_TRANSLATE_PROMPT = `你是一位专业的翻译助手。将用户提供的文本翻译成中文。
源语言可能是英语、法语、德语、西班牙语、葡萄牙语、意大利语、荷兰语等任何语言，请自动识别。
只返回翻译结果，不要添加任何解释或额外内容。
保持原文的格式和段落结构。
如果是邮件内容，请保持邮件的格式。`;

const DEFAULT_AI_PROMPT = `你是一位专业的跨境电商红人推广邮件助手。你的任务是：
1. 根据用户提供的想法和上下文，撰写专业的邮件回复
2. 邮件必须使用{{targetLang}}语言撰写
3. 语气友好专业，符合商务沟通规范
4. 同时提供中文翻译，方便用户检查
5. 回复内容要具体，不要太空泛

输出格式：
【{{targetLang}}回复】
（用{{targetLang}}写的邮件内容）

【中文对照】
（中文翻译）

注意：
- 变量 {{targetLang}} 会被替换为对方邮件使用的语言
- 不要在邮件中使用过于夸张的营销语言
- 保持真诚和专业的态度`;

export default function PromptManager() {
  const { settings, updateSettings } = useSettings();
  const [translatePrompt, setTranslatePrompt] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [saved, setSaved] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'translate' | 'ai' | null>('translate');

  useEffect(() => {
    setTranslatePrompt(settings.translatePrompt || DEFAULT_TRANSLATE_PROMPT);
    setAiPrompt(settings.aiEmailPrompt || DEFAULT_AI_PROMPT);
  }, [settings.translatePrompt, settings.aiEmailPrompt]);

  const handleSave = () => {
    updateSettings({
      translatePrompt,
      aiEmailPrompt: aiPrompt,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleResetTranslate = () => {
    setTranslatePrompt(DEFAULT_TRANSLATE_PROMPT);
  };

  const handleResetAi = () => {
    setAiPrompt(DEFAULT_AI_PROMPT);
  };

  const isTranslateModified = translatePrompt !== DEFAULT_TRANSLATE_PROMPT;
  const isAiModified = aiPrompt !== DEFAULT_AI_PROMPT;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部标题栏 - 固定不滚动 */}
      <div className="flex-shrink-0 flex items-center justify-between px-1 mb-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            提示词管理
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">自定义 AI 翻译和邮件回复的行为，让输出更贴合你的风格</p>
        </div>
        <Button onClick={handleSave} size="sm" className="gap-1.5">
          {saved ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              已保存
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              保存全部
            </>
          )}
        </Button>
      </div>

      <Separator className="flex-shrink-0 mb-4" />

      {/* 提示词卡片列表 - 可滚动区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
        {/* 翻译提示词 */}
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedSection(expandedSection === 'translate' ? null : 'translate')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <Languages className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">邮件翻译提示词</CardTitle>
                    <CardDescription className="text-xs mt-0.5">控制 AI 如何将外文邮件翻译成中文</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isTranslateModified && (
                    <Badge variant="secondary" className="text-xs">已修改</Badge>
                  )}
                  {expandedSection === 'translate' ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardHeader>
          </button>

          {expandedSection === 'translate' && (
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs gap-1">
                  <Info className="w-3 h-3" />
                  用于「邮件翻译」功能
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-muted-foreground"
                  onClick={handleResetTranslate}
                >
                  <RotateCcw className="w-3 h-3" />
                  恢复默认
                </Button>
              </div>

              <Textarea
                value={translatePrompt}
                onChange={(e) => setTranslatePrompt(e.target.value)}
                rows={8}
                className="resize-y font-mono text-sm leading-relaxed"
                placeholder="输入翻译提示词..."
              />

              <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                <h4 className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5 text-primary" />
                  优化建议
                </h4>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>• 可加入行业术语要求，如「跨境电商专业术语保持英文」</li>
                  <li>• 可指定翻译风格，如「偏口语化」或「偏正式商务」</li>
                  <li>• 可要求保留原文中的品牌名和产品名</li>
                </ul>
              </div>
            </CardContent>
          )}
        </Card>

        {/* AI 邮件回复提示词 */}
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => setExpandedSection(expandedSection === 'ai' ? null : 'ai')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">AI 邮件回复提示词</CardTitle>
                    <CardDescription className="text-xs mt-0.5">控制 AI 如何帮你起草邮件回复</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isAiModified && (
                    <Badge variant="secondary" className="text-xs">已修改</Badge>
                  )}
                  {expandedSection === 'ai' ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardHeader>
          </button>

          {expandedSection === 'ai' && (
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs gap-1">
                  <Info className="w-3 h-3" />
                  用于「AI 辅助回复」功能
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs gap-1 text-muted-foreground"
                  onClick={handleResetAi}
                >
                  <RotateCcw className="w-3 h-3" />
                  恢复默认
                </Button>
              </div>

              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={14}
                className="resize-y font-mono text-sm leading-relaxed"
                placeholder="输入AI回复提示词..."
              />

              <div className="rounded-lg bg-muted/50 p-3 space-y-3">
                {/* 可用变量 */}
                <div>
                  <h4 className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-primary" />
                    可用变量
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="secondary" className="text-xs font-mono">
                      {'{{targetLang}}'}
                    </Badge>
                    <span className="text-xs text-muted-foreground self-center">
                      会被替换为对方邮件使用的语言（如 English、French 等）
                    </span>
                  </div>
                </div>

                <Separator />

                {/* 优化建议 */}
                <div>
                  <h4 className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                    <Lightbulb className="w-3.5 h-3.5 text-primary" />
                    优化建议
                  </h4>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• 加入你的品牌/公司介绍，让 AI 更了解你的背景</li>
                    <li>• 加入你的产品类别和优势，让回复更具体</li>
                    <li>• 指定邮件签名格式</li>
                    <li>• 指定语气偏好（正式/随意/热情）</li>
                    <li>• 加入你的合作条件和流程说明</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
