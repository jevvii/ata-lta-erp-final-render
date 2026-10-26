/**
 * Permission map.
 * Ported from the prototype's DEPARTMENT_PERMISSIONS.
 *
 * Effective permissions are the union of all assigned department permissions
 * plus the legacy role permission.
 */

const ALL_ROLES = ['Admin', 'Manager', 'Accounting', 'Operations', 'Documentation', 'HR'];

const STAFF_ROLES = ['Accounting', 'Operations', 'Documentation', 'HR'];

const DEPARTMENTS = ['Management', 'Accounting', 'Operations', 'Documentation', 'HR'];

const DEPARTMENT_PERMISSIONS = {
  Management: [
    'clients:view',
    'workflow:view',
    'workflow:edit',
    'workflow:task_add',
    'workflow:task_approve',
    'billing:view',
    'billing:edit',
    'billing:delete',
    'billing:payments',
    'billing:templates',
    'billing:request',
    'billing:mark_paid',
    'disbursement:view',
    'disbursement:create',
    'disbursement:edit',
    'disbursement:request',
    'disbursement:mark_released',
    'dms:view',
    'dms:edit',
    'dms:delete',
    'dms:handover',
    'transmittal:view',
    'transmittal:create',
    'transmittal:edit',
    'transmittal:mark',
    'transmittal:delete',
    'reports:view',
    'bypass_review:tasks',
    'bypass_review:*',
    'approve_change:tasks',
    'approve_change:*',
    'users:view',
    'audit:view_all',
    // P0-A additions (enterprise migration)
    'workflow:transition_request',
    'retainers:use',
    'billing:edit_client_address',
    'timelog:view',
    'timelog:create',
    'timelog:edit_own',
    'notifications:view',
  ],
  Accounting: [
    'clients:view',
    'workflow:view',
    'workflow:task_add',
    'billing:view',
    'billing:edit',
    'billing:delete',
    'billing:payments',
    'billing:templates',
    'disbursement:view',
    'disbursement:create',
    'disbursement:edit',
    'dms:view',
    'transmittal:view',
    'reports:view',
    'approve_change:invoices',
    'approve_change:disbursements',
    // P0-A additions (enterprise migration)
    'billing:edit_client_address',
    'timelog:view',
    'timelog:create',
    'timelog:edit_own',
    'notifications:view',
  ],
  Operations: [
    'clients:view',
    'workflow:view',
    'workflow:task_add',
    'workflow:task_upload',
    'billing:view',
    'billing:request',
    'disbursement:view',
    'disbursement:request',
    'dms:view',
    'transmittal:view',
    'transmittal:request',
    'reports:view',
    // P0-A additions (enterprise migration)
    'disbursement:create',
    'timelog:view',
    'timelog:create',
    'timelog:edit_own',
    'notifications:view',
  ],
  Documentation: [
    'clients:view',
    'workflow:view',
    'workflow:task_add',
    'billing:view',
    'disbursement:view',
    'dms:view',
    'dms:edit',
    'dms:delete',
    'dms:handover',
    'transmittal:view',
    'transmittal:create',
    'transmittal:edit',
    'transmittal:mark',
    'reports:view',
    // P0-A additions (enterprise migration)
    'disbursement:create',
    'timelog:view',
    'timelog:create',
    'timelog:edit_own',
    'notifications:view',
  ],
  HR: [
    'clients:view',
    'workflow:view',
    'workflow:task_add',
    'workflow:task_upload',
    'billing:view',
    'billing:request',
    'disbursement:view',
    'disbursement:request',
    'dms:view',
    'transmittal:view',
    'transmittal:request',
    'reports:view',
    // P0-A additions (enterprise migration)
    'disbursement:create',
    'timelog:view',
    'timelog:create',
    'timelog:edit_own',
    'notifications:view',
  ],
};

/**
 * Check whether a permission set satisfies a required permission.
 * Supports wildcards such as `approve_change:*` matching `approve_change:tasks`.
 * @param {Set<string>} granted
 * @param {string} required
 * @returns {boolean}
 */
const hasPermission = (granted, required) => {
  if (granted.has(required)) return true;

  const parts = required.split(':');
  if (parts.length !== 2) return false;

  const wildcard = `${parts[0]}:*`;
  if (granted.has(wildcard)) return true;

  // Super wildcard for module-level access is not used; kept explicit.
  return false;
};

/**
 * Build the effective permission set for a user.
 * @param {Object} user
 * @param {string} user.role
 * @param {string[]} user.departments
 * @returns {Set<string>}
 */
const buildPermissionSet = ({ role, departments = [] }) => {
  const granted = new Set();

  // Ignore any disallowed department assignments (e.g. legacy rows in the DB), matching case-insensitively.
  const effectiveDepts = departments
    .map((dept) => DEPARTMENTS.find((d) => d.toLowerCase() === String(dept).toLowerCase()))
    .filter(Boolean);

  // Map legacy role names to their department equivalents, but only if allowed.
  const legacyDept = role === 'Manager' ? 'Management' : role;
  const canonicalLegacyDept = legacyDept
    ? DEPARTMENTS.find((d) => d.toLowerCase() === String(legacyDept).toLowerCase())
    : null;
  if (
    canonicalLegacyDept &&
    DEPARTMENT_PERMISSIONS[canonicalLegacyDept] &&
    !effectiveDepts.includes(canonicalLegacyDept)
  ) {
    effectiveDepts.push(canonicalLegacyDept);
  }

  effectiveDepts.forEach((dept) => {
    (DEPARTMENT_PERMISSIONS[dept] || []).forEach((p) => granted.add(p));
  });

  // Admin has all permissions.
  if (role === 'Admin') {
    Object.values(DEPARTMENT_PERMISSIONS)
      .flat()
      .forEach((p) => granted.add(p));
    granted.add('users:manage');
    granted.add('clients:edit');
    granted.add('transmittal:approve');
    // P0-A additions: Admin-only keys cannot come from the department union
    // (granting them to a department map would leak them to staff).
    granted.add('workflow:phase_transition');
    granted.add('workflow:qa_review');
    granted.add('retainers:edit');
    granted.add('disbursement:approve');
    granted.add('timelog:edit_all');
  }

  // Manager role receives retainers:edit permission (explicit role check, not department name alone)
  if (role === 'Manager') {
    granted.add('retainers:edit');
  }

  return granted;
};

const ROLE_PERMISSIONS = {
  Manager: Array.from(buildPermissionSet({ role: 'Manager' })),
  Admin: Array.from(buildPermissionSet({ role: 'Admin' })),
  Accounting: Array.from(buildPermissionSet({ role: 'Accounting' })),
  Operations: Array.from(buildPermissionSet({ role: 'Operations' })),
  Documentation: Array.from(buildPermissionSet({ role: 'Documentation' })),
  HR: Array.from(buildPermissionSet({ role: 'HR' })),
};

module.exports = {
  ALL_ROLES,
  STAFF_ROLES,
  DEPARTMENTS,
  DEPARTMENT_PERMISSIONS,
  ROLE_PERMISSIONS,
  buildPermissionSet,
  hasPermission,
};
