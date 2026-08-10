'use client';

import { useState } from 'react';
import { TodoItem, TodoPriority } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  CheckCircle2, Circle, Clock, Flag, Pencil, Plus, Trash2,
  Flame, AlertCircle, Sparkles, Mail, RefreshCw, ArrowRight, ChevronDown, ChevronRight
} from 'lucide-react';
import { formatLocalDateKey, parseLocalDateKey } from '@/lib/local-date';
import { getDailyGmailTaskKey, isCompletedToday } from '@/lib/daily-gmail-todos';
import type { DailyGmailTodo } from '@/lib/use-daily-gmail-todos';
import { YouTubeChannelAvatar } from '@/components/youtube-channel-avatar';

interface TodoBoardProps {
  todos: TodoItem[];
  onAdd: (todo: Omit<TodoItem, 'id' | 'createdAt'>) => void;
  onUpdate: (id: string, updates: Partial<TodoItem>) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  gmailItems: DailyGmailTodo[];
  gmailLoading: boolean;
  gmailRefreshing: boolean;
  gmailError: string;
  onRefreshGmail: () => void;
  onOpenGmail: (threadId: string) => void;
  onToggleGmail: (messageId: string) => void;
}

const PRIORITY_CONFIG: Record<TodoPriority, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  low: { label: '低', color: 'text-gray-600', bgColor: 'bg-gray-100', icon: <Flag className="w-3 h-3" /> },
  medium: { label: '中', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: <Flag className="w-3 h-3" /> },
  high: { label: '高', color: 'text-orange-600', bgColor: 'bg-orange-100', icon: <Flame className="w-3 h-3" /> },
  urgent: { label: '紧急', color: 'text-red-600', bgColor: 'bg-red-100', icon: <AlertCircle className="w-3 h-3" /> },
};

type TodoDraft = {
  title: string;
  description: string;
  priority: TodoPriority;
  dueDate: string;
  dueTime: string;
  tags: string[];
};

type UnifiedTodo =
  | { kind: 'manual'; key: string; sortTime: number; todo: TodoItem }
  | { kind: 'gmail'; key: string; sortTime: number; item: DailyGmailTodo };

function createTodoDraft(): TodoDraft {
  return {
    title: '',
    description: '',
    priority: 'medium',
    dueDate: formatLocalDateKey(),
    dueTime: '',
    tags: [],
  };
}

function toTimestamp(value?: string) {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function TodoBoard({
  todos,
  onAdd,
  onUpdate,
  onToggle,
  onDelete,
  gmailItems,
  gmailLoading,
  gmailRefreshing,
  gmailError,
  onRefreshGmail,
  onOpenGmail,
  onToggleGmail,
}: TodoBoardProps) {
  const [dialogMode, setDialogMode] = useState<'add' | 'edit' | null>(null);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<TodoPriority | 'all'>('all');
  const [todoDraft, setTodoDraft] = useState<TodoDraft>(createTodoDraft);
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const pendingTodos = todos.filter(t => t.status === 'pending');
  const completedTodos = todos.filter(t => t.status === 'completed');

  const filteredPending = filterPriority === 'all'
    ? pendingTodos
    : pendingTodos.filter(t => t.priority === filterPriority);
  const pendingItems: UnifiedTodo[] = [
    ...filteredPending.map((todo) => ({
      kind: 'manual' as const,
      key: `manual-${todo.id}`,
      sortTime: toTimestamp(todo.createdAt),
      todo,
    })),
    ...(filterPriority === 'all'
      ? gmailItems.filter((item) => !item.completed).map((item) => ({
          kind: 'gmail' as const,
          key: `gmail-${getDailyGmailTaskKey(item.threadId, item.messageId)}`,
          sortTime: toTimestamp(item.date),
          item,
        }))
      : []),
  ].sort((a, b) => b.sortTime - a.sortTime);
  const completedItems: UnifiedTodo[] = [
    ...completedTodos.map((todo) => ({
      kind: 'manual' as const,
      key: `manual-${todo.id}`,
      sortTime: toTimestamp(todo.completedAt || todo.createdAt),
      todo,
    })),
    ...gmailItems.filter((item) => item.completed).map((item) => ({
      kind: 'gmail' as const,
      key: `gmail-${getDailyGmailTaskKey(item.threadId, item.messageId)}`,
      sortTime: toTimestamp(item.completedAt || item.date),
      item,
    })),
  ].sort((a, b) => b.sortTime - a.sortTime);
  const completedTodayItems = completedItems.filter((entry) => (
    isCompletedToday(entry.kind === 'manual' ? entry.todo.completedAt : entry.item.completedAt)
  ));
  const historicalCompletedItems = completedItems.filter((entry) => (
    !isCompletedToday(entry.kind === 'manual' ? entry.todo.completedAt : entry.item.completedAt)
  ));

  const openAddDialog = () => {
    setEditingTodoId(null);
    setTodoDraft(createTodoDraft());
    setDialogMode('add');
  };

  const openEditDialog = (todo: TodoItem) => {
    setEditingTodoId(todo.id);
    setTodoDraft({
      title: todo.title,
      description: todo.description || '',
      priority: todo.priority,
      dueDate: todo.dueDate || '',
      dueTime: todo.dueTime || '',
      tags: todo.tags,
    });
    setDialogMode('edit');
  };

  const handleSaveTodo = () => {
    const title = todoDraft.title.trim();
    if (!title) return;
    const updates = {
      title,
      description: todoDraft.description.trim() || undefined,
      priority: todoDraft.priority,
      dueDate: todoDraft.dueDate || undefined,
      dueTime: todoDraft.dueTime || undefined,
      tags: todoDraft.tags,
    };
    if (dialogMode === 'edit' && editingTodoId) {
      onUpdate(editingTodoId, updates);
    } else {
      onAdd({ ...updates, status: 'pending' });
    }
    setDialogMode(null);
    setEditingTodoId(null);
  };

  const getDueDateTime = (dateStr: string, timeStr?: string) => {
    const date = parseLocalDateKey(dateStr);
    if (timeStr) {
      const [hours, minutes] = timeStr.split(':').map(Number);
      date.setHours(hours || 0, minutes || 0, 0, 0);
    }
    return date;
  };

  const isOverdue = (dateStr: string, timeStr?: string) => {
    const dueDate = getDueDateTime(dateStr, timeStr);
    if (timeStr) return dueDate < new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate < today;
  };

  const formatDueDate = (dateStr: string, timeStr?: string) => {
    const date = parseLocalDateKey(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDate = parseLocalDateKey(dateStr);
    dueDate.setHours(0, 0, 0, 0);
    const timeLabel = timeStr ? ` ${timeStr}` : '';

    if (isOverdue(dateStr, timeStr)) return timeStr ? `已逾期 · ${timeStr}` : '已逾期';
    if (dueDate.getTime() === today.getTime()) return `今天${timeLabel}`;
    if (dueDate.getTime() === tomorrow.getTime()) return `明天${timeLabel}`;
    return `${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}${timeLabel}`;
  };

  const renderCompletedList = (entries: UnifiedTodo[], showCompletedDate = false) => (
    <div className="overflow-hidden rounded-xl border border-border/55 bg-accent/20">
      {entries.map((entry) => entry.kind === 'manual' ? (
        <div
          key={entry.key}
          className="group flex min-h-11 items-center gap-3 border-b border-border/45 px-3 py-1.5 text-muted-foreground last:border-b-0 hover:bg-accent/30"
        >
          <button type="button" onClick={() => onToggle(entry.todo.id)} className="flex-shrink-0" aria-label={`将“${entry.todo.title}”恢复为待完成`} title="点击恢复为待完成">
            <CheckCircle2 className="h-4 w-4 text-green-500 transition-colors hover:text-blue-500" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs line-through">{entry.todo.title}</p>
          </div>
          {showCompletedDate && entry.todo.completedAt && (
            <span className="shrink-0 text-[10px]">{new Date(entry.todo.completedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>
          )}
          <button type="button" onClick={() => openEditDialog(entry.todo)} className="text-muted-foreground opacity-0 hover:text-blue-500 group-hover:opacity-100 group-focus-within:opacity-100" aria-label={`编辑“${entry.todo.title}”`} title="编辑任务">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onDelete(entry.todo.id)} className="text-muted-foreground opacity-0 hover:text-red-500 group-hover:opacity-100 group-focus-within:opacity-100" aria-label={`删除“${entry.todo.title}”`} title="删除任务">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div key={entry.key} className="flex min-h-11 items-center gap-3 border-b border-border/45 px-3 py-1.5 text-muted-foreground last:border-b-0 hover:bg-accent/30">
          <button type="button" onClick={() => onToggleGmail(getDailyGmailTaskKey(entry.item.threadId, entry.item.messageId))} className="flex-shrink-0" aria-label={`将“${entry.item.channelName}”的来信恢复为待完成`} title="点击恢复为待完成">
            <CheckCircle2 className="h-4 w-4 text-green-500 transition-colors hover:text-blue-500" />
          </button>
          <YouTubeChannelAvatar avatar={entry.item.avatar} fallback={entry.item.channelName} label={entry.item.channelName} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-xs line-through">{entry.item.channelName}</p>
              <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[9px]">Gmail</Badge>
              <span className="min-w-0 flex-1 truncate text-[10px] line-through">{entry.item.subject || '无主题'}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-slate-500 line-through">
              {entry.item.summary}
              {entry.item.summaryPending && <span className="ml-2 text-[10px] text-blue-500">AI 正在优化摘要…</span>}
            </p>
          </div>
          {showCompletedDate && entry.item.completedAt && (
            <span className="shrink-0 text-[10px]">{new Date(entry.item.completedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>
          )}
          <button type="button" onClick={() => onOpenGmail(entry.item.threadId)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50" aria-label={`查看“${entry.item.channelName}”的邮件线程`} title="打开该邮件线程"><ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="material-toolbar -mx-1 mb-4 flex items-center justify-between rounded-xl border border-border/50 px-4 py-3 shadow-[var(--glass-shadow-soft)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-primary/15 bg-primary shadow-[0_6px_16px_rgba(24,119,242,0.18)]">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">今日待办</h2>
            <p className="text-sm text-muted-foreground">
              {pendingItems.length} 项待完成 · {completedTodayItems.length} 项今日完成
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefreshGmail}
            disabled={gmailRefreshing}
            title="刷新近 72 小时 Gmail 来信"
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${gmailRefreshing ? 'animate-spin' : ''}`} />
            刷新来信
          </Button>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as TodoPriority | 'all')}
            className="px-3 py-1.5 rounded-lg bg-accent/50 border-0 text-sm"
          >
            <option value="all">全部</option>
            <option value="urgent">紧急</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <Button size="sm" onClick={openAddDialog} className="shadow-sm">
            <Plus className="w-4 h-4 mr-1" />
            添加
          </Button>
        </div>
      </div>

      {/* 待办列表 */}
      <div className="flex-1 overflow-y-auto space-y-3">
        <div className="flex items-center justify-between px-1 py-1">
          <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Circle className="h-4 w-4" />
            待完成 ({pendingItems.length})
          </h3>
          {gmailLoading && (
            <span className="text-xs text-muted-foreground">正在读取近 72 小时 Gmail 来信…</span>
          )}
        </div>

        {gmailError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
            <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{gmailError}</span>
            <Button type="button" variant="outline" size="sm" onClick={onRefreshGmail}>重试</Button>
          </div>
        )}

        {pendingItems.length === 0 && !gmailLoading ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-medium mb-1">太棒了！</h3>
            <p className="text-muted-foreground">当前没有未完成的任务</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/70 bg-background/70 shadow-[0_4px_14px_rgba(38,68,105,0.04)]">
            {pendingItems.map((entry) => entry.kind === 'manual' ? (
              <article
                key={entry.key}
                className={`group relative flex min-h-[58px] items-center gap-3 border-b border-border/55 px-3 py-2 transition-colors duration-150 ease-out last:border-b-0 hover:bg-accent/35 motion-reduce:transition-none ${entry.todo.dueDate && isOverdue(entry.todo.dueDate, entry.todo.dueTime) ? 'bg-red-50/30' : ''}`}
              >
                <span className={`absolute inset-y-2 left-0 w-[3px] rounded-r-full ${entry.todo.priority === 'urgent' || (entry.todo.dueDate && isOverdue(entry.todo.dueDate, entry.todo.dueTime)) ? 'bg-red-500' : 'bg-violet-400'}`} />
                <button type="button" className="shrink-0 text-slate-300 transition-colors hover:text-blue-500" onClick={() => onToggle(entry.todo.id)} aria-label={`将“${entry.todo.title}”标记为已完成`}>
                  <Circle className="h-5 w-5" />
                </button>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[10px] font-semibold text-violet-700">
                  {entry.todo.title.trim().slice(0, 1) || '任'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="max-w-[320px] truncate text-[13px] font-semibold text-foreground">{entry.todo.title}</p>
                    <span className="shrink-0 rounded-md border border-violet-100 bg-violet-50 px-1.5 py-0.5 text-[9px] font-medium text-violet-600">手动</span>
                    {entry.todo.tags.map((tag) => <Badge key={tag} variant="secondary" className="h-5 max-w-32 shrink truncate px-1.5 text-[9px]">{tag}</Badge>)}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{entry.todo.description || '未填写任务说明'}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[10px]">
                  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium ${PRIORITY_CONFIG[entry.todo.priority].bgColor} ${PRIORITY_CONFIG[entry.todo.priority].color}`}>
                    {PRIORITY_CONFIG[entry.todo.priority].icon}{PRIORITY_CONFIG[entry.todo.priority].label}
                  </span>
                  {entry.todo.dueDate && (
                    <span className={`inline-flex min-w-24 items-center justify-end gap-1 ${isOverdue(entry.todo.dueDate, entry.todo.dueTime) ? 'text-red-500' : 'text-muted-foreground'}`}>
                      <Clock className="h-3 w-3" />{formatDueDate(entry.todo.dueDate, entry.todo.dueTime)}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center opacity-45 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
                  <button type="button" onClick={() => openEditDialog(entry.todo)} className="flex h-7 w-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50" aria-label={`编辑“${entry.todo.title}”`} title="编辑任务">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => onDelete(entry.todo.id)} className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500" aria-label={`删除“${entry.todo.title}”`} title="删除任务">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </article>
            ) : (
              <article key={entry.key} className="group relative flex min-h-[58px] items-center gap-3 border-b border-border/55 px-3 py-2 transition-colors duration-150 ease-out last:border-b-0 hover:bg-blue-50/35 motion-reduce:transition-none">
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-blue-500" />
                <button type="button" className="shrink-0 text-slate-300 transition-colors hover:text-blue-500" onClick={() => onToggleGmail(getDailyGmailTaskKey(entry.item.threadId, entry.item.messageId))} aria-label={`将“${entry.item.channelName}”的来信标记为已完成`}>
                  <Circle className="h-5 w-5" />
                </button>
                <YouTubeChannelAvatar avatar={entry.item.avatar} fallback={entry.item.channelName} label={entry.item.channelName} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="max-w-[300px] truncate text-[13px] font-semibold text-foreground">{entry.item.channelName}</p>
                    <Badge variant="outline" className="h-5 shrink-0 border-blue-100 bg-blue-50 px-1.5 text-[9px] font-medium text-blue-600"><Mail className="mr-1 h-2.5 w-2.5" />Gmail</Badge>
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground">{entry.item.subject || '无主题'}</span>
                  </div>
                  <p className="mt-1 truncate text-[11px] text-slate-600">{entry.item.summary}{entry.item.summaryPending && <span className="ml-2 text-[10px] text-blue-500">AI 正在优化摘要…</span>}</p>
                </div>
                <span className="w-12 shrink-0 text-right text-[10px] text-muted-foreground">{new Date(entry.item.date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                <button type="button" onClick={() => onOpenGmail(entry.item.threadId)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-blue-600 opacity-45 transition-[opacity,background-color] duration-150 ease-out hover:bg-blue-50 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none" aria-label={`查看“${entry.item.channelName}”的邮件线程`} title="打开该邮件线程">
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </article>
            ))}
          </div>
        )}

        {/* 今日已完成 */}
        {completedTodayItems.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              今日已完成 ({completedTodayItems.length})
            </h3>
            {renderCompletedList(completedTodayItems)}
          </div>
        )}

        {/* 历史已完成 */}
        {historicalCompletedItems.length > 0 && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setHistoryExpanded((expanded) => !expanded)}
              className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
              aria-expanded={historyExpanded}
            >
              {historyExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              历史已完成 ({historicalCompletedItems.length})
            </button>
            {historyExpanded && renderCompletedList(historicalCompletedItems, true)}
          </div>
        )}
      </div>

      {/* 添加/编辑弹窗 */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => { if (!open) setDialogMode(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {dialogMode === 'edit' ? <Pencil className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
              {dialogMode === 'edit' ? '编辑待办' : '添加待办'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">标题</label>
              <Input
                value={todoDraft.title}
                onChange={(e) => setTodoDraft({ ...todoDraft, title: e.target.value })}
                placeholder="输入待办事项..."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">描述</label>
              <Textarea
                value={todoDraft.description}
                onChange={(e) => setTodoDraft({ ...todoDraft, description: e.target.value })}
                placeholder="添加详细描述..."
                rows={5}
                className="min-h-[120px] resize-y"
              />
            </div>
            <div className="grid grid-cols-[90px_1fr_1fr] gap-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">优先级</label>
                <Select
                  value={todoDraft.priority}
                  onValueChange={(v: TodoPriority) => setTodoDraft({ ...todoDraft, priority: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">低</SelectItem>
                    <SelectItem value="medium">中</SelectItem>
                    <SelectItem value="high">高</SelectItem>
                    <SelectItem value="urgent">紧急</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">截止日期</label>
                <Input
                  type="date"
                  value={todoDraft.dueDate}
                  onChange={(e) => setTodoDraft({ ...todoDraft, dueDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">截止时间</label>
                <Input
                  type="time"
                  value={todoDraft.dueTime}
                  onChange={(e) => setTodoDraft({ ...todoDraft, dueTime: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>
              取消
            </Button>
            <Button onClick={handleSaveTodo} disabled={!todoDraft.title.trim()}>
              {dialogMode === 'edit' ? '保存修改' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
