'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  Influencer, EmailTemplate, FollowUpReminder, EmailRecord, 
  Collaboration, TodoItem, CalendarEvent,
  GmailAuth, GmailSettings, GmailThread, GmailMessage,
  EmailTranslation, EmailDraftSuggestion, EmailDraft
} from './types';

// localStorage keys
const STORAGE_KEYS = {
  INFLUENCERS: 'influencer-board-influencers',
  TEMPLATES: 'influencer-board-templates',
  REMINDERS: 'influencer-board-reminders',
  EMAILS: 'influencer-board-emails',
  COLLABORATIONS: 'influencer-board-collaborations',
  TODOS: 'influencer-board-todos',
  CALENDAR_EVENTS: 'influencer-board-calendar-events',
  SETTINGS: 'influencer-board-settings',
};

// 应用设置
export interface AppSettings {
  feishuUrl?: string;      // 飞书多维表格 URL
  brandName?: string;      // 品牌名称
  senderName?: string;     // 发件人名称
  gmailClientId?: string;     // Gmail OAuth Client ID
  gmailClientSecret?: string; // Gmail OAuth Client Secret
  translatePrompt?: string;   // 翻译提示词
  aiEmailPrompt?: string;     // AI 邮件回复提示词
  // 模型 API 设置
  modelProvider?: 'builtin' | 'custom';  // 模型来源：内置 DeepSeek / 自定义 API
  customApiUrl?: string;      // 自定义 API 地址（OpenAI 兼容格式）
  customApiKey?: string;      // 自定义 API Key
  customModelName?: string;   // 自定义模型名称
}

function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>({});

  useEffect(() => {
    setSettings(loadSettings());

    // 监听其他组件对 settings 的更新
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.SETTINGS) {
        setSettings(e.newValue ? JSON.parse(e.newValue) : {});
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings(prev => {
      const newSettings = { ...prev, ...updates };
      saveSettings(newSettings);
      // 使用 setTimeout 避免在渲染期间更新其他组件
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('settings-updated', { detail: newSettings }));
      }, 0);
      return newSettings;
    });
  }, []);

  // 监听同一页面内的 settings 更新（localStorage 事件不会在同一页面触发）
  useEffect(() => {
    const handleCustom = (e: Event) => {
      const customEvent = e as CustomEvent<AppSettings>;
      setSettings(customEvent.detail);
    };
    window.addEventListener('settings-updated', handleCustom);
    return () => window.removeEventListener('settings-updated', handleCustom);
  }, []);

  return { settings, updateSettings };
}

// 生成唯一ID
export const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// 默认邮件模板
const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    id: 'template-1',
    name: '冷开发信',
    type: 'cold',
    subject: '合作邀请 - {品牌名} x {频道名}',
    content: `你好 {红人名}，

我是 {品牌名} 的海外推广负责人。

我非常关注你的频道，你的 {内容风格} 内容给我留下了深刻印象，尤其是{代表作品}这个视频。

我们正在寻找欧洲地区的优质 YouTuber 进行产品合作，希望能够与你建立长期合作关系。

产品介绍：{产品名}
产品价值：{产品价值}

如果你对此感兴趣，我们可以进一步沟通合作细节。

期待你的回复！

{发送人名}
{品牌名} 海外推广团队`,
    variables: ['品牌名', '频道名', '红人名', '内容风格', '代表作品', '产品名', '产品价值', '发送人名'],
    isDefault: true,
  },
  {
    id: 'template-2',
    name: '跟进提醒（3天后）',
    type: 'follow_up_1',
    subject: 'Re: 合作邀请 - {品牌名} x {频道名}',
    content: `你好 {红人名}，

想跟进一下之前发送的合作邀请，不知道你是否有机会查看？

如果现在不方便合作也没关系，我们可以保持联系，未来有合适的机会再合作。

期待你的回复！

{发送人名}`,
    variables: ['红人名', '品牌名', '发送人名'],
    isDefault: true,
  },
  {
    id: 'template-3',
    name: '跟进提醒（7天后）',
    type: 'follow_up_2',
    subject: 'Hi {红人名}，{品牌名} 的合作邀请',
    content: `Hi {红人名}，

再次打扰你了。

我们真的很欣赏你的内容风格，相信我们的产品会非常适合你的观众。

如果你有任何问题，欢迎随时联系我。

祝好！

{发送人名}`,
    variables: ['红人名', '品牌名', '发送人名'],
    isDefault: true,
  },
  {
    id: 'template-4',
    name: '关怀邮件（包裹签收后）',
    type: 'care',
    subject: '{红人名}，请问包裹签收情况如何？',
    content: `Hi {红人名}，

快递已经发出有一段时间了，想问一下包裹是否已经安全签收？

另外，方便告诉我你计划什么时候开始拍摄视频吗？

如果有任何问题，请随时告诉我。

{发送人名}`,
    variables: ['红人名', '发送人名'],
    isDefault: true,
  },
  {
    id: 'template-5',
    name: '感谢邮件（视频发布后）',
    type: 'thank',
    subject: '感谢 {红人名} 的精彩视频！',
    content: `Hi {红人名}，

刚看到你发布的视频，真的太棒了！感谢你详细介绍我们的产品。

你的观众反馈非常热烈，恭喜获得这么多好评！

期待未来更多合作机会。

再次感谢！

{发送人名}`,
    variables: ['红人名', '发送人名'],
    isDefault: true,
  },
];

// 加载数据
function loadData<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

// 保存数据
function saveData<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(data));
}

// 红人管理 Hook
export function useInfluencers() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);

  // 初始化加载
  useEffect(() => {
    const data = loadData<Influencer[]>(STORAGE_KEYS.INFLUENCERS, []);
    setInfluencers(data);
    setLoading(false);
  }, []);

  // 保存数据
  const saveInfluencers = useCallback((newData: Influencer[]) => {
    setInfluencers(newData);
    saveData(STORAGE_KEYS.INFLUENCERS, newData);
  }, []);

  // 添加红人
  const addInfluencer = useCallback((influencer: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newInfluencer: Influencer = {
      ...influencer,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    saveInfluencers([...influencers, newInfluencer]);
    return newInfluencer;
  }, [influencers, saveInfluencers]);

  // 更新红人
  const updateInfluencer = useCallback((id: string, updates: Partial<Influencer>) => {
    const newData = influencers.map(item =>
      item.id === id 
        ? { ...item, ...updates, updatedAt: new Date().toISOString() }
        : item
    );
    saveInfluencers(newData);
  }, [influencers, saveInfluencers]);

  // 删除红人
  const deleteInfluencer = useCallback((id: string) => {
    saveInfluencers(influencers.filter(item => item.id !== id));
  }, [influencers, saveInfluencers]);

  // 更新状态（看板拖拽）
  const updateStatus = useCallback((id: string, status: Influencer['status']) => {
    updateInfluencer(id, { status });
  }, [updateInfluencer]);

  // 批量移动状态
  const batchUpdateStatus = useCallback((ids: string[], status: Influencer['status']) => {
    const newData = influencers.map(item =>
      ids.includes(item.id)
        ? { ...item, status, updatedAt: new Date().toISOString() }
        : item
    );
    saveInfluencers(newData);
  }, [influencers, saveInfluencers]);

  return {
    influencers,
    loading,
    addInfluencer,
    updateInfluencer,
    deleteInfluencer,
    updateStatus,
    batchUpdateStatus,
  };
}

// 邮件模板 Hook
export function useEmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>(DEFAULT_TEMPLATES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const data = loadData<EmailTemplate[]>(STORAGE_KEYS.TEMPLATES, DEFAULT_TEMPLATES);
    setTemplates(data);
    setLoading(false);
  }, []);

  const saveTemplates = useCallback((newData: EmailTemplate[]) => {
    setTemplates(newData);
    saveData(STORAGE_KEYS.TEMPLATES, newData);
  }, []);

  const addTemplate = useCallback((template: Omit<EmailTemplate, 'id'>) => {
    const newTemplate: EmailTemplate = {
      ...template,
      id: generateId(),
    };
    saveTemplates([...templates, newTemplate]);
    return newTemplate;
  }, [templates, saveTemplates]);

  const updateTemplate = useCallback((id: string, updates: Partial<EmailTemplate>) => {
    saveTemplates(templates.map(t => t.id === id ? { ...t, ...updates } : t));
  }, [templates, saveTemplates]);

  const deleteTemplate = useCallback((id: string) => {
    saveTemplates(templates.filter(t => t.id !== id));
  }, [templates, saveTemplates]);

  return { templates, loading, addTemplate, updateTemplate, deleteTemplate };
}

// 跟进提醒 Hook
export function useReminders() {
  const [reminders, setReminders] = useState<FollowUpReminder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const data = loadData<FollowUpReminder[]>(STORAGE_KEYS.REMINDERS, []);
    setReminders(data);
    setLoading(false);
  }, []);

  const saveReminders = useCallback((newData: FollowUpReminder[]) => {
    setReminders(newData);
    saveData(STORAGE_KEYS.REMINDERS, newData);
  }, []);

  const addReminder = useCallback((reminder: Omit<FollowUpReminder, 'id'>) => {
    const newReminder: FollowUpReminder = {
      ...reminder,
      id: generateId(),
    };
    saveReminders([...reminders, newReminder]);
    return newReminder;
  }, [reminders, saveReminders]);

  const completeReminder = useCallback((id: string) => {
    saveReminders(reminders.map(r => r.id === id ? { ...r, status: 'completed' as const } : r));
  }, [reminders, saveReminders]);

  const skipReminder = useCallback((id: string, note?: string) => {
    saveReminders(reminders.map(r => r.id === id ? { ...r, status: 'skipped' as const, note: note || '' } : r));
  }, [reminders, saveReminders]);

  // 获取待提醒
  const pendingReminders = reminders.filter(r => r.status === 'pending');

  return { reminders, loading, pendingReminders, addReminder, completeReminder, skipReminder };
}

// 邮件记录 Hook
export function useEmailRecords() {
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const data = loadData<EmailRecord[]>(STORAGE_KEYS.EMAILS, []);
    setEmails(data);
    setLoading(false);
  }, []);

  const saveEmails = useCallback((newData: EmailRecord[]) => {
    setEmails(newData);
    saveData(STORAGE_KEYS.EMAILS, newData);
  }, []);

  const addEmail = useCallback((email: Omit<EmailRecord, 'id'>) => {
    const newEmail: EmailRecord = {
      ...email,
      id: generateId(),
    };
    saveEmails([...emails, newEmail]);
    return newEmail;
  }, [emails, saveEmails]);

  // 获取某红人的邮件记录
  const getEmailsByInfluencer = useCallback((influencerId: string) => {
    return emails.filter(e => e.influencerId === influencerId);
  }, [emails]);

  return { emails, loading, addEmail, getEmailsByInfluencer };
}

// 合作项目 Hook
export function useCollaborations() {
  const [collaborations, setCollaborations] = useState<Collaboration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const data = loadData<Collaboration[]>(STORAGE_KEYS.COLLABORATIONS, []);
    setCollaborations(data);
    setLoading(false);
  }, []);

  const saveCollaborations = useCallback((newData: Collaboration[]) => {
    setCollaborations(newData);
    saveData(STORAGE_KEYS.COLLABORATIONS, newData);
  }, []);

  const addCollaboration = useCallback((collab: Omit<Collaboration, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const newCollab: Collaboration = {
      ...collab,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    saveCollaborations([...collaborations, newCollab]);
    return newCollab;
  }, [collaborations, saveCollaborations]);

  const updateCollaboration = useCallback((id: string, updates: Partial<Collaboration>) => {
    saveCollaborations(collaborations.map(c => 
      c.id === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
    ));
  }, [collaborations, saveCollaborations]);

  const getCollaborationByInfluencer = useCallback((influencerId: string) => {
    return collaborations.find(c => c.influencerId === influencerId);
  }, [collaborations]);

  return { collaborations, loading, addCollaboration, updateCollaboration, getCollaborationByInfluencer };
}

// ==================== Todo List Hook ====================

export function useTodos() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const data = loadData<TodoItem[]>(STORAGE_KEYS.TODOS, []);
    setTodos(data);
    setLoading(false);
  }, []);

  const saveTodos = useCallback((newData: TodoItem[]) => {
    setTodos(newData);
    saveData(STORAGE_KEYS.TODOS, newData);
  }, []);

  const addTodo = useCallback((todo: Omit<TodoItem, 'id' | 'createdAt'>) => {
    const newTodo: TodoItem = {
      ...todo,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    saveTodos([...todos, newTodo]);
    return newTodo;
  }, [todos, saveTodos]);

  const updateTodo = useCallback((id: string, updates: Partial<TodoItem>) => {
    saveTodos(todos.map(t => t.id === id ? { ...t, ...updates } : t));
  }, [todos, saveTodos]);

  const deleteTodo = useCallback((id: string) => {
    saveTodos(todos.filter(t => t.id !== id));
  }, [todos, saveTodos]);

  const toggleTodo = useCallback((id: string) => {
    const todo = todos.find(t => t.id === id);
    if (todo) {
      const newStatus = todo.status === 'completed' ? 'pending' : 'completed';
      const updates: Partial<TodoItem> = {
        status: newStatus,
        completedAt: newStatus === 'completed' ? new Date().toISOString() : undefined,
      };
      updateTodo(id, updates);
    }
  }, [todos, updateTodo]);

  const completeTodo = useCallback((id: string) => {
    updateTodo(id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });
  }, [updateTodo]);

  // 获取今日待办
  const todayTodos = todos.filter(t => {
    if (t.status === 'completed') return false;
    if (!t.dueDate) return true;
    const today = new Date().toISOString().split('T')[0];
    return t.dueDate === today;
  });

  // 获取本周待办
  const weekTodos = todos.filter(t => {
    if (t.status === 'completed') return false;
    if (!t.dueDate) return false;
    const today = new Date();
    const weekStart = new Date(today.setDate(today.getDate() - today.getDay()));
    const weekEnd = new Date(today.setDate(today.getDate() + (6 - today.getDay())));
    const dueDate = new Date(t.dueDate);
    return dueDate >= weekStart && dueDate <= weekEnd;
  });

  return {
    todos,
    loading,
    todayTodos,
    weekTodos,
    addTodo,
    updateTodo,
    deleteTodo,
    toggleTodo,
    completeTodo,
  };
}

// ==================== Calendar Events Hook ====================

export function useCalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const data = loadData<CalendarEvent[]>(STORAGE_KEYS.CALENDAR_EVENTS, []);
    setEvents(data);
    setLoading(false);
  }, []);

  const saveEvents = useCallback((newData: CalendarEvent[]) => {
    setEvents(newData);
    saveData(STORAGE_KEYS.CALENDAR_EVENTS, newData);
  }, []);

  const addEvent = useCallback((event: Omit<CalendarEvent, 'id'>) => {
    const newEvent: CalendarEvent = {
      ...event,
      id: generateId(),
    };
    saveEvents([...events, newEvent]);
    return newEvent;
  }, [events, saveEvents]);

  const updateEvent = useCallback((id: string, updates: Partial<CalendarEvent>) => {
    saveEvents(events.map(e => e.id === id ? { ...e, ...updates } : e));
  }, [events, saveEvents]);

  const deleteEvent = useCallback((id: string) => {
    saveEvents(events.filter(e => e.id !== id));
  }, [events, saveEvents]);

  // 获取指定日期的事件
  const getEventsByDate = useCallback((date: string) => {
    return events.filter(e => e.date === date);
  }, [events]);

  // 获取指定月份的事件
  const getEventsByMonth = useCallback((year: number, month: number) => {
    return events.filter(e => {
      const eventDate = new Date(e.date);
      return eventDate.getFullYear() === year && eventDate.getMonth() === month;
    });
  }, [events]);

  return {
    events,
    loading,
    addEvent,
    updateEvent,
    deleteEvent,
    getEventsByDate,
    getEventsByMonth,
  };
}

// ==================== Gmail 集成 Hooks ====================

// Gmail 授权状态
const GMAIL_STORAGE_KEYS = {
  AUTH: 'gmail-auth',
  THREADS: 'gmail-threads',
  TRANSLATIONS: 'gmail-translations',
  DRAFTS: 'gmail-drafts',
  AI_SUGGESTIONS: 'gmail-ai-suggestions',
  SETTINGS: 'gmail-settings',
};

export function useGmailAuth() {
  const [auth, setAuth] = useState<GmailAuth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = loadData<GmailAuth | null>(GMAIL_STORAGE_KEYS.AUTH, null);
    setAuth(stored);
    setLoading(false);
  }, []);

  const saveAuth = useCallback((newAuth: GmailAuth | null) => {
    setAuth(newAuth);
    saveData(GMAIL_STORAGE_KEYS.AUTH, newAuth);
  }, []);

  const connect = useCallback((authData: GmailAuth) => {
    saveAuth(authData);
  }, [saveAuth]);

  const disconnect = useCallback(() => {
    saveAuth(null);
  }, [saveAuth]);

  return { auth, loading, connect, disconnect };
}

export function useGmailSettings() {
  const [settings, setSettings] = useState<GmailSettings>({
    autoCheck: true,
    checkInterval: 5,
    notifyOnNewEmail: true,
    matchWithInfluencers: true,
  });

  useEffect(() => {
    const stored = loadData<GmailSettings | null>(GMAIL_STORAGE_KEYS.SETTINGS, null);
    if (stored) setSettings(stored);
  }, []);

  const updateSettings = useCallback((updates: Partial<GmailSettings>) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    saveData(GMAIL_STORAGE_KEYS.SETTINGS, newSettings);
  }, [settings]);

  return { settings, updateSettings };
}

// Gmail 邮件对话管理
export function useGmailThreads() {
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = loadData<GmailThread[]>(GMAIL_STORAGE_KEYS.THREADS, []);
    setThreads(stored);
    setLoading(false);
  }, []);

  const saveThreads = useCallback((newThreads: GmailThread[]) => {
    setThreads(newThreads);
    saveData(GMAIL_STORAGE_KEYS.THREADS, newThreads);
  }, []);

  // 添加或更新对话
  const updateThread = useCallback((thread: GmailThread) => {
    const existingIndex = threads.findIndex(t => t.id === thread.id);
    if (existingIndex >= 0) {
      const newThreads = [...threads];
      newThreads[existingIndex] = thread;
      saveThreads(newThreads);
    } else {
      saveThreads([thread, ...threads]);
    }
  }, [threads, saveThreads]);

  // 标记为已读
  const markAsRead = useCallback((threadId: string) => {
    const newThreads = threads.map(t => 
      t.id === threadId ? { ...t, hasUnread: false } : t
    );
    saveThreads(newThreads);
  }, [threads, saveThreads]);

  // 删除对话
  const deleteThread = useCallback((threadId: string) => {
    saveThreads(threads.filter(t => t.id !== threadId));
  }, [threads, saveThreads]);

  // 获取未读数
  const unreadCount = threads.filter(t => t.hasUnread).length;

  // 获取新邮件（最近24小时的）
  const recentThreads = threads.filter(t => {
    const lastDate = new Date(t.lastMessageDate);
    const now = new Date();
    const diffHours = (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60);
    return diffHours < 24;
  });

  return { threads, loading, unreadCount, recentThreads, updateThread, markAsRead, deleteThread };
}

// 邮件翻译管理
export function useEmailTranslations() {
  const [translations, setTranslations] = useState<EmailTranslation[]>([]);

  useEffect(() => {
    const stored = loadData<EmailTranslation[]>(GMAIL_STORAGE_KEYS.TRANSLATIONS, []);
    setTranslations(stored);
  }, []);

  const saveTranslations = useCallback((newTranslations: EmailTranslation[]) => {
    setTranslations(newTranslations);
    saveData(GMAIL_STORAGE_KEYS.TRANSLATIONS, newTranslations);
  }, []);

  const addTranslation = useCallback((translation: Omit<EmailTranslation, 'id' | 'createdAt'>) => {
    const newTranslation: EmailTranslation = {
      ...translation,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    saveTranslations([...translations, newTranslation]);
    return newTranslation;
  }, [translations, saveTranslations]);

  // 获取某邮件的翻译
  const getTranslation = useCallback((messageId: string) => {
    return translations.find(t => t.messageId === messageId);
  }, [translations]);

  return { translations, addTranslation, getTranslation };
}

// AI 邮件建议管理
export function useEmailAISuggestions() {
  const [suggestions, setSuggestions] = useState<EmailDraftSuggestion[]>([]);

  useEffect(() => {
    const stored = loadData<EmailDraftSuggestion[]>(GMAIL_STORAGE_KEYS.AI_SUGGESTIONS, []);
    setSuggestions(stored);
  }, []);

  const saveSuggestions = useCallback((newSuggestions: EmailDraftSuggestion[]) => {
    setSuggestions(newSuggestions);
    saveData(GMAIL_STORAGE_KEYS.AI_SUGGESTIONS, newSuggestions);
  }, []);

  const addSuggestion = useCallback((suggestion: Omit<EmailDraftSuggestion, 'id' | 'generatedAt'>) => {
    const newSuggestion: EmailDraftSuggestion = {
      ...suggestion,
      id: generateId(),
      generatedAt: new Date().toISOString(),
    };
    saveSuggestions([...suggestions, newSuggestion]);
    return newSuggestion;
  }, [suggestions, saveSuggestions]);

  const approveSuggestion = useCallback((id: string) => {
    const suggestion = suggestions.find(s => s.id === id);
    if (suggestion) {
      const newSuggestions = suggestions.map(s => 
        s.id === id ? { ...s, status: 'approved' as const } : s
      );
      saveSuggestions(newSuggestions);
    }
  }, [suggestions, saveSuggestions]);

  const rejectSuggestion = useCallback((id: string) => {
    const newSuggestions = suggestions.map(s => 
      s.id === id ? { ...s, status: 'rejected' as const } : s
    );
    saveSuggestions(newSuggestions);
  }, [suggestions, saveSuggestions]);

  // 获取待审核建议
  const pendingSuggestions = suggestions.filter(s => s.status === 'pending');

  return { suggestions, pendingSuggestions, addSuggestion, approveSuggestion, rejectSuggestion };
}

// 邮件草稿管理
export function useEmailDrafts() {
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);

  useEffect(() => {
    const stored = loadData<EmailDraft[]>(GMAIL_STORAGE_KEYS.DRAFTS, []);
    setDrafts(stored);
  }, []);

  const saveDrafts = useCallback((newDrafts: EmailDraft[]) => {
    setDrafts(newDrafts);
    saveData(GMAIL_STORAGE_KEYS.DRAFTS, newDrafts);
  }, []);

  const addDraft = useCallback((draft: Omit<EmailDraft, 'id' | 'createdAt' | 'status'>) => {
    const newDraft: EmailDraft = {
      ...draft,
      id: generateId(),
      createdAt: new Date().toISOString(),
      status: 'draft',
    };
    saveDrafts([...drafts, newDraft]);
    return newDraft;
  }, [drafts, saveDrafts]);

  const updateDraft = useCallback((id: string, updates: Partial<EmailDraft>) => {
    const newDrafts = drafts.map(d => 
      d.id === id ? { ...d, ...updates } : d
    );
    saveDrafts(newDrafts);
  }, [drafts, saveDrafts]);

  const deleteDraft = useCallback((id: string) => {
    saveDrafts(drafts.filter(d => d.id !== id));
  }, [drafts, saveDrafts]);

  // 标记为已发送
  const markAsSent = useCallback((id: string) => {
    const newDrafts = drafts.map(d => 
      d.id === id ? { ...d, status: 'sent' as const } : d
    );
    saveDrafts(newDrafts);
  }, [drafts, saveDrafts]);

  // 获取草稿
  const draftEmails = drafts.filter(d => d.status === 'draft');

  return { drafts, draftEmails, addDraft, updateDraft, deleteDraft, markAsSent };
}
