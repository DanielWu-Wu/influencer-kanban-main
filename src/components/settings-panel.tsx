'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useSettings } from '@/lib/data';
import {
  Settings, Database, Mail, FileSpreadsheet, Zap,
  CheckCircle2, AlertTriangle, ExternalLink,
  Plug, RefreshCw, Trash2, Save, HelpCircle, Link2, Cpu,
  ChevronDown, ChevronUp, Info, User, Clock, Heart
} from 'lucide-react';

export function SettingsPanel() {
  const { settings, updateSettings } = useSettings();
  const [feishuUrl, setFeishuUrl] = useState(settings.feishuUrl || '');
  const [brandName, setBrandName] = useState(settings.brandName || '');
  const [senderName, setSenderName] = useState(settings.senderName || '');
  const [gmailClientId, setGmailClientId] = useState(settings.gmailClientId || '');
  const [gmailClientSecret, setGmailClientSecret] = useState(settings.gmailClientSecret || '');
  const [modelProvider, setModelProvider] = useState<'builtin' | 'custom'>(settings.modelProvider || 'builtin');
  const [customApiUrl, setCustomApiUrl] = useState(settings.customApiUrl || '');
  const [customApiKey, setCustomApiKey] = useState(settings.customApiKey || '');
  const [customModelName, setCustomModelName] = useState(settings.customModelName || '');
  const [testingModel, setTestingModel] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>('feishu');

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleSaveAll = () => {
    updateSettings({
      feishuUrl,
      brandName,
      senderName,
      gmailClientId,
      gmailClientSecret,
      modelProvider,
      customApiUrl,
      customApiKey,
      customModelName,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleClearFeishu = () => {
    setFeishuUrl('');
    updateSettings({ feishuUrl: '' });
  };

  const handleTestModel = async () => {
    if (modelProvider === 'custom' && (!customApiUrl || !customApiKey || !customModelName)) {
      setModelTestResult({ success: false, message: '请先填写完整的 API 配置信息' });
      return;
    }

    setTestingModel(true);
    setModelTestResult(null);

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadSubject: '测试连接',
          lastMessage: 'This is a test message.',
          userIdeas: '请简单回复 OK',
          targetLang: 'en',
          modelProvider,
          customApiUrl,
          customApiKey,
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
    updateSettings({ gmailClientId, gmailClientSecret });

    const redirectUri = `${window.location.origin}/api/auth/callback`;
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.modify',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: gmailClientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      state: window.location.origin,
    });

    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部标题栏 - 固定不滚动 */}
      <div className="flex-shrink-0 flex items-center justify-between px-1 mb-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Settings className="w-5 h-5" />
            设置
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">管理集成连接、品牌信息和模型配置</p>
        </div>
        <Button onClick={handleSaveAll} size="sm" className="gap-1.5">
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

      {/* 设置卡片列表 - 可滚动区域 */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
        {/* 飞书多维表格 */}
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('feishu')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <FileSpreadsheet className="w-4 h-4 text-blue-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">飞书多维表格</CardTitle>
                    <CardDescription className="text-xs mt-0.5">内嵌飞书多维表格，在看板中直接查看</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {settings.feishuUrl && (
                    <Badge variant="secondary" className="text-xs">已连接</Badge>
                  )}
                  {expandedSection === 'feishu' ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            </CardHeader>
          </button>

          {expandedSection === 'feishu' && (
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs gap-1">
                  <Info className="w-3 h-3" />
                  用于「红人列表」页面
                </Badge>
                {settings.feishuUrl && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-muted-foreground" onClick={handleClearFeishu}>
                    <Trash2 className="w-3 h-3" />
                    清除
                  </Button>
                )}
              </div>

              {settings.feishuUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">已配置</span>
                  </div>
                  <p className="text-sm text-muted-foreground break-all bg-muted/50 p-2 rounded">
                    {settings.feishuUrl}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => window.open(settings.feishuUrl, '_blank')}>
                    <ExternalLink className="w-4 h-4 mr-1" />
                    测试打开
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                  <h4 className="text-xs font-medium text-foreground flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5 text-primary" />
                    如何获取飞书多维表格链接？
                  </h4>
                  <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>打开你的飞书多维表格</li>
                    <li>点击右上角「分享」按钮</li>
                    <li>开启「互联网可访问」权限</li>
                    <li>复制浏览器地址栏中的 URL</li>
                    <li>粘贴到下方输入框</li>
                  </ol>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="feishu-url" className="text-xs">飞书多维表格 URL</Label>
                <Input
                  id="feishu-url"
                  value={feishuUrl}
                  onChange={(e) => setFeishuUrl(e.target.value)}
                  placeholder="https://xxx.feishu.cn/base/xxx?embed=true"
                  className="text-sm"
                />
              </div>
            </CardContent>
          )}
        </Card>

        {/* Gmail 邮件 */}
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('gmail')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-500/10 flex items-center justify-center">
                    <Mail className="w-4 h-4 text-red-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Gmail 邮件</CardTitle>
                    <CardDescription className="text-xs mt-0.5">连接 Gmail，查看邮件往来，AI 辅助回复</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {settings.gmailClientId && (
                    <Badge variant="secondary" className="text-xs">已配置</Badge>
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
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs gap-1">
                  <Info className="w-3 h-3" />
                  用于「Gmail 邮件」页面
                </Badge>
              </div>

              <div className="rounded-lg bg-red-500/5 p-3 space-y-2">
                <h4 className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                  配置步骤
                </h4>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Google Cloud Console 创建 OAuth 2.0 客户端</li>
                  <li>启用 Gmail API</li>
                  <li>配置授权重定向 URI（见下方）</li>
                  <li>获取 Client ID 和 Client Secret</li>
                </ol>
                <div className="mt-2 p-2 bg-background rounded text-xs text-muted-foreground">
                  <span className="font-medium">重定向 URI：</span>
                  <code className="block mt-1 break-all select-all bg-muted/50 p-1 rounded">
                    {typeof window !== 'undefined' ? `${window.location.origin}/api/auth/callback` : ''}
                  </code>
                </div>
                <Button variant="outline" size="sm" className="mt-2 border-red-200 text-red-600 hover:bg-red-50 h-7 text-xs" asChild>
                  <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3 h-3 mr-1" />
                    打开 Google Cloud Console
                  </a>
                </Button>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="gmail-client-id" className="text-xs">Google Client ID</Label>
                  <Input
                    id="gmail-client-id"
                    type="text"
                    placeholder="xxxxx.apps.googleusercontent.com"
                    value={gmailClientId}
                    onChange={(e) => setGmailClientId(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gmail-client-secret" className="text-xs">Google Client Secret</Label>
                  <Input
                    id="gmail-client-secret"
                    type="password"
                    placeholder="GOCSPX-xxxxxxxxxx"
                    value={gmailClientSecret}
                    onChange={(e) => setGmailClientSecret(e.target.value)}
                    className="text-sm"
                  />
                </div>
                <Button
                  className="w-full"
                  disabled={!gmailClientId || !gmailClientSecret}
                  onClick={handleConnectGmail}
                >
                  <Plug className="w-4 h-4 mr-1" />
                  连接 Gmail
                </Button>
              </div>
            </CardContent>
          )}
        </Card>

        {/* 模型 API 设置 */}
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('model')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Cpu className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base">模型 API 设置</CardTitle>
                    <CardDescription className="text-xs mt-0.5">选择 AI 模型来源，支持切换到大语言模型</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {modelProvider === 'custom' && (
                    <Badge variant="secondary" className="text-xs">自定义</Badge>
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
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs gap-1">
                  <Info className="w-3 h-3" />
                  用于「翻译」和「AI 回复」功能
                </Badge>
              </div>

              <div className="space-y-3">
                <Label className="text-xs">模型来源</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setModelProvider('builtin')}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      modelProvider === 'builtin'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="font-medium text-sm flex items-center gap-2">
                      <Zap className="w-4 h-4" />
                      内置 DeepSeek
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      无需配置，开箱即用
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModelProvider('custom')}
                    className={`p-3 rounded-lg border-2 text-left transition-all ${
                      modelProvider === 'custom'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    <div className="font-medium text-sm flex items-center gap-2">
                      <Link2 className="w-4 h-4" />
                      自定义 API
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      OpenAI 兼容接口
                    </p>
                  </button>
                </div>
              </div>

              {modelProvider === 'builtin' && (
                <div className="rounded-lg bg-green-500/5 p-3 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-green-700">内置 DeepSeek AI 已启用，无需额外配置</span>
                </div>
              )}

              {modelProvider === 'custom' && (
                <div className="space-y-3">
                  <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                    <h4 className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-primary" />
                      支持的模型提供商
                    </h4>
                    <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
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
                      className="text-sm"
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
                      className="text-sm"
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
                      className="text-sm"
                    />
                  </div>

                  <Button
                    variant="outline"
                    onClick={handleTestModel}
                    disabled={testingModel || !customApiUrl || !customApiKey || !customModelName}
                    className="w-full"
                  >
                    {testingModel ? (
                      <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                    ) : (
                      <Plug className="w-4 h-4 mr-1" />
                    )}
                    测试连接
                  </Button>

                  {modelTestResult && (
                    <div className={`rounded-lg p-3 flex items-center gap-2 ${
                      modelTestResult.success ? 'bg-green-500/5' : 'bg-red-500/5'
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
              )}
            </CardContent>
          )}
        </Card>

        {/* 品牌信息 */}
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('brand')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <User className="w-4 h-4 text-amber-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">品牌信息</CardTitle>
                    <CardDescription className="text-xs mt-0.5">设置邮件模板中使用的品牌信息</CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(settings.brandName || settings.senderName) && (
                    <Badge variant="secondary" className="text-xs">已配置</Badge>
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
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs gap-1">
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
                  className="text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="senderName" className="text-xs">发件人名称</Label>
                <Input
                  id="senderName"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder="例如：小明"
                  className="text-sm"
                />
              </div>
            </CardContent>
          )}
        </Card>

        {/* 跟进规则 */}
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('followup')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">跟进规则</CardTitle>
                    <CardDescription className="text-xs mt-0.5">设置自动跟进提醒的时间间隔</CardDescription>
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
            <CardContent className="pt-0 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs gap-1">
                  <Info className="w-3 h-3" />
                  用于「跟进提醒」功能
                </Badge>
              </div>

              <div className="space-y-2">
                <Label htmlFor="firstFollowup" className="text-xs">首次跟进（天）</Label>
                <Input id="firstFollowup" type="number" defaultValue={3} className="text-sm" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="secondFollowup" className="text-xs">第二次跟进（天）</Label>
                <Input id="secondFollowup" type="number" defaultValue={7} className="text-sm" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="thirdFollowup" className="text-xs">第三次跟进（天）</Label>
                <Input id="thirdFollowup" type="number" defaultValue={7} className="text-sm" />
              </div>
            </CardContent>
          )}
        </Card>

        {/* 关于 */}
        <Card className="overflow-hidden">
          <button
            type="button"
            onClick={() => toggleSection('about')}
            className="w-full text-left"
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-pink-500/10 flex items-center justify-center">
                    <Heart className="w-4 h-4 text-pink-500" />
                  </div>
                  <div>
                    <CardTitle className="text-base">关于红人推广看板</CardTitle>
                    <CardDescription className="text-xs mt-0.5">版本信息和功能预告</CardDescription>
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
            <CardContent className="pt-0 space-y-4">
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

              <div className="rounded-lg bg-muted/50 p-3 space-y-2">
                <h4 className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  已完成功能
                </h4>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li>Gmail 邮件集成</li>
                  <li>DeepSeek AI 辅助写邮件</li>
                  <li>邮件翻译功能</li>
                  <li>飞书多维表格内嵌</li>
                  <li>提示词自定义管理</li>
                </ul>
              </div>
            </CardContent>
          )}
        </Card>

        {/* YouTube - 即将推出 */}
        <Card className="overflow-hidden opacity-60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-red-600/10 flex items-center justify-center">
                  <Database className="w-4 h-4 text-red-600" />
                </div>
                <div>
                  <CardTitle className="text-base">YouTube 数据</CardTitle>
                  <CardDescription className="text-xs mt-0.5">自动获取视频观看、点赞、评论数据</CardDescription>
                </div>
              </div>
              <Badge variant="secondary" className="text-xs">即将推出</Badge>
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
