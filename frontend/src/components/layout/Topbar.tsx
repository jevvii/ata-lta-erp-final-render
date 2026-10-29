import { useState } from 'react';
import { LogOut, Building2, User, Menu, X } from 'lucide-react';
import { useSessionStore } from '@/lib/session';
import { signOut } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { NotificationBellPanel } from '@/features/dashboard/components/NotificationBellPanel';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { useProfile } from '@/features/profile/api/useProfile';
import { SidebarNavLinks } from './Sidebar';
import { UserAvatar } from '@/components/common/UserAvatar';

export function Topbar() {
  const { user, activeEntity, setActiveEntity } = useSessionStore();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const handleSignOut = () => {
    signOut();
    navigate('/login', { replace: true });
  };

  const entities = user?.entities && user.entities.length > 0 ? user.entities : ['ATA', 'LTA'];
  const entityOptions = Array.from(new Set([...entities, 'ALL']));

  const avatarUrl = user?.avatarUrl || profile?.avatarUrl || null;
  const displayName = profile?.name || user?.name || 'User';

  const primaryEntity = user?.entities && user.entities.length > 0 ? user.entities[0]! : 'ATA';

  return (
    <header
      className="flex h-14 w-full items-center justify-between border-b border-[#E2E8F0] bg-[#FFFFFF] px-4 sm:px-6 shadow-2xs select-none shrink-0"
      data-testid="app-topbar"
    >
      {/* Left: Mobile Menu Trigger + Entity Switcher */}
      <div className="flex items-center gap-3">
        {/* Mobile / Tablet Drawer Trigger */}
        <button
          type="button"
          onClick={() => setMobileDrawerOpen(true)}
          aria-label="Open navigation menu"
          data-testid="mobile-menu-trigger"
          className="lg:hidden flex min-h-[36px] min-w-[36px] items-center justify-center rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
        >
          <Menu className="h-4 w-4" />
        </button>

        {/* Entity Switcher */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-[#475569]">
            <Building2 className="h-3.5 w-3.5 text-[#475569]" />
            <span>Scope:</span>
          </div>
          <div className="w-[110px] sm:w-[130px]">
            <Select
              value={activeEntity || primaryEntity}
              onValueChange={(val) => setActiveEntity(val)}
            >
              <SelectTrigger density="compact" data-testid="entity-switcher">
                <SelectValue placeholder="Entity" />
              </SelectTrigger>
              <SelectContent>
                {entityOptions.map((ent) => (
                  <SelectItem key={ent} value={ent} density="compact">
                    <span className="font-semibold">{ent}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Right Actions: Notifications & User Menu */}
      <div className="flex items-center gap-3">
        {/* Notification Bell Panel */}
        <NotificationBellPanel />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2.5 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] p-1 pr-2.5 hover:bg-[#F8FAFC] transition-colors cursor-pointer outline-none shadow-2xs"
              data-testid="user-menu-button"
            >
              <UserAvatar
                userId={user?.id}
                name={displayName}
                email={user?.email}
                avatarUrl={avatarUrl}
                size="md"
                shape="circle"
                imgTestId="topbar-avatar-img"
                initialsTestId="topbar-avatar-initials"
                data-testid="topbar-user-avatar"
                className="h-7 w-7 text-[11px]"
                imgClassName="hidden"
              />
              <div className="hidden sm:flex flex-col text-left">
                <span className="text-xs font-semibold text-[#1E293B] leading-tight">
                  {user?.name || 'User'}
                </span>
                <span className="text-xs text-[#475569] leading-tight">
                  {user?.role === 'Admin' || user?.email === 'lorein@ata-lta.ph' ? 'Admin' : (user?.role || 'Staff')}
                </span>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-xs font-semibold leading-none text-[#1E293B]">{user?.name}</p>
                <p className="text-xs leading-none text-[#475569]">{user?.email}</p>
              </div>
            </DropdownMenuLabel>
            <div className="px-2 py-1">
              <Badge variant="secondary" className="text-xs">
                {user?.role === 'Admin' || user?.email === 'lorein@ata-lta.ph' ? 'Role: Admin' : `Role: ${user?.role}`}
              </Badge>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => navigate('/profile')}
              className="cursor-pointer text-[#1E293B] hover:bg-[#F8FAFC]"
              data-testid="my-profile-menu-item"
            >
              <User className="mr-2 h-4 w-4 text-[#475569]" />
              <span className="text-xs font-medium">My Profile</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="cursor-pointer text-[#991B1B] focus:text-[#991B1B] focus:bg-[#FEF2F2]"
              data-testid="sign-out-button"
            >
              <LogOut className="mr-2 h-4 w-4 text-[#991B1B]" />
              <span className="text-xs font-medium">Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Quick Sign Out Action */}
        <button
          type="button"
          onClick={handleSignOut}
          title="Sign out"
          aria-label="Sign out"
          data-testid="header-signout-btn"
          className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] text-[#475569] hover:text-[#991B1B] hover:bg-[#FEF2F2] hover:border-[#FCA5A5] transition-colors cursor-pointer shadow-2xs"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>

      {/* Mobile/Tablet Radix Dialog Navigation Drawer */}
      <Dialog open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
        <DialogContent className="fixed inset-y-0 left-0 top-0 z-50 h-full w-[260px] max-w-[85vw] translate-x-0 translate-y-0 p-0 border-r border-[#E2E8F0] bg-[#F8FAFC] shadow-float overscroll-contain rounded-l-none rounded-r-[12px] duration-200">
          <div className="flex h-14 items-center justify-between border-b border-[#E2E8F0] px-4 bg-[#FFFFFF] rounded-tr-[12px]">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold tracking-tight text-[#1E293B]">
              <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#1E3A8A] text-[#FFFFFF] font-bold text-xs shadow-2xs">
                ERP
              </div>
              <span>Navigation</span>
            </DialogTitle>
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(false)}
              aria-label="Close navigation"
              className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] text-[#475569] hover:text-[#1E293B] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNavLinks onNavigate={() => setMobileDrawerOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
