import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { DisbursementAuditTimeline } from '../components/DisbursementAuditTimeline';
import { auditActionLabel } from '../lib/auditActionLabel';
import type { Disbursement } from '../api/types';

const voucher = {
  id: 'voucher',
  created_by: 'creator',
  created_by_name: 'Twinkle Marquez',
  created_by_role: 'Staff',
  created_at: '2026-10-20T01:30:00Z',
} as Disbursement;

describe('Disbursement lifecycle audit display', () => {
  it.each([
    ['create', 'Created'],
    ['disbursement.approve', 'Approved'],
    ['resend_draft', 'Resent for Review'],
    ['payment_details_update', 'Payment Details Updated'],
    ['future_action', 'Future Action'],
  ])('labels %s as %s', (action, label) => {
    expect(auditActionLabel(action)).toBe(label);
  });

  it('shows profile initials, name, role, readable action, status and Manila timestamp', () => {
    render(
      <DisbursementAuditTimeline
        item={{
          ...voucher,
          lifecycle_history: [
            {
              action: 'create',
              actor_id: 'creator',
              actor_name: 'Twinkle Marquez',
              actor_role: 'Staff',
              old_status: null,
              new_status: 'Draft',
              created_at: '2026-10-20T01:30:00Z',
              details: { amount: 1500 },
            },
          ],
        }}
      />
    );
    expect(screen.getByText('TM')).toBeInTheDocument();
    expect(screen.getByText('Twinkle Marquez')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.queryByText('create', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByTestId('disbursement-status-badge')).toHaveTextContent('Draft');
    expect(screen.getByText(/Oct 20, 2026.*9:30.*AM/).closest('time')).toHaveAttribute(
      'dateTime',
      '2026-10-20T01:30:00Z'
    );
    expect(screen.getByText(/Amount:/)).toHaveTextContent('1,500.00');
  });

  it('formats transitions, complete rejection notes, changed amounts and payment details without internal paths', () => {
    render(
      <DisbursementAuditTimeline
        item={{
          ...voucher,
          lifecycle_history: [
            {
              action: 'edit',
              actor_id: 'creator',
              actor_name: 'Twinkle Marquez',
              old_status: 'Draft',
              new_status: 'Approved',
              created_at: '2026-10-20T01:30:00Z',
              reason: 'First reason\nComplete second line',
              notes: 'Full audit note',
              details: {
                before: { amount: 1500, receipt_s3_key: 'entities/LTA/private.pdf' },
                after: { amount: 1750, receipt_s3_key: 'entities/LTA/secret.pdf' },
                payment_details: {
                  method: 'Bank Transfer',
                  bank: 'BDO',
                  reference: 'PAY-123',
                  date: '2026-10-20',
                },
              },
            },
          ],
        }}
      />
    );
    const entry = screen.getByTestId('lifecycle-audit-entry');
    expect(
      within(entry)
        .getAllByTestId('disbursement-status-badge')
        .map((badge) => badge.textContent)
    ).toEqual(['Draft', 'Approved']);
    expect(screen.getByText(/Reason:/).textContent).toBe(
      'Reason: First reason\nComplete second line'
    );
    expect(screen.getByText('Full audit note')).toBeInTheDocument();
    expect(screen.getByText(/Amount:/)).toHaveTextContent(/1,500.00 →.*1,750.00/);
    expect(screen.getByText('Method: Bank Transfer')).toBeInTheDocument();
    expect(entry.textContent).not.toContain('entities/');
    expect(entry.textContent).not.toContain('receipt_s3_key');
  });

  it('supports camel-case lifecycle payloads without duplicate unchanged status badges', () => {
    render(
      <DisbursementAuditTimeline
        item={{
          ...voucher,
          lifecycleHistory: [
            {
              action: 'archive',
              actorName: 'Maria Reyes',
              actorRole: 'Admin',
              fromStatus: 'Released',
              toStatus: 'Released',
              created_at: '',
              createdAt: '2026-10-20T01:30:00Z',
            },
          ],
        }}
      />
    );
    expect(screen.getByText('MR')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getAllByTestId('disbursement-status-badge')).toHaveLength(1);
  });

  it('distinguishes a missing actor profile from a system event and handles missing timestamps', () => {
    render(
      <DisbursementAuditTimeline
        item={{
          ...voucher,
          lifecycle_history: [
            {
              actor_id: 'missing-profile-id',
              action: 'edit',
              created_at: 'invalid',
            },
            { action: 'archive', created_at: '' },
          ],
        }}
      />
    );
    expect(screen.getByText('Unknown actor')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getAllByText('Timestamp unavailable')).toHaveLength(2);
    expect(screen.getByTestId('lifecycle-history-timeline')).not.toHaveTextContent(
      'missing-profile-id'
    );
  });

  it('applies the same display to legacy audit logs and summary-only records', () => {
    const { rerender } = render(
      <DisbursementAuditTimeline
        item={{
          ...voucher,
          audit_logs: [
            {
              id: 'legacy',
              disbursement_id: 'voucher',
              action: 'disbursement.release',
              actor_name: 'Maria Reyes',
              actor_role: 'Admin',
              previous_status: 'Funded',
              new_status: 'Released',
              created_at: '2026-10-20T01:30:00Z',
            },
          ],
        }}
      />
    );
    expect(screen.getByText('MR')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
    expect(screen.getAllByTestId('disbursement-status-badge')).toHaveLength(2);
    rerender(<DisbursementAuditTimeline item={voucher} />);
    expect(screen.getByText('TM')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.queryByTestId('disbursement-status-badge')).not.toBeInTheDocument();
  });
});
