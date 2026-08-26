'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettings } from '@/lib/data';
import { ProductDatabaseSettings } from '@/components/product-database-settings';
import { CloudSyncSettings } from '@/components/cloud-sync-settings';
import { FeishuSettings } from '@/components/feishu-settings';
import { YouTubeApiSettings } from '@/components/youtube-api-settings';
import { MailAccountSettings } from '@/components/mail-account-settings';
import {
  AI_PROVIDER_PRESETS,
  applyAIProviderPreset,
  hasAIConfigErrors,
  inferAIProviderPreset,
  validateAIProviderConfig,
  type AIConfigValidation,
  type AIProviderPresetId,
} from '@/lib/ai-provider-config';
import { AI_CONNECTION_TEST_ACTION } from '@/lib/ai-request-actions';
import { APP_RELEASES, CURRENT_APP_RELEASE } from '@/lib/app-release';
import {
  Settings, Zap,
  CheckCircle2, AlertTriangle,
  Plug, RefreshCw, Save, HelpCircle, Cpu,
  ChevronDown, ChevronUp, Info, User, Clock, Heart, KeyRound, SlidersHorizontal
} from 'lucide-react';

const STORED_AI_KEY = '••••••••••••';

type VerifiedModelConfig = {
  apiUrl: string;
  modelName: string;
  verifiedAt: string;
};

export function SettingsPanel() {
  const { settings, saveSettings, loading: settingsLoading } = useSettings();
  const [brandName, setBrandName] = useState(settings.brandName || '');
  const [senderName, setSenderName] = useState(settings.senderName || '');
  const modelProvider = 'custom' as const;
  const [customApiUrl, setCustomApiUrl] = useState(settings.customApiUrl || '');
  const [customApiKey, setCustomApiKey] = useState(
    settings.customApiKey || (settings.customApiKeyConfigured ? STORED_AI_KEY : ''),
  );
  const [customModelName, setCustomModelName] = useState(settings.customModelName || '');
  const [aiProviderPreset, setAiProviderPreset] = useState<AIProviderPresetId>(() => (
    inferAIProviderPreset(settings.customApiUrl, settings.aiProviderPreset)
  ));
  const [advancedModelSettingsOpen, setAdvancedModelSettingsOpen] = useState(() => (
    inferAIProviderPreset(settings.customApiUrl, settings.aiProviderPreset) === 'custom'
  ));
  const [modelFieldErrors, setModelFieldErrors] = useState<AIConfigValidation>({});
  const [verifiedModelConfig, setVerifiedModelConfig] = useState<VerifiedModelConfig | null>(() => {
    if (
      settings.customApiVerifiedAt
      && settings.customApiVerifiedUrl === settings.customApiUrl?.trim()
      && settings.customApiVerifiedModel === settings.customModelName?.trim()
    ) {
      return {
        apiUrl: String(settings.customApiVerifiedUrl),
        modelName: String(settings.customApiVerifiedModel),
        verifiedAt: settings.customApiVerifiedAt,
      };
    }
    return null;
  });
  const [testingModel, setTestingModel] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const hasConfiguredApiKey = customApiKey === STORED_AI_KEY
    || Boolean(customApiKey.trim())
    || Boolean(settings.customApiKeyConfigured);
  const modelConfigComplete = Boolean(
    customApiUrl.trim() && customModelName.trim() && hasConfiguredApiKey,
  );
  const selectedProvider = AI_PROVIDER_PRESETS[aiProviderPreset];
  const selectedProviderHasModel = selectedProvider.models.some(
    (model) => model.id === customModelName.trim(),
  );
  const manualModelEntry = aiProviderPreset === 'custom' || !selectedProviderHasModel;
  const verifiedModelConfigSaved = Boolean(
    verifiedModelConfig
    && settings.customApiVerifiedAt === verifiedModelConfig.verifiedAt
    && settings.customApiVerifiedUrl === verifiedModelConfig.apiUrl
    && settings.customApiVerifiedModel === verifiedModelConfig.modelName,
  );

  useEffect(() => {
    if (settingsLoading) return;
    setBrandName(settings.brandName || '');
    setSenderName(settings.senderName || '');
    setCustomApiUrl(settings.customApiUrl || '');
    setCustomApiKey(
      settings.customApiKey || (settings.customApiKeyConfigured ? STORED_AI_KEY : ''),
    );
    setCustomModelName(settings.customModelName || '');
    setAiProviderPreset(inferAIProviderPreset(settings.customApiUrl, settings.aiProviderPreset));
    if (
      settings.customApiVerifiedAt
      && settings.customApiVerifiedUrl === settings.customApiUrl?.trim()
      && settings.customApiVerifiedModel === settings.customModelName?.trim()
    ) {
      setVerifiedModelConfig({
        apiUrl: String(settings.customApiVerifiedUrl),
        modelName: String(settings.customApiVerifiedModel),
        verifiedAt: settings.customApiVerifiedAt,
      });
    } else {
      setVerifiedModelConfig(null);
    }
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

  const invalidateModelVerification = () => {
    setModelTestResult(null);
    setModelFieldErrors({});
    setVerifiedModelConfig(null);
  };

  const handleProviderPresetChange = (nextProvider: AIProviderPresetId) => {
    const next = applyAIProviderPreset(
      nextProvider,
      customApiUrl,
      customModelName,
      aiProviderPreset,
    );
    setAiProviderPreset(nextProvider);
    setCustomApiUrl(next.apiUrl);
    setCustomModelName(next.modelName);
    setAdvancedModelSettingsOpen(nextProvider === 'custom');
    invalidateModelVerification();
  };

  const handleModelNameChange = (nextModelName: string) => {
    setCustomModelName(nextModelName === '__custom__' ? '' : nextModelName);
    invalidateModelVerification();
  };

  const handleApiUrlChange = (nextApiUrl: string) => {
    setCustomApiUrl(nextApiUrl);
    if (aiProviderPreset !== 'custom' && nextApiUrl.trim() !== selectedProvider.apiUrl) {
      setAiProviderPreset('custom');
    }
    invalidateModelVerification();
  };

  const handleSaveAll = async () => {
    if (settingsLoading) return;
    const hasAnyModelConfig = Boolean(
      customApiUrl.trim()
      || customModelName.trim()
      || customApiKey.trim()
      || settings.customApiKeyConfigured,
    );
    if (hasAnyModelConfig) {
      const validation = validateAIProviderConfig({
        apiUrl: customApiUrl,
        modelName: customModelName,
        hasApiKey: hasConfiguredApiKey,
      });
      if (hasAIConfigErrors(validation)) {
        setModelFieldErrors(validation);
        setModelTestResult({ success: false, message: '模型配置尚未填写完整，请检查标红字段。' });
        setExpandedSection('model');
        if (validation.apiUrl) setAdvancedModelSettingsOpen(true);
        return;
      }
    }

    const apiKeyWasReplaced = Boolean(
      customApiKey && customApiKey !== STORED_AI_KEY,
    );
    if (
      modelProvider === 'custom' &&
      apiKeyWasReplaced
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

    const verifiedCurrentConfig = verifiedModelConfig
      && verifiedModelConfig.apiUrl === customApiUrl.trim()
      && verifiedModelConfig.modelName === customModelName.trim()
      ? verifiedModelConfig
      : null;

    try {
      await saveSettings({
        brandName,
        senderName,
        modelProvider,
        aiProviderPreset,
        customApiUrl,
        customApiKey: undefined,
        customApiKeyConfigured:
          settings.customApiKeyConfigured ||
          (modelProvider === 'custom' && (apiKeyWasReplaced || Boolean(customApiKey))),
        customModelName,
        customApiVerifiedAt: verifiedCurrentConfig?.verifiedAt || '',
        customApiVerifiedUrl: verifiedCurrentConfig?.apiUrl || '',
        customApiVerifiedModel: verifiedCurrentConfig?.modelName || '',
      });
    } catch (error) {
      setModelTestResult({
        success: false,
        message: error instanceof Error ? `基础设置保存失败：${error.message}` : '基础设置保存失败，请稍后重试。',
      });
      return;
    }
    if (verifiedCurrentConfig) {
      setModelTestResult({ success: true, message: '连接已验证，配置已经保存。' });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleTestModel = async () => {
    const validation = validateAIProviderConfig({
      apiUrl: customApiUrl,
      modelName: customModelName,
      hasApiKey: hasConfiguredApiKey,
    });
    setModelFieldErrors(validation);
    if (hasAIConfigErrors(validation)) {
      setModelTestResult({ success: false, message: '模型配置尚未填写完整，请检查标红字段。' });
      if (validation.apiUrl) setAdvancedModelSettingsOpen(true);
      return;
    }

    setTestingModel(true);
    setModelTestResult(null);

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: AI_CONNECTION_TEST_ACTION,
          modelProvider,
          customApiUrl,
          customModelName,
          customApiKey: customApiKey && customApiKey !== STORED_AI_KEY
            ? customApiKey.trim()
            : undefined,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setVerifiedModelConfig({
          apiUrl: customApiUrl.trim(),
          modelName: customModelName.trim(),
          verifiedAt: new Date().toISOString(),
        });
        setModelTestResult({ success: true, message: '连接测试成功。请点击右上角“保存全部”完成保存。' });
      } else {
        setVerifiedModelConfig(null);
        setModelTestResult({ success: false, message: data.error || '模型连接失败' });
      }
    } catch (error) {
      setVerifiedModelConfig(null);
      setModelTestResult({
        success: false,
        message: error instanceof Error ? error.message : '连接失败，请检查配置',
      });
    } finally {
      setTestingModel(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部标题栏 - 固定不滚动 */}
      <div className="material-toolbar mb-4 flex flex-shrink-0 items-center justify-between rounded-xl border border-border/50 px-4 py-3 shadow-[var(--glass-shadow-soft)]">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Settings className="w-5 h-5" />
            设置
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">管理产品资料、集成连接、品牌信息和模型配置</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSaveAll}
            size="sm"
            className="h-10 gap-1.5 rounded-lg shadow-apple"
            disabled={settingsLoading}
          >
            {saved ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                基础设置已保存
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {settingsLoading ? '正在读取设置…' : '保存基础设置'}
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" className="h-10" onClick={() => { window.location.href = '/change-password'; }}>
            <KeyRound data-icon="inline-start" />修改密码
          </Button>
        </div>
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

        <MailAccountSettings
          expanded={expandedSection === 'gmail'}
          onToggle={() => toggleSection('gmail')}
        />

        {/* 模型 API 设置 */}
        <Card className="overflow-hidden rounded-xl border-border/55 bg-white/84 shadow-[var(--glass-shadow-soft)] backdrop-blur-xl">
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
                  {verifiedModelConfig ? (
                    <Badge variant="secondary" className="rounded-md text-xs">
                      {verifiedModelConfigSaved ? '已验证' : '已验证 · 待保存'}
                    </Badge>
                  ) : modelConfigComplete ? (
                    <Badge variant="outline" className="rounded-md text-xs">待测试</Badge>
                  ) : (
                    <Badge variant="outline" className="rounded-md text-xs">未配置</Badge>
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
            <CardContent className="flex flex-col gap-5 pt-0">
              <Badge variant="outline" className="w-fit gap-1 rounded-md border-white/70 bg-white/55 text-xs">
                <Info className="size-3" />
                用于「翻译」「AI 回复」「开发信」和「Follow Up」
              </Badge>

              <Alert className="border-primary/20 bg-primary/5">
                <HelpCircle />
                <AlertTitle>三步完成模型配置</AlertTitle>
                <AlertDescription>
                  <ol className="list-inside list-decimal">
                    <li>选择模型服务，官方地址会自动填写。</li>
                    <li>粘贴服务商提供的 API Key，不需要添加 Bearer。</li>
                    <li>测试成功后，点击右上角“保存全部”。</li>
                  </ol>
                </AlertDescription>
              </Alert>

              <FieldGroup className="gap-5">
                <Field>
                  <FieldLabel htmlFor="ai-provider-preset">模型服务</FieldLabel>
                  <Select
                    value={aiProviderPreset}
                    onValueChange={(value) => handleProviderPresetChange(value as AIProviderPresetId)}
                  >
                    <SelectTrigger id="ai-provider-preset" className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {Object.values(AI_PROVIDER_PRESETS).map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>{selectedProvider.description}</FieldDescription>
                </Field>

                <Field data-invalid={Boolean(modelFieldErrors.apiKey)}>
                  <FieldLabel htmlFor="custom-api-key">API Key</FieldLabel>
                  <Input
                    id="custom-api-key"
                    type="password"
                    autoComplete="off"
                    placeholder="粘贴服务商提供的 API Key"
                    value={customApiKey}
                    aria-invalid={Boolean(modelFieldErrors.apiKey)}
                    onChange={(event) => {
                      setCustomApiKey(event.target.value);
                      invalidateModelVerification();
                    }}
                    onFocus={(event) => {
                      if (customApiKey === STORED_AI_KEY) event.currentTarget.select();
                    }}
                    className="h-10 rounded-lg bg-white/75 text-sm"
                  />
                  <FieldDescription>
                    Key 只保存到当前账号的私有云端空间，不会共享给其他团队成员。
                  </FieldDescription>
                  <FieldError>{modelFieldErrors.apiKey}</FieldError>
                </Field>

                <Field data-invalid={Boolean(modelFieldErrors.modelName)}>
                  <FieldLabel htmlFor={manualModelEntry ? 'custom-model-name' : 'model-preset'}>使用模型</FieldLabel>
                  {aiProviderPreset !== 'custom' ? (
                    <Select
                      value={manualModelEntry ? '__custom__' : customModelName}
                      onValueChange={handleModelNameChange}
                    >
                      <SelectTrigger
                        id="model-preset"
                        className="h-10 w-full"
                        aria-invalid={Boolean(modelFieldErrors.modelName)}
                      >
                        <SelectValue placeholder="选择模型" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {selectedProvider.models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              {model.label}{model.recommended ? '（推荐）' : ''}
                            </SelectItem>
                          ))}
                          <SelectItem value="__custom__">手动填写模型名称</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : null}
                  {manualModelEntry ? (
                    <Input
                      id="custom-model-name"
                      type="text"
                      placeholder="例如：供应商提供的模型 ID"
                      value={customModelName}
                      aria-invalid={Boolean(modelFieldErrors.modelName)}
                      onChange={(event) => handleModelNameChange(event.target.value)}
                      className="h-10 rounded-lg bg-white/75 text-sm"
                    />
                  ) : null}
                  <FieldDescription>
                    {selectedProvider.models.find((model) => model.id === customModelName)?.description
                      || '请填写接口服务商提供的完整模型 ID。'}
                  </FieldDescription>
                  <FieldError>{modelFieldErrors.modelName}</FieldError>
                </Field>

                <Collapsible open={advancedModelSettingsOpen} onOpenChange={setAdvancedModelSettingsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="w-full justify-between">
                      <span className="flex items-center gap-2">
                        <SlidersHorizontal data-icon="inline-start" />
                        高级设置
                      </span>
                      {advancedModelSettingsOpen ? <ChevronUp /> : <ChevronDown />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <Field data-invalid={Boolean(modelFieldErrors.apiUrl)}>
                      <FieldLabel htmlFor="custom-api-url">完整 API 请求地址</FieldLabel>
                      <Input
                        id="custom-api-url"
                        type="url"
                        placeholder="https://example.com/v1/chat/completions"
                        value={customApiUrl}
                        aria-invalid={Boolean(modelFieldErrors.apiUrl)}
                        onChange={(event) => handleApiUrlChange(event.target.value)}
                        className="h-10 rounded-lg bg-white/75 text-sm"
                      />
                      <FieldDescription>
                        系统会直接请求这个地址，结尾通常是 /chat/completions。修改官方地址会切换为其他兼容接口。
                      </FieldDescription>
                      <FieldError>{modelFieldErrors.apiUrl}</FieldError>
                    </Field>
                  </CollapsibleContent>
                </Collapsible>

                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestModel}
                  disabled={testingModel}
                  className="h-10 w-full rounded-lg bg-white/75"
                >
                  {testingModel ? (
                    <RefreshCw data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <Plug data-icon="inline-start" />
                  )}
                  {testingModel ? '正在测试连接' : '测试连接'}
                </Button>

                {modelTestResult ? (
                  <Alert
                    variant={modelTestResult.success ? 'default' : 'destructive'}
                    className={modelTestResult.success ? 'border-primary/20 bg-primary/5' : undefined}
                  >
                    {modelTestResult.success ? <CheckCircle2 /> : <AlertTriangle />}
                    <AlertTitle>{modelTestResult.success ? '连接测试成功' : '连接测试失败'}</AlertTitle>
                    <AlertDescription>{modelTestResult.message}</AlertDescription>
                  </Alert>
                ) : null}
              </FieldGroup>
            </CardContent>
          )}
        </Card>

        {/* 品牌信息 */}
        <Card className="overflow-hidden rounded-xl border-border/55 bg-white/84 shadow-[var(--glass-shadow-soft)] backdrop-blur-xl">
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
        <Card className="overflow-hidden rounded-xl border-border/55 bg-white/84 shadow-[var(--glass-shadow-soft)] backdrop-blur-xl">
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
        <Card className="overflow-hidden rounded-xl border-border/55 bg-white/84 shadow-[var(--glass-shadow-soft)] backdrop-blur-xl">
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
                    <CardDescription className="mt-0.5 text-xs">版本信息和更新记录</CardDescription>
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
                  <span>{CURRENT_APP_RELEASE.version}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">技术栈</span>
                  <span>Next.js + TypeScript</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <Zap className="w-3.5 h-3.5 text-primary" />
                  版本更新记录
                </h4>
                {APP_RELEASES.map((release) => (
                  <section key={release.version} className="border-t border-border/55 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <h5 className="text-sm font-medium text-foreground">
                        {release.version} · {release.title}
                      </h5>
                      <time className="text-xs tabular-nums text-muted-foreground" dateTime={release.releasedAt}>
                        {release.releasedAt}
                      </time>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {release.highlights.map((highlight) => (
                        <li key={highlight} className="flex gap-2 text-xs leading-5 text-muted-foreground">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                          <span>{highlight}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </CardContent>
          )}
        </Card>

      </div>
    </div>
  );
}
