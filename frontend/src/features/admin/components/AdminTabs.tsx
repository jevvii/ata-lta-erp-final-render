import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, History, Shield, Plus } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSessionStore } from '@/lib/session';
import { usePermission } from '@/lib/permissions';
import { useUsersList } from '../api/useUsers';
import { useAuditCount } from '../api/useAuditLogs';
import { useEntityRealtimeSync } from '@/lib/realtime';
import { UserListTable } from './UserListTable';
import { UserCreateModal } from './UserCreateModal';
import { UserEditModal } from './UserEditModal';
import { UserDisableModal } from './UserDisableModal';
import { UserDetailModal } from './UserDetailModal';
import { AuditLogView } from './AuditLogView';
import type { AdminUser } from '../api/types';

export interface AdminTabsProps {
  defaultTab?: 'users' | 'audit';
}

export function AdminTabs({ defaultTab }: AdminTabsProps = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const urlUserId = searchParams.get('userId');
  const currentTab =
    urlTab === 'audit' || urlTab === 'users'
      ? urlTab
      : defaultTab || 'users';

  // Session & Entity Scope
  const user = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const setActiveEntity = useSessionStore((state) => state.setActiveEntity);
  const canManageUsers = usePermission('users:manage');
  const userEntities = user?.entities ?? ['ATA', 'LTA'];

  // Realtime CDC Subscriptions for Admin Domain
  useEntityRealtimeSync({
    table: 'users',
    listRootKey: ['admin', 'users'],
  });
  useEntityRealtimeSync({
    table: 'user_departments',
    listRootKey: ['admin', 'users'],
  });
  useEntityRealtimeSync({
    table: 'audit_logs',
    listRootKey: ['admin', 'audit'],
  });

  // Tab Counts
  const { data: users = [] } = useUsersList();
  const { data: auditCountData } = useAuditCount();

  const activeUsersCount = users.filter((u) => u.isActive).length;
  const auditCount = auditCountData?.total ?? 0;

  // User Modal States
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [disablingUser, setDisablingUser] = useState<AdminUser | null>(null);
  const [inspectingUser, setInspectingUser] = useState<AdminUser | null>(null);

  // Support deep-link ?userId=... from Audit Log
  useEffect(() => {
    if (urlUserId && users.length > 0) {
      const matched = users.find((u) => u.id === urlUserId);
      if (matched) {
        setInspectingUser(matched);
      }
    }
  }, [urlUserId, users]);

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  return (
    <div className="w-full space-y-6" data-testid="admin-tabs-container">
      {/* Unified Module Header */}
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
          >
            <span>Modules</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#1E293B] font-semibold">Administration</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <Shield className="h-6 w-6 text-[#1D4ED8]" />
            <span>Enterprise Administration</span>
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
            Manage user accounts, role assignments, entity scopes, and inspect the immutable system audit ledger.
          </p>
        </div>

        {/* Header Right Controls: Soft Segmented Entity Switcher + Primary Action Button */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div
            className="flex items-center bg-[#F8FAFC] p-1 rounded-[8px] border border-[#E2E8F0]"
            role="group"
            aria-label="Entity scope filter"
          >
            {(['ATA', 'LTA', 'ALL'] as const).map((ent) => {
              const isSelected = activeEntity === ent;
              const isAllowed =
                ent === 'ALL' ? userEntities.length > 0 : userEntities.includes(ent);

              return (
                <button
                  key={ent}
                  type="button"
                  disabled={!isAllowed}
                  onClick={() => setActiveEntity(ent)}
                  data-testid={`admin-entity-pill-${ent}`}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors rounded-[6px] cursor-pointer ${
                    isSelected
                      ? 'bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs font-semibold'
                      : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60'
                  } ${!isAllowed ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  {ent === 'ALL' ? 'All Entities' : ent}
                </button>
              );
            })}
          </div>

          {canManageUsers && (
            <Button
              type="button"
              size="sm"
              onClick={() => setIsCreateUserOpen(true)}
              className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] text-xs font-medium rounded-[6px] h-9 gap-1.5 shadow-2xs cursor-pointer"
              data-testid="header-add-user-btn"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New User</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main 2-Tab Navigation: Users & Audit Log */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="w-full space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2">
          <TabsList
            className="w-full sm:w-auto justify-start rounded-[8px] bg-[#F8FAFC] p-1 border border-[#E2E8F0] gap-1 h-auto overflow-x-auto scrollbar-none flex flex-nowrap"
            data-testid="admin-tabs-list"
          >
            {/* Tab 1: User Management */}
            <TabsTrigger
              value="users"
              className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
              data-testid="tab-trigger-users"
            >
              <Users className="h-4 w-4" />
              <span>User Management</span>
              <Badge
                variant="secondary"
                className="text-xs tabular-nums px-1.5 py-0 h-4 ml-1 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]"
                data-testid="tab-users-count"
              >
                {users.length}
              </Badge>
            </TabsTrigger>

            {/* Tab 2: Audit Log */}
            <TabsTrigger
              value="audit"
              className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
              data-testid="tab-trigger-audit"
            >
              <History className="h-4 w-4" />
              <span>Audit Log</span>
              <Badge
                variant="secondary"
                className="text-xs tabular-nums px-1.5 py-0 h-4 ml-1 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]"
                data-testid="tab-audit-count"
              >
                {auditCount}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Content 1: Users */}
        <TabsContent value="users" className="mt-0 outline-none" data-testid="tab-content-users">
          <UserListTable
            onAddUser={() => setIsCreateUserOpen(true)}
            onEditUser={(u) => setEditingUser(u)}
            onDisableUser={(u) => setDisablingUser(u)}
            onViewDetails={(u) => setInspectingUser(u)}
          />
        </TabsContent>

        {/* Tab Content 2: Audit Log */}
        <TabsContent value="audit" className="mt-0 outline-none" data-testid="tab-content-audit">
          <AuditLogView />
        </TabsContent>
      </Tabs>

      {/* Modals for User Management */}
      <UserCreateModal
        isOpen={isCreateUserOpen}
        onClose={() => setIsCreateUserOpen(false)}
        activeUsersCount={activeUsersCount}
      />

      <UserEditModal
        user={editingUser}
        isOpen={Boolean(editingUser)}
        onClose={() => setEditingUser(null)}
      />

      <UserDisableModal
        user={disablingUser}
        isOpen={Boolean(disablingUser)}
        onClose={() => setDisablingUser(null)}
      />

      <UserDetailModal
        user={inspectingUser}
        isOpen={Boolean(inspectingUser)}
        onClose={() => {
          setInspectingUser(null);
          if (urlUserId) {
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('userId');
              return next;
            }, { replace: true });
          }
        }}
      />
    </div>
  );
}
