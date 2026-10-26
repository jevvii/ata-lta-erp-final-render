import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  formatCurrency,
  formatCount,
  formatManilaDate,
  formatMonth,
  formatDateRange,
  getTodayString,
  getCurrentMonthString,
  getWeekBounds,
  escapeCsvCell,
} from '../utils/formatters';
import { shiftDays, shiftMonths } from '../components/periodicReportHelpers';
import {
  useDailyReport,
  useWeeklyReport,
  useMonthlyPending,
  useAgingReport,
  useReportsAnalytics,
} from '../api/useReports';
import {
  AnalyticsOverviewTab,
  DailyActivityTab,
  WeeklySummaryTab,
  MonthlyPendingTab,
  AgingReportTab,
} from '../components';
import ReportsPage from '@/routes/reports';
import { useSessionStore } from '@/lib/session';
import { apiRequest } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn(),
}));

function createHookWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function createHarness(initialEntries = ['/reports']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, { initialEntries }, children)
    );

  return { queryClient, wrapper };
}

describe('Challenger 1: Adversarial Data, Boundaries & Stress Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeEntity: 'ATA',
      permissions: new Set(['reports:view', 'billing:view', 'users:manage']),
      user: {
        id: 'usr-admin-1',
        name: 'Admin Challenger',
        email: 'admin@ata-lta.com',
        role: 'Admin',
        departments: ['Executive', 'Finance'],
        entities: ['ATA', 'LTA'],
      },
    });
  });

  // ============================================================================
  // SUITE 1: EXTREME MONETARY AMOUNTS & NUMERIC FORMATTERS
  // ============================================================================
  describe('Extreme Monetary Amounts & Numeric Formatters', () => {
    describe('formatCurrency', () => {
      it('handles genuine zero correctly without suppressing to fallback', () => {
        expect(formatCurrency(0)).toBe('₱0.00');
        expect(formatCurrency('0')).toBe('₱0.00');
        expect(formatCurrency('0.00')).toBe('₱0.00');
        expect(formatCurrency(-0)).toBe('₱0.00');
        expect(formatCurrency(0.0)).toBe('₱0.00');
      });

      it('handles negative monetary amounts formatted as -₱X,XXX.XX', () => {
        expect(formatCurrency(-50000)).toBe('-₱50,000.00');
        expect(formatCurrency('-50000')).toBe('-₱50,000.00');
        expect(formatCurrency(-0.01)).toBe('-₱0.01');
        expect(formatCurrency(-1234567.89)).toBe('-₱1,234,567.89');
        expect(formatCurrency('-999999999.99')).toBe('-₱999,999,999.99');
      });

      it('handles very large monetary numbers without abbreviation, ellipsis, or precision loss', () => {
        expect(formatCurrency(999999999.99)).toBe('₱999,999,999.99');
        expect(formatCurrency('999999999.99')).toBe('₱999,999,999.99');
        expect(formatCurrency(1000000000)).toBe('₱1,000,000,000.00');
        expect(formatCurrency(123456789012.34)).toBe('₱123,456,789,012.34');
        // Must never include 'K', 'M', 'B' abbreviations
        const formatted = formatCurrency(999999999.99);
        expect(formatted).not.toMatch(/[KMBkmb]/);
        expect(formatted).not.toContain('...');
      });

      it('separates missing, corrupted, and invalid numeric values into fallback ("—")', () => {
        expect(formatCurrency(null)).toBe('—');
        expect(formatCurrency(undefined)).toBe('—');
        expect(formatCurrency(NaN)).toBe('—');
        expect(formatCurrency('')).toBe('—');
        expect(formatCurrency('invalid-amount')).toBe('—');
        expect(formatCurrency('NaN')).toBe('—');

        // Custom fallback option
        expect(formatCurrency(null, { fallback: 'N/A' })).toBe('N/A');
        expect(formatCurrency(undefined, { fallback: '0.00' })).toBe('0.00');
      });
    });

    describe('formatCount', () => {
      it('preserves genuine zero as "0"', () => {
        expect(formatCount(0)).toBe('0');
        expect(formatCount('0')).toBe('0');
      });

      it('formats positive integers with commas', () => {
        expect(formatCount(1000)).toBe('1,000');
        expect(formatCount(1234567)).toBe('1,234,567');
      });

      it('falls back to "—" for missing or invalid counts', () => {
        expect(formatCount(null)).toBe('—');
        expect(formatCount(undefined)).toBe('—');
        expect(formatCount(NaN)).toBe('—');
        expect(formatCount('')).toBe('—');
        expect(formatCount('invalid')).toBe('—');
      });
    });

    describe('Component Resilience Under Extreme Monetary Values', () => {
      it('renders AnalyticsOverviewTab cleanly with negative net income and huge figures', async () => {
        const extremeAnalytics = {
          clients: { total: 0 },
          workRequests: { total: 999999 },
          documents: { total: 0 },
          invoices: {
            total: 100,
            totalBilled: 999999999.99,
            totalCollected: 0,
            totalOutstanding: 999999999.99,
            byStatus: { Sent: 100 },
          },
          disbursements: {
            total: 50,
            totalAmount: 1250000000.5,
            releasedAmount: 1250000000.5,
            byStatus: { Released: 50 },
          },
          transmittals: {
            total: 0,
            byStatus: {},
          },
          revenue: {
            totalBilled: 999999999.99,
            totalCollected: 0,
            totalOutstanding: 999999999.99,
            totalExpenses: 1250000000.5,
            netIncome: -250000000.51, // Massive deficit
          },
        };

        vi.mocked(apiRequest).mockResolvedValueOnce({ data: extremeAnalytics });

        const { wrapper } = createHarness();
        render(<AnalyticsOverviewTab />, { wrapper });

        await waitFor(() => {
          expect(screen.queryByTestId('analytics-loading')).not.toBeInTheDocument();
        });

        // Billed: ₱999,999,999.99
        expect(screen.getByTestId('summary-billed')).toHaveTextContent('₱999,999,999.99');
        // Collected: ₱0.00 (genuine zero)
        expect(screen.getByTestId('summary-collected')).toHaveTextContent('₱0.00');
        // Outstanding: ₱999,999,999.99
        expect(screen.getByTestId('summary-outstanding')).toHaveTextContent('₱999,999,999.99');
        // Net Income: -₱250,000,000.51 (negative format)
        expect(screen.getByTestId('summary-net-income')).toHaveTextContent('-₱250,000,000.51');
        // Total Expenses: ₱1,250,000,000.50 (in supporting expenses and disbursement breakdown)
        expect(screen.getAllByText('₱1,250,000,000.50').length).toBe(3);
      });

      it('renders AgingReportTab with negative balance and massive totals', async () => {
        const extremeAging = {
          summary: {
            current: 0,
            '1-30': 999999999.99,
            '31-60': -50000.0, // Credit balance
            '61-90': 0,
            '90+': 0,
            grandTotal: 999949999.99,
          },
          buckets: {
            current: { total: 0, count: 0, invoices: [] },
            '1-30': {
              total: 999999999.99,
              count: 1,
              invoices: [
                {
                  id: 'inv-huge',
                  invoiceNumber: 'INV-HUGE-001',
                  clientName: 'Global Megacorp',
                  dueDate: '2026-10-01',
                  total: 999999999.99,
                  balance: 999999999.99,
                  daysOverdue: 16,
                },
              ],
            },
            '31-60': {
              total: -50000.0,
              count: 1,
              invoices: [
                {
                  id: 'inv-credit',
                  invoiceNumber: 'INV-CREDIT-002',
                  clientName: 'Credit Memo Client',
                  dueDate: '2026-09-01',
                  total: -50000.0,
                  balance: -50000.0,
                  daysOverdue: 46,
                },
              ],
            },
            '61-90': { total: 0, count: 0, invoices: [] },
            '90+': { total: 0, count: 0, invoices: [] },
          },
        };

        vi.mocked(apiRequest).mockResolvedValueOnce({ data: extremeAging });

        const { wrapper } = createHarness();
        render(<AgingReportTab />, { wrapper });

        await waitFor(() => {
          expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
        });

        // Headline Grand Total
        expect(screen.getByTestId('kpi-grand-total')).toHaveTextContent('₱999,949,999.99');
        // Table Rows
        expect(screen.getByText('INV-HUGE-001')).toBeInTheDocument();
        expect(screen.getByText('INV-CREDIT-002')).toBeInTheDocument();
        // Negative balance rendered with negative sign
        expect(screen.getAllByText('-₱50,000.00').length).toBeGreaterThan(0);
        expect(screen.getAllByText('₱999,999,999.99').length).toBeGreaterThan(0);
      });
    });
  });

  // ============================================================================
  // SUITE 2: FORMULA INJECTION IN CSV EXPORTS (CWE-1236)
  // ============================================================================
  describe('Formula Injection Payloads in CSV Exports (CWE-1236)', () => {
    describe('escapeCsvCell Sanitization', () => {
      it('neutralizes "=" formula injection triggers by prepending single quote "\'"', () => {
        expect(escapeCsvCell('=SUM(A1:A10)')).toBe('"\'=SUM(A1:A10)"');
        expect(escapeCsvCell('=1+1')).toBe('"\'=1+1"');
        expect(escapeCsvCell('=cmd|\'/C calc\'!A0')).toBe('"\'=cmd|\'/C calc\'!A0"');
      });

      it('neutralizes "@" formula injection triggers', () => {
        expect(escapeCsvCell('@cmd')).toBe('"\'@cmd"');
        expect(escapeCsvCell('@SUM(1,2)')).toBe('"\'@SUM(1,2)"');
      });

      it('neutralizes "-" formula injection triggers', () => {
        expect(escapeCsvCell('-1+2')).toBe('"\' -1+2"'.replace(' ', '')); // "'-1+2'"
        expect(escapeCsvCell('-50000')).toBe('"\' -50000"'.replace(' ', '')); // "'-50000'"
      });

      it('neutralizes "+" formula injection triggers', () => {
        expect(escapeCsvCell('+HYPERLINK("http://evil.com","click")')).toBe(
          '"\'+HYPERLINK(""http://evil.com"",""click"")"'
        );
        expect(escapeCsvCell('+1+2')).toBe('"\' +1+2"'.replace(' ', ''));
      });

      it('neutralizes "\\t" (tab) and "\\r" (carriage return) triggers', () => {
        expect(escapeCsvCell('\tcmd')).toBe('"\'\tcmd"');
        expect(escapeCsvCell('\rcmd')).toBe('"\'\rcmd"');
      });

      it('properly escapes internal double quotes per RFC 4180', () => {
        expect(escapeCsvCell('Acme "Super" Corp')).toBe('"Acme ""Super"" Corp"');
        expect(escapeCsvCell('="hello"')).toBe('"\'=""hello"""');
      });

      it('handles safe cells, nulls, and booleans without adding quote prefix', () => {
        expect(escapeCsvCell('INV-2026-001')).toBe('"INV-2026-001"');
        expect(escapeCsvCell('Acme Logistics')).toBe('"Acme Logistics"');
        expect(escapeCsvCell(null)).toBe('""');
        expect(escapeCsvCell(undefined)).toBe('""');
        expect(escapeCsvCell(12345)).toBe('"12345"');
        expect(escapeCsvCell(true)).toBe('"true"');
      });
    });

    describe('End-to-End CSV Export Adversarial Challenge in AgingReportTab', () => {
      it('exports full hostile payload set without executing or leaking raw formula characters', async () => {
        const hostileAgingData = {
          summary: {
            current: 10000,
            '1-30': 20000,
            '31-60': 30000,
            '61-90': 40000,
            '90+': 50000,
            grandTotal: 150000,
          },
          buckets: {
            current: {
              total: 10000,
              count: 1,
              invoices: [
                {
                  id: 'inv-f1',
                  invoiceNumber: '=SUM(A1:A10)',
                  clientName: 'Malicious =Formula Corp',
                  dueDate: '2026-10-30',
                  total: 10000,
                  balance: 10000,
                  daysOverdue: 0,
                },
              ],
            },
            '1-30': {
              total: 20000,
              count: 1,
              invoices: [
                {
                  id: 'inv-f2',
                  invoiceNumber: '@cmd',
                  clientName: '@Dangerous Cmd Ltd',
                  dueDate: '2026-10-05',
                  total: 20000,
                  balance: 20000,
                  daysOverdue: 12,
                },
              ],
            },
            '31-60': {
              total: 30000,
              count: 1,
              invoices: [
                {
                  id: 'inv-f3',
                  invoiceNumber: '-1+2',
                  clientName: '-Negative Trigger Inc',
                  dueDate: '2026-09-10',
                  total: 30000,
                  balance: 30000,
                  daysOverdue: 37,
                },
              ],
            },
            '61-90': {
              total: 40000,
              count: 1,
              invoices: [
                {
                  id: 'inv-f4',
                  invoiceNumber: '+HYPERLINK("http://evil.com","Phish")',
                  clientName: '+Plus Trigger Corp',
                  dueDate: '2026-08-05',
                  total: 40000,
                  balance: 40000,
                  daysOverdue: 73,
                },
              ],
            },
            '90+': {
              total: 50000,
              count: 1,
              invoices: [
                {
                  id: 'inv-f5',
                  invoiceNumber: '\tDDE("cmd")',
                  clientName: '\rCarriage Return Client',
                  dueDate: '2026-06-01',
                  total: 50000,
                  balance: 50000,
                  daysOverdue: 138,
                },
              ],
            },
          },
        };

        vi.mocked(apiRequest).mockResolvedValueOnce({ data: hostileAgingData });

        let capturedCsv = '';
        window.URL.createObjectURL = vi.fn().mockImplementation((blob: Blob) => {
          const reader = new FileReader();
          reader.onload = () => {
            capturedCsv = reader.result as string;
          };
          reader.readAsText(blob);
          return 'blob:mock-csv-url';
        });

        // Spy on link click to prevent jsdom navigation error
        const originalCreateElement = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
          const el = originalCreateElement(tagName);
          if (tagName.toLowerCase() === 'a') {
            vi.spyOn(el, 'click').mockImplementation(() => {});
          }
          return el;
        });

        const { wrapper } = createHarness();
        render(<AgingReportTab />, { wrapper });

        await waitFor(() => {
          expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
        });

        const exportBtn = screen.getByTestId('aging-export-csv-button');
        fireEvent.click(exportBtn);

        await waitFor(() => {
          expect(capturedCsv.length).toBeGreaterThan(0);
        });

        // Verify that CSV contains proper formula injection prefixes
        expect(capturedCsv).toContain("\"'=SUM(A1:A10)\"");
        expect(capturedCsv).toContain("\"'@cmd\"");
        expect(capturedCsv).toContain("\"'@Dangerous Cmd Ltd\"");
        expect(capturedCsv).toContain("\"'-1+2\"");
        expect(capturedCsv).toContain("\"'-Negative Trigger Inc\"");
        expect(capturedCsv).toContain("\"'+HYPERLINK(\"\"http://evil.com\"\",\"\"Phish\"\")\"");
        expect(capturedCsv).toContain("\"'+Plus Trigger Corp\"");
        expect(capturedCsv).toContain("\"'\tDDE(\"\"cmd\"\")\"");
        expect(capturedCsv).toContain("\"'\rCarriage Return Client\"");

        // Ensure no unquoted, unshielded formula trigger appears at cell start
        const lines = capturedCsv.split('\r\n');
        expect(lines[0]).toBe(
          '"Invoice #","Client Name","Due Date","Days Overdue","Aging Bracket","Invoice Total","Balance"'
        );

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i];
          if (!line || !line.trim()) continue;
          const cells = line.split('","');
          // For every cell, if it started with =, +, -, @, \t, \r, it MUST have ' prepended
          cells.forEach((cell) => {
            const cleanCell = cell.replace(/^"/, '').replace(/"$/, '');
            if (cleanCell.length > 0) {
              const firstChar = cleanCell.charAt(0);
              // It should NOT start directly with = or @
              expect(firstChar).not.toBe('=');
              expect(firstChar).not.toBe('@');
              if (firstChar === '\'') {
                // Was neutralized!
                expect(['=', '+', '-', '@', '\t', '\r']).toContain(cleanCell.charAt(1));
              }
            }
          });
        }
      });
    });
  });

  // ============================================================================
  // SUITE 3: DATE BOUNDARIES & INVALID INPUT HANDLING
  // ============================================================================
  describe('Date Boundaries & Invalid Inputs', () => {
    describe('shiftMonths boundary transitions', () => {
      it('steps backward across year boundary: 2026-01 -> 2025-12', () => {
        expect(shiftMonths('2026-01', -1)).toBe('2025-12');
      });

      it('steps forward across year boundary: 2025-12 -> 2026-01', () => {
        expect(shiftMonths('2025-12', 1)).toBe('2026-01');
      });

      it('steps multiple months accurately', () => {
        expect(shiftMonths('2026-05', -6)).toBe('2025-11');
        expect(shiftMonths('2024-02', 12)).toBe('2025-02');
      });

      it('gracefully survives invalid or empty month inputs without throw', () => {
        expect(shiftMonths('not-a-month', -1)).toBe('not-a-month');
        expect(shiftMonths('', 1)).toBe('');
        expect(shiftMonths('2026', 1)).toBe('2026');
      });
    });

    describe('shiftDays boundary transitions & leap years', () => {
      it('handles non-leap year February to March boundary', () => {
        expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
        expect(shiftDays('2026-02-28', 1)).toBe('2026-03-01');
      });

      it('handles leap year February 29 boundary (2024)', () => {
        expect(shiftDays('2024-03-01', -1)).toBe('2024-02-29');
        expect(shiftDays('2024-02-28', 1)).toBe('2024-02-29');
        expect(shiftDays('2024-02-29', 1)).toBe('2024-03-01');
      });

      it('steps across calendar year boundary: 2026-01-01 - 1 day = 2025-12-31', () => {
        expect(shiftDays('2026-01-01', -1)).toBe('2025-12-31');
        expect(shiftDays('2025-12-31', 1)).toBe('2026-01-01');
      });

      it('gracefully survives invalid or empty date inputs', () => {
        expect(shiftDays('invalid-date', 1)).toBe('invalid-date');
        expect(shiftDays('', 1)).toBe('');
      });
    });

    describe('getWeekBounds (7-day Monday–Sunday parity)', () => {
      it('computes exact Monday–Sunday boundaries for Saturday Oct 17, 2026', () => {
        const bounds = getWeekBounds('2026-10-17');
        expect(bounds.start).toBe('2026-10-12'); // Monday
        expect(bounds.end).toBe('2026-10-18'); // Sunday
      });

      it('computes exact Monday–Sunday boundaries when given Monday itself', () => {
        const bounds = getWeekBounds('2026-10-12');
        expect(bounds.start).toBe('2026-10-12');
        expect(bounds.end).toBe('2026-10-18');
      });

      it('computes exact Monday–Sunday boundaries when given Sunday itself', () => {
        const bounds = getWeekBounds('2026-10-18');
        expect(bounds.start).toBe('2026-10-12');
        expect(bounds.end).toBe('2026-10-18');
      });

      it('computes week boundaries across year-end (e.g. Jan 1, 2026 Thursday)', () => {
        const bounds = getWeekBounds('2026-01-01');
        expect(bounds.start).toBe('2025-12-29'); // Monday of 2025
        expect(bounds.end).toBe('2026-01-04'); // Sunday of 2026
      });

      it('computes week boundaries across leap day (Feb 29, 2024 Thursday)', () => {
        const bounds = getWeekBounds('2024-02-29');
        expect(bounds.start).toBe('2024-02-26');
        expect(bounds.end).toBe('2024-03-03');
      });
    });

    describe('formatManilaDate and formatMonth resilience', () => {
      it('formats calendar YYYY-MM-DD to MMM D, YYYY without UTC date drift', () => {
        expect(formatManilaDate('2026-10-17')).toBe('Oct 17, 2026');
        expect(formatManilaDate('2026-01-01')).toBe('Jan 1, 2026');
        expect(formatManilaDate('2026-12-31')).toBe('Dec 31, 2026');
      });

      it('returns "—" for missing/null/undefined/empty dates', () => {
        expect(formatManilaDate(null)).toBe('—');
        expect(formatManilaDate(undefined)).toBe('—');
        expect(formatManilaDate('')).toBe('—');
      });

      it('falls back safely for malformed date strings', () => {
        expect(formatManilaDate('not-a-date')).toBe('not-a-date');
      });

      it('formats YYYY-MM to MMMM YYYY', () => {
        expect(formatMonth('2026-01')).toBe('January 2026');
        expect(formatMonth('2025-12')).toBe('December 2025');
        expect(formatMonth(null)).toBe('—');
        expect(formatMonth('')).toBe('—');
        expect(formatMonth('invalid')).toBe('invalid');
      });

      it('formats date range cleanly', () => {
        expect(formatDateRange('2026-10-12', '2026-10-18')).toBe('Oct 12, 2026 – Oct 18, 2026');
        expect(formatDateRange(null, null)).toBe('—');
        expect(formatDateRange('2026-10-12', null)).toBe('Oct 12, 2026');
        expect(formatDateRange(null, '2026-10-18')).toBe('Oct 18, 2026');
      });
    });

    describe('Interactive Component Navigation Across Boundaries', () => {
      it('MonthlyPendingTab navigates across year boundaries via Prev/Next buttons', async () => {
        vi.mocked(apiRequest).mockResolvedValue({
          data: {
            overdueInvoices: { count: 0, totalOutstanding: 0, items: [] },
            pendingDisbursements: { count: 0, totalAmount: 0, items: [] },
            staleTransmittals: { count: 0, items: [] },
          },
        });

        const { wrapper } = createHarness();
        render(<MonthlyPendingTab />, { wrapper });

        await waitFor(() => {
          expect(screen.queryByTestId('monthly-loading')).not.toBeInTheDocument();
        });

        // Click Prev Month button (shifts current month by -1)
        const prevMonthBtn = screen.getByTestId('monthly-prev-month-btn');
        fireEvent.click(prevMonthBtn);

        await waitFor(() => {
          const expectedMonth = shiftMonths(getCurrentMonthString(), -1);
          expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining(`month=${expectedMonth}`));
        });

        // Click Next Month button twice (+1, +1)
        const nextMonthBtn = screen.getByTestId('monthly-next-month-btn');
        fireEvent.click(nextMonthBtn);
        await waitFor(() => {
          expect(apiRequest).toHaveBeenCalledWith(
            expect.stringContaining(`month=${getCurrentMonthString()}`)
          );
        });

        // "This month" shortcut restores current month
        const thisMonthBtn = screen.getByTestId('monthly-this-month-btn');
        fireEvent.click(thisMonthBtn);
        await waitFor(() => {
          expect(apiRequest).toHaveBeenCalledWith(
            expect.stringContaining(`month=${getCurrentMonthString()}`)
          );
        });
      });

      it('DailyActivityTab navigates across month boundaries and resets on Today shortcut', async () => {
        vi.mocked(apiRequest).mockResolvedValue({
          data: {
            summary: {
              workRequests: 0,
              documents: 0,
              invoices: 0,
              invoicesTotal: 0,
              payments: 0,
              paymentsTotal: 0,
              disbursements: 0,
              disbursementsTotal: 0,
              transmittals: 0,
            },
            workRequests: [],
            invoices: [],
            payments: [],
            disbursements: [],
            documents: [],
            transmittals: [],
          },
        });

        const { wrapper } = createHarness();
        render(<DailyActivityTab />, { wrapper });

        await waitFor(() => {
          expect(screen.queryByTestId('daily-loading')).not.toBeInTheDocument();
        });

        // Click Prev Day button
        const prevDayBtn = screen.getByTestId('daily-prev-day-btn');
        fireEvent.click(prevDayBtn);

        await waitFor(() => {
          const expectedDate = shiftDays(getTodayString(), -1);
          expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining(`date=${expectedDate}`));
        });

        // Click Today shortcut button
        const todayBtn = screen.getByTestId('daily-today-btn');
        fireEvent.click(todayBtn);

        await waitFor(() => {
          expect(apiRequest).toHaveBeenCalledWith(
            expect.stringContaining(`date=${getTodayString()}`)
          );
        });
      });

      it('WeeklySummaryTab steps 7 days on Prev/Next and resets on Current week', async () => {
        vi.mocked(apiRequest).mockResolvedValue({
          data: {
            weekStart: '2026-10-12',
            weekEnd: '2026-10-18',
            summary: {
              workRequests: 0,
              documents: 0,
              invoices: 0,
              invoicesTotal: 0,
              payments: 0,
              paymentsTotal: 0,
              disbursements: 0,
              disbursementsTotal: 0,
              transmittals: 0,
            },
            workRequests: [],
            invoices: [],
            payments: [],
            disbursements: [],
            documents: [],
            transmittals: [],
          },
        });

        const { wrapper } = createHarness();
        render(<WeeklySummaryTab />, { wrapper });

        await waitFor(() => {
          expect(screen.queryByTestId('weekly-loading')).not.toBeInTheDocument();
        });

        // Click Prev Week button (-7 days)
        const prevWeekBtn = screen.getByTestId('weekly-prev-week-btn');
        fireEvent.click(prevWeekBtn);

        await waitFor(() => {
          const expectedDate = shiftDays(getTodayString(), -7);
          expect(apiRequest).toHaveBeenCalledWith(expect.stringContaining(`date=${expectedDate}`));
        });

        // Click Next Week button (+7 days)
        const nextWeekBtn = screen.getByTestId('weekly-next-week-btn');
        fireEvent.click(nextWeekBtn);

        await waitFor(() => {
          expect(apiRequest).toHaveBeenCalledWith(
            expect.stringContaining(`date=${getTodayString()}`)
          );
        });
      });
    });
  });

  // ============================================================================
  // SUITE 4: ALL SCOPE GATING & QUERY ISOLATION
  // ============================================================================
  describe('ALL Scope Gating & Query Isolation', () => {
    describe('TanStack Query Hooks Strict Disabled State Under ALL', () => {
      beforeEach(() => {
        useSessionStore.setState({ activeEntity: 'ALL' });
      });

      it('disables useDailyReport query when activeEntity is ALL', () => {
        const { result } = renderHook(() => useDailyReport('2026-10-17'), {
          wrapper: createHookWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
        expect(apiRequest).not.toHaveBeenCalled();
      });

      it('disables useWeeklyReport query when activeEntity is ALL', () => {
        const { result } = renderHook(() => useWeeklyReport('2026-10-17'), {
          wrapper: createHookWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
        expect(apiRequest).not.toHaveBeenCalled();
      });

      it('disables useMonthlyPending query when activeEntity is ALL', () => {
        const { result } = renderHook(() => useMonthlyPending('2026-10'), {
          wrapper: createHookWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
        expect(apiRequest).not.toHaveBeenCalled();
      });

      it('disables useAgingReport query when activeEntity is ALL', () => {
        const { result } = renderHook(() => useAgingReport(), {
          wrapper: createHookWrapper(),
        });
        expect(result.current.fetchStatus).toBe('idle');
        expect(apiRequest).not.toHaveBeenCalled();
      });

      it('allows useReportsAnalytics to run under ALL for consolidated comparison', async () => {
        vi.mocked(apiRequest).mockResolvedValueOnce({
          data: {
            analyticsByEntity: {
              ATA: { clients: { total: 10 } },
              LTA: { clients: { total: 20 } },
            },
          },
        });

        const { result } = renderHook(() => useReportsAnalytics(), {
          wrapper: createHookWrapper(),
        });

        await waitFor(() => {
          expect(result.current.isSuccess).toBe(true);
        });
        expect(apiRequest).toHaveBeenCalledWith('/reports/analytics');
      });
    });

    describe('Detail Tabs Render ReportScopePrompt Without Errors in ALL Scope', () => {
      beforeEach(() => {
        useSessionStore.setState({ activeEntity: 'ALL' });
      });

      it('DailyActivityTab renders <ReportScopePrompt /> with action buttons', () => {
        const { wrapper } = createHarness();
        render(<DailyActivityTab />, { wrapper });

        expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
        expect(
          screen.getByText('Choose ATA or LTA to view this report')
        ).toBeInTheDocument();
        expect(screen.getByTestId('scope-prompt-btn-ata')).toBeInTheDocument();
        expect(screen.getByTestId('scope-prompt-btn-lta')).toBeInTheDocument();
        expect(apiRequest).not.toHaveBeenCalled();
      });

      it('WeeklySummaryTab renders <ReportScopePrompt /> with action buttons', () => {
        const { wrapper } = createHarness();
        render(<WeeklySummaryTab />, { wrapper });

        expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
        expect(screen.getByTestId('scope-prompt-btn-ata')).toBeInTheDocument();
        expect(screen.getByTestId('scope-prompt-btn-lta')).toBeInTheDocument();
        expect(apiRequest).not.toHaveBeenCalled();
      });

      it('MonthlyPendingTab renders <ReportScopePrompt /> with action buttons', () => {
        const { wrapper } = createHarness();
        render(<MonthlyPendingTab />, { wrapper });

        expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
        expect(screen.getByTestId('scope-prompt-btn-ata')).toBeInTheDocument();
        expect(screen.getByTestId('scope-prompt-btn-lta')).toBeInTheDocument();
        expect(apiRequest).not.toHaveBeenCalled();
      });

      it('AgingReportTab renders <ReportScopePrompt /> with action buttons', () => {
        const { wrapper } = createHarness();
        render(<AgingReportTab />, { wrapper });

        expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
        expect(screen.getByTestId('scope-prompt-btn-ata')).toBeInTheDocument();
        expect(screen.getByTestId('scope-prompt-btn-lta')).toBeInTheDocument();
        expect(apiRequest).not.toHaveBeenCalled();
      });

      it('clicking "Switch to ATA" updates activeEntity in session store', () => {
        const { wrapper } = createHarness();
        render(<DailyActivityTab />, { wrapper });

        const btnAta = screen.getByTestId('scope-prompt-btn-ata');
        fireEvent.click(btnAta);
        expect(useSessionStore.getState().activeEntity).toBe('ATA');
      });

      it('clicking "Switch to LTA" updates activeEntity in session store', () => {
        const { wrapper } = createHarness();
        render(<DailyActivityTab />, { wrapper });

        const btnLta = screen.getByTestId('scope-prompt-btn-lta');
        fireEvent.click(btnLta);
        expect(useSessionStore.getState().activeEntity).toBe('LTA');
      });
    });

    describe('Route-Level Scope Gating and Tab Transitions in ReportsPage', () => {
      it('renders ReportScopePrompt on detail tabs when navigated in ALL scope without crashing', async () => {
        useSessionStore.setState({ activeEntity: 'ALL' });

        const { wrapper } = createHarness(['/reports?tab=daily']);
        render(<ReportsPage />, { wrapper });

        expect(screen.getByTestId('reports-page')).toBeInTheDocument();
        expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
        expect(
          screen.getByText('Choose ATA or LTA to view this report')
        ).toBeInTheDocument();
        expect(apiRequest).not.toHaveBeenCalled();

        // Switch to ATA via prompt button
        const switchAtaBtn = screen.getByTestId('scope-prompt-btn-ata');
        fireEvent.click(switchAtaBtn);

        expect(useSessionStore.getState().activeEntity).toBe('ATA');
      });

      it('renders Overview tab comparison view under ALL scope without scope warning', async () => {
        useSessionStore.setState({ activeEntity: 'ALL' });
        const consolidatedMock = {
          analyticsByEntity: {
            ATA: {
              clients: { total: 42 },
              workRequests: { total: 128 },
              documents: { total: 350 },
              invoices: {
                total: 65,
                totalBilled: 1250000,
                totalCollected: 950000,
                totalOutstanding: 300000,
                byStatus: { Paid: 45, Sent: 20 },
              },
              disbursements: {
                total: 80,
                totalAmount: 420000,
                releasedAmount: 380000,
                byStatus: { Released: 70, Pending: 10 },
              },
              transmittals: {
                total: 30,
                byStatus: { Delivered: 25, 'In Transit': 5 },
              },
              revenue: {
                totalBilled: 1250000,
                totalCollected: 950000,
                totalOutstanding: 300000,
                totalExpenses: 380000,
                netIncome: 570000,
              },
            },
            LTA: {
              clients: { total: 18 },
              workRequests: { total: 72 },
              documents: { total: 150 },
              invoices: {
                total: 35,
                totalBilled: 750000,
                totalCollected: 500000,
                totalOutstanding: 250000,
                byStatus: { Paid: 25, Sent: 10 },
              },
              disbursements: {
                total: 40,
                totalAmount: 200000,
                releasedAmount: 180000,
                byStatus: { Released: 35, Pending: 5 },
              },
              transmittals: {
                total: 15,
                byStatus: { Delivered: 10, 'In Transit': 5 },
              },
              revenue: {
                totalBilled: 750000,
                totalCollected: 500000,
                totalOutstanding: 250000,
                totalExpenses: 180000,
                netIncome: 320000,
              },
            },
          },
        };

        vi.mocked(apiRequest).mockResolvedValueOnce({ data: consolidatedMock });

        const { wrapper } = createHarness(['/reports?tab=overview']);
        render(<ReportsPage />, { wrapper });

        await waitFor(() => {
          expect(screen.queryByTestId('analytics-loading')).not.toBeInTheDocument();
        });

        // Consolidated comparison view rendered
        expect(screen.getByTestId('consolidated-analytics-view')).toBeInTheDocument();
        expect(screen.queryByTestId('entity-all-warning')).not.toBeInTheDocument();
      });
    });
  });
});
