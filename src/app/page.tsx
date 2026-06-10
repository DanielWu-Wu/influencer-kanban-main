'use client';

import { useEffect, useState } from 'react';
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
import { Influencer, COUNTRY_OPTIONS } from '@/lib/types';
import { InfluencerForm } from '@/components/influencer-form';
import { KanbanBoard } from '@/components/kanban-board';
import { EmailTemplateManager } from '@/components/email-template-manager';
import { ReminderPanel } from '@/components/reminder-panel';
import { SettingsPanel } from '@/components/settings-panel';
import { TodoBoard } from '@/components/todo-board';
import { WorkCalendar } from '@/components/work-calendar';
import { GmailPage } from '@/components/gmail-page';

type View = 'kanban' | 'list' | 'email' | 'reminders' | 'settings' | 'todo' | 'calendar' | 'gmail' | 'prompts';

const label = {
  appShort: '\u7ea2\u4eba\u63a8\u5e7f',
  appFull: 'YouTube \u7ea2\u4eba\u63a8\u5e7f\u770b\u677f',
  dailyWork: '\u6bcf\u65e5\u5de5\u4f5c',
  influencerManage: '\u7ea2\u4eba\u7ba1\u7406',
  tools: '\u5de5\u5177',
  todo: '\u6bcf\u65e5\u5f85\u529e',
  calendar: '\u5de5\u4f5c\u65e5\u5386',
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
  { id: 'gmail', label: label.gmail, icon: Inbox, group: label.dailyWork },
  { id: 'kanban', label: label.kanban, icon: LayoutDashboard, group: label.influencerManage },
  { id: 'list', label: label.list, icon: Users, group: label.influencerManage },
  { id: 'email', label: label.emailTemplates, icon: Mail, group: label.influencerManage },
  { id: 'reminders', label: label.reminders, icon: Bell, group: label.influencerManage },
  { id: 'settings', label: label.settings, icon: Settings, group: label.tools },
  { id: 'prompts', label: label.prompts, icon: MessageSquareText, group: label.tools },
];

export default function DashboardPage() {
  const [currentView, setCurrentView] = useState<View>('todo');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingInfluencer, setEditingInfluencer] = useState<Influencer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (
      params.get('view') === 'gmail' ||
      params.get('gmail_connected') ||
      params.get('auth_error')
    ) {
      setCurrentView('gmail');
    }
  }, []);

  const { influencers, addInfluencer, updateInfluencer, deleteInfluencer, updateStatus } = useInfluencers();
  const { templates } = useEmailTemplates();
  const { reminders, pendingReminders, addReminder, completeReminder, skipReminder } = useReminders();
  const { todos, todayTodos, addTodo, toggleTodo, deleteTodo, updateTodo } = useTodos();
  const { events, addEvent, deleteEvent } = useCalendarEvents();
  const { settings } = useSettings();
  const { unreadCount } = useGmailThreads();

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

  const handleAddInfluencer = (data: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => {
    addInfluencer(data);
  };

  const handleUpdateInfluencer = (data: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (!editingInfluencer) return;
    updateInfluencer(editingInfluencer.id, data);
    setEditingInfluencer(null);
  };

  const renderNav = () => (
    <nav className="flex flex-col gap-0.5">
      {[label.dailyWork, label.influencerManage, label.tools].map((group, index) => (
        <div key={group}>
          {index > 0 && <div className="h-px bg-border my-2 mx-3" />}
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 mb-1.5 font-medium">{group}</p>
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
                onClick={() => {
                  setCurrentView(item.id as View);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 mx-0.5 ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {badge > 0 && (
                  <span
                    className={`inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[10px] font-medium ${
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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b">
        <div className="flex items-center justify-between h-14 px-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="w-5 h-5" />
            </Button>

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-semibold hidden sm:block">{label.appShort}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            {stats.todayTodos > 0 && (
              <button
                onClick={() => setCurrentView('todo')}
                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-sm font-medium hover:bg-blue-100 transition-colors"
              >
                <CheckSquare className="w-4 h-4" />
                {stats.todayTodos} {label.todo}
              </button>
            )}
            {stats.upcoming > 0 && (
              <button
                onClick={() => setCurrentView('reminders')}
                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-50 text-orange-600 text-sm font-medium hover:bg-orange-100 transition-colors"
              >
                <Bell className="w-4 h-4" />
                {stats.upcoming} {label.followUps}
              </button>
            )}
            <div className="hidden lg:flex items-center gap-3 text-sm text-muted-foreground">
              <span>
                {stats.total} {label.influencers}
              </span>
              <span>|</span>
              <span className="text-green-600">
                {stats.published} {label.published}
              </span>
            </div>
            <Button size="sm" onClick={() => setShowAddDialog(true)} className="shadow-sm">
              <Plus className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">{label.addInfluencer}</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="hidden md:flex w-56 flex-col sticky top-14 h-[calc(100vh-3.5rem)] border-r bg-background p-3">
          {renderNav()}
        </aside>

        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="w-72 p-4">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-semibold">{label.appFull}</span>
            </div>
            {renderNav()}
          </SheetContent>
        </Sheet>

        <main className="flex-1 min-h-[calc(100vh-3.5rem)] overflow-hidden flex flex-col">
          {currentView === 'kanban' && (
            <div className="flex-1 overflow-auto p-4 md:p-6">
              <div className="flex gap-3 mb-4 flex-shrink-0">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={label.search}
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="pl-10 bg-accent/50 border-0"
                  />
                </div>
                <select
                  value={filterCountry}
                  onChange={(event) => setFilterCountry(event.target.value)}
                  className="px-3 py-2 rounded-lg bg-accent/50 border-0 text-sm"
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
                onUpdateStatus={updateStatus}
                onEdit={(influencer) => setEditingInfluencer(influencer)}
                onDelete={deleteInfluencer}
              />
            </div>
          )}

          {currentView === 'list' && (
            <div className="h-[calc(100vh-8rem)] p-4 md:p-6">
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
                  <div className="flex-1 rounded-2xl border overflow-hidden shadow-apple relative">
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
            <div className="h-[calc(100vh-8rem)] p-4 md:p-6">
              <EmailTemplateManager templates={templates} onCopy={(textToCopy) => navigator.clipboard.writeText(textToCopy)} />
            </div>
          )}

          {currentView === 'reminders' && (
            <div className="h-[calc(100vh-8rem)] p-4 md:p-6">
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
            <div className="flex-1 min-h-0 p-4 md:p-6 flex flex-col overflow-hidden">
              <SettingsPanel />
            </div>
          )}

          {currentView === 'prompts' && (
            <div className="flex-1 min-h-0 p-4 md:p-6 flex flex-col overflow-hidden">
              <PromptManager />
            </div>
          )}

          {currentView === 'todo' && (
            <div className="h-[calc(100vh-8rem)] p-4 md:p-6">
              <TodoBoard todos={todos} onAdd={addTodo} onToggle={toggleTodo} onDelete={deleteTodo} onUpdate={updateTodo} />
            </div>
          )}

          {currentView === 'calendar' && (
            <div className="h-[calc(100vh-8rem)] p-4 md:p-6">
              <WorkCalendar events={events} todos={todos} onAddEvent={addEvent} onDeleteEvent={deleteEvent} />
            </div>
          )}

          {currentView === 'gmail' && (
            <div className="h-[calc(100vh-8rem)] p-4 md:p-6">
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
