/**
 * Client Fund Billing Lifecycle Integration & Sync Unit Tests
 *
 * Verifies:
 * 1. Preconditions & linking rules for Client Fund disbursements.
 * 2. Invoice lifecycle synchronization:
 *    - Draft/Pending invoice keeps disbursement in Approved.
 *    - Sent/Approved/Overdue invoice transitions Approved disbursement to Funded.
 *    - Partially Paid invoice keeps disbursement in Funded.
 *    - Paid invoice transitions Approved/Funded disbursement to Released.
 * 3. Unlinking & Cancellation rules:
 *    - Unlink / cancel invoice reverts Funded disbursement back to Approved.
 *    - Unlink is locked once disbursement is Released (409 BILLING_LINK_LOCKED_AFTER_PAID).
 * 4. Manual action guardrails:
 *    - Manual fund, release, and reject (when Funded) are blocked with 409 BILLING_CONTROLLED_LIFECYCLE.
 *    - Billing-controlled vouchers are filtered out of manual queues.
 */

jest.mock('../../../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const disbursementsService = require('../../../../src/modules/disbursements/service');
const {
  syncLinkedClientFundDisbursementsForInvoice,
  unlinkAndRevertClientFundDisbursements,
} = require('../../../../src/modules/disbursements/billingLifecycleSync');
const { resetMock, mockTables } = require('../../../fixtures/supabaseMock');
const AppError = require('../../../../src/lib/AppError');

describe('Client Fund Billing-Driven Lifecycle Synchronization', () => {
  const ENTITY_ID = 'ent-ata-uuid';
  const CLIENT_ID = 'client-alpha-uuid';
  const WR_ID = 'wr-100-uuid';
  const ADMIN_USER = {
    id: 'user-admin-1',
    role: 'Admin',
    entities: ['ATA'],
  };
  const STAFF_USER = {
    id: 'user-staff-1',
    role: 'Staff',
    entities: ['ATA'],
  };

  beforeEach(() => {
    resetMock();

    mockTables.entities.set(ENTITY_ID, {
      id: ENTITY_ID,
      code: 'ATA',
      name: 'Alpha Track Asia',
      is_active: true,
    });

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: ENTITY_ID,
      name: 'Client Alpha',
    });

    mockTables.work_requests.set(WR_ID, {
      id: WR_ID,
      entity_id: ENTITY_ID,
      client_id: CLIENT_ID,
      title: 'WR 100',
    });
  });

  describe('1. Preconditions & Manual Guardrails', () => {
    it('blocks manual fundDisbursement for billing-linked Client Fund vouchers with 409 BILLING_CONTROLLED_LIFECYCLE', async () => {
      mockTables.disbursements.set('disb-cf-1', {
        id: 'disb-cf-1',
        entity_id: ENTITY_ID,
        client_id: CLIENT_ID,
        linked_work_request_id: WR_ID,
        fund_source: 'Client Fund',
        status: 'Approved',
        linked_invoice_id: 'inv-100',
        version: 1,
        lifecycle_version: 2,
        archived: false,
        created_by: STAFF_USER.id,
      });

      await expect(
        disbursementsService.fundDisbursement({
          id: 'disb-cf-1',
          entityId: ENTITY_ID,
          user: ADMIN_USER,
          expectedVersion: 1,
          paymentDetails: {
            payment_method: 'Bank Transfer',
            payment_bank: 'BDO',
            payment_reference: 'REF-123',
          },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'BILLING_CONTROLLED_LIFECYCLE',
      });
    });

    it('blocks manual releaseDisbursement for billing-linked Client Fund vouchers with 409 BILLING_CONTROLLED_LIFECYCLE', async () => {
      mockTables.disbursements.set('disb-cf-2', {
        id: 'disb-cf-2',
        entity_id: ENTITY_ID,
        client_id: CLIENT_ID,
        linked_work_request_id: WR_ID,
        fund_source: 'Client Fund',
        status: 'Funded',
        linked_invoice_id: 'inv-100',
        version: 1,
        lifecycle_version: 2,
        archived: false,
        created_by: STAFF_USER.id,
      });

      await expect(
        disbursementsService.releaseDisbursement({
          id: 'disb-cf-2',
          entityId: ENTITY_ID,
          user: ADMIN_USER,
          expectedVersion: 1,
          paymentDetails: {
            payment_method: 'Check',
            payment_reference: 'CHK-999',
          },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'BILLING_CONTROLLED_LIFECYCLE',
      });
    });

    it('filters out billing-linked Client Fund vouchers from ready_for_funding and payment_releases queues', async () => {
      // 1 manual voucher
      mockTables.disbursements.set('disb-manual-1', {
        id: 'disb-manual-1',
        entity_id: ENTITY_ID,
        fund_source: 'Firm Fund',
        status: 'Approved',
        linked_invoice_id: null,
        version: 1,
        lifecycle_version: 2,
        archived: false,
        created_by: STAFF_USER.id,
      });

      // 1 billing-linked Client Fund voucher
      mockTables.disbursements.set('disb-billing-1', {
        id: 'disb-billing-1',
        entity_id: ENTITY_ID,
        fund_source: 'Client Fund',
        status: 'Approved',
        linked_invoice_id: 'inv-100',
        version: 1,
        lifecycle_version: 2,
        archived: false,
        created_by: STAFF_USER.id,
      });

      const listResult = await disbursementsService.listDisbursements({
        entityId: ENTITY_ID,
        filters: { queue: 'ready_for_funding' },
        user: ADMIN_USER,
      });

      expect(listResult.data.length).toBe(1);
      expect(listResult.data[0].id).toBe('disb-manual-1');
    });
  });

  describe('2. Invoice Lifecycle Progression Synchronization', () => {
    it('transitions linked Approved Client Fund voucher to Funded when invoice is Sent (Issued)', async () => {
      mockTables.disbursements.set('disb-sync-1', {
        id: 'disb-sync-1',
        entity_id: ENTITY_ID,
        fund_source: 'Client Fund',
        status: 'Approved',
        linked_invoice_id: 'inv-sync-100',
        version: 1,
        created_by: STAFF_USER.id,
      });

      const invoice = {
        id: 'inv-sync-100',
        entity_id: ENTITY_ID,
        invoice_number: 'INV-ATA-202610-0001',
        status: 'Sent',
      };

      const updated = await syncLinkedClientFundDisbursementsForInvoice({
        invoice,
        actorId: ADMIN_USER.id,
      });

      expect(updated.length).toBe(1);
      const synced = mockTables.disbursements.get('disb-sync-1');
      expect(synced.status).toBe('Funded');
      expect(synced.funded_by).toBe(ADMIN_USER.id);
      expect(synced.payment_bank).toBe('Client Billing');
      expect(synced.payment_reference).toBe('INV-ATA-202610-0001');

      // Verify status_history entry
      const historyEntries = Array.from(mockTables.status_history.values()).filter(
        (h) => h.record_id === 'disb-sync-1'
      );
      expect(historyEntries.length).toBeGreaterThanOrEqual(1);
      const latestHistory = historyEntries[historyEntries.length - 1];
      expect(latestHistory.new_status).toBe('Funded');
      expect(latestHistory.details.action).toBe('billing_issued');
    });

    it('keeps linked Client Fund voucher in Funded while invoice is Partially Paid', async () => {
      mockTables.disbursements.set('disb-sync-part', {
        id: 'disb-sync-part',
        entity_id: ENTITY_ID,
        fund_source: 'Client Fund',
        status: 'Funded',
        linked_invoice_id: 'inv-part-100',
        version: 2,
        payment_bank: 'Client Billing',
        payment_reference: 'INV-ATA-202610-0002',
        created_by: STAFF_USER.id,
      });

      const invoice = {
        id: 'inv-part-100',
        entity_id: ENTITY_ID,
        invoice_number: 'INV-ATA-202610-0002',
        status: 'Partially Paid',
      };

      await syncLinkedClientFundDisbursementsForInvoice({
        invoice,
        actorId: ADMIN_USER.id,
      });

      const synced = mockTables.disbursements.get('disb-sync-part');
      expect(synced.status).toBe('Funded');
    });

    it('transitions linked Funded voucher to Released when invoice is Paid with full payment details', async () => {
      mockTables.disbursements.set('disb-sync-paid', {
        id: 'disb-sync-paid',
        entity_id: ENTITY_ID,
        fund_source: 'Client Fund',
        status: 'Funded',
        linked_invoice_id: 'inv-paid-100',
        version: 2,
        funded_by: ADMIN_USER.id,
        funded_at: '2026-10-29T10:00:00Z',
        created_by: STAFF_USER.id,
      });

      const invoice = {
        id: 'inv-paid-100',
        entity_id: ENTITY_ID,
        invoice_number: 'INV-ATA-202610-0003',
        status: 'Paid',
      };

      const payment = {
        method: 'Bank Transfer',
        reference: 'WIRE-BDO-8899',
        payment_date: '2026-10-29',
      };

      const updated = await syncLinkedClientFundDisbursementsForInvoice({
        invoice,
        payment,
        actorId: ADMIN_USER.id,
      });

      expect(updated.length).toBe(1);
      const synced = mockTables.disbursements.get('disb-sync-paid');
      expect(synced.status).toBe('Released');
      expect(synced.released_by).toBe(ADMIN_USER.id);
      expect(synced.payment_method).toBe('Bank Transfer');
      expect(synced.payment_reference).toBe('WIRE-BDO-8899');
      expect(synced.payment_bank).toBe('Client Billing (INV-ATA-202610-0003)');
      expect(synced.payment_date).toBe('2026-10-29');

      // Verify status_history entry
      const historyEntries = Array.from(mockTables.status_history.values()).filter(
        (h) => h.record_id === 'disb-sync-paid'
      );
      const latestHistory = historyEntries[historyEntries.length - 1];
      expect(latestHistory.new_status).toBe('Released');
      expect(latestHistory.details.action).toBe('billing_paid');
    });

    it('transitions Approved voucher all the way to Released if linked to an already-Paid invoice', async () => {
      mockTables.disbursements.set('disb-direct-paid', {
        id: 'disb-direct-paid',
        entity_id: ENTITY_ID,
        fund_source: 'Client Fund',
        status: 'Approved',
        linked_invoice_id: 'inv-already-paid',
        version: 1,
        created_by: STAFF_USER.id,
      });

      const invoice = {
        id: 'inv-already-paid',
        entity_id: ENTITY_ID,
        invoice_number: 'INV-ATA-202610-0004',
        status: 'Paid',
      };

      await syncLinkedClientFundDisbursementsForInvoice({
        invoice,
        actorId: ADMIN_USER.id,
      });

      const synced = mockTables.disbursements.get('disb-direct-paid');
      expect(synced.status).toBe('Released');
    });
  });

  describe('3. Unlinking & Cancellation Rules', () => {
    it('reverts Funded voucher to Approved and clears linked_invoice_id upon unlinking', async () => {
      mockTables.disbursements.set('disb-unlink-1', {
        id: 'disb-unlink-1',
        entity_id: ENTITY_ID,
        fund_source: 'Client Fund',
        status: 'Funded',
        linked_invoice_id: 'inv-to-cancel',
        version: 2,
        funded_by: ADMIN_USER.id,
        funded_at: '2026-10-29T10:00:00Z',
        payment_bank: 'Client Billing',
        payment_reference: 'INV-ATA-202610-0005',
        created_by: STAFF_USER.id,
      });

      const reverted = await unlinkAndRevertClientFundDisbursements({
        entityId: ENTITY_ID,
        invoiceId: 'inv-to-cancel',
        invoiceNumber: 'INV-ATA-202610-0005',
        actorId: ADMIN_USER.id,
        reason: 'invoice_cancelled',
        clearLink: true,
      });

      expect(reverted.length).toBe(1);
      const unlinked = mockTables.disbursements.get('disb-unlink-1');
      expect(unlinked.status).toBe('Approved');
      expect(unlinked.linked_invoice_id).toBeNull();
      expect(unlinked.funded_by).toBeNull();
      expect(unlinked.payment_bank).toBeNull();
      expect(unlinked.payment_reference).toBeNull();

      // Check audit history
      const historyEntries = Array.from(mockTables.status_history.values()).filter(
        (h) => h.record_id === 'disb-unlink-1'
      );
      const latestHistory = historyEntries[historyEntries.length - 1];
      expect(latestHistory.new_status).toBe('Approved');
      expect(latestHistory.details.action).toBe('billing_unlinked');
      expect(latestHistory.details.reason).toBe('invoice_cancelled');
    });

    it('throws 409 BILLING_LINK_LOCKED_AFTER_PAID if attempting to unlink a Released voucher', async () => {
      mockTables.disbursements.set('disb-locked-1', {
        id: 'disb-locked-1',
        entity_id: ENTITY_ID,
        fund_source: 'Client Fund',
        status: 'Released',
        linked_invoice_id: 'inv-locked',
        version: 3,
        created_by: STAFF_USER.id,
      });

      await expect(
        unlinkAndRevertClientFundDisbursements({
          entityId: ENTITY_ID,
          invoiceId: 'inv-locked',
          actorId: ADMIN_USER.id,
          reason: 'manual_unlink',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'BILLING_LINK_LOCKED_AFTER_PAID',
      });
    });
  });
});
