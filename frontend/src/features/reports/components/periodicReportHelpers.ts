/**
 * Helper utilities for Periodic Reports (Daily, Weekly, Monthly).
 */

/**
 * Shifts a calendar date (YYYY-MM-DD) by a given number of days.
 * Operates in UTC to prevent timezone shifts.
 */
export function shiftDays(dateStr: string, days: number): string {
  if (!dateStr) return dateStr;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match || !match[1] || !match[2] || !match[3]) return dateStr;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);

  const date = new Date(Date.UTC(year, month, day + days));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');

  return `${y}-${m}-${d}`;
}

/**
 * Shifts a month string (YYYY-MM) by a given number of months.
 * Operates in UTC to prevent timezone shifts.
 */
export function shiftMonths(monthStr: string, deltaMonths: number): string {
  if (!monthStr) return monthStr;
  const match = /^(\d{4})-(\d{2})$/.exec(monthStr.trim());
  if (!match || !match[1] || !match[2]) return monthStr;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;

  const date = new Date(Date.UTC(year, month + deltaMonths, 1));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');

  return `${y}-${m}`;
}

/**
 * Scrolls smoothly to a target element id if present in the document.
 */
export function scrollToReportSection(sectionId: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(sectionId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
