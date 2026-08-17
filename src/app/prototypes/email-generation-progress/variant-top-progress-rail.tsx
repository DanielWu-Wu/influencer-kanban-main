'use client';

import { useState } from 'react';
import { Check, ChevronUp, Clock3, FileClock, LoaderCircle, X } from 'lucide-react';
import {
  ConcurrencyStepper,
  PrototypeCompletionNotification,
  PrototypeWorkspace,
  StatusIcon,
  TaskAvatar,
  TaskKindIcon,
  TaskSubject,
  statusLabel,
  usePrototypeTasks,
} from './prototype-shared';

export function TopProgressRailVariant() {
  const demo = usePrototypeTasks('top-progress-rail');
  const [open, setOpen] = useState(true);
  const activeCount = demo.counts.running + demo.counts.queued;

  return (
    <PrototypeWorkspace
      destination={demo.destination}
      onBack={() => demo.setDestination(null)}
      notification={<PrototypeCompletionNotification task={demo.notificationTask} onOpen={() => { demo.openNotification(); setOpen(false); }} onDismiss={demo.dismissNotification} />}
      entry={(
        <button
          type="button"
          aria-label="邮件生成进度"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={`flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-sm transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.985] ${open ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-white bg-white/75 text-slate-700'}`}
        >
          <span className="relative">
            <FileClock className="size-4" />
            {activeCount > 0 ? <span className="absolute -right-1 -top-1 size-2 rounded-full bg-blue-600 ring-2 ring-white" /> : null}
          </span>
          <span className="hidden xl:inline">{demo.counts.running} 项生成中</span>
          <ChevronUp className={`size-3.5 transition-transform duration-150 ease-out ${open ? '' : 'rotate-180'}`} />
        </button>
      )}
      overlay={open ? (
        <section className="prototype-rail-in fixed left-0 right-0 top-[60px] z-30 border-b border-slate-200 bg-white/96 shadow-[0_16px_32px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="flex items-center gap-3 px-4 py-3 md:px-5">
            <div className="hidden min-w-[170px] shrink-0 lg:block">
              <div className="flex items-center gap-2"><FileClock className="size-4 text-blue-600" /><h2 className="text-sm font-semibold">邮件生成进度</h2></div>
              <p className="mt-1 text-[11px] text-slate-500">{demo.counts.running} 生成中 · {demo.counts.queued} 排队 · {demo.counts.completed} 完成</p>
            </div>

            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
              {demo.tasks.slice(0, 6).map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => { demo.openTask(task); setOpen(false); }}
                  className={`flex h-[66px] w-[248px] shrink-0 items-center gap-2.5 rounded-lg border px-3 text-left transition-[border-color,background-color,transform] duration-150 ease-out hover:-translate-y-0.5 ${task.status === 'running' ? 'border-blue-200 bg-blue-50/65' : task.status === 'queued' ? 'border-amber-200 bg-amber-50/55' : task.status === 'failed' ? 'border-red-200 bg-red-50/45' : 'border-emerald-200 bg-emerald-50/45'}`}
                >
                  <TaskAvatar task={task} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5"><span className="truncate text-xs font-semibold">{task.channelName}</span><span className="shrink-0 text-slate-400"><TaskKindIcon kind={task.kind} /></span></span>
                    <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-600"><StatusIcon status={task.status} /><span className="truncate">{statusLabel(task)}</span></span>
                    <TaskSubject task={task} />
                  </span>
                </button>
              ))}
            </div>

            <div className="hidden shrink-0 items-center gap-3 border-l border-slate-200 pl-3 sm:flex">
              <div>
                <p className="mb-1 text-[10px] font-medium text-slate-500">同时执行</p>
                <ConcurrencyStepper compact value={demo.concurrency} onChange={demo.setConcurrency} />
              </div>
              <button type="button" aria-label="收起邮件生成进度" title="收起" className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)}><X className="size-4" /></button>
            </div>
          </div>
          <div className="flex h-7 items-center justify-center gap-5 border-t border-slate-100 bg-slate-50/70 text-[10px] text-slate-500 sm:hidden">
            <span className="flex items-center gap-1"><LoaderCircle className="size-3 animate-spin text-blue-600" />{demo.counts.running} 生成中</span>
            <span className="flex items-center gap-1"><Clock3 className="size-3 text-amber-600" />{demo.counts.queued} 排队</span>
            <span className="flex items-center gap-1"><Check className="size-3 text-emerald-600" />{demo.counts.completed} 完成</span>
          </div>
        </section>
      ) : null}
    />
  );
}
