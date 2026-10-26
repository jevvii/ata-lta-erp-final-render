import { CheckSquare, Receipt, FileText, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type CanonicalTaskTypeValue = '' | 'billing' | 'documents';

export interface TaskTypeOption {
  value: CanonicalTaskTypeValue;
  label: string;
  fullLabel: string;
  Icon: LucideIcon;
  iconClass: string;
  badgeClass: string;
}

export const TASK_TYPE_OPTIONS: readonly TaskTypeOption[] = [
  {
    value: '',
    label: 'Task',
    fullLabel: 'Standard Task',
    Icon: CheckSquare,
    iconClass: 'text-[#3B82F6]',
    badgeClass: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]',
  },
  {
    value: 'billing',
    label: 'Billing',
    fullLabel: 'Billing',
    Icon: Receipt,
    iconClass: 'text-[#D97706]',
    badgeClass: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]',
  },
  {
    value: 'documents',
    label: 'Documents',
    fullLabel: 'Documents',
    Icon: FileText,
    iconClass: 'text-[#0369A1]',
    badgeClass: 'bg-[#F0F9FF] text-[#0369A1] border-[#BAE6FD]',
  },
] as const;

export function normalizeTaskTypeValue(value?: string | null): CanonicalTaskTypeValue {
  if (!value) return '';
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'task' || v === 'standard') return '';
  if (v === 'billing' || v === 'invoice') return 'billing';
  if (v === 'documents' || v === 'document') return 'documents';
  return '';
}

export function getTaskTypeMeta(value?: string | null): TaskTypeOption {
  const normalized = normalizeTaskTypeValue(value);
  if (normalized === 'billing') return TASK_TYPE_OPTIONS[1]!;
  if (normalized === 'documents') return TASK_TYPE_OPTIONS[2]!;
  if (value) {
    const lower = value.trim().toLowerCase();
    if (lower === 'transmittal') return TASK_TYPE_OPTIONS[2]!;
    if (lower === 'disbursement') return TASK_TYPE_OPTIONS[1]!;
  }
  return TASK_TYPE_OPTIONS[0]!;
}

export interface TaskTypeSelectProps {
  value?: string | null;
  onChange: (value: CanonicalTaskTypeValue) => void;
  disabled?: boolean;
  'data-testid'?: string;
  ariaLabel?: string;
  showLabel?: boolean;
  className?: string;
}

export function TaskTypeSelect({
  value,
  onChange,
  disabled = false,
  'data-testid': testId,
  ariaLabel = 'Task type',
  showLabel = false,
  className = '',
}: TaskTypeSelectProps) {
  const normalized = normalizeTaskTypeValue(value);
  const meta = getTaskTypeMeta(value);
  const Icon = meta.Icon;

  return (
    <label
      className={`relative inline-flex items-center gap-1 h-7 px-1.5 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F1F5F9] hover:border-[#CBD5E1] text-xs font-medium text-[#1E293B] cursor-pointer transition-colors shrink-0 focus-within:ring-1 focus-within:ring-[#1D4ED8] ${
        disabled ? 'opacity-60 cursor-not-allowed pointer-events-none' : ''
      } ${className}`}
      title={meta.fullLabel}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${meta.iconClass}`} aria-hidden="true" />
      {showLabel && <span className="text-xs text-[#1E293B] leading-none">{meta.label}</span>}
      <ChevronDown className="h-3 w-3 text-[#64748B] shrink-0" aria-hidden="true" />
      <select
        aria-label={ariaLabel}
        value={normalized}
        disabled={disabled}
        onChange={(event) => onChange(normalizeTaskTypeValue(event.target.value))}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        data-testid={testId}
      >
        {TASK_TYPE_OPTIONS.map((opt) => (
          <option key={opt.value || 'task'} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface TaskTypeBadgeProps {
  value?: string | null;
  showStandardLabel?: boolean;
  'data-testid'?: string;
  className?: string;
}

export function TaskTypeBadge({
  value,
  showStandardLabel = false,
  'data-testid': testId,
  className = '',
}: TaskTypeBadgeProps) {
  const normalized = normalizeTaskTypeValue(value);
  const meta = getTaskTypeMeta(value);
  const Icon = meta.Icon;

  if (normalized === '' && !showStandardLabel) {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
        title={meta.fullLabel}
        data-testid={testId}
      >
        <Icon className={`h-3.5 w-3.5 ${meta.iconClass}`} role="img" aria-label={meta.fullLabel} />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] text-xs font-medium border shrink-0 ${meta.badgeClass} ${className}`}
      title={meta.fullLabel}
      data-testid={testId}
    >
      <Icon className={`h-3 w-3 shrink-0 ${meta.iconClass}`} aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
