'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ACCOUNT_SCOPE_CHANGED_EVENT, getAccountCacheScope } from '@/lib/account-cache-scope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type TranscriptSettingsProps = { expanded: boolean; onToggle: () => void };
const subscribeScope = (callback: () => void) => {
  window.addEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, callback);
  return () => window.removeEventListener(ACCOUNT_SCOPE_CHANGED_EVENT, callback);
};
export function ApifyTranscriptSettings(props: TranscriptSettingsProps) {
  const account = useSyncExternalStore(subscribeScope, getAccountCacheScope, () => 'signed-out');
  return <AccountTranscriptSettings key={account} account={account} {...props} />;
}
function AccountTranscriptSettings({ expanded, onToggle, account }: TranscriptSettingsProps & { account: string }) {
  const [token, setToken] = useState('');
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    if (!expanded) return;
    void fetch('/api/secrets/apify-transcript').then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!active) return;
      setConfigured(data.configured); setEnabled(data.enabled); setLoaded(true);
    }).catch(() => { if (active) setMessage('字幕设置读取失败，请收起后重新打开。'); });
    return () => { active = false; };
  }, [expanded]);
  async function save(test: boolean) {
    if (getAccountCacheScope() !== account) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/secrets/apify-transcript', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, enabled, test }) });
      const data = await response.json();
      if (getAccountCacheScope() !== account) return;
      if (!response.ok) throw new Error(data.error);
      if (!test) { setConfigured(data.configured); setToken(''); }
      setMessage(test ? '账号连接正常；没有抓取字幕，没有启动收费任务。' : '字幕设置已保存到当前账号。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '连接失败，请重试。'); }
    finally { setBusy(false); }
  }
  return <Card>
    <button type="button" onClick={onToggle} className="light-control w-full text-left"><CardHeader>
      <CardTitle className="text-base">YouTube 字幕服务 · Apify</CardTitle>
      <CardDescription>用于合作视频检测，按需读取公开字幕</CardDescription>
    </CardHeader></button>
    {expanded && <CardContent className="space-y-4">
      <p className="text-xs text-muted-foreground">固定使用 scrape-creators / best-youtube-transcripts-scraper。只读取已有字幕，不转写音频。实际费用以 Apify 账单为准。</p>
      <div className="space-y-2"><Label htmlFor="apify-token">Apify API Token {configured ? '（已保存，留空不更换）' : ''}</Label><Input id="apify-token" type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder={configured ? '••••••••（服务端保存）' : '填写你的 Apify Token'} /></div>
      <div className="flex items-center gap-3"><Switch id="apify-enabled" checked={enabled} onCheckedChange={setEnabled} /><Label htmlFor="apify-enabled">检测时允许按需抓取字幕</Label></div>
      <p className="text-xs text-muted-foreground">每次检测最多抓取 100 条字幕、调用 100 次 AI；达到上限会保留待处理结果。字幕每批提交设置 0.05 美元的运行费用限制；实际总费用以服务商账单为准。</p>
      {message && <p role="status" className="text-sm">{message}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy || !loaded} onClick={() => void save(true)}>测试账号连接</Button><Button disabled={busy || !loaded} onClick={() => void save(false)}>保存字幕设置</Button></div>
    </CardContent>}
  </Card>;
}
