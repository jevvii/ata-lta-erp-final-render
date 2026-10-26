import { useState, useMemo } from 'react';
import {
  Search,
  Download,
  Printer,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useSessionStore } from '@/lib/session';
import { useAgingReport } from '../api/useReports';
import {
  formatCurrency,
  formatCount,
  formatManilaDate,
  getTodayString,
  escapeCsvCell,
} from '../utils/formatters';
import { ReportToolbar, ReportToolbarGroup } from './ReportToolbar';
import { ReportTableContainer } from './ReportTableContainer';
import { ReportScopePrompt } from './ReportScopePrompt';
import {
  ReportLoadingState,
  ReportErrorState,
  ReportEmptyState,
} from './ReportStates';
import type { AgingInvoiceEntry } from '../api/types';

export interface AgingReportTabProps {
  onSelectInvoiceId?: (id: string) => void;
}

export type AgingBucketKey = 'all' | 'current' | '1-30' | '31-60' | '61-90' | '90+';

interface AgingItemWithBucket extends AgingInvoiceEntry {
  bucket: string;
}

export function AgingReportTab({ onSelectInvoiceId }: AgingReportTabProps) {
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const { data: agingData, isLoading, error, refetch, isRefetching } = useAgingReport();
  const [selectedBucket, setSelectedBucket] = useState<AgingBucketKey>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const summary = agingData?.summary || {
    current: 0,
    '1-30': 0,
    '31-60': 0,
    '61-90': 0,
    '90+': 0,
    grandTotal: 0,
  };

  const allEntries: AgingItemWithBucket[] = useMemo(() => {
    if (!agingData?.buckets) return [];
    const entries: AgingItemWithBucket[] = [];

    const append = (list: AgingInvoiceEntry[] | undefined, bucket: string) => {
      for (const item of list || []) {
        entries.push({ ...item, bucket });
      }
    };

    append(agingData.buckets.current?.invoices, 'Current');
    append(agingData.buckets['1-30']?.invoices, '1–30 Days');
    append(agingData.buckets['31-60']?.invoices, '31–60 Days');
    append(agingData.buckets['61-90']?.invoices, '61–90 Days');
    append(agingData.buckets['90+']?.invoices, '90+ Days');

    return entries;
  }, [agingData]);

  const filteredEntries = useMemo(() => {
    return allEntries.filter((item) => {
      // Bucket filter
      if (selectedBucket === 'current' && item.bucket !== 'Current') return false;
      if (selectedBucket === '1-30' && item.bucket !== '1–30 Days') return false;
      if (selectedBucket === '31-60' && item.bucket !== '31–60 Days') return false;
      if (selectedBucket === '61-90' && item.bucket !== '61–90 Days') return false;
      if (selectedBucket === '90+' && item.bucket !== '90+ Days') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesInv = item.invoiceNumber.toLowerCase().includes(q);
        const matchesClient = item.clientName.toLowerCase().includes(q);
        if (!matchesInv && !matchesClient) return false;
      }

      return true;
    });
  }, [allEntries, selectedBucket, searchQuery]);

  const filteredBalance = useMemo(() => {
    return filteredEntries.reduce((sum, item) => sum + (Number(item.balance) || 0), 0);
  }, [filteredEntries]);

  // Early return if activeEntity is ALL or null (scope prompt)
  if (!activeEntity || activeEntity === 'ALL') {
    return <ReportScopePrompt />;
  }

  const handleBucketClick = (bucketKey: AgingBucketKey) => {
    if (selectedBucket === bucketKey) {
      setSelectedBucket('all');
    } else {
      setSelectedBucket(bucketKey);
    }
  };

  const handleResetFilters = () => {
    setSelectedBucket('all');
    setSearchQuery('');
  };

  const handleExportCsv = () => {
    if (filteredEntries.length === 0) return;

    const headers = [
      'Invoice #',
      'Client Name',
      'Due Date',
      'Days Overdue',
      'Aging Bracket',
      'Invoice Total',
      'Balance',
    ];

    const headerRow = headers.map(escapeCsvCell).join(',');

    const dataRows = filteredEntries.map((e) => [
      escapeCsvCell(e.invoiceNumber),
      escapeCsvCell(e.clientName),
      escapeCsvCell(e.dueDate ? e.dueDate.slice(0, 10) : ''),
      escapeCsvCell(e.daysOverdue),
      escapeCsvCell(e.bucket),
      escapeCsvCell(Number(e.total).toFixed(2)),
      escapeCsvCell(Number(e.balance).toFixed(2)),
    ].join(','));

    const csvContent = [headerRow, ...dataRows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const entitySlug = activeEntity ? activeEntity.toLowerCase() : 'report';
    link.setAttribute(
      'download',
      `ar-aging-report-${entitySlug}-${getTodayString()}.csv`
    );
    document.body.appendChild(link);
    link.click();
    if (typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6" data-testid="aging-report-tab">
      {/* Print stylesheet */}
      <style>{`
        @media print {
          @page {
            margin: 12mm 12mm 12mm 12mm;
            size: auto;
          }
          thead {
            display: table-header-group !important;
          }
          tr {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>

      {/* 1. Context Toolbar (screen only) */}
      <ReportToolbar className="print:hidden">
        <ReportToolbarGroup align="left">
          <div className="flex items-center gap-2 text-xs sm:text-sm text-[#1E293B]">
            <span className="font-medium text-[#475569]">As of:</span>
            <span className="font-semibold text-[#1E293B] tabular-nums">
              {formatManilaDate(getTodayString())}
            </span>
            <span className="text-[#CBD5E1]">·</span>
            <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-[4px] bg-[#F8FAFC] text-[#1E293B] border border-[#E2E8F0]">
              Entity: {activeEntity}
            </span>
          </div>
        </ReportToolbarGroup>

        <ReportToolbarGroup align="right">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={filteredEntries.length === 0}
            className="text-xs font-medium h-8 px-3 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] transition-colors cursor-pointer gap-1.5 shadow-2xs"
            data-testid="aging-export-csv-button"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="text-xs font-medium h-8 px-3 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] transition-colors cursor-pointer gap-1.5 shadow-2xs"
            data-testid="aging-print-button"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print Report</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isRefetching}
            className="text-xs font-medium h-8 px-3 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] shadow-2xs transition-colors cursor-pointer gap-1.5"
            data-testid="aging-refresh-button"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </ReportToolbarGroup>
      </ReportToolbar>

      {/* 2. Print Header (visible only during window.print()) */}
      <div className="hidden print:block mb-6 space-y-3">
        <div className="border-b-2 border-[#0F172A] pb-3">
          <h1 className="text-xl font-bold uppercase tracking-tight text-[#1E293B]">
            AR Aging Report
          </h1>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2 text-xs text-[#1E293B]">
            <div>
              <span className="font-semibold text-[#1E293B]">Operating Entity:</span> {activeEntity}
            </div>
            <div>
              <span className="font-semibold text-[#1E293B]">As of Date:</span>{' '}
              {formatManilaDate(getTodayString())}
            </div>
            <div>
              <span className="font-semibold text-[#1E293B]">Active Bucket:</span>{' '}
              {selectedBucket === 'all'
                ? 'All Buckets'
                : selectedBucket === '90+'
                ? '90+ Days'
                : selectedBucket === 'current'
                ? 'Current'
                : `${selectedBucket} Days`}
            </div>
            <div>
              <span className="font-semibold text-[#1E293B]">Invoices Included:</span>{' '}
              {filteredEntries.length} of {allEntries.length}
            </div>
            <div>
              <span className="font-semibold text-[#1E293B]">Outstanding Balance:</span>{' '}
              {formatCurrency(summary.grandTotal)}
            </div>
            {filteredBalance !== summary.grandTotal && (
              <div>
                <span className="font-semibold text-[#1E293B]">Filtered Balance:</span>{' '}
                {formatCurrency(filteredBalance)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Headline Outstanding Balance Summary Figure */}
      <div
        className="bg-[#FFFFFF] rounded-[8px] border border-[#E2E8F0] p-4 sm:p-5 shadow-card flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 cursor-pointer transition-colors hover:bg-[#F8FAFC] print:hidden"
        onClick={() => setSelectedBucket('all')}
        data-testid="kpi-grand-total"
      >
        <div>
          <span className="text-xs font-medium text-[#475569] block">
            Outstanding balance
          </span>
          <span className="text-2xl sm:text-3xl font-bold text-[#1E293B] tracking-tight mt-1 block tabular-nums">
            {formatCurrency(summary.grandTotal)}
          </span>
        </div>
        <div className="text-xs text-[#475569] tabular-nums">
          Total across all overdue and current brackets ({allEntries.length} {allEntries.length === 1 ? 'invoice' : 'invoices'})
        </div>
      </div>

      {/* 4. Accessible Bucket Selection Strip */}
      <div
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 print:hidden"
        role="group"
        aria-label="Aging bucket filter"
        data-testid="aging-bucket-strip"
      >
        {/* All Button */}
        <button
          type="button"
          onClick={() => setSelectedBucket('all')}
          aria-pressed={selectedBucket === 'all' ? 'true' : 'false'}
          className={`p-3.5 rounded-[8px] border transition-colors text-left flex flex-col justify-between cursor-pointer focus:outline-none ${
            selectedBucket === 'all'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="bucket-btn-all"
        >
          <span className={`text-xs font-medium block ${selectedBucket === 'all' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            All
          </span>
          <span className="text-sm sm:text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary.grandTotal)}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === 'all' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            {formatCount(allEntries.length)} {allEntries.length === 1 ? 'invoice' : 'invoices'}
          </span>
        </button>

        {/* Current Button */}
        <button
          type="button"
          onClick={() => handleBucketClick('current')}
          aria-pressed={selectedBucket === 'current' ? 'true' : 'false'}
          className={`p-3.5 rounded-[8px] border transition-colors text-left flex flex-col justify-between cursor-pointer focus:outline-none ${
            selectedBucket === 'current'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-current"
        >
          <span className={`text-xs font-medium block ${selectedBucket === 'current' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            Current
          </span>
          <span className="text-sm sm:text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary.current)}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === 'current' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            {formatCount(agingData?.buckets?.current?.count ?? 0)}{' '}
            {(agingData?.buckets?.current?.count ?? 0) === 1 ? 'invoice' : 'invoices'}
          </span>
        </button>

        {/* 1–30 Days Button */}
        <button
          type="button"
          onClick={() => handleBucketClick('1-30')}
          aria-pressed={selectedBucket === '1-30' ? 'true' : 'false'}
          className={`p-3.5 rounded-[8px] border transition-colors text-left flex flex-col justify-between cursor-pointer focus:outline-none ${
            selectedBucket === '1-30'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-1-30"
        >
          <span className={`text-xs font-medium block ${selectedBucket === '1-30' ? 'text-[#1E40AF]' : 'text-[#854D0E]'}`}>
            1–30 Days
          </span>
          <span className="text-sm sm:text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary['1-30'])}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === '1-30' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            {formatCount(agingData?.buckets?.['1-30']?.count ?? 0)}{' '}
            {(agingData?.buckets?.['1-30']?.count ?? 0) === 1 ? 'invoice' : 'invoices'}
          </span>
        </button>

        {/* 31–60 Days Button */}
        <button
          type="button"
          onClick={() => handleBucketClick('31-60')}
          aria-pressed={selectedBucket === '31-60' ? 'true' : 'false'}
          className={`p-3.5 rounded-[8px] border transition-colors text-left flex flex-col justify-between cursor-pointer focus:outline-none ${
            selectedBucket === '31-60'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-31-60"
        >
          <span className={`text-xs font-medium block ${selectedBucket === '31-60' ? 'text-[#1E40AF]' : 'text-[#854D0E]'}`}>
            31–60 Days
          </span>
          <span className="text-sm sm:text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary['31-60'])}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === '31-60' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            {formatCount(agingData?.buckets?.['31-60']?.count ?? 0)}{' '}
            {(agingData?.buckets?.['31-60']?.count ?? 0) === 1 ? 'invoice' : 'invoices'}
          </span>
        </button>

        {/* 61–90 Days Button */}
        <button
          type="button"
          onClick={() => handleBucketClick('61-90')}
          aria-pressed={selectedBucket === '61-90' ? 'true' : 'false'}
          className={`p-3.5 rounded-[8px] border transition-colors text-left flex flex-col justify-between cursor-pointer focus:outline-none ${
            selectedBucket === '61-90'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-61-90"
        >
          <span className={`text-xs font-medium block ${selectedBucket === '61-90' ? 'text-[#1E40AF]' : 'text-[#991B1B]'}`}>
            61–90 Days
          </span>
          <span className="text-sm sm:text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary['61-90'])}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === '61-90' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            {formatCount(agingData?.buckets?.['61-90']?.count ?? 0)}{' '}
            {(agingData?.buckets?.['61-90']?.count ?? 0) === 1 ? 'invoice' : 'invoices'}
          </span>
        </button>

        {/* 90+ Days Button */}
        <button
          type="button"
          onClick={() => handleBucketClick('90+')}
          aria-pressed={selectedBucket === '90+' ? 'true' : 'false'}
          className={`p-3.5 rounded-[8px] border transition-colors text-left flex flex-col justify-between cursor-pointer focus:outline-none ${
            selectedBucket === '90+'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-90-plus"
        >
          <span className={`text-xs font-medium block ${selectedBucket === '90+' ? 'text-[#1E40AF]' : 'text-[#991B1B]'}`}>
            90+ Days
          </span>
          <span className="text-sm sm:text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary['90+'])}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === '90+' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            {formatCount(agingData?.buckets?.['90+']?.count ?? 0)}{' '}
            {(agingData?.buckets?.['90+']?.count ?? 0) === 1 ? 'invoice' : 'invoices'}
          </span>
        </button>
      </div>

      {/* 5. Search Bar & Distinct Result Labeling */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 print:hidden">
        <div className="relative max-w-sm flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#475569] pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by client or invoice number..."
            className="pl-9 pr-8 h-9 text-xs sm:text-sm bg-white rounded-[6px] border border-[#E2E8F0] text-[#1E293B] focus-visible:ring-[#1D4ED8]"
            data-testid="aging-search-input"
            aria-label="Search invoices by client name or invoice number"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-2.5 text-[#475569] hover:text-[#1E293B] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div
          className="text-xs sm:text-sm text-[#475569] flex flex-wrap items-center gap-1.5"
          data-testid="aging-filter-summary"
        >
          <span>
            Showing <strong className="font-bold text-[#1E293B] tabular-nums">{filteredEntries.length}</strong> of{' '}
            <strong className="font-bold text-[#1E293B] tabular-nums">{allEntries.length}</strong> invoices
          </span>
          <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
          <span>
            Filtered balance:{' '}
            <strong className="font-bold text-[#1E293B] tabular-nums">
              {formatCurrency(filteredBalance)}
            </strong>
          </span>
          {selectedBucket !== 'all' && (
            <>
              <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
              <span className="font-medium text-[#1E293B]">
                ({selectedBucket === '90+' ? '90+ Days' : selectedBucket === 'current' ? 'Current' : `${selectedBucket} Days`} bucket)
              </span>
            </>
          )}
        </div>
      </div>

      {/* 6. Main Content: Loading, Error, Empty, or Table */}
      {isLoading ? (
        <ReportLoadingState dataTestId="aging-loading" type="full" rows={5} columns={6} />
      ) : error ? (
        <ReportErrorState
          dataTestId="aging-error"
          title="Unable to load aging report"
          message={error instanceof Error ? error.message : 'Please check your connection and try again.'}
          onRetry={() => refetch()}
          staleDataNotice={Boolean(agingData)}
        />
      ) : filteredEntries.length === 0 ? (
        allEntries.length === 0 ? (
          <ReportEmptyState
            dataTestId="empty-aging-report"
            title="No outstanding invoices"
            description={`There are currently no open or overdue accounts receivable for ${activeEntity}.`}
          />
        ) : (
          <ReportEmptyState
            dataTestId="empty-aging-report"
            title="No invoices match these filters."
            description="No invoices were found matching the selected aging bucket or search query."
            onReset={handleResetFilters}
            resetLabel="Clear filters"
          />
        )
      ) : (
        <ReportTableContainer minWidth="min-w-[800px]" ariaLabel="Accounts receivable aging invoices">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Client Name</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Days Overdue</TableHead>
                <TableHead>Aging Bracket</TableHead>
                <TableHead className="text-right">Invoice Total</TableHead>
                <TableHead className="text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((row) => (
                <TableRow
                  key={row.id}
                  className="hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                  onClick={() => onSelectInvoiceId?.(row.id)}
                  tabIndex={onSelectInvoiceId ? 0 : undefined}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && onSelectInvoiceId) {
                      e.preventDefault();
                      onSelectInvoiceId(row.id);
                    }
                  }}
                  data-testid={`aging-row-${row.id}`}
                >
                  <TableCell className="font-semibold text-xs text-[#1E293B] py-3 px-4 text-left tabular-nums">
                    {row.invoiceNumber}
                  </TableCell>
                  <TableCell className="text-xs text-[#1E293B] py-3 px-4 text-left font-medium">
                    {row.clientName}
                  </TableCell>
                  <TableCell className="text-xs text-[#475569] py-3 px-4 text-left tabular-nums">
                    {formatManilaDate(row.dueDate)}
                  </TableCell>
                  <TableCell className="text-xs py-3 px-4 text-right tabular-nums font-semibold">
                    <span
                      className={
                        row.daysOverdue > 60
                          ? 'text-[#991B1B] font-bold'
                          : row.daysOverdue > 30
                          ? 'text-[#854D0E] font-bold'
                          : row.daysOverdue > 0
                          ? 'text-[#854D0E] font-semibold'
                          : 'text-[#475569]'
                      }
                    >
                      {row.daysOverdue} {row.daysOverdue === 1 ? 'day' : 'days'}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 px-4 text-left">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-[4px] border  text-xs font-semibold tabular-nums ${
                        row.bucket === 'Current'
                          ? 'bg-[#F0FDF4] text-[#166534] border-[#86EFAC]'
                          : row.bucket === '1–30 Days'
                          ? 'bg-[#FEFCE8] text-[#854D0E] border-[#FDE047]'
                          : row.bucket === '31–60 Days'
                          ? 'bg-[#FEFCE8] text-[#854D0E] border-[#FDE047]'
                          : row.bucket === '61–90 Days'
                          ? 'bg-[#FEF2F2] text-[#991B1B] border-[#FCA5A5]'
                          : 'bg-[#FEF2F2] text-[#991B1B] border-[#FCA5A5]'
                      }`}
                    >
                      {row.bucket}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-[#475569] text-right py-3 px-4 tabular-nums">
                    {formatCurrency(row.total)}
                  </TableCell>
                  <TableCell className="text-xs font-bold text-[#1E293B] text-right py-3 px-4 tabular-nums">
                    {formatCurrency(row.balance)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ReportTableContainer>
      )}
    </div>
  );
}
