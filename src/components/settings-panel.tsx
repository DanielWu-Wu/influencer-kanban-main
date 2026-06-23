'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useGmailAuth, useSettings } from '@/lib/data';
import { ProductDatabaseSettings } from '@/components/product-database-settings';
import { CloudSyncSettings } from '@/components/cloud-sync-settings';
import { FeishuSettings } from '@/components/feishu-settings';
import { YouTubeApiSettings } from '@/components/youtube-api-settings';
import {
  Settings, Mail, Zap,
  CheckCircle2, AlertTriangle,
  Plug, RefreshCw, Save, HelpCircle, Link2, Cpu,
  ChevronDown, ChevronUp, Info, User, Clock, Heart, LogOut
} from 'lucide-react';

const STORED_AI_KEY = '••••••••••••';

export function SettingsPanel() {
  const { settings, updateSettings, loading: settingsLoading } = useSettings();
  const { auth: gmailAuth, disconnect: disconnectGmail } = useGmailAuth();
  const [brandName, setBrandName] = useState(settings.brandName || '');
  const [senderName, setSenderName] = useState(settings.senderName || '');
  const modelProvider = 'custom' as const;
  const [customApiUrl, setCustomApiUrl] = useState(settings.customApiUrl || '');
  const [customApiKey, setCustomApiKey] = useState(
    settings.customApiKey || (settings.customApiKeyConfigured ? STORED_AI_KEY : ''),
  );
  const [customModelName, setCustomModelName] = useState(settings.customModelName || '');
  const [testingModel, setTestingModel] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>('products');

  useEffect(() => {
    if (settingsLoading) return;
    setBrandName(settings.brandName || '');
    setSenderName(settings.senderName || '');
    setCustomApiUrl(settings.customApiUrl || '');
    setCustomApiKey(
      settings.customApiKey || (settings.customApiKeyConfigured ? STORED_AI_KEY : ''),
    );
    setCustomModelName(settings.customModelName || '');
  }, [settings, settingsLoading]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('feishu_connected') || params.get('feishu_error')) {
      setExpandedSection('feishu');
    }
  }, []);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleSaveAll = async () => {
    if (
      modelProvider === 'custom' &&
      customApiKey &&
      customApiKey !== STORED_AI_KEY
    ) {
      const response = await fetch('/api/secrets/ai-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: customApiKey }),
      });
      const result = await response.json();
      if (!response.ok) {
        setModelTestResult({ success: false, message: result.error || 'AI API Key 保存失败' });
        return;
      }
      setCustomApiKey(STORED_AI_KEY);
    }

    updateSettings({
      brandName,
      senderName,
      modelProvider,
      customApiUrl,
      customApiKey: undefined,
      customApiKeyConfigured:
        settings.customApiKeyConfigured ||
        (modelProvider === 'custom' && Boolean(customApiKey)),
      customModelName,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestModel = async () => {
    const hasApiKey = customApiKey === STORED_AI_KEY || Boolean(customApiKey) || settings.customApiKeyConfigured;
    if (modelProvider === 'custom' && (!customApiUrl || !hasApiKey || !customModelName)) {
      setModelTestResult({ success: false, message: '请先填写完整的 API 配置信息' });
      return;
    }

    setTestingModel(true);
    setModelTestResult(null);

    try {
      if (modelProvider === 'custom' && customApiKey && customApiKey !== STORED_AI_KEY) {
        const saveResponse = await fetch('/api/secrets/ai-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: customApiKey }),
        });
        const saveResult = await saveResponse.json();
        if (!saveResponse.ok) {
          throw new Error(saveResult.error || 'AI API Key 保存失败');
        }
        setCustomApiKey(STORED_AI_KEY);
        updateSettings({
          customApiKey: undefined,
          customApiKeyConfigured: true,
        });
      }

      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draft',
          threadSubject: '测试连接',
          threadMessages: [{
            from: 'creator@example.com',
            to: 'brand@example.com',
            date: new Date().toISOString(),
            body: 'This is a test collaboration message.',
          }],
          userIdeas: '请简单回复 OK',
          targetLang: 'en',
          targetLangName: '英语',
          modelProvider,
          customApiUrl,
          customModelName,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setModelTestResult({ success: true, message: '模型连接成功！' });
      } else {
        setModelTestResult({ success: false, message: data.error || '模型连接失败' });
      }
    } catch {
      setModelTestResult({ success: false, message: '连接失败，请检查配置' });
    } finally {
      setTestingModel(false);
    }
  };

  const handleConnectGmail = () => {
    window.location.href = '/api/auth/google';
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部标题栏 - 固定不滚动 */}
      <div className="mb-4 flex flex-shrink-0 items-center justify-between rounded-lg border border-white/60 bg-white/62 px-4 py-3 shadow-apple backdrop-blur-xl">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Settings className="w-5 h-5" />
            设置
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">管理产品资料、集成连接、品牌信息和模型配置</p>
        </div>
        <Button onClick={handleSaveAll} size="sm" className="h-10 gap-1.5 rounded-lg shadow-apple">
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

      <Separator className="mb-4 flex-shrink-0 bg-white/60" />

      {/* 设置卡片列表 - 可滚动区域 */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <CloudSyncSettings />

        <ProductDatabaseSettings
          expanded={expandedSection === 'products'}
          onToggle={() => toggleSection('products')}
        />

        <FeishuSettings
          expanded={expandedSection === 'feishu'}
          onToggle={() => toggleSection('feishu')}
        />

        <YouTubeApiSettings
          expanded={expandedSection === 'youtube'}
          onToggle={() => toggleSection('youtube')}
        />

        {/* Gmail 邮件 */}
        <Card className="overflow-hidden rounded-lg border-white/65 bg-white/66 shadow-apple backdrop-blur-xl">
          <button
            type="button"
            onClick={() => toggleSection('gmail')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
                    <Mail className="w-4 h-4 text-red-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Gmail 邮件</CardTitle>
                    <CardDescription className="mt-0.5 text-xs">连接 Gmail，查看邮件往来，AI 辅助回复</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {gmailAuth?.isConnected && (
                    <Badge variant="secondary" className="rounded-md bg-emerald-50 text-xs text-emerald-700">已连接</Badge>
                  )}
                  {expandedSection === 'gmail' ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardHeader>
          </button>

          {expandedSection === 'gmail' && (
            <CardContent className="space-y-4 pt-0">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="gap-1 rounded-md border-white/70 bg-white/55 text-xs">
                  <Info className="w-3 h-3" />
                  用于「Gmail 邮件」页面
                </Badge>
              </div>

              {gmailAuth?.isConnected ? (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-green-200 bg-green-50/85 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-green-800">
                      <CheckCircle2 className="h-4 w-4" />
                      Gmail 已连接
                    </div>
                    <p className="mt-1 truncate text-xs text-green-700">
                      {gmailAuth.email || 'Google 账号'}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5 rounded-lg bg-white/75"
                    onClick={disconnectGmail}
                  >
                    <LogOut className="h-4 w-4" />
                    断开
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 rounded-lg border border-white/65 bg-white/55 p-4">
                  <div>
                    <p className="text-sm font-medium">授权你的 Gmail 账号</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      点击后跳转至 Google 官方授权页面。应用不会要求你填写或保存 Google Client Secret。
                    </p>
                  </div>
                  <div className="rounded-lg bg-white/70 p-3 text-xs text-muted-foreground">
                    授权后可读取和分类邮件、标记已读或未读、标星，以及保存 AI 回复草稿。
                  </div>
                  <Button
                    className="h-10 w-full gap-2 rounded-lg bg-red-500 hover:bg-red-600"
                    onClick={handleConnectGmail}
                  >
                    <Plug className="h-4 w-4" />
                    一键连接 Gmail
                  </Button>
                </div>
              )}

              <div className="rounded-lg border border-white/65 bg-white/55 p-3 text-xs text-muted-foreground">
                OAuth 密钥由项目的 Vercel 环境变量安全管理，无需在网页中重复填写。
              </div>
            </CardContent>
          )}
        </Card>

        {/* 模型 API 设置 */}
        <Card className="overflow-hidden rounded-lg border-white/65 bg-white/66 shadow-apple backdrop-blur-xl">
          <button
            type="button"
            onClick={() => toggleSection('model')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                    <Cpu className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">模型 API 设置</CardTitle>
                    <CardDescription className="mt-0.5 text-xs">选择 AI 模型来源，支持切换到大语言模型</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {modelProvider === 'custom' && (
                    <Badge variant="secondary" className="rounded-md bg-white/80 text-xs">自定义</Badge>
                  )}
                  {expandedSection === 'model' ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardHeader>
          </button>

          {expandedSection === 'model' && (
            <CardContent className="space-y-4 pt-0">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="gap-1 rounded-md border-white/70 bg-white/55 text-xs">
                  <Info className="w-3 h-3" />
                  用于「翻译」和「AI 回复」功能
                </Badge>
              </div>

              <div className="space-y-3">
                <Label className="text-xs">模型来源</Label>
                <div className="rounded-lg border-2 border-primary bg-primary/5 p-3 text-left">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Link2 className="w-4 h-4" />
                    自定义 API
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    使用你自己申请的 DeepSeek / OpenAI / 其他 OpenAI 兼容接口
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                  <div className="space-y-2 rounded-lg border border-white/65 bg-white/55 p-3">
                    <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <HelpCircle className="w-3.5 h-3.5 text-primary" />
                      支持的模型提供商
                    </h4>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                      <li>OpenAI (GPT-4o, GPT-4, GPT-3.5)</li>
                      <li>DeepSeek (deepseek-chat, deepseek-reasoner)</li>
                      <li>智谱 AI (GLM-4)</li>
                      <li>通义千问 (Qwen)</li>
                      <li>其他 OpenAI 兼容接口</li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="custom-api-url" className="text-xs">API 地址</Label>
                    <Input
                      id="custom-api-url"
                      type="text"
                      placeholder="https://api.openai.com/v1/chat/completions"
                      value={customApiUrl}
                      onChange={(e) => setCustomApiUrl(e.target.value)}
                      className="rounded-lg bg-white/75 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custom-api-key" className="text-xs">API Key</Label>
                    <Input
                      id="custom-api-key"
                      type="password"
                      placeholder="sk-xxxxxxxxxx"
                      value={customApiKey}
                      onChange={(e) => setCustomApiKey(e.target.value)}
                      onFocus={() => {
                        if (customApiKey === STORED_AI_KEY) setCustomApiKey('');
                      }}
                      className="rounded-lg bg-white/75 text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="custom-model-name" className="text-xs">模型名称</Label>
                    <Input
                      id="custom-model-name"
                      type="text"
                      placeholder="gpt-4o / deepseek-chat / glm-4"
                      value={customModelName}
                      onChange={(e) => setCustomModelName(e.target.value)}
                      className="rounded-lg bg-white/75 text-sm"
                    />
                  </div>

                  <Button
                    variant="outline"
                    onClick={handleTestModel}
                    disabled={
                      testingModel ||
                      !customApiUrl ||
                      !(customApiKey || settings.customApiKeyConfigured) ||
                      !customModelName
                    }
                    className="h-10 w-full rounded-lg bg-white/75"
                  >
                    {testingModel ? (
                      <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Plug className="w-4 h-4 mr-1" />
                    )}
                    测试连接
                  </Button>

                  {modelTestResult && (
                    <div className={`flex items-center gap-2 rounded-lg border p-3 ${
                      modelTestResult.success ? 'border-green-200 bg-green-50/85' : 'border-red-100 bg-red-50/90'
                    }`}>
                      {modelTestResult.success ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                      )}
                      <span className={`text-sm ${
                        modelTestResult.success ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {modelTestResult.message}
                      </span>
                    </div>
                  )}
              </div>
            </CardContent>
          )}
        </Card>

        {/* 品牌信息 */}
        <Card className="overflow-hidden rounded-lg border-white/65 bg-white/66 shadow-apple backdrop-blur-xl">
          <button
            type="button"
            onClick={() => toggleSection('brand')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10">
                    <User className="w-4 h-4 text-amber-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">品牌信息</CardTitle>
                    <CardDescription className="mt-0.5 text-xs">设置邮件模板中使用的品牌信息</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(settings.brandName || settings.senderName) && (
                    <Badge variant="secondary" className="rounded-md bg-white/80 text-xs">已配置</Badge>
                  )}
                  {expandedSection === 'brand' ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardHeader>
          </button>

          {expandedSection === 'brand' && (
            <CardContent className="space-y-4 pt-0">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="gap-1 rounded-md border-white/70 bg-white/55 text-xs">
                  <Info className="w-3 h-3" />
                  用于「邮件模板」功能
                </Badge>
              </div>

              <div className="space-y-2">
                <Label htmlFor="brandName" className="text-xs">品牌名称</Label>
                <Input
                  id="brandName"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="例如：TechGear Pro"
                  className="rounded-lg bg-white/75 text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="senderName" className="text-xs">发件人名称</Label>
                <Input
                  id="senderName"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="例如：小明"
                  className="rounded-lg bg-white/75 text-sm"
                />
              </div>
            </CardContent>
          )}
        </Card>

        {/* 跟进规则 */}
        <Card className="overflow-hidden rounded-lg border-white/65 bg-white/66 shadow-apple backdrop-blur-xl">
          <button
            type="button"
            onClick={() => toggleSection('followup')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
                    <Clock className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">跟进规则</CardTitle>
                    <CardDescription className="mt-0.5 text-xs">设置自动跟进提醒的时间间隔</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {expandedSection === 'followup' ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardHeader>
          </button>

          {expandedSection === 'followup' && (
            <CardContent className="space-y-4 pt-0">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="gap-1 rounded-md border-white/70 bg-white/55 text-xs">
                  <Info className="w-3 h-3" />
                  用于「跟进提醒」功能
                </Badge>
              </div>

              <div className="space-y-2">
                <Label htmlFor="firstFollowup" className="text-xs">首次跟进（天）</Label>
                <Input id="firstFollowup" type="number" defaultValue={3} className="rounded-lg bg-white/75 text-sm" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="secondFollowup" className="text-xs">第二次跟进（天）</Label>
                <Input id="secondFollowup" type="number" defaultValue={7} className="rounded-lg bg-white/75 text-sm" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="thirdFollowup" className="text-xs">第三次跟进（天）</Label>
                <Input id="thirdFollowup" type="number" defaultValue={7} className="rounded-lg bg-white/75 text-sm" />
              </div>
            </CardContent>
          )}
        </Card>

        {/* 关于 */}
        <Card className="overflow-hidden rounded-lg border-white/65 bg-white/66 shadow-apple backdrop-blur-xl">
          <button
            type="button"
            onClick={() => toggleSection('about')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pink-500/10">
                    <Heart className="w-4 h-4 text-pink-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">关于红人推广看板</CardTitle>
                    <CardDescription className="mt-0.5 text-xs">版本信息和功能预告</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {expandedSection === 'about' ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardHeader>
          </button>

          {expandedSection === 'about' && (
            <CardContent className="space-y-4 pt-0">
              <p className="text-sm text-muted-foreground">
                专为跨境电商海外红人推广专员设计的任务管理工具，帮助你管理红人数据库、跟踪合作进度、管理邮件往来。
              </p>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">版本</span>
                  <span>1.0.0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">技术栈</span>
                  <span>Next.js + TypeScript</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2 rounded-lg border border-white/65 bg-white/55 p-3">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  已完成功能
                </h4>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>Gmail 邮件集成</li>
                  <li>AI 辅助写邮件（自定义 API）</li>
                  <li>邮件翻译功能</li>
                  <li>飞书多维表格内嵌</li>
                  <li>提示词自定义管理</li>
                </ul>
              </div>
            </CardContent>
          )}
        </Card>

      </div>
    </div>
  );
}
