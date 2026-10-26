/**
 * Formatting and date utility helpers for reports feature.
 * Strictly separates missing data ('—') from genuine zero ('₱0.00' / 0).
 */

export interface FormatCurrencyOptions {
  fallback?: string;
}

/**
 * Formats a monetary amount into Philippine Pesos (₱).
 * - Genuine zero (0, '0') -> '₱0.00'
 * - Missing / undefined / null / NaN -> '—' (or custom fallback)
 * - Positive (12500) -> '₱12,500.00'
 * - Negative (-12500) -> '-₱12,500.00'
 */
export function formatCurrency(
  amount: number | string | undefined | null,
  options?: FormatCurrencyOptions
): string {
  const fallback = options?.fallback ?? '—';
  if (amount === undefined || amount === null || amount === '') {
    return fallback;
  }

  const num = typeof amount === 'number' ? amount : Number(amount);
  if (Number.isNaN(num)) {
    return fallback;
  }

  const isNegative = num < 0;
  const absVal = Math.abs(num);
  const formatted = absVal.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return isNegative ? `-₱${formatted}` : `₱${formatted}`;
}

/**
 * Formats a record count or integer value.
 * - Genuine zero (0, '0') -> '0'
 * - Missing / undefined / null / NaN -> '—'
 * - Positive integer (42) -> '42'
 */
export function formatCount(
  count: number | string | undefined | null,
  options?: { fallback?: string }
): string {
  const fallback = options?.fallback ?? '—';
  if (count === undefined || count === null || count === '') {
    return fallback;
  }

  const num = typeof count === 'number' ? count : Number(count);
  if (Number.isNaN(num)) {
    return fallback;
  }

  return Math.round(num).toLocaleString('en-PH');
}

/**
 * Parses and formats a calendar-only date (YYYY-MM-DD) or ISO timestamp into 'MMM D, YYYY' (e.g., 'Oct 17, 2026').
 * Strictly avoids UTC conversion drift for calendar-only dates.
 */
export function formatManilaDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '—';

  // Fast path: calendar-only YYYY-MM-DD
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (match && match[1] && match[2] && match[3]) {
    const year = match[1];
    const month = match[2];
    const day = match[3];
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    const monthIndex = parseInt(month, 10) - 1;
    const monthName = months[monthIndex];
    if (monthName) {
      return `${monthName} ${parseInt(day, 10)}, ${year}`;
    }
  }

  // Fallback: parse as Date with Asia/Manila timezone
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d);
  } catch {
    return dateStr;
  }
}

/** Alias for backward compatibility with existing report consumers */
export const formatDate = formatManilaDate;

export function formatDateIso(dateStr: string | undefined | null): string {
  if (!dateStr) return '—';
  return dateStr.slice(0, 10);
}

/**
 * Formats a month string (YYYY-MM) into 'MMMM YYYY' (e.g., 'October 2026').
 */
export function formatMonth(monthStr: string | undefined | null): string {
  if (!monthStr) return '—';
  const match = /^(\d{4})-(\d{2})/.exec(monthStr.trim());
  if (match && match[1] && match[2]) {
    const year = match[1];
    const month = match[2];
    const fullMonths = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const monthIndex = parseInt(month, 10) - 1;
    const monthName = fullMonths[monthIndex];
    if (monthName) {
      return `${monthName} ${year}`;
    }
  }
  return monthStr;
}

/**
 * Formats a date range into a concise string, e.g. 'Oct 12 – Oct 18, 2026'.
 */
export function formatDateRange(
  startStr: string | undefined | null,
  endStr: string | undefined | null
): string {
  const start = formatManilaDate(startStr);
  const end = formatManilaDate(endStr);
  if (start === '—' && end === '—') return '—';
  if (start === '—') return end;
  if (end === '—') return start;
  return `${start} – ${end}`;
}

/**
 * Returns current date in Asia/Manila working timezone as YYYY-MM-DD.
 */
export function getTodayString(): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Returns current month in Asia/Manila working timezone as YYYY-MM.
 */
export function getCurrentMonthString(): string {
  return getTodayString().slice(0, 7);
}

/**
 * Computes Monday (start) and Sunday (end) of the week containing a date.
 * Parity implementation matching backend service.
 */
export function getWeekBounds(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMon);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
}

/**
 * Sanitizes a string for safe CSV export, preventing CSV formula injection (CWE-1236).
 * Trigger characters: '=', '+', '-', '@', '\t', '\r'
 */
export function escapeCsvCell(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  const formulaTriggers = ['=', '+', '-', '@', '\t', '\r'];
  const sanitized = formulaTriggers.includes(str.charAt(0)) ? `'${str}` : str;
  return `"${sanitized.replace(/"/g, '""')}"`;
}
