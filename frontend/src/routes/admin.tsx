import { Forbidden } from '@/components/common/Forbidden';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import { AdminTabs } from '@/features/admin/components/AdminTabs';
import { usePermission } from '@/lib/permissions';

/**
 * Admin Route (`/admin`)
 *
 * Security Invariant:
 * Strictly restricted to users holding `users:manage` (Administrator super-user).
 * Managers holding `users:view` or `retainers:use` are blocked with a 403 Forbidden screen.
 *
 * Houses:
 * 1. User Management (Users List, Create, Edit, Disable, Profile & Access Summary)
 * 2. Audit Log (Immutable System Audit Ledger & Visual Diff Inspector)
 */
export default function AdminPage() {
  const canManageUsers = usePermission('users:manage');

  // Defense-in-depth RBAC guard inside the component in addition to RouteGuard
  if (!canManageUsers) {
    return <Forbidden requiredPermission="users:manage" />;
  }

  return (
    <div className="w-full space-y-6" data-testid="admin-page">
      <AdminTabs />
      <BlockingActionModal />
    </div>
  );
}
