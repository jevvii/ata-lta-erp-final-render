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
import type { Invoice } from '@/features/billing/api/types';

export default function BillingPage() {
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

  // Deep Link Handling (?invoiceId=...)
  const invoiceIdParam = searchParams.get('invoiceId');
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
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="billing-page">
      {/* 1. Page Header & Breadcrumbs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5 pb-1">
            <span>Modules</span>
            <span>/</span>
            <span className="text-slate-900 font-semibold">Billing</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Receipt className="w-6 h-6 text-blue-600" />
            <span>Billing, Invoicing & Collections</span>
          </h1>
          <p className="text-xs text-slate-500 pt-0.5">
            Manage invoice drafting, client statements of account, accounts receivable aging, and collections.
          </p>
        </div>

        {/* Header Controls: Entity Switcher & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Active Entity Toggle */}
          <div
            className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200"
            data-testid="entity-switcher"
          >
            {(['ATA', 'LTA', 'ALL'] as const).map((ent) => (
              <button
                key={ent}
                type="button"
                onClick={() => setActiveEntity(ent)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeEntity === ent
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
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
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 gap-1.5 shadow-xs cursor-pointer"
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
        <TabsList className="bg-slate-100 p-1 border border-slate-200 rounded-xl">
          <TabsTrigger
            value="invoices"
            className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-lg cursor-pointer"
            data-testid="tab-trigger-invoices"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Invoices</span>
            {activeCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {activeCount}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="aging"
            className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-lg cursor-pointer"
            data-testid="tab-trigger-aging"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Aging Report</span>
          </TabsTrigger>

          <TabsTrigger
            value="archive"
            className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-lg cursor-pointer"
            data-testid="tab-trigger-archive"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Archive</span>
            {archivedCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {archivedCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="focus-visible:outline-none">
          <InvoiceList
            onSelectInvoice={handleOpenDetail}
            onCreateInvoice={() => setIsCreateModalOpen(true)}
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
          if (searchParams.get('invoiceId')) {
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('invoiceId');
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
