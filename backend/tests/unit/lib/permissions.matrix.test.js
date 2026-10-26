/**
 * P0-A permission-key matrix tests (spec: docs/enterprise-migration/P0-A-permission-key-manifest.md).
 * Proves every (department x new key) cell of the frozen catalog, including negatives.
 */

const {
  DEPARTMENTS,
  buildPermissionSet,
} = require('../../../src/lib/permissions');

// Frozen P0-A matrix: key -> departments granted (Admin inherits everything
// in the union; Admin-only keys are asserted separately below).
const NEW_KEY_MATRIX = {
  'workflow:phase_transition': [],
  'workflow:transition_request': ['Management'],
  'workflow:qa_review': [],
  'retainers:use': ['Management'],
  'retainers:edit': [],
  'disbursement:approve': [],
  'billing:edit_client_address': ['Management', 'Accounting'],
  'timelog:view': DEPARTMENTS,
  'timelog:create': DEPARTMENTS,
  'timelog:edit_own': DEPARTMENTS,
  'timelog:edit_all': [],
  'notifications:view': DEPARTMENTS,
};

const ADMIN_ONLY_KEYS = [
  'workflow:phase_transition',
  'workflow:qa_review',
  'disbursement:approve',
  'timelog:edit_all',
];

describe('P0-A department x key matrix', () => {
  Object.entries(NEW_KEY_MATRIX).forEach(([key, grantedDepts]) => {
    DEPARTMENTS.forEach((dept) => {
      const expected = grantedDepts.includes(dept);
      it(`${dept} ${expected ? 'HAS' : 'lacks'} ${key}`, () => {
        // retainers:edit is granted by role Manager, not by department alone
        if (key === 'retainers:edit') {
          const perms = buildPermissionSet({ role: 'Operations', departments: [dept] });
          expect(perms.has(key)).toBe(false);
          return;
        }
        const role = dept === 'Management' ? 'Manager' : dept;
        const perms = buildPermissionSet({ role, departments: [dept] });
        expect(perms.has(key)).toBe(expected);
      });
    });
  });

  it('grants retainers:edit to role Manager but never to department alone', () => {
    const manager = buildPermissionSet({ role: 'Manager', departments: [] });
    expect(manager.has('retainers:edit')).toBe(true);

    DEPARTMENTS.forEach((dept) => {
      const deptStaff = buildPermissionSet({ role: 'Operations', departments: [dept] });
      expect(deptStaff.has('retainers:edit')).toBe(false);
    });
  });

  it('grants disbursement:create to ALL five departments (R3)', () => {
    DEPARTMENTS.forEach((dept) => {
      const role = dept === 'Management' ? 'Manager' : dept;
      expect(buildPermissionSet({ role, departments: [dept] }).has('disbursement:create')).toBe(
        true
      );
    });
  });
});

describe('P0-A Admin resolution', () => {
  const admin = buildPermissionSet({ role: 'Admin', departments: [] });

  it('Admin holds every key in the matrix', () => {
    Object.keys(NEW_KEY_MATRIX).forEach((key) => {
      expect(admin.has(key)).toBe(true);
    });
  });

  it('Admin-only keys are NOT granted to any staff role', () => {
    DEPARTMENTS.forEach((dept) => {
      const role = dept === 'Management' ? 'Manager' : dept;
      const perms = buildPermissionSet({ role, departments: [dept] });
      ADMIN_ONLY_KEYS.forEach((key) => {
        expect(perms.has(key)).toBe(false);
      });
    });
  });
});
