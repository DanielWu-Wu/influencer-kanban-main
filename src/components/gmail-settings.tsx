'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useGmailAuth, useGmailSettings } from '@/lib/data';
import {
  Mail,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Plug,
  Settings as SettingsIcon,
  HelpCircle,
  LogOut,
} from 'lucide-react';

const text = {
  title: 'Gmail 连接',
  desc: '一键授权 Gmail，用于读取红人邮件、生成回复建议，并保存草稿。',
  connected: '已连接',
  disconnect: '断开连接',
  connect: '连接 Gmail',
  connectDesc: '点击后会跳转到 Google 授权页面。授权完成后会自动回到当前应用。',
  guide: '部署配置指南',
  callback: 'Google OAuth 回调地址',
  copy: '复制',
  copied: '已复制',
  step1: '在 Google Cloud Console 创建项目，并启用 Gmail API。',
  step2: 'OAuth consent screen 选择 External，并添加你的 Gmail 测试账号。',
  step3: '创建 OAuth Client，Application type 选择 Web application。',
  step4: '把下方回调地址加入 Authorized redirect URIs。',
  step5: '在 Vercel 环境变量中填写 GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、GOOGLE_REDIRECT_URI。',
  aiTitle: 'AI 邮件能力',
  aiDesc: 'Gmail 连接后，可以结合邮件内容生成中文摘要、谈判回复和跟进邮件草稿。',
  aiReady: 'AI 接口使用 OpenAI 兼容配置，可接 DeepSeek / OpenAI / 其他模型。',
  mailSettings: '邮件设置',
  autoCheck: '自动检查新邮件',
  autoCheckDesc: '定期检查 Gmail 新邮件',
  notify: '新邮件通知',
  notifyDesc: '收到新邮件时显示提醒',
  match: '自动匹配红人',
  matchDesc: '将邮件发件人与红人数据库匹配',
  enabled: '已开启',
  disabled: '已关闭',
  interval: '检查间隔（分钟）',
};

export function GmailSettings() {
  const { auth, disconnect } = useGmailAuth();
  const { settings, updateSettings } = useGmailSettings();
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState('');

  const redirectUri =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/auth/callback`
      : 'https://your-domain.com/api/auth/callback';

  const handleConnect = () => {
    window.location.href = '/api/auth/google';
  };

  const copyToClipboard = (value: string, id: string) => {
    navigator.clipboard.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="w-5 h-5 text-red-500" />
            {text.title}
          </CardTitle>
          <CardDescription>{text.desc}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {auth?.isConnected ? (
            <div className="flex items-center justify-between p-4 bg-green-50 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium text-green-900">{text.connected}</p>
                  <p className="text-sm text-green-700">{auth.email || 'Gmail account'}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={disconnect}>
                <LogOut className="w-4 h-4 mr-2" />
                {text.disconnect}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-red-50 p-4">
                <p className="text-sm text-red-900">{text.connectDesc}</p>
              </div>
              <Button className="w-full bg-red-500 hover:bg-red-600" onClick={handleConnect}>
                <Plug className="w-4 h-4 mr-2" />
                {text.connect}
              </Button>
            </div>
          )}

          <div className="rounded-xl bg-muted/50 p-4 space-y-3">
            <button className="w-full flex items-center justify-between" onClick={() => setShowGuide(!showGuide)}>
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">{text.guide}</span>
              </div>
              {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showGuide && (
              <div className="space-y-4 text-sm pt-2 border-t">
                <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                  <li>{text.step1}</li>
                  <li>{text.step2}</li>
                  <li>{text.step3}</li>
                  <li>{text.step4}</li>
                  <li>{text.step5}</li>
                </ol>

                <div className="space-y-2">
                  <Label>{text.callback}</Label>
                  <div className="bg-background p-2 rounded flex items-center gap-2 border">
                    <code className="text-xs flex-1 break-all">{redirectUri}</code>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copyToClipboard(redirectUri, 'uri')}>
                      {copied === 'uri' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{copied === 'uri' ? text.copied : text.copy}</p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Badge className="bg-primary/10 text-primary border-none">AI</Badge>
            {text.aiTitle}
          </CardTitle>
          <CardDescription>{text.aiDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-green-50 p-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700">{text.aiReady}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" />
            {text.mailSettings}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingToggle
            title={text.autoCheck}
            description={text.autoCheckDesc}
            enabled={settings.autoCheck}
            onToggle={() => updateSettings({ autoCheck: !settings.autoCheck })}
          />

          {settings.autoCheck && (
            <div className="space-y-2">
              <Label>{text.interval}</Label>
              <div className="flex gap-2">
                {[1, 5, 15, 30].map((minutes) => (
                  <Button
                    key={minutes}
                    variant={settings.checkInterval === minutes ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateSettings({ checkInterval: minutes })}
                  >
                    {minutes}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <SettingToggle
            title={text.notify}
            description={text.notifyDesc}
            enabled={settings.notifyOnNewEmail}
            onToggle={() => updateSettings({ notifyOnNewEmail: !settings.notifyOnNewEmail })}
          />

          <SettingToggle
            title={text.match}
            description={text.matchDesc}
            enabled={settings.matchWithInfluencers}
            onToggle={() => updateSettings({ matchWithInfluencers: !settings.matchWithInfluencers })}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SettingToggle({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onToggle}>
        {enabled ? text.enabled : text.disabled}
      </Button>
    </div>
  );
}
