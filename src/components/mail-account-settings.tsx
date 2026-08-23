'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  LoaderCircle,
  LogOut,
  Mail,
  Plug,
  Server,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGmailAuth } from '@/lib/data';
import { DEFAULT_TENCENT_EXMAIL_CONFIG } from '@/lib/mail-accounts';
import { useMailAccounts } from './mail-account-provider';

type ConnectionResult = { success: boolean; message: string } | null;

export function MailAccountSettings({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { auth: gmailAuth, disconnect: disconnectGmail } = useGmailAuth();
  const {
    accounts,
    refreshAccounts,
    disconnectTencentAccount,
    setDefaultAccount,
  } = useMailAccounts();
  const tencentAccount = useMemo(
    () => accounts.find((account) => account.provider === 'tencent_exmail') || null,
    [accounts],
  );
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('腾讯企业邮箱');
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [result, setResult] = useState<ConnectionResult>(null);

  const requestTencent = async (action: 'test' | 'save') => {
    const response = await fetch('/api/mail/accounts/tencent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, email, displayName, password }),
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(data.error || '腾讯企业邮箱连接失败。');
    return data;
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      await requestTencent('test');
      setResult({ success: true, message: 'IMAP 和 SMTP 认证均成功；没有读取、创建或发送邮件。' });
    } catch (error) {
      setResult({ success: false, message: error instanceof Error ? error.message : '连接测试失败。' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      await requestTencent('save');
      await refreshAccounts();
      setPassword('');
      setResult({ success: true, message: '腾讯企业邮箱已安全保存；收信、草稿和人工确认后发送均可用。' });
    } catch (error) {
      setResult({ success: false, message: error instanceof Error ? error.message : '保存邮箱失败。' });
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnectTencent = async () => {
    if (!tencentAccount) return;
    const confirmed = window.confirm(`确定断开 ${tencentAccount.email} 吗？系统会删除已保存的客户端密码。`);
    if (!confirmed) return;
    setDisconnecting(true);
    setResult(null);
    try {
      await disconnectTencentAccount(tencentAccount.mailAccountId);
      setEmail('');
      setPassword('');
      setResult({ success: true, message: '腾讯企业邮箱已断开，已保存的客户端密码已删除。' });
    } catch (error) {
      setResult({ success: false, message: error instanceof Error ? error.message : '断开邮箱失败。' });
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <Card className="overflow-hidden rounded-xl border-border/55 bg-white/84 shadow-[var(--glass-shadow-soft)] backdrop-blur-xl">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10">
                <Mail className="h-4 w-4 text-red-500" />
              </div>
              <div>
                <CardTitle className="text-base">邮箱账号管理</CardTitle>
                <CardDescription className="mt-0.5 text-xs">连接 Gmail 和腾讯企业邮箱，并设置默认邮箱</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {accounts.some((account) => account.connectionStatus === 'connected') && (
                <Badge variant="secondary" className="rounded-md bg-emerald-50 text-xs text-emerald-700">
                  {accounts.filter((account) => account.connectionStatus === 'connected').length} 个已连接
                </Badge>
              )}
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="space-y-5 pt-0">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Gmail</p>
                <p className="text-xs text-muted-foreground">通过 Google 官方 OAuth 授权</p>
              </div>
              {gmailAuth?.isConnected && <Badge className="bg-emerald-600">已连接</Badge>}
            </div>
            {gmailAuth?.isConnected ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-emerald-900">{gmailAuth.email || 'Google 账号'}</p>
                  <p className="text-xs text-emerald-700">收信、草稿和发送功能可用</p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {accounts.find((account) => account.provider === 'gmail' && account.isDefault) ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const gmail = accounts.find((account) => account.provider === 'gmail');
                        if (gmail) void setDefaultAccount(gmail.mailAccountId);
                      }}
                    >设为默认</Button>
                  )}
                  <Button variant="outline" size="sm" onClick={disconnectGmail}>
                    <LogOut className="h-4 w-4" />断开
                  </Button>
                </div>
              </div>
            ) : (
              <Button className="h-10 w-full gap-2 bg-red-500 hover:bg-red-600" onClick={() => { window.location.href = '/api/auth/google'; }}>
                <Plug className="h-4 w-4" />连接 Gmail
              </Button>
            )}
          </div>

          <div className="border-t pt-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">腾讯企业邮箱</p>
                <p className="text-xs text-muted-foreground">支持收信、会话、草稿，以及人工确认后的直接发送</p>
              </div>
              {tencentAccount && <Badge className="bg-emerald-600">已连接</Badge>}
            </div>

            {tencentAccount ? (
              <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-emerald-900">{tencentAccount.email}</p>
                    <p className="mt-1 text-xs text-emerald-700">
                      上次验证：{tencentAccount.lastTestedAt ? new Date(tencentAccount.lastTestedAt).toLocaleString('zh-CN') : '未记录'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {!tencentAccount.isDefault && (
                      <Button variant="outline" size="sm" onClick={() => void setDefaultAccount(tencentAccount.mailAccountId)}>设为默认</Button>
                    )}
                    <Button variant="outline" size="sm" disabled={disconnecting} onClick={handleDisconnectTencent}>
                      {disconnecting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                      断开
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 rounded-lg border border-white/70 bg-white/60 p-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="tencent-email">邮箱地址</Label>
                    <Input id="tencent-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" autoComplete="username" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tencent-display-name">显示名称</Label>
                    <Input id="tencent-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={80} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tencent-password">客户端密码或授权码</Label>
                  <Input id="tencent-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
                  <p className="text-xs leading-5 text-muted-foreground">凭证只提交给本项目服务端，并使用现有服务器加密密钥保存；页面不会再次显示它。</p>
                </div>
                <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600 md:grid-cols-2">
                  <span className="flex items-center gap-2"><Server className="h-3.5 w-3.5" />IMAP：{DEFAULT_TENCENT_EXMAIL_CONFIG.incomingHost}:{DEFAULT_TENCENT_EXMAIL_CONFIG.incomingPort} SSL</span>
                  <span className="flex items-center gap-2"><Server className="h-3.5 w-3.5" />SMTP：{DEFAULT_TENCENT_EXMAIL_CONFIG.outgoingHost}:{DEFAULT_TENCENT_EXMAIL_CONFIG.outgoingPort} SSL</span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button variant="outline" className="flex-1" disabled={testing || saving || !email.trim() || !password.trim()} onClick={handleTest}>
                    {testing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                    测试收信和发信连接
                  </Button>
                  <Button className="flex-1" disabled={testing || saving || !email.trim() || !password.trim()} onClick={handleSave}>
                    {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    测试并保存邮箱
                  </Button>
                </div>
              </div>
            )}
          </div>

          {result && (
            <div className={`rounded-lg border p-3 text-sm ${result.success ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
              {result.message}
            </div>
          )}
          <div className="flex gap-2 rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-xs leading-5 text-blue-800">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            连接测试只验证登录权限，不会发送测试邮件，也不会创建真实草稿。
          </div>
        </CardContent>
      )}
    </Card>
  );
}
