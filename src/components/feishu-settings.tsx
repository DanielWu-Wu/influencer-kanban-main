'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Eye,
  FileSpreadsheet,
  LoaderCircle,
  LogOut,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  Wand2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSettings } from '@/lib/data';
import {
  autoMapFeishuFields,
  compactFeishuFieldMapping,
  FEISHU_FIELD_TARGETS,
  type FeishuFieldKey,
  type FeishuFieldMapping,
} from '@/lib/feishu-mapping';

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

type TableRole = 'resource' | 'development' | 'cooperation';

const ROLE_CONFIG: Record<TableRole, {
  title: string;
  description: string;
  placeholder: string;
  mappingKeys: FeishuFieldKey[];
}> = {
  resource: {
    title: '红人资源库',
    description: '连接“红人信息数据库”，用于频道查重、读取基础资料；不会因为已收录而阻止开发。',
    placeholder: '粘贴“红人信息数据库”的完整网址，需包含 table=tbl...',
    mappingKeys: [
      'channelName',
      'avatar',
      'email',
      'channelUrl',
      'channelId',
      'region',
      'contentType',
      'followers',
      'recentAverageViews',
      'firstOutreach',
      'notes',
    ],
  },
  development: {
    title: '红人开发记录表',
    description: '连接“红人开发情况表”，一位红人固定一行，后续开发、跟进和回复都更新这一行。',
    placeholder: '粘贴“红人开发情况表”的完整网址，需包含 table=tbl...',
    mappingKeys: [
      'channelName',
      'avatar',
      'region',
      'channelUrl',
      'channelId',
      'email',
      'developmentDate',
      'firstOutreach',
      'secondOutreachDate',
      'secondOutreach',
      'thirdOutreachDate',
      'thirdOutreach',
      'hasReply',
      'language',
      'targetProduct',
      'cooperationType',
      'cooperationIdea',
      'collaborationStatus',
      'notes',
    ],
  },
  cooperation: {
    title: '详细合作记录表',
    description: '连接“详细合作记录表”，用于跟踪已确认合作的费用、寄样、上线进度和发布数据。',
    placeholder: '粘贴“详细合作记录表”的完整网址，需包含 table=tbl...',
    mappingKeys: [
      'month',
      'promotionOwner',
      'cooperationDate',
      'cooperationProduct',
      'cooperationSite',
      'region',
      'operator',
      'promotionPlatform',
      'channelName',
      'email',
      'cooperationCount',
      'channelUrl',
      'tiktokUrl',
      'contentType',
      'followers',
      'expectedPublishDate',
      'sampleProvided',
      'originalCurrencyCost',
      'cnyCost',
      'cooperationType',
      'shippingAddress',
      'shippingDate',
      'arrivalDate',
      'filmingCompleteDate',
      'shippingTracking',
      'discountCode',
      'logisticsNotified',
      'discountNotified',
      'actualPublishDate',
      'publishedVideoUrl',
      'exposureCount',
      'commentCount',
      'likeCount',
    ],
  },
};

export function FeishuSettings({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { settings, updateSettings, loading: settingsLoading } = useSettings();
  const [connection, setConnection] = useState<ConnectionState>({
    loading: true,
    configured: false,
    connected: false,
  });
  const [message, setMessage] = useState('');

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
      setMessage('飞书账号已连接。请分别配置资源库、开发记录表和详细合作记录表。');
    }
  }, []);

  useEffect(() => {
    const loadConnection = async () => {
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
    void loadConnection();
  }, []);

  const disconnect = async () => {
    await fetch('/api/auth/feishu/session', { method: 'DELETE' });
    setConnection((current) => ({ ...current, connected: false, name: undefined }));
    setMessage('飞书连接已断开。');
  };

  return (
    <Card className="overflow-hidden rounded-lg border-white/65 bg-white/66 shadow-apple backdrop-blur-xl">
      <button type="button" onClick={onToggle} className="w-full text-left">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 ring-1 ring-blue-500/10">
                <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base">飞书多维表格</CardTitle>
                <CardDescription className="mt-0.5 text-xs">
                  分别连接红人资源库、开发记录表和详细合作记录表，保持各阶段数据独立
                </CardDescription>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {connection.connected && (
                <Badge variant="secondary" className="rounded-md bg-emerald-50 text-xs text-emerald-700">
                  已连接
                </Badge>
              )}
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
            <StatusBox icon={<LoaderCircle className="h-4 w-4 animate-spin" />} text="正在检查飞书连接状态..." />
          ) : !connection.configured ? (
            <StatusBox tone="warning" text="当前本地环境尚未配置飞书 App ID 和 App Secret。你可以先填写并暂存三个子表网址，配置凭证后再授权和检查字段。" />
          ) : connection.connected ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-emerald-200/80 bg-emerald-50/80 p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  飞书账号已连接
                </div>
                <p className="mt-1 truncate text-xs text-emerald-700">{connection.name || '当前飞书账号'}</p>
              </div>
              <Button variant="outline" size="sm" className="h-9 shrink-0 gap-1.5 bg-white/70" onClick={disconnect}>
                <LogOut className="h-4 w-4" />
                断开
              </Button>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-white/65 bg-white/55 p-4">
              <p className="text-sm font-medium">授权你的飞书账号</p>
              <p className="text-xs leading-5 text-muted-foreground">
                授权后，看板只能访问你本人原本有权限使用的多维表格。
              </p>
              <Button className="h-10 w-full gap-2 rounded-lg bg-blue-600 hover:bg-blue-700" asChild>
                <a href="/api/auth/feishu">
                  <Plug className="h-4 w-4" />
                  一键连接飞书
                </a>
              </Button>
            </div>
          )}

          {message && <StatusBox tone="warning" text={message} />}
          {connection.error && <StatusBox tone="error" text={connection.error} />}

          {!settingsLoading && (
            <div className="grid gap-4 xl:grid-cols-2">
              <TableConfiguration
                role="resource"
                canInspect={connection.connected}
                initialUrl={settings.feishuUrl || ''}
                initialMapping={settings.feishuFieldMapping || {}}
                onSaveUrl={(url) => updateSettings({ feishuUrl: url })}
                onSave={(url, mapping) => updateSettings({ feishuUrl: url, feishuFieldMapping: mapping })}
              />
              <TableConfiguration
                role="development"
                canInspect={connection.connected}
                initialUrl={settings.feishuProspectingUrl || ''}
                initialMapping={settings.feishuProspectingFieldMapping || {}}
                onSaveUrl={(url) => updateSettings({ feishuProspectingUrl: url })}
                onSave={(url, mapping) => updateSettings({
                  feishuProspectingUrl: url,
                  feishuProspectingFieldMapping: mapping,
                })}
              />
              <div className="xl:col-span-2">
                <TableConfiguration
                  role="cooperation"
                  canInspect={connection.connected}
                  initialUrl={settings.feishuCooperationUrl || ''}
                  initialMapping={settings.feishuCooperationFieldMapping || {}}
                  onSaveUrl={(url) => updateSettings({ feishuCooperationUrl: url })}
                  onSave={(url, mapping) => updateSettings({
                    feishuCooperationUrl: url,
                    feishuCooperationFieldMapping: mapping,
                  })}
                />
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function TableConfiguration({
  role,
  canInspect,
  initialUrl,
  initialMapping,
  onSaveUrl,
  onSave,
}: {
  role: TableRole;
  canInspect: boolean;
  initialUrl: string;
  initialMapping: FeishuFieldMapping;
  onSaveUrl: (url: string) => void;
  onSave: (url: string, mapping: FeishuFieldMapping) => void;
}) {
  const config = ROLE_CONFIG[role];
  const [url, setUrl] = useState(initialUrl);
  const [mapping, setMapping] = useState<FeishuFieldMapping>(initialMapping);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState('');
  const targets = useMemo(
    () => FEISHU_FIELD_TARGETS.filter((target) => config.mappingKeys.includes(target.key)),
    [config.mappingKeys],
  );
  const mappedCount = targets.filter((target) => Boolean(mapping[target.key])).length;

  useEffect(() => setUrl(initialUrl), [initialUrl]);
  useEffect(() => setMapping(initialMapping), [initialMapping]);

  const inspect = async () => {
    if (!url.trim()) {
      setMessage(`请先粘贴${config.title}的完整网址。`);
      return;
    }
    if (!canInspect) {
      setMessage('网址可以先保存；完成飞书应用配置和账号授权后，才能执行只读检查。');
      return;
    }
    try {
      if (!new URL(url.trim()).searchParams.get('table')) {
        setMessage('当前网址没有包含 table=tbl...，无法确认具体子表。请打开目标子表后重新复制地址栏网址。');
        return;
      }
    } catch {
      setMessage('网址格式不正确，请从飞书目标子表的浏览器地址栏重新复制。');
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
      const nextInspection = result.data as Inspection;
      setInspection(nextInspection);
      setMapping(autoMapFeishuFields(nextInspection.fields || [], initialMapping));
      setSaved(false);
      setMessage(`已识别子表“${nextInspection.selectedTable.name}”，当前没有修改任何飞书记录。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '只读检查失败。');
    } finally {
      setInspecting(false);
    }
  };

  const save = () => {
    if (!inspection) {
      setMessage('请先执行只读检查，确认网址指向正确的子表。');
      return;
    }
    const compacted = compactFeishuFieldMapping(mapping);
    onSave(url.trim(), compacted);
    setMapping(compacted);
    setSaved(true);
    setMessage(`${config.title}配置已保存。`);
  };

  return (
    <section className="space-y-3 rounded-lg border border-white/70 bg-white/55 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
          <Database className="h-4 w-4 text-slate-700" />
        </div>
        <div>
          <h3 className="text-sm font-semibold">{config.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{config.description}</p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`feishu-${role}-url`}>子表网址</Label>
        <Input
          id={`feishu-${role}-url`}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value);
            setSaved(false);
          }}
          onBlur={() => {
            const trimmed = url.trim();
            if (trimmed) {
              onSaveUrl(trimmed);
              setMessage('网址已暂存。完成飞书授权后再执行只读检查。');
            }
          }}
          placeholder={config.placeholder}
          className="bg-white/80"
        />
        <p className="text-xs text-muted-foreground">请从目标子表浏览器地址栏复制，网址中应包含 `table=tbl...`。</p>
      </div>

      <Button
        type="button"
        variant="outline"
        className="h-10 w-full gap-2 bg-white/70"
        onClick={inspect}
        disabled={inspecting || !canInspect}
      >
        {inspecting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        {canInspect ? '只读检查子表' : '完成飞书授权后检查'}
      </Button>

      {message && (
        <div className={`rounded-md border p-2.5 text-xs ${
          inspection ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
        }`}>
          {message}
        </div>
      )}

      {inspection && (
        <div className="space-y-3 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              {inspection.selectedTable.name}
            </div>
            <Badge variant="outline">{inspection.totalRecords} 条记录</Badge>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Wand2 className="h-4 w-4 text-blue-600" />
                字段映射
              </div>
              <p className="mt-1 text-xs text-muted-foreground">已映射 {mappedCount} 个字段，不需要在飞书新增字段。</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setMapping(autoMapFeishuFields(inspection.fields, mapping));
                setSaved(false);
              }}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              重识别
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {targets.map((target) => {
              const isUnmapped = !mapping[target.key];
              return (
                <div key={target.key} className="space-y-1.5 rounded-md border bg-white/70 p-2.5">
                  <Label className="text-xs">{target.label}</Label>
                  <Select
                    value={mapping[target.key] || 'none'}
                    onValueChange={(value) => {
                      setMapping((current) => ({ ...current, [target.key]: value === 'none' ? undefined : value }));
                      setSaved(false);
                    }}
                  >
                    <SelectTrigger
                      className={`h-9 w-full ${isUnmapped
                        ? 'border-amber-300 bg-amber-50/90 text-amber-800 hover:bg-amber-50 focus-visible:border-amber-400 focus-visible:ring-amber-200/70 [&>svg]:text-amber-600'
                        : 'bg-white'}`}
                    >
                      <SelectValue placeholder="选择飞书字段" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-amber-700 focus:bg-amber-50 focus:text-amber-800">
                        暂不映射
                      </SelectItem>
                      {inspection.fields.map((field) => (
                        <SelectItem key={`${target.key}-${field.field_id}`} value={field.field_name}>
                          {field.field_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>

          {inspection.sampleRecords.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground">
                <Eye className="h-4 w-4" />
                查看前 {inspection.sampleRecords.length} 条只读样例
              </summary>
              <div className="mt-2 max-h-48 overflow-auto rounded-md border bg-white/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {targets.slice(0, 5).map((target) => <TableHead key={target.key}>{target.label}</TableHead>)}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inspection.sampleRecords.map((record) => (
                      <TableRow key={record.record_id}>
                        {targets.slice(0, 5).map((target) => (
                          <TableCell key={`${record.record_id}-${target.key}`} className="max-w-40 truncate">
                            {formatFeishuValue(mapping[target.key] ? record.fields[mapping[target.key]!] : undefined)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </details>
          )}

          <Button type="button" className="h-10 w-full gap-2" onClick={save}>
            {saved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {saved ? '配置已保存' : `保存${config.title}配置`}
          </Button>
        </div>
      )}
    </section>
  );
}

function StatusBox({
  text,
  icon,
  tone = 'neutral',
}: {
  text: string;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'error';
}) {
  const className = tone === 'error'
    ? 'border-red-200 bg-red-50 text-red-700'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : 'border-white/65 bg-white/55 text-muted-foreground';
  return <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${className}`}>{icon}{text}</div>;
}

function formatFeishuValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatFeishuValue).filter((item) => item !== '-').join(', ') || '-';
  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    for (const key of ['text', 'name', 'email', 'link', 'url', 'value', 'title']) {
      if (objectValue[key]) return formatFeishuValue(objectValue[key]);
    }
    return Object.values(objectValue).map(formatFeishuValue).filter((item) => item !== '-').join(', ') || '-';
  }
  return '-';
}
