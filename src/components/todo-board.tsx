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
  Calendar, Flame, AlertCircle, Sparkles
} from 'lucide-react';

interface TodoBoardProps {
  todos: TodoItem[];
  onAdd: (todo: Omit<TodoItem, 'id' | 'createdAt'>) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<TodoItem>) => void;
}

const PRIORITY_CONFIG: Record<TodoPriority, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  low: { label: '低', color: 'text-gray-600', bgColor: 'bg-gray-100', icon: <Flag className="w-3 h-3" /> },
  medium: { label: '中', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: <Flag className="w-3 h-3" /> },
  high: { label: '高', color: 'text-orange-600', bgColor: 'bg-orange-100', icon: <Flame className="w-3 h-3" /> },
  urgent: { label: '紧急', color: 'text-red-600', bgColor: 'bg-red-100', icon: <AlertCircle className="w-3 h-3" /> },
};

export function TodoBoard({ todos, onAdd, onToggle, onDelete, onUpdate }: TodoBoardProps) {
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
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dueDate = new Date(dateStr);
    dueDate.setHours(0, 0, 0, 0);

    if (dueDate.getTime() === today.getTime()) return '今天';
    if (dueDate.getTime() === tomorrow.getTime()) return '明天';
    if (dueDate < today) return '已逾期';
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const isOverdue = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(dateStr) < today;
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">今日待办</h2>
            <p className="text-sm text-muted-foreground">
              {filteredPending.length} 项待完成
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
        {filteredPending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-lg font-medium mb-1">太棒了！</h3>
            <p className="text-muted-foreground">今天的待办已经全部完成</p>
          </div>
        ) : (
          filteredPending.map(todo => (
            <Card 
              key={todo.id} 
              className={`
                transition-all duration-200 cursor-pointer
                hover:shadow-apple-hover hover:-translate-y-0.5
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
