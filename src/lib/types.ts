export type InfluencerStatus =
  | 'talent_pool'
  | 'pending'
  | 'contacted'
  | 'interested'
  | 'negotiating'
  | 'confirmed'
  | 'sampling'
  | 'filming'
  | 'published'
  | 'archived';

export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TodoStatus = 'pending' | 'completed';

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  priority: TodoPriority;
  status: TodoStatus;
  dueDate?: string;
  influencerId?: string;
  tags: string[];
  createdAt: string;
  completedAt?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: 'deadline' | 'reminder' | 'follow_up' | 'meeting' | 'publish' | 'custom';
  color: string;
  influencerId?: string;
  description?: string;
}

export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
  todos: TodoItem[];
}

export interface Influencer {
  id: string;
  channelName: string;
  channelUrl: string;
  email: string;
  country: string;
  followers: number;
  category: string;
  rating: 'A' | 'B' | 'C';
  notes: string;
  status: InfluencerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Collaboration {
  id: string;
  influencerId: string;
  productName: string;
  productUrl: string;
  price: number | null;
  isFree: boolean;
  shippingAddress: string;
  trackingNumber: string;
  expectedPublishDate: string;
  discountCode: string;
  affiliateLink: string;
  status: CollaborationStatus;
  createdAt: string;
  updatedAt: string;
}

export type CollaborationStatus =
  | 'pending'
  | 'price_confirmed'
  | 'sample_sent'
  | 'received'
  | 'filming'
  | 'published'
  | 'cancelled';

export interface EmailRecord {
  id: string;
  influencerId: string;
  type: EmailType;
  subject: string;
  content: string;
  sentAt: string;
  followUpCount: number;
}

export type EmailType =
  | 'cold'
  | 'follow_up_1'
  | 'follow_up_2'
  | 'follow_up_3'
  | 'inquiry'
  | 'shipping'
  | 'care'
  | 'thank'
  | 'custom';

export interface EmailTemplate {
  id: string;
  name: string;
  type: EmailType;
  subject: string;
  content: string;
  variables: string[];
  isDefault: boolean;
}

export interface FollowUpReminder {
  id: string;
  influencerId: string;
  emailRecordId: string;
  remindAt: string;
  type: 'auto' | 'manual';
  status: 'pending' | 'completed' | 'skipped';
  note: string;
}

export interface VideoData {
  id: string;
  influencerId: string;
  collaborationId: string;
  videoUrl: string;
  views: number;
  likes: number;
  comments: number;
  fetchedAt: string;
}

export interface KanbanColumn {
  id: InfluencerStatus;
  title: string;
  color: string;
}

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'talent_pool', title: '\u7ea2\u4eba\u5efa\u6863', color: 'bg-slate-50' },
  { id: 'pending', title: '\u5f85\u8054\u7cfb', color: 'bg-blue-50' },
  { id: 'contacted', title: '\u5df2\u8054\u7cfb', color: 'bg-yellow-50' },
  { id: 'interested', title: '\u6709\u610f\u5411', color: 'bg-orange-50' },
  { id: 'negotiating', title: '\u8c08\u4ef7\u683c/\u65b9\u5f0f', color: 'bg-purple-50' },
  { id: 'confirmed', title: '\u5df2\u786e\u8ba4', color: 'bg-green-50' },
  { id: 'sampling', title: '\u5df2\u5bc4\u6837', color: 'bg-teal-50' },
  { id: 'filming', title: '\u62cd\u6444\u4e2d', color: 'bg-indigo-50' },
  { id: 'published', title: '\u5df2\u53d1\u5e03', color: 'bg-emerald-50' },
  { id: 'archived', title: '\u590d\u76d8/\u5f52\u6863', color: 'bg-slate-100' },
];

export const STATUS_LABELS: Record<InfluencerStatus, string> = Object.fromEntries(
  KANBAN_COLUMNS.map((column) => [column.id, column.title]),
) as Record<InfluencerStatus, string>;

export const COUNTRY_OPTIONS = [
  '\u7f8e\u56fd',
  '\u82f1\u56fd',
  '\u52a0\u62ff\u5927',
  '\u6fb3\u5927\u5229\u4e9a',
  '\u5fb7\u56fd',
  '\u6cd5\u56fd',
  '\u610f\u5927\u5229',
  '\u897f\u73ed\u7259',
  '\u8377\u5170',
  '\u745e\u5178',
  '\u65e5\u672c',
  '\u97e9\u56fd',
  '\u5176\u4ed6',
];

export const CATEGORY_OPTIONS = [
  '\u79d1\u6280\u6570\u7801',
  '\u667a\u80fd\u5bb6\u5c45',
  '\u5bb6\u5c45\u751f\u6d3b',
  '\u7f8e\u5986\u62a4\u80a4',
  '\u65f6\u5c1a\u7a7f\u642d',
  '\u6bcd\u5a74\u80b2\u513f',
  '\u6237\u5916\u8fd0\u52a8',
  '\u6c7d\u8f66\u914d\u4ef6',
  '\u6e38\u620f\u7535\u7ade',
  '\u7f8e\u98df\u70f9\u996a',
  '\u5176\u4ed6',
];

export interface GmailAuth {
  isConnected: boolean;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  htmlBody?: string;
  attachments?: GmailAttachment[];
  date: string;
  isRead: boolean;
  labels: string[];
  hasAttachments: boolean;
  rfcMessageId?: string;
  references?: string;
}

export interface GmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  contentId?: string;
  inline: boolean;
}

export interface GmailThread {
  id: string;
  subject: string;
  snippet: string;
  messages: GmailMessage[];
  participantCount: number;
  lastMessageDate: string;
  hasUnread: boolean;
  labels: string[];
  isStarred: boolean;
}

export type GmailMailbox = 'inbox' | 'unread' | 'starred' | 'sent' | 'drafts';
export type GmailCategory = 'primary' | 'promotions' | 'social';

export interface EmailTranslation {
  id: string;
  messageId: string;
  originalText: string;
  translatedText: string;
  sourceLang?: string;
  targetLang: string;
  createdAt: string;
}

export interface EmailDraftSuggestion {
  id: string;
  threadId: string;
  messageId?: string;
  suggestedReply: string;
  translatedReply?: string;
  tone: 'formal' | 'casual' | 'friendly';
  keyPoints: string[];
  generatedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface EmailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  createdAt: string;
  status: 'draft' | 'sending' | 'sent';
}

export interface GmailSettings {
  autoCheck: boolean;
  checkInterval: number;
  notifyOnNewEmail: boolean;
  matchWithInfluencers: boolean;
}
