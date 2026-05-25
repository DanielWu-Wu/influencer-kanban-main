'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { useGmailAuth, useGmailSettings } from '@/lib/data';
import {
  Mail, CheckCircle2, AlertTriangle, ExternalLink,
  ChevronDown, ChevronUp, Copy, Check, Plug, Loader2,
  Settings as SettingsIcon, HelpCircle
} from 'lucide-react';

export function GmailSettings() {
  const { auth, connect, disconnect } = useGmailAuth();
  const { settings, updateSettings } = useGmailSettings();
  
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState('');

  const handleConnect = async () => {
    if (!clientId || !clientSecret) return;
    
    setConnecting(true);
    // TODO: 实现 OAuth 流程
    // 实际实现需要：
    // 1. 构建 OAuth URL
    // 2. 打开授权页面
    // 3. 处理回调
    // 4. 保存 token
    
    // 模拟连接
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    connect({
      isConnected: true,
      email: 'your-email@gmail.com',
    });
    
    setConnecting(false);
  };

  const handleDisconnect = () => {
    disconnect();
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(''), 2000);
  };

  // 获取网站域名（演示用）
  const redirectUri = typeof window !== 'undefined' 
    ? `${window.location.origin}/api/auth/gmail/callback`
    : 'https://your-domain.com/api/auth/gmail/callback';

  return (
    <div className="space-y-6">
      {/* Gmail 连接状态 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Mail className="w-5 h-5 text-red-500" />
            Gmail 连接
          </CardTitle>
          <CardDescription>
            连接你的 Gmail 邮箱，查看与红人的邮件往来
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {auth?.isConnected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-green-50 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-green-900">已连接</p>
                    <p className="text-sm text-green-700">{auth.email}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleDisconnect}>
                  断开连接
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 配置指南 */}
              <div className="rounded-xl bg-gradient-to-r from-red-50 to-orange-50 p-4 space-y-3">
                <button 
                  className="w-full flex items-center justify-between"
                  onClick={() => setShowGuide(!showGuide)}
                >
                  <div className="flex items-center gap-2">
                    <HelpCircle className="w-4 h-4 text-red-600" />
                    <span className="font-medium text-red-900">配置指南</span>
                  </div>
                  {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                
                {showGuide && (
                  <div className="space-y-4 text-sm text-red-800 pt-2 border-t border-red-200">
                    <div className="space-y-2">
                      <h4 className="font-medium">第一步：创建 Google Cloud 项目</h4>
                      <ol className="list-decimal list-inside space-y-1 text-red-700">
                        <li>访问 <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-red-600 underline">Google Cloud Console</a></li>
                        <li>点击 "Select a project" → "New Project"</li>
                        <li>输入项目名称，点击创建</li>
                      </ol>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium">第二步：启用 Gmail API</h4>
                      <ol className="list-decimal list-inside space-y-1 text-red-700">
                        <li>在左侧菜单选择 "APIs & Services" → "Library"</li>
                        <li>搜索 "Gmail API"</li>
                        <li>点击启用 (Enable)</li>
                      </ol>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium">第三步：配置 OAuth 同意屏幕</h4>
                      <ol className="list-decimal list-inside space-y-1 text-red-700">
                        <li>选择 "APIs & Services" → "OAuth consent screen"</li>
                        <li>选择 "External" 类型</li>
                        <li>填写应用信息（名称、邮箱等）</li>
                        <li>添加 scopes: <code className="bg-red-100 px-1 rounded">gmail.readonly</code>, <code className="bg-red-100 px-1 rounded">gmail.compose</code>, <code className="bg-red-100 px-1 rounded">gmail.send</code></li>
                        <li>添加测试用户（你的 Gmail 账号）</li>
                      </ol>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium">第四步：创建 OAuth 客户端</h4>
                      <ol className="list-decimal list-inside space-y-1 text-red-700">
                        <li>选择 "APIs & Services" → "Credentials"</li>
                        <li>点击 "Create Credentials" → "OAuth client ID"</li>
                        <li>Application type: "Web application"</li>
                        <li>添加 Authorized redirect URI:</li>
                      </ol>
                      <div className="bg-white p-2 rounded flex items-center gap-2">
                        <code className="text-xs flex-1 break-all">{redirectUri}</code>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6"
                          onClick={() => copyToClipboard(redirectUri, 'uri')}
                        >
                          {copied === 'uri' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium">第五步：获取凭据</h4>
                      <p className="text-red-700">复制生成的 Client ID 和 Client Secret，填入下方</p>
                    </div>
                  </div>
                )}
              </div>

              {/* 配置表单 */}
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="client-id">Client ID</Label>
                  <Input
                    id="client-id"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="xxxxx.apps.googleusercontent.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-secret">Client Secret</Label>
                  <Input
                    id="client-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder="GOCSPX-xxxxxxxxxx"
                  />
                </div>
                <Button 
                  className="w-full bg-red-500 hover:bg-red-600"
                  onClick={handleConnect}
                  disabled={!clientId || !clientSecret || connecting}
                >
                  {connecting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      连接中...
                    </>
                  ) : (
                    <>
                      <Plug className="w-4 h-4 mr-2" />
                      连接 Gmail
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* DeepSeek AI 配置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Badge className="bg-primary/10 text-primary border-none">AI</Badge>
            DeepSeek AI 配置
          </CardTitle>
          <CardDescription>
            AI 邮件回复建议和翻译功能由 DeepSeek 驱动
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-green-50 p-3 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-700">DeepSeek AI 已内置，无需额外配置</span>
          </div>
          <p className="text-xs text-muted-foreground">
            DeepSeek AI 已集成在应用中，AI 邮件回复建议、邮件翻译等功能可直接使用。
          </p>
        </CardContent>
      </Card>

      {/* 邮件设置 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" />
            邮件设置
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">自动检查新邮件</p>
              <p className="text-sm text-muted-foreground">定期检查 Gmail 新邮件</p>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => updateSettings({ autoCheck: !settings.autoCheck })}
            >
              {settings.autoCheck ? '已开启' : '已关闭'}
            </Button>
          </div>
          
          {settings.autoCheck && (
            <div className="space-y-2">
              <Label>检查间隔（分钟）</Label>
              <div className="flex gap-2">
                {[1, 5, 15, 30].map(m => (
                  <Button
                    key={m}
                    variant={settings.checkInterval === m ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => updateSettings({ checkInterval: m })}
                  >
                    {m}分钟
                  </Button>
                ))}
              </div>
            </div>
          )}
          
          <Separator />
          
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">新邮件通知</p>
              <p className="text-sm text-muted-foreground">收到新邮件时显示通知</p>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => updateSettings({ notifyOnNewEmail: !settings.notifyOnNewEmail })}
            >
              {settings.notifyOnNewEmail ? '已开启' : '已关闭'}
            </Button>
          </div>
          
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium">自动匹配红人</p>
              <p className="text-sm text-muted-foreground">将邮件发件人与红人数据库匹配</p>
            </div>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => updateSettings({ matchWithInfluencers: !settings.matchWithInfluencers })}
            >
              {settings.matchWithInfluencers ? '已开启' : '已关闭'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
