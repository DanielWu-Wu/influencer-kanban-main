'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Influencer, KanbanColumn as ColumnType } from '@/lib/types';
import { InfluencerCard } from './influencer-card';

interface KanbanColumnProps {
  column: ColumnType;
  influencers: Influencer[];
  onEdit: (influencer: Influencer) => void;
  onDelete: (id: string) => void;
  isDragging: boolean;
}

export function KanbanColumn({ column, influencers, onEdit, onDelete, isDragging }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-[260px] rounded-2xl transition-all duration-300 flex flex-col max-h-full ${
        isOver && isDragging ? 'ring-2 ring-primary/20 bg-primary/5' : ''
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getStatusColor(column.id) }} />
          <h3 className="font-medium text-sm">{column.title}</h3>
        </div>
        <span className="text-xs text-muted-foreground bg-accent/50 px-2 py-0.5 rounded-full">
          {influencers.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 p-2">
        {influencers.map((influencer) => (
          <SortableContext key={influencer.id} items={[influencer.id]} strategy={verticalListSortingStrategy}>
            <InfluencerCard influencer={influencer} onEdit={onEdit} onDelete={onDelete} />
          </SortableContext>
        ))}

        {influencers.length === 0 && (
          <div className="text-center py-8 text-muted-foreground/50 text-sm">{'\u6682\u65e0\u7ea2\u4eba'}</div>
        )}
      </div>
    </div>
  );
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    talent_pool: '#64748b',
    pending: '#3b82f6',
    contacted: '#f59e0b',
    interested: '#f97316',
    negotiating: '#8b5cf6',
    confirmed: '#22c55e',
    sampling: '#14b8a6',
    filming: '#6366f1',
    published: '#10b981',
    archived: '#94a3b8',
  };
  return colors[status] || '#64748b';
}
