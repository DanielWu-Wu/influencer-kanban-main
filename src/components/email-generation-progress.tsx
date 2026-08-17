'use client';

import {
  Bot,
  Check,
  Clock3,
  LoaderCircle,
  RotateCcw,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useEmailGenerationTasks } from '@/components/email-generation-task-provider';
import type { EmailGenerationTask } from '@/lib/email-generation-tasks';

function taskInitial(title: string) {
  return title.trim().slice(0, 1).toUpperCase() || '邮';
}

function taskStatusIcon(task: EmailGenerationTask) {
  if (task.status === 'running') return <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (task.status === 'queued') return <Clock3 className="h-3.5 w-3.5 text-amber-600" />;
  if (task.status === 'completed') return <Check className="h-3.5 w-3.5 text-emerald-600" />;
  return <X className="h-3.5 w-3.5 text-destructive" />;
}

function TaskRow({
  task,
  onNavigate,
}: {
  task: EmailGenerationTask;
  onNavigate: () => void;
}) {
  const { cancelTask, openTask, retryTask } = useEmailGenerationTasks();
  const canOpen = task.status === 'completed' || task.status === 'running';
  return (
    <div className="group flex min-h-16 items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/45">
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
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.description}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{task.stage}</p>
      </button>
      {task.status === 'queued' ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          title="取消排队"
          aria-label="取消排队"
          onClick={() => cancelTask(task.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
      {task.status === 'failed' ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          title="重新生成"
          aria-label="重新生成"
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
    task.status === 'completed' || task.status === 'failed'
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
            <p className="text-xs text-muted-foreground">当前标签页内持续运行</p>
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
        <ScrollArea className="max-h-[min(520px,70vh)]">
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
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
