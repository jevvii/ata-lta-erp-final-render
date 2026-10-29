/**
 * Billing-Driven Lifecycle Synchronization for Client Fund Disbursements.
 *
 * Implements automatic state progression and unlinking/reverting:
 * - Draft/Pending invoice: linked Client Fund disbursements remain Approved
 *   (or revert from Funded to Approved if invoice was un-sent).
 * - Sent/Approved/Overdue/Partially Paid invoice: linked Approved Client Fund
 *   disbursements transition to Funded.
 * - Paid invoice: linked Approved/Funded Client Fund disbursements transition to Released.
 * - Unlink / invoice cancellation / invoice deletion: reverts Funded vouchers to Approved
 *   and clears linked_invoice_id, unless already Released (which is locked).
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const { invalidateAnalytics } = require('../reports/service');
const { resolveEntityCode } = require('../../lib/entityResolver');

const safeNotify = async (userIds, type, payload) => {
  try {
    let notifyModule = null;
    try {
      notifyModule = require('../../services/notify');
    } catch (_err) {
      notifyModule = null;
    }
    if (notifyModule && typeof notifyModule.notify === 'function') {
      await notifyModule.notify(userIds, type, payload);
    }
  } catch (err) {
    // Non-blocking notification dispatch per Rule R5
    console.warn('[NOTIFY] Failed to dispatch notification:', err?.message || err);
  }
};

const dispatchDisbursementNotification = async (record, action, audience, actorId) => {
  invalidateAnalytics(record.entity_id);
  try {
    const code = await resolveEntityCode(record.entity_id);
    if (!code) return;
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id, role, entities, is_active, user_departments(departments(name))')
      .eq('is_active', true);
    if (error || !Array.isArray(users)) return;
    const recipients = users
      .filter((user) => {
        if (!Array.isArray(user.entities) || !user.entities.includes(code) || user.id === actorId)
          return false;
        if (audience === 'requester') return user.id === (record.requested_by || record.created_by);
        if (audience === 'admin') return user.role === 'Admin';
        return (
          user.role === 'Admin' ||
          user.role === 'Accounting' ||
          (user.user_departments || []).some(
            (link) => link.departments?.name?.toLowerCase() === 'accounting'
          )
        );
      })
      .map((user) => user.id);

    await safeNotify(recipients, 'disbursement.lifecycle', {
      action,
      table_name: 'disbursements',
      request_id: record.id,
      entity: code,
      disbursement_number: record.disbursement_number,
      title: record.disbursement_number || record.description,
      reason: record.rejection_reason || undefined,
    });
  } catch (_err) {
    /* Notifications failure does not abort database transactions */
  }
};

/**
 * Synchronize linked Client Fund disbursements with invoice lifecycle state.
 */
const syncLinkedClientFundDisbursementsForInvoice = async ({
  invoice,
  payment = null,
  actorId,
  disbursementIds = null,
}) => {
  if (!invoice || !invoice.id) return [];

  let query = supabaseAdmin
    .from('disbursements')
    .select('*')
    .eq('entity_id', invoice.entity_id)
    .eq('linked_invoice_id', invoice.id)
    .eq('fund_source', 'Client Fund')
    .is('deleted_at', null);

  if (Array.isArray(disbursementIds) && disbursementIds.length > 0) {
    query = query.in('id', disbursementIds);
  }

  const { data: disbursements, error: fetchErr } = await query;
  if (fetchErr) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to fetch linked Client Fund disbursements for synchronization',
    });
  }

  if (!disbursements || disbursements.length === 0) return [];

  const nowIso = new Date().toISOString();
  const todayDateStr = nowIso.slice(0, 10);
  const updatedRecords = [];

  // Case 1: Invoice in Draft or Pending
  if (['Draft', 'Pending'].includes(invoice.status)) {
    for (const d of disbursements) {
      if (d.status === 'Funded') {
        const nextVersion = (Number(d.version) || 1) + 1;
        const { data: updated, error: updateErr } = await supabaseAdmin
          .from('disbursements')
          .update({
            status: 'Approved',
            funded_by: null,
            funded_at: null,
            payment_method: null,
            payment_bank: null,
            payment_reference: null,
            payment_date: null,
            payment_processed_by: null,
            version: nextVersion,
            updated_by: actorId,
            updated_at: nowIso,
          })
          .eq('id', d.id)
          .select();

        if (updateErr) {
          throw new AppError({
            statusCode: 500,
            title: 'Database Error',
            detail: `Failed to revert disbursement ${d.id} to Approved`,
          });
        }

        const updatedRow = updated?.[0] || { ...d, status: 'Approved' };
        updatedRecords.push(updatedRow);

        await supabaseAdmin.from('status_history').insert({
          table_name: 'disbursements',
          record_id: d.id,
          old_status: 'Funded',
          new_status: 'Approved',
          actor_id: actorId,
          entity_id: d.entity_id,
          details: {
            action: 'billing_reverted_to_draft',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
          },
          created_at: nowIso,
        });

        invalidateAnalytics(d.entity_id);
      }
    }
  }

  // Case 2: Invoice in Sent, Approved, Overdue, or Partially Paid
  else if (['Sent', 'Approved', 'Overdue', 'Partially Paid'].includes(invoice.status)) {
    for (const d of disbursements) {
      if (d.status === 'Approved') {
        const nextVersion = (Number(d.version) || 1) + 1;
        const paymentMethod = d.payment_method || 'Client Billing';
        const paymentBank = 'Client Billing';
        const paymentRef = invoice.invoice_number;
        const paymentDate = d.payment_date || todayDateStr;

        const { data: updated, error: updateErr } = await supabaseAdmin
          .from('disbursements')
          .update({
            status: 'Funded',
            funded_by: actorId,
            funded_at: nowIso,
            payment_method: paymentMethod,
            payment_bank: paymentBank,
            payment_reference: paymentRef,
            payment_date: paymentDate,
            version: nextVersion,
            updated_by: actorId,
            updated_at: nowIso,
          })
          .eq('id', d.id)
          .select();

        if (updateErr) {
          throw new AppError({
            statusCode: 500,
            title: 'Database Error',
            detail: `Failed to transition disbursement ${d.id} to Funded`,
          });
        }

        const updatedRow = updated?.[0] || { ...d, status: 'Funded' };
        updatedRecords.push(updatedRow);

        await supabaseAdmin.from('status_history').insert({
          table_name: 'disbursements',
          record_id: d.id,
          old_status: 'Approved',
          new_status: 'Funded',
          actor_id: actorId,
          entity_id: d.entity_id,
          details: {
            action: 'billing_issued',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            invoice_status: invoice.status,
            payment_bank: paymentBank,
            payment_reference: paymentRef,
          },
          created_at: nowIso,
        });

        await dispatchDisbursementNotification(updatedRow, 'fund', 'admin', actorId);
      }
      // Note: If already 'Funded', it remains 'Funded' during Partially Paid
    }
  }

  // Case 3: Invoice is Paid
  else if (invoice.status === 'Paid') {
    let latestPayment = null;
    if (!payment) {
      const { data: payRows } = await supabaseAdmin
        .from('invoice_payments')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('payment_date', { ascending: false })
        .limit(1);
      latestPayment = payRows?.[0] || null;
    }

    const resolvedMethod = payment?.method || latestPayment?.method || 'Bank Transfer';
    const rawRef = payment?.reference || latestPayment?.reference;
    const resolvedReference = (rawRef && String(rawRef).trim()) || invoice.invoice_number;
    const resolvedBank = `Client Billing (${invoice.invoice_number})`;
    const resolvedDate =
      payment?.payment_date || payment?.paymentDate || latestPayment?.payment_date || todayDateStr;

    for (const d of disbursements) {
      if (['Approved', 'Funded'].includes(d.status)) {
        const nextVersion = (Number(d.version) || 1) + 1;
        const { data: updated, error: updateErr } = await supabaseAdmin
          .from('disbursements')
          .update({
            status: 'Released',
            funded_by: d.funded_by || actorId,
            funded_at: d.funded_at || nowIso,
            released_by: actorId,
            released_at: nowIso,
            payment_processed_by: actorId,
            payment_method: resolvedMethod,
            payment_reference: resolvedReference,
            payment_bank: resolvedBank,
            payment_date: resolvedDate,
            version: nextVersion,
            updated_by: actorId,
            updated_at: nowIso,
          })
          .eq('id', d.id)
          .select();

        if (updateErr) {
          throw new AppError({
            statusCode: 500,
            title: 'Database Error',
            detail: `Failed to transition disbursement ${d.id} to Released`,
          });
        }

        const updatedRow = updated?.[0] || { ...d, status: 'Released' };
        updatedRecords.push(updatedRow);

        await supabaseAdmin.from('status_history').insert({
          table_name: 'disbursements',
          record_id: d.id,
          old_status: d.status,
          new_status: 'Released',
          actor_id: actorId,
          entity_id: d.entity_id,
          details: {
            action: 'billing_paid',
            invoice_id: invoice.id,
            invoice_number: invoice.invoice_number,
            payment_method: resolvedMethod,
            payment_reference: resolvedReference,
            payment_bank: resolvedBank,
            payment_date: resolvedDate,
          },
          created_at: nowIso,
        });

        await dispatchDisbursementNotification(updatedRow, 'release', 'requester', actorId);
      }
    }
  }

  return updatedRecords;
};

/**
 * Unlink and revert Client Fund disbursements back to Approved (or clean link).
 */
const unlinkAndRevertClientFundDisbursements = async ({
  entityId,
  invoiceId = null,
  invoiceNumber = null,
  disbursementIds = null,
  actorId,
  reason = 'billing_unlinked',
  clearLink = true,
}) => {
  let query = supabaseAdmin
    .from('disbursements')
    .select('*')
    .eq('fund_source', 'Client Fund')
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  if (Array.isArray(disbursementIds) && disbursementIds.length > 0) {
    query = query.in('id', disbursementIds);
  } else if (invoiceId) {
    query = query.eq('linked_invoice_id', invoiceId);
  } else {
    return [];
  }

  const { data: disbursements, error } = await query;
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to fetch disbursements for unlinking',
    });
  }

  if (!disbursements || disbursements.length === 0) return [];

  // Check if any disbursement is Released
  for (const d of disbursements) {
    if (d.status === 'Released') {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        code: 'BILLING_LINK_LOCKED_AFTER_PAID',
        detail:
          'Cannot unlink or cancel billing link after the Client Fund disbursement has been Paid/Released.',
      });
    }
  }

  const nowIso = new Date().toISOString();
  const revertedRecords = [];

  for (const d of disbursements) {
    const nextVersion = (Number(d.version) || 1) + 1;
    const updates = {
      version: nextVersion,
      updated_by: actorId,
      updated_at: nowIso,
    };

    if (clearLink) {
      updates.linked_invoice_id = null;
    }

    const wasFunded = d.status === 'Funded';
    if (wasFunded) {
      updates.status = 'Approved';
      updates.funded_by = null;
      updates.funded_at = null;
      updates.payment_method = null;
      updates.payment_bank = null;
      updates.payment_reference = null;
      updates.payment_date = null;
      updates.payment_processed_by = null;
    }

    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('disbursements')
      .update(updates)
      .eq('id', d.id)
      .select();

    if (updateErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to unlink disbursement ${d.id}`,
      });
    }

    const updatedRow = updated?.[0] || { ...d, ...updates };
    revertedRecords.push(updatedRow);

    await supabaseAdmin.from('status_history').insert({
      table_name: 'disbursements',
      record_id: d.id,
      old_status: d.status,
      new_status: wasFunded ? 'Approved' : d.status,
      actor_id: actorId,
      entity_id: d.entity_id,
      details: {
        action: 'billing_unlinked',
        previous_invoice_id: invoiceId || d.linked_invoice_id,
        invoice_number: invoiceNumber,
        reason,
      },
      created_at: nowIso,
    });

    invalidateAnalytics(d.entity_id);
  }

  return revertedRecords;
};

module.exports = {
  syncLinkedClientFundDisbursementsForInvoice,
  unlinkAndRevertClientFundDisbursements,
};
