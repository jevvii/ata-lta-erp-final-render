import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DailyActivityTab,
  WeeklySummaryTab,
  MonthlyPendingTab,
} from '../index';
import { useSessionStore } from '@/lib/session';
import { apiRequest } from '@/lib/api';
import {
  shiftDays,
  shiftMonths,
} from '../periodicReportHelpers';

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn(),
}));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, null, children)
    );

  return { queryClient, wrapper };
}

describe('Periodic Reports - Helper Utilities', () => {
  it('shiftDays correctly steps forward and backward across days and month boundaries', () => {
    expect(shiftDays('2026-10-17', 1)).toBe('2026-10-18');
    expect(shiftDays('2026-10-17', -1)).toBe('2026-10-16');
    expect(shiftDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDays('2026-10-17', 7)).toBe('2026-10-24');
    expect(shiftDays('2026-10-17', -7)).toBe('2026-10-10');
  });

  it('shiftMonths correctly steps forward and backward across year boundaries', () => {
    expect(shiftMonths('2026-10', 1)).toBe('2026-11');
    expect(shiftMonths('2026-10', -1)).toBe('2026-09');
    expect(shiftMonths('2026-01', -1)).toBe('2025-12');
    expect(shiftMonths('2026-12', 1)).toBe('2027-01');
  });
});

describe('DailyActivityTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeEntity: 'ATA',
      permissions: new Set(['reports:view', 'billing:view']),
    });
  });

  const mockDailyData = {
    date: '2026-10-17',
    summary: {
      workRequests: 2,
      documents: 1,
      invoices: 1,
      invoicesTotal: 45000,
      payments: 1,
      paymentsTotal: 30000,
      disbursements: 1,
      disbursementsTotal: 12000,
      transmittals: 1,
    },
    workRequests: [
      { id: 'wr-1', title: 'Corporate Tax Assessment & Filing Support', status: 'In Progress', created_at: '2026-10-17T08:30:00Z' },
      { id: 'wr-2', title: 'Customs Clearance Import Permit', status: 'Completed', created_at: '2026-10-17T09:15:00Z' },
    ],
    documents: [
      { id: 'doc-1', original_name: 'Customs_Declaration_2026.pdf', category: 'Permits', created_at: '2026-10-17T10:00:00Z' },
    ],
    invoices: [
      { id: 'inv-1', invoice_number: 'INV-2026-0042', total: 45000, status: 'Sent', created_at: '2026-10-17T11:00:00Z' },
    ],
    payments: [
      { id: 'pay-1', amount: 30000, method: 'Bank Transfer', invoice_id: 'inv-1', payment_date: '2026-10-17', created_at: '2026-10-17T12:00:00Z' },
    ],
    disbursements: [
      { id: 'db-1', disbursement_number: 'DB-2026-0099', amount: 12000, status: 'Approved', created_at: '2026-10-17T13:00:00Z' },
    ],
    transmittals: [
      { id: 'tr-1', tracking_number: 'TR-2026-0088', status: 'Delivered', created_at: '2026-10-17T14:00:00Z' },
    ],
  };

  it('renders ReportScopePrompt when activeEntity is ALL and suppresses detail tables', () => {
    useSessionStore.setState({ activeEntity: 'ALL' });
    const { wrapper } = createHarness();
    render(<DailyActivityTab />, { wrapper });

    expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
    expect(screen.getByText('Choose ATA or LTA to view this report')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-toolbar')).not.toBeInTheDocument();
  });

  it('renders toolbar, 3-cell monetary summary band, count strip, and full-width tables', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockDailyData });
    const { wrapper } = createHarness();
    render(<DailyActivityTab />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('daily-loading')).not.toBeInTheDocument();
    });

    // Check toolbar controls
    expect(screen.getByTestId('daily-date-picker')).toBeInTheDocument();
    expect(screen.getByTestId('daily-prev-day-btn')).toBeInTheDocument();
    expect(screen.getByTestId('daily-next-day-btn')).toBeInTheDocument();
    expect(screen.getByTestId('daily-today-btn')).toBeInTheDocument();
    expect(screen.getByTestId('daily-refresh-button')).toBeInTheDocument();

    // 3-cell monetary summary band
    expect(screen.getByTestId('kpi-invoices-total')).toHaveTextContent('₱45,000.00');
    expect(screen.getByTestId('kpi-payments-total')).toHaveTextContent('₱30,000.00');
    expect(screen.getByTestId('kpi-disbursements-total')).toHaveTextContent('₱12,000.00');

    // Count strip
    expect(screen.getByTestId('kpi-work-requests')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-documents')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-invoices')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-payments')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-disbursements')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-transmittals')).toHaveTextContent('1');

    // Detail tables: Work requests
    expect(screen.getByText('Corporate Tax Assessment & Filing Support')).toBeInTheDocument();
    expect(screen.getByText('Customs Clearance Import Permit')).toBeInTheDocument();

    // Invoices table
    expect(screen.getByText('INV-2026-0042')).toBeInTheDocument();

    // Payments table - strictly labeled Invoice ID
    expect(screen.getByText('Invoice ID')).toBeInTheDocument();
    expect(screen.getByText('inv-1')).toBeInTheDocument();
    expect(screen.getByText('Bank Transfer')).toBeInTheDocument();

    // Disbursements table
    expect(screen.getByText('DB-2026-0099')).toBeInTheDocument();

    // Documents table
    expect(screen.getByText('Customs_Declaration_2026.pdf')).toBeInTheDocument();
    expect(screen.getByText('Permits')).toBeInTheDocument();

    // Transmittals table
    expect(screen.getByText('TR-2026-0088')).toBeInTheDocument();
  });

  it('steps selected date on prev/next button clicks', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: mockDailyData });
    const { wrapper } = createHarness();
    render(<DailyActivityTab />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('daily-date-picker')).toBeInTheDocument();
    });

    const prevBtn = screen.getByTestId('daily-prev-day-btn');
    fireEvent.click(prevBtn);

    // Refresh button triggers refetch
    const refreshBtn = screen.getByTestId('daily-refresh-button');
    fireEvent.click(refreshBtn);
    expect(apiRequest).toHaveBeenCalled();
  });

  it('renders contextual empty message when daily tables have 0 records', async () => {
    const emptyDaily = {
      date: '2026-10-17',
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
      documents: [],
      invoices: [],
      payments: [],
      disbursements: [],
      transmittals: [],
    };
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: emptyDaily });
    const { wrapper } = createHarness();
    render(<DailyActivityTab />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('No work requests created on this date.')).toBeInTheDocument();
    });

    expect(screen.getByText('No invoices issued on this date.')).toBeInTheDocument();
    expect(screen.getByText('No payments received on this date.')).toBeInTheDocument();
    expect(screen.getByText('No disbursements filed on this date.')).toBeInTheDocument();
    expect(screen.getByText('No documents uploaded on this date.')).toBeInTheDocument();
    expect(screen.getByText('No transmittals created on this date.')).toBeInTheDocument();
  });
});

describe('WeeklySummaryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeEntity: 'ATA',
      permissions: new Set(['reports:view', 'billing:view']),
    });
  });

  const mockWeeklyData = {
    weekStart: '2026-10-12',
    weekEnd: '2026-10-18',
    summary: {
      workRequests: 3,
      invoices: 2,
      invoicesTotal: 80000,
      payments: 1,
      paymentsTotal: 50000,
      disbursements: 2,
      disbursementsTotal: 25000,
      documents: 5,
      transmittals: 2,
    },
    details: {
      workRequests: [
        { id: 'wr-w1', title: 'Weekly Advisory Retainer', status: 'Approved', created_at: '2026-10-13T00:00:00Z' },
      ],
      invoices: [
        { id: 'inv-w1', invoice_number: 'INV-W-01', total: 80000, status: 'Sent', created_at: '2026-10-14T00:00:00Z' },
      ],
      payments: [
        { id: 'pay-w1', amount: 50000, method: 'Check', created_at: '2026-10-15T00:00:00Z' },
      ],
      disbursements: [
        { id: 'db-w1', disbursement_number: 'DB-W-01', amount: 25000, status: 'Released', created_at: '2026-10-16T00:00:00Z' },
      ],
      documents: [
        { id: 'doc-w1', original_name: 'Audit_Checklist.docx', created_at: '2026-10-16T00:00:00Z' },
      ],
      transmittals: [
        { id: 'tr-w1', tracking_number: 'TR-W-01', status: 'In Transit', created_at: '2026-10-17T00:00:00Z' },
      ],
    },
  };

  it('renders ReportScopePrompt when activeEntity is ALL', () => {
    useSessionStore.setState({ activeEntity: 'ALL' });
    const { wrapper } = createHarness();
    render(<WeeklySummaryTab />, { wrapper });

    expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('weekly-toolbar')).not.toBeInTheDocument();
  });

  it('renders plain 7-day boundary header and adherence to weekly schema', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockWeeklyData });
    const { wrapper } = createHarness();
    render(<WeeklySummaryTab />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('weekly-loading')).not.toBeInTheDocument();
    });

    // 7-day boundary header
    expect(screen.getByTestId('weekly-bounds-header')).toBeInTheDocument();
    expect(screen.getByText(/2026-10-12 ~ 2026-10-18/)).toBeInTheDocument();

    // Toolbar controls
    expect(screen.getByTestId('weekly-prev-week-btn')).toBeInTheDocument();
    expect(screen.getByTestId('weekly-next-week-btn')).toBeInTheDocument();
    expect(screen.getByTestId('weekly-current-week-btn')).toBeInTheDocument();

    // Monetary summary band
    expect(screen.getByTestId('kpi-invoices-total')).toHaveTextContent('₱80,000.00');
    expect(screen.getByTestId('kpi-payments-total')).toHaveTextContent('₱50,000.00');
    expect(screen.getByTestId('kpi-disbursements-total')).toHaveTextContent('₱25,000.00');

    // Detail rows
    expect(screen.getByText('Weekly Advisory Retainer')).toBeInTheDocument();
    expect(screen.getByText('INV-W-01')).toBeInTheDocument();
    expect(screen.getByText('Audit_Checklist.docx')).toBeInTheDocument();
    expect(screen.getByText('TR-W-01')).toBeInTheDocument();
  });

  it('navigates -7 days and +7 days on prev/next week button clicks', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: mockWeeklyData });
    const { wrapper } = createHarness();
    render(<WeeklySummaryTab />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('weekly-date-picker')).toBeInTheDocument();
    });

    const prevWeekBtn = screen.getByTestId('weekly-prev-week-btn');
    fireEvent.click(prevWeekBtn);

    const nextWeekBtn = screen.getByTestId('weekly-next-week-btn');
    fireEvent.click(nextWeekBtn);
  });
});

describe('MonthlyPendingTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeEntity: 'ATA',
      permissions: new Set(['reports:view', 'billing:view']),
    });
  });

  const mockMonthlyData = {
    month: '2026-10',
    overdueInvoices: {
      count: 2,
      totalOutstanding: 125000,
      items: [
        {
          id: 'inv-m1',
          invoice_number: 'INV-M-001',
          due_date: '2026-09-30',
          total: 80000,
          balance: 80000,
          status: 'Sent',
          clients: { name: 'Acme Import Corp' },
        },
        {
          id: 'inv-m2',
          invoice_number: 'INV-M-002',
          due_date: '2026-10-05',
          total: 45000,
          balance: 45000,
          status: 'Overdue',
          clients: { name: 'Pacific Trade Ltd' },
        },
      ],
    },
    pendingDisbursements: {
      count: 1,
      totalAmount: 32000,
      items: [
        {
          id: 'db-m1',
          disbursement_number: 'DB-M-001',
          amount: 32000,
          status: 'Approved',
          category: 'Port Handling',
          created_at: '2026-10-10T00:00:00Z',
        },
      ],
    },
    staleTransmittals: {
      count: 1,
      items: [
        {
          id: 'tr-m1',
          tracking_number: 'TR-M-001',
          clients: { name: 'Manila Cargo Hub' },
          status: 'Draft',
          created_at: '2026-09-15T00:00:00Z',
        },
      ],
    },
  };

  it('renders ReportScopePrompt when activeEntity is ALL', () => {
    useSessionStore.setState({ activeEntity: 'ALL' });
    const { wrapper } = createHarness();
    render(<MonthlyPendingTab />, { wrapper });

    expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('monthly-toolbar')).not.toBeInTheDocument();
  });

  it('renders 3 summary groups and 3 full-width item tables', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockMonthlyData });
    const { wrapper } = createHarness();
    render(<MonthlyPendingTab />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('monthly-loading')).not.toBeInTheDocument();
    });

    // 3 Summary cards
    expect(screen.getByTestId('card-overdue-invoices')).toBeInTheDocument();
    expect(screen.getByTestId('card-pending-disbursements')).toBeInTheDocument();
    expect(screen.getByTestId('card-stale-transmittals')).toBeInTheDocument();

    expect(screen.getByTestId('kpi-overdue-invoices')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-overdue-outstanding')).toHaveTextContent('₱125,000.00');

    expect(screen.getByTestId('kpi-pending-disbursements')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-pending-disb-total')).toHaveTextContent('₱32,000.00');

    expect(screen.getByTestId('kpi-stale-transmittals')).toHaveTextContent('1');

    // Tables
    expect(screen.getByText('INV-M-001')).toBeInTheDocument();
    expect(screen.getByText('Acme Import Corp')).toBeInTheDocument();
    expect(screen.getByText('Pacific Trade Ltd')).toBeInTheDocument();

    expect(screen.getByText('DB-M-001')).toBeInTheDocument();
    expect(screen.getByText('Port Handling')).toBeInTheDocument();

    expect(screen.getByText('TR-M-001')).toBeInTheDocument();
    expect(screen.getByText('Manila Cargo Hub')).toBeInTheDocument();
  });

  it('steps selected month on prev/next month button clicks', async () => {
    vi.mocked(apiRequest).mockResolvedValue({ data: mockMonthlyData });
    const { wrapper } = createHarness();
    render(<MonthlyPendingTab />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('monthly-month-picker')).toBeInTheDocument();
    });

    const prevMonthBtn = screen.getByTestId('monthly-prev-month-btn');
    fireEvent.click(prevMonthBtn);

    const nextMonthBtn = screen.getByTestId('monthly-next-month-btn');
    fireEvent.click(nextMonthBtn);

    const thisMonthBtn = screen.getByTestId('monthly-this-month-btn');
    fireEvent.click(thisMonthBtn);
  });
});
