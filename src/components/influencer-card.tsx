'use client';

import { useState } from 'react';
import { Influencer, STATUS_LABELS } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  User,
  Mail,
  Globe,
  Users,
  MapPin,
  Tag,
  ExternalLink,
  Edit2,
  Trash2,
  Calendar,
  Star,
} from 'lucide-react';

interface InfluencerCardProps {
  influencer: Influencer;
  onEdit: (influencer: Influencer) => void;
  onDelete: (id: string) => void;
  isDragging?: boolean;
}

const text = {
  confirmDelete: '\u786e\u5b9a\u8981\u5220\u9664\u8fd9\u4e2a\u7ea2\u4eba\u5417\uff1f',
  email: '\u8054\u7cfb\u90ae\u7bb1',
  channelUrl: '\u9891\u9053\u94fe\u63a5',
  country: '\u56fd\u5bb6/\u5730\u533a',
  subscribers: '\u8ba2\u9605\u6570',
  rating: '\u4f18\u5148\u7ea7',
  category: '\u5185\u5bb9\u7c7b\u76ee',
  createdAt: '\u5efa\u6863\u4e8e',
  notes: '\u5907\u6ce8',
  edit: '\u7f16\u8f91',
  delete: '\u5220\u9664',
};

export function InfluencerCard({ influencer, onEdit, onDelete, isDragging }: InfluencerCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  const ratingConfig = {
    A: { label: 'A', color: 'bg-emerald-100 text-emerald-700' },
    B: { label: 'B', color: 'bg-amber-100 text-amber-700' },
    C: { label: 'C', color: 'bg-gray-100 text-gray-600' },
  };

  const formatFollowers = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const handleDelete = () => {
    if (confirm(text.confirmDelete)) {
      onDelete(influencer.id);
      setShowDetail(false);
    }
  };

  return (
    <>
      <Card
        className={`cursor-pointer rounded-lg border-white/65 bg-white/72 backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-apple-hover ${
          isDragging ? 'shadow-apple-hover opacity-90' : 'shadow-apple'
        }`}
        onClick={() => setShowDetail(true)}
      >
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-sm font-semibold">{influencer.channelName}</h4>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  {influencer.country || '-'}
                </span>
                <Badge className={`${ratingConfig[influencer.rating].color} rounded-md px-1.5 text-[10px]`}>
                  {ratingConfig[influencer.rating].label}
                </Badge>
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              {formatFollowers(influencer.followers)}
            </span>
            {influencer.category && (
              <span className="flex items-center gap-1">
                <Tag className="w-3 h-3" />
                {influencer.category}
              </span>
            )}
          </div>

          <div className="mt-2 inline-flex rounded-md bg-white/70 px-2 py-0.5 text-[11px] text-muted-foreground">
            {STATUS_LABELS[influencer.status]}
          </div>

          {influencer.notes && (
            <p className="mt-2 line-clamp-2 rounded-md bg-white/55 px-2 py-1.5 text-xs text-muted-foreground">
              {influencer.notes}
            </p>
          )}

          <div className="mt-2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-lg p-0 hover:bg-white/80"
              onClick={(event) => {
                event.stopPropagation();
                onEdit(influencer);
              }}
            >
              <Edit2 className="w-3 h-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 rounded-lg p-0 hover:bg-red-50 hover:text-red-500"
              onClick={(event) => {
                event.stopPropagation();
                handleDelete();
              }}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
            {influencer.channelUrl && (
              <a
                href={influencer.channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="ml-auto"
              >
                <Button variant="ghost" size="sm" className="h-8 w-8 rounded-lg p-0 hover:bg-white/80">
                  <ExternalLink className="w-3 h-3" />
                </Button>
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={showDetail} onOpenChange={setShowDetail}>
        <DialogContent className="glass-panel-strong max-w-md rounded-lg border-white/65">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              {influencer.channelName}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{text.email}</p>
                <a href={`mailto:${influencer.email}`} className="flex items-center gap-2 text-sm text-primary hover:underline">
                  <Mail className="w-4 h-4" />
                  {influencer.email}
                </a>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{text.channelUrl}</p>
                <a
                  href={influencer.channelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 truncate text-sm text-primary hover:underline"
                >
                  <Globe className="w-4 h-4 flex-shrink-0" />
                  {influencer.channelUrl}
                </a>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{text.country}</p>
                <p className="flex items-center gap-1 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground" />
                  {influencer.country || '-'}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{text.subscribers}</p>
                <p className="flex items-center gap-1 text-sm">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  {formatFollowers(influencer.followers)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{text.rating}</p>
                <Badge className={`${ratingConfig[influencer.rating].color} rounded-md`}>
                  <Star className="w-3 h-3 mr-1" />
                  {ratingConfig[influencer.rating].label}
                </Badge>
              </div>
            </div>

            {influencer.category && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{text.category}</p>
                <p className="flex items-center gap-1 text-sm">
                  <Tag className="w-4 h-4 text-muted-foreground" />
                  {influencer.category}
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="w-4 h-4" />
              {text.createdAt} {new Date(influencer.createdAt).toLocaleDateString('zh-CN')}
            </div>

            {influencer.notes && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{text.notes}</p>
                <p className="rounded-lg bg-white/65 p-3 text-sm whitespace-pre-wrap">{influencer.notes}</p>
              </div>
            )}
          </div>

          <div className="flex justify-between border-t border-white/60 pt-4">
            <Button
              variant="outline"
              className="rounded-lg bg-white/75"
              onClick={() => {
                setShowDetail(false);
                onEdit(influencer);
              }}
            >
              <Edit2 className="w-4 h-4 mr-2" />
              {text.edit}
            </Button>
            <Button variant="outline" className="rounded-lg bg-white/75 text-red-500 hover:bg-red-50 hover:text-red-600" onClick={handleDelete}>
              <Trash2 className="w-4 h-4 mr-2" />
              {text.delete}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
