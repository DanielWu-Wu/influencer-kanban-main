'use client';

import { useState } from 'react';
import { Check, Clock3, Settings2, X } from 'lucide-react';
import {
  ConcurrencyStepper,
  DenseTaskRow,
  PrototypeCompletionNotification,
  PrototypeWorkspace,
  TopbarTaskButton,
  usePrototypeTasks,
} from './prototype-shared';

export function CompactPopoverVariant() {
  const demo = usePrototypeTasks('compact-popover');
  const [open, setOpen] = useState(true);
  const activeCount = demo.counts.running + demo.counts.queued;

  return (
    <PrototypeWorkspace
      destination={demo.destination}
      onBack={() => demo.setDestination(null)}
      notification={<PrototypeCompletionNotification task={demo.notificationTask} onOpen={() => { demo.openNotification(); setOpen(false); }} onDismiss={demo.dismissNotification} />}
      entry={(
        <TopbarTaskButton
          open={open}
          activeCount={activeCount}
          onClick={() => setOpen(!open)}
        />
      )}
      overlay={open ? (
        <section className="prototype-popover-in fixed right-4 top-[66px] z-50 flex max-h-[min(640px,calc(100dvh-92px))] w-[420px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white/96 shadow-[0_20px_54px_rgba(15,23,42,0.18)] backdrop-blur-xl md:right-5">
          <header className="flex items-start gap-3 border-b border-slate-200 px-4 py-3.5">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
              <Clock3 className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">邮件生成进度</h2>
              <p className="mt-0.5 text-xs text-slate-500">{demo.counts.running} 个生成中 · {demo.counts.queued} 个排队</p>
            </div>
            <button type="button" aria-label="关闭邮件生成进度" title="关闭" className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)}>
              <X className="size-4" />
            </button>
          </header>

          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><Settings2 className="size-3.5" />并发任务数</span>
            <ConcurrencyStepper compact value={demo.concurrency} onChange={demo.setConcurrency} />
          </div>

          <div className="min-h-0 overflow-y-auto">
            {demo.tasks.filter((task) => task.status === 'running' || task.status === 'queued').map((task) => (
              <DenseTaskRow key={task.id} task={task} onOpen={(item) => { demo.openTask(item); setOpen(false); }} />
            ))}
            {(demo.counts.completed > 0 || demo.counts.failed > 0) ? (
              <div className="flex items-center justify-between border-y border-slate-200 bg-slate-50/75 px-4 py-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500"><Check className="size-3.5" />最近完成</span>
                {demo.counts.completed > 0 ? <button type="button" className="text-[11px] text-slate-500 hover:text-slate-800" onClick={demo.clearCompleted}>清空已完成</button> : null}
              </div>
            ) : null}
            {demo.tasks.filter((task) => task.status === 'completed' || task.status === 'failed').map((task) => (
              <DenseTaskRow key={task.id} task={task} onOpen={(item) => { demo.openTask(item); setOpen(false); }} />
            ))}
          </div>

          <footer className="border-t border-slate-200 px-4 py-2.5 text-center text-[11px] text-slate-500">完成和失败记录保留 24 小时</footer>
        </section>
      ) : null}
    />
  );
}
