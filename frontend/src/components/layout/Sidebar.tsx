import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Briefcase,
  Receipt,
  Wallet,
  Send,
  FolderOpen,
  BarChart3,
  ShieldCheck,
  Building2,
} from 'lucide-react';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

export interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: string | null;
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    name: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    permission: null,
  },
  {
    name: 'Clients',
    path: '/clients',
    icon: Building2,
    permission: 'clients:view',
  },
  {
    name: 'Operations',
    path: '/operations',
    icon: Briefcase,
    permission: 'workflow:view',
  },
  {
    name: 'Billing',
    path: '/billing',
    icon: Receipt,
    permission: 'billing:view',
  },
  {
    name: 'Disbursements',
    path: '/disbursements',
    icon: Wallet,
    permission: 'disbursement:view',
  },
  {
    name: 'Transmittals',
    path: '/transmittals',
    icon: Send,
    permission: 'transmittal:view',
  },
  {
    name: 'Documents',
    path: '/documents',
    icon: FolderOpen,
    permission: 'dms:view',
  },
  {
    name: 'Reports',
    path: '/reports',
    icon: BarChart3,
    permission: 'reports:view',
    adminOnly: true,
  },
  {
    name: 'Admin',
    path: '/admin',
    icon: ShieldCheck,
    permission: 'users:manage',
    adminOnly: true,
  },
];

export function SidebarNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const permissions = useSessionStore((state) => state.permissions);
  const user = useSessionStore((state) => state.user);
  const isAdmin = user?.role === 'Admin' || hasPermission(permissions, 'users:manage');

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (!item.permission) return true;
    return hasPermission(permissions, item.permission);
  });

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3" data-testid="sidebar-nav">
      {visibleNavItems.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            data-testid={`nav-item-${item.name.toLowerCase()}`}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-[6px] px-3 py-2 text-sm font-medium transition-colors duration-150',
                isActive
                  ? 'bg-[#DBEAFE]/80 text-[#1E40AF] font-semibold border-l-3 border-l-[#1D4ED8]'
                  : 'text-[#334155] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B]'
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.name}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside
      className="hidden lg:flex h-dvh w-[232px] flex-col border-r border-[#E2E8F0] bg-[#F8FAFC] transition-all select-none shrink-0"
      data-testid="app-sidebar"
    >
      {/* Brand Header */}
      <div className="flex h-14 items-center gap-3 border-b border-[#E2E8F0] px-4 bg-[#FFFFFF]">
        <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[#1E3A8A] text-[#FFFFFF] font-bold text-xs shadow-2xs">
          ERP
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold tracking-tight text-[#1E293B] leading-tight">ATA &amp; LTA</span>
          <span className="text-xs text-[#475569] leading-none">Accounting Firm</span>
        </div>
      </div>

      {/* Navigation Links */}
      <SidebarNavLinks />

      {/* Footer Telemetry */}
      <div className="border-t border-[#E2E8F0] p-3 text-xs text-[#475569] bg-[#F8FAFC]">
        <div className="flex items-center justify-between px-1">
          <span className="font-medium text-[#475569]">System Active</span>
          <span className="rounded-[4px] border border-[#E2E8F0] bg-[#FFFFFF] px-1.5 py-0.5 text-xs font-medium text-[#334155] shadow-2xs">
            v2.0
          </span>
        </div>
      </div>
    </aside>
  );
}
