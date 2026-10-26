import { describe, it, expect } from 'vitest';
import { calculateDeadline } from '../lib/deadline';

describe('calculateDeadline helper', () => {
  const refDate = new Date(2026, 9, 25, 14, 30, 0); // October 25, 2026 (Month index 9 is October)

  it('handles null, undefined, empty string, and invalid dates with "—" and muted token', () => {
    expect(calculateDeadline(null, refDate)).toEqual({
      urgency: 'none',
      label: '—',
      diffDays: null,
      textClass: 'text-muted',
      barClass: 'bg-transparent',
      percent: 0,
    });

    expect(calculateDeadline(undefined, refDate)).toEqual({
      urgency: 'none',
      label: '—',
      diffDays: null,
      textClass: 'text-muted',
      barClass: 'bg-transparent',
      percent: 0,
    });

    expect(calculateDeadline('', refDate)).toEqual({
      urgency: 'none',
      label: '—',
      diffDays: null,
      textClass: 'text-muted',
      barClass: 'bg-transparent',
      percent: 0,
    });

    expect(calculateDeadline('   ', refDate)).toEqual({
      urgency: 'none',
      label: '—',
      diffDays: null,
      textClass: 'text-muted',
      barClass: 'bg-transparent',
      percent: 0,
    });

    expect(calculateDeadline('not-a-valid-date', refDate)).toEqual({
      urgency: 'none',
      label: '—',
      diffDays: null,
      textClass: 'text-muted',
      barClass: 'bg-transparent',
      percent: 0,
    });

    expect(calculateDeadline(new Date(NaN), refDate)).toEqual({
      urgency: 'none',
      label: '—',
      diffDays: null,
      textClass: 'text-muted',
      barClass: 'bg-transparent',
      percent: 0,
    });
  });

  it('marks past dates as overdue with danger tokens and "Overdue Nd"', () => {
    // 1 day overdue (yesterday)
    const res1 = calculateDeadline('2026-10-24', refDate);
    expect(res1.urgency).toBe('overdue');
    expect(res1.label).toBe('Overdue 1d');
    expect(res1.diffDays).toBe(-1);
    expect(res1.textClass).toBe('text-danger');
    expect(res1.barClass).toBe('bg-danger-solid');
    expect(res1.percent).toBe(100);

    // 5 days overdue
    const res5 = calculateDeadline('2026-10-20', refDate);
    expect(res5.urgency).toBe('overdue');
    expect(res5.label).toBe('Overdue 5d');
    expect(res5.diffDays).toBe(-5);
    expect(res5.textClass).toBe('text-danger');
    expect(res5.barClass).toBe('bg-danger-solid');
  });

  it('marks dates due today with warning tokens and "Due today"', () => {
    const resTodayStr = calculateDeadline('2026-10-25', refDate);
    expect(resTodayStr.urgency).toBe('due-today');
    expect(resTodayStr.label).toBe('Due today');
    expect(resTodayStr.diffDays).toBe(0);
    expect(resTodayStr.textClass).toBe('text-warning');
    expect(resTodayStr.barClass).toBe('bg-warning');

    const resTodayDate = calculateDeadline(new Date(2026, 9, 25, 23, 59, 59), refDate);
    expect(resTodayDate.urgency).toBe('due-today');
    expect(resTodayDate.label).toBe('Due today');
    expect(resTodayDate.diffDays).toBe(0);
  });

  it('marks dates due in <= 3 days with warning tokens and "Due in Nd"', () => {
    // Due tomorrow (1 day)
    const res1 = calculateDeadline('2026-10-26', refDate);
    expect(res1.urgency).toBe('due-soon');
    expect(res1.label).toBe('Due in 1d');
    expect(res1.diffDays).toBe(1);
    expect(res1.textClass).toBe('text-warning');
    expect(res1.barClass).toBe('bg-warning');

    // Due in 2 days
    const res2 = calculateDeadline('2026-10-27', refDate);
    expect(res2.urgency).toBe('due-soon');
    expect(res2.label).toBe('Due in 2d');
    expect(res2.diffDays).toBe(2);
    expect(res2.textClass).toBe('text-warning');

    // Due in 3 days
    const res3 = calculateDeadline('2026-10-28', refDate);
    expect(res3.urgency).toBe('due-soon');
    expect(res3.label).toBe('Due in 3d');
    expect(res3.diffDays).toBe(3);
    expect(res3.textClass).toBe('text-warning');
  });

  it('marks dates due in > 3 days with success tokens and "Due in Nd"', () => {
    // Due in 4 days
    const res4 = calculateDeadline('2026-10-29', refDate);
    expect(res4.urgency).toBe('normal');
    expect(res4.label).toBe('Due in 4d');
    expect(res4.diffDays).toBe(4);
    expect(res4.textClass).toBe('text-success');
    expect(res4.barClass).toBe('bg-success');

    // Due in 14 days
    const res14 = calculateDeadline('2026-11-08', refDate);
    expect(res14.urgency).toBe('normal');
    expect(res14.label).toBe('Due in 14d');
    expect(res14.diffDays).toBe(14);
    expect(res14.textClass).toBe('text-success');
    expect(res14.barClass).toBe('bg-success');
  });
});
