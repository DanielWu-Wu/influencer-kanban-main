'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Influencer,
  InfluencerStatus,
  COUNTRY_OPTIONS,
  CATEGORY_OPTIONS,
  STATUS_LABELS,
} from '@/lib/types';

interface InfluencerFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>) => void;
  initialData?: Influencer;
  mode: 'create' | 'edit';
}

const text = {
  add: '\u6dfb\u52a0 YouTube \u7ea2\u4eba',
  edit: '\u7f16\u8f91\u7ea2\u4eba\u4fe1\u606f',
  channelName: '\u9891\u9053\u540d\u79f0 *',
  channelUrl: '\u9891\u9053\u94fe\u63a5 *',
  email: '\u8054\u7cfb\u90ae\u7bb1 *',
  country: '\u56fd\u5bb6/\u5730\u533a *',
  subscribers: '\u8ba2\u9605\u6570',
  category: '\u5185\u5bb9\u7c7b\u76ee',
  rating: '\u4f18\u5148\u7ea7',
  status: '\u5408\u4f5c\u72b6\u6001',
  notes: '\u5907\u6ce8',
  notesPlaceholder: '\u8bb0\u5f55\u9891\u9053\u7279\u70b9\u3001\u62a5\u4ef7\u3001\u5408\u4f5c\u98ce\u9669\u6216\u4e0b\u4e00\u6b65\u52a8\u4f5c...',
  cancel: '\u53d6\u6d88',
  save: '\u4fdd\u5b58',
};

type InfluencerFormData = Omit<Influencer, 'id' | 'createdAt' | 'updatedAt'>;

const emptyForm: InfluencerFormData = {
  channelName: '',
  channelUrl: '',
  email: '',
  country: '',
  followers: 0,
  category: '',
  rating: 'B' as const,
  notes: '',
  status: 'talent_pool' as const,
};

export function InfluencerForm({ open, onClose, onSubmit, initialData, mode }: InfluencerFormProps) {
  const [formData, setFormData] = useState<InfluencerFormData>(emptyForm);

  useEffect(() => {
    if (initialData) {
      setFormData({
        channelName: initialData.channelName,
        channelUrl: initialData.channelUrl,
        email: initialData.email,
        country: initialData.country,
        followers: initialData.followers,
        category: initialData.category,
        rating: initialData.rating,
        notes: initialData.notes,
        status: initialData.status,
      });
    } else if (open) {
      setFormData(emptyForm);
    }
  }, [initialData, open]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit(formData);
    if (mode === 'create') setFormData(emptyForm);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? text.add : text.edit}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="channelName">{text.channelName}</Label>
              <Input
                id="channelName"
                value={formData.channelName}
                onChange={(event) => setFormData({ ...formData, channelName: event.target.value })}
                placeholder="Tech Review"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="channelUrl">{text.channelUrl}</Label>
              <Input
                id="channelUrl"
                value={formData.channelUrl}
                onChange={(event) => setFormData({ ...formData, channelUrl: event.target.value })}
                placeholder="https://youtube.com/@channel"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">{text.email}</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                placeholder="creator@gmail.com"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="country">{text.country}</Label>
              <Select value={formData.country} onValueChange={(value) => setFormData({ ...formData, country: value })}>
                <SelectTrigger>
                  <SelectValue placeholder={text.country.replace(' *', '')} />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_OPTIONS.map((country) => (
                    <SelectItem key={country} value={country}>
                      {country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="followers">{text.subscribers}</Label>
              <Input
                id="followers"
                type="number"
                value={formData.followers || ''}
                onChange={(event) => setFormData({ ...formData, followers: Number(event.target.value) || 0 })}
                placeholder="100000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">{text.category}</Label>
              <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
                <SelectTrigger>
                  <SelectValue placeholder={text.category} />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="rating">{text.rating}</Label>
              <Select
                value={formData.rating}
                onValueChange={(value: 'A' | 'B' | 'C') => setFormData({ ...formData, rating: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={text.rating} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A">A - \u4f18\u5148\u63a8\u8fdb</SelectItem>
                  <SelectItem value="B">B - \u53ef\u8ddf\u8fdb</SelectItem>
                  <SelectItem value="C">C - \u89c2\u5bdf\u5907\u9009</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === 'edit' && (
              <div className="space-y-2">
                <Label htmlFor="status">{text.status}</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value: InfluencerStatus) => setFormData({ ...formData, status: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={text.status} />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(STATUS_LABELS).map(([status, label]) => (
                      <SelectItem key={status} value={status}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">{text.notes}</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(event) => setFormData({ ...formData, notes: event.target.value })}
              placeholder={text.notesPlaceholder}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {text.cancel}
            </Button>
            <Button type="submit">{mode === 'create' ? text.add : text.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
