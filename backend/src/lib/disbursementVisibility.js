/** Shared accounting visibility rules for lists, details and related-record aggregations. */
const isAccountingOnlyUser = (user) => {
  if (!user || user.role === 'Admin') return false;
  return (
    String(user.role || '').toLowerCase() === 'accounting' ||
    (user.departments || []).some((d) => String(d).toLowerCase() === 'accounting')
  );
};

const canAccountingViewDisbursement = (record, userId) => {
  if (!record) return false;
  if (['Approved', 'Funded', 'Released'].includes(record.status)) return true;
  if (!userId) return false;
  return (
    record.created_by === userId ||
    record.requested_by === userId ||
    record.employee_id === userId
  );
};

module.exports = { isAccountingOnlyUser, canAccountingViewDisbursement };
