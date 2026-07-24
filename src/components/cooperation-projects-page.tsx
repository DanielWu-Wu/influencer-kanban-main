'use client';

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  LayoutGrid,
  Link2,
  List,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CooperationEmailActions } from '@/components/cooperation-email-actions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSettings } from '@/lib/data';
import {
  loadCreatorResourceProfiles,
  matchCreatorResourceProfiles,
} from '@/lib/creator-resource-profile';
import { fetchFeishuRecordsCached } from '@/lib/feishu-record-cache';
import {
  COOPERATION_STAGE_META,
  COOPERATION_STAGES,
  formatCooperationDate,
  formatStageDuration,
  mapFeishuCooperationRecord,
  type CooperationProject,
  type CooperationStage,
} from '@/lib/cooperation-projects';
import {
  buildChannelAvatarLookup,
  resolveChannelAvatars,
} from '@/lib/youtube-channel-avatar';

type ProjectsView = 'list' | 'board' | 'calendar';
type RiskFilter = 'all' | 'risk' | 'overdue' | 'normal';

type CalendarProjectEvent = {
  id: string;
  project: CooperationProject;
  date: number;
  label: string;
  colorClass: string;
};

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const EMPTY_FEISHU_MAPPING = {};

function uniqueValues(values: string[], ignoredValue?: string) {
  return Array.from(new Set(values.filter((value) => value && value !== ignoredValue)))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

function openExternal(url: string) {
  if (url) window.open(url, '_blank', 'noopener,noreferrer');
}

function StageBadge({ stage }: { stage: CooperationStage }) {
  const meta = COOPERATION_STAGE_META[stage];
  return (
    <Badge
      variant="outline"
      className={`h-6 whitespace-nowrap rounded-md px-2 text-[11px] font-medium ${meta.colorClass}`}
    >
      {meta.label}
    </Badge>
  );
}

function RiskSummary({ project }: { project: CooperationProject }) {
  if (project.risks.length === 0) {
    return <span className="text-xs text-emerald-700">正常</span>;
  }
  const primary = project.risks[0];
  const color = primary.level === 'overdue'
    ? 'text-red-600'
    : primary.level === 'error'
      ? 'text-rose-600'
      : 'text-amber-700';
  return (
    <span className={`inline-flex max-w-40 items-center gap-1 text-xs font-medium ${color}`}>
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{primary.label}</span>
      {project.risks.length > 1 ? `+${project.risks.length - 1}` : ''}
    </span>
  );
}

function ProjectAvatar({ project, compact = false, tiny = false }: {
  project: CooperationProject;
  compact?: boolean;
  tiny?: boolean;
}) {
  const initials = project.channelName.trim().slice(0, 2).toUpperCase() || '红';
  return (
    <Avatar className={`${tiny ? 'size-4 text-[0]' : compact ? 'size-8 text-[11px]' : 'size-9 text-xs'} ring-1 ring-blue-100`}>
      {project.avatarUrl ? (
        <AvatarImage src={project.avatarUrl} alt={`${project.channelName} 频道头像`} className="object-cover" />
      ) : null}
      <AvatarFallback className="bg-blue-50 font-semibold text-blue-700">{initials}</AvatarFallback>
    </Avatar>
  );
}

function ProjectIdentity({ project, compact = false }: {
  project: CooperationProject;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <ProjectAvatar project={project} compact={compact} />
      <div className="min-w-0">
        <button
          type="button"
          disabled={!project.channelUrl}
          onClick={(event) => {
            event.stopPropagation();
            openExternal(project.channelUrl);
          }}
          className="block max-w-full truncate text-left text-sm font-semibold text-slate-900 hover:text-blue-600 disabled:cursor-default disabled:hover:text-slate-900"
          title={project.channelName}
        >
          {project.channelName}
        </button>
        <p className="truncate text-[11px] text-slate-500">
          {project.platform} · {project.region}
        </p>
      </div>
    </div>
  );
}

function StatStrip({ projects }: { projects: CooperationProject[] }) {
  const counts = Object.fromEntries(COOPERATION_STAGES.map((stage) => [stage, 0])) as Record<CooperationStage, number>;
  projects.forEach((project) => { counts[project.stage] += 1; });
  const riskCount = projects.filter((project) => project.risks.length > 0).length;
  return (
    <div className="overflow-x-auto border-y border-slate-200 bg-slate-50/60">
      <div className="grid min-w-[920px] grid-cols-9">
        <div className="border-r border-slate-200 px-4 py-3 text-center">
          <p className="text-[11px] text-blue-600">全部</p>
          <p className="mt-0.5 text-xl font-semibold text-blue-700">{projects.length}</p>
        </div>
        {COOPERATION_STAGES.map((stage) => (
          <div key={stage} className="border-r border-slate-200 px-3 py-3 text-center last:border-r-0">
            <p className="whitespace-nowrap text-[11px] text-slate-500">{COOPERATION_STAGE_META[stage].label}</p>
            <p className={`mt-0.5 text-lg font-semibold ${stage === 'published' ? 'text-emerald-700' : 'text-slate-900'}`}>
              {counts[stage]}
            </p>
          </div>
        ))}
        <div className="px-3 py-3 text-center">
          <p className="text-[11px] text-slate-500">异常/逾期</p>
          <p className={`mt-0.5 text-lg font-semibold ${riskCount ? 'text-amber-700' : 'text-slate-900'}`}>
            {riskCount}
          </p>
        </div>
      </div>
    </div>
  );
}

function ViewSwitcher({ value, onChange }: {
  value: ProjectsView;
  onChange: (value: ProjectsView) => void;
}) {
  const items: Array<{ value: ProjectsView; label: string; icon: typeof List }> = [
    { value: 'list', label: '列表', icon: List },
    { value: 'board', label: '看板', icon: LayoutGrid },
    { value: 'calendar', label: '日历', icon: CalendarDays },
  ];
  return (
    <div className="inline-flex h-9 shrink-0 items-center rounded-md border border-slate-200 bg-white p-0.5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={`inline-flex h-8 items-center gap-1.5 rounded px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              value === item.value ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function ProjectsTable({ projects, selectedId, onSelect }: {
  projects: CooperationProject[];
  selectedId?: string;
  onSelect: (project: CooperationProject) => void;
}) {
  return (
    <div className="h-full overflow-auto bg-white">
      <Table className="min-w-[1020px]">
        <TableHeader className="sticky top-0 z-10 bg-slate-50">
          <TableRow className="border-slate-200 hover:bg-slate-50">
            <TableHead className="w-[210px] text-xs font-medium text-slate-600">红人</TableHead>
            <TableHead className="w-[190px] text-xs font-medium text-slate-600">合作项目</TableHead>
            <TableHead className="w-[135px] text-xs font-medium text-slate-600">当前进度</TableHead>
            <TableHead className="w-[112px] text-xs font-medium text-slate-600">阶段时间</TableHead>
            <TableHead className="w-[180px] text-xs font-medium text-slate-600">下一步</TableHead>
            <TableHead className="w-[105px] text-xs font-medium text-slate-600">预计上线</TableHead>
            <TableHead className="w-[150px] text-xs font-medium text-slate-600">风险</TableHead>
            <TableHead className="w-[80px] text-right text-xs font-medium text-slate-600">链接</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.map((project) => (
            <TableRow
              key={project.id}
              tabIndex={0}
              aria-selected={selectedId === project.id}
              onClick={() => onSelect(project)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') onSelect(project);
              }}
              className={`cursor-pointer border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                selectedId === project.id ? 'bg-blue-50/70 hover:bg-blue-50' : 'hover:bg-slate-50'
              }`}
            >
              <TableCell><ProjectIdentity project={project} compact /></TableCell>
              <TableCell>
                <p className="max-w-[180px] truncate text-sm font-medium text-slate-800" title={project.product}>{project.product}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">{project.site}</p>
              </TableCell>
              <TableCell>
                <StageBadge stage={project.stage} />
                <p className="mt-1 text-[10px] text-slate-400">自动判断</p>
              </TableCell>
              <TableCell>
                <p className="text-xs text-slate-700">{formatCooperationDate(project.stageDate)}</p>
                <p className="mt-1 text-[10px] text-slate-400">{formatStageDuration(project.stageDate)}</p>
              </TableCell>
              <TableCell className="text-xs text-slate-700">{project.nextAction}</TableCell>
              <TableCell>
                <p className="text-xs text-slate-700">{formatCooperationDate(project.expectedPublishDate)}</p>
              </TableCell>
              <TableCell><RiskSummary project={project} /></TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  {project.channelUrl ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="打开频道"
                      className="h-8 w-8 text-blue-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        openExternal(project.channelUrl);
                      }}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  ) : null}
                  {project.publishedVideoUrl ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="打开视频"
                      className="h-8 w-8 text-blue-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        openExternal(project.publishedVideoUrl);
                      }}
                    >
                      <Link2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ProjectsBoard({ projects, onSelect }: {
  projects: CooperationProject[];
  onSelect: (project: CooperationProject) => void;
}) {
  return (
    <div className="h-full overflow-x-auto overflow-y-hidden bg-slate-50 p-3">
      <div className="flex h-full min-w-max gap-3">
        {COOPERATION_STAGES.map((stage) => {
          const stageProjects = projects.filter((project) => project.stage === stage);
          const meta = COOPERATION_STAGE_META[stage];
          return (
            <section key={stage} className="flex h-full w-[255px] flex-col overflow-hidden rounded-md border border-slate-200 bg-white">
              <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200 px-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${meta.dotClass}`} />
                  <h3 className="text-xs font-semibold text-slate-800">{meta.label}</h3>
                </div>
                <span className="text-xs font-medium text-slate-500">{stageProjects.length}</span>
              </header>
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                {stageProjects.length ? stageProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => onSelect(project)}
                    className="block w-full rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <ProjectIdentity project={project} compact />
                    <div className="mt-3 border-t border-slate-100 pt-2">
                      <p className="truncate text-xs font-medium text-slate-800">{project.product}</p>
                      <p className="mt-2 text-right text-[11px] text-slate-500">{formatStageDuration(project.stageDate)}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500">预计 {formatCooperationDate(project.expectedPublishDate)}</span>
                        {project.risks.length ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> : null}
                      </div>
                    </div>
                  </button>
                )) : (
                  <div className="flex h-28 items-center justify-center text-xs text-slate-400">暂无项目</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function buildCalendarEvents(projects: CooperationProject[]) {
  return projects.flatMap<CalendarProjectEvent>((project) => {
    const candidates: Array<Omit<CalendarProjectEvent, 'id' | 'project'> & { key: string }> = [
      { key: 'confirmed', date: project.cooperationDate || 0, label: '确认合作', colorClass: 'bg-emerald-50 text-emerald-700' },
      { key: 'shipping', date: project.shippingDate || 0, label: '发货', colorClass: 'bg-sky-50 text-sky-700' },
      { key: 'arrival', date: project.arrivalDate || 0, label: '到货', colorClass: 'bg-cyan-50 text-cyan-700' },
      { key: 'filming-complete', date: project.filmingCompleteDate || 0, label: '拍摄完成', colorClass: 'bg-violet-50 text-violet-700' },
      { key: 'expected', date: project.expectedPublishDate || 0, label: '预计上线', colorClass: 'bg-amber-50 text-amber-700' },
      { key: 'published', date: project.actualPublishDate || 0, label: '实际上线', colorClass: 'bg-green-50 text-green-700' },
    ];
    return candidates
      .filter((event) => event.date > 0)
      .map((event) => ({
        id: `${project.id}-${event.key}`,
        project,
        date: event.date,
        label: event.label,
        colorClass: event.colorClass,
      }));
  });
}

function ProjectsCalendar({ projects, month, onMonthChange, onSelect }: {
  projects: CooperationProject[];
  month: Date;
  onMonthChange: (month: Date) => void;
  onSelect: (project: CooperationProject) => void;
}) {
  const events = useMemo(() => buildCalendarEvents(projects), [projects]);
  const monthStart = startOfMonth(month);
  const days = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  });
  return (
    <div className="flex h-full min-w-[780px] flex-col overflow-hidden bg-white">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={() => onMonthChange(new Date())}>今天</Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="上个月" onClick={() => onMonthChange(subMonths(month, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="下个月" onClick={() => onMonthChange(addMonths(month, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h3 className="ml-1 text-sm font-semibold text-slate-900">{format(month, 'yyyy 年 M 月', { locale: zhCN })}</h3>
        </div>
        <p className="text-xs text-slate-500">共 {events.filter((event) => isSameMonth(new Date(event.date), month)).length} 个里程碑</p>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {WEEKDAYS.map((weekday) => <div key={weekday} className="px-2 py-2 text-center text-[11px] font-medium text-slate-500">{weekday}</div>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 auto-rows-fr overflow-auto">
        {days.map((day) => {
          const dayEvents = events.filter((event) => isSameDay(new Date(event.date), day));
          return (
            <div key={day.toISOString()} className={`min-h-[96px] border-b border-r border-slate-200 p-1.5 ${isSameMonth(day, month) ? 'bg-white' : 'bg-slate-50/70'}`}>
              <div className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${isSameDay(day, new Date()) ? 'bg-blue-600 font-semibold text-white' : isSameMonth(day, month) ? 'text-slate-700' : 'text-slate-400'}`}>
                {format(day, 'd')}
              </div>
              <div className="space-y-1">
                {dayEvents.slice(0, 2).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onSelect(event.project)}
                    className={`block w-full truncate rounded px-1.5 py-1 text-left text-[10px] font-medium hover:ring-1 hover:ring-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${event.colorClass}`}
                    title={`${event.label} · ${event.project.channelName}`}
                  >
                    <span className="flex min-w-0 items-center gap-1">
                      <ProjectAvatar project={event.project} tiny />
                      <span className="truncate">{event.label} · {event.project.channelName}</span>
                    </span>
                  </button>
                ))}
                {dayEvents.length > 2 ? <p className="px-1 text-[10px] text-slate-500">还有 {dayEvents.length - 2} 项</p> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 py-1.5 text-xs">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-words text-slate-800">{value || '未记录'}</dd>
    </div>
  );
}

function ReadonlyCheck({ checked, label }: { checked: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs text-slate-700">
      <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>
        {checked ? <Check className="h-3 w-3" /> : null}
      </span>
      {label}
    </div>
  );
}

function ProjectDetail({ project, settings, feishuUrl, onProjectUpdated, onClose }: {
  project: CooperationProject;
  settings: ReturnType<typeof useSettings>['settings'];
  feishuUrl: string;
  onProjectUpdated: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex shrink-0 items-start justify-between border-b border-slate-200 px-4 py-4">
        <ProjectIdentity project={project} />
        <div className="ml-3 flex items-center gap-2">
          <StageBadge stage={project.stage} />
          <Button variant="ghost" size="icon" className="h-8 w-8" title="关闭详情" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4">
        <section className="border-b border-slate-200 py-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">合作概况</h3>
          <dl>
            <DetailValue label="合作产品" value={project.product} />
            <DetailValue label="联系邮箱" value={project.email} />
            <DetailValue label="合作站点" value={project.site} />
            <DetailValue label="合作类型" value={project.cooperationType} />
            <DetailValue label="合作费用" value={project.originalCurrencyCost} />
            <DetailValue label="人民币费用" value={project.cnyCost} />
          </dl>
        </section>

        <section className="border-b border-slate-200 py-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">合作进度</h3>
          <div className="relative">
            {project.milestones.map((milestone, index) => {
              const isDone = milestone.state === 'complete';
              const isCurrent = milestone.state === 'current';
              const isSkipped = milestone.state === 'skipped';
              return (
                <div key={milestone.stage} className="relative flex min-h-11 gap-3">
                  {index < project.milestones.length - 1 ? (
                    <span className={`absolute left-[7px] top-4 h-[calc(100%-4px)] w-px ${isDone ? 'bg-emerald-300' : 'bg-slate-200'}`} />
                  ) : null}
                  <span className={`relative z-10 mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
                    isDone ? 'border-emerald-600 bg-emerald-600 text-white'
                      : isCurrent ? 'border-blue-600 bg-white'
                        : isSkipped ? 'border-slate-200 bg-slate-100'
                          : 'border-slate-300 bg-white'
                  }`}>
                    {isDone ? <Check className="h-2.5 w-2.5" /> : isCurrent ? <span className="h-1.5 w-1.5 rounded-full bg-blue-600" /> : null}
                  </span>
                  <div className="flex min-w-0 flex-1 justify-between gap-3 pb-3">
                    <div>
                      <p className={`text-xs font-medium ${isCurrent ? 'text-blue-700' : isSkipped ? 'text-slate-400' : 'text-slate-700'}`}>{milestone.label}</p>
                      {milestone.note ? <p className="mt-0.5 text-[10px] text-slate-400">{milestone.note}</p> : null}
                    </div>
                    <p className="shrink-0 text-[11px] text-slate-500">
                      {milestone.date ? formatCooperationDate(milestone.date) : isSkipped ? '不适用' : '—'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-b border-slate-200 py-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">关键事项</h3>
          <ReadonlyCheck checked={project.logisticsNotified} label="物流信息已告知" />
          <ReadonlyCheck checked={project.discountNotified} label="折扣信息已告知" />
          <dl className="mt-1">
            <DetailValue label="发货时间" value={formatCooperationDate(project.shippingDate)} />
            <DetailValue label="到货时间" value={formatCooperationDate(project.arrivalDate)} />
            <DetailValue label="拍摄完成" value={formatCooperationDate(project.filmingCompleteDate)} />
            <DetailValue label="实际上线" value={formatCooperationDate(project.actualPublishDate)} />
          </dl>
        </section>

        <section className="border-b border-slate-200 py-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">物流与发布</h3>
          <dl>
            <DetailValue label="物流信息" value={project.shippingTracking} />
            <DetailValue label="折扣信息" value={project.discountCode} />
            <DetailValue label="发货地址" value={project.shippingAddress} />
            <DetailValue label="预计上线" value={formatCooperationDate(project.expectedPublishDate)} />
            <DetailValue label="视频链接" value={project.publishedVideoUrl} />
          </dl>
        </section>

        <CooperationEmailActions
          project={project}
          settings={settings}
          onProjectUpdated={onProjectUpdated}
        />

        <section className="py-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">下一步与风险</h3>
          <div className="rounded-md bg-blue-50 px-3 py-2 text-xs font-medium text-blue-800">{project.nextAction}</div>
          {project.risks.length ? (
            <div className="mt-2 space-y-1.5">
              {project.risks.map((risk) => (
                <div key={risk.code} className={`flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                  risk.level === 'overdue' ? 'bg-red-50 text-red-700' : risk.level === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'
                }`}>
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {risk.label}
                </div>
              ))}
            </div>
          ) : <p className="mt-2 text-xs text-emerald-700">当前没有发现异常。</p>}
        </section>
      </div>
      <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-slate-200 p-3">
        <Button variant="outline" size="sm" disabled={!project.channelUrl} onClick={() => openExternal(project.channelUrl)}>
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />打开频道
        </Button>
        <Button variant="outline" size="sm" onClick={() => openExternal(feishuUrl)}>
          <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />打开飞书记录
        </Button>
      </footer>
    </div>
  );
}

function EmptyState({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex h-full items-center justify-center bg-white p-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
          <FileSpreadsheet className="h-6 w-6" />
        </div>
        <h2 className="mt-4 text-base font-semibold text-slate-900">连接详细合作记录表</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">请先在设置中保存“详细合作记录表”的飞书网址和字段映射。</p>
        <Button className="mt-4" onClick={onOpenSettings}>
          <Settings className="mr-2 h-4 w-4" />前往设置
        </Button>
      </div>
    </div>
  );
}

export function CooperationProjectsPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { settings, loading: settingsLoading } = useSettings();
  const url = settings.feishuCooperationUrl?.trim() || '';
  const mapping = settings.feishuCooperationFieldMapping || EMPTY_FEISHU_MAPPING;
  const [records, setRecords] = useState<Awaited<ReturnType<typeof fetchFeishuRecordsCached>>>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number>();
  const [view, setView] = useState<ProjectsView>('list');
  const [selectedProject, setSelectedProject] = useState<CooperationProject>();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [stageFilter, setStageFilter] = useState<CooperationStage | 'all'>('all');
  const [productFilter, setProductFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [avatarByProjectId, setAvatarByProjectId] = useState<Record<string, string>>({});

  const loadRecords = useCallback(async (force = false) => {
    if (!url) {
      setRecords([]);
      setLoading(false);
      return;
    }
    if (force) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const nextRecords = await fetchFeishuRecordsCached(url, { force });
      setRecords(nextRecords);
      setUpdatedAt(Date.now());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取详细合作记录表失败。');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [url]);
  const refreshProjects = useCallback(() => loadRecords(true), [loadRecords]);

  useEffect(() => {
    if (settingsLoading) return;
    void loadRecords(false);
  }, [loadRecords, settingsLoading]);

  const baseProjects = useMemo(
    () => records
      .filter((record) => Object.keys(record.fields).length > 0)
      .map((record) => mapFeishuCooperationRecord(record, mapping)),
    [mapping, records],
  );

  useEffect(() => {
    if (!baseProjects.length) {
      setAvatarByProjectId({});
      return;
    }
    let cancelled = false;

    const enrichAvatars = async () => {
      const resourceProfiles = await loadCreatorResourceProfiles(settings).catch(() => []);
      if (cancelled) return;
      const nextAvatars: Record<string, string> = {};
      const lookupByProjectId = new Map<string, ReturnType<typeof buildChannelAvatarLookup>>();
      const lookups = [] as NonNullable<ReturnType<typeof buildChannelAvatarLookup>>[];

      for (const project of baseProjects) {
        const match = matchCreatorResourceProfiles(project, resourceProfiles);
        const profileWithAvatar = match.profiles.find((profile) => profile.avatarUrl);
        if (profileWithAvatar?.avatarUrl) {
          nextAvatars[project.id] = profileWithAvatar.avatarUrl;
          continue;
        }
        const matchedProfile = match.profiles[0];
        const lookup = buildChannelAvatarLookup({
          channelId: matchedProfile?.channelId || project.channelId,
          channelUrl: matchedProfile?.channelUrl || project.channelUrl,
        });
        if (!lookup) continue;
        lookupByProjectId.set(project.id, lookup);
        lookups.push(lookup);
      }

      const resolved = await resolveChannelAvatars(lookups);
      if (cancelled) return;
      for (const [projectId, lookup] of lookupByProjectId) {
        const avatar = lookup ? resolved.get(lookup.key) : undefined;
        if (avatar?.status === 'ready' && avatar.avatarUrl) nextAvatars[projectId] = avatar.avatarUrl;
      }
      setAvatarByProjectId(nextAvatars);
    };

    void enrichAvatars();
    return () => { cancelled = true; };
  }, [baseProjects, settings]);

  const projects = useMemo(
    () => baseProjects.map((project) => ({
      ...project,
      avatarUrl: avatarByProjectId[project.id],
    })),
    [avatarByProjectId, baseProjects],
  );

  useEffect(() => {
    if (!selectedProject) return;
    const updated = projects.find((project) => project.id === selectedProject.id);
    if (updated) setSelectedProject(updated);
    else setSelectedProject(undefined);
  }, [projects, selectedProject]);

  const products = useMemo(() => uniqueValues(projects.map((project) => project.product), '未填写合作产品'), [projects]);
  const sites = useMemo(() => uniqueValues(projects.map((project) => project.site), '未填写'), [projects]);

  const filteredProjects = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : 0;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
    return projects
      .filter((project) => {
        const haystack = [project.channelName, project.product, project.site, project.region, project.channelUrl].join(' ').toLowerCase();
        if (query && !haystack.includes(query)) return false;
        if (stageFilter !== 'all' && project.stage !== stageFilter) return false;
        if (productFilter !== 'all' && project.product !== productFilter) return false;
        if (siteFilter !== 'all' && project.site !== siteFilter) return false;
        if (riskFilter === 'risk' && project.risks.length === 0) return false;
        if (riskFilter === 'normal' && project.risks.length > 0) return false;
        if (riskFilter === 'overdue' && !project.risks.some((risk) => risk.level === 'overdue')) return false;
        if ((dateFrom || dateTo) && (!project.cooperationDate || project.cooperationDate < from || project.cooperationDate > to)) return false;
        return true;
      })
      .sort((left, right) => {
        if (left.stageDate && right.stageDate && left.stageDate !== right.stageDate) {
          return left.stageDate - right.stageDate;
        }
        if (left.stageDate) return -1;
        if (right.stageDate) return 1;
        return left.channelName.localeCompare(right.channelName, 'zh-CN');
      });
  }, [dateFrom, dateTo, deferredSearch, productFilter, projects, riskFilter, siteFilter, stageFilter]);

  if (settingsLoading || (loading && url)) {
    return (
      <div className="flex h-full items-center justify-center bg-white">
        <div className="text-center text-sm text-slate-500">
          <LoaderCircle className="mx-auto mb-2 h-5 w-5 animate-spin text-blue-600" />
          正在读取合作项目...
        </div>
      </div>
    );
  }
  if (!url) return <EmptyState onOpenSettings={onOpenSettings} />;

  const missingNewMappings = ['discountCode', 'filmingCompleteDate', 'logisticsNotified', 'discountNotified']
    .filter((key) => !mapping[key as keyof typeof mapping]).length;

  return (
    <div className="app-workbench flex h-full min-h-0 overflow-hidden rounded-xl">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="material-toolbar flex shrink-0 flex-col items-stretch gap-3 border-b border-border/45 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-950">合作项目</h1>
              <Badge variant="outline" className="rounded-md border-slate-200 bg-slate-50 text-[10px] font-normal text-slate-500">只读</Badge>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              详细合作记录表 · 已同步 {projects.length} 个项目
              {updatedAt ? ` · ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(updatedAt)} 更新` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm" className="h-9" disabled={refreshing} onClick={() => void loadRecords(true)}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />刷新数据
            </Button>
            <Button variant="outline" size="sm" className="h-9" onClick={() => openExternal(url)}>
              <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />打开飞书
            </Button>
          </div>
        </header>

        <StatStrip projects={projects} />

        {(error || missingNewMappings > 0) ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error || `新增的 ${missingNewMappings} 个合作字段尚未保存映射；同名字段会先自动识别，建议在设置中重新检查并保存。`}</span>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-amber-800" onClick={onOpenSettings}>检查映射</Button>
          </div>
        ) : null}

        <div className="material-toolbar shrink-0 border-b border-border/55 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 xl:max-w-[310px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索红人或产品" className="h-9 border-slate-200 pl-9 text-xs" />
            </div>
            <Select value={stageFilter} onValueChange={(value) => setStageFilter(value as CooperationStage | 'all')}>
              <SelectTrigger className="h-9 w-[135px] border-slate-200 text-xs"><SelectValue placeholder="合作阶段" /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部阶段</SelectItem>{COOPERATION_STAGES.map((stage) => <SelectItem key={stage} value={stage}>{COOPERATION_STAGE_META[stage].label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="h-9 w-[140px] border-slate-200 text-xs"><SelectValue placeholder="合作产品" /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部产品</SelectItem>{products.map((product) => <SelectItem key={product} value={product}>{product}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={siteFilter} onValueChange={setSiteFilter}>
              <SelectTrigger className="h-9 w-[120px] border-slate-200 text-xs"><SelectValue placeholder="合作站点" /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部站点</SelectItem>{sites.map((site) => <SelectItem key={site} value={site}>{site}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={riskFilter} onValueChange={(value) => setRiskFilter(value as RiskFilter)}>
              <SelectTrigger className="h-9 w-[120px] border-slate-200 text-xs"><SelectValue placeholder="风险" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部风险</SelectItem>
                <SelectItem value="risk">仅异常</SelectItem>
                <SelectItem value="overdue">仅逾期</SelectItem>
                <SelectItem value="normal">仅正常</SelectItem>
              </SelectContent>
            </Select>
            <ViewSwitcher value={view} onChange={setView} />
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span>合作日期</span>
              <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-8 w-[135px] border-slate-200 text-[11px]" aria-label="合作日期开始" />
              <span>至</span>
              <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-8 w-[135px] border-slate-200 text-[11px]" aria-label="合作日期结束" />
            </div>
            <p className="text-[11px] text-slate-500">当前显示 {filteredProjects.length} / {projects.length} 个项目</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {filteredProjects.length === 0 ? (
            <div className="flex h-full items-center justify-center bg-white text-center">
              <div>
                <Users className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-700">
                  {projects.length === 0 ? '详细合作记录表还没有合作数据' : '没有符合条件的合作项目'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {projects.length === 0 ? '飞书中的空白行不会计入合作项目。' : '请调整筛选条件。'}
                </p>
                {projects.length === 0 ? (
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => openExternal(url)}>
                    <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />打开飞书录入
                  </Button>
                ) : null}
              </div>
            </div>
          ) : view === 'list' ? (
            <ProjectsTable projects={filteredProjects} selectedId={selectedProject?.id} onSelect={setSelectedProject} />
          ) : view === 'board' ? (
            <ProjectsBoard projects={filteredProjects} onSelect={setSelectedProject} />
          ) : (
            <div className="h-full overflow-x-auto">
              <ProjectsCalendar projects={filteredProjects} month={calendarMonth} onMonthChange={setCalendarMonth} onSelect={setSelectedProject} />
            </div>
          )}
        </div>
      </div>

      {selectedProject ? (
        <aside className="hidden h-full w-[390px] shrink-0 border-l border-slate-200 xl:block">
          <ProjectDetail
            project={selectedProject}
            settings={settings}
            feishuUrl={url}
            onProjectUpdated={refreshProjects}
            onClose={() => setSelectedProject(undefined)}
          />
        </aside>
      ) : null}

      {selectedProject ? (
        <div className="fixed inset-0 z-[70] bg-slate-950/20 xl:hidden" onMouseDown={() => setSelectedProject(undefined)}>
          <aside className="ml-auto h-full w-full max-w-[420px] shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <ProjectDetail
              project={selectedProject}
              settings={settings}
              feishuUrl={url}
              onProjectUpdated={refreshProjects}
              onClose={() => setSelectedProject(undefined)}
            />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
