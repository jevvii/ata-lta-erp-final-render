/**
 * Permissions unit tests.
 */

const { buildPermissionSet } = require('../../../src/lib/permissions');

describe('buildPermissionSet', () => {
  it('grants all permissions to Admin', () => {
    const perms = buildPermissionSet({ role: 'Admin', departments: [] });
    expect(perms.has('clients:view')).toBe(true);
    expect(perms.has('users:manage')).toBe(true);
  });

  it('grants department permissions to a staff user', () => {
    const perms = buildPermissionSet({ role: 'Accounting', departments: ['Accounting'] });
    expect(perms.has('billing:edit')).toBe(true);
    expect(perms.has('users:manage')).toBe(false);
  });

  it('maps Manager role to Management department permissions', () => {
    const perms = buildPermissionSet({ role: 'Manager', departments: [] });
    expect(perms.has('workflow:edit')).toBe(true);
  });
});
