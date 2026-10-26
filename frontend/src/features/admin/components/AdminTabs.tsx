import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Users,
  ShieldCheck,
  FileSpreadsheet,
  History,
  Lock,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { UserListTable } from './UserListTable';
import { UserCreateModal } from './UserCreateModal';
import { UserEditModal } from './UserEditModal';
import { UserDisableModal } from './UserDisableModal';
import { UserDetailModal } from './UserDetailModal';
import { PermissionsMatrixView } from './PermissionsMatrixView';
import { RetainerTemplateList } from './RetainerTemplateList';
import { RetainerTemplateModal } from './RetainerTemplateModal';
import { RetainerGenerationLogs } from './RetainerGenerationLogs';
import { useUsersList } from '../api/useUsers';
import { useRetainerTemplatesList } from '../api/useRetainerTemplates';
import { useAuditCount } from '../api/useRetainerGenerations';
import { usePermission } from '@/lib/permissions';
import { PERMISSION_KEYS } from '../utils/permissionsMatrix';
import type { AdminUser, RetainerTemplate } from '../api/types';

export function AdminTabs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get('tab') || 'users';

  const canManageUsers = usePermission('users:manage');
  const canEditRetainers = usePermission('retainers:edit');

  // Query counts for badges
  const { data: users = [] } = useUsersList();
  const { data: templates = [] } = useRetainerTemplatesList();
  const { data: auditCountData } = useAuditCount();

  const activeUsersCount = users.filter((u) => u.isActive).length;

  // Modal States
  const [isCreateUserOpen, setIsCreateUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [disablingUser, setDisablingUser] = useState<AdminUser | null>(null);
  const [inspectingUser, setInspectingUser] = useState<AdminUser | null>(null);

  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RetainerTemplate | null>(null);

  const handleTabChange = (tab: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    });
  };

  return (
    <div className="space-y-6" data-testid="admin-tabs-container">
      {/* 1. Unified Module Header */}
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
          >
            <span>Modules</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#1E293B] font-semibold">Admin</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-[#1D4ED8]" />
            Enterprise Administration
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
            User provisioning, RBAC matrix governance, and recurring retainer template blueprints.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <Badge variant="outline" className="text-xs font-medium rounded-[6px] bg-[#F8FAFC] text-[#475569] border border-[#E2E8F0] px-2.5 py-1">
            <Lock className="h-3 w-3 mr-1 text-[#475569]" />
            Admin Gated (<code className="font-mono text-xs">users:manage</code>)
          </Badge>
        </div>
      </div>

      {/* 2. Tabs Layout */}
      <Tabs value={currentTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="w-full justify-start rounded-[8px] bg-[#F8FAFC] p-1 border border-[#E2E8F0] gap-1 h-auto overflow-x-auto scrollbar-none flex flex-nowrap">
          {/* Tab: Users */}
          <TabsTrigger
            value="users"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-trigger-users"
          >
            <Users className="h-3.5 w-3.5" />
            <span>Team Members</span>
            <Badge variant="outline" className="text-xs tabular-nums py-0 px-1.5 ml-1.5 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]">
              {activeUsersCount}
            </Badge>
          </TabsTrigger>

          {/* Tab: Permissions Matrix */}
          <TabsTrigger
            value="permissions"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-trigger-permissions"
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Permissions Matrix</span>
            <Badge variant="outline" className="text-xs py-0 px-1.5 ml-1.5 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]">
              {PERMISSION_KEYS.length}
            </Badge>
          </TabsTrigger>

          {/* Tab: Retainer Templates */}
          <TabsTrigger
            value="retainers"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-trigger-retainers"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Retainer Templates</span>
            <Badge variant="outline" className="text-xs py-0 px-1.5 ml-1.5 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]">
              {templates.length}
            </Badge>
          </TabsTrigger>

          {/* Tab: Generation Logs */}
          <TabsTrigger
            value="generations"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-trigger-generations"
          >
            <History className="h-3.5 w-3.5" />
            <span>Generation Logs</span>
            {auditCountData?.total !== undefined && (
              <Badge variant="outline" className="text-xs tabular-nums py-0 px-1.5 ml-1.5 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]">
                {auditCountData.total}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Users */}
        <TabsContent value="users" className="space-y-4 pt-1" data-testid="tab-content-users">
          <UserListTable
            onAddUser={() => setIsCreateUserOpen(true)}
            onEditUser={(u) => setEditingUser(u)}
            onDisableUser={(u) => setDisablingUser(u)}
            onViewDetails={(u) => setInspectingUser(u)}
          />
        </TabsContent>

        {/* Tab 2: Permissions Matrix */}
        <TabsContent value="permissions" className="space-y-4 pt-1" data-testid="tab-content-permissions">
          <PermissionsMatrixView />
        </TabsContent>

        {/* Tab 3: Retainer Templates */}
        <TabsContent value="retainers" className="space-y-4 pt-1" data-testid="tab-content-retainers">
          <RetainerTemplateList
            onNewTemplate={() => {
              setEditingTemplate(null);
              setIsTemplateModalOpen(true);
            }}
            onEditTemplate={(tpl) => {
              setEditingTemplate(tpl);
              setIsTemplateModalOpen(true);
            }}
          />
        </TabsContent>

        {/* Tab 4: Generation Logs */}
        <TabsContent value="generations" className="space-y-4 pt-1" data-testid="tab-content-generations">
          <RetainerGenerationLogs />
        </TabsContent>
      </Tabs>

      {/* User Modals */}
      {canManageUsers && (
        <>
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
        </>
      )}

      {/* User Details Inspector Modal */}
      <UserDetailModal
        user={inspectingUser}
        isOpen={Boolean(inspectingUser)}
        onClose={() => setInspectingUser(null)}
      />

      {/* Retainer Template Builder Modal */}
      {canEditRetainers && (
        <RetainerTemplateModal
          template={editingTemplate}
          isOpen={isTemplateModalOpen}
          onClose={() => {
            setIsTemplateModalOpen(false);
            setEditingTemplate(null);
          }}
        />
      )}
    </div>
  );
}
