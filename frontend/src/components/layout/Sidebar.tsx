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
  Palette,
} from 'lucide-react';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface NavItem {
  name: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: string | null;
}

const NAV_ITEMS: NavItem[] = [
  {
    name: 'Dashboard',
    path: '/dashboard',
    icon: LayoutDashboard,
    permission: null,
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
  },
  {
    name: 'Admin',
    path: '/admin',
    icon: ShieldCheck,
    permission: 'users:manage',
  },
  {
    name: 'Clients',
    path: '/clients',
    icon: Building2,
    permission: 'clients:view',
  },
];

export function Sidebar() {
  const permissions = useSessionStore((state) => state.permissions);

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (!item.permission) return true;
    return hasPermission(permissions, item.permission);
  });

  return (
    <aside
      className="flex h-screen w-[220px] flex-col border-r border-[#f0f0f5] bg-white transition-all select-none"
      data-testid="app-sidebar"
    >
      {/* Brand Header */}
      <div className="flex h-16 items-center gap-3 border-b border-[#f0f0f5] px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563eb] text-white font-bold text-sm shadow-xs">
          ERP
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-bold leading-tight text-[#1e293b]">ATA &amp; LTA</span>
          <span className="text-[11px] font-medium text-[#9494a0]">Enterprise v2</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" data-testid="sidebar-nav">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[#9494a0]">
          Modules
        </div>
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              data-testid={`nav-item-${item.name.toLowerCase()}`}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-[#2563eb] text-white font-semibold shadow-xs'
                    : 'text-[#1e293b] hover:bg-[#f0f1f3] hover:text-[#1e293b]'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.name}</span>
            </NavLink>
          );
        })}

        {/* Dev Tools Section */}
        <div className="pt-4">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-[#9494a0]">
            Development
          </div>
          <NavLink
            to="/dev/kitchen-sink"
            data-testid="nav-item-kitchen-sink"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
                isActive
                  ? 'bg-[#475569] text-white font-semibold shadow-xs'
                  : 'text-[#475569] hover:bg-[#f0f1f3]'
              )
            }
          >
            <Palette className="h-4 w-4 shrink-0" />
            <span>Kitchen Sink</span>
          </NavLink>
        </div>
      </nav>

      {/* Footer Info */}
      <div className="border-t border-[#f0f0f5] p-3 text-[11px] text-[#9494a0]">
        <div className="flex items-center justify-between px-2">
          <span>React 19 Shell</span>
          <span className="rounded bg-[#f0f1f3] px-1.5 py-0.5 text-[10px] font-mono text-[#1e293b]">
            v2.0.0
          </span>
        </div>
      </div>
    </aside>
  );
}
