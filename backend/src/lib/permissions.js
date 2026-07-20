/**
 * Permission map.
 * Ported from the prototype's DEPARTMENT_PERMISSIONS.
 *
 * Effective permissions are the union of all assigned department permissions
 * plus the legacy role permission.
 */

const ALL_ROLES = ['Admin', 'Manager', 'Accounting', 'Operations', 'Documentation'];

const STAFF_ROLES = ['Accounting', 'Operations', 'Documentation'];

const DEPARTMENTS = ['Management', 'Accounting', 'Operations', 'Documentation'];

const DEPARTMENT_PERMISSIONS = {
  Management: [
    'clients:view',
    'clients:edit',
    'workflow:view',
    'workflow:edit',
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
    'users:manage',
    'audit:view_all',
  ],
  Accounting: [
    'clients:view',
    'clients:edit',
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
  const allowedDepts = new Set(DEPARTMENTS);

  // Ignore any disallowed department assignments (e.g. legacy rows in the DB).
  const effectiveDepts = departments.filter((dept) => allowedDepts.has(dept));

  // Map legacy role names to their department equivalents, but only if allowed.
  const legacyDept = role === 'Manager' ? 'Management' : role;
  if (
    legacyDept &&
    allowedDepts.has(legacyDept) &&
    DEPARTMENT_PERMISSIONS[legacyDept] &&
    !effectiveDepts.includes(legacyDept)
  ) {
    effectiveDepts.push(legacyDept);
  }

  effectiveDepts.forEach((dept) => {
    (DEPARTMENT_PERMISSIONS[dept] || []).forEach((p) => granted.add(p));
  });

  // Admin has all permissions.
  if (role === 'Admin') {
    Object.values(DEPARTMENT_PERMISSIONS)
      .flat()
      .forEach((p) => granted.add(p));
  }

  return granted;
};

module.exports = {
  ALL_ROLES,
  STAFF_ROLES,
  DEPARTMENTS,
  DEPARTMENT_PERMISSIONS,
  buildPermissionSet,
  hasPermission,
};
