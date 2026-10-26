import { useState, useMemo } from 'react';
import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useWeeklyReport } from '../api/useReports';
import { useSessionStore } from '@/lib/session';
import {
  formatCurrency,
  formatCount,
  formatManilaDate,
  getTodayString,
  getWeekBounds,
} from '../utils/formatters';
import {
  ReportToolbar,
  ReportToolbarGroup,
  ReportSummaryBand,
  ReportSummaryCard,
  ReportSection,
  ReportTableContainer,
  ReportScopePrompt,
  ReportLoadingState,
  ReportErrorState,
} from './';
import { shiftDays, scrollToReportSection } from './periodicReportHelpers';

export function WeeklySummaryTab() {
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const [selectedDate, setSelectedDate] = useState<string>(getTodayString());
  const { data, isLoading, error, refetch, isRefetching } = useWeeklyReport(selectedDate, {
    enabled: activeEntity !== 'ALL',
  });

  const weekBounds = useMemo(() => {
    if (data?.weekStart && data?.weekEnd) {
      return { start: data.weekStart, end: data.weekEnd };
    }
    return getWeekBounds(selectedDate || getTodayString());
  }, [data, selectedDate]);

  if (activeEntity === 'ALL') {
    return (
      <div data-testid="weekly-summary-tab" className="space-y-6">
        <ReportScopePrompt />
      </div>
    );
  }

  const summary = data?.summary || {
    workRequests: 0,
    invoices: 0,
    invoicesTotal: 0,
    payments: 0,
    paymentsTotal: 0,
    disbursements: 0,
    disbursementsTotal: 0,
    documents: 0,
    transmittals: 0,
  };

  const details = data?.details || {
    workRequests: [],
    invoices: [],
    payments: [],
    disbursements: [],
    documents: [],
    transmittals: [],
  };

  const handlePrevWeek = () => {
    setSelectedDate((prev) => shiftDays(prev || getTodayString(), -7));
  };

  const handleNextWeek = () => {
    setSelectedDate((prev) => shiftDays(prev || getTodayString(), 7));
  };

  const handleCurrentWeek = () => {
    setSelectedDate(getTodayString());
  };

  return (
    <div className="space-y-6" data-testid="weekly-summary-tab">
      {/* 1. Contextual Toolbar */}
      <ReportToolbar dataTestId="weekly-toolbar">
        <ReportToolbarGroup align="left">
          <label htmlFor="weekly-date-picker" className="text-xs font-medium text-[#475569] shrink-0">
            Week of
          </label>
          <DateInput
            id="weekly-date-picker"
            aria-label="Week of"
            type="date"
            value={selectedDate}
            onValueChange={(value) => setSelectedDate(value || getTodayString())}
            className="w-[176px] rounded-[6px] border border-[#E2E8F0] bg-white text-xs text-[#1E293B] focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8]"
            data-testid="weekly-date-picker"
          />
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrevWeek}
              aria-label="Previous week"
              title="Previous week (-7 days)"
              className="h-9 w-9 p-0 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] cursor-pointer shadow-2xs transition-colors"
              data-testid="weekly-prev-week-btn"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleNextWeek}
              aria-label="Next week"
              title="Next week (+7 days)"
              className="h-9 w-9 p-0 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] cursor-pointer shadow-2xs transition-colors"
              data-testid="weekly-next-week-btn"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCurrentWeek}
            className="h-9 px-3 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] text-xs font-medium cursor-pointer shadow-2xs transition-colors"
            data-testid="weekly-current-week-btn"
          >
            Current week
          </Button>
        </ReportToolbarGroup>

        <ReportToolbarGroup align="right">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="h-9 px-3 text-xs font-medium gap-1.5 cursor-pointer rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] shadow-2xs transition-colors"
            data-testid="weekly-refresh-button"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </ReportToolbarGroup>
      </ReportToolbar>

      {/* 2. Soft 7-Day Boundary Header */}
      <div
        className="px-4 py-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] flex flex-wrap items-center justify-between gap-2 text-xs text-[#1E293B] shadow-2xs"
        data-testid="weekly-bounds-header"
      >
        <div className="flex items-center gap-2 font-medium text-[#1E293B]">
          <CalendarRange className="w-4 h-4 text-[#475569]" />
          <span>
            Week range: {formatManilaDate(weekBounds.start)} – {formatManilaDate(weekBounds.end)}
          </span>
        </div>
        <span className="text-[#475569] tabular-nums">
          {weekBounds.start} ~ {weekBounds.end}
        </span>
      </div>

      {/* 3. Loading / Error / Data Content */}
      {isLoading ? (
        <ReportLoadingState type="full" dataTestId="weekly-loading" />
      ) : error ? (
        <ReportErrorState
          dataTestId="weekly-error"
          title="Unable to load weekly summary"
          message={error instanceof Error ? error.message : 'Please check your connection and try again.'}
          onRetry={() => refetch()}
        />
      ) : (
        <>
          {/* 4. 3-Cell Monetary Summary Band */}
          <ReportSummaryBand columns={3}>
            <ReportSummaryCard
              label="Invoice total"
              value={formatCurrency(summary.invoicesTotal)}
              dataTestId="kpi-invoices-total"
            />
            <ReportSummaryCard
              label="Payments received"
              value={formatCurrency(summary.paymentsTotal)}
              dataTestId="kpi-payments-total"
            />
            <ReportSummaryCard
              label="Disbursement total"
              value={formatCurrency(summary.disbursementsTotal)}
              dataTestId="kpi-disbursements-total"
            />
          </ReportSummaryBand>

          {/* 5. Compact Category Count Strip */}
          <div
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5"
            data-testid="weekly-kpi-grid"
          >
            {[
              {
                id: 'workRequests',
                label: 'Work requests',
                count: summary.workRequests,
                testId: 'kpi-work-requests',
                targetId: 'section-weekly-work-requests',
              },
              {
                id: 'invoices',
                label: 'Invoices',
                count: summary.invoices,
                testId: 'kpi-invoices',
                targetId: 'section-weekly-invoices',
              },
              {
                id: 'payments',
                label: 'Payments',
                count: summary.payments,
                testId: 'kpi-payments',
                targetId: 'section-weekly-payments',
              },
              {
                id: 'disbursements',
                label: 'Disbursements',
                count: summary.disbursements,
                testId: 'kpi-disbursements',
                targetId: 'section-weekly-disbursements',
              },
              {
                id: 'documents',
                label: 'Documents',
                count: summary.documents,
                testId: 'kpi-documents',
                targetId: 'section-weekly-documents',
              },
              {
                id: 'transmittals',
                label: 'Transmittals',
                count: summary.transmittals,
                testId: 'kpi-transmittals',
                targetId: 'section-weekly-transmittals',
              },
            ].map((cat) => (
              <button
                type="button"
                key={cat.id}
                data-testid={cat.testId}
                onClick={() => scrollToReportSection(cat.targetId)}
                className="flex items-center justify-between gap-2 p-3 bg-[#FFFFFF] rounded-[8px] border border-[#E2E8F0] hover:bg-[#F8FAFC] hover:border-[#94A3B8] shadow-card transition-colors cursor-pointer text-left"
              >
                <span className="text-xs font-medium text-[#475569] leading-snug">
                  {cat.label}
                </span>
                <span className="text-xs font-bold text-[#1E40AF] tabular-nums px-2 py-0.5 rounded-[4px] border border-[#BFDBFE] bg-[#EFF6FF]">
                  {formatCount(cat.count)}
                </span>
              </button>
            ))}
          </div>

          {/* 6. 6 Full-Width Itemized Detail Tables adhering strictly to weekly schema */}
          <div className="space-y-6">
            {/* Table 1: Work Requests */}
            <ReportSection
              id="section-weekly-work-requests"
              dataTestId="weekly-work-requests-section"
              title="Work requests"
              badgeCount={details.workRequests.length}
              collapsible
            >
              {details.workRequests.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#475569]">
                  No work requests created in this week.
                </div>
              ) : (
                <ReportTableContainer minWidth="min-w-[540px]" ariaLabel="Weekly work requests table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead className="w-36">Status</TableHead>
                        <TableHead className="w-40 text-right">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.workRequests.map((wr) => (
                        <TableRow key={wr.id}>
                          <TableCell className="font-medium text-[#1E293B]">
                            <span
                              className="line-clamp-2 max-w-xl break-words"
                              title={wr.title}
                            >
                              {wr.title}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-[4px] border border-[#E2E8F0] text-xs font-medium bg-[#F8FAFC] text-[#1E293B]">
                              {wr.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs text-[#475569] tabular-nums">
                            {formatManilaDate(wr.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ReportTableContainer>
              )}
            </ReportSection>

            {/* Table 2: Invoices */}
            <ReportSection
              id="section-weekly-invoices"
              dataTestId="weekly-invoices-section"
              title="Invoices"
              badgeCount={details.invoices.length}
              collapsible
            >
              {details.invoices.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#475569]">
                  No invoices issued in this week.
                </div>
              ) : (
                <ReportTableContainer minWidth="min-w-[560px]" ariaLabel="Weekly invoices table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice #</TableHead>
                        <TableHead className="w-36">Status</TableHead>
                        <TableHead className="w-40 text-right">Total</TableHead>
                        <TableHead className="w-40 text-right">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.invoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium text-[#1E293B] tabular-nums">
                            {inv.invoice_number}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-[4px] border border-[#E2E8F0] text-xs font-medium bg-[#F8FAFC] text-[#1E293B]">
                              {inv.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-bold text-[#1E293B] tabular-nums">
                            {formatCurrency(inv.total)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-[#475569] tabular-nums">
                            {formatManilaDate(inv.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ReportTableContainer>
              )}
            </ReportSection>

            {/* Table 3: Payments (Weekly schema: amount, method, created_at) */}
            <ReportSection
              id="section-weekly-payments"
              dataTestId="weekly-payments-section"
              title="Payments"
              badgeCount={details.payments.length}
              collapsible
            >
              {details.payments.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#475569]">
                  No payments received in this week.
                </div>
              ) : (
                <ReportTableContainer minWidth="min-w-[500px]" ariaLabel="Weekly payments table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-44 text-right">Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="w-40 text-right">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-right font-bold text-[#1E293B] tabular-nums">
                            {formatCurrency(p.amount)}
                          </TableCell>
                          <TableCell className="text-[#1E293B] tabular-nums text-xs">{p.method}</TableCell>
                          <TableCell className="text-right text-xs text-[#475569] tabular-nums">
                            {formatManilaDate(p.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ReportTableContainer>
              )}
            </ReportSection>

            {/* Table 4: Disbursements (Weekly schema: disbursement_number, amount, status, created_at) */}
            <ReportSection
              id="section-weekly-disbursements"
              dataTestId="weekly-disbursements-section"
              title="Disbursements"
              badgeCount={details.disbursements.length}
              collapsible
            >
              {details.disbursements.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#475569]">
                  No disbursements filed in this week.
                </div>
              ) : (
                <ReportTableContainer minWidth="min-w-[540px]" ariaLabel="Weekly disbursements table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Disbursement #</TableHead>
                        <TableHead className="w-36">Status</TableHead>
                        <TableHead className="w-40 text-right">Amount</TableHead>
                        <TableHead className="w-40 text-right">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.disbursements.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium text-[#1E293B] tabular-nums">
                            {d.disbursement_number}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-[4px] border border-[#E2E8F0] text-xs font-medium bg-[#F8FAFC] text-[#1E293B]">
                              {d.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-bold text-[#1E293B] tabular-nums">
                            {formatCurrency(d.amount)}
                          </TableCell>
                          <TableCell className="text-right text-xs text-[#475569] tabular-nums">
                            {formatManilaDate(d.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ReportTableContainer>
              )}
            </ReportSection>

            {/* Table 5: Documents (Weekly schema: original_name, created_at) */}
            <ReportSection
              id="section-weekly-documents"
              dataTestId="weekly-documents-section"
              title="Documents"
              badgeCount={details.documents.length}
              collapsible
            >
              {details.documents.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#475569]">
                  No documents uploaded in this week.
                </div>
              ) : (
                <ReportTableContainer minWidth="min-w-[500px]" ariaLabel="Weekly documents table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Document Name</TableHead>
                        <TableHead className="w-40 text-right">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.documents.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell className="font-medium text-[#1E293B]">
                            <span
                              className="line-clamp-2 max-w-xl break-words"
                              title={doc.original_name}
                            >
                              {doc.original_name}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs text-[#475569] tabular-nums">
                            {formatManilaDate(doc.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ReportTableContainer>
              )}
            </ReportSection>

            {/* Table 6: Transmittals */}
            <ReportSection
              id="section-weekly-transmittals"
              dataTestId="weekly-transmittals-section"
              title="Transmittals"
              badgeCount={details.transmittals.length}
              collapsible
            >
              {details.transmittals.length === 0 ? (
                <div className="p-6 text-center text-xs text-[#475569]">
                  No transmittals created in this week.
                </div>
              ) : (
                <ReportTableContainer minWidth="min-w-[540px]" ariaLabel="Weekly transmittals table">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tracking #</TableHead>
                        <TableHead className="w-36">Status</TableHead>
                        <TableHead className="w-40 text-right">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.transmittals.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="font-mono font-medium text-[#1E293B] tabular-nums">
                            {t.tracking_number}
                          </TableCell>
                          <TableCell>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-[4px] border border-[#E2E8F0] text-xs font-medium bg-[#F8FAFC] text-[#1E293B]">
                              {t.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs text-[#475569] tabular-nums">
                            {formatManilaDate(t.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ReportTableContainer>
              )}
            </ReportSection>
          </div>
        </>
      )}
    </div>
  );
}
