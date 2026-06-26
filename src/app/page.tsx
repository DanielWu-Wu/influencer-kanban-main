'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSettings } from '@/lib/data';
import {
  LayoutDashboard,
  Users,
  Mail,
  Bell,
  Settings,
  Plus,
  Search,
  CalendarDays,
  CheckSquare,
  ExternalLink,
  FileSpreadsheet,
  Menu,
  Sparkles,
  Inbox,
  MessageSquareText,
  LogOut,
  LoaderCircle,
  UserPlus,
} from 'lucide-react';
import {
  useInfluencers,
  useEmailTemplates,
  useReminders,
  useTodos,
  useCalendarEvents,
  useGmailThreads,
} from '@/lib/data';
import PromptManager from '@/components/prompt-manager';
import { Influencer, COUNTRY_OPTIONS, STATUS_LABELS } from '@/lib/types';
import { InfluencerForm } from '@/components/influencer-form';
import { KanbanBoard } from '@/components/kanban-board';
import { EmailTemplateManager } from '@/components/email-template-manager';
import { ReminderPanel } from '@/components/reminder-panel';
import { SettingsPanel } from '@/components/settings-panel';
import { TodoBoard } from '@/components/todo-board';
import { WorkCalendar } from '@/components/work-calendar';
import { GmailPage } from '@/components/gmail-page';
import { CreatorProspectingPage } from '@/components/creator-prospecting-page';
import { useAuth } from '@/components/auth-provider';
import { useRecordAssistant } from '@/components/record-assistant-provider';

type View = 'kanban' | 'list' | 'email' | 'reminders' | 'settings' | 'todo' | 'calendar' | 'prospecting' | 'gmail' | 'prompts';

const label = {
  appShort: '\u7ea2\u4eba\u63a8\u5e7f',
  appFull: 'YouTube \u7ea2\u4eba\u63a8\u5e7f\u770b\u677f',
  dailyWork: '\u6bcf\u65e5\u5de5\u4f5c',
  influencerManage: '\u7ea2\u4eba\u7ba1\u7406',
  tools: '\u5de5\u5177',
  todo: '\u6bcf\u65e5\u5f85\u529e',
  calendar: '\u5de5\u4f5c\u65e5\u5386',
  prospecting: '\u7ea2\u4eba\u5f00\u53d1\u53f0',
  gmail: 'Gmail \u90ae\u4ef6',
  kanban: '\u5408\u4f5c\u770b\u677f',
  list: '\u7ea2\u4eba\u5217\u8868',
  emailTemplates: '\u90ae\u4ef6\u6a21\u677f',
  reminders: '\u8ddf\u8fdb\u63d0\u9192',
  settings: '\u8bbe\u7f6e',
  prompts: 'AI \u63d0\u793a\u8bcd',
  addInfluencer: '\u6dfb\u52a0\u7ea2\u4eba',
  search: '\u641c\u7d22\u9891\u9053\u540d\u79f0\u6216\u90ae\u7bb1...',
  allCountries: '\u5168\u90e8\u56fd\u5bb6',
  influencers: '\u7ea2\u4eba',
  published: '\u5df2\u53d1\u5e03',
  followUps: '\u8ddf\u8fdb',
  feishuTitle: '\u98de\u4e66\u591a\u7ef4\u8868\u683c',
  feishuDesc: '\u76f4\u63a5\u5728\u770b\u677f\u4e2d\u7ba1\u7406\u7ea2\u4eba\u6570\u636e',
  openNewWindow: '\u65b0\u7a97\u53e3',
  feishuEmptyTitle: '\u8fde\u63a5\u98de\u4e66\u591a\u7ef4\u8868\u683c',
  feishuEmptyDesc: '\u5728\u8bbe\u7f6e\u4e2d\u586b\u5165\u98de\u4e66\u8868\u683c\u94fe\u63a5\uff0c\u5c31\u53ef\u4ee5\u5728\u8fd9\u91cc\u67e5\u770b\u5916\u90e8\u6570\u636e\u3002',
  goSettings: '\u53bb\u8bbe\u7f6e',
};

const NAV_ITEMS = [
  { id: 'todo', label: label.todo, icon: CheckSquare, group: label.dailyWork },
  { id: 'calendar', label: label.calendar, icon: CalendarDays, group: label.dailyWork },
  { id: 'prospecting', label: label.prospecting, icon: UserPlus, group: label.dailyWork },
  { id: 'gmail', label: label.gmail, icon: Inbox, group: label.dailyWork },
  { id: 'kanban', label: label.kanban, icon: LayoutDashboard, group: label.influencerManage },
  { id: 'list', label: label.list, icon: Users, group: label.influencerManage },
  { id: 'email', label: label.emailTemplates, icon: Mail, group: label.influencerManage },
  { id: 'reminders', label: label.reminders, icon: Bell, group: label.influencerManage },
  { id: 'settings', label: label.settings, icon: Settings, group: label.tools },
  { id: 'prompts', label: label.prompts, icon: MessageSquareText, group: label.tools },
];

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading, configured, signOut } = useAuth();
  const [currentView, setCurrentView] = useState<View>('todo');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingInfluencer, setEditingInfluencer] = useState<Influencer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!authLoading && configured && !user) {
      router.replace('/login');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (
      params.get('view') === 'gmail' ||
      params.get('gmail_connected') ||
      params.get('auth_error')
    ) {
      setCurrentView('gmail');
    } else if (
      params.get('view') === 'settings' ||
      params.get('feishu_connected') ||
      params.get('feishu_error')
    ) {
      setCurrentView('settings');
    }
  }, [authLoading, configured, router, user]);

  const { influencers, addInfluencer, updateInfluencer, deleteInfluencer, updateStatus } = useInfluencers();
  const { templates } = useEmailTemplates();
  const { reminders, pendingReminders, addReminder, completeReminder, skipReminder } = useReminders();
  const { todos, todayTodos, addTodo, toggleTodo, deleteTodo, updateTodo } = useTodos();
  const { events, addEvent, deleteEvent } = useCalendarEvents();
  const { settings } = useSettings();
  const { unreadCount } = useGmailThreads();
  const { captureEvent } = useRecordAssistant();

  const filteredInfluencers = influencers.filter((influencer) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      influencer.channelName.toLowerCase().includes(query) || influencer.email.toLowerCase().includes(query);
    const matchesCountry = filterCountry === 'all' || influencer.country === filterCountry;
    return matchesSearch && matchesCountry;
  });

  const stats = {
    total: influencers.length,
    pending: influencers.filter((item) => item.status === 'pending').length,
    inProgress: influencers.filter((item) => ['contacted', 'interested', 'negotiating'].includes(item.status)).length,
    published: influencers.filter((item) => item.status === 'published').length,
    upcoming: pendingReminders.length,
    todayTodos: todayTodos.length,
  };

  if (authLoading || (configured && !user)) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="workspace-shell flex min-h-screen items-center justify-center p-6">
        <div className="glass-panel-strong max-w-md rounded-lg p-6 text-center">
          <h1 className="text-lg font-semibold">Supabase 尚未连接</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            请确认 Vercel 中已经添加 Supabase URL 和 Publishable Key，并完成重新部署。
          </p>
        </div>
      </div>
    );
  }

  const handleAddInfluencer = (data: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => {
    addInfluencer(data);
  };

  const handleUpdateInfluencer = (data: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!editingInfluencer) return;
    updateInfluencer(editingInfluencer.id, data);
    setEditingInfluencer(null);
  };

  const handleUpdateStatus = (id: string, status: Influencer['status']) => {
    const influencer = influencers.find((item) => item.id === id);
    updateStatus(id, status);

    if (!influencer || influencer.status === status) return;
    captureEvent({
      type: 'status_changed',
      source: 'kanban',
      title: `${influencer.channelName} 状态变更`,
      summary: `从「${STATUS_LABELS[influencer.status]}」更新为「${STATUS_LABELS[status]}」`,
      influencer: {
        id: influencer.id,
        channelName: influencer.channelName,
        email: influencer.email,
        previousStatus: influencer.status,
        previousStatusLabel: STATUS_LABELS[influencer.status],
        newStatus: status,
        statusLabel: STATUS_LABELS[status],
      },
    });
  };

  const renderNav = () => (
    <nav className="flex flex-col gap-3">
      {[label.dailyWork, label.influencerManage, label.tools].map((group, index) => (
        <div key={group} className="space-y-1">
          {index > 0 && <div className="mx-2 mb-3 h-px bg-border/70" />}
          <p className="px-2 text-[11px] font-semibold text-muted-foreground">{group}</p>
          {NAV_ITEMS.filter((item) => item.group === group).map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            const badge =
              item.id === 'todo'
                ? stats.todayTodos
                : item.id === 'reminders'
                  ? stats.upcoming
                  : item.id === 'list'
                    ? stats.total
                    : item.id === 'gmail'
                      ? unreadCount
                      : 0;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setCurrentView(item.id as View);
                  setMobileMenuOpen(false);
                }}
                className={`flex h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium transition-all duration-200 ease-out active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:active:scale-100 ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-apple hover:bg-primary/95 hover:shadow-apple-hover'
                    : 'text-muted-foreground hover:bg-white/82 hover:text-foreground hover:shadow-sm'
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {badge > 0 && (
                  <span
                    className={`inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 text-[10px] font-semibold ${
                      isActive ? 'bg-white/20 text-white' : 'bg-accent text-muted-foreground'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="workspace-shell min-h-screen">
      <header className="sticky top-0 z-50 border-b border-white/50 bg-white/72 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-4 md:px-5">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="w-5 h-5" />
            </Button>

            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-apple">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <div className="hidden sm:block">
                <span className="text-base font-semibold leading-none">{label.appShort}</span>
                <p className="section-kicker mt-0.5">Influencer Ops</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {stats.todayTodos > 0 && (
              <button
                onClick={() => setCurrentView('todo')}
                className="glass-control hidden h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-primary transition-all duration-200 ease-out hover:bg-white/85 hover:shadow-sm active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 md:flex"
              >
                <CheckSquare className="w-4 h-4" />
                {stats.todayTodos} {label.todo}
              </button>
            )}
            {stats.upcoming > 0 && (
              <button
                onClick={() => setCurrentView('reminders')}
                className="glass-control hidden h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-amber-700 transition-all duration-200 ease-out hover:bg-white/85 hover:shadow-sm active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 md:flex"
              >
                <Bell className="w-4 h-4" />
                {stats.upcoming} {label.followUps}
              </button>
            )}
            <div className="glass-control hidden h-9 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground lg:flex">
              <span className="font-medium text-foreground">
                {stats.total} {label.influencers}
              </span>
              <span className="h-4 w-px bg-border" />
              <span className="font-medium text-emerald-700">
                {stats.published} {label.published}
              </span>
            </div>
            <div className="hidden h-9 items-center gap-2 border-l border-border/70 pl-3 md:flex">
              <span className="max-w-40 truncate text-xs text-muted-foreground">
                {user?.email}
              </span>
              <Button
                variant="ghost"
                size="icon"
                title="退出登录"
                onClick={async () => {
                  await signOut();
                  router.replace('/login');
                }}
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
            <Button size="sm" onClick={() => setShowAddDialog(true)} className="h-9 rounded-lg shadow-apple">
              <Plus className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">{label.addInfluencer}</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex p-3 pt-4 md:p-4">
        <aside className="glass-panel-soft sticky top-20 hidden h-[calc(100vh-5rem)] w-60 shrink-0 flex-col rounded-lg p-3 md:flex">
          <div className="mb-3 rounded-lg border border-white/60 bg-white/55 p-3">
            <p className="text-xs font-medium text-muted-foreground">今日作战台</p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-white/70 px-2 py-1.5">
                <p className="text-muted-foreground">待办</p>
                <p className="text-base font-semibold">{stats.todayTodos}</p>
              </div>
              <div className="rounded-md bg-white/70 px-2 py-1.5">
                <p className="text-muted-foreground">Gmail</p>
                <p className="text-base font-semibold">{unreadCount}</p>
              </div>
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            {renderNav()}
          </div>
        </aside>

        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="w-72 p-4">
            <div className="flex items-center gap-2 mb-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
                <Sparkles className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="text-lg font-semibold">{label.appFull}</span>
            </div>
            {renderNav()}
          </SheetContent>
        </Sheet>

        <main className="ml-0 flex h-[calc(100vh-5rem)] min-h-0 flex-1 flex-col overflow-hidden md:ml-4">
          {currentView === 'kanban' && (
            <div className="glass-panel-strong flex-1 overflow-auto rounded-lg p-4">
              <div className="flex gap-3 mb-4 flex-shrink-0">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={label.search}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="glass-control h-10 border-0 pl-10"
                  />
                </div>
                <select
                  value={filterCountry}
                  onChange={(event) => setFilterCountry(event.target.value)}
                  className="glass-control h-10 rounded-lg px-3 text-sm"
                >
                  <option value="all">{label.allCountries}</option>
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </select>
              </div>

              <KanbanBoard
                influencers={filteredInfluencers}
                onUpdateStatus={handleUpdateStatus}
                onEdit={(influencer) => setEditingInfluencer(influencer)}
                onDelete={deleteInfluencer}
              />
            </div>
          )}

          {currentView === 'list' && (
            <div className="glass-panel-strong min-h-0 flex-1 rounded-lg p-4">
              {settings.feishuUrl ? (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                        <FileSpreadsheet className="w-5 h-5 text-blue-500" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold">{label.feishuTitle}</h2>
                        <p className="text-sm text-muted-foreground">{label.feishuDesc}</p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => window.open(settings.feishuUrl, '_blank')}>
                      <ExternalLink className="w-4 h-4 mr-1" />
                      {label.openNewWindow}
                    </Button>
                  </div>
                  <div className="relative flex-1 overflow-hidden rounded-lg border border-white/60 bg-white/60 shadow-apple">
                    <iframe
                      src={settings.feishuUrl}
                      className="w-full h-full"
                      frameBorder="0"
                      allowFullScreen
                      allow="clipboard-read; clipboard-write"
                      title={label.feishuTitle}
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 rounded-2xl bg-accent flex items-center justify-center mb-4">
                    <FileSpreadsheet className="w-10 h-10 text-muted-foreground" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">{label.feishuEmptyTitle}</h2>
                  <p className="text-muted-foreground mb-6 max-w-sm">{label.feishuEmptyDesc}</p>
                  <Button onClick={() => setCurrentView('settings')}>
                    <Settings className="w-4 h-4 mr-2" />
                    {label.goSettings}
                  </Button>
                </div>
              )}
            </div>
          )}

          {currentView === 'email' && (
            <div className="glass-panel-strong min-h-0 flex-1 rounded-lg p-4">
              <EmailTemplateManager templates={templates} onCopy={(textToCopy) => navigator.clipboard.writeText(textToCopy)} />
            </div>
          )}

          {currentView === 'reminders' && (
            <div className="glass-panel-strong min-h-0 flex-1 rounded-lg p-4">
              <ReminderPanel
                reminders={reminders}
                influencers={influencers}
                onComplete={completeReminder}
                onSkip={skipReminder}
                onAddReminder={addReminder}
              />
            </div>
          )}

          {currentView === 'settings' && (
            <div className="glass-panel-strong flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg p-4">
              <SettingsPanel />
            </div>
          )}

          {currentView === 'prompts' && (
            <div className="glass-panel-strong flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg p-4">
              <PromptManager />
            </div>
          )}

          {currentView === 'todo' && (
            <div className="glass-panel-strong min-h-0 flex-1 rounded-lg p-4">
              <TodoBoard todos={todos} onAdd={addTodo} onToggle={toggleTodo} onDelete={deleteTodo} onUpdate={updateTodo} />
            </div>
          )}

          {currentView === 'calendar' && (
            <div className="glass-panel-strong min-h-0 flex-1 rounded-lg p-4">
              <WorkCalendar events={events} todos={todos} onAddEvent={addEvent} onDeleteEvent={deleteEvent} />
            </div>
          )}

          {currentView === 'prospecting' && (
            <div className="glass-panel-strong min-h-0 flex-1 overflow-hidden rounded-lg p-4">
              <CreatorProspectingPage />
            </div>
          )}

          {currentView === 'gmail' && (
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg">
              <GmailPage />
            </div>
          )}
        </main>
      </div>

      <InfluencerForm
        open={showAddDialog || editingInfluencer !== null}
        onClose={() => {
          setShowAddDialog(false);
          setEditingInfluencer(null);
        }}
        onSubmit={editingInfluencer ? handleUpdateInfluencer : handleAddInfluencer}
        initialData={editingInfluencer || undefined}
        mode={editingInfluencer ? 'edit' : 'create'}
      />
    </div>
  );
}
