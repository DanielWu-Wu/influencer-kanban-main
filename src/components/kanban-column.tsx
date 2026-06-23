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
      className={`glass-panel-soft flex max-h-full w-[260px] flex-shrink-0 flex-col rounded-lg transition-all duration-300 ${
        isOver && isDragging ? 'ring-2 ring-primary/25 bg-primary/5' : ''
      }`}
    >
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: getStatusColor(column.id) }} />
          <h3 className="text-sm font-semibold">{column.title}</h3>
        </div>
        <span className="rounded-md bg-white/75 px-2 py-0.5 text-xs text-muted-foreground">
          {influencers.length}
        </span>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {influencers.map((influencer) => (
          <SortableContext key={influencer.id} items={[influencer.id]} strategy={verticalListSortingStrategy}>
            <InfluencerCard influencer={influencer} onEdit={onEdit} onDelete={onDelete} />
          </SortableContext>
        ))}

        {influencers.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/70 bg-white/35 py-8 text-center text-sm text-muted-foreground/65">
            {'\u6682\u65e0\u7ea2\u4eba'}
          </div>
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
