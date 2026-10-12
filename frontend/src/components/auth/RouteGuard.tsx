import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSessionStore } from '@/lib/session';
import { hasPermission, type PermissionKey } from '@/lib/permissions';
import { Forbidden } from '@/components/common/Forbidden';
import { Skeleton } from '@/components/ui/skeleton';

interface RouteGuardProps {
  children: ReactNode;
  requiredPermission?: PermissionKey | string;
  adminOnly?: boolean;
}

export function RouteGuard({ children, requiredPermission, adminOnly }: RouteGuardProps) {
  const { isAuthenticated, isLoading, permissions, user } = useSessionStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center p-8 bg-[#f4f6fb]">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="mx-auto h-12 w-12 rounded-xl bg-[#2563eb]/10 flex items-center justify-center text-[#2563eb]">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#2563eb] border-t-transparent" />
          </div>
          <Skeleton className="h-4 w-3/4 mx-auto" />
          <Skeleton className="h-3 w-1/2 mx-auto" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const isAdmin = user?.role === 'Admin' || hasPermission(permissions, 'users:manage');

  if (adminOnly && !isAdmin) {
    return <Forbidden requiredPermission="users:manage" />;
  }

  if (requiredPermission && !hasPermission(permissions, requiredPermission)) {
    return <Forbidden requiredPermission={requiredPermission} />;
  }

  return <>{children}</>;
}
