/**
 * Pure helper for deadline calculations in local calendar days.
 *
 * Rules:
 * - Overdue: diffDays < 0 → danger tokens + "Overdue Nd"
 * - Due in <= 3 days:
 *     diffDays === 0 → warning + "Due today"
 *     0 < diffDays <= 3 → warning + "Due in Nd"
 * - Due in > 3 days: success + "Due in Nd"
 * - No date (null / undefined / empty / invalid): "—" muted
 */

export type DeadlineUrgency = 'overdue' | 'due-today' | 'due-soon' | 'normal' | 'none';

export interface DeadlineInfo {
  urgency: DeadlineUrgency;
  label: string;
  diffDays: number | null;
  textClass: string;
  barClass: string;
  percent: number;
}

export function calculateDeadline(
  dueDate: string | Date | null | undefined,
  referenceDate: Date = new Date()
): DeadlineInfo {
  if (!dueDate) {
    return {
      urgency: 'none',
      label: '—',
      diffDays: null,
      textClass: 'text-muted',
      barClass: 'bg-transparent',
      percent: 0,
    };
  }

  let dueYear: number;
  let dueMonth: number;
  let dueDay: number;

  if (typeof dueDate === 'string') {
    const trimmed = dueDate.trim();
    if (!trimmed) {
      return {
        urgency: 'none',
        label: '—',
        diffDays: null,
        textClass: 'text-muted',
        barClass: 'bg-transparent',
        percent: 0,
      };
    }

    // Match YYYY-MM-DD pattern at the beginning of the string to avoid timezone shifting
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (match) {
      dueYear = Number(match[1]);
      dueMonth = Number(match[2]) - 1;
      dueDay = Number(match[3]);
    } else {
      const parsed = new Date(trimmed);
      if (isNaN(parsed.getTime())) {
        return {
          urgency: 'none',
          label: '—',
          diffDays: null,
          textClass: 'text-muted',
          barClass: 'bg-transparent',
          percent: 0,
        };
      }
      dueYear = parsed.getFullYear();
      dueMonth = parsed.getMonth();
      dueDay = parsed.getDate();
    }
  } else if (dueDate instanceof Date) {
    if (isNaN(dueDate.getTime())) {
      return {
        urgency: 'none',
        label: '—',
        diffDays: null,
        textClass: 'text-muted',
        barClass: 'bg-transparent',
        percent: 0,
      };
    }
    dueYear = dueDate.getFullYear();
    dueMonth = dueDate.getMonth();
    dueDay = dueDate.getDate();
  } else {
    return {
      urgency: 'none',
      label: '—',
      diffDays: null,
      textClass: 'text-muted',
      barClass: 'bg-transparent',
      percent: 0,
    };
  }

  // Calculate local calendar day difference (zeroing out time components)
  const targetDay = new Date(dueYear, dueMonth, dueDay);
  const baseDay = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );

  const diffMs = targetDay.getTime() - baseDay.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      urgency: 'overdue',
      label: `Overdue ${Math.abs(diffDays)}d`,
      diffDays,
      textClass: 'text-danger',
      barClass: 'bg-danger-solid',
      percent: 100,
    };
  }

  if (diffDays === 0) {
    return {
      urgency: 'due-today',
      label: 'Due today',
      diffDays: 0,
      textClass: 'text-warning',
      barClass: 'bg-warning',
      percent: 100,
    };
  }

  if (diffDays <= 3) {
    return {
      urgency: 'due-soon',
      label: `Due in ${diffDays}d`,
      diffDays,
      textClass: 'text-warning',
      barClass: 'bg-warning',
      percent: diffDays === 1 ? 80 : diffDays === 2 ? 60 : 40,
    };
  }

  return {
    urgency: 'normal',
    label: `Due in ${diffDays}d`,
    diffDays,
    textClass: 'text-success',
    barClass: 'bg-success',
    percent: 25,
  };
}
