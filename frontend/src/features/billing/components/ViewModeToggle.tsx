import { LayoutGrid, Table as TableIcon, Columns } from 'lucide-react';

export type ViewMode = 'table' | 'kanban' | 'cards';

export interface ViewModeToggleProps {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  availableModes?: ViewMode[];
  className?: string;
  testIdPrefix?: string;
}

export function ViewModeToggle({
  mode,
  onChange,
  availableModes = ['table', 'kanban'],
  className = '',
  testIdPrefix = 'view-toggle',
}: ViewModeToggleProps) {
  return (
    <div
      className={`inline-flex items-center bg-[#F8FAFC] p-0 rounded-[8px] border-[#E2E8F0] divide-x divide-[#CBD5E1] ${className}`}
      data-testid="view-mode-toggle"
    >
      {availableModes.map((m) => {
        const isActive = mode === m;
        const icon =
          m === 'table' ? (
            <TableIcon className="h-3.5 w-3.5" />
          ) : m === 'kanban' ? (
            <Columns className="h-3.5 w-3.5" />
          ) : (
            <LayoutGrid className="h-3.5 w-3.5" />
          );
        const label = m === 'table' ? 'Table' : m === 'kanban' ? 'Kanban' : 'Cards';

        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs  font-bold rounded-[6px] transition-colors cursor-pointer ${
              isActive
                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs'
                : 'bg-[#F8FAFC] text-[#475569] hover:bg-[#E2E8F0] hover:text-[#1E293B]'
            }`}
            data-testid={`${testIdPrefix}-${m}`}
            data-view-mode={m}
            title={`${label} view`}
          >
            {icon}
            <span className="capitalize">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
