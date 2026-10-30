import { apiRequest, queryClient } from '@/lib/api';
import { runBlockingAction } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import { broadcastEntityChange } from '@/lib/tabSync';
import { billingKeys } from './queryKeys';
import { disbursementKeys } from '@/features/disbursements/api/queryKeys';
import { transmittalKeys } from '@/features/transmittals/api/queryKeys';
import type {
  Invoice,
  InvoiceListResponse,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  RecordPaymentInput,
  InvoicePayment,
} from './types';

function pinAndBroadcastInvoice(serverInvoice: Invoice): void {
  // 1. Authoritative detail cache pinning
  queryClient.setQueryData<Invoice>(
    billingKeys.invoiceDetail(serverInvoice.id),
    serverInvoice
  );

  // 2. Multi-list in-place cache pinning
  const allLists = queryClient.getQueriesData<InvoiceListResponse>({
    queryKey: billingKeys.invoices(),
  });
  for (const [key, value] of allLists) {
    if (value && typeof value === 'object' && Array.isArray(value.data)) {
      if (value.data.some((inv) => inv?.id === serverInvoice.id)) {
        queryClient.setQueryData(key, {
          ...value,
          data: value.data.map((inv) =>
            inv?.id === serverInvoice.id ? { ...inv, ...serverInvoice } : inv
          ),
        });
      }
    }
  }

  // 3. Cross-tab tab sync broadcast
  broadcastEntityChange({
    domain: 'billing',
    entityId: serverInvoice.id,
    entityData: serverInvoice,
  });
}

// ============================================================================
// Direct Blocking Action Runners (Zero Optimistic Updates)
// ============================================================================

export async function createInvoiceAction(
  data: CreateInvoiceInput,
  activeEntity?: string | null
): Promise<Invoice> {
  return runBlockingAction<Invoice>({
    title: 'Creating Invoice',
    message: `Submitting invoice ${data.invoiceNumber} with ${data.lineItems.length} line item(s)...`,
    actionName: 'Create Invoice',
    apiCall: async () => {
      const res = await apiRequest<{ data: Invoice }>('/invoices', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return res.data;
    },
    invalidateQueries: [
      billingKeys.all,
      billingKeys.invoices(),
      billingKeys.counts(activeEntity),
      billingKeys.aging(activeEntity),
      disbursementKeys.all,
      transmittalKeys.all,
    ],
  });
}

export async function updateInvoiceAction(
  id: string,
  data: UpdateInvoiceInput,
  expectedVersionOrEntity?: number | string | null,
  activeEntity?: string | null
): Promise<Invoice> {
  const explicitVersion =
    typeof expectedVersionOrEntity === 'number'
      ? expectedVersionOrEntity
      : data.expectedVersion;
  const entity =
    typeof expectedVersionOrEntity === 'string'
      ? expectedVersionOrEntity
      : activeEntity;

  return runBlockingAction<Invoice>({
    title: 'Updating Invoice',
    message: 'Persisting invoice modifications to server...',
    actionName: 'Update Invoice',
    apiCall: async () => {
      const payload: Record<string, unknown> = { ...data };
      if (typeof explicitVersion === 'number') {
        payload.expectedVersion = explicitVersion;
      } else if (typeof data.expectedVersion === 'number') {
        payload.expectedVersion = data.expectedVersion;
      }

      const res = await apiRequest<{ data: Invoice }>(`/invoices/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: (serverInvoice) => {
      pinAndBroadcastInvoice(serverInvoice);
    },
    invalidateQueries: [
      billingKeys.counts(entity),
      billingKeys.aging(entity),
      disbursementKeys.all,
      transmittalKeys.all,
    ],
  });
}

/**
 * Field-level secure address updater (P0-G §3.2 / AC-4, AC-5).
 * Updates the invoice snapshot address only. Master clients record remains immutable.
 */
export async function updateClientAddressAction(
  id: string,
  address: string,
  expectedVersion?: number,
  activeEntity?: string | null
): Promise<Invoice> {
  return runBlockingAction<Invoice>({
    title: 'Updating Invoice Client Address',
    message: 'Saving client address to invoice snapshot (master client record remains untouched)...',
    actionName: 'Update Client Address',
    successTitle: 'Address Snapshot Updated',
    successMessage: 'Updated invoice snapshot address only. Master client record remains unchanged.',
    apiCall: async () => {
      const payload: Record<string, unknown> = { address };
      if (typeof expectedVersion === 'number') {
        payload.expectedVersion = expectedVersion;
      }
      const res = await apiRequest<{ data: Invoice }>(`/invoices/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: (serverInvoice) => {
      pinAndBroadcastInvoice(serverInvoice);
    },
    invalidateQueries: [
      billingKeys.counts(activeEntity),
      billingKeys.aging(activeEntity),
    ],
  });
}

export async function deleteInvoiceAction(
  id: string,
  invoiceNumber?: string,
  activeEntity?: string | null
): Promise<void> {
  return runBlockingAction<void>({
    title: 'Deleting Invoice',
    message: `Soft deleting invoice ${invoiceNumber || id}...`,
    actionName: 'Delete Invoice',
    apiCall: async () => {
      await apiRequest<void>(`/invoices/${id}`, {
        method: 'DELETE',
      });
    },
    invalidateQueries: [
      billingKeys.all,
      billingKeys.invoices(),
      billingKeys.counts(activeEntity),
      billingKeys.aging(activeEntity),
      disbursementKeys.all,
      transmittalKeys.all,
    ],
  });
}

export async function archiveInvoiceAction(
  id: string,
  invoiceNumber?: string,
  activeEntity?: string | null
): Promise<Invoice> {
  return runBlockingAction<Invoice>({
    title: 'Archiving Invoice',
    message: `Moving invoice ${invoiceNumber || id} to archive...`,
    actionName: 'Archive Invoice',
    apiCall: async () => {
      const res = await apiRequest<{ data: Invoice }>(`/invoices/${id}/archive`, {
        method: 'POST',
      });
      return res.data;
    },
    invalidateQueries: [
      billingKeys.all,
      billingKeys.invoices(),
      billingKeys.invoiceDetail(id),
      billingKeys.counts(activeEntity),
      billingKeys.aging(activeEntity),
    ],
  });
}

export async function restoreInvoiceAction(
  id: string,
  invoiceNumber?: string,
  activeEntity?: string | null
): Promise<Invoice> {
  return runBlockingAction<Invoice>({
    title: 'Restoring Invoice',
    message: `Restoring invoice ${invoiceNumber || id} from archive...`,
    actionName: 'Restore Invoice',
    apiCall: async () => {
      const res = await apiRequest<{ data: Invoice }>(`/invoices/${id}/unarchive`, {
        method: 'POST',
      });
      return res.data;
    },
    invalidateQueries: [
      billingKeys.all,
      billingKeys.invoices(),
      billingKeys.invoiceDetail(id),
      billingKeys.counts(activeEntity),
      billingKeys.aging(activeEntity),
    ],
  });
}

export async function recordPaymentAction(
  invoiceId: string,
  data: RecordPaymentInput,
  activeEntity?: string | null
): Promise<InvoicePayment> {
  return runBlockingAction<InvoicePayment>({
    title: 'Recording Payment',
    message: `Recording payment of ₱${data.amount.toLocaleString('en-PH', {
      minimumFractionDigits: 2,
    })} via ${data.method}...`,
    actionName: 'Record Payment',
    successTitle: 'Payment Recorded',
    successMessage: `Successfully recorded payment of ₱${data.amount.toLocaleString('en-PH', {
      minimumFractionDigits: 2,
    })}.`,
    apiCall: async () => {
      const res = await apiRequest<{ data: InvoicePayment }>(
        `/invoices/${invoiceId}/payments`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
    invalidateQueries: [
      billingKeys.all,
      billingKeys.invoices(),
      billingKeys.invoiceDetail(invoiceId),
      billingKeys.counts(activeEntity),
      billingKeys.aging(activeEntity),
    ],
  });
}

export async function fetchInvoicePdfUrl(id: string, includeCompanyDetails = true): Promise<string> {
  const res = await apiRequest<{ data: { url: string } }>(`/invoices/${id}/pdf?includeCompanyDetails=${includeCompanyDetails}`);
  return res.data.url;
}

export async function fetchVoucherPdfUrl(id: string): Promise<string> {
  const res = await apiRequest<{ data: { url: string } }>(`/invoices/${id}/voucher`);
  return res.data.url;
}

// ============================================================================
// React Hook
// ============================================================================

export function useBillingMutations() {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return {
    createInvoice: (data: CreateInvoiceInput) => createInvoiceAction(data, activeEntity),
    updateInvoice: (
      id: string,
      data: UpdateInvoiceInput,
      expectedVersion?: number
    ) => updateInvoiceAction(id, data, expectedVersion, activeEntity),
    updateClientAddress: (id: string, address: string, expectedVersion?: number) =>
      updateClientAddressAction(id, address, expectedVersion, activeEntity),
    deleteInvoice: (id: string, invoiceNumber?: string) =>
      deleteInvoiceAction(id, invoiceNumber, activeEntity),
    archiveInvoice: (id: string, invoiceNumber?: string) =>
      archiveInvoiceAction(id, invoiceNumber, activeEntity),
    restoreInvoice: (id: string, invoiceNumber?: string) =>
      restoreInvoiceAction(id, invoiceNumber, activeEntity),
    recordPayment: (invoiceId: string, data: RecordPaymentInput) =>
      recordPaymentAction(invoiceId, data, activeEntity),
    fetchInvoicePdfUrl,
    fetchVoucherPdfUrl,
  };
}
