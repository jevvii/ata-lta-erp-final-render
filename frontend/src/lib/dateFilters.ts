/**
 * Shared Date Filtering Utility across modules
 * Supports: all | overdue | today | this_week | this_month | no_date
 */

export const DUE_DATE_FILTER_OPTIONS = [
  { value: 'all', label: 'All Due Dates' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due Today' },
  { value: 'this_week', label: 'Due This Week' },
  { value: 'this_month', label: 'Due This Month' },
  { value: 'no_date', label: 'No Due Date' },
] as const;

export type DueDateFilterValue = typeof DUE_DATE_FILTER_OPTIONS[number]['value'];

export function matchesDueDate(
  dateStr: string | null | undefined,
  filter: string,
  isFinished = false
): boolean {
  if (!filter || filter === 'all') return true;
  if (!dateStr) return filter === 'no_date';
  if (filter === 'no_date') return false;

  const targetDate = new Date(dateStr);
  if (isNaN(targetDate.getTime())) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Normalize target date to date boundary for day comparisons
  const targetDay = new Date(targetDate);
  targetDay.setHours(0, 0, 0, 0);

  if (filter === 'overdue') {
    return targetDay < today && !isFinished;
  }
  if (filter === 'today') {
    return (
      targetDate.getDate() === today.getDate() &&
      targetDate.getMonth() === today.getMonth() &&
      targetDate.getFullYear() === today.getFullYear()
    );
  }
  if (filter === 'this_week') {
    const weekFromNow = new Date(today);
    weekFromNow.setDate(today.getDate() + 7);
    return targetDay >= today && targetDay <= weekFromNow;
  }
  if (filter === 'this_month') {
    return (
      targetDate.getMonth() === today.getMonth() &&
      targetDate.getFullYear() === today.getFullYear()
    );
  }
  return true;
}
