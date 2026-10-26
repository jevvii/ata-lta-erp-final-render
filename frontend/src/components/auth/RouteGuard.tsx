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
      <div className="flex h-screen w-full items-center justify-center p-8 bg-[#F8FAFC]">
        <div className="w-full max-w-md space-y-4 text-center">
          <div className="mx-auto h-12 w-12 rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-2xs flex items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-[#1D4ED8]" />
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
