'use client';

import {
  Bot,
  Check,
  Clock3,
  LoaderCircle,
  MailCheck,
  RotateCcw,
  X,
} from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useEmailGenerationTasks } from '@/components/email-generation-task-provider';
import {
  resolveEmailGenerationTaskProgress,
  type EmailGenerationTask,
} from '@/lib/email-generation-tasks';
import { getMailProviderLabel } from '@/lib/mail-accounts';

function taskInitial(title: string) {
  return title.trim().slice(0, 1).toUpperCase() || '邮';
}

function taskStatusIcon(task: EmailGenerationTask) {
  if (task.status === 'running') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (task.status === 'queued') return <Clock3 className="h-3.5 w-3.5 text-amber-600" />;
  if (task.status === 'completed') return <Check className="h-3.5 w-3.5 text-emerald-600" />;
  if (task.status === 'interrupted') return <RotateCcw className="h-3.5 w-3.5 text-amber-600" />;
  return <X className="h-3.5 w-3.5 text-destructive" />;
}

function handleTaskListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.target !== event.currentTarget) return;

  const list = event.currentTarget;
  const pageDistance = Math.max(80, list.clientHeight * 0.85);
  let distance = 0;

  if (event.key === 'ArrowDown') distance = 40;
  else if (event.key === 'ArrowUp') distance = -40;
  else if (event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) distance = pageDistance;
  else if (event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) distance = -pageDistance;
  else if (event.key === 'Home') {
    event.preventDefault();
    list.scrollTo({ top: 0 });
    return;
  } else if (event.key === 'End') {
    event.preventDefault();
    list.scrollTo({ top: list.scrollHeight });
    return;
  } else {
    return;
  }

  event.preventDefault();
  list.scrollBy({ top: distance });
}

function TaskRow({
  task,
  onNavigate,
}: {
  task: EmailGenerationTask;
  onNavigate: () => void;
}) {
  const { cancelTask, openTask, retryTask } = useEmailGenerationTasks();
  const canOpen = task.status !== 'cancelled';
  const progress = resolveEmailGenerationTaskProgress(task);
  const mailSource = `${getMailProviderLabel(task.provider)} · ${task.mailAddress || task.gmailEmail || '未记录来源邮箱'}`;
  const progressLabel = task.status === 'completed'
    ? '100%'
    : task.status === 'queued'
      ? '排队中 · 0%'
      : task.status === 'interrupted'
        ? `${progress}% · 可重试`
        : task.status === 'failed'
          ? `失败于 ${progress}%`
          : `约 ${progress}%`;
  const progressClassName = task.status === 'completed'
    ? 'bg-emerald-100 [&_[data-slot=progress-indicator]]:bg-emerald-500'
    : task.status === 'failed'
      ? 'bg-red-100 [&_[data-slot=progress-indicator]]:bg-red-500'
      : task.status === 'interrupted' || task.status === 'queued'
        ? 'bg-amber-100 [&_[data-slot=progress-indicator]]:bg-amber-500'
        : 'bg-blue-100 [&_[data-slot=progress-indicator]]:bg-blue-600';
  const progressTextClassName = task.status === 'completed'
    ? 'text-emerald-700'
    : task.status === 'failed'
      ? 'text-red-700'
      : task.status === 'interrupted' || task.status === 'queued'
        ? 'text-amber-700'
        : 'text-blue-700';
  return (
    <div className="group flex min-h-20 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/45">
      <Avatar className="h-9 w-9 shrink-0 border border-border/60">
        {task.avatarUrl ? <AvatarImage src={task.avatarUrl} alt="" /> : null}
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {taskInitial(task.title)}
        </AvatarFallback>
      </Avatar>
      <button
        type="button"
        className="min-w-0 flex-1 text-left disabled:cursor-default"
        disabled={!canOpen}
        onClick={() => {
          openTask(task.id);
          onNavigate();
        }}
      >
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{task.title}</span>
          {taskStatusIcon(task)}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
          <p className="shrink-0 text-xs text-muted-foreground">{task.description}</p>
          <p className="min-w-0 truncate text-[11px] text-blue-700" title={mailSource}>
            {mailSource}
          </p>
        </div>
        <div className="mt-0.5 flex min-h-5 items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-muted-foreground/80">{task.stage}</p>
          {task.status === 'completed' && task.draftSavedAt ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <MailCheck className="size-3" />
              已保存邮件草稿
            </span>
          ) : null}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Progress
            value={progress}
            aria-label={`${task.title}，${progressLabel}，${task.stage}`}
            className={`h-1.5 flex-1 ${progressClassName}`}
          />
          <span className={`shrink-0 text-[11px] font-medium tabular-nums ${progressTextClassName}`}>
            {progressLabel}
          </span>
        </div>
      </button>
      {task.status === 'queued' || task.status === 'running' ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          title={task.status === 'running' ? '取消当前任务' : '取消排队'}
          aria-label={task.status === 'running' ? '取消当前任务' : '取消排队'}
          onClick={() => cancelTask(task.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {task.status === 'failed' || task.status === 'interrupted' ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          title={task.status === 'interrupted' ? '打开任务并重试' : '重新生成'}
          aria-label={task.status === 'interrupted' ? '打开任务并重试' : '重新生成'}
          onClick={() => retryTask(task.id)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

export function EmailGenerationProgress() {
  const [open, setOpen] = useState(false);
  const { tasks, concurrency, setConcurrency } = useEmailGenerationTasks();
  const visibleTasks = tasks
    .filter((task) => task.status !== 'cancelled')
    .sort((a, b) => b.createdAt - a.createdAt);
  const activeCount = visibleTasks.filter((task) => (
    task.status === 'queued' || task.status === 'running'
  )).length;
  const activeTasks = visibleTasks.filter((task) => (
    task.status === 'queued' || task.status === 'running'
  ));
  const recentTasks = visibleTasks.filter((task) => (
    task.status === 'completed' || task.status === 'failed' || task.status === 'interrupted'
  ));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="glass-control relative flex h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-foreground transition-[background-color,box-shadow,transform] duration-200 ease-out hover:bg-white/88 hover:shadow-sm active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100"
          aria-label={`邮件生成进度，${activeCount} 个进行中`}
        >
          <Bot className="h-4 w-4 text-primary" />
          <span className="hidden xl:inline">邮件生成进度</span>
          {activeCount > 0 ? (
            <Badge className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[11px] leading-none">
              {activeCount}
            </Badge>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(420px,calc(100vw-24px))] overflow-hidden rounded-lg p-0"
      >
        <div className="flex h-14 items-center justify-between gap-3 px-3.5">
          <div>
            <p className="text-sm font-semibold">邮件生成进度</p>
            <p className="text-xs text-muted-foreground">已完成结果将同步到云端</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">同时生成</span>
            <Select value={String(concurrency)} onValueChange={(value) => setConcurrency(Number(value))}>
              <SelectTrigger className="h-8 w-17 px-2 text-xs" aria-label="同时生成任务数">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {Array.from({ length: 9 }, (_, index) => index + 2).map((value) => (
                  <SelectItem key={value} value={String(value)}>{value} 个</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Separator />
        <div
          aria-label="邮件生成任务列表"
          className="max-h-[min(520px,70vh)] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
          onKeyDown={handleTaskListKeyDown}
          role="region"
          tabIndex={0}
        >
          {visibleTasks.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center px-6 text-center">
              <Bot className="h-7 w-7 text-muted-foreground/55" />
              <p className="mt-3 text-sm font-medium">暂无邮件生成任务</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                开始生成回复或开发信后，可在这里查看状态。
              </p>
            </div>
          ) : (
            <div className="py-1">
              {activeTasks.length > 0 ? (
                <>
                  <p className="px-3.5 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">进行中</p>
                  {activeTasks.map((task) => (
                    <TaskRow key={task.id} task={task} onNavigate={() => setOpen(false)} />
                  ))}
                </>
              ) : null}
              {recentTasks.length > 0 ? (
                <>
                  {activeTasks.length > 0 ? <Separator className="my-1" /> : null}
                  <p className="px-3.5 pb-1 pt-2 text-[11px] font-medium text-muted-foreground">最近完成</p>
                  {recentTasks.map((task) => (
                    <TaskRow key={task.id} task={task} onNavigate={() => setOpen(false)} />
                  ))}
                </>
              ) : null}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
