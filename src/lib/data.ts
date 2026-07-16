'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Influencer,
  EmailTemplate,
  FollowUpReminder,
  EmailRecord,
  Collaboration,
  TodoItem,
  CalendarEvent,
  GmailAuth,
  GmailSettings,
  GmailThread,
  EmailTranslation,
  EmailDraftSuggestion,
  EmailDraft,
  Product,
} from './types';
import type { PromptTemplate } from './ai-prompts';
import type { FeishuFieldMapping } from './feishu-mapping';
import type { RecordAssistantSettings } from './record-assistant';
import { getSupabaseBrowserClient } from './supabase/client';

export const STORAGE_KEYS = {
  INFLUENCERS: 'influencer-board-influencers',
  TEMPLATES: 'influencer-board-templates',
  REMINDERS: 'influencer-board-reminders',
  EMAILS: 'influencer-board-emails',
  COLLABORATIONS: 'influencer-board-collaborations',
  TODOS: 'influencer-board-todos',
  CALENDAR_EVENTS: 'influencer-board-calendar-events',
  PRODUCTS: 'influencer-board-products',
  SETTINGS: 'influencer-board-settings',
};

export const PRODUCTS_UPDATED_EVENT = 'products-updated';
export const PRODUCTS_CLOUD_UPDATED_EVENT = 'products-cloud-updated';

function notifyProductsUpdated(products: Product[]): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<Product[]>(PRODUCTS_UPDATED_EVENT, { detail: products }));
}

function notifyCloudProductsUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PRODUCTS_CLOUD_UPDATED_EVENT));
}

const GMAIL_STORAGE_KEYS = {
  AUTH: 'gmail-auth',
  THREADS: 'gmail-threads',
  TRANSLATIONS: 'gmail-translations',
  DRAFTS: 'gmail-drafts',
  AI_SUGGESTIONS: 'gmail-ai-suggestions',
  SETTINGS: 'gmail-settings',
};

export interface AppSettings {
  feishuUrl?: string;
  feishuFieldMapping?: FeishuFieldMapping;
  feishuProspectingUrl?: string;
  feishuProspectingFieldMapping?: FeishuFieldMapping;
  feishuCooperationUrl?: string;
  feishuCooperationFieldMapping?: FeishuFieldMapping;
  recordAssistantSettings?: RecordAssistantSettings;
  brandName?: string;
  senderName?: string;
  emailSignature?: string;
  emailSendDelaySeconds?: number;
  gmailClientId?: string;
  gmailClientSecret?: string;
  translatePrompt?: string;
  aiEmailPrompt?: string;
  aiAnalysisPrompt?: string;
  aiDraftPrompt?: string;
  aiOutreachPrompt?: string;
  promptTemplates?: PromptTemplate[];
  modelProvider?: 'builtin' | 'custom';
  customApiUrl?: string;
  customApiKey?: string;
  customApiKeyConfigured?: boolean;
  customModelName?: string;
  youtubeApiKey?: string;
  youtubeApiKeyConfigured?: boolean;
  youtubeDefaultRegion?: string;
  youtubeDefaultLanguage?: string;
  youtubeSearchKeywords?: string;
  youtubeMaxSearchResults?: number;
  youtubeMinSubscribers?: string;
  youtubeAutoEnrichEnabled?: boolean;
  gmailSettings?: GmailSettings;
}

export const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  {
    id: 'template-cold-youtube',
    name: '\u4e2a\u6027\u5316 YouTube \u51b7\u5f00\u53d1\u4fe1',
    type: 'cold',
    subject: 'Collaboration opportunity - {brandName} x {channelName}',
    content: `Hi {creatorName},

I am {senderName} from {brandName}. I came across your YouTube channel, {channelName}, and really liked how you cover {channelTopic}. Your audience feels highly relevant to our product, especially because {personalizedReason}.

We are looking for YouTube creators to collaborate with on {productName}. I think it could be a natural fit for your viewers, and we would be happy to discuss a review, sponsored integration, or another format that works best for your channel.

Would you be open to sharing your collaboration options and rates?

Best regards,
{senderName}`,
    variables: [
      'brandName',
      'channelName',
      'creatorName',
      'senderName',
      'channelTopic',
      'personalizedReason',
      'productName',
    ],
    isDefault: true,
  },
  {
    id: 'template-follow-up-1',
    name: '\u9996\u6b21\u8ddf\u8fdb\u90ae\u4ef6',
    type: 'follow_up_1',
    subject: 'Re: Collaboration opportunity - {brandName} x {channelName}',
    content: `Hi {creatorName},

Just following up on my previous email about a possible collaboration with {brandName}.

I would be happy to share more product details or discuss a format that fits your YouTube channel. Please let me know if this is something you would be open to exploring.

Best regards,
{senderName}`,
    variables: ['brandName', 'channelName', 'creatorName', 'senderName'],
    isDefault: true,
  },
  {
    id: 'template-negotiation',
    name: '\u62a5\u4ef7\u8c08\u5224\u56de\u590d',
    type: 'inquiry',
    subject: 'Re: Collaboration details',
    content: `Hi {creatorName},

Thank you for sharing the details and your rate.

The collaboration sounds interesting to us. Our current budget for this campaign is {targetBudget}. Would you be open to working within this range, or considering a product review format with a smaller sponsorship fee?

We are flexible on the content format and would like to find a plan that works for both sides.

Best regards,
{senderName}`,
    variables: ['creatorName', 'targetBudget', 'senderName'],
    isDefault: true,
  },
  {
    id: 'template-sample-follow-up',
    name: '\u5bc4\u6837\u540e\u8ddf\u8fdb',
    type: 'care',
    subject: 'Checking in about the sample delivery',
    content: `Hi {creatorName},

I wanted to check whether the sample has arrived safely.

When convenient, could you also let me know your estimated filming or publishing schedule? If you need any product information, images, or talking points, I would be happy to prepare them for you.

Best regards,
{senderName}`,
    variables: ['creatorName', 'senderName'],
    isDefault: true,
  },
  {
    id: 'template-thank-you',
    name: '\u53d1\u5e03\u540e\u611f\u8c22\u90ae\u4ef6',
    type: 'thank',
    subject: 'Thank you for the great video',
    content: `Hi {creatorName},

Thank you so much for publishing the video. We really appreciate the time and care you put into the content.

We will keep an eye on the performance and feedback from your audience. It would be great to stay in touch for future collaboration opportunities as well.

Best regards,
{senderName}`,
    variables: ['creatorName', 'senderName'],
    isDefault: true,
  },
];

function loadData<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function saveData<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(data));
}

function loadSettings(): AppSettings {
  return loadData<AppSettings>(STORAGE_KEYS.SETTINGS, {});
}

function saveSettings(settings: AppSettings): void {
  const safeSettings = { ...settings };
  delete safeSettings.customApiKey;
  delete safeSettings.customApiKeyConfigured;
  delete safeSettings.gmailClientSecret;
  delete safeSettings.youtubeApiKey;
  saveData(STORAGE_KEYS.SETTINGS, safeSettings);
}

function getCloudSafeSettings(settings: AppSettings) {
  const safeSettings = { ...settings };
  delete safeSettings.customApiKey;
  delete safeSettings.customApiKeyConfigured;
  delete safeSettings.gmailClientSecret;
  delete safeSettings.youtubeApiKey;
  return safeSettings;
}

async function syncSettingsToCloud(settings: AppSettings) {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) return;
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return;

  const { error } = await supabase.from('app_settings').upsert({
    user_id: authData.user.id,
    data: getCloudSafeSettings(settings),
    updated_at: new Date().toISOString(),
  });
  if (error) console.error('云端设置保存失败:', error);
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const localSettings = loadSettings();
    setSettings(localSettings);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.SETTINGS) {
        setSettings(event.newValue ? JSON.parse(event.newValue) : {});
      }
    };

    const handleCustom = (event: Event) => {
      setSettings((event as CustomEvent<AppSettings>).detail);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('settings-updated', handleCustom);

    const loadCloudSettings = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setLoading(false);
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setLoading(false);
        return;
      }

      const [{ data: cloudRow }, secretStatus, youtubeSecretStatus] = await Promise.all([
        supabase
          .from('app_settings')
          .select('data')
          .eq('user_id', authData.user.id)
          .maybeSingle(),
        fetch('/api/secrets/ai-key', { cache: 'no-store' })
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null),
        fetch('/api/secrets/youtube-key', { cache: 'no-store' })
          .then((response) => response.ok ? response.json() : null)
          .catch(() => null),
      ]);

      const cloudSettings =
        cloudRow?.data && typeof cloudRow.data === 'object'
          ? cloudRow.data as AppSettings
          : null;
      const nextSettings = {
        ...localSettings,
        ...(cloudSettings || {}),
        customApiKey: localSettings.customApiKey,
        customApiKeyConfigured: Boolean(secretStatus?.configured),
        youtubeApiKey: localSettings.youtubeApiKey,
        youtubeApiKeyConfigured: Boolean(youtubeSecretStatus?.configured),
      };
      setSettings(nextSettings);
      if (cloudSettings) saveSettings(nextSettings);
      setLoading(false);
    };

    void loadCloudSettings();
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('settings-updated', handleCustom);
    };
  }, []);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      saveSettings(next);
      void syncSettingsToCloud(next);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('settings-updated', { detail: next }));
      }, 0);
      return next;
    });
  }, []);

  return { settings, updateSettings, loading };
}

export function useInfluencers() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setInfluencers(loadData<Influencer[]>(STORAGE_KEYS.INFLUENCERS, []));
    setLoading(false);
  }, []);

  const saveInfluencers = useCallback((newData: Influencer[]) => {
    setInfluencers(newData);
    saveData(STORAGE_KEYS.INFLUENCERS, newData);
  }, []);

  const addInfluencer = useCallback(
    (influencer: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date().toISOString();
      const newInfluencer: Influencer = {
        ...influencer,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      };
      saveInfluencers([...influencers, newInfluencer]);
      return newInfluencer;
    },
    [influencers, saveInfluencers],
  );

  const updateInfluencer = useCallback(
    (id: string, updates: Partial<Influencer>) => {
      saveInfluencers(
        influencers.map((item) =>
          item.id === id
            ? { ...item, ...updates, updatedAt: new Date().toISOString() }
            : item,
        ),
      );
    },
    [influencers, saveInfluencers],
  );

  const deleteInfluencer = useCallback(
    (id: string) => {
      saveInfluencers(influencers.filter((item) => item.id !== id));
    },
    [influencers, saveInfluencers],
  );

  const updateStatus = useCallback(
    (id: string, status: Influencer['status']) => {
      updateInfluencer(id, { status });
    },
    [updateInfluencer],
  );

  const batchUpdateStatus = useCallback(
    (ids: string[], status: Influencer['status']) => {
      saveInfluencers(
        influencers.map((item) =>
          ids.includes(item.id)
            ? { ...item, status, updatedAt: new Date().toISOString() }
            : item,
        ),
      );
    },
    [influencers, saveInfluencers],
  );

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

export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const localProducts = loadData<Product[]>(STORAGE_KEYS.PRODUCTS, []);
    setProducts(localProducts);

    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEYS.PRODUCTS) {
        setProducts(event.newValue ? JSON.parse(event.newValue) : []);
      }
    };

    const handleProductsUpdated = (event: Event) => {
      setProducts((event as CustomEvent<Product[]>).detail);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(PRODUCTS_UPDATED_EVENT, handleProductsUpdated);

    const loadCloudProducts = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('user_id', authData.user.id)
        .order('updated_at', { ascending: false });
      if (error) {
        console.error('云端产品读取失败:', error);
      } else if (data?.length) {
        const cloudProducts: Product[] = data.map((row) => ({
          id: row.id,
          name: row.name,
          model: row.model || '',
          productUrl: row.product_url || '',
          sellingPoints: row.selling_points || '',
          technicalSpecifications: row.technical_specifications || '',
          imageAndResourceLinks: row.image_and_resource_links || '',
          notes: row.notes || '',
          status: row.status,
          marketProfiles: Array.isArray(row.market_profiles) ? row.market_profiles : [],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
        setProducts(cloudProducts);
        saveData(STORAGE_KEYS.PRODUCTS, cloudProducts);
        notifyProductsUpdated(cloudProducts);
      }
      setLoading(false);
    };

    void loadCloudProducts();
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(PRODUCTS_UPDATED_EVENT, handleProductsUpdated);
    };
  }, []);

  const saveProductToCloud = useCallback(async (product: Product) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;

    const { error } = await supabase.from('products').upsert({
      id: product.id,
      user_id: authData.user.id,
      name: product.name,
      model: product.model,
      product_url: product.productUrl,
      selling_points: product.sellingPoints,
      technical_specifications: product.technicalSpecifications,
      image_and_resource_links: product.imageAndResourceLinks,
      notes: product.notes,
      status: product.status,
      market_profiles: product.marketProfiles,
      created_at: product.createdAt,
      updated_at: product.updatedAt,
    });
    if (error) {
      console.error('云端产品保存失败:', error);
    } else {
      notifyCloudProductsUpdated();
    }
  }, []);

  const saveProducts = useCallback((newData: Product[]) => {
    setProducts(newData);
    saveData(STORAGE_KEYS.PRODUCTS, newData);
    notifyProductsUpdated(newData);
  }, []);

  const addProduct = useCallback(
    (product: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date().toISOString();
      const newProduct: Product = {
        ...product,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      };
      saveProducts([...products, newProduct]);
      void saveProductToCloud(newProduct);
      return newProduct;
    },
    [products, saveProducts, saveProductToCloud],
  );

  const updateProduct = useCallback(
    (id: string, updates: Partial<Product>) => {
      const nextProducts = products.map((product) =>
          product.id === id
            ? { ...product, ...updates, updatedAt: new Date().toISOString() }
            : product,
        );
      saveProducts(nextProducts);
      const updatedProduct = nextProducts.find((product) => product.id === id);
      if (updatedProduct) void saveProductToCloud(updatedProduct);
    },
    [products, saveProducts, saveProductToCloud],
  );

  const deleteProduct = useCallback(
    (id: string) => {
      saveProducts(products.filter((product) => product.id !== id));
      const supabase = getSupabaseBrowserClient();
      if (supabase) {
        void supabase.from('products').delete().eq('id', id).then(({ error }) => {
          if (error) {
            console.error('云端产品删除失败:', error);
          } else {
            notifyCloudProductsUpdated();
          }
        });
      }
    },
    [products, saveProducts],
  );

  return { products, loading, addProduct, updateProduct, deleteProduct };
}

export function useEmailTemplates() {
  const [templates, setTemplates] = useState<EmailTemplate[]>(DEFAULT_TEMPLATES);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = loadData<EmailTemplate[] | null>(STORAGE_KEYS.TEMPLATES, null);
    if (stored?.length) {
      setTemplates(stored);
    } else {
      setTemplates(DEFAULT_TEMPLATES);
      saveData(STORAGE_KEYS.TEMPLATES, DEFAULT_TEMPLATES);
    }
    setLoading(false);
  }, []);

  const saveTemplates = useCallback((newData: EmailTemplate[]) => {
    setTemplates(newData);
    saveData(STORAGE_KEYS.TEMPLATES, newData);
  }, []);

  const addTemplate = useCallback(
    (template: Omit<EmailTemplate, 'id'>) => {
      const newTemplate: EmailTemplate = { ...template, id: generateId() };
      saveTemplates([...templates, newTemplate]);
      return newTemplate;
    },
    [templates, saveTemplates],
  );

  const updateTemplate = useCallback(
    (id: string, updates: Partial<EmailTemplate>) => {
      saveTemplates(templates.map((template) => (template.id === id ? { ...template, ...updates } : template)));
    },
    [templates, saveTemplates],
  );

  const deleteTemplate = useCallback(
    (id: string) => {
      saveTemplates(templates.filter((template) => template.id !== id));
    },
    [templates, saveTemplates],
  );

  return { templates, loading, addTemplate, updateTemplate, deleteTemplate };
}

export function useReminders() {
  const [reminders, setReminders] = useState<FollowUpReminder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setReminders(loadData<FollowUpReminder[]>(STORAGE_KEYS.REMINDERS, []));
    setLoading(false);
  }, []);

  const saveReminders = useCallback((newData: FollowUpReminder[]) => {
    setReminders(newData);
    saveData(STORAGE_KEYS.REMINDERS, newData);
  }, []);

  const addReminder = useCallback(
    (reminder: Omit<FollowUpReminder, 'id'>) => {
      const newReminder: FollowUpReminder = { ...reminder, id: generateId() };
      saveReminders([...reminders, newReminder]);
      return newReminder;
    },
    [reminders, saveReminders],
  );

  const completeReminder = useCallback(
    (id: string) => {
      saveReminders(reminders.map((reminder) => (reminder.id === id ? { ...reminder, status: 'completed' } : reminder)));
    },
    [reminders, saveReminders],
  );

  const skipReminder = useCallback(
    (id: string, note?: string) => {
      saveReminders(
        reminders.map((reminder) =>
          reminder.id === id ? { ...reminder, status: 'skipped', note: note || '' } : reminder,
        ),
      );
    },
    [reminders, saveReminders],
  );

  const pendingReminders = reminders.filter((reminder) => reminder.status === 'pending');
  return { reminders, loading, pendingReminders, addReminder, completeReminder, skipReminder };
}

export function useEmailRecords() {
  const [emails, setEmails] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setEmails(loadData<EmailRecord[]>(STORAGE_KEYS.EMAILS, []));
    setLoading(false);
  }, []);

  const saveEmails = useCallback((newData: EmailRecord[]) => {
    setEmails(newData);
    saveData(STORAGE_KEYS.EMAILS, newData);
  }, []);

  const addEmail = useCallback(
    (email: Omit<EmailRecord, 'id'>) => {
      const newEmail: EmailRecord = { ...email, id: generateId() };
      saveEmails([...emails, newEmail]);
      return newEmail;
    },
    [emails, saveEmails],
  );

  const getEmailsByInfluencer = useCallback(
    (influencerId: string) => emails.filter((email) => email.influencerId === influencerId),
    [emails],
  );

  return { emails, loading, addEmail, getEmailsByInfluencer };
}

export function useCollaborations() {
  const [collaborations, setCollaborations] = useState<Collaboration[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setCollaborations(loadData<Collaboration[]>(STORAGE_KEYS.COLLABORATIONS, []));
    setLoading(false);
  }, []);

  const saveCollaborations = useCallback((newData: Collaboration[]) => {
    setCollaborations(newData);
    saveData(STORAGE_KEYS.COLLABORATIONS, newData);
  }, []);

  const addCollaboration = useCallback(
    (collaboration: Omit<Collaboration, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = new Date().toISOString();
      const newCollaboration: Collaboration = {
        ...collaboration,
        id: generateId(),
        createdAt: now,
        updatedAt: now,
      };
      saveCollaborations([...collaborations, newCollaboration]);
      return newCollaboration;
    },
    [collaborations, saveCollaborations],
  );

  const updateCollaboration = useCallback(
    (id: string, updates: Partial<Collaboration>) => {
      saveCollaborations(
        collaborations.map((item) =>
          item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item,
        ),
      );
    },
    [collaborations, saveCollaborations],
  );

  const getCollaborationByInfluencer = useCallback(
    (influencerId: string) => collaborations.find((item) => item.influencerId === influencerId),
    [collaborations],
  );

  return { collaborations, loading, addCollaboration, updateCollaboration, getCollaborationByInfluencer };
}

export function useTodos() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTodos(loadData<TodoItem[]>(STORAGE_KEYS.TODOS, []));
    setLoading(false);
  }, []);

  const saveTodos = useCallback((newData: TodoItem[]) => {
    setTodos(newData);
    saveData(STORAGE_KEYS.TODOS, newData);
  }, []);

  const addTodo = useCallback(
    (todo: Omit<TodoItem, 'id' | 'createdAt'>) => {
      const newTodo: TodoItem = { ...todo, id: generateId(), createdAt: new Date().toISOString() };
      saveTodos([...todos, newTodo]);
      return newTodo;
    },
    [todos, saveTodos],
  );

  const updateTodo = useCallback(
    (id: string, updates: Partial<TodoItem>) => {
      saveTodos(todos.map((todo) => (todo.id === id ? { ...todo, ...updates } : todo)));
    },
    [todos, saveTodos],
  );

  const deleteTodo = useCallback(
    (id: string) => {
      saveTodos(todos.filter((todo) => todo.id !== id));
    },
    [todos, saveTodos],
  );

  const toggleTodo = useCallback(
    (id: string) => {
      const todo = todos.find((item) => item.id === id);
      if (!todo) return;
      const status = todo.status === 'completed' ? 'pending' : 'completed';
      updateTodo(id, {
        status,
        completedAt: status === 'completed' ? new Date().toISOString() : undefined,
      });
    },
    [todos, updateTodo],
  );

  const completeTodo = useCallback(
    (id: string) => {
      updateTodo(id, { status: 'completed', completedAt: new Date().toISOString() });
    },
    [updateTodo],
  );

  const today = new Date().toISOString().split('T')[0];
  const todayTodos = todos.filter((todo) => todo.status !== 'completed' && (!todo.dueDate || todo.dueDate === today));
  const weekTodos = todos.filter((todo) => todo.status !== 'completed' && Boolean(todo.dueDate));

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

export function useCalendarEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setEvents(loadData<CalendarEvent[]>(STORAGE_KEYS.CALENDAR_EVENTS, []));
    setLoading(false);
  }, []);

  const saveEvents = useCallback((newData: CalendarEvent[]) => {
    setEvents(newData);
    saveData(STORAGE_KEYS.CALENDAR_EVENTS, newData);
  }, []);

  const addEvent = useCallback(
    (event: Omit<CalendarEvent, 'id'>) => {
      const newEvent: CalendarEvent = { ...event, id: generateId() };
      saveEvents([...events, newEvent]);
      return newEvent;
    },
    [events, saveEvents],
  );

  const updateEvent = useCallback(
    (id: string, updates: Partial<CalendarEvent>) => {
      saveEvents(events.map((event) => (event.id === id ? { ...event, ...updates } : event)));
    },
    [events, saveEvents],
  );

  const deleteEvent = useCallback(
    (id: string) => {
      saveEvents(events.filter((event) => event.id !== id));
    },
    [events, saveEvents],
  );

  const getEventsByDate = useCallback((date: string) => events.filter((event) => event.date === date), [events]);
  const getEventsByMonth = useCallback(
    (year: number, month: number) =>
      events.filter((event) => {
        const eventDate = new Date(event.date);
        return eventDate.getFullYear() === year && eventDate.getMonth() === month;
      }),
    [events],
  );

  return { events, loading, addEvent, updateEvent, deleteEvent, getEventsByDate, getEventsByMonth };
}

export function useGmailAuth() {
  const [auth, setAuth] = useState<GmailAuth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const localAuth = loadData<GmailAuth | null>(GMAIL_STORAGE_KEYS.AUTH, null);
    setAuth(localAuth);
    fetch('/api/auth/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json();
        if (result.success && result.data) {
          setAuth(result.data);
          saveData(GMAIL_STORAGE_KEYS.AUTH, result.data);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const saveAuth = useCallback((newAuth: GmailAuth | null) => {
    setAuth(newAuth);
    saveData(GMAIL_STORAGE_KEYS.AUTH, newAuth);
  }, []);

  const connect = useCallback((authData: GmailAuth) => saveAuth(authData), [saveAuth]);
  const disconnect = useCallback(() => {
    saveAuth(null);
    void fetch('/api/auth/session', { method: 'DELETE' });
  }, [saveAuth]);

  return { auth, loading, connect, disconnect };
}

export function useGmailSettings() {
  const defaultSettings: GmailSettings = {
    autoCheck: true,
    checkInterval: 5,
    notifyOnNewEmail: true,
    matchWithInfluencers: true,
  };
  const { settings: appSettings, updateSettings: updateAppSettings } = useSettings();
  const legacySettings = loadData<GmailSettings | null>(GMAIL_STORAGE_KEYS.SETTINGS, null);
  const settings = appSettings.gmailSettings || legacySettings || defaultSettings;

  const updateSettings = useCallback(
    (updates: Partial<GmailSettings>) => {
      const next = { ...settings, ...updates };
      saveData(GMAIL_STORAGE_KEYS.SETTINGS, next);
      updateAppSettings({ gmailSettings: next });
    },
    [settings, updateAppSettings],
  );

  return { settings, updateSettings };
}

export function useGmailThreads() {
  const [threads, setThreads] = useState<GmailThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setThreads(loadData<GmailThread[]>(GMAIL_STORAGE_KEYS.THREADS, []));
    setLoading(false);
  }, []);

  const saveThreads = useCallback((newThreads: GmailThread[]) => {
    setThreads(newThreads);
    saveData(GMAIL_STORAGE_KEYS.THREADS, newThreads);
  }, []);

  const updateThread = useCallback(
    (thread: GmailThread) => {
      const existingIndex = threads.findIndex((item) => item.id === thread.id);
      if (existingIndex >= 0) {
        const next = [...threads];
        next[existingIndex] = thread;
        saveThreads(next);
      } else {
        saveThreads([thread, ...threads]);
      }
    },
    [threads, saveThreads],
  );

  const markAsRead = useCallback(
    (threadId: string) => {
      saveThreads(threads.map((thread) => (thread.id === threadId ? { ...thread, hasUnread: false } : thread)));
    },
    [threads, saveThreads],
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      saveThreads(threads.filter((thread) => thread.id !== threadId));
    },
    [threads, saveThreads],
  );

  const unreadCount = threads.filter((thread) => thread.hasUnread).length;
  const recentThreads = threads;

  return { threads, loading, unreadCount, recentThreads, updateThread, markAsRead, deleteThread };
}

export function useEmailTranslations() {
  const [translations, setTranslations] = useState<EmailTranslation[]>([]);

  useEffect(() => {
    setTranslations(loadData<EmailTranslation[]>(GMAIL_STORAGE_KEYS.TRANSLATIONS, []));
  }, []);

  const addTranslation = useCallback(
    (translation: Omit<EmailTranslation, 'id' | 'createdAt'>) => {
      const newTranslation: EmailTranslation = {
        ...translation,
        id: generateId(),
        createdAt: new Date().toISOString(),
      };
      setTranslations((current) => {
        const next = [
          newTranslation,
          ...current.filter((item) => item.messageId !== translation.messageId),
        ];
        saveData(GMAIL_STORAGE_KEYS.TRANSLATIONS, next);
        return next;
      });
      return newTranslation;
    },
    [],
  );

  const getTranslation = useCallback(
    (messageId: string) => translations.find((translation) => translation.messageId === messageId),
    [translations],
  );

  return { translations, addTranslation, getTranslation };
}

export function useEmailAISuggestions() {
  const [suggestions, setSuggestions] = useState<EmailDraftSuggestion[]>([]);

  useEffect(() => {
    setSuggestions(loadData<EmailDraftSuggestion[]>(GMAIL_STORAGE_KEYS.AI_SUGGESTIONS, []));
  }, []);

  const saveSuggestions = useCallback((newSuggestions: EmailDraftSuggestion[]) => {
    setSuggestions(newSuggestions);
    saveData(GMAIL_STORAGE_KEYS.AI_SUGGESTIONS, newSuggestions);
  }, []);

  const addSuggestion = useCallback(
    (suggestion: Omit<EmailDraftSuggestion, 'id' | 'generatedAt'>) => {
      const newSuggestion: EmailDraftSuggestion = {
        ...suggestion,
        id: generateId(),
        generatedAt: new Date().toISOString(),
      };
      saveSuggestions([...suggestions, newSuggestion]);
      return newSuggestion;
    },
    [suggestions, saveSuggestions],
  );

  const approveSuggestion = useCallback(
    (id: string) => {
      saveSuggestions(
        suggestions.map((suggestion) =>
          suggestion.id === id ? { ...suggestion, status: 'approved' } : suggestion,
        ),
      );
    },
    [suggestions, saveSuggestions],
  );

  const rejectSuggestion = useCallback(
    (id: string) => {
      saveSuggestions(
        suggestions.map((suggestion) =>
          suggestion.id === id ? { ...suggestion, status: 'rejected' } : suggestion,
        ),
      );
    },
    [suggestions, saveSuggestions],
  );

  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === 'pending');
  return { suggestions, pendingSuggestions, addSuggestion, approveSuggestion, rejectSuggestion };
}

export function useEmailDrafts() {
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);

  useEffect(() => {
    setDrafts(loadData<EmailDraft[]>(GMAIL_STORAGE_KEYS.DRAFTS, []));
  }, []);

  const saveDrafts = useCallback((newDrafts: EmailDraft[]) => {
    setDrafts(newDrafts);
    saveData(GMAIL_STORAGE_KEYS.DRAFTS, newDrafts);
  }, []);

  const addDraft = useCallback(
    (draft: Omit<EmailDraft, 'id' | 'createdAt' | 'status'>) => {
      const newDraft: EmailDraft = {
        ...draft,
        id: generateId(),
        createdAt: new Date().toISOString(),
        status: 'draft',
      };
      saveDrafts([...drafts, newDraft]);
      return newDraft;
    },
    [drafts, saveDrafts],
  );

  const updateDraft = useCallback(
    (id: string, updates: Partial<EmailDraft>) => {
      saveDrafts(drafts.map((draft) => (draft.id === id ? { ...draft, ...updates } : draft)));
    },
    [drafts, saveDrafts],
  );

  const deleteDraft = useCallback(
    (id: string) => {
      saveDrafts(drafts.filter((draft) => draft.id !== id));
    },
    [drafts, saveDrafts],
  );

  const markAsSent = useCallback(
    (id: string) => {
      saveDrafts(drafts.map((draft) => (draft.id === id ? { ...draft, status: 'sent' } : draft)));
    },
    [drafts, saveDrafts],
  );

  const draftEmails = drafts.filter((draft) => draft.status === 'draft');
  return { drafts, draftEmails, addDraft, updateDraft, deleteDraft, markAsSent };
}
