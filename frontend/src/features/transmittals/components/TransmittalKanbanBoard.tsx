/**
 * Native HTML5 Kanban Board for Transmittals
 *
 * Swimlanes: Draft | Sent | Acknowledged
 * Zero third-party DnD libraries — native HTML5 drag-and-drop.
 * Persists board_order on drop via useUpdateTransmittal.
 */

import React, { useState } from 'react';
import { Clock, Send, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TransmittalCard } from './TransmittalCard';
import { useUpdateTransmittal } from '../api/useTransmittals';
import type { Transmittal, TransmittalStatus } from '../api/types';

export interface TransmittalKanbanBoardProps {
  transmittals: Transmittal[];
  isLoading?: boolean;
  onView: (id: string) => void;
  onEdit: (transmittal: Transmittal) => void;
  onPrint: (transmittal: Transmittal) => void;
  onApprove: (id: string) => void;
  onSend: (transmittal: Transmittal) => void;
  onAcknowledge: (transmittal: Transmittal) => void;
  onDelete: (id: string) => void;
}

interface ColumnConfig {
  id: TransmittalStatus;
  title: string;
  icon: React.ElementType;
  badgeBg: string;
  badgeText: string;
  headerBorder: string;
}

const COLUMNS: ColumnConfig[] = [
  {
    id: 'Draft',
    title: 'Draft',
    icon: Clock,
    badgeBg: 'bg-[#F8FAFC]',
    badgeText: 'text-[#1E293B]',
    headerBorder: 'border-[#E2E8F0]',
  },
  {
    id: 'Sent',
    title: 'Sent',
    icon: Send,
    badgeBg: 'bg-[#F8FAFC]',
    badgeText: 'text-[#1E293B]',
    headerBorder: 'border-blue-400',
  },
  {
    id: 'Acknowledged',
    title: 'Acknowledged',
    icon: CheckCircle2,
    badgeBg: 'bg-emerald-50',
    badgeText: 'text-emerald-700',
    headerBorder: 'border-emerald-400',
  },
];

export function TransmittalKanbanBoard({
  transmittals,
  isLoading = false,
  onView,
  onEdit,
  onPrint,
  onApprove,
  onSend,
  onAcknowledge,
  onDelete,
}: TransmittalKanbanBoardProps) {
  const updateMutation = useUpdateTransmittal();

  // Native HTML5 Drag and drop state
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<TransmittalStatus | null>(null);

  // Group transmittals by status, sorted by board_order ASC then created_at DESC
  const columnsData = React.useMemo(() => {
    const map: Record<TransmittalStatus, Transmittal[]> = {
      Draft: [],
      Sent: [],
      Acknowledged: [],
      Cancelled: [],
    };

    for (const item of transmittals) {
      if (map[item.status]) {
        map[item.status].push(item);
      }
    }

    // Sort within each column
    for (const key of Object.keys(map) as TransmittalStatus[]) {
      map[key].sort((a, b) => {
        const orderA = a.board_order ?? 0;
        const orderB = b.board_order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }

    return map;
  }, [transmittals]);

  // Handle Drag Start
  const handleDragStart = (e: React.DragEvent, item: Transmittal) => {
    setDraggedCardId(item.id);
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Handle Drag Over column
  const handleColumnDragOver = (e: React.DragEvent, status: TransmittalStatus) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverColumnId !== status) {
      setDragOverColumnId(status);
    }
  };

  // Handle Drag Leave
  const handleColumnDragLeave = (e: React.DragEvent, status: TransmittalStatus) => {
    // Only clear if leaving the column boundary
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (
      e.clientX < rect.left ||
      e.clientX >= rect.right ||
      e.clientY < rect.top ||
      e.clientY >= rect.bottom
    ) {
      if (dragOverColumnId === status) {
        setDragOverColumnId(null);
      }
    }
  };

  // Handle Drop onto a Column or onto another Card
  const handleDrop = async (
    e: React.DragEvent,
    targetStatus: TransmittalStatus,
    targetTransmittal?: Transmittal
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const activeId = draggedCardId || e.dataTransfer.getData('text/plain');
    setDraggedCardId(null);
    setDragOverColumnId(null);

    if (!activeId) return;

    // Find dragged transmittal
    const draggedItem = transmittals.find((t) => t.id === activeId);
    if (!draggedItem) return;

    // Intra-column reordering or drop
    const targetItems = columnsData[targetStatus] || [];

    let newBoardOrder = 0;
    if (targetTransmittal) {
      // Dropped directly on another transmittal card
      if (targetTransmittal.id === activeId) return;
      const targetIndex = targetItems.findIndex((t) => t.id === targetTransmittal.id);
      newBoardOrder = (targetTransmittal.board_order ?? targetIndex) + 1;
    } else {
      // Dropped on column container
      if (targetItems.length > 0) {
        const lastItem = targetItems[targetItems.length - 1];
        newBoardOrder = (lastItem?.board_order ?? targetItems.length) + 1;
      } else {
        newBoardOrder = 0;
      }
    }

    // Persist board_order update via non-dismissible blocking mutation (Zero Optimistic Updates)
    await updateMutation.mutateAsync({
      id: activeId,
      data: {
        boardOrder: newBoardOrder,
      },
    });
  };

  return (
    <div
      className="grid grid-cols-1 md:grid-cols-3 gap-6"
      data-testid="transmittal-kanban-board"
    >
      {COLUMNS.map((col) => {
        const items = columnsData[col.id] || [];
        const Icon = col.icon;
        const isDragOver = dragOverColumnId === col.id;

        return (
          <div
            key={col.id}
            className={`flex flex-col rounded-[6px] bg-[#F8FAFC] border-[#E2E8F0] transition-colors ${
              isDragOver ? 'ring-2 ring-blue-500 bg-[#F8FAFC]/20' : ''
            }`}
            data-testid={`kanban-column-${col.id.toLowerCase()}`}
            onDragOver={(e) => handleColumnDragOver(e, col.id)}
            onDragLeave={(e) => handleColumnDragLeave(e, col.id)}
            onDrop={(e) => handleDrop(e, col.id)}
          >
            {/* Column Header */}
            <div
              className={`p-4 border-b bg-white rounded-t-xl flex items-center justify-between border-t-4 ${col.headerBorder}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-[#475569]" />
                <h3 className="font-semibold text-[#1E293B] text-sm">{col.title}</h3>
              </div>
              <Badge
                variant="secondary"
                className={`${col.badgeBg} ${col.badgeText} font-semibold text-xs`}
                data-testid={`kanban-count-${col.id.toLowerCase()}`}
              >
                {items.length}
              </Badge>
            </div>

            {/* Cards container */}
            <div className="p-3 flex-1 flex flex-col gap-3 min-h-[350px]">
              {isLoading && items.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#475569]">Loading transmittals...</div>
              ) : items.length === 0 ? (
                <div
                  className="flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-[#E2E8F0] rounded-[6px] text-center text-[#475569]"
                  data-testid={`empty-column-${col.id.toLowerCase()}`}
                >
                  <Icon className="h-6 w-6 stroke-1 text-[#94A3B8] mb-2" />
                  <p className="text-xs font-medium">No transmittals</p>
                  <p className="text-xs text-[#475569] mt-0.5">Drag cards here</p>
                </div>
              ) : (
                items.map((item) => (
                  <TransmittalCard
                    key={item.id}
                    transmittal={item}
                    draggable={true}
                    onDragStart={handleDragStart}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => handleDrop(e, col.id, item)}
                    onView={onView}
                    onEdit={onEdit}
                    onPrint={onPrint}
                    onApprove={onApprove}
                    onSend={onSend}
                    onAcknowledge={onAcknowledge}
                    onDelete={onDelete}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
