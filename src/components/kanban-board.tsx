'use client';

import { useState, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Influencer, KANBAN_COLUMNS } from '@/lib/types';
import { KanbanColumn } from './kanban-column';
import { InfluencerCard } from './influencer-card';

interface KanbanBoardProps {
  influencers: Influencer[];
  onUpdateStatus: (id: string, status: Influencer['status']) => void;
  onEdit: (influencer: Influencer) => void;
  onDelete: (id: string) => void;
}

export function KanbanBoard({ influencers, onUpdateStatus, onEdit, onDelete }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const groupedInfluencers = useMemo(() => {
    const groups: Record<string, Influencer[]> = {};
    KANBAN_COLUMNS.forEach((column) => {
      groups[column.id] = influencers.filter((influencer) => influencer.status === column.id);
    });
    return groups;
  }, [influencers]);

  const activeInfluencer = activeId ? influencers.find((influencer) => influencer.id === activeId) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      return;
    }

    const draggedInfluencer = influencers.find((influencer) => influencer.id === active.id);
    if (!draggedInfluencer) {
      setActiveId(null);
      return;
    }

    let targetStatus: Influencer['status'];
    const isColumn = KANBAN_COLUMNS.some((column) => column.id === over.id);

    if (isColumn) {
      targetStatus = over.id as Influencer['status'];
    } else {
      const overInfluencer = influencers.find((influencer) => influencer.id === over.id);
      if (!overInfluencer) {
        setActiveId(null);
        return;
      }
      targetStatus = overInfluencer.status;
    }

    if (draggedInfluencer.status !== targetStatus) {
      onUpdateStatus(draggedInfluencer.id, targetStatus);
    }

    setActiveId(null);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 min-w-0">
        {KANBAN_COLUMNS.map((column) => (
          <SortableContext
            key={column.id}
            id={column.id}
            items={groupedInfluencers[column.id]?.map((influencer) => influencer.id) || []}
            strategy={verticalListSortingStrategy}
          >
            <KanbanColumn
              column={column}
              influencers={groupedInfluencers[column.id] || []}
              onEdit={onEdit}
              onDelete={onDelete}
              isDragging={activeId !== null}
            />
          </SortableContext>
        ))}
      </div>

      <DragOverlay>
        {activeInfluencer ? (
          <div className="w-[260px]">
            <InfluencerCard influencer={activeInfluencer} onEdit={() => {}} onDelete={() => {}} isDragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
