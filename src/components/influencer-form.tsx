'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Influencer, InfluencerStatus, COUNTRY_OPTIONS, CATEGORY_OPTIONS } from '@/lib/types';

interface InfluencerFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => void;
  initialData?: Influencer;
  mode: 'create' | 'edit';
}

export function InfluencerForm({ open, onClose, onSubmit, initialData, mode }: InfluencerFormProps) {
  const [formData, setFormData] = useState({
    channelName: initialData?.channelName || '',
    channelUrl: initialData?.channelUrl || '',
    email: initialData?.email || '',
    country: initialData?.country || '',
    followers: initialData?.followers || 0,
    category: initialData?.category || '',
    rating: initialData?.rating || 'B' as const,
    notes: initialData?.notes || '',
    status: initialData?.status || 'talent_pool' as const,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
    if (mode === 'create') {
      setFormData({
        channelName: '',
        channelUrl: '',
        email: '',
        country: '',
        followers: 0,
        category: '',
        rating: 'B',
        notes: '',
        status: 'talent_pool',
      });
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '添加红人' : '编辑红人信息'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="channelName">频道名称 *</Label>
              <Input
                id="channelName"
                value={formData.channelName}
                onChange={(e) => setFormData({ ...formData, channelName: e.target.value })}
                placeholder="例如：Tech Review"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="channelUrl">频道链接 *</Label>
              <Input
                id="channelUrl"
                value={formData.channelUrl}
                onChange={(e) => setFormData({ ...formData, channelUrl: e.target.value })}
                placeholder="https://youtube.com/@xxx"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">联系邮箱 *</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="influencer@gmail.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">国家 *</Label>
              <Select value={formData.country} onValueChange={(v) => setFormData({ ...formData, country: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择国家" />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="followers">粉丝数</Label>
              <Input
                id="followers"
                type="number"
                value={formData.followers || ''}
                onChange={(e) => setFormData({ ...formData, followers: parseInt(e.target.value) || 0 })}
                placeholder="100000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">类目</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择类目" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rating">评级</Label>
              <Select value={formData.rating} onValueChange={(v: 'A' | 'B' | 'C') => setFormData({ ...formData, rating: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="选择评级" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A 级（优质）</SelectItem>
                  <SelectItem value="B">B 级（良好）</SelectItem>
                  <SelectItem value="C">C 级（一般）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === 'edit' && (
              <div className="space-y-2">
                <Label htmlFor="status">状态</Label>
                <Select 
                  value={formData.status} 
                  onValueChange={(v: InfluencerStatus) => setFormData({ ...formData, status: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择状态" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="talent_pool">红人库</SelectItem>
                    <SelectItem value="pending">待联系</SelectItem>
                    <SelectItem value="contacted">已联系</SelectItem>
                    <SelectItem value="interested">有意向</SelectItem>
                    <SelectItem value="negotiating">洽谈中</SelectItem>
                    <SelectItem value="confirmed">已确认</SelectItem>
                    <SelectItem value="sampling">样品中</SelectItem>
                    <SelectItem value="filming">拍摄中</SelectItem>
                    <SelectItem value="published">已发布</SelectItem>
                    <SelectItem value="archived">已归档</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">备注</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="添加备注信息..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">
              {mode === 'create' ? '添加' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
