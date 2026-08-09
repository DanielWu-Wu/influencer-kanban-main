'use client';

import { useState, useMemo } from 'react';
import { CalendarEvent, TodoItem } from '@/lib/types';
import {
  COOPERATION_STAGE_META,
  type CooperationCalendarEvent,
} from '@/lib/cooperation-projects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  ChevronLeft, ChevronRight, Plus, Clock, Video,
  Mail, CalendarDays, Trash2, Calendar, RefreshCw,
  BriefcaseBusiness, AlertTriangle, LoaderCircle,
} from 'lucide-react';
import { formatLocalDateKey, parseLocalDateKey } from '@/lib/local-date';

interface WorkCalendarProps {
  events: CalendarEvent[];
  todos: TodoItem[];
  cooperationEvents: CooperationCalendarEvent[];
  cooperationConfigured: boolean;
  cooperationLoading: boolean;
  cooperationRefreshing: boolean;
  cooperationError?: string;
  onAddEvent: (event: Omit<CalendarEvent, 'id'>) => void;
  onDeleteEvent: (id: string) => void;
  onRefreshCooperation: () => void;
  onOpenCooperationProject: (projectId: string) => void;
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

function indexByDate<T>(items: T[], dateKey: (item: T) => string) {
  const index = new Map<string, T[]>();
  for (const item of items) {
    const key = dateKey(item);
    const current = index.get(key);
    if (current) current.push(item);
    else index.set(key, [item]);
  }
  return index;
}

function channelInitials(channelName: string) {
  return channelName.trim().slice(0, 2).toUpperCase() || '红人';
}

function ProjectAvatar({ event, compact = false }: {
  event: CooperationCalendarEvent;
  compact?: boolean;
}) {
  return (
    <Avatar className={compact ? 'size-5 shrink-0 ring-1 ring-white/80' : 'size-10 shrink-0 ring-1 ring-blue-100'}>
      {event.project.avatarUrl ? (
        <AvatarImage
          src={event.project.avatarUrl}
          alt={`${event.project.channelName} 频道头像`}
          className="object-cover"
        />
      ) : null}
      <AvatarFallback className={compact
        ? 'bg-blue-100 text-[7px] font-semibold text-blue-700'
        : 'bg-blue-50 text-xs font-semibold text-blue-700'}
      >
        {channelInitials(event.project.channelName)}
      </AvatarFallback>
    </Avatar>
  );
}

export function WorkCalendar({
  events,
  todos,
  cooperationEvents,
  cooperationConfigured,
  cooperationLoading,
  cooperationRefreshing,
  cooperationError,
  onAddEvent,
  onDeleteEvent,
  onRefreshCooperation,
  onOpenCooperationProject,
}: WorkCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showDayDetails, setShowDayDetails] = useState(false);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [newEventDateKey, setNewEventDateKey] = useState(formatLocalDateKey(new Date()));
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

  const eventsByDate = useMemo(
    () => indexByDate(events, (event) => event.date),
    [events],
  );
  const todosByDate = useMemo(
    () => indexByDate(
      todos.filter((todo) => todo.status === 'pending' && Boolean(todo.dueDate)),
      (todo) => todo.dueDate!,
    ),
    [todos],
  );
  const cooperationEventsByDate = useMemo(
    () => indexByDate(cooperationEvents, (event) => event.dateKey),
    [cooperationEvents],
  );

  const getEventsForDate = (date: Date) => eventsByDate.get(formatLocalDateKey(date)) || [];
  const getTodosForDate = (date: Date) => todosByDate.get(formatLocalDateKey(date)) || [];
  const getCooperationEventsForDate = (date: Date) => (
    cooperationEventsByDate.get(formatLocalDateKey(date)) || []
  );

  const monthStats = useMemo(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const isCurrentMonth = (dateKey: string) => {
      const date = parseLocalDateKey(dateKey);
      return date.getFullYear() === year && date.getMonth() === month;
    };
    return {
      cooperation: cooperationEvents.filter((event) => isCurrentMonth(event.dateKey)).length,
      events: events.filter((event) => isCurrentMonth(event.date)).length,
      todos: todos.filter((todo) => (
        todo.status === 'pending' && Boolean(todo.dueDate) && isCurrentMonth(todo.dueDate!)
      )).length,
    };
  }, [cooperationEvents, currentDate, events, todos]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const handleAddEvent = () => {
    if (!newEvent.title.trim() || !newEventDateKey) return;
    
    onAddEvent({
      title: newEvent.title,
      date: newEventDateKey,
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
  };

  const openAddEventDialog = () => {
    setNewEventDateKey(formatLocalDateKey(selectedDate || new Date()));
    setShowEventDialog(true);
  };

  const selectedCooperationEvents = selectedDate ? getCooperationEventsForDate(selectedDate) : [];
  const selectedEvents = selectedDate ? getEventsForDate(selectedDate) : [];
  const selectedTodos = selectedDate ? getTodosForDate(selectedDate) : [];

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
              本月 {monthStats.cooperation} 个合作节点 · {monthStats.events} 个日程 · {monthStats.todos} 个待办
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={openAddEventDialog}>
            <Plus className="h-4 w-4" />
            新增日程
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!cooperationConfigured || cooperationLoading || cooperationRefreshing}
            onClick={onRefreshCooperation}
            title={cooperationConfigured ? '刷新飞书合作项目时间节点' : '请先配置详细合作记录表'}
          >
            {cooperationLoading || cooperationRefreshing
              ? <LoaderCircle className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />}
            刷新项目
          </Button>
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

      {!cooperationConfigured ? (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          尚未配置飞书“详细合作记录表”；手动日程和待办仍可正常使用。
        </div>
      ) : cooperationError ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          合作节点读取失败：{cooperationError}。手动日程和待办未受影响。
        </div>
      ) : cooperationLoading && cooperationEvents.length === 0 ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
          <LoaderCircle className="h-4 w-4 animate-spin" />正在读取飞书合作项目时间节点…
        </div>
      ) : null}

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
          const dateCooperationEvents = getCooperationEventsForDate(day.date);
          const isToday = day.date.getTime() === today.getTime();
          const isSelected = selectedDate?.getTime() === day.date.getTime();
          const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;

          return (
            <div
              key={index}
              className={`
                relative min-h-[76px] rounded-lg border border-transparent p-1 transition-[background-color,border-color,box-shadow] duration-200
                ${day.isCurrentMonth ? 'bg-white/58 hover:border-border/55 hover:bg-white/88' : 'bg-white/24'}
                ${isToday ? 'ring-2 ring-blue-500' : ''}
                ${isSelected ? 'bg-blue-50 ring-2 ring-blue-300' : ''}
                ${isWeekend && day.isCurrentMonth ? '' : ''}
                hover:bg-accent/70
              `}
            >
              <button
                type="button"
                className="absolute inset-0 rounded-lg"
                aria-label={`${day.date.toLocaleDateString('zh-CN')}，查看当天详情`}
                onClick={() => {
                  setSelectedDate(day.date);
                  setShowDayDetails(true);
                }}
              />
              <span className={`relative z-[1] block w-7 h-7 leading-7 mx-auto rounded-full text-sm font-medium pointer-events-none
                  ${isToday ? 'bg-blue-500 text-white' : ''}
                  ${!day.isCurrentMonth ? 'text-muted-foreground/40' : ''}
                `}>
                  {day.date.getDate()}
                </span>

              {dateCooperationEvents.length > 0 ? (
                <div className="pointer-events-none relative z-[2] mt-0.5 space-y-0.5">
                  {dateCooperationEvents.slice(0, 2).map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onOpenCooperationProject(event.projectId)}
                      className={`pointer-events-auto flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[9px] font-medium hover:ring-1 hover:ring-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${event.colorClass}`}
                      title={`${event.label} · ${event.project.channelName}`}
                    >
                      <ProjectAvatar event={event} compact />
                      <span className="truncate">{event.label} · {event.project.channelName}</span>
                    </button>
                  ))}
                  {dateCooperationEvents.length > 2 ? (
                    <p className="truncate px-1 text-left text-[9px] text-muted-foreground">还有 {dateCooperationEvents.length - 2} 项</p>
                  ) : null}
                </div>
              ) : null}
              
              {/* 事件指示器 */}
              {dateEvents.length > 0 && (
                <div className="pointer-events-none absolute bottom-1 left-1 right-1 flex gap-0.5 justify-center">
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
                <div className="pointer-events-none absolute top-1 right-1">
                  <Badge variant="destructive" className="h-4 w-4 p-0 text-[10px] flex items-center justify-center">
                    {dateTodos.length}
                  </Badge>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 选中日期详情：只读查看，不会创建日程 */}
      <Dialog open={showDayDetails} onOpenChange={setShowDayDetails}>
        <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              {selectedDate
                ? selectedDate.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
                : '当天详情'}
            </DialogTitle>
            <DialogDescription>
              {selectedCooperationEvents.length} 个合作节点 · {selectedEvents.length} 个手动日程 · {selectedTodos.length} 个待办。点击合作节点可查看完整项目。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            {selectedCooperationEvents.length > 0 ? (
              <section className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <BriefcaseBusiness className="h-3.5 w-3.5" />合作项目进度节点
                </h4>
                {selectedCooperationEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onOpenCooperationProject(event.projectId)}
                    className={`block w-full rounded-xl border border-current/10 p-3 text-left transition-shadow hover:shadow-sm hover:ring-1 hover:ring-blue-300 ${event.colorClass}`}
                  >
                    <span className="flex items-start gap-3">
                      <ProjectAvatar event={event} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">{event.project.channelName}</span>
                          <Badge variant="outline" className="bg-white/70 text-[10px]">{event.label}</Badge>
                          {event.overdue ? <Badge variant="destructive" className="text-[10px]">逾期</Badge> : null}
                        </span>
                        <span className="mt-1 block text-xs opacity-80">
                          {event.project.product} · {COOPERATION_STAGE_META[event.project.stage].label}
                        </span>
                      </span>
                    </span>
                    <span className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                      <span><span className="block opacity-60">下一步</span><span className="mt-0.5 block font-medium">{event.project.nextAction}</span></span>
                      <span><span className="block opacity-60">合作信息</span><span className="mt-0.5 block font-medium">{event.project.site} · {event.project.cooperationType}</span></span>
                      <span><span className="block opacity-60">推广负责人</span><span className="mt-0.5 block font-medium">{event.project.owner}</span></span>
                      <span><span className="block opacity-60">风险提示</span><span className="mt-0.5 block font-medium">{event.project.risks[0]?.label || '暂无风险'}</span></span>
                    </span>
                  </button>
                ))}
              </section>
            ) : null}

            {selectedEvents.length > 0 ? (
              <section className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <CalendarDays className="h-3.5 w-3.5" />手动日程
                </h4>
                {selectedEvents.map((event) => (
                  <div key={event.id} className={`flex items-start gap-3 rounded-lg p-3 ${EVENT_TYPE_CONFIG[event.type]?.bgColor}`}>
                    <span className={`mt-0.5 ${EVENT_TYPE_CONFIG[event.type]?.color}`}>
                      {EVENT_TYPE_CONFIG[event.type]?.icon}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{event.title}</p>
                      {event.description ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{event.description}</p> : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-red-500"
                      aria-label={`删除日程：${event.title}`}
                      onClick={() => onDeleteEvent(event.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </section>
            ) : null}

            {selectedTodos.length > 0 ? (
              <section className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                  <Clock className="h-3.5 w-3.5" />待办任务
                </h4>
                {selectedTodos.map((todo) => (
                  <div key={todo.id} className="flex items-start gap-3 rounded-lg bg-blue-50 p-3">
                    <Clock className="mt-0.5 h-3.5 w-3.5 text-blue-600" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{todo.title}</p>
                      {todo.description ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{todo.description}</p> : null}
                    </div>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">待办</Badge>
                  </div>
                ))}
              </section>
            ) : null}

            {selectedCooperationEvents.length === 0 && selectedEvents.length === 0 && selectedTodos.length === 0 ? (
              <div className="py-10 text-center">
                <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-medium">当天没有安排</p>
                <p className="mt-1 text-xs text-muted-foreground">如需添加提醒，请使用月历顶部的“新增日程”按钮。</p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* 添加事件弹窗 */}
      <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增日程提醒</DialogTitle>
            <DialogDescription>只有点击下方“添加”后才会创建日程；点击月历日期只用于查看当天详情。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label htmlFor="calendar-event-date" className="text-sm font-medium">日程日期</label>
              <Input
                id="calendar-event-date"
                type="date"
                value={newEventDateKey}
                onChange={(event) => setNewEventDateKey(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="calendar-event-title" className="text-sm font-medium">事件标题</label>
              <Input
                id="calendar-event-title"
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
            <Button variant="outline" onClick={() => setShowEventDialog(false)}>
              取消
            </Button>
            <Button onClick={handleAddEvent} disabled={!newEventDateKey || !newEvent.title.trim()}>
              <Plus className="w-4 h-4 mr-1" />
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
