'use client';

import { useState } from 'react';
import { TodoItem, TodoPriority } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  CheckCircle2, Circle, Clock, Flag, Plus, Trash2,
  Flame, AlertCircle, Sparkles, Mail, RefreshCw, ArrowRight
} from 'lucide-react';
import { parseLocalDateKey } from '@/lib/local-date';
import type { DailyGmailTodo } from '@/lib/use-daily-gmail-todos';
import { YouTubeChannelAvatar } from '@/components/youtube-channel-avatar';

interface TodoBoardProps {
  todos: TodoItem[];
  onAdd: (todo: Omit<TodoItem, 'id' | 'createdAt'>) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  gmailItems: DailyGmailTodo[];
  gmailLoading: boolean;
  gmailRefreshing: boolean;
  gmailError: string;
  onRefreshGmail: () => void;
  onOpenGmail: () => void;
}

const PRIORITY_CONFIG: Record<TodoPriority, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  low: { label: '低', color: 'text-gray-600', bgColor: 'bg-gray-100', icon: <Flag className="w-3 h-3" /> },
  medium: { label: '中', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: <Flag className="w-3 h-3" /> },
  high: { label: '高', color: 'text-orange-600', bgColor: 'bg-orange-100', icon: <Flame className="w-3 h-3" /> },
  urgent: { label: '紧急', color: 'text-red-600', bgColor: 'bg-red-100', icon: <AlertCircle className="w-3 h-3" /> },
};

export function TodoBoard({
  todos,
  onAdd,
  onToggle,
  onDelete,
  gmailItems,
  gmailLoading,
  gmailRefreshing,
  gmailError,
  onRefreshGmail,
  onOpenGmail,
}: TodoBoardProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [filterPriority, setFilterPriority] = useState<TodoPriority | 'all'>('all');
  const [newTodo, setNewTodo] = useState({
    title: '',
    description: '',
    priority: 'medium' as TodoPriority,
    dueDate: '',
    tags: [] as string[],
  });

  const pendingTodos = todos.filter(t => t.status === 'pending');
  const completedTodos = todos.filter(t => t.status === 'completed');

  const filteredPending = filterPriority === 'all'
    ? pendingTodos
    : pendingTodos.filter(t => t.priority === filterPriority);

  const handleAddTodo = () => {
    if (!newTodo.title.trim()) return;
    
    onAdd({
      title: newTodo.title,
      description: newTodo.description || undefined,
      priority: newTodo.priority,
      status: 'pending',
      dueDate: newTodo.dueDate || undefined,
      tags: newTodo.tags,
    });

    setNewTodo({
      title: '',
      description: '',
      priority: 'medium',
      dueDate: '',
      tags: [],
    });
    setShowAddDialog(false);
  };

  const formatDueDate = (dateStr: string) => {
    const date = parseLocalDateKey(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDate = parseLocalDateKey(dateStr);
    dueDate.setHours(0, 0, 0, 0);

    if (dueDate.getTime() === today.getTime()) return '今天';
    if (dueDate.getTime() === tomorrow.getTime()) return '明天';
    if (dueDate < today) return '已逾期';
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const isOverdue = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return parseLocalDateKey(dateStr) < today;
  };

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
              {filteredPending.length} 项手动任务 · {gmailItems.length} 封今日红人来信
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          <Button size="sm" onClick={() => setShowAddDialog(true)} className="shadow-sm">
            <Plus className="w-4 h-4 mr-1" />
            添加
          </Button>
        </div>
      </div>

      {/* 待办列表 */}
      <div className="flex-1 overflow-y-auto space-y-3">
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Mail className="h-4 w-4 text-blue-600" />
                今日 Gmail 来信
                {!gmailLoading && <Badge variant="secondary">{gmailItems.length}</Badge>}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">只显示已匹配到飞书红人资料的正常来信</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRefreshGmail}
              disabled={gmailRefreshing}
            >
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${gmailRefreshing ? 'animate-spin' : ''}`} />
              刷新
            </Button>
          </div>

          {gmailError ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
              <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />{gmailError}</span>
              <Button type="button" variant="outline" size="sm" onClick={onRefreshGmail}>重试</Button>
            </div>
          ) : gmailLoading ? (
            <div className="rounded-xl border border-border/60 bg-white/55 px-4 py-5 text-sm text-muted-foreground">
              正在读取今日 Gmail 来信并匹配红人资料…
            </div>
          ) : gmailItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-white/35 px-4 py-5 text-center text-sm text-muted-foreground">
              今天暂时没有匹配到红人的新来信
            </div>
          ) : (
            gmailItems.map((item) => (
              <Card key={item.messageId} className="border-blue-100 bg-blue-50/25 transition-shadow hover:shadow-apple-hover">
                <CardContent className="flex items-start gap-3 p-4">
                  <YouTubeChannelAvatar
                    avatar={item.avatar}
                    fallback={item.channelName}
                    label={item.channelName}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{item.channelName}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.subject || '无主题'}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {new Date(item.date).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">
                      {item.summary}
                      {item.summaryPending && <span className="ml-2 text-xs text-blue-500">AI 正在优化摘要…</span>}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={onOpenGmail} className="shrink-0">
                    查看邮件 <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </section>

        <div className="flex items-center gap-3 py-2">
          <div className="h-px flex-1 bg-border/60" />
          <span className="text-xs font-medium text-muted-foreground">手动任务</span>
          <div className="h-px flex-1 bg-border/60" />
        </div>

        {filteredPending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-medium mb-1">太棒了！</h3>
            <p className="text-muted-foreground">当前没有未完成的手动任务</p>
          </div>
        ) : (
          filteredPending.map(todo => (
            <Card 
              key={todo.id} 
              className={`
                cursor-pointer transition-[background-color,border-color,box-shadow] duration-200
                hover:shadow-apple-hover
                ${todo.dueDate && isOverdue(todo.dueDate) ? 'border-red-200 bg-red-50/30' : ''}
              `}
              onClick={() => onToggle(todo.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <button
                    className="mt-0.5 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(todo.id);
                    }}
                  >
                    <Circle className="w-6 h-6 text-gray-300 hover:text-blue-500 transition-colors" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{todo.title}</p>
                    {todo.description && (
                      <p className="text-sm text-muted-foreground mt-1">{todo.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${PRIORITY_CONFIG[todo.priority].bgColor} ${PRIORITY_CONFIG[todo.priority].color}`}>
                        {PRIORITY_CONFIG[todo.priority].icon}
                        {PRIORITY_CONFIG[todo.priority].label}
                      </span>
                      {todo.dueDate && (
                        <span className={`inline-flex items-center gap-1 text-xs ${isOverdue(todo.dueDate) ? 'text-red-500' : 'text-muted-foreground'}`}>
                          <Clock className="w-3 h-3" />
                          {formatDueDate(todo.dueDate)}
                        </span>
                      )}
                      {todo.tags.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(todo.id);
                    }}
                    className="text-gray-300 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))
        )}

        {/* 已完成 */}
        {completedTodos.length > 0 && (
          <div className="mt-8">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              已完成 ({completedTodos.length})
            </h3>
            <div className="space-y-1">
              {completedTodos.slice(0, 5).map(todo => (
                <div
                  key={todo.id}
                  className="flex items-center gap-3 p-3 rounded-xl bg-accent/30 text-muted-foreground group"
                >
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  <span className="flex-1 line-through">{todo.title}</span>
                  <button
                    onClick={() => onDelete(todo.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {completedTodos.length > 5 && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  还有 {completedTodos.length - 5} 项已完成
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 添加弹窗 */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              添加待办
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">标题</label>
              <Input
                value={newTodo.title}
                onChange={(e) => setNewTodo({ ...newTodo, title: e.target.value })}
                placeholder="输入待办事项..."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">描述</label>
              <Textarea
                value={newTodo.description}
                onChange={(e) => setNewTodo({ ...newTodo, description: e.target.value })}
                placeholder="添加详细描述..."
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">优先级</label>
                <Select 
                  value={newTodo.priority} 
                  onValueChange={(v: TodoPriority) => setNewTodo({ ...newTodo, priority: v })}
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
                  value={newTodo.dueDate}
                  onChange={(e) => setNewTodo({ ...newTodo, dueDate: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              取消
            </Button>
            <Button onClick={handleAddTodo} disabled={!newTodo.title.trim()}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
