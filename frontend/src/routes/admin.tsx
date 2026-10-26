import { Forbidden } from '@/components/common/Forbidden';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import { AdminTabs } from '@/features/admin/components/AdminTabs';
import { usePermission } from '@/lib/permissions';

export default function AdminPage() {
  const canManageUsers = usePermission('users:manage');

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
