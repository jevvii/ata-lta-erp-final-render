import React from 'react';
import { getPhaseBadgeInfo } from '../lib/statusBadges';
import type { SelectableTaskOption } from '../hooks/useSelectableTasks';

export function TaskOptionContent({ option }: { option: SelectableTaskOption }) {
  const phaseInfo = getPhaseBadgeInfo(option.phaseSlug || option.task?.phase);

  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="font-medium text-[#1E293B] truncate">
        {option.title} — {option.assigneeText}
        {!option.isAssigned ? (
          <span className="sr-only"> (Not assigned to you)</span>
        ) : null}
      </span>
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] border text-[11px] font-medium shrink-0 ${phaseInfo.badgeClass}`}
        data-testid={`task-option-phase-pill-${option.id}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${phaseInfo.dotClass}`} />
        <span>{phaseInfo.label}</span>
      </span>
      {option.isPhaseLocked ? (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] shrink-0"
          data-testid={`task-option-status-pill-${option.id}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
          <span>Upcoming Phase (Locked)</span>
          <span className="sr-only">{` (Locked: ${option.phaseLabel} phase not active)`}</span>
        </span>
      ) : option.isPrereqLocked ? (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] shrink-0"
          data-testid={`task-option-status-pill-${option.id}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
          <span>Waiting on Prerequisite</span>
          <span className="sr-only"> (Locked: Waiting on prerequisite task)</span>
        </span>
      ) : !option.isAssigned ? (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-300 shrink-0"
          data-testid={`task-option-status-pill-${option.id}`}
        >
          <span>(Not assigned to you)</span>
        </span>
      ) : option.isPastPhase ? (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0] shrink-0"
          data-testid={`task-option-status-pill-${option.id}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
          <span>Phase Completed</span>
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-[11px] font-semibold bg-[#EFF6FF] text-[#1D4ED8] border border-[#93C5FD] shrink-0"
          data-testid={`task-option-status-pill-${option.id}`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB]" />
          <span>Active Phase</span>
        </span>
      )}
    </span>
  );
}
