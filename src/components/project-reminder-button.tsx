'use client';

import { useState } from 'react';
import { BellPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CooperationProject } from '@/lib/cooperation-projects';
import type { TodoItem } from '@/lib/types';
import type { MailAccountBindingMap } from '@/lib/mail-account-bindings';
import { createProjectReminder, getProjectReminderConversation } from '@/lib/project-reminders';
import { formatLocalDateKey } from '@/lib/local-date';

export type ProjectReminderOptions = {
  sourceUrl: string;
  todos: TodoItem[];
  bindings: MailAccountBindingMap;
  onAdd: (todo: Omit<TodoItem, 'id' | 'createdAt'>) => void;
};

export function ProjectReminderButton({ project, options }: { project: CooperationProject; options: ProjectReminderOptions }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(project.nextAction);
  const [dueDate, setDueDate] = useState(formatLocalDateKey);
  const [dueTime, setDueTime] = useState('09:00');
  const [target, setTarget] = useState<'project' | 'mail'>('project');
  const [submitting, setSubmitting] = useState(false);
  const conversation = getProjectReminderConversation(options.bindings, project.id);
  const count = options.todos.filter(t => t.status === 'pending'
    && t.projectReminder?.projectId === project.id && t.projectReminder.sourceUrl === options.sourceUrl.trim()).length;
  return <div className="mt-1" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <Popover open={open} onOpenChange={value => { setOpen(value); if (value) setSubmitting(false); }}>
      <PopoverTrigger asChild><Button size="sm" variant="ghost" className="h-7 gap-1 px-1 text-xs text-primary" aria-label={`为${project.channelName}添加提醒`}><BellPlus className="size-3.5" />添加提醒{count > 0 && <span> · {count} 项待办</span>}</Button></PopoverTrigger>
      <PopoverContent className="w-[340px] max-w-[calc(100vw-2rem)]" align="start">
        <form className="space-y-3" onSubmit={e => {
          e.preventDefault(); if (submitting) return;
          try {
            const reminder = createProjectReminder({ projectId: project.id, sourceUrl: options.sourceUrl, title,
              description: `${project.channelName} · ${project.product}`, dueDate, dueTime, target, conversation });
            setSubmitting(true); options.onAdd(reminder); setOpen(false);
          } catch (error) { setSubmitting(false); toast.error(error instanceof Error ? error.message : '添加提醒失败。'); }
        }}>
          <h3 className="text-sm font-semibold">添加项目提醒</h3>
          <p className="text-xs text-muted-foreground">{project.channelName} · {project.product}</p>
          <label className="block space-y-1 text-xs">提醒事项<Input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block space-y-1 text-xs">日期<Input required type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></label>
            <label className="block space-y-1 text-xs">时间<Input required type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} /></label>
          </div>
          <label className="block space-y-1 text-xs">处理时打开<select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={target} onChange={e => setTarget(e.target.value as 'project' | 'mail')}><option value="project">这个合作项目</option><option value="mail" disabled={!conversation}>已绑定的合作邮件{!conversation ? '（尚未绑定）' : ''}</option></select></label>
          {!conversation && <p className="text-xs text-muted-foreground">如需打开邮件，请先在项目详情中确认合作邮件线程。</p>}
          <p className="text-xs text-muted-foreground">同步显示在每日待办和工作日历，完成状态保持一致。</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>取消</Button><Button size="sm" disabled={submitting || !title.trim()}>添加提醒</Button></div>
        </form>
      </PopoverContent>
    </Popover>
  </div>;
}
