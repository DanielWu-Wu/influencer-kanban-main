'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Save,
  Youtube,
} from 'lucide-react';
import { useSettings } from '@/lib/data';

const STORED_YOUTUBE_KEY = '••••••••••••';

interface YouTubeApiSettingsProps {
  expanded: boolean;
  onToggle: () => void;
}

export function YouTubeApiSettings({ expanded, onToggle }: YouTubeApiSettingsProps) {
  const { settings, updateSettings, loading } = useSettings();
  const [apiKey, setApiKey] = useState('');
  const [defaultRegion, setDefaultRegion] = useState('ES');
  const [defaultLanguage, setDefaultLanguage] = useState('es');
  const [maxSearchResults, setMaxSearchResults] = useState(25);
  const [minSubscribers, setMinSubscribers] = useState('');
  const [searchKeywords, setSearchKeywords] = useState('');
  const [autoEnrichEnabled, setAutoEnrichEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (loading) return;
    setApiKey(settings.youtubeApiKey || (settings.youtubeApiKeyConfigured ? STORED_YOUTUBE_KEY : ''));
    setDefaultRegion(settings.youtubeDefaultRegion || '');
    setDefaultLanguage(settings.youtubeDefaultLanguage || '');
    setMaxSearchResults(settings.youtubeMaxSearchResults || 25);
    setMinSubscribers(settings.youtubeMinSubscribers || '');
    setSearchKeywords(settings.youtubeSearchKeywords || '');
    setAutoEnrichEnabled(settings.youtubeAutoEnrichEnabled ?? true);
  }, [loading, settings]);

  const hasApiKey = apiKey === STORED_YOUTUBE_KEY || Boolean(apiKey.trim()) || settings.youtubeApiKeyConfigured;

  const persistSettings = async () => {
    if (apiKey && apiKey !== STORED_YOUTUBE_KEY) {
      const response = await fetch('/api/secrets/youtube-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'YouTube API Key 保存失败');
      setApiKey(STORED_YOUTUBE_KEY);
    }

    updateSettings({
      youtubeApiKey: undefined,
      youtubeApiKeyConfigured: hasApiKey,
      youtubeDefaultRegion: defaultRegion.trim().toUpperCase().slice(0, 2),
      youtubeDefaultLanguage: defaultLanguage.trim().toLowerCase(),
      youtubeSearchKeywords: searchKeywords,
      youtubeMaxSearchResults: Math.min(50, Math.max(1, Number(maxSearchResults) || 25)),
      youtubeMinSubscribers: minSubscribers,
      youtubeAutoEnrichEnabled: autoEnrichEnabled,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setJustSaved(false);
    setStatus(null);
    try {
      await persistSettings();
      setJustSaved(true);
      setStatus({
        success: true,
        message: `YouTube API 设置已保存。保存时间：${new Date().toLocaleTimeString('zh-CN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}`,
      });
      setTimeout(() => setJustSaved(false), 2500);
    } catch (error) {
      setStatus({ success: false, message: error instanceof Error ? error.message : '保存失败。' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!hasApiKey) {
      setStatus({ success: false, message: '请先填写 YouTube API Key。' });
      return;
    }

    setTesting(true);
    setStatus(null);
    try {
      if (apiKey && apiKey !== STORED_YOUTUBE_KEY) {
        await persistSettings();
      }

      const response = await fetch('/api/youtube/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey === STORED_YOUTUBE_KEY ? undefined : apiKey,
          regionCode: defaultRegion.trim().toUpperCase().slice(0, 2),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'YouTube API 测试失败');
      setStatus({
        success: true,
        message: result.regionCode
          ? `连接成功，已能读取 ${result.regionCode} 区域的 YouTube 数据。`
          : '连接成功，已能读取不限定区域的 YouTube 数据。',
      });
    } catch (error) {
      setStatus({ success: false, message: error instanceof Error ? error.message : 'YouTube API 测试失败。' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="overflow-hidden rounded-lg border-white/65 bg-white/66 shadow-apple backdrop-blur-xl">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <CardHeader className="pb-3 transition-colors hover:bg-white/45">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-600/10 ring-1 ring-red-500/10">
                <Youtube className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <CardTitle className="text-base">YouTube API</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  预留创作者搜索、频道数据补全和红人筛选能力
                </CardDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {settings.youtubeApiKeyConfigured && (
                <Badge variant="secondary" className="rounded-md bg-emerald-50 text-xs text-emerald-700">
                  已连接
                </Badge>
              )}
              {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="pt-0 space-y-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="youtube-api-key">YouTube Data API Key</Label>
              <Input
                id="youtube-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="AIza..."
                autoComplete="off"
                className="rounded-lg border-white/65 bg-white/75"
              />
              <p className="text-xs text-muted-foreground">
                用于之后读取订阅数、视频数据、头像等公开资料；频道简介仅作为 AI 起草开发信的参考。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="youtube-region">默认市场</Label>
                <Input
                  id="youtube-region"
                value={defaultRegion}
                onChange={(event) => setDefaultRegion(event.target.value)}
                placeholder="留空=不限，例如 ES"
                maxLength={2}
                className="rounded-lg border-white/65 bg-white/75"
              />
              <p className="text-xs text-muted-foreground">留空表示不限制国家/地区。</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="youtube-language">默认语言</Label>
                <Input
                  id="youtube-language"
                value={defaultLanguage}
                onChange={(event) => setDefaultLanguage(event.target.value)}
                placeholder="留空=不限，例如 es"
                className="rounded-lg border-white/65 bg-white/75"
              />
              <p className="text-xs text-muted-foreground">留空表示不限制频道语言。</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="youtube-max-results">每次搜索数量</Label>
              <Input
                id="youtube-max-results"
                type="number"
                min={1}
                max={50}
                value={maxSearchResults}
                onChange={(event) => setMaxSearchResults(Number(event.target.value))}
                className="rounded-lg border-white/65 bg-white/75"
              />
              <p className="text-xs text-muted-foreground">YouTube API 单次搜索最多建议 50 条。</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="youtube-min-subscribers">最低粉丝量</Label>
              <Input
                id="youtube-min-subscribers"
                value={minSubscribers}
                onChange={(event) => setMinSubscribers(event.target.value)}
                placeholder="例如：1万以上，优先 5万-50万"
                className="rounded-lg border-white/65 bg-white/75"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="youtube-keywords">默认搜索偏好</Label>
            <Textarea
              id="youtube-keywords"
              value={searchKeywords}
              onChange={(event) => setSearchKeywords(event.target.value)}
              placeholder="例如：西班牙、露营、房车、离网生活、太阳能；排除纯新闻和低互动频道"
              className="min-h-24 rounded-lg border-white/65 bg-white/75"
            />
            <p className="text-xs text-muted-foreground">
              这里可以用自然语言写，后续 AI 搜索红人时会优先参考这些偏好。
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-white/65 bg-white/55 p-3">
            <div>
              <p className="text-sm font-medium">自动补全频道资料</p>
              <p className="text-xs text-muted-foreground">后续连接红人库时，自动补全粉丝量、最新视频等信息；频道简介不写入飞书字段。</p>
            </div>
            <Switch checked={autoEnrichEnabled} onCheckedChange={setAutoEnrichEnabled} />
          </div>

          {status && (
            <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
              status.success ? 'border-emerald-200/80 bg-emerald-50/80 text-emerald-700' : 'border-amber-200/80 bg-amber-50/80 text-amber-700'
            }`}>
              {status.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              <span>{status.message}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 justify-end">
            <Button type="button" variant="outline" className="h-10 rounded-lg border-white/70 bg-white/65" onClick={handleTest} disabled={testing || saving}>
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              测试连接
            </Button>
            <Button
              type="button"
              onClick={handleSave}
              disabled={saving || testing}
              className={justSaved ? 'h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700' : 'h-10 rounded-lg shadow-apple'}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : justSaved ? (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {saving ? '保存中...' : justSaved ? '已保存' : '保存 YouTube 设置'}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
