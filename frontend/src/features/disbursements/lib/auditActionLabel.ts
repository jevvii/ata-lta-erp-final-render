const actionLabels: Record<string, string> = {
  create: 'Created',
  edit: 'Edited',
  update: 'Updated',
  submit: 'Submitted',
  forward: 'Forwarded',
  forward_admin: 'Forwarded for Approval',
  approve: 'Approved',
  fund: 'Funded',
  release: 'Released',
  reject: 'Rejected',
  resend_draft: 'Resent for Review',
  archive: 'Archived',
  unarchive: 'Restored',
  restore: 'Restored',
  delete: 'Deleted',
  payment_details_update: 'Payment Details Updated',
  update_payment_details: 'Payment Details Updated',
};

export function auditActionLabel(action?: string | null, status?: string | null): string {
  const key = action?.replace(/^disbursements?\./i, '').toLowerCase();
  return (
    (key && actionLabels[key]) ||
    (action
      ? action
          .replace(/^disbursements?\./i, '')
          .replace(/[_.-]+/g, ' ')
          .replace(/\b\w/g, (letter) => letter.toUpperCase())
      : status || 'Updated')
  );
}
