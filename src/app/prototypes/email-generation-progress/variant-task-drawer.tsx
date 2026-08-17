'use client';

import { useState, type ReactNode } from 'react';
import { Check, Clock3, LoaderCircle, Settings2, X } from 'lucide-react';
import {
  ConcurrencyStepper,
  DenseTaskRow,
  PrototypeCompletionNotification,
  PrototypeWorkspace,
  TopbarTaskButton,
  usePrototypeTasks,
} from './prototype-shared';

export function TaskDrawerVariant() {
  const demo = usePrototypeTasks('task-drawer');
  const [open, setOpen] = useState(true);
  const activeCount = demo.counts.running + demo.counts.queued;

  return (
    <PrototypeWorkspace
      destination={demo.destination}
      onBack={() => demo.setDestination(null)}
      notification={<PrototypeCompletionNotification task={demo.notificationTask} onOpen={() => { demo.openNotification(); setOpen(false); }} onDismiss={demo.dismissNotification} />}
      entry={(
        <TopbarTaskButton
          compactLabel
          open={open}
          activeCount={activeCount}
          onClick={() => setOpen(!open)}
        />
      )}
      overlay={open ? (
        <>
          <button
            type="button"
            aria-label="关闭邮件生成进度"
            className="fixed inset-x-0 bottom-0 top-[60px] z-40 bg-slate-950/10 backdrop-blur-[1px]"
            onClick={() => setOpen(false)}
          />
          <aside className="prototype-drawer-in fixed bottom-0 right-0 top-[60px] z-50 flex w-[440px] max-w-full flex-col border-l border-slate-200 bg-white shadow-[-18px_0_48px_rgba(15,23,42,0.14)]">
            <header className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                <Clock3 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">邮件生成进度</h2>
                <p className="mt-1 text-xs text-slate-500">离开邮件界面后，任务仍会在当前标签页继续</p>
              </div>
              <button type="button" aria-label="关闭邮件生成进度" title="关闭" className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </button>
            </header>

            <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600"><Settings2 className="size-3.5" />同时执行任务</span>
                <ConcurrencyStepper compact value={demo.concurrency} onChange={demo.setConcurrency} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <SummaryCell icon={<LoaderCircle className="size-3.5 animate-spin text-blue-600" />} value={demo.counts.running} label="生成中" />
                <SummaryCell icon={<Clock3 className="size-3.5 text-amber-600" />} value={demo.counts.queued} label="排队" />
                <SummaryCell icon={<Check className="size-3.5 text-emerald-600" />} value={demo.counts.completed} label="已完成" />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <TaskGroup title="正在生成" count={demo.counts.running}>
                {demo.tasks.filter((task) => task.status === 'running').map((task) => (
                  <DenseTaskRow key={task.id} task={task} onOpen={(item) => { demo.openTask(item); setOpen(false); }} />
                ))}
              </TaskGroup>
              {demo.counts.queued > 0 ? (
                <TaskGroup title="等待队列" count={demo.counts.queued}>
                  {demo.tasks.filter((task) => task.status === 'queued').map((task) => (
                    <DenseTaskRow key={task.id} task={task} onOpen={(item) => { demo.openTask(item); setOpen(false); }} />
                  ))}
                </TaskGroup>
              ) : null}
              {(demo.counts.completed > 0 || demo.counts.failed > 0) ? (
                <TaskGroup title="最近记录" count={demo.counts.completed + demo.counts.failed} action={demo.counts.completed > 0 ? <button type="button" className="text-[11px] font-normal text-slate-500 hover:text-slate-800" onClick={demo.clearCompleted}>清空已完成</button> : null}>
                  {demo.tasks.filter((task) => task.status === 'completed' || task.status === 'failed').map((task) => (
                    <DenseTaskRow key={task.id} task={task} onOpen={(item) => { demo.openTask(item); setOpen(false); }} />
                  ))}
                </TaskGroup>
              ) : null}
            </div>
            <footer className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">记录自动保留 24 小时 · 调低并发数不会停止正在运行的任务</footer>
          </aside>
        </>
      ) : null}
    />
  );
}

function SummaryCell({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2">
      {icon}
      <span><strong className="mr-1 text-sm tabular-nums">{value}</strong><span className="text-[11px] text-slate-500">{label}</span></span>
    </div>
  );
}

function TaskGroup({ title, count, action, children }: { title: string; count: number; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 border-y border-slate-200 bg-slate-50/75 px-5 py-2 first:border-t-0">
        <h3 className="text-[11px] font-semibold text-slate-500">{title}</h3>
        <span className="rounded-full bg-slate-200 px-1.5 text-[10px] leading-5 text-slate-600">{count}</span>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}
