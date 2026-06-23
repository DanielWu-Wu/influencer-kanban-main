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
  const [status, setStatus] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (loading) return;
    setApiKey(settings.youtubeApiKey || (settings.youtubeApiKeyConfigured ? STORED_YOUTUBE_KEY : ''));
    setDefaultRegion(settings.youtubeDefaultRegion || 'ES');
    setDefaultLanguage(settings.youtubeDefaultLanguage || 'es');
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
      youtubeDefaultRegion: (defaultRegion.trim().toUpperCase() || 'ES').slice(0, 2),
      youtubeDefaultLanguage: defaultLanguage.trim().toLowerCase() || 'es',
      youtubeSearchKeywords: searchKeywords,
      youtubeMaxSearchResults: Math.min(50, Math.max(1, Number(maxSearchResults) || 25)),
      youtubeMinSubscribers: minSubscribers,
      youtubeAutoEnrichEnabled: autoEnrichEnabled,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await persistSettings();
      setStatus({ success: true, message: 'YouTube API 设置已保存。' });
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
          regionCode: defaultRegion,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'YouTube API 测试失败');
      setStatus({ success: true, message: `连接成功，已能读取 ${result.regionCode || defaultRegion} 区域的 YouTube 数据。` });
    } catch (error) {
      setStatus({ success: false, message: error instanceof Error ? error.message : 'YouTube API 测试失败。' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <CardHeader className="pb-3 hover:bg-muted/30 transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-600/10 flex items-center justify-center">
                <Youtube className="w-4 h-4 text-red-600" />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  YouTube API
                  {settings.youtubeApiKeyConfigured && (
                    <Badge variant="secondary" className="text-xs">已配置</Badge>
                  )}
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  预留创作者搜索、频道数据补全和红人筛选能力
                </CardDescription>
              </div>
            </div>
            {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
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
              />
              <p className="text-xs text-muted-foreground">
                用于之后读取频道简介、订阅数、视频数据和搜索合适红人。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="youtube-region">默认市场</Label>
                <Input
                  id="youtube-region"
                  value={defaultRegion}
                  onChange={(event) => setDefaultRegion(event.target.value)}
                  placeholder="ES"
                  maxLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="youtube-language">默认语言</Label>
                <Input
                  id="youtube-language"
                  value={defaultLanguage}
                  onChange={(event) => setDefaultLanguage(event.target.value)}
                  placeholder="es"
                />
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
              className="min-h-24"
            />
            <p className="text-xs text-muted-foreground">
              这里可以用自然语言写，后续 AI 搜索红人时会优先参考这些偏好。
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">自动补全频道资料</p>
              <p className="text-xs text-muted-foreground">后续连接红人库时，自动补全频道简介、粉丝量、最新视频等信息。</p>
            </div>
            <Switch checked={autoEnrichEnabled} onCheckedChange={setAutoEnrichEnabled} />
          </div>

          {status && (
            <div className={`flex items-center gap-2 rounded-lg p-3 text-sm ${
              status.success ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}>
              {status.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              <span>{status.message}</span>
            </div>
          )}

          <div className="flex flex-wrap gap-2 justify-end">
            <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
              {testing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              测试连接
            </Button>
            <Button onClick={handleSave} disabled={saving || testing}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              保存 YouTube 设置
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
