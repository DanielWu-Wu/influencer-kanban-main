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
  Bot,
  CheckCircle2,
  ClipboardList,
  Database,
  History,
  Loader2,
  Save,
  Send,
  Settings2,
  Sparkles,
  UserRound,
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
import { useGmailAuth, useProducts, useSettings } from '@/lib/data';
import type { FeishuFieldKey, FeishuFieldMapping } from '@/lib/feishu-mapping';
import type { AgentAction, AgentFeishuRecord, AgentGmailContext } from '@/lib/agent-assistant';
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
  appendLog: (log: RecordAssistantLog) => void;
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

type AgentChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  summaryBullets?: string[];
  warnings?: string[];
  actions?: AgentAction[];
};

const RecordAssistantContext = createContext<RecordAssistantContextValue | null>(null);

const PENDING_STORAGE_KEY = 'record-assistant-pending-syncs';
const LOG_STORAGE_KEY = 'record-assistant-logs';
const AGENT_RECORD_LIMIT = 140;

const AGENT_EXAMPLES = [
  '看看目前西班牙合作中的红人进度，给我一个简短汇报',
  '把红人 A 标记为合作中',
  '添加这个地址到红人 B 的资料里面，并整理好地址信息',
  '帮我找出 3 天没回复的西班牙红人',
];

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

function getMappedValue(
  record: FeishuRecord,
  mapping: FeishuFieldMapping,
  key: keyof FeishuFieldMapping,
) {
  const fieldName = mapping[key];
  if (!fieldName) return '';
  return stringifyFeishuValue(record.fields[fieldName]);
}

function resolveAgentFieldName(fieldName: string, mapping: FeishuFieldMapping) {
  const directMappedName = mapping[fieldName as keyof FeishuFieldMapping];
  if (directMappedName) return directMappedName;

  const labelEntry = Object.entries(FEISHU_FIELD_LABELS).find(([fieldKey, label]) =>
    fieldName === fieldKey || fieldName === label,
  );
  if (labelEntry) {
    const mappedName = mapping[labelEntry[0] as keyof FeishuFieldMapping];
    if (mappedName) return mappedName;
  }

  return fieldName;
}

function resolveAgentFieldKey(
  fieldName: string,
  fieldLabel: string | undefined,
  mapping: FeishuFieldMapping,
): FeishuFieldKey {
  const mappingEntry = Object.entries(mapping).find(([fieldKey, mappedFieldName]) =>
    fieldName === fieldKey || fieldName === mappedFieldName,
  );
  if (mappingEntry) return mappingEntry[0] as FeishuFieldKey;

  const labelEntry = Object.entries(FEISHU_FIELD_LABELS).find(([fieldKey, label]) =>
    fieldName === fieldKey || fieldName === label || fieldLabel === label,
  );
  if (labelEntry) return labelEntry[0] as FeishuFieldKey;

  return 'notes';
}

function buildAgentActionLog(
  action: AgentAction,
  status: 'synced' | 'failed',
  mapping: FeishuFieldMapping,
  error?: string,
): RecordAssistantLog {
  const now = new Date().toISOString();
  const influencerName = action.influencerName || action.recordId || '未命名红人';

  return {
    id: `agent-action-${action.id}-${Date.now()}`,
    event: {
      type: 'status_changed',
      source: 'manual',
      title: `AI Agent 操作：${influencerName}`,
      summary: action.reason || 'AI Agent 写入飞书记录',
      occurredAt: now,
      influencer: {
        channelName: influencerName,
      },
    },
    updates: action.fields.map((field) => {
      const fieldKey = resolveAgentFieldKey(field.fieldName, field.fieldLabel, mapping);
      const fieldName = resolveAgentFieldName(field.fieldName, mapping);
      return {
        fieldKey,
        fieldLabel: field.fieldLabel || FEISHU_FIELD_LABELS[fieldKey] || field.fieldName,
        fieldName,
        value: field.value,
        valueTemplate: field.value,
        enabled: true,
      };
    }),
    createdAt: now,
    finishedAt: now,
    status,
    error,
    recordId: action.recordId,
    matchedBy: 'AI Agent 确认执行',
  };
}

function toAgentRecord(record: FeishuRecord, mapping: FeishuFieldMapping): AgentFeishuRecord {
  const fields: Record<string, string> = {};
  Object.entries(mapping).forEach(([fieldKey, fieldName]) => {
    if (!fieldName) return;
    const label = FEISHU_FIELD_LABELS[fieldKey as keyof typeof FEISHU_FIELD_LABELS] || fieldKey;
    fields[label] = stringifyFeishuValue(record.fields[fieldName]);
  });

  return {
    recordId: record.record_id,
    channelName: getMappedValue(record, mapping, 'channelName'),
    email: getMappedValue(record, mapping, 'email'),
    region: getMappedValue(record, mapping, 'region'),
    collaborationStatus: getMappedValue(record, mapping, 'collaborationStatus'),
    hasReply: getMappedValue(record, mapping, 'hasReply'),
    progress: getMappedValue(record, mapping, 'collaborationProgress'),
    notes: getMappedValue(record, mapping, 'notes'),
    fields,
  };
}

function scoreAgentRecord(record: AgentFeishuRecord, query: string) {
  const normalizedQuery = normalizeText(query);
  const haystack = normalizeText([
    record.channelName,
    record.email,
    record.region,
    record.collaborationStatus,
    record.hasReply,
    record.progress,
    record.notes,
    Object.values(record.fields).join(' '),
  ].join(' '));
  let score = 0;

  if (record.channelName && normalizedQuery.includes(normalizeText(record.channelName))) score += 80;
  if (record.email && normalizedQuery.includes(normalizeText(record.email))) score += 80;
  if (/西班牙|spain|spanish|españa/i.test(query) && /西班牙|spain|españa|spanish|es/i.test(record.region)) {
    score += 35;
  }
  if (/荷兰|netherlands|dutch|nl/i.test(query) && /荷兰|netherlands|dutch|nl/i.test(record.region)) {
    score += 35;
  }
  if (/德国|germany|deutsch|de/i.test(query) && /德国|germany|deutsch|de/i.test(record.region)) {
    score += 35;
  }
  if (/合作中|合作|洽谈|确认/i.test(query) && /合作中|洽谈|确认|interested|negotiat/i.test(record.collaborationStatus)) {
    score += 20;
  }
  if (/没回复|未回复|没有回复|no reply|3 天|三天/i.test(query) && !/已回复|有回复|replied/i.test(record.hasReply)) {
    score += 20;
  }
  if (haystack.includes(normalizedQuery) && normalizedQuery.length > 1) score += 15;

  const tokens = normalizedQuery
    .split(/[\s,，。:：;；]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  score += tokens.filter((token) => haystack.includes(token)).length * 3;
  return score;
}

function selectAgentRecords(
  records: FeishuRecord[],
  mapping: FeishuFieldMapping,
  query: string,
) {
  const agentRecords = records.map((record) => toAgentRecord(record, mapping));
  const scored = agentRecords
    .map((record) => ({ record, score: scoreAgentRecord(record, query) }))
    .sort((a, b) => b.score - a.score);
  const relevant = scored.filter((item) => item.score > 0).map((item) => item.record);
  return (relevant.length ? relevant : agentRecords).slice(0, AGENT_RECORD_LIMIT);
}

function getGmailHeader(headers: Array<{ name: string; value: string }> = [], name: string) {
  return headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function toAgentProducts(products: ReturnType<typeof useProducts>['products']) {
  return products.slice(0, 20).map((product) => ({
    name: product.name,
    model: product.model,
    status: product.status,
    productUrl: product.productUrl,
    sellingPoints: product.sellingPoints,
    technicalSpecifications: product.technicalSpecifications,
    notes: product.notes,
    markets: product.marketProfiles.slice(0, 8).map((market) => ({
      targetMarket: market.targetMarket,
      siteName: market.siteName,
      promotionBudget: market.promotionBudget,
      cooperationRequirements: market.cooperationRequirements,
      mustMention: market.mustMention,
      prohibitedContent: market.prohibitedContent,
    })),
  }));
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
  const { products } = useProducts();
  const { auth: gmailAuth, connect: connectGmail } = useGmailAuth();
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
  const [activeTab, setActiveTab] = useState('agent');
  const [notice, setNotice] = useState('');
  const [storageReady, setStorageReady] = useState(false);
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([]);
  const [agentInput, setAgentInput] = useState('');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState('');
  const [agentActionStatus, setAgentActionStatus] = useState<Record<string, 'running' | 'done' | 'failed'>>({});

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

  const appendLog = useCallback((log: RecordAssistantLog) => {
    setLogs((current) => [log, ...current].slice(0, 50));
  }, []);

  const getAgentGmailAccessToken = useCallback(async () => {
    if (!gmailAuth?.accessToken) return '';
    if (gmailAuth.expiresAt && gmailAuth.expiresAt > Date.now() + 60_000) {
      return gmailAuth.accessToken;
    }

    const response = await fetch('/api/auth/refresh', { method: 'POST' });
    const result = await response.json();
    if (!response.ok || !result.data?.accessToken) return '';
    connectGmail({
      ...gmailAuth,
      accessToken: result.data.accessToken,
      expiresAt: result.data.expiresAt,
    });
    return result.data.accessToken as string;
  }, [connectGmail, gmailAuth]);

  const fetchAgentGmailContext = useCallback(async (
    query: string,
    records: AgentFeishuRecord[],
  ): Promise<AgentGmailContext> => {
    const accessToken = await getAgentGmailAccessToken();
    if (!accessToken) {
      return { connected: false, recentThreads: [], contactHistories: [] };
    }

    const recentThreads: AgentGmailContext['recentThreads'] = [];
    try {
      const params = new URLSearchParams({
        action: 'threads',
        token: accessToken,
        maxResults: '8',
      });
      const response = await fetch(`/api/gmail?${params.toString()}`);
      const result = await response.json();
      const threads = (result?.data?.threads || []) as Array<{
        messages?: Array<{ payload?: { headers?: Array<{ name: string; value: string }> } }>;
      }>;
      threads.forEach((thread) => {
        const lastMessage = thread.messages?.[thread.messages.length - 1];
        const headers = lastMessage?.payload?.headers || [];
        recentThreads.push({
          subject: getGmailHeader(headers, 'Subject'),
          from: getGmailHeader(headers, 'From'),
          to: getGmailHeader(headers, 'To'),
          date: getGmailHeader(headers, 'Date'),
        });
      });
    } catch {
      // Gmail context is helpful, but the Agent can still work from Feishu and product data.
    }

    const shouldReadContacts = /邮件|回复|没回复|未回复|地址|合作|进度|follow|reply|address/i.test(query);
    const contactEmails = shouldReadContacts
      ? Array.from(new Set(records.map((record) => normalizeEmail(record.email)).filter(Boolean))).slice(0, 5)
      : [];
    const contactHistories: AgentGmailContext['contactHistories'] = [];

    for (const email of contactEmails) {
      try {
        const response = await fetch('/api/gmail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'contactHistory',
            accessToken,
            contactEmail: email,
            maxResults: 8,
          }),
        });
        const result = await response.json();
        if (response.ok && result.success) {
          contactHistories.push({
            email,
            messages: (result.data || []).slice(-8).map((message: {
              subject?: string;
              from?: string;
              to?: string;
              date?: string;
              body?: string;
            }) => ({
              subject: message.subject || '',
              from: message.from || '',
              to: message.to || '',
              date: message.date || '',
              body: String(message.body || '').slice(0, 1000),
            })),
          });
        }
      } catch {
        // Keep the rest of the Agent context available even if one contact lookup fails.
      }
    }

    return { connected: true, recentThreads, contactHistories };
  }, [getAgentGmailAccessToken]);

  const sendAgentMessage = useCallback(async (overrideMessage?: string) => {
    const message = (overrideMessage || agentInput).trim();
    if (!message || agentLoading) return;

    const userMessage: AgentChatMessage = {
      id: `agent-user-${Date.now()}`,
      role: 'user',
      content: message,
    };
    setAgentMessages((current) => [...current, userMessage]);
    setAgentInput('');
    setAgentError('');
    setAgentLoading(true);
    setActiveTab('agent');
    setOpen(true);

    try {
      const mapping = settings.feishuFieldMapping || {};
      const records = settings.feishuUrl ? await fetchFeishuRecords(settings.feishuUrl) : [];
      const selectedRecords = selectAgentRecords(records, mapping, message);
      const gmailContext = await fetchAgentGmailContext(message, selectedRecords);

      const response = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          feishuRecords: selectedRecords,
          fieldMapping: mapping,
          products: toAgentProducts(products),
          gmail: gmailContext,
          modelProvider: settings.modelProvider || 'builtin',
          customApiUrl: settings.customApiUrl || '',
          customModelName: settings.customModelName || '',
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'AI Agent 没有成功返回。');
      }

      const assistantMessage: AgentChatMessage = {
        id: `agent-assistant-${Date.now()}`,
        role: 'assistant',
        content: result.data.reply,
        summaryBullets: result.data.summaryBullets || [],
        warnings: result.data.warnings || [],
        actions: result.data.actions || [],
      };
      setAgentMessages((current) => [...current, assistantMessage]);
      if (assistantMessage.actions?.length) {
        setNotice('Agent 已生成操作预览，请确认后再执行。');
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'AI Agent 调用失败。';
      setAgentError(messageText);
      setAgentMessages((current) => [
        ...current,
        {
          id: `agent-assistant-error-${Date.now()}`,
          role: 'assistant',
          content: messageText,
          warnings: ['这次没有执行任何写入操作。'],
          actions: [],
        },
      ]);
    } finally {
      setAgentLoading(false);
    }
  }, [
    agentInput,
    agentLoading,
    fetchAgentGmailContext,
    products,
    settings.customApiUrl,
    settings.customModelName,
    settings.feishuFieldMapping,
    settings.feishuUrl,
    settings.modelProvider,
  ]);

  const executeAgentAction = async (action: AgentAction) => {
    const mapping = settings.feishuFieldMapping || {};
    if (!settings.feishuUrl) {
      const errorMessage = '请先在设置里连接飞书资源库。';
      setAgentError(errorMessage);
      setLogs((current) => [buildAgentActionLog(action, 'failed', mapping, errorMessage), ...current].slice(0, 50));
      return;
    }

    const actionKey = action.id;
    setAgentActionStatus((current) => ({ ...current, [actionKey]: 'running' }));
    setAgentError('');

    try {
      const fields = Object.fromEntries(
        action.fields
          .filter((field) => field.fieldName && field.value !== undefined)
          .map((field) => [resolveAgentFieldName(field.fieldName, mapping), field.value]),
      );
      if (Object.keys(fields).length === 0) {
        throw new Error('这次操作没有可写入的字段，请重新让 Agent 生成操作预览。');
      }
      const response = await fetch('/api/feishu/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          url: settings.feishuUrl,
          recordId: action.recordId,
          fields,
        }),
      });
      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !result.success) {
        throw new Error(result.error || '写入飞书失败。');
      }

      setAgentActionStatus((current) => ({ ...current, [actionKey]: 'done' }));
      setNotice(`已执行：${action.influencerName || action.recordId}`);
      setLogs((current) => [buildAgentActionLog(action, 'synced', mapping), ...current].slice(0, 50));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '写入飞书失败。';
      setAgentActionStatus((current) => ({ ...current, [actionKey]: 'failed' }));
      setAgentError(errorMessage);
      setLogs((current) => [buildAgentActionLog(action, 'failed', mapping, errorMessage), ...current].slice(0, 50));
    }
  };

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

  const contextValue = useMemo(() => ({ captureEvent, appendLog }), [appendLog, captureEvent]);
  const pendingCount = pending.length;
  const shouldRenderAssistant = pathname !== '/login';

  return (
    <RecordAssistantContext.Provider value={contextValue}>
      {children}
      {shouldRenderAssistant && (
        <>
          {!open && (
            <Button
              className="fixed bottom-24 right-5 z-[90] h-12 rounded-lg px-4 shadow-apple-hover"
              onClick={() => setOpen(true)}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              AI 助手
              {pendingCount > 0 && (
                <Badge variant="secondary" className="ml-2 rounded-md bg-white text-primary">
                  {pendingCount}
                </Badge>
              )}
            </Button>
          )}

          {open && (
            <section className="glass-panel-strong fixed bottom-24 right-5 z-[90] flex h-[min(720px,calc(100vh-7rem))] w-[min(520px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg">
              <header className="flex shrink-0 items-start justify-between border-b border-white/55 bg-white/65 px-4 py-3 backdrop-blur-xl">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold">悬浮 AI Agent 助手</h2>
                    {pendingCount > 0 && <Badge variant="outline" className="rounded-md border-primary/25 bg-primary/10 text-primary">{pendingCount} 待确认</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">先读取和预览，写入飞书前必须由你确认。</p>
                </div>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg hover:bg-white/70" onClick={() => setOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </header>

              {notice && (
                <div className="mx-4 mt-3 rounded-lg border border-blue-100 bg-blue-50/85 px-3 py-2 text-xs text-blue-700 shadow-sm">
                  {notice}
                </div>
              )}

              <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 p-4">
                <TabsList className="grid w-full grid-cols-4 rounded-lg bg-white/55 p-1">
                  <TabsTrigger value="agent" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <Bot className="h-3.5 w-3.5" />
                    对话
                  </TabsTrigger>
                  <TabsTrigger value="pending" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <ClipboardList className="h-3.5 w-3.5" />
                    待确认
                  </TabsTrigger>
                  <TabsTrigger value="rules" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <Settings2 className="h-3.5 w-3.5" />
                    规则
                  </TabsTrigger>
                  <TabsTrigger value="logs" className="rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm">
                    <History className="h-3.5 w-3.5" />
                    记录
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="agent" className="min-h-0 overflow-hidden pt-3">
                  <div className="flex h-full min-h-0 flex-col">
                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                      {agentMessages.length === 0 && (
                        <div className="rounded-lg border border-white/65 bg-white/68 p-3 shadow-apple">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Database className="h-4 w-4 text-primary" />
                            可以直接问我运营问题
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            我会读取飞书红人库、Gmail 摘要和产品资料。涉及写入时，会先列出操作预览，等你确认才执行。
                          </p>
                          <div className="mt-3 grid gap-2">
                            {AGENT_EXAMPLES.map((example) => (
                              <button
                                key={example}
                                type="button"
                                className="rounded-lg border border-white/65 bg-white/72 px-3 py-2 text-left text-xs transition-colors hover:bg-white"
                                onClick={() => void sendAgentMessage(example)}
                              >
                                {example}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {agentMessages.map((message) => (
                        <div
                          key={message.id}
                          className={`rounded-lg border p-3 shadow-sm ${
                            message.role === 'user' ? 'border-primary bg-primary text-primary-foreground' : 'border-white/65 bg-white/75'
                          }`}
                        >
                          <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                            {message.role === 'user'
                              ? <UserRound className="h-3.5 w-3.5" />
                              : <Bot className="h-3.5 w-3.5 text-primary" />}
                            {message.role === 'user' ? '你' : 'AI Agent'}
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>

                          {Boolean(message.summaryBullets?.length) && (
                            <ul className="mt-3 space-y-1 text-xs">
                              {message.summaryBullets?.map((item, index) => (
                                <li key={`${message.id}-summary-${index}`}>· {item}</li>
                              ))}
                            </ul>
                          )}

                          {Boolean(message.warnings?.length) && (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/85 px-3 py-2 text-xs text-amber-700">
                              {message.warnings?.map((warning) => (
                                <p key={warning}>· {warning}</p>
                              ))}
                            </div>
                          )}

                          {Boolean(message.actions?.length) && (
                            <div className="mt-3 space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-foreground shadow-sm">
                              <p className="text-xs font-semibold">操作预览：确认后才会写入飞书</p>
                              {message.actions?.map((action) => {
                                const status = agentActionStatus[action.id];
                                const mapping = settings.feishuFieldMapping || {};
                                return (
                                  <div key={action.id} className="rounded-lg border border-white/65 bg-white/82 p-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0">
                                        <p className="truncate text-sm font-medium">
                                          {action.influencerName || action.recordId}
                                        </p>
                                        <p className="mt-1 text-xs text-muted-foreground">{action.reason}</p>
                                      </div>
                                      {status === 'done' && <Badge variant="secondary">已执行</Badge>}
                                      {status === 'failed' && <Badge variant="destructive">失败</Badge>}
                                    </div>

                                    <div className="mt-3 space-y-2">
                                      {action.fields.map((field) => (
                                        <div key={`${action.id}-${field.fieldName}`} className="rounded-md bg-white/70 px-3 py-2">
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-medium">
                                              {field.fieldLabel || field.fieldName}
                                            </span>
                                            <span className="truncate text-[11px] text-muted-foreground">
                                              {resolveAgentFieldName(field.fieldName, mapping)}
                                            </span>
                                          </div>
                                          <p className="mt-1 whitespace-pre-wrap text-xs">{field.value}</p>
                                        </div>
                                      ))}
                                    </div>

                                    <div className="mt-3 flex justify-end">
                                      <Button
                                        size="sm"
                                        className="rounded-lg"
                                        disabled={status === 'running' || status === 'done'}
                                        onClick={() => void executeAgentAction(action)}
                                      >
                                        {status === 'running' && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                                        {status === 'done' ? '已执行' : '确认执行'}
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}

                      {agentLoading && (
                        <div className="flex items-center gap-2 rounded-lg border border-white/65 bg-white/75 p-3 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          正在读取飞书、Gmail 和产品资料...
                        </div>
                      )}

                      {agentError && (
                        <div className="rounded-lg border border-red-100 bg-red-50/90 px-3 py-2 text-xs text-red-700">
                          {agentError}
                        </div>
                      )}
                    </div>

                    <form
                      className="mt-3 shrink-0 space-y-2 border-t border-white/55 pt-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void sendAgentMessage();
                      }}
                    >
                      <Textarea
                        value={agentInput}
                        placeholder="例如：把某个红人标记为合作中，或汇报西班牙合作进度..."
                        className="min-h-20 resize-none rounded-lg bg-white/75 text-sm"
                        onChange={(event) => setAgentInput(event.target.value)}
                      />
                      <Button className="h-10 w-full rounded-lg" disabled={agentLoading || !agentInput.trim()}>
                        {agentLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        发送给 Agent
                      </Button>
                    </form>
                  </div>
                </TabsContent>

                <TabsContent value="pending" className="min-h-0 overflow-y-auto pt-3">
                  {pending.length === 0 ? (
                    <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-white/70 bg-white/45 text-center">
                      <CheckCircle2 className="h-8 w-8 text-green-600" />
                      <p className="mt-2 text-sm font-medium">暂无待确认同步</p>
                      <p className="mt-1 text-xs text-muted-foreground">发送邮件或拖动看板状态后会出现在这里。</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {pending.map((sync) => (
                        <div key={sync.id} className="rounded-lg border border-white/65 bg-white/72 p-3 shadow-sm">
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
                              <div key={`${sync.id}-${update.fieldKey}`} className="rounded-md bg-white/70 px-3 py-2">
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
                            <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-100 bg-red-50/90 px-3 py-2 text-xs text-red-700">
                              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                              <span>{sync.error}</span>
                            </div>
                          )}

                          <div className="mt-3 flex justify-end gap-2">
                            <Button variant="ghost" size="sm" className="rounded-lg hover:bg-white/70" onClick={() => ignoreSync(sync)}>
                              忽略
                            </Button>
                            <Button
                              size="sm"
                              className="rounded-lg"
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
                    <div className="flex items-center justify-between rounded-lg border border-white/65 bg-white/72 px-3 py-2 shadow-sm">
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
                      <div key={rule.id} className="rounded-lg border border-white/65 bg-white/72 p-3 shadow-sm">
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
                            <SelectTrigger className="w-full rounded-lg bg-white/75">
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
                            <div key={`${rule.id}-${update.fieldKey}`} className="rounded-lg bg-white/65 p-3">
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
                                className="min-h-16 rounded-lg bg-white/75 text-xs"
                                onChange={(event) => updateRuleTemplate(rule.id, index, event.target.value)}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div className="rounded-lg border border-white/65 bg-white/60 px-3 py-2 text-xs text-muted-foreground">
                      可用变量：{'{{today}}'}、{'{{subject}}'}、{'{{channelName}}'}、{'{{email}}'}、{'{{statusLabel}}'}、{'{{feishuStatus}}'}。
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" className="h-10 flex-1 rounded-lg bg-white/75" onClick={resetRules}>
                        恢复默认
                      </Button>
                      <Button className="h-10 flex-1 rounded-lg" onClick={saveRules}>
                        <Save className="mr-2 h-4 w-4" />
                        保存规则
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="logs" className="min-h-0 overflow-y-auto pt-3">
                  {logs.length === 0 ? (
                    <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-white/70 bg-white/45 text-center">
                      <History className="h-8 w-8 text-muted-foreground" />
                      <p className="mt-2 text-sm font-medium">暂无记录</p>
                      <p className="mt-1 text-xs text-muted-foreground">同步、忽略和失败记录会保留在这里。</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {logs.map((log) => (
                        <div key={`${log.id}-${log.finishedAt}`} className="rounded-lg border border-white/65 bg-white/72 px-3 py-2 shadow-sm">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium">{log.event.title}</p>
                            <Badge variant={log.status === 'failed' ? 'destructive' : log.status === 'synced' ? 'secondary' : 'outline'}>
                              {log.status === 'synced'
                                ? '已同步'
                                : log.status === 'failed'
                                  ? '失败'
                                  : '已忽略'}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{log.matchedBy || log.event.summary}</p>
                          {log.error && (
                            <p className="mt-1 text-xs text-destructive">{log.error}</p>
                          )}
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
