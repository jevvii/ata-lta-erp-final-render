import type { ChecklistItemInput } from '../api/types';

/** Send editable fields only, preserving metadata without echoing time history. */
export function toChecklistInput(item: Omit<ChecklistItemInput, 'periodYear'> & {
  periodYear?: string | number | null;
}): ChecklistItemInput {
  return {
    id: item.id,
    text: item.text.trim(),
    completed: item.completed,
    category: item.category,
    assigneeId: item.assigneeId,
    assigneeName: item.assigneeName,
    dependsOn: item.dependsOn,
    periodYear: item.periodYear == null ? item.periodYear : String(item.periodYear),
  };
}
