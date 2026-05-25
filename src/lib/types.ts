// ============================================
// 红人看板工作台 - 类型定义
// ============================================

import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';

// 红人合作状态
export type InfluencerStatus = 
  | 'talent_pool'      // 红人库（待联系）
  | 'pending'          // 待联系
  | 'contacted'        // 已联系（等待回复）
  | 'interested'       // 有意向
  | 'negotiating'      // 洽谈中
  | 'confirmed'       // 已确认合作
  | 'sampling'         // 样品邮寄中
  | 'filming'          // 拍摄中
  | 'published'        // 已发布
  | 'archived';        // 已归档

// ==================== Todo 相关类型 ====================

// Todo 优先级
export type TodoPriority = 'low' | 'medium' | 'high' | 'urgent';

// Todo 状态
export type TodoStatus = 'pending' | 'completed';

// Todo 项目
export interface TodoItem {
  id: string;
  title: string;           // 标题
  description?: string;    // 描述
  priority: TodoPriority;  // 优先级
  status: TodoStatus;      // 状态
  dueDate?: string;        // 截止日期
  influencerId?: string;    // 关联的红人ID
  tags: string[];          // 标签
  createdAt: string;
  completedAt?: string;    // 完成时间
}

// 日历事件
export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  type: 'deadline' | 'reminder' | 'follow_up' | 'meeting' | 'publish' | 'custom';
  color: string;
  influencerId?: string;
  description?: string;
}

// 日历日期（用于渲染）
export interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
  todos: TodoItem[];
}

// 红人基本信息
export interface Influencer {
  id: string;
  channelName: string;       // 频道名称
  channelUrl: string;        // 频道链接
  email: string;            // 联系邮箱
  country: string;          // 国家
  followers: number;         // 粉丝数
  category: string;          // 类目
  rating: 'A' | 'B' | 'C';  // 评级
  notes: string;             // 备注
  status: InfluencerStatus; // 当前状态
  createdAt: string;        // 创建时间
  updatedAt: string;        // 更新时间
}

// 合作项目
export interface Collaboration {
  id: string;
  influencerId: string;
  productName: string;       // 产品名称
  productUrl: string;       // 产品链接
  price: number | null;     // 合作价格
  isFree: boolean;          // 是否免费合作
  shippingAddress: string;  // 收货地址
  trackingNumber: string;   // 快递单号
  expectedPublishDate: string; // 预计发布时间
  discountCode: string;     // 折扣码
  affiliateLink: string;    // 联盟链接
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

// 邮件记录
export interface EmailRecord {
  id: string;
  influencerId: string;
  type: EmailType;
  subject: string;
  content: string;
  sentAt: string;
  followUpCount: number;  // 跟进次数
}

export type EmailType = 
  | 'cold'           // 冷开发信
  | 'follow_up_1'    // 第一次跟进（3天后）
  | 'follow_up_2'    // 第二次跟进（7天后）
  | 'follow_up_3'    // 第三次跟进（7天后）
  | 'inquiry'        // 询问意向
  | 'shipping'       // 物流通知
  | 'care'           // 关怀邮件
  | 'thank'          // 感谢邮件
  | 'custom';        // 自定义

// 邮件模板
export interface EmailTemplate {
  id: string;
  name: string;
  type: EmailType;
  subject: string;
  content: string;
  variables: string[];  // 可用变量列表
  isDefault: boolean;
}

// 跟进提醒
export interface FollowUpReminder {
  id: string;
  influencerId: string;
  emailRecordId: string;
  remindAt: string;      // 提醒时间
  type: 'auto' | 'manual';
  status: 'pending' | 'completed' | 'skipped';
  note: string;
}

// 视频数据
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

// 看板列配置
export interface KanbanColumn {
  id: InfluencerStatus;
  title: string;
  color: string;
}

// 看板列配置
export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'talent_pool', title: '红人库', color: 'bg-gray-100' },
  { id: 'pending', title: '待联系', color: 'bg-blue-50' },
  { id: 'contacted', title: '已联系', color: 'bg-yellow-50' },
  { id: 'interested', title: '有意向', color: 'bg-orange-50' },
  { id: 'negotiating', title: '洽谈中', color: 'bg-purple-50' },
  { id: 'confirmed', title: '已确认', color: 'bg-green-50' },
  { id: 'sampling', title: '样品中', color: 'bg-teal-50' },
  { id: 'filming', title: '拍摄中', color: 'bg-indigo-50' },
  { id: 'published', title: '已发布', color: 'bg-emerald-50' },
  { id: 'archived', title: '已归档', color: 'bg-slate-100' },
];

// 状态映射
export const STATUS_LABELS: Record<InfluencerStatus, string> = {
  'talent_pool': '红人库',
  'pending': '待联系',
  'contacted': '已联系',
  'interested': '有意向',
  'negotiating': '洽谈中',
  'confirmed': '已确认',
  'sampling': '样品中',
  'filming': '拍摄中',
  'published': '已发布',
  'archived': '已归档',
};

// 国家列表
export const COUNTRY_OPTIONS = [
  '德国', '法国', '英国', '意大利', '西班牙', '荷兰', 
  '比利时', '瑞典', '波兰', '奥地利', '瑞士', '丹麦',
  '挪威', '芬兰', '捷克', '希腊', '葡萄牙', '其他'
];

// 类目列表
export const CATEGORY_OPTIONS = [
  '科技数码', '美妆护肤', '时尚穿搭', '家居生活',
  '美食烹饪', '健身运动', '旅游出行', '母婴育儿',
  '宠物用品', '游戏电竞', '其他'
];

// ==================== Gmail 集成相关类型 ====================

// Gmail 授权状态
export interface GmailAuth {
  isConnected: boolean;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

// Gmail 邮件消息
export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;           // 纯文本正文
  htmlBody?: string;      // HTML 正文
  date: string;           // 发送时间
  isRead: boolean;
  labels: string[];       // 标签
  hasAttachments: boolean;
}

// Gmail 邮件对话（同一主题的多封邮件）
export interface GmailThread {
  id: string;
  subject: string;
  snippet: string;
  messages: GmailMessage[];
  participantCount: number;  // 参与者数量
  lastMessageDate: string;
  hasUnread: boolean;
}

// 邮件翻译记录
export interface EmailTranslation {
  id: string;
  messageId: string;
  originalText: string;
  translatedText: string;
  sourceLang?: string;
  targetLang: string;
  createdAt: string;
}

// AI 邮件草稿建议
export interface EmailDraftSuggestion {
  id: string;
  threadId: string;
  messageId?: string;
  suggestedReply: string;     // 目标语言回复
  translatedReply?: string;    // 中文对照
  tone: 'formal' | 'casual' | 'friendly';  // 语气
  keyPoints: string[];         // 关键要点
  generatedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

// 邮件草稿（保存到草稿箱的）
export interface EmailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  createdAt: string;
  status: 'draft' | 'sending' | 'sent';
}

// Gmail 设置
export interface GmailSettings {
  autoCheck: boolean;         // 自动检查新邮件
  checkInterval: number;      // 检查间隔（分钟）
  notifyOnNewEmail: boolean;  // 新邮件通知
  matchWithInfluencers: boolean; // 自动匹配红人
}
