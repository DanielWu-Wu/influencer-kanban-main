'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clock3,
  ExternalLink,
  FileClock,
  Inbox,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  Minus,
  MoreHorizontal,
  Paperclip,
  Plus,
  Reply,
  Search,
  Send,
  Settings,
  Sparkles,
  Star,
  Users,
  Youtube,
  X,
} from 'lucide-react';

export type DemoTaskKind = 'gmail_reply' | 'gmail_template' | 'outreach_email';
export type DemoTaskStatus = 'running' | 'queued' | 'completed' | 'failed';

export type DemoTask = {
  id: string;
  kind: DemoTaskKind;
  channelName: string;
  initials: string;
  avatarUrl?: string;
  subject: string;
  runningLabel: string;
  completedLabel: string;
  stage: string;
  createdLabel: string;
  fixedStatus?: 'completed' | 'failed';
  status: DemoTaskStatus;
  queuePosition?: number;
};

const BASE_TASKS: Omit<DemoTask, 'status' | 'queuePosition'>[] = [
  {
    id: 'de-vloggende',
    kind: 'gmail_reply',
    channelName: 'DE VLOGGENDE BESTEMMING',
    initials: 'DV',
    avatarUrl: 'https://i.pravatar.cc/96?img=47',
    subject: 'Re: Vraagje over je camperreizen',
    runningLabel: '回复信生成中',
    completedLabel: '邮件回复已生成',
    stage: '正在生成中文对照',
    createdLabel: '刚刚开始',
  },
  {
    id: 'ginnesost',
    kind: 'outreach_email',
    channelName: 'Ginnesost Brico TV',
    initials: 'GB',
    avatarUrl: 'https://i.pravatar.cc/96?img=12',
    subject: 'Aferiy P210 户外电源合作邀约',
    runningLabel: '开发信生成中',
    completedLabel: '开发信已生成',
    stage: '正在生成外文正文',
    createdLabel: '1 分钟前',
  },
  {
    id: 'morten',
    kind: 'gmail_template',
    channelName: 'Morten Hjorth',
    initials: 'MH',
    avatarUrl: 'https://i.pravatar.cc/96?img=15',
    subject: 'Re: Your Honest Review Style',
    runningLabel: '模板回复生成中',
    completedLabel: '邮件回复已生成',
    stage: '正在套用合作确认模板',
    createdLabel: '2 分钟前',
  },
  {
    id: 'jose-manuel',
    kind: 'outreach_email',
    channelName: 'Jose Manuel Beltran Sanchez',
    initials: 'JM',
    avatarUrl: 'https://i.pravatar.cc/96?img=11',
    subject: 'Invitacion para probar nuevos paneles solares',
    runningLabel: '开发信生成中',
    completedLabel: '开发信已生成',
    stage: '正在整理频道资料',
    createdLabel: '3 分钟前',
  },
  {
    id: 'oleksandr',
    kind: 'gmail_reply',
    channelName: 'Oleksandr Petryaev',
    initials: 'OP',
    avatarUrl: 'https://i.pravatar.cc/96?img=33',
    subject: 'Re: Aferiy Nomad 1800 Pro',
    runningLabel: '回复信生成中',
    completedLabel: '邮件回复已生成',
    stage: '等待任务位置',
    createdLabel: '4 分钟前',
  },
  {
    id: 'dimtry',
    kind: 'outreach_email',
    channelName: 'Dmitry Berfbaer',
    initials: 'DB',
    subject: 'Product review collaboration',
    runningLabel: '开发信生成中',
    completedLabel: '开发信已生成',
    stage: '已生成，等待审核',
    createdLabel: '12 分钟前',
    fixedStatus: 'completed',
  },
  {
    id: 'ihrovyh',
    kind: 'gmail_template',
    channelName: 'Ihrovyh',
    initials: 'IH',
    subject: 'Re: Idea for a video',
    runningLabel: '模板回复生成中',
    completedLabel: '邮件回复已生成',
    stage: '模型服务暂时繁忙',
    createdLabel: '18 分钟前',
    fixedStatus: 'failed',
  },
];

export function usePrototypeTasks(variantKey: string) {
  const [concurrency, setConcurrencyState] = useState(2);
  const [completedIds, setCompletedIds] = useState(() => new Set<string>());
  const [hiddenIds, setHiddenIds] = useState(() => new Set<string>());
  const [destination, setDestination] = useState<DemoTask | null>(null);
  const [notificationTask, setNotificationTask] = useState<DemoTask | null>(null);

  const tasks = useMemo(() => {
    const runnable = BASE_TASKS.filter((task) => (
      !task.fixedStatus && !completedIds.has(task.id) && !hiddenIds.has(task.id)
    ));
    const runningIds = new Set(runnable.slice(0, concurrency).map((task) => task.id));
    const queuePositions = new Map(
      runnable.slice(concurrency).map((task, index) => [task.id, index + 1]),
    );

    return BASE_TASKS.flatMap((task) => {
      if (hiddenIds.has(task.id)) return [];
      const status: DemoTaskStatus = completedIds.has(task.id)
        ? 'completed'
        : task.fixedStatus || (runningIds.has(task.id) ? 'running' : 'queued');
      return [{
        ...task,
        status,
        queuePosition: status === 'queued' ? queuePositions.get(task.id) : undefined,
      }];
    });
  }, [completedIds, concurrency, hiddenIds]);

  const openTask = (task: DemoTask) => {
    setDestination(task);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const task = BASE_TASKS[0];
      setCompletedIds((current) => new Set([...current, task.id]));
      setNotificationTask({ ...task, status: 'completed' });
    }, 4200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [variantKey]);

  const setConcurrency = (value: number) => {
    setConcurrencyState(Math.max(2, Math.min(10, Math.round(value))));
  };

  const clearCompleted = () => {
    setHiddenIds((current) => new Set([
      ...current,
      ...tasks.filter((task) => task.status === 'completed').map((task) => task.id),
    ]));
  };

  const counts = {
    running: tasks.filter((task) => task.status === 'running').length,
    queued: tasks.filter((task) => task.status === 'queued').length,
    completed: tasks.filter((task) => task.status === 'completed').length,
    failed: tasks.filter((task) => task.status === 'failed').length,
  };

  return {
    tasks,
    counts,
    concurrency,
    destination,
    notificationTask,
    setDestination,
    setConcurrency,
    openTask,
    clearCompleted,
    dismissNotification: () => setNotificationTask(null),
    openNotification: () => {
      if (!notificationTask) return;
      setDestination(notificationTask);
      setNotificationTask(null);
    },
  };
}

export function PrototypeCompletionNotification({
  task,
  onOpen,
  onDismiss,
}: {
  task: DemoTask | null;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  if (!task) return null;
  return (
    <div role="status" className="fixed left-1/2 top-4 z-[2147483000] flex w-[min(390px,calc(100%-32px))] -translate-x-1/2 items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-[0_14px_38px_rgba(15,23,42,0.18)]">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
        <Check className="size-4" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-medium">
        <span className="block truncate">{task.channelName} 的邮件回复已生成</span>
      </span>
      <button type="button" className="h-8 shrink-0 rounded-md bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-700" onClick={onOpen}>打开</button>
      <button type="button" aria-label="关闭提醒" title="关闭提醒" className="flex size-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onDismiss}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function TaskAvatar({ task, size = 'md' }: { task: DemoTask; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'sm' ? 'size-8 text-[10px]' : size === 'lg' ? 'size-11 text-xs' : 'size-9 text-[11px]';
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100 font-semibold text-slate-600 ${sizeClass}`}>
      <span>{task.initials}</span>
      {task.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={task.avatarUrl} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
    </span>
  );
}

export function statusLabel(task: DemoTask) {
  if (task.status === 'running') return task.runningLabel;
  if (task.status === 'queued') return `排队中 · 第 ${task.queuePosition} 位`;
  if (task.status === 'completed') return task.completedLabel;
  return '生成失败';
}

export function StatusIcon({ status }: { status: DemoTaskStatus }) {
  if (status === 'running') return <LoaderCircle className="size-4 animate-spin text-blue-600" />;
  if (status === 'queued') return <Clock3 className="size-4 text-amber-600" />;
  if (status === 'completed') return <Check className="size-4 text-emerald-600" />;
  return <AlertCircle className="size-4 text-red-600" />;
}

export function ConcurrencyStepper({
  value,
  onChange,
  compact = false,
}: {
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
      {!compact ? <span className="text-xs text-slate-500">同时执行</span> : null}
      <div className="flex h-8 items-center overflow-hidden rounded-md border border-slate-200 bg-white">
        <button
          type="button"
          aria-label="减少同时执行任务数"
          title="减少同时执行任务数"
          className="flex size-8 items-center justify-center text-slate-500 transition-colors duration-150 ease-out hover:bg-slate-50 disabled:opacity-35"
          disabled={value <= 2}
          onClick={() => onChange(value - 1)}
        >
          <Minus className="size-3.5" />
        </button>
        <span className="flex h-full min-w-8 items-center justify-center border-x border-slate-200 px-2 text-xs font-semibold tabular-nums text-slate-800">
          {value}
        </span>
        <button
          type="button"
          aria-label="增加同时执行任务数"
          title="增加同时执行任务数"
          className="flex size-8 items-center justify-center text-slate-500 transition-colors duration-150 ease-out hover:bg-slate-50 disabled:opacity-35"
          disabled={value >= 10}
          onClick={() => onChange(value + 1)}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {!compact ? <span className="text-xs text-slate-400">上限 10</span> : null}
    </div>
  );
}

export function DenseTaskRow({ task, onOpen }: { task: DemoTask; onOpen: (task: DemoTask) => void }) {
  const statusColor = task.status === 'completed'
    ? 'text-emerald-700'
    : task.status === 'failed'
      ? 'text-red-700'
      : task.status === 'queued'
        ? 'text-amber-700'
        : 'text-blue-700';

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className="group flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors duration-150 ease-out last:border-b-0 hover:bg-slate-50/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/35"
    >
      <TaskAvatar task={task} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-900">{task.channelName}</span>
        <span className={`mt-0.5 flex items-center gap-1.5 text-xs font-medium ${statusColor}`}>
          <StatusIcon status={task.status} />
          <span className="truncate">{statusLabel(task)}</span>
        </span>
        <span className="mt-1 block truncate text-[11px] text-slate-500">{task.stage}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-300 transition-transform duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-slate-500" />
    </button>
  );
}

export function PrototypeWorkspace({
  entry,
  overlay,
  notification,
  destination,
  onBack,
}: {
  entry: ReactNode;
  overlay?: ReactNode;
  notification?: ReactNode;
  destination: DemoTask | null;
  onBack: () => void;
}) {
  return (
    <div className="h-dvh overflow-hidden bg-[#f3f7fb] text-slate-900">
      <header className="relative z-40 flex h-[60px] items-center justify-between border-b border-white/80 bg-[#f7fbff]/90 px-4 shadow-[0_8px_24px_rgba(38,67,105,0.05)] backdrop-blur-xl md:px-5">
        <div className="flex items-center gap-2.5">
          <button type="button" aria-label="打开导航" className="flex size-9 items-center justify-center rounded-md text-slate-600 md:hidden">
            <Menu className="size-5" />
          </button>
          <span className="flex size-9 items-center justify-center rounded-lg bg-blue-600 text-white shadow-[0_6px_16px_rgba(37,99,235,0.22)]">
            <Sparkles className="size-4" />
          </span>
          <span className="hidden sm:block">
            <span className="block text-base font-semibold leading-none">红人推广</span>
            <span className="mt-1 block text-[10px] text-slate-500">Influencer Ops</span>
          </span>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          {entry}
          <button type="button" className="hidden h-9 items-center gap-2 rounded-lg border border-white bg-white/75 px-3 text-sm font-medium text-blue-700 shadow-sm md:flex">
            <CheckSquare className="size-4" />
            1 每日待办
          </button>
          <div className="hidden h-9 items-center gap-2 border-l border-slate-200 pl-3 md:flex">
            <span className="max-w-40 truncate text-xs text-slate-500">332316207@qq.com</span>
            <button type="button" aria-label="退出登录" title="退出登录" className="flex size-8 items-center justify-center rounded-md text-slate-600 hover:bg-white">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100dvh-60px)] gap-3 p-3">
        <aside className="hidden w-56 shrink-0 rounded-xl border border-white/80 bg-white/60 p-3 shadow-[0_12px_28px_rgba(38,67,105,0.06)] backdrop-blur-xl md:block">
          <div className="rounded-lg bg-white/65 p-3">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600">
              <span>今日作战台</span>
              <ChevronDown className="size-4" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div><span className="block text-xs text-slate-500">待办</span><strong className="text-lg">1</strong></div>
              <div><span className="block text-xs text-slate-500">Gmail</span><strong className="text-lg">0</strong></div>
            </div>
          </div>
          <p className="mb-2 mt-4 px-2 text-[11px] font-semibold text-slate-500">每日工作</p>
          <MockNavItem icon={<CheckSquare />} label="每日待办" />
          <MockNavItem icon={<Clock3 />} label="工作日历" />
          <MockNavItem icon={<Users />} label="红人开发台" active={destination?.kind === 'outreach_email'} />
          <MockNavItem icon={<Inbox />} label="Gmail 邮件" active={!destination || destination.kind !== 'outreach_email'} />
          <div className="my-3 border-t border-slate-200" />
          <p className="mb-2 px-2 text-[11px] font-semibold text-slate-500">工具</p>
          <MockNavItem icon={<Settings />} label="设置" />
          <MockNavItem icon={<Bot />} label="AI 系统功能提示词" />
        </aside>

        <main className="min-w-0 flex-1 overflow-hidden rounded-xl border border-white/80 bg-white/55 shadow-[0_12px_30px_rgba(38,67,105,0.06)]">
          {destination?.kind === 'outreach_email' ? (
            <OutreachDestination task={destination} onBack={onBack} />
          ) : destination ? (
            <GmailReplyDestination task={destination} onBack={onBack} />
          ) : (
            <GmailWorkspaceScene />
          )}
        </main>
      </div>
      {overlay}
      {notification}
    </div>
  );
}

function MockNavItem({ icon, label, active = false }: { icon: ReactNode; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      className={`mb-1 flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm ${active ? 'bg-blue-100/85 text-blue-700' : 'text-slate-600 hover:bg-white/70'}`}
    >
      <span className="[&>svg]:size-4">{icon}</span>
      {label}
    </button>
  );
}

function GmailWorkspaceScene() {
  const threads = [
    ['DE VLOGGENDE BESTEMMING', 'Re: Vraagje over je camperreizen en energie aan boord', 'Hi Daniel, Thank you so much for your reply.'],
    ['Ginnesost Brico TV', 'Re: Aferiy PN062: la bateria domestica', 'Hola Daniel Me parece muy bien este nuevo producto.'],
    ['Morten Hjorth', 'Re: Your Honest Review Style Meets the Aferiy P210', 'Hi Daniel Good Power Station, powers a car.'],
    ['Dmitry Berfbaer', 'Re: Product review collaboration', 'Thanks for reaching out about the new product.'],
    ['Ihrovyh', 'Re: Idea for a video: test Aferiy Nomad 1800 Pro', 'I am interested in hearing more details.'],
  ];
  return (
    <div className="grid h-full min-w-0 grid-cols-[165px_minmax(260px,410px)_minmax(420px,1fr)] max-xl:grid-cols-[150px_330px_minmax(380px,1fr)] max-lg:grid-cols-[135px_290px_minmax(340px,1fr)] max-md:grid-cols-1">
      <section className="hidden border-r border-slate-200 bg-white/60 p-3 lg:block">
        <div className="mb-4 flex items-center gap-2 text-sm font-semibold"><Mail className="size-4 text-red-500" /> Gmail</div>
        <button type="button" className="mb-3 flex h-11 w-full items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white"><Send className="size-4" />写信</button>
        {['收件箱', '未读邮件', '已标星', '已发送', '草稿'].map((label, index) => (
          <button key={label} type="button" className={`mb-1 flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm ${index === 0 ? 'bg-blue-100 text-blue-700' : 'text-slate-700'}`}>
            {index === 2 ? <Star className="size-4" /> : index === 3 ? <Send className="size-4" /> : <Inbox className="size-4" />}{label}
          </button>
        ))}
      </section>
      <section className="hidden min-w-0 border-r border-slate-200 bg-white/65 md:block">
        <div className="border-b border-slate-200 p-3">
          <div className="flex items-center justify-between"><strong>收件箱</strong><span className="text-xs text-slate-500">8 未读</span></div>
          <div className="relative mt-3"><Search className="absolute left-3 top-2.5 size-4 text-slate-400" /><input readOnly placeholder="搜索整个 Gmail" className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 text-sm" /></div>
        </div>
        {threads.map((thread, index) => (
          <div key={thread[0]} className={`flex gap-3 border-b border-slate-100 px-3 py-3 ${index === 0 ? 'border-l-2 border-l-blue-600 bg-blue-50/80' : 'bg-white/50'}`}>
            <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold">{thread[0].slice(0, 1)}</span>
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{thread[0]}</span><span className="block truncate text-sm">{thread[1]}</span><span className="block truncate text-xs text-slate-500">{thread[2]}</span></span>
          </div>
        ))}
      </section>
      <section className="min-w-0 overflow-y-auto bg-[#fbfcfe] p-4">
        <div className="flex items-center gap-3 border-b border-slate-200 pb-4"><ArrowLeft className="size-4" /><h2 className="min-w-0 flex-1 truncate text-lg font-semibold">Re: Vraagje over je camperreizen en energie aan boord</h2><MoreHorizontal className="size-5" /></div>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <span className="flex size-10 items-center justify-center rounded-full bg-fuchsia-100 font-semibold text-fuchsia-700">DV</span>
          <div className="min-w-0 flex-1"><strong className="block truncate">DE VLOGGENDE BESTEMMING</strong><span className="text-xs text-slate-500">荷兰 · YouTube · info@devloggendebestemming.nl</span></div><ExternalLink className="size-4 text-blue-600" />
        </div>
        <MockMessage name="Daniel Wu" meta="2026年8月14日 23:34 · 发给 info" active />
        <MockMessage name="DE VLOGGENDE BESTEMMING" meta="2026年8月14日 22:49 · 发给 Daniel Wu" />
        <MockMessage name="Daniel Wu" meta="2026年8月13日 09:45 · 发给 info" />
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-blue-200 bg-white px-4 py-3 shadow-sm"><Sparkles className="size-4 text-blue-600" /><span className="text-sm font-medium">AI 邮件助手</span><span className="ml-auto text-xs text-slate-500">分析和回复内容已保留</span></div>
      </section>
    </div>
  );
}

function MockMessage({ name, meta, active = false }: { name: string; meta: string; active?: boolean }) {
  return (
    <div className={`mt-3 flex items-center gap-3 rounded-lg border p-4 ${active ? 'border-blue-400 bg-blue-50/70' : 'border-slate-200 bg-white'}`}>
      <span className="flex size-9 items-center justify-center rounded-full bg-blue-100 text-xs text-blue-700">{name.slice(0, 1)}</span>
      <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{name}</strong><span className="block truncate text-xs text-slate-500">{meta}</span></span>
      <Reply className="size-4" /><Mail className="size-4" /><ChevronDown className="size-4" />
    </div>
  );
}

function GmailReplyDestination({ task, onBack }: { task: DemoTask; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col bg-[#fbfcfe]">
      <div className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white/80 px-4">
        <button type="button" onClick={onBack} aria-label="返回邮件列表" className="flex size-8 items-center justify-center rounded-md hover:bg-slate-100"><ArrowLeft className="size-4" /></button>
        <div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{task.subject}</h2><p className="text-xs text-slate-500">已从邮件生成进度准确返回</p></div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4"><TaskAvatar task={task} size="lg" /><div><strong>{task.channelName}</strong><p className="text-xs text-slate-500">原回复对象与收件人已恢复</p></div></div>
        <MockMessage name={task.channelName} meta="最新来信 · 当前回复依据" active />
      </div>
      <div className="h-[52%] min-h-[310px] border-t border-slate-200 bg-white shadow-[0_-8px_24px_rgba(15,23,42,0.07)]">
        <div className="flex h-12 items-center gap-2 border-b border-slate-200 px-4"><Sparkles className="size-4 text-blue-600" /><strong className="text-sm">{task.kind === 'gmail_template' ? 'AI 模板回复' : 'AI 辅助回复'}</strong><span className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">生成完成</span><button type="button" onClick={onBack} className="ml-auto text-xs text-slate-500">收起</button></div>
        <div className="grid h-[calc(100%-48px)] min-h-0 grid-cols-2 max-md:grid-cols-1">
          <div className="min-h-0 overflow-y-auto border-r border-slate-200 p-4"><p className="text-xs font-semibold text-slate-500">外文邮件正文</p><div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 text-sm leading-6">Hi there,<br /><br />Thank you for your thoughtful reply. We are glad the product fits your content style and would love to continue discussing the review details.<br /><br />Best regards,<br />Daniel</div></div>
          <div className="min-h-0 overflow-y-auto p-4"><p className="text-xs font-semibold text-slate-500">中文翻译对照</p><div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6">您好，感谢您的认真回复。我们很高兴这款产品符合您的内容风格，并希望继续讨论测评合作的具体安排。</div><div className="mt-4 flex justify-end gap-2"><button type="button" className="h-9 rounded-md border border-slate-200 px-3 text-sm">继续编辑</button><button type="button" className="h-9 rounded-md bg-blue-600 px-3 text-sm text-white">保存到 Gmail 草稿</button></div></div>
        </div>
      </div>
    </div>
  );
}

function OutreachDestination({ task, onBack }: { task: DemoTask; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col bg-[#f8fafc]">
      <div className="flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4"><button type="button" onClick={onBack} aria-label="返回" className="flex size-8 items-center justify-center rounded-md hover:bg-slate-100"><ArrowLeft className="size-4" /></button><div className="min-w-0 flex-1"><h2 className="font-semibold">红人开发台</h2><p className="text-xs text-slate-500">已定位到“开发信”并展开对应频道</p></div><span className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700">开发信已生成</span></div>
      <div className="flex h-12 items-end gap-6 border-b border-slate-200 bg-white px-5 text-sm"><span className="pb-3 text-slate-500">红人录入</span><span className="pb-3 text-slate-500">邀约确认</span><span className="border-b-2 border-blue-600 pb-3 font-semibold text-blue-700">开发信</span><span className="pb-3 text-slate-500">Follow Up</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-lg border border-blue-300 bg-white shadow-sm">
          <div className="flex items-center gap-3 border-b border-slate-200 bg-blue-50/65 px-4 py-3"><TaskAvatar task={task} size="lg" /><div className="min-w-0 flex-1"><strong className="block truncate">{task.channelName}</strong><span className="text-xs text-slate-500">西班牙 · YouTube · Aferiy P210</span></div><span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">开发信已生成</span><ChevronDown className="size-4" /></div>
          <div className="grid gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="space-y-3 text-sm"><div><p className="text-xs font-semibold text-slate-500">收件邮箱</p><p className="mt-1 rounded-md bg-slate-50 p-2">creator@example.com</p></div><div><p className="text-xs font-semibold text-slate-500">合作想法</p><p className="mt-1 rounded-md bg-slate-50 p-2 leading-5">结合近期户外改造内容，邀请测评便携储能产品。</p></div></aside>
            <section className="space-y-3"><div><label className="text-xs font-semibold text-slate-500">邮件标题</label><div className="mt-1 rounded-md border border-slate-200 p-2 text-sm">{task.subject}</div></div><div><label className="text-xs font-semibold text-slate-500">外文邮件正文</label><div className="mt-1 min-h-32 rounded-md border border-slate-200 p-3 text-sm leading-6">Hola,<br /><br />He estado viendo tus proyectos recientes y me gusto especialmente la forma practica en que explicas cada mejora. Nos encantaria invitarte a probar nuestra nueva estacion de energia portatil.</div></div><div className="flex justify-end gap-2"><button type="button" className="h-9 rounded-md border border-slate-200 px-3 text-sm">编辑内容</button><button type="button" className="h-9 rounded-md bg-blue-600 px-3 text-sm text-white">保存到 Gmail 草稿</button></div></section>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TopbarTaskButton({
  open,
  activeCount,
  onClick,
  compactLabel = false,
}: {
  open: boolean;
  activeCount: number;
  onClick: () => void;
  compactLabel?: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label="邮件生成进度"
      onClick={onClick}
      className={`relative flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium shadow-sm transition-[background-color,border-color,transform] duration-150 ease-out active:scale-[0.985] ${open ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-white bg-white/75 text-slate-700 hover:bg-white'}`}
    >
      {activeCount > 0 ? <LoaderCircle className="size-4 animate-spin text-blue-600" /> : <FileClock className="size-4" />}
      <span className={compactLabel ? 'hidden xl:inline' : 'hidden lg:inline'}>邮件生成进度</span>
      {activeCount > 0 ? <span className="flex min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] leading-5 text-white">{activeCount}</span> : null}
    </button>
  );
}

export function TaskKindIcon({ kind }: { kind: DemoTaskKind }) {
  if (kind === 'outreach_email') return <Youtube className="size-4" />;
  if (kind === 'gmail_template') return <Sparkles className="size-4" />;
  return <Reply className="size-4" />;
}

export function TaskSubject({ task }: { task: DemoTask }) {
  return <span className="block truncate text-[11px] text-slate-500">{task.subject}</span>;
}

export function PaperclipDecoration() {
  return <Paperclip className="size-4 text-slate-400" />;
}

export function CircleUserDecoration() {
  return <CircleUserRound className="size-4 text-slate-400" />;
}
