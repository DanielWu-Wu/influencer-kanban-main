'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Eye,
  ExternalLink,
  FileSpreadsheet,
  KeyRound,
  LoaderCircle,
  LogOut,
  Plug,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
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
  areFeishuFieldMappingsEqual,
  compactFeishuFieldMapping,
  FEISHU_FIELD_TARGETS,
  type FeishuFieldKey,
  type FeishuFieldMapping,
  shouldSyncFeishuMappingDraft,
} from '@/lib/feishu-mapping';

type ConnectionState = {
  loading: boolean;
  configured: boolean;
  connected: boolean;
  name?: string;
  credentialSource?: 'personal' | 'global';
  appId?: string;
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

const EMPTY_FEISHU_FIELD_MAPPING: FeishuFieldMapping = {};

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
      'platform',
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
  const {
    settings,
    saveSettings,
    loading: settingsLoading,
    error: settingsError,
  } = useSettings();
  const [connection, setConnection] = useState<ConnectionState>({
    loading: true,
    configured: false,
    connected: false,
  });
  const [message, setMessage] = useState('');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [editingCredentials, setEditingCredentials] = useState(false);
  const [savingCredentials, setSavingCredentials] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState('');
  const [copiedCallback, setCopiedCallback] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get('feishu_error');
    if (error) {
      const messages: Record<string, string> = {
        missing_app_id: '尚未配置飞书企业应用。',
        missing_app_credentials: '请先保存你自己的飞书企业应用 App ID 和 App Secret。',
        credential_error: '无法读取飞书应用密钥，请检查服务器加密配置或重新保存凭证。',
        credentials_changed: '授权期间飞书应用凭证发生变化，请重新点击连接。',
        authorization_expired: '本次飞书授权已超过 10 分钟，请重新点击连接。',
        invalid_state: '飞书授权校验失败，请重新连接。',
        no_code: '飞书没有返回授权码，请重新连接。',
        callback_failed: '飞书授权回调失败，请检查应用凭证、回调地址和权限配置。',
        access_denied: '你取消了飞书授权。',
      };
      setMessage(messages[error] || `飞书连接失败：${error}`);
    } else if (params.get('feishu_connected')) {
      setMessage('飞书账号已连接。请分别配置资源库、开发记录表和详细合作记录表。');
    }
  }, []);

  useEffect(() => {
    setCallbackUrl(`${window.location.origin}/api/auth/feishu/callback`);
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
          credentialSource: result.source,
          appId: result.appId || result.data?.appId,
        });
        if (typeof result.callbackUrl === 'string' && result.callbackUrl) {
          setCallbackUrl(result.callbackUrl);
        }
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

  const saveCredentials = async () => {
    if (!appId.trim() || !appSecret.trim()) {
      setMessage('请完整填写 App ID 和 App Secret。');
      return;
    }
    if (connection.connected && !window.confirm('更换应用凭证会断开当前飞书授权，需要重新连接。是否继续？')) {
      return;
    }
    setSavingCredentials(true);
    setMessage('');
    try {
      const response = await fetch('/api/secrets/feishu-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: appId.trim(), appSecret: appSecret.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '保存飞书应用凭证失败。');
      setConnection((current) => ({
        ...current,
        configured: true,
        connected: false,
        name: undefined,
        credentialSource: 'personal',
        appId: result.appId,
        error: undefined,
      }));
      setAppSecret('');
      setEditingCredentials(false);
      setMessage('企业应用凭证已安全保存。下一步请点击“一键连接飞书”。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存飞书应用凭证失败。');
    } finally {
      setSavingCredentials(false);
    }
  };

  const deleteCredentials = async () => {
    if (!window.confirm('删除个人飞书应用配置会同时断开当前飞书授权，三张表的网址和字段映射会保留。是否继续？')) {
      return;
    }
    setSavingCredentials(true);
    setMessage('');
    try {
      const response = await fetch('/api/secrets/feishu-app', { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '删除飞书应用配置失败。');
      setConnection((current) => ({
        ...current,
        configured: Boolean(result.configured),
        connected: false,
        name: undefined,
        credentialSource: result.source,
        appId: result.appId,
        error: undefined,
      }));
      setAppId('');
      setAppSecret('');
      setEditingCredentials(false);
      setMessage(result.configured
        ? '个人应用配置已删除，当前已恢复管理员兼容配置。'
        : '个人应用配置已删除。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除飞书应用配置失败。');
    } finally {
      setSavingCredentials(false);
    }
  };

  const copyCallbackUrl = async () => {
    if (!callbackUrl) return;
    await navigator.clipboard.writeText(callbackUrl);
    setCopiedCallback(true);
    window.setTimeout(() => setCopiedCallback(false), 1600);
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
          <section className="space-y-4 rounded-lg border border-blue-100 bg-blue-50/45 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <KeyRound className="h-4 w-4 text-blue-600" />
                  第一步：配置你所在企业的自建应用
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  每位成员只配置自己的企业应用。App Secret 仅加密保存在当前账号的私密空间，不会显示给管理员或其他成员。
                </p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 gap-1.5 bg-white/80" asChild>
                <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">
                  飞书开发者后台
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="feishu-callback-url">重定向 URL（复制到飞书应用的安全设置）</Label>
              <div className="flex gap-2">
                <Input id="feishu-callback-url" value={callbackUrl} readOnly className="bg-white/85 font-mono text-xs" />
                <Button type="button" variant="outline" className="shrink-0 gap-1.5 bg-white/85" onClick={copyCallbackUrl}>
                  {copiedCallback ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copiedCallback ? '已复制' : '复制'}
                </Button>
              </div>
            </div>

            {connection.credentialSource === 'personal' && !editingCredentials ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/80 p-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    当前账号已配置个人企业应用
                  </div>
                  <p className="mt-1 text-xs text-emerald-700">App ID：{connection.appId}</p>
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="bg-white/80" onClick={() => {
                    setAppId(connection.appId || '');
                    setEditingCredentials(true);
                  }}>
                    更换凭证
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5 bg-white/80 text-red-600 hover:text-red-700" onClick={deleteCredentials} disabled={savingCredentials}>
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-white/80 bg-white/70 p-3">
                {connection.credentialSource === 'global' && !editingCredentials && (
                  <StatusBox text="当前正在使用管理员兼容配置。团队成员建议在这里改为自己企业的应用。" />
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="feishu-app-id">App ID</Label>
                    <Input
                      id="feishu-app-id"
                      value={appId}
                      onChange={(event) => setAppId(event.target.value)}
                      placeholder="cli_xxxxxxxxxxxxxxxx"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="feishu-app-secret">App Secret</Label>
                    <Input
                      id="feishu-app-secret"
                      type="password"
                      value={appSecret}
                      onChange={(event) => setAppSecret(event.target.value)}
                      placeholder="只在保存时传给服务器"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  {editingCredentials && (
                    <Button type="button" variant="ghost" onClick={() => {
                      setEditingCredentials(false);
                      setAppId('');
                      setAppSecret('');
                    }}>
                      取消
                    </Button>
                  )}
                  <Button type="button" className="gap-2" onClick={saveCredentials} disabled={savingCredentials}>
                    {savingCredentials ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    保存应用凭证
                  </Button>
                </div>
              </div>
            )}

            <details className="rounded-lg border border-white/80 bg-white/65 p-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-slate-700">查看应用权限配置指引</summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-5">
                <li>在飞书开发者后台创建“企业自建应用”，启用网页应用能力。</li>
                <li>把上方重定向 URL 加入应用的安全设置。</li>
                <li>申请多维表格读取、记录新增/更新和离线授权权限，并发布应用版本。</li>
                <li>将应用安装到自己的企业后，复制 App ID 和 App Secret 到这里保存。</li>
              </ol>
              <p className="mt-2 break-words font-mono leading-5">
                权限范围：offline_access、bitable:app:readonly、base:app:read、base:table:read、base:field:read、base:record:retrieve、base:record:read、base:record:create、base:record:update、wiki:wiki:readonly
              </p>
              <p className="mt-2 leading-5">看板仍只会在你明确确认时写入飞书；配置应用不会自动修改任何表格数据。</p>
            </details>
          </section>

          {connection.loading ? (
            <StatusBox icon={<LoaderCircle className="h-4 w-4 animate-spin" />} text="正在检查飞书连接状态..." />
          ) : !connection.configured ? (
            <StatusBox tone="warning" text="请先在上方保存你自己的飞书企业应用 App ID 和 App Secret。三张表网址可以先填写并暂存。" />
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

          {settingsError && (
            <StatusBox tone="error" text={`云端设置读取失败：${settingsError} 字段映射没有被空配置替代，请刷新后重试。`} />
          )}

          {!settingsLoading && !settingsError && (
            <div className="grid gap-4 xl:grid-cols-2">
              <TableConfiguration
                role="resource"
                canInspect={connection.connected}
                initialUrl={settings.feishuUrl || ''}
                initialMapping={settings.feishuFieldMapping ?? EMPTY_FEISHU_FIELD_MAPPING}
                onSaveUrl={(url) => saveSettings({ feishuUrl: url })}
                onSave={(url, mapping) => saveSettings({ feishuUrl: url, feishuFieldMapping: mapping })}
              />
              <TableConfiguration
                role="development"
                canInspect={connection.connected}
                initialUrl={settings.feishuProspectingUrl || ''}
                initialMapping={settings.feishuProspectingFieldMapping ?? EMPTY_FEISHU_FIELD_MAPPING}
                onSaveUrl={(url) => saveSettings({ feishuProspectingUrl: url })}
                onSave={(url, mapping) => saveSettings({
                  feishuProspectingUrl: url,
                  feishuProspectingFieldMapping: mapping,
                })}
              />
              <div className="xl:col-span-2">
                <TableConfiguration
                  role="cooperation"
                  canInspect={connection.connected}
                  initialUrl={settings.feishuCooperationUrl || ''}
                  initialMapping={settings.feishuCooperationFieldMapping ?? EMPTY_FEISHU_FIELD_MAPPING}
                  onSaveUrl={(url) => saveSettings({ feishuCooperationUrl: url })}
                  onSave={(url, mapping) => saveSettings({
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
  onSaveUrl: (url: string) => Promise<void>;
  onSave: (url: string, mapping: FeishuFieldMapping) => Promise<void>;
}) {
  const config = ROLE_CONFIG[role];
  const [url, setUrl] = useState(initialUrl);
  const [mapping, setMapping] = useState<FeishuFieldMapping>(initialMapping);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [message, setMessage] = useState('');
  const mappingRef = useRef<FeishuFieldMapping>(initialMapping);
  const mappingDirtyRef = useRef(false);
  const urlDirtyRef = useRef(false);
  const targets = useMemo(
    () => FEISHU_FIELD_TARGETS
      .filter((target) => config.mappingKeys.includes(target.key))
      .map((target) => role === 'cooperation' && target.key === 'email'
        ? {
            ...target,
            label: '本次联系邮箱',
            description: '只保存这次合作实际使用的一个收件邮箱',
          }
        : target),
    [config.mappingKeys, role],
  );
  const mappedCount = targets.filter((target) => Boolean(mapping[target.key])).length;

  useEffect(() => {
    if (!urlDirtyRef.current) setUrl(initialUrl);
  }, [initialUrl]);

  useEffect(() => {
    if (!shouldSyncFeishuMappingDraft(mappingDirtyRef.current)) return;
    mappingRef.current = initialMapping;
    setMapping(initialMapping);
    setHasUnsavedChanges(false);
  }, [initialMapping]);

  const replaceMapping = (next: FeishuFieldMapping, dirty: boolean) => {
    mappingRef.current = next;
    mappingDirtyRef.current = dirty;
    setMapping(next);
    setHasUnsavedChanges(dirty);
    setSaved(false);
  };

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
    try {
      const response = await fetch('/api/feishu/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '只读检查失败。');
      const nextInspection = result.data as Inspection;
      if (!nextInspection?.selectedTable || !Array.isArray(nextInspection.fields)) {
        throw new Error('飞书返回的子表信息不完整，请重新检查。');
      }
      if (nextInspection.fields.length === 0) {
        throw new Error('没有读取到任何飞书字段，已保留当前映射。请检查子表网址和应用权限。');
      }
      const currentMapping = mappingRef.current;
      const nextMapping = autoMapFeishuFields(nextInspection.fields, currentMapping);
      if (Object.keys(currentMapping).length > 0 && Object.keys(nextMapping).length === 0) {
        throw new Error('检查结果与当前映射完全不匹配，已保留当前映射。请确认网址是否指向了正确子表。');
      }
      setInspection(nextInspection);
      replaceMapping(nextMapping, !areFeishuFieldMappingsEqual(nextMapping, initialMapping));
      setMessage(`已识别子表“${nextInspection.selectedTable.name}”，当前没有修改任何飞书记录。请确认映射后单独保存本表配置。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '只读检查失败。');
    } finally {
      setInspecting(false);
    }
  };

  const save = async () => {
    if (!inspection) {
      setMessage('请先执行只读检查，确认网址指向正确的子表。');
      return;
    }
    const compacted = compactFeishuFieldMapping(mapping);
    setSaving(true);
    setSaved(false);
    try {
      await onSave(url.trim(), compacted);
      replaceMapping(compacted, false);
      urlDirtyRef.current = false;
      setSaved(true);
      setMessage(`${config.title}配置已保存到当前账号云端。`);
    } catch (error) {
      setMessage(error instanceof Error ? `保存失败：${error.message}` : '保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
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
            urlDirtyRef.current = true;
            setSaved(false);
          }}
          onBlur={async () => {
            const trimmed = url.trim();
            if (!trimmed || !urlDirtyRef.current) return;
            try {
              await onSaveUrl(trimmed);
              urlDirtyRef.current = false;
              setUrl(trimmed);
              setMessage('网址已保存到当前账号云端。完成飞书授权后再执行只读检查。');
            } catch (error) {
              setMessage(error instanceof Error ? `网址保存失败：${error.message}` : '网址保存失败，请稍后重试。');
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
              <p className="mt-1 text-xs text-muted-foreground">
                已映射 {mappedCount} 个字段，不需要在飞书新增字段。
                {hasUnsavedChanges ? ' 当前有未保存修改。' : ''}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const nextMapping = autoMapFeishuFields(inspection.fields, mappingRef.current);
                replaceMapping(nextMapping, !areFeishuFieldMappingsEqual(nextMapping, initialMapping));
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
                      const nextMapping = {
                        ...mappingRef.current,
                        [target.key]: value === 'none' ? undefined : value,
                      };
                      replaceMapping(nextMapping, !areFeishuFieldMappingsEqual(nextMapping, initialMapping));
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

          <Button type="button" className="h-10 w-full gap-2" onClick={save} disabled={saving}>
            {saving
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : saved
                ? <CheckCircle2 className="h-4 w-4" />
                : <Save className="h-4 w-4" />}
            {saving ? '正在保存…' : saved ? '配置已保存' : `保存${config.title}配置`}
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
