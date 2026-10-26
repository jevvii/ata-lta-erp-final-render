import { useState, useMemo } from 'react';
import {
  TrendingUp,
  Search,
  Eye,
  FileSpreadsheet,
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
import { useAgingReport } from '../api/useAgingReport';
import { formatCurrency } from '../utils/formatters';
import type { AgingEntry } from '../api/types';

export interface AgingReportTabProps {
  onSelectInvoiceId?: (id: string) => void;
}

type AgingBucketKey = 'all' | 'current' | '1-30' | '31-60' | '61-90' | '90+';

export function AgingReportTab({ onSelectInvoiceId }: AgingReportTabProps) {
  const { data: agingData, isLoading, refetch } = useAgingReport();
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

  const allEntries: Array<AgingEntry & { bucket: string }> = useMemo(() => {
    if (!agingData?.details) return [];
    const entries: Array<AgingEntry & { bucket: string }> = [];

    const append = (list: AgingEntry[] | undefined, bucket: string) => {
      for (const item of list || []) {
        entries.push({ ...item, bucket });
      }
    };

    append(agingData.details.current?.invoices, 'Current');
    append(agingData.details['1-30']?.invoices, '1–30 Days');
    append(agingData.details['31-60']?.invoices, '31–60 Days');
    append(agingData.details['61-90']?.invoices, '61–90 Days');
    append(agingData.details['90+']?.invoices, '90+ Days');

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

  return (
    <div className="space-y-6" data-testid="aging-report-tab">
      {/* 1. Header & Summary Cards */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E2E8F0] pb-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-[#1D4ED8]" />
            <span>Accounts Receivable Aging Report</span>
          </h2>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
            Real-time aging breakdown of outstanding receivables grouped by overdue aging brackets.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="text-xs font-medium h-8 px-3 rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] transition-colors self-start sm:self-auto cursor-pointer shadow-2xs"
        >
          Refresh Report
        </Button>
      </div>

      {/* Summary KPI Cards Grid */}
      <div
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5"
        data-testid="aging-kpi-grid"
      >
        {/* Current */}
        <div
          onClick={() => setSelectedBucket(selectedBucket === 'current' ? 'all' : 'current')}
          className={`p-3.5 rounded-[8px] border transition-colors cursor-pointer flex flex-col justify-between text-left ${
            selectedBucket === 'current'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-current"
        >
          <span className={`text-xs font-medium block ${selectedBucket === 'current' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            Current (0 Days)
          </span>
          <span className="text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary.current)}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === 'current' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            Not yet overdue
          </span>
        </div>

        {/* 1-30 Days */}
        <div
          onClick={() => setSelectedBucket(selectedBucket === '1-30' ? 'all' : '1-30')}
          className={`p-3.5 rounded-[8px] border transition-colors cursor-pointer flex flex-col justify-between text-left ${
            selectedBucket === '1-30'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-1-30"
        >
          <span className={`text-xs font-medium block ${selectedBucket === '1-30' ? 'text-[#1E40AF]' : 'text-[#854D0E]'}`}>
            1–30 Days
          </span>
          <span className="text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary['1-30'])}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === '1-30' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            Early overdue
          </span>
        </div>

        {/* 31-60 Days */}
        <div
          onClick={() => setSelectedBucket(selectedBucket === '31-60' ? 'all' : '31-60')}
          className={`p-3.5 rounded-[8px] border transition-colors cursor-pointer flex flex-col justify-between text-left ${
            selectedBucket === '31-60'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-31-60"
        >
          <span className={`text-xs font-medium block ${selectedBucket === '31-60' ? 'text-[#1E40AF]' : 'text-[#854D0E]'}`}>
            31–60 Days
          </span>
          <span className="text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary['31-60'])}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === '31-60' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            Aging notice
          </span>
        </div>

        {/* 61-90 Days */}
        <div
          onClick={() => setSelectedBucket(selectedBucket === '61-90' ? 'all' : '61-90')}
          className={`p-3.5 rounded-[8px] border transition-colors cursor-pointer flex flex-col justify-between text-left ${
            selectedBucket === '61-90'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-61-90"
        >
          <span className={`text-xs font-medium block ${selectedBucket === '61-90' ? 'text-[#1E40AF]' : 'text-[#991B1B]'}`}>
            61–90 Days
          </span>
          <span className="text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary['61-90'])}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === '61-90' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            Urgent follow-up
          </span>
        </div>

        {/* 90+ Days */}
        <div
          onClick={() => setSelectedBucket(selectedBucket === '90+' ? 'all' : '90+')}
          className={`p-3.5 rounded-[8px] border transition-colors cursor-pointer flex flex-col justify-between text-left ${
            selectedBucket === '90+'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-90-plus"
        >
          <span className={`text-xs font-medium block ${selectedBucket === '90+' ? 'text-[#1E40AF]' : 'text-[#991B1B]'}`}>
            90+ Days
          </span>
          <span className="text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary['90+'])}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === '90+' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            Delinquent account
          </span>
        </div>

        {/* Grand Total */}
        <div
          onClick={() => setSelectedBucket('all')}
          className={`p-3.5 rounded-[8px] border transition-colors cursor-pointer flex flex-col justify-between text-left ${
            selectedBucket === 'all'
              ? 'bg-[#EFF6FF] border-[#1D4ED8] ring-1 ring-[#1D4ED8] text-[#1E293B] shadow-2xs'
              : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8]'
          }`}
          data-testid="kpi-grand-total"
        >
          <span className={`text-xs font-medium block ${selectedBucket === 'all' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            Total Receivables
          </span>
          <span className="text-base font-bold mt-1 block tabular-nums text-[#1E293B]">
            {formatCurrency(summary.grandTotal)}
          </span>
          <span className={`text-xs mt-0.5 block tabular-nums ${selectedBucket === 'all' ? 'text-[#1E40AF]' : 'text-[#475569]'}`}>
            All brackets combined
          </span>
        </div>
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#475569] pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by client or invoice number..."
            className="pl-9 h-9 text-xs sm:text-sm rounded-[6px] border-[#E2E8F0] bg-white text-[#1E293B] focus-visible:ring-[#1D4ED8]"
            data-testid="aging-search-input"
          />
        </div>

        <div className="text-xs sm:text-sm text-[#475569]">
          Showing <span className="font-bold text-[#1E293B] tabular-nums">{filteredEntries.length}</span>{' '}
          outstanding invoices
          {selectedBucket !== 'all' && (
            <span className="ml-1 text-[#1E293B] font-medium">({selectedBucket} bucket)</span>
          )}
        </div>
      </div>

      {/* 3. Table of Aging Invoices */}
      {isLoading ? (
        <div className="p-12 text-center text-[#475569] bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0] shadow-card">
          <div className="inline-block animate-spin h-7 w-7 border-2 border-[#1D4ED8] border-t-transparent mb-2 rounded-full"></div>
          <p className="text-xs font-medium text-[#475569]">Loading aging report...</p>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div
          className="p-12 text-center bg-[#FFFFFF] rounded-[8px] border-2 border-dashed border-[#E2E8F0] space-y-2 shadow-card"
          data-testid="empty-aging-report"
        >
          <FileSpreadsheet className="w-10 h-10 text-[#475569] mx-auto" />
          <h3 className="text-sm font-semibold tracking-tight text-[#1E293B]">
            No overdue invoices found
          </h3>
          <p className="text-xs text-[#475569] max-w-sm mx-auto">
            All customer accounts in this bucket have zero outstanding balance.
          </p>
        </div>
      ) : (
        <div className="w-full overflow-x-auto rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] shadow-card">
          <Table>
            <TableHeader className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
              <TableRow>
                <TableHead className="text-xs font-semibold text-[#334155]">Invoice #</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155]">Client Name</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155]">Due Date</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155]">Days Overdue</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155]">Aging Bracket</TableHead>
                <TableHead className="text-xs font-semibold text-[#334155] text-right">
                  Total Amount
                </TableHead>
                <TableHead className="text-xs font-semibold text-[#334155] text-right">
                  Outstanding Balance
                </TableHead>
                <TableHead className="text-xs font-semibold text-[#334155] text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-[#E2E8F0]">
              {filteredEntries.map((row) => (
                <TableRow
                  key={row.id}
                  className="hover:bg-[#F8FAFC] transition-colors cursor-pointer"
                  onClick={() => onSelectInvoiceId && onSelectInvoiceId(row.id)}
                  data-testid={`aging-row-${row.id}`}
                >
                  <TableCell className="font-medium text-xs text-[#1E293B] py-3 tabular-nums">
                    {row.invoiceNumber}
                  </TableCell>
                  <TableCell className="text-xs text-[#1E293B] py-3 font-medium">
                    {row.clientName}
                  </TableCell>
                  <TableCell className="text-xs text-[#475569] py-3 tabular-nums">
                    {row.dueDate?.slice(0, 10)}
                  </TableCell>
                  <TableCell className="text-xs py-3 tabular-nums font-semibold">
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
                      {row.daysOverdue} days
                    </span>
                  </TableCell>
                  <TableCell className="py-3">
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
                  <TableCell className="text-xs text-[#475569] text-right py-3 tabular-nums">
                    {formatCurrency(row.total)}
                  </TableCell>
                  <TableCell className="text-xs font-bold text-[#1E293B] text-right py-3 tabular-nums">
                    {formatCurrency(row.balance)}
                  </TableCell>
                  <TableCell className="text-right py-3" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onSelectInvoiceId && onSelectInvoiceId(row.id)}
                      className="h-7 w-7 text-[#475569] hover:text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px] cursor-pointer"
                      title="View Invoice Details"
                      data-testid={`aging-view-btn-${row.id}`}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
