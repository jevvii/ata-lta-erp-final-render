import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Receipt,
  FileText,
  Archive,
  Plus,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Forbidden } from '@/components/common/Forbidden';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import { InvoiceList } from '@/features/billing/components/InvoiceList';
import { InvoiceDetailModal } from '@/features/billing/components/InvoiceDetailModal';
import { InvoiceCreateModal } from '@/features/billing/components/InvoiceCreateModal';
import { RecordPaymentModal } from '@/features/billing/components/RecordPaymentModal';
import { PrintPreviewModal } from '@/features/billing/components/PrintPreviewModal';
import { AgingReportTab } from '@/features/billing/components/AgingReportTab';
import { InvoiceArchiveTab } from '@/features/billing/components/InvoiceArchiveTab';
import { useInvoiceCounts, useInvoiceDetail } from '@/features/billing/api/useInvoices';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type { Invoice } from '@/features/billing/api/types';

export default function BillingPage() {
  useEntityRealtimeSync({ table: 'invoices' });
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'invoices';

  // Modal Visibility States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  // Deep Link Handling (?invoiceId=... or ?id=...)
  const invoiceIdParam = searchParams.get('invoiceId') || searchParams.get('id');
  const handledInvoiceIdRef = useRef<string | null>(null);
  const { data: deepLinkedInvoice } = useInvoiceDetail(invoiceIdParam || '', {
    enabled: Boolean(invoiceIdParam),
  });

  useEffect(() => {
    if (deepLinkedInvoice && handledInvoiceIdRef.current !== deepLinkedInvoice.id) {
      handledInvoiceIdRef.current = deepLinkedInvoice.id;
      setSelectedInvoice(deepLinkedInvoice);
      setIsDetailModalOpen(true);
    }
  }, [deepLinkedInvoice]);

  useEffect(() => {
    if (!invoiceIdParam) {
      handledInvoiceIdRef.current = null;
    }
  }, [invoiceIdParam]);

  // Session & RBAC
  const permissions = useSessionStore((state) => state.permissions);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const setActiveEntity = useSessionStore((state) => state.setActiveEntity);

  const canViewModule = hasPermission(permissions, 'billing:view');
  const canCreate = hasPermission(permissions, 'billing:edit');

  // Badge Counts Query
  const { data: invoiceCounts } = useInvoiceCounts();

  if (!canViewModule) {
    return <Forbidden requiredPermission="billing:view" />;
  }

  const handleTabChange = (val: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', val);
      return next;
    });
  };

  const handleOpenDetail = (inv: Invoice) => {
    setSelectedInvoice(inv);
    setIsDetailModalOpen(true);
  };

  const handleOpenPayment = (inv: Invoice) => {
    setPaymentInvoice(inv);
    setIsPaymentModalOpen(true);
  };

  const handleOpenPreview = (inv: Invoice) => {
    setPreviewInvoice(inv);
    setIsPreviewModalOpen(true);
  };

  const activeCount = invoiceCounts?.active ?? 0;
  const archivedCount = invoiceCounts?.archived ?? 0;

  return (
    <div className="w-full space-y-6" data-testid="billing-page">
      {/* 1. Unified Module Header */}
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
          >
            <span>Modules</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#1E293B] font-semibold">Billing</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <Receipt className="w-6 h-6 text-[#1D4ED8]" />
            <span>Billing, Invoicing &amp; Collections</span>
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
            Manage invoice drafting, client statements of account, accounts receivable aging, and collections.
          </p>
        </div>

        {/* Header Controls: Soft Segmented Entity Switcher & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {/* Active Entity Toggle */}
          <div
            className="flex items-center bg-[#F8FAFC] p-1 rounded-[8px] border border-[#E2E8F0]"
            data-testid="entity-switcher"
          >
            {(['ATA', 'LTA', 'ALL'] as const).map((ent) => (
              <button
                key={ent}
                type="button"
                onClick={() => setActiveEntity(ent)}
                className={`px-3 py-1 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
                  activeEntity === ent
                    ? 'bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs font-semibold'
                    : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60'
                }`}
                data-testid={`entity-btn-${ent.toLowerCase()}`}
              >
                {ent}
              </button>
            ))}
          </div>

          {/* New Invoice Button */}
          {canCreate && (
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] text-xs font-medium rounded-[6px] h-9 gap-1.5 shadow-2xs cursor-pointer"
              data-testid="header-create-invoice-button"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Invoice</span>
            </Button>
          )}
        </div>
      </div>

      {/* 2. Main Module Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="w-full justify-start rounded-[8px] bg-[#F8FAFC] p-1 border border-[#E2E8F0] gap-1 h-auto overflow-x-auto scrollbar-none flex flex-nowrap">
          <TabsTrigger
            value="invoices"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-trigger-invoices"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Invoices</span>
            {activeCount > 0 && (
              <Badge variant="secondary" className="text-xs tabular-nums px-1.5 py-0 h-4 ml-1.5 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]">
                {activeCount}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="aging"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-trigger-aging"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Aging Report</span>
          </TabsTrigger>

          <TabsTrigger
            value="archive"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-trigger-archive"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Archive</span>
            {archivedCount > 0 && (
              <Badge variant="secondary" className="text-xs tabular-nums px-1.5 py-0 h-4 ml-1.5 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]">
                {archivedCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="focus-visible:outline-none">
          <InvoiceList
            onSelectInvoice={handleOpenDetail}
            onRecordPayment={handleOpenPayment}
            onPrintPreview={handleOpenPreview}
          />
        </TabsContent>

        <TabsContent value="aging" className="focus-visible:outline-none">
          <AgingReportTab
            onSelectInvoiceId={(id) => {
              setSelectedInvoice({ id } as Invoice);
              setIsDetailModalOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="archive" className="focus-visible:outline-none">
          <InvoiceArchiveTab onSelectInvoice={handleOpenDetail} />
        </TabsContent>
      </Tabs>

      {/* 3. Modals */}
      <InvoiceCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      <InvoiceDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedInvoice(null);
          if (searchParams.get('invoiceId') || searchParams.get('id')) {
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('invoiceId');
              next.delete('id');
              return next;
            });
          }
        }}
        invoiceId={selectedInvoice?.id}
        initialInvoice={selectedInvoice}
        onOpenRecordPayment={handleOpenPayment}
        onOpenPrintPreview={handleOpenPreview}
      />

      <RecordPaymentModal
        isOpen={isPaymentModalOpen}
        onClose={() => {
          setIsPaymentModalOpen(false);
          setPaymentInvoice(null);
        }}
        invoice={paymentInvoice}
      />

      <PrintPreviewModal
        isOpen={isPreviewModalOpen}
        onClose={() => {
          setIsPreviewModalOpen(false);
          setPreviewInvoice(null);
        }}
        invoiceId={previewInvoice?.id}
        initialInvoice={previewInvoice}
      />

      {/* Headless Blocking Action Modal for zero optimistic updates */}
      <BlockingActionModal />
    </div>
  );
}
