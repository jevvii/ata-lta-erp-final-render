/**
 * Reports service unit tests.
 * Tests for date range calculations and aging bucket logic.
 */

describe('Reports Service', () => {
  describe('Week bounds calculation', () => {
    const getWeekBounds = (dateStr) => {
      const d = new Date(dateStr + 'T12:00:00Z'); // Use noon UTC to avoid timezone edge
      const day = d.getUTCDay();
      const diffToMon = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() + diffToMon);

      const sunday = new Date(monday);
      sunday.setUTCDate(monday.getUTCDate() + 6);

      const fmt = (dt) => dt.toISOString().slice(0, 10);
      return { start: fmt(monday), end: fmt(sunday) };
    };

    it('returns Monday to Sunday for a mid-week date (Wednesday)', () => {
      // 2026-01-07 is a Wednesday
      const { start, end } = getWeekBounds('2026-01-07');
      expect(start).toBe('2026-01-05'); // Monday
      expect(end).toBe('2026-01-11'); // Sunday
    });

    it('returns correct bounds for a Monday', () => {
      const { start, end } = getWeekBounds('2026-01-05');
      expect(start).toBe('2026-01-05');
      expect(end).toBe('2026-01-11');
    });

    it('returns correct bounds for a Sunday', () => {
      const { start, end } = getWeekBounds('2026-01-11');
      expect(start).toBe('2026-01-05');
      expect(end).toBe('2026-01-11');
    });

    it('handles month boundary correctly', () => {
      // 2026-02-01 is a Sunday
      const { start, end } = getWeekBounds('2026-02-01');
      expect(start).toBe('2026-01-26');
      expect(end).toBe('2026-02-01');
    });
  });

  describe('Aging bucket categorization', () => {
    const categorize = (daysOverdue) => {
      if (daysOverdue <= 0) return 'current';
      if (daysOverdue <= 30) return '1-30';
      if (daysOverdue <= 60) return '31-60';
      if (daysOverdue <= 90) return '61-90';
      return '90+';
    };

    it('categorizes not-yet-due as current', () => {
      expect(categorize(-5)).toBe('current');
      expect(categorize(0)).toBe('current');
    });

    it('categorizes 1-30 days overdue', () => {
      expect(categorize(1)).toBe('1-30');
      expect(categorize(15)).toBe('1-30');
      expect(categorize(30)).toBe('1-30');
    });

    it('categorizes 31-60 days overdue', () => {
      expect(categorize(31)).toBe('31-60');
      expect(categorize(45)).toBe('31-60');
      expect(categorize(60)).toBe('31-60');
    });

    it('categorizes 61-90 days overdue', () => {
      expect(categorize(61)).toBe('61-90');
      expect(categorize(75)).toBe('61-90');
      expect(categorize(90)).toBe('61-90');
    });

    it('categorizes 90+ days overdue', () => {
      expect(categorize(91)).toBe('90+');
      expect(categorize(180)).toBe('90+');
      expect(categorize(365)).toBe('90+');
    });
  });
});
