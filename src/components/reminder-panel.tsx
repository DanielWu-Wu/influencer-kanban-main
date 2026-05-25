'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { 
  Bell, Clock, CheckCircle2, SkipForward, Plus, 
  Settings, Mail, ExternalLink, AlertTriangle,
  ChevronRight, Globe, Users, Database
} from 'lucide-react';
import { FollowUpReminder, Influencer } from '@/lib/types';

interface ReminderPanelProps {
  reminders: FollowUpReminder[];
  influencers: Influencer[];
  onComplete: (id: string) => void;
  onSkip: (id: string, note?: string) => void;
  onAddReminder: (reminder: Omit<FollowUpReminder, 'id'>) => void;
}

export function ReminderPanel({ 
  reminders, 
  influencers,
  onComplete, 
  onSkip, 
  onAddReminder 
}: ReminderPanelProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newReminder, setNewReminder] = useState({
    influencerId: '',
    type: 'manual' as const,
    remindAt: new Date().toISOString().slice(0, 16),
    note: '',
  });

  const pendingReminders = reminders.filter(r => r.status === 'pending');
  const completedReminders = reminders.filter(r => r.status === 'completed');
  const skippedReminders = reminders.filter(r => r.status === 'skipped');

  const getInfluencer = (id: string) => influencers.find(i => i.id === id);

  const handleAddReminder = () => {
    if (!newReminder.influencerId || !newReminder.remindAt) return;
    
    onAddReminder({
      ...newReminder,
      emailRecordId: '',
      status: 'pending',
    });
    
    setNewReminder({
      influencerId: '',
      type: 'manual',
      remindAt: new Date().toISOString().slice(0, 16),
      note: '',
    });
    setShowAddDialog(false);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isOverdue = (dateStr: string) => {
    return new Date(dateStr) < new Date();
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="pending" className="flex-1 flex flex-col">
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="pending">
            待跟进 ({pendingReminders.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            已完成 ({completedReminders.length})
          </TabsTrigger>
          <TabsTrigger value="skipped">
            已跳过 ({skippedReminders.length})
          </TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto mt-4 space-y-3">
          <TabsContent value="pending" className="m-0 space-y-3">
            {pendingReminders.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Bell className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>暂无待跟进提醒</p>
              </div>
            ) : (
              pendingReminders.map(reminder => {
                const influencer = getInfluencer(reminder.influencerId);
                const overdue = isOverdue(reminder.remindAt);
                
                return (
                  <Card key={reminder.id} className={overdue ? 'border-orange-200 bg-orange-50/50' : ''}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-base flex items-center gap-2">
                            {influencer?.channelName || '未知红人'}
                            {overdue && (
                              <Badge variant="destructive" className="text-xs">
                                <AlertTriangle className="w-3 h-3 mr-1" />
                                逾期
                              </Badge>
                            )}
                          </CardTitle>
                          <CardDescription className="flex items-center gap-1 mt-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(reminder.remindAt)}
                          </CardDescription>
                        </div>
                        <Badge variant="outline">
                          {reminder.type === 'auto' ? '自动' : '手动'}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {reminder.note && (
                        <p className="text-sm text-gray-600 mb-3">{reminder.note}</p>
                      )}
                      <div className="flex items-center gap-2">
                        {influencer?.email && (
                          <a 
                            href={`mailto:${influencer.email}`}
                            className="flex-1"
                          >
                            <Button variant="outline" size="sm" className="w-full">
                              <Mail className="w-4 h-4 mr-2" />
                              发邮件
                            </Button>
                          </a>
                        )}
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => onComplete(reminder.id)}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" />
                          完成
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => onSkip(reminder.id)}
                        >
                          <SkipForward className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="completed" className="m-0 space-y-3">
            {completedReminders.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>暂无已完成项</p>
              </div>
            ) : (
              completedReminders.map(reminder => {
                const influencer = getInfluencer(reminder.influencerId);
                return (
                  <Card key={reminder.id} className="opacity-60">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{influencer?.channelName || '未知红人'}</p>
                          <p className="text-sm text-gray-500">{formatDate(reminder.remindAt)}</p>
                        </div>
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="skipped" className="m-0 space-y-3">
            {skippedReminders.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <SkipForward className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>暂无已跳过项</p>
              </div>
            ) : (
              skippedReminders.map(reminder => {
                const influencer = getInfluencer(reminder.influencerId);
                return (
                  <Card key={reminder.id} className="opacity-60">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{influencer?.channelName || '未知红人'}</p>
                          {reminder.note && (
                            <p className="text-sm text-gray-500">{reminder.note}</p>
                          )}
                        </div>
                        <SkipForward className="w-5 h-5 text-gray-400" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>
        </div>
      </Tabs>

      <Separator className="my-4" />
      
      <Button 
        variant="outline" 
        className="w-full"
        onClick={() => setShowAddDialog(true)}
      >
        <Plus className="w-4 h-4 mr-2" />
        添加提醒
      </Button>

      {/* 添加提醒弹窗 */}
      {showAddDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>添加跟进提醒</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>选择红人</Label>
                <select
                  className="w-full p-2 border rounded-md"
                  value={newReminder.influencerId}
                  onChange={(e) => setNewReminder({ ...newReminder, influencerId: e.target.value })}
                >
                  <option value="">选择红人...</option>
                  {influencers.map(i => (
                    <option key={i.id} value={i.id}>{i.channelName} ({i.email})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>提醒时间</Label>
                <Input
                  type="datetime-local"
                  value={newReminder.remindAt}
                  onChange={(e) => setNewReminder({ ...newReminder, remindAt: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>备注</Label>
                <Textarea
                  value={newReminder.note}
                  onChange={(e) => setNewReminder({ ...newReminder, note: e.target.value })}
                  placeholder="添加备注信息..."
                />
              </div>
            </CardContent>
            <CardContent className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                取消
              </Button>
              <Button onClick={handleAddReminder}>
                添加
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
