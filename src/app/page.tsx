'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSettings } from '@/lib/data';
import {
  LayoutDashboard, Users, Mail, Bell, Settings,
  Plus, Search, CalendarDays, CheckSquare,
  ExternalLink, FileSpreadsheet, Menu, Sparkles,
  Inbox, FileText, MessageSquareText
} from 'lucide-react';
import { useInfluencers, useEmailTemplates, useReminders, useTodos, useCalendarEvents, useGmailThreads } from '@/lib/data';
import PromptManager from '@/components/prompt-manager';
import { Influencer, KANBAN_COLUMNS, COUNTRY_OPTIONS } from '@/lib/types';
import { InfluencerForm } from '@/components/influencer-form';
import { KanbanBoard } from '@/components/kanban-board';
import { EmailTemplateManager } from '@/components/email-template-manager';
import { ReminderPanel } from '@/components/reminder-panel';
import { SettingsPanel } from '@/components/settings-panel';
import { TodoBoard } from '@/components/todo-board';
import { WorkCalendar } from '@/components/work-calendar';
import { GmailPage } from '@/components/gmail-page';

type View = 'kanban' | 'list' | 'email' | 'reminders' | 'settings' | 'todo' | 'calendar' | 'gmail' | 'prompts';

const NAV_ITEMS = [
  { id: 'todo', label: '每日待办', icon: CheckSquare, group: '每日工作' },
  { id: 'calendar', label: '工作日历', icon: CalendarDays, group: '每日工作' },
  { id: 'gmail', label: 'Gmail 邮件', icon: Inbox, group: '每日工作' },
  { id: 'kanban', label: '看板视图', icon: LayoutDashboard, group: '红人管理' },
  { id: 'list', label: '红人列表', icon: Users, group: '红人管理' },
  { id: 'email', label: '邮件模板', icon: Mail, group: '红人管理' },
  { id: 'reminders', label: '跟进提醒', icon: Bell, group: '红人管理' },
  { id: 'settings', label: '设置', icon: Settings, group: '工具' },
  { id: 'prompts', label: '提示词管理', icon: MessageSquareText, group: '工具' },
];

export default function DashboardPage() {
  const [currentView, setCurrentView] = useState<View>('todo');
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingInfluencer, setEditingInfluencer] = useState<Influencer | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // 检测 Gmail OAuth 回调，自动切换到 Gmail 视图
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_code') || params.get('auth_error')) {
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

  const filteredInfluencers = influencers.filter(i => {
    const matchesSearch = 
      i.channelName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      i.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCountry = filterCountry === 'all' || i.country === filterCountry;
    return matchesSearch && matchesCountry;
  });

  const stats = {
    total: influencers.length,
    pending: influencers.filter(i => i.status === 'pending').length,
    inProgress: influencers.filter(i => ['contacted', 'interested', 'negotiating'].includes(i.status)).length,
    published: influencers.filter(i => i.status === 'published').length,
    upcoming: pendingReminders.length,
    todayTodos: todayTodos.length,
  };

  const handleAddInfluencer = (data: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => {
    addInfluencer(data);
  };

  const handleUpdateInfluencer = (data: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => {
    if (editingInfluencer) {
      updateInfluencer(editingInfluencer.id, data);
      setEditingInfluencer(null);
    }
  };

  // 渲染导航
  const renderNav = () => (
    <nav className="flex flex-col gap-0.5">
      {['每日工作', '红人管理', '工具'].map((group, gi) => (
        <div key={group}>
          {gi > 0 && <div className="h-px bg-border my-2 mx-3" />}
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground px-3 mb-1.5 font-medium">
            {group}
          </p>
          {NAV_ITEMS.filter(item => item.group === group).map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            const badge = item.id === 'todo' ? stats.todayTodos : 
                         item.id === 'reminders' ? stats.upcoming : 
                         item.id === 'list' ? stats.total :
                         item.id === 'gmail' ? unreadCount : 0;
            
            return (
              <button
                key={item.id}
                onClick={() => { setCurrentView(item.id as View); setMobileMenuOpen(false); }}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                  transition-all duration-200 mx-0.5
                  ${isActive 
                    ? 'bg-primary text-primary-foreground shadow-sm' 
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }
                `}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {badge > 0 && (
                  <span className={`
                    inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-[10px] font-medium
                    ${isActive ? 'bg-white/20 text-white' : 'bg-accent text-muted-foreground'}
                  `}>
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
      {/* 顶部导航 - Apple 风格 */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b">
        <div className="flex items-center justify-between h-14 px-4">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon" 
              className="md:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="w-5 h-5" />
            </Button>
            
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-semibold hidden sm:block">红人推广</span>
            </div>
          </div>

          {/* 快捷统计 */}
          <div className="flex items-center gap-2 md:gap-4">
            {stats.todayTodos > 0 && (
              <button 
                onClick={() => setCurrentView('todo')}
                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 text-blue-600 text-sm font-medium hover:bg-blue-100 transition-colors"
              >
                <CheckSquare className="w-4 h-4" />
                {stats.todayTodos} 待办
              </button>
            )}
            {stats.upcoming > 0 && (
              <button 
                onClick={() => setCurrentView('reminders')}
                className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-orange-50 text-orange-600 text-sm font-medium hover:bg-orange-100 transition-colors"
              >
                <Bell className="w-4 h-4" />
                {stats.upcoming} 跟进
              </button>
            )}
            <div className="hidden lg:flex items-center gap-3 text-sm text-muted-foreground">
              <span>{stats.total} 红人</span>
              <span>|</span>
              <span className="text-green-600">{stats.published} 已发布</span>
            </div>
            <Button size="sm" onClick={() => setShowAddDialog(true)} className="shadow-sm">
              <Plus className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">添加红人</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* 桌面端侧边栏 - Apple 风格 */}
        <aside className="hidden md:flex w-56 flex-col sticky top-14 h-[calc(100vh-3.5rem)] border-r bg-background p-3">
          {renderNav()}
        </aside>

        {/* 移动端侧边栏 */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetContent side="left" className="w-72 p-4">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-semibold">红人推广看板</span>
            </div>
            {renderNav()}
          </SheetContent>
        </Sheet>

        {/* 主内容区 */}
        <main className="flex-1 min-h-[calc(100vh-3.5rem)] overflow-hidden flex flex-col">
          {/* 看板视图 */}
          {currentView === 'kanban' && (
            <div className="flex-1 overflow-auto p-4 md:p-6">
              {/* 搜索 */}
              <div className="flex gap-3 mb-4 flex-shrink-0">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="搜索红人..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-accent/50 border-0"
                  />
                </div>
                <select
                  value={filterCountry}
                  onChange={(e) => setFilterCountry(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-accent/50 border-0 text-sm"
                >
                  <option value="all">全部国家</option>
                  {COUNTRY_OPTIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <KanbanBoard
                influencers={filteredInfluencers}
                onUpdateStatus={updateStatus}
                onEdit={(i) => setEditingInfluencer(i)}
                onDelete={deleteInfluencer}
              />
            </div>
          )}

          {/* 红人列表 - 飞书内嵌 */}
          {currentView === 'list' && (
            <div className="h-[calc(100vh-8rem)]">
              {settings.feishuUrl ? (
                <div className="h-full flex flex-col">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                        <FileSpreadsheet className="w-5 h-5 text-blue-500" />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold">飞书多维表格</h2>
                        <p className="text-sm text-muted-foreground">直接在看板中管理红人数据</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => window.open(settings.feishuUrl, '_blank')}
                      >
                        <ExternalLink className="w-4 h-4 mr-1" />
                        新窗口
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 rounded-2xl border overflow-hidden shadow-apple relative">
                    <iframe
                      src={(() => {
                        let url = settings.feishuUrl!;
                        // 自动添加嵌入参数优化显示
                        if (!url.includes('hideHeader') && !url.includes('hideSidebar')) {
                          const sep = url.includes('?') ? '&' : '?';
                          url = `${url}${sep}hideHeader=1&hideSidebar=1`;
                        }
                        return url;
                      })()}
                      className="w-full h-full"
                      frameBorder="0"
                      allowFullScreen
                      allow="clipboard-read; clipboard-write"
                      title="飞书多维表格"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 text-center">
                    如果表格未显示，请点击「新窗口」打开，或在飞书中确认该表格已开启「互联网可访问」分享权限
                  </p>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="w-20 h-20 rounded-2xl bg-accent flex items-center justify-center mb-4">
                    <FileSpreadsheet className="w-10 h-10 text-muted-foreground" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2">连接飞书多维表格</h2>
                  <p className="text-muted-foreground mb-6 max-w-sm">
                    在看板中直接查看和管理你在飞书多维表格里记录的红人数据
                  </p>
                  <div className="space-y-2">
                    <Button onClick={() => setCurrentView('settings')}>
                      <Settings className="w-4 h-4 mr-2" />
                      去设置
                    </Button>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      提示：在飞书多维表格中点击「分享」→「获取嵌入链接」，将链接填入设置即可
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 邮件模板 */}
          {currentView === 'email' && (
            <div className="h-[calc(100vh-8rem)]">
              <EmailTemplateManager
                templates={templates}
                onCopy={(text) => {
                  navigator.clipboard.writeText(text);
                }}
              />
            </div>
          )}

          {/* 跟进提醒 */}
          {currentView === 'reminders' && (
            <div className="h-[calc(100vh-8rem)]">
              <ReminderPanel
                reminders={reminders}
                influencers={influencers}
                onComplete={completeReminder}
                onSkip={skipReminder}
                onAddReminder={addReminder}
              />
            </div>
          )}

          {/* 设置 */}
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

          {/* 每日待办 */}
          {currentView === 'todo' && (
            <div className="h-[calc(100vh-8rem)]">
              <TodoBoard
                todos={todos}
                onAdd={addTodo}
                onToggle={toggleTodo}
                onDelete={deleteTodo}
                onUpdate={updateTodo}
              />
            </div>
          )}

          {/* 工作日历 */}
          {currentView === 'calendar' && (
            <div className="h-[calc(100vh-8rem)]">
              <WorkCalendar
                events={events}
                todos={todos}
                onAddEvent={addEvent}
                onDeleteEvent={deleteEvent}
              />
            </div>
          )}

          {/* Gmail 邮件 */}
          {currentView === 'gmail' && (
            <div className="h-[calc(100vh-8rem)]">
              <GmailPage />
            </div>
          )}
        </main>
      </div>

      {/* 添加/编辑红人弹窗 */}
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
