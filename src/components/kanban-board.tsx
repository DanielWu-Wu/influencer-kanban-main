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
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // 按状态分组红人
  const groupedInfluencers = useMemo(() => {
    const groups: Record<string, Influencer[]> = {};
    KANBAN_COLUMNS.forEach(col => {
      groups[col.id] = influencers.filter(i => i.status === col.id);
    });
    return groups;
  }, [influencers]);

  // 当前拖拽的红人
  const activeInfluencer = activeId 
    ? influencers.find(i => i.id === activeId) 
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over) {
      setActiveId(null);
      return;
    }

    const activeInfluencer = influencers.find(i => i.id === active.id);
    if (!activeInfluencer) {
      setActiveId(null);
      return;
    }

    // 判断目标状态
    let targetStatus: Influencer['status'];
    
    // over.id 可能是列ID或另一个卡片的ID
    const isColumn = KANBAN_COLUMNS.some(col => col.id === over.id);
    
    if (isColumn) {
      targetStatus = over.id as Influencer['status'];
    } else {
      // 拖到另一个卡片上，获取那个卡片所在列
      const overInfluencer = influencers.find(i => i.id === over.id);
      if (overInfluencer) {
        targetStatus = overInfluencer.status;
      } else {
        setActiveId(null);
        return;
      }
    }

    // 如果状态变化则更新
    if (activeInfluencer.status !== targetStatus) {
      onUpdateStatus(activeInfluencer.id, targetStatus);
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
            items={groupedInfluencers[column.id]?.map(i => i.id) || []}
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
            <InfluencerCard
              influencer={activeInfluencer}
              onEdit={() => {}}
              onDelete={() => {}}
              isDragging
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
