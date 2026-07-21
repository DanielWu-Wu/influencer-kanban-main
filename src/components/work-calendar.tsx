'use client';

import { useState, useMemo } from 'react';
import { CalendarEvent, TodoItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChevronLeft, ChevronRight, Plus, Clock, Video,
  Mail, CalendarDays, X, Trash2, Calendar
} from 'lucide-react';

interface WorkCalendarProps {
  events: CalendarEvent[];
  todos: TodoItem[];
  onAddEvent: (event: Omit<CalendarEvent, 'id'>) => void;
  onDeleteEvent: (id: string) => void;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: React.ReactNode }> = {
  deadline: { label: '截止', color: 'text-red-600', bgColor: 'bg-red-100', icon: <Clock className="w-3 h-3" /> },
  reminder: { label: '提醒', color: 'text-amber-600', bgColor: 'bg-amber-100', icon: <CalendarDays className="w-3 h-3" /> },
  follow_up: { label: '跟进', color: 'text-blue-600', bgColor: 'bg-blue-100', icon: <Mail className="w-3 h-3" /> },
  meeting: { label: '会议', color: 'text-purple-600', bgColor: 'bg-purple-100', icon: <Video className="w-3 h-3" /> },
  publish: { label: '发布', color: 'text-green-600', bgColor: 'bg-green-100', icon: <Video className="w-3 h-3" /> },
  custom: { label: '自定义', color: 'text-gray-600', bgColor: 'bg-gray-100', icon: <CalendarDays className="w-3 h-3" /> },
};

export function WorkCalendar({ events, todos, onAddEvent, onDeleteEvent }: WorkCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    type: 'reminder' as CalendarEvent['type'],
    description: '',
    color: '#3b82f6',
  });

  const calendarDays = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDay = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    
    const days: Array<{ date: Date; isCurrentMonth: boolean }> = [];
    
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDay - 1; i >= 0; i--) {
      days.push({
        date: new Date(year, month - 1, prevMonthLastDay - i),
        isCurrentMonth: false,
      });
    }
    
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        date: new Date(year, month, i),
        isCurrentMonth: true,
      });
    }
    
    const remainingDays = 42 - days.length;
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        date: new Date(year, month + 1, i),
        isCurrentMonth: false,
      });
    }
    
    return days;
  }, [currentDate]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const formatDateKey = (date: Date) => {
    return date.toISOString().split('T')[0];
  };

  const getEventsForDate = (date: Date) => {
    const dateKey = formatDateKey(date);
    return events.filter(e => e.date === dateKey);
  };

  const getTodosForDate = (date: Date) => {
    const dateKey = formatDateKey(date);
    return todos.filter(t => t.dueDate === dateKey && t.status === 'pending');
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleAddEvent = () => {
    if (!newEvent.title.trim() || !selectedDate) return;
    
    onAddEvent({
      title: newEvent.title,
      date: formatDateKey(selectedDate),
      type: newEvent.type,
      color: newEvent.color,
      description: newEvent.description || undefined,
    });

    setNewEvent({
      title: '',
      type: 'reminder',
      description: '',
      color: '#3b82f6',
    });
    setShowEventDialog(false);
    setSelectedDate(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="material-toolbar -mx-1 mb-4 flex items-center justify-between rounded-xl border border-border/50 px-4 py-3 shadow-[var(--glass-shadow-soft)]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-violet-200/70 bg-violet-500 shadow-[0_6px_16px_rgba(139,92,246,0.16)]">
            <Calendar className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">
              {currentDate.getFullYear()} 年 {currentDate.getMonth() + 1} 月
            </h2>
            <p className="text-sm text-muted-foreground">
              {events.length} 个日程 · {todos.filter(t => t.dueDate && new Date(t.dueDate) >= today).length} 个待办
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={handlePrevMonth}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setCurrentDate(new Date())}
            className="px-3"
          >
            今天
          </Button>
          <Button variant="outline" size="icon" onClick={handleNextMonth}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* 星期标题 */}
      <div className="grid grid-cols-7 mb-2">
        {WEEKDAYS.map((day, i) => (
          <div 
            key={day} 
            className={`text-center text-xs font-medium py-2 ${
              i === 0 || i === 6 ? 'text-muted-foreground' : 'text-foreground'
            }`}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 日历网格 */}
      <div className="flex-1 grid grid-cols-7 gap-1">
        {calendarDays.map((day, index) => {
          const dateEvents = getEventsForDate(day.date);
          const dateTodos = getTodosForDate(day.date);
          const isToday = day.date.getTime() === today.getTime();
          const isSelected = selectedDate?.getTime() === day.date.getTime();
          const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;

          return (
            <button
              key={index}
              onClick={() => {
                setSelectedDate(day.date);
                setShowEventDialog(true);
              }}
              className={`
                relative min-h-[60px] rounded-lg border border-transparent p-1 transition-[background-color,border-color,box-shadow] duration-200
                ${day.isCurrentMonth ? 'bg-white/58 hover:border-border/55 hover:bg-white/88' : 'bg-white/24'}
                ${isToday ? 'ring-2 ring-blue-500' : ''}
                ${isSelected ? 'bg-blue-50 ring-2 ring-blue-300' : ''}
                ${isWeekend && day.isCurrentMonth ? '' : ''}
                hover:bg-accent/70
              `}
            >
              <span className={`
                block w-7 h-7 leading-7 mx-auto rounded-full text-sm font-medium
                ${isToday ? 'bg-blue-500 text-white' : ''}
                ${!day.isCurrentMonth ? 'text-muted-foreground/40' : ''}
              `}>
                {day.date.getDate()}
              </span>
              
              {/* 事件指示器 */}
              {dateEvents.length > 0 && (
                <div className="absolute bottom-1 left-1 right-1 flex gap-0.5 justify-center">
                  {dateEvents.slice(0, 3).map((event, i) => (
                    <span
                      key={i}
                      className={`w-2 h-2 rounded-full ${EVENT_TYPE_CONFIG[event.type]?.bgColor}`}
                    />
                  ))}
                </div>
              )}

              {/* 待办指示器 */}
              {dateTodos.length > 0 && (
                <div className="absolute top-1 right-1">
                  <Badge variant="destructive" className="h-4 w-4 p-0 text-[10px] flex items-center justify-center">
                    {dateTodos.length}
                  </Badge>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* 选中日期详情 */}
      {selectedDate && (
        <Card className="mt-4 shadow-apple">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium flex items-center gap-2">
                <CalendarDays className="w-4 h-4" />
                {selectedDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
              </h3>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setSelectedDate(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            
            <div className="space-y-2 max-h-32 overflow-y-auto">
              {getEventsForDate(selectedDate).map(event => (
                <div
                  key={event.id}
                  className={`flex items-center gap-3 p-2 rounded-lg ${EVENT_TYPE_CONFIG[event.type]?.bgColor}`}
                >
                  <span className={`${EVENT_TYPE_CONFIG[event.type]?.color}`}>
                    {EVENT_TYPE_CONFIG[event.type]?.icon}
                  </span>
                  <span className="flex-1 text-sm">{event.title}</span>
                  <button
                    onClick={() => onDeleteEvent(event.id)}
                    className="text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
              
              {getTodosForDate(selectedDate).map(todo => (
                <div
                  key={todo.id}
                  className="flex items-center gap-3 p-2 rounded-lg bg-blue-50"
                >
                  <span className="text-blue-600">
                    <Clock className="w-3 h-3" />
                  </span>
                  <span className="flex-1 text-sm truncate">{todo.title}</span>
                  <Badge variant="secondary" className="text-[10px]">待办</Badge>
                </div>
              ))}

              {getEventsForDate(selectedDate).length === 0 && getTodosForDate(selectedDate).length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">暂无日程</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 添加事件弹窗 */}
      <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedDate && (
                <>添加日程 - {selectedDate.toLocaleDateString('zh-CN')}</>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">事件标题</label>
              <Input
                value={newEvent.title}
                onChange={(e) => setNewEvent({ ...newEvent, title: e.target.value })}
                placeholder="输入事件标题..."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">事件类型</label>
              <Select 
                value={newEvent.type} 
                onValueChange={(v: CalendarEvent['type']) => setNewEvent({ ...newEvent, type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reminder">提醒</SelectItem>
                  <SelectItem value="follow_up">跟进</SelectItem>
                  <SelectItem value="deadline">截止</SelectItem>
                  <SelectItem value="meeting">会议</SelectItem>
                  <SelectItem value="publish">发布</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">备注</label>
              <Textarea
                value={newEvent.description}
                onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                placeholder="添加备注..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowEventDialog(false);
              setSelectedDate(null);
            }}>
              取消
            </Button>
            <Button onClick={handleAddEvent} disabled={!selectedDate || !newEvent.title.trim()}>
              <Plus className="w-4 h-4 mr-1" />
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
