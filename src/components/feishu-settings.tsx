'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  FileSpreadsheet,
  LoaderCircle,
  LogOut,
  Plug,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSettings } from '@/lib/data';

type ConnectionState = {
  loading: boolean;
  configured: boolean;
  connected: boolean;
  name?: string;
  error?: string;
};

type Inspection = {
  selectedTable: { table_id: string; name: string };
  tables: Array<{ table_id: string; name: string }>;
  fields: Array<{ field_id: string; field_name: string; type: number }>;
  totalRecords: number;
  sampleRecords: Array<{ record_id: string; fields: Record<string, unknown> }>;
};

export function FeishuSettings({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { settings, updateSettings, loading: settingsLoading } = useSettings();
  const [url, setUrl] = useState('');
  const [connection, setConnection] = useState<ConnectionState>({
    loading: true,
    configured: false,
    connected: false,
  });
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!settingsLoading) setUrl(settings.feishuUrl || '');
  }, [settings.feishuUrl, settingsLoading]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('feishu_error');
    if (error) {
      const messages: Record<string, string> = {
        missing_app_id: 'Vercel 尚未配置飞书 App ID。',
        invalid_state: '飞书授权校验失败，请重新连接。',
        no_code: '飞书没有返回授权码，请重新连接。',
        callback_failed: '飞书授权回调失败，请检查 Vercel 配置。',
        access_denied: '你取消了飞书授权。',
      };
      setMessage(messages[error] || `飞书连接失败：${error}`);
    } else if (params.get('feishu_connected')) {
      setMessage('飞书账号已连接。下一步请粘贴红人资源库网址并执行只读检查。');
    }
  }, []);

  const loadConnection = async () => {
    setConnection((current) => ({ ...current, loading: true, error: undefined }));
    try {
      const response = await fetch('/api/auth/feishu/session', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '读取飞书连接状态失败。');
      setConnection({
        loading: false,
        configured: Boolean(result.configured),
        connected: Boolean(result.connected),
        name: result.data?.name,
      });
    } catch (error) {
      setConnection({
        loading: false,
        configured: false,
        connected: false,
        error: error instanceof Error ? error.message : '读取飞书连接状态失败。',
      });
    }
  };

  useEffect(() => {
    void loadConnection();
  }, []);

  const disconnect = async () => {
    await fetch('/api/auth/feishu/session', { method: 'DELETE' });
    setConnection((current) => ({ ...current, connected: false, name: undefined }));
    setInspection(null);
    setMessage('飞书连接已断开。');
  };

  const inspect = async () => {
    if (!url.trim()) {
      setMessage('请先粘贴红人资源库的完整网址。');
      return;
    }
    setInspecting(true);
    setMessage('');
    setInspection(null);
    try {
      const response = await fetch('/api/feishu/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '只读检查失败。');
      setInspection(result.data);
      updateSettings({ feishuUrl: url.trim() });
      setMessage('只读检查成功。当前没有修改任何飞书记录。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '只读检查失败。');
    } finally {
      setInspecting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base">飞书红人资源库</CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  一键授权后，通过 API 实时读取和更新多维表格
                </CardDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {connection.connected && <Badge variant="secondary">已连接</Badge>}
              {expanded
                ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
      </button>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {connection.loading ? (
            <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              正在检查飞书连接状态...
            </div>
          ) : !connection.configured ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              网站功能已经准备好，等待在 Vercel 填写飞书 App ID、App Secret 和回调地址。
            </div>
          ) : connection.connected ? (
            <div className="flex items-center justify-between gap-4 rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  飞书账号已连接
                </div>
                <p className="mt-1 truncate text-xs text-emerald-700">
                  {connection.name || '当前飞书账号'}
                </p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={disconnect}>
                <LogOut className="h-4 w-4" />
                断开
              </Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-md border bg-muted/30 p-4">
              <div>
                <p className="text-sm font-medium">授权你的飞书账号</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  授权后，看板只能访问你本人原本有权限使用的多维表格。
                </p>
              </div>
              <Button className="w-full gap-2 bg-blue-600 hover:bg-blue-700" asChild>
                <a href="/api/auth/feishu">
                  <Plug className="h-4 w-4" />
                  一键连接飞书
                </a>
              </Button>
            </div>
          )}

          {connection.connected && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Database className="h-4 w-4" />
                连接红人资源库
              </div>
              <div className="space-y-2">
                <Label htmlFor="feishu-base-url">飞书多维表格网址</Label>
                <Input
                  id="feishu-base-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://xxx.feishu.cn/base/..."
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={inspect}
                disabled={inspecting}
              >
                {inspecting
                  ? <LoaderCircle className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />}
                只读检查表格
              </Button>
            </div>
          )}

          {message && (
            <div className={`rounded-md p-3 text-sm ${
              inspection ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
            }`}>
              {message}
            </div>
          )}

          {connection.error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {connection.error}
            </div>
          )}

          {inspection && (
            <div className="space-y-3 rounded-md border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                已完成只读检查
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="数据表" value={inspection.tables.length} />
                <Metric label="当前表" value={inspection.selectedTable.name} />
                <Metric label="字段" value={inspection.fields.length} />
                <Metric label="记录" value={inspection.totalRecords} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">当前表字段</p>
                <div className="flex flex-wrap gap-1.5">
                  {inspection.fields.slice(0, 24).map((field) => (
                    <Badge key={field.field_id} variant="outline" className="font-normal">
                      {field.field_name}
                    </Badge>
                  ))}
                  {inspection.fields.length > 24 && (
                    <Badge variant="secondary">+{inspection.fields.length - 24}</Badge>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                已读取 {inspection.sampleRecords.length} 条样例用于连通性检查，未执行新增、更新或删除。
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-l-2 border-blue-300 pl-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

