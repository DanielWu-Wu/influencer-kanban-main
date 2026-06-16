'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  History,
  Loader2,
  Save,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useSettings } from '@/lib/data';
import type { FeishuFieldMapping } from '@/lib/feishu-mapping';
import {
  DEFAULT_RECORD_ASSISTANT_SETTINGS,
  FEISHU_FIELD_LABELS,
  RECORD_ASSISTANT_EVENT_OPTIONS,
  buildRecordSyncFromEvent,
  formatRecordAssistantEventType,
  mergeRecordAssistantSettings,
  normalizeEmail,
  type PendingRecordSync,
  type RecordAssistantEvent,
  type RecordAssistantLog,
  type RecordAssistantRule,
  type RecordAssistantSettings,
} from '@/lib/record-assistant';

type RecordAssistantContextValue = {
  captureEvent: (event: RecordAssistantEvent) => void;
};

type FeishuRecord = {
  record_id: string;
  fields: Record<string, unknown>;
};

type FeishuRecordListResponse = {
  success?: boolean;
  error?: string;
  data?: {
    items?: FeishuRecord[];
    page_token?: string;
    has_more?: boolean;
  };
};

const RecordAssistantContext = createContext<RecordAssistantContextValue | null>(null);

const PENDING_STORAGE_KEY = 'record-assistant-pending-syncs';
const LOG_STORAGE_KEY = 'record-assistant-logs';

function readStoredList<T>(key: string) {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T[] : [];
  } catch {
    return [];
  }
}

function writeStoredList<T>(key: string, value: T[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function stringifyFeishuValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(stringifyFeishuValue).filter(Boolean).join(' ');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const preferred = ['text', 'name', 'email', 'link', 'url', 'value']
      .map((key) => stringifyFeishuValue(record[key]))
      .filter(Boolean);
    if (preferred.length) return preferred.join(' ');
    return Object.values(record).map(stringifyFeishuValue).filter(Boolean).join(' ');
  }
  return '';
}

function normalizeText(value?: string) {
  return (value || '').trim().toLowerCase();
}

function findMatchingRecord(
  records: FeishuRecord[],
  sync: PendingRecordSync,
  mapping: FeishuFieldMapping,
) {
  const emailField = mapping.email;
  const channelField = mapping.channelName;
  const emailCandidates = [
    sync.event.influencer?.email,
    sync.event.email?.to,
    sync.event.email?.from,
  ]
    .map(normalizeEmail)
    .filter(Boolean);
  const channelName = normalizeText(sync.event.influencer?.channelName);

  if (emailField && emailCandidates.length) {
    for (const record of records) {
      const recordEmail = normalizeText(stringifyFeishuValue(record.fields[emailField]));
      const matchedEmail = emailCandidates.find((email) => recordEmail.includes(email));
      if (matchedEmail) {
        return {
          record,
          matchedBy: `邮箱：${matchedEmail}`,
        };
      }
    }
  }

  if (channelField && channelName) {
    for (const record of records) {
      const recordChannel = normalizeText(stringifyFeishuValue(record.fields[channelField]));
      if (
        recordChannel &&
        (recordChannel === channelName ||
          recordChannel.includes(channelName) ||
          channelName.includes(recordChannel))
      ) {
        return {
          record,
          matchedBy: `频道名：${sync.event.influencer?.channelName}`,
        };
      }
    }
  }

  return null;
}

async function fetchFeishuRecords(url: string) {
  const records: FeishuRecord[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const response = await fetch('/api/feishu/records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'list',
        url,
        pageSize: 500,
        ...(pageToken ? { pageToken } : {}),
      }),
    });
    const result = await response.json() as FeishuRecordListResponse;
    if (!response.ok || !result.success) {
      throw new Error(result.error || '读取飞书记录失败。');
    }

    records.push(...(result.data?.items || []));
    if (!result.data?.has_more) break;
    pageToken = result.data.page_token;
    if (!pageToken) break;
  }

  return records;
}

function ruleWithUpdate(
  rule: RecordAssistantRule,
  patch: Partial<RecordAssistantRule>,
) {
  return { ...rule, ...patch };
}

export function useRecordAssistant() {
  const context = useContext(RecordAssistantContext);
  if (!context) {
    throw new Error('useRecordAssistant must be used inside RecordAssistantProvider.');
  }
  return context;
}

export function RecordAssistantProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { settings, updateSettings } = useSettings();
  const assistantSettings = useMemo(
    () => mergeRecordAssistantSettings(settings.recordAssistantSettings),
    [settings.recordAssistantSettings],
  );
  const [draftSettings, setDraftSettings] = useState<RecordAssistantSettings>(
    () => mergeRecordAssistantSettings(settings.recordAssistantSettings),
  );
  const [pending, setPending] = useState<PendingRecordSync[]>([]);
  const [logs, setLogs] = useState<RecordAssistantLog[]>([]);
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('pending');
  const [notice, setNotice] = useState('');
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    setDraftSettings(assistantSettings);
  }, [assistantSettings]);

  useEffect(() => {
    setPending(readStoredList<PendingRecordSync>(PENDING_STORAGE_KEY));
    setLogs(readStoredList<RecordAssistantLog>(LOG_STORAGE_KEY));
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    writeStoredList(PENDING_STORAGE_KEY, pending.slice(0, 50));
  }, [pending, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    writeStoredList(LOG_STORAGE_KEY, logs.slice(0, 50));
  }, [logs, storageReady]);

  const captureEvent = useCallback((event: RecordAssistantEvent) => {
    const sync = buildRecordSyncFromEvent(event, settings);
    if (!sync) return;

    setPending((current) => [sync, ...current].slice(0, 50));
    setNotice('已识别到操作，等待你确认是否同步到飞书。');
    setActiveTab('pending');
    setOpen(true);
  }, [settings]);

  const saveRules = () => {
    updateSettings({ recordAssistantSettings: draftSettings });
    setNotice('AI 辅助记录规则已保存。');
  };

  const resetRules = () => {
    setDraftSettings(mergeRecordAssistantSettings(DEFAULT_RECORD_ASSISTANT_SETTINGS));
    setNotice('已恢复为默认记录规则，点击保存后生效。');
  };

  const updateRule = (ruleId: string, patch: Partial<RecordAssistantRule>) => {
    setDraftSettings((current) => ({
      ...current,
      rules: current.rules.map((rule) =>
        rule.id === ruleId ? ruleWithUpdate(rule, patch) : rule,
      ),
    }));
  };

  const updateRuleTemplate = (ruleId: string, updateIndex: number, valueTemplate: string) => {
    setDraftSettings((current) => ({
      ...current,
      rules: current.rules.map((rule) => {
        if (rule.id !== ruleId) return rule;
        return {
          ...rule,
          updates: rule.updates.map((update, index) =>
            index === updateIndex ? { ...update, valueTemplate } : update,
          ),
        };
      }),
    }));
  };

  const updateRuleFieldEnabled = (ruleId: string, updateIndex: number, enabled: boolean) => {
    setDraftSettings((current) => ({
      ...current,
      rules: current.rules.map((rule) => {
        if (rule.id !== ruleId) return rule;
        return {
          ...rule,
          updates: rule.updates.map((update, index) =>
            index === updateIndex ? { ...update, enabled } : update,
          ),
        };
      }),
    }));
  };

  const ignoreSync = (sync: PendingRecordSync) => {
    const dismissed: RecordAssistantLog = {
      ...sync,
      status: 'dismissed',
      finishedAt: new Date().toISOString(),
    };
    setPending((current) => current.filter((item) => item.id !== sync.id));
    setLogs((current) => [dismissed, ...current].slice(0, 50));
    setNotice('已忽略这次同步建议。');
  };

  const confirmSync = async (sync: PendingRecordSync) => {
    if (!settings.feishuUrl) {
      setPending((current) => current.map((item) =>
        item.id === sync.id ? { ...item, status: 'failed', error: '请先在设置里连接飞书资源库。' } : item,
      ));
      return;
    }

    const fields = Object.fromEntries(
      sync.updates
        .filter((update) => update.enabled && update.fieldName && update.value)
        .map((update) => [update.fieldName as string, update.value]),
    );
    if (!Object.keys(fields).length) {
      setPending((current) => current.map((item) =>
        item.id === sync.id ? { ...item, status: 'failed', error: '没有可写入的字段，请检查飞书字段映射。' } : item,
      ));
      return;
    }

    setPending((current) => current.map((item) =>
      item.id === sync.id ? { ...item, status: 'syncing', error: undefined } : item,
    ));

    try {
      const records = await fetchFeishuRecords(settings.feishuUrl);
      const match = findMatchingRecord(records, sync, settings.feishuFieldMapping || {});
      if (!match) {
        throw new Error('没有在飞书表格里匹配到对应红人。请检查邮箱或频道名字段映射。');
      }

      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          url: settings.feishuUrl,
          recordId: match.record.record_id,
          fields,
        }),
      });
      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '写入飞书记录失败。');
      }

      const completed: RecordAssistantLog = {
        ...sync,
        status: 'synced',
        recordId: match.record.record_id,
        matchedBy: match.matchedBy,
        finishedAt: new Date().toISOString(),
      };
      setPending((current) => current.filter((item) => item.id !== sync.id));
      setLogs((current) => [completed, ...current].slice(0, 50));
      setNotice('已同步到飞书。');
    } catch (error) {
      setPending((current) => current.map((item) =>
        item.id === sync.id
          ? {
              ...item,
              status: 'failed',
              error: error instanceof Error ? error.message : '同步失败。',
            }
          : item,
      ));
      setNotice('同步没有完成，请查看错误提示后重试。');
    }
  };

  const contextValue = useMemo(() => ({ captureEvent }), [captureEvent]);
  const pendingCount = pending.length;
  const shouldRenderAssistant = pathname !== '/login';

  return (
    <RecordAssistantContext.Provider value={contextValue}>
      {children}
      {shouldRenderAssistant && (
        <>
          {!open && (
            <Button
              className="fixed bottom-24 right-5 z-[90] h-11 rounded-full px-4 shadow-xl"
              onClick={() => setOpen(true)}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              AI 记录
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-2 bg-white text-primary">
                  {pendingCount}
                </Badge>
              )}
            </Button>
          )}

          {open && (
            <section className="fixed bottom-24 right-5 z-[90] flex h-[min(640px,calc(100vh-8rem))] w-[min(460px,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border bg-background shadow-2xl">
              <header className="flex shrink-0 items-start justify-between border-b px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">AI 辅助记录</h2>
                    {pendingCount > 0 && <Badge variant="outline">{pendingCount} 待确认</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">写入飞书前，必须由你确认。</p>
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </header>

              {notice && (
                <div className="mx-4 mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  {notice}
                </div>
              )}

              <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 p-4">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="pending">
                    <ClipboardList className="h-3.5 w-3.5" />
                    待确认
                  </TabsTrigger>
                  <TabsTrigger value="rules">
                    <Settings2 className="h-3.5 w-3.5" />
                    规则
                  </TabsTrigger>
                  <TabsTrigger value="logs">
                    <History className="h-3.5 w-3.5" />
                    记录
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="pending" className="min-h-0 overflow-y-auto pt-3">
                  {pending.length === 0 ? (
                    <div className="flex h-48 flex-col items-center justify-center rounded-md border border-dashed text-center">
                      <CheckCircle2 className="h-8 w-8 text-green-600" />
                      <p className="mt-2 text-sm font-medium">暂无待确认同步</p>
                      <p className="mt-1 text-xs text-muted-foreground">发送邮件或拖动看板状态后会出现在这里。</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pending.map((sync) => (
                        <div key={sync.id} className="rounded-md border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{sync.event.title}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{sync.event.summary}</p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {formatRecordAssistantEventType(sync.event.type)}
                              </p>
                            </div>
                            <Badge variant={sync.status === 'failed' ? 'destructive' : 'secondary'}>
                              {sync.status === 'syncing'
                                ? '同步中'
                                : sync.status === 'failed'
                                  ? '失败'
                                  : '待确认'}
                            </Badge>
                          </div>

                          <div className="mt-3 space-y-2">
                            {sync.updates.map((update) => (
                              <div key={`${sync.id}-${update.fieldKey}`} className="rounded-md bg-muted/50 px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-medium">{update.fieldLabel}</span>
                                  <span className="truncate text-[11px] text-muted-foreground">
                                    {update.fieldName ? `写入：${update.fieldName}` : '未映射'}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs">{update.value}</p>
                              </div>
                            ))}
                          </div>

                          {sync.error && (
                            <div className="mt-3 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>{sync.error}</span>
                            </div>
                          )}

                          <div className="mt-3 flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => ignoreSync(sync)}>
                              忽略
                            </Button>
                            <Button
                              size="sm"
                              disabled={sync.status === 'syncing'}
                              onClick={() => void confirmSync(sync)}
                            >
                              {sync.status === 'syncing' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                              确认同步
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="rules" className="min-h-0 overflow-y-auto pt-3">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div>
                        <p className="text-sm font-medium">启用 AI 辅助记录</p>
                        <p className="text-xs text-muted-foreground">关闭后不会再捕捉新的操作事件。</p>
                      </div>
                      <Switch
                        checked={draftSettings.enabled}
                        onCheckedChange={(enabled) => setDraftSettings((current) => ({ ...current, enabled }))}
                      />
                    </div>

                    {draftSettings.rules.map((rule) => (
                      <div key={rule.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{rule.label}</p>
                            <p className="mt-1 text-xs text-muted-foreground">选择触发事件，并设置写入内容模板。</p>
                          </div>
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={(enabled) => updateRule(rule.id, { enabled })}
                          />
                        </div>

                        <div className="mt-3">
                          <Select
                            value={rule.eventType}
                            onValueChange={(eventType) =>
                              updateRule(rule.id, { eventType: eventType as RecordAssistantRule['eventType'] })}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RECORD_ASSISTANT_EVENT_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="mt-3 space-y-3">
                          {rule.updates.map((update, index) => (
                            <div key={`${rule.id}-${update.fieldKey}`} className="rounded-md bg-muted/40 p-3">
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div>
                                  <p className="text-xs font-medium">
                                    {FEISHU_FIELD_LABELS[update.fieldKey] || update.fieldKey}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground">
                                    字段映射：{settings.feishuFieldMapping?.[update.fieldKey] || '未映射'}
                                  </p>
                                </div>
                                <Switch
                                  checked={update.enabled}
                                  onCheckedChange={(enabled) => updateRuleFieldEnabled(rule.id, index, enabled)}
                                />
                              </div>
                              <Textarea
                                value={update.valueTemplate}
                                className="min-h-16 text-xs"
                                onChange={(event) => updateRuleTemplate(rule.id, index, event.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      可用变量：{'{{today}}'}、{'{{subject}}'}、{'{{channelName}}'}、{'{{email}}'}、{'{{statusLabel}}'}、{'{{feishuStatus}}'}。
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={resetRules}>
                        恢复默认
                      </Button>
                      <Button className="flex-1" onClick={saveRules}>
                        <Save className="mr-2 h-4 w-4" />
                        保存规则
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="logs" className="min-h-0 overflow-y-auto pt-3">
                  {logs.length === 0 ? (
                    <div className="flex h-48 flex-col items-center justify-center rounded-md border border-dashed text-center">
                      <History className="h-8 w-8 text-muted-foreground" />
                      <p className="mt-2 text-sm font-medium">暂无记录</p>
                      <p className="mt-1 text-xs text-muted-foreground">同步、忽略和失败记录会保留在这里。</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {logs.map((log) => (
                        <div key={`${log.id}-${log.finishedAt}`} className="rounded-md border px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium">{log.event.title}</p>
                            <Badge variant={log.status === 'synced' ? 'secondary' : 'outline'}>
                              {log.status === 'synced' ? '已同步' : '已忽略'}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{log.matchedBy || log.event.summary}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </section>
          )}
        </>
      )}
    </RecordAssistantContext.Provider>
  );
}
