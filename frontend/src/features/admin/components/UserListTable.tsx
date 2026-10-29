import { useState, useMemo } from 'react';
import {
  Search,
  UserPlus,
  Edit2,
  UserX,
  Eye,
  RotateCcw,
  ShieldAlert,
  AlertTriangle,
  Users,
  UserCheck,
  Shield,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ConflictResolutionModal,
  isConcurrencyConflictError,
} from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useUsersList, useUserMutations } from '../api/useUsers';
import { useSessionStore } from '@/lib/session';
import { usePermission } from '@/lib/permissions';
import { UserCreateModal } from './UserCreateModal';
import { UserEditModal } from './UserEditModal';
import { UserDisableModal } from './UserDisableModal';
import { UserDetailModal } from './UserDetailModal';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { AdminUser, DepartmentName, EntityCode } from '../api/types';

export interface UserListTableProps {
  onAddUser?: () => void;
  onEditUser?: (user: AdminUser) => void;
  onDisableUser?: (user: AdminUser) => void;
  onViewDetails?: (user: AdminUser) => void;
}

const DEPARTMENT_BADGE_COLORS: Record<string, string> = {
  Management: 'bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]',
  Accounting: 'bg-[#ECFDF5] text-[#047857] border-[#A7F3D0]',
  Operations: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]',
  Documentation: 'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0]',
  HR: 'bg-[#FFF1F2] text-[#BE123C] border-[#FECDD3]',
};

export function UserListTable({
  onAddUser,
  onEditUser,
  onDisableUser,
  onViewDetails,
}: UserListTableProps = {}) {
  const currentUser = useSessionStore((state) => state.user);
  const canManageUsers = usePermission('users:manage');
  const { updateUser } = useUserMutations();

  // Filter States
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Standalone fallback modal states when parent callbacks are omitted
  const [internalCreateOpen, setInternalCreateOpen] = useState(false);
  const [internalEditUser, setInternalEditUser] = useState<AdminUser | null>(null);
  const [internalDisableUser, setInternalDisableUser] = useState<AdminUser | null>(null);
  const [internalDetailUser, setInternalDetailUser] = useState<AdminUser | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  const { data: users = [], isLoading, error, refetch } = useUsersList();

  // Active & Disabled users count
  const activeCount = useMemo(() => users.filter((u) => u.isActive).length, [users]);
  const disabledCount = useMemo(() => users.filter((u) => !u.isActive).length, [users]);
  const remainingCap = Math.max(0, 15 - activeCount);
  const isAtOrAboveCap = activeCount >= 15;

  const hasActiveFilters =
    search.trim().length > 0 ||
    departmentFilter !== 'ALL' ||
    roleFilter !== 'ALL' ||
    entityFilter !== 'ALL' ||
    statusFilter !== 'ALL';

  const handleResetFilters = () => {
    setSearch('');
    setDepartmentFilter('ALL');
    setRoleFilter('ALL');
    setEntityFilter('ALL');
    setStatusFilter('ALL');
  };

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (search.trim()) {
        const query = search.toLowerCase();
        const matchesName = u.name.toLowerCase().includes(query);
        const matchesEmail = u.email.toLowerCase().includes(query);
        const userNo = (u.userNumber || u.user_number || '').toLowerCase();
        const matchesId = userNo.includes(query);
        if (!matchesName && !matchesEmail && !matchesId) return false;
      }

      if (departmentFilter !== 'ALL') {
        if (!u.departments.includes(departmentFilter as DepartmentName)) {
          return false;
        }
      }

      if (roleFilter !== 'ALL') {
        if (u.role !== roleFilter) return false;
      }

      if (entityFilter !== 'ALL') {
        if (!u.entities.includes(entityFilter as EntityCode)) return false;
      }

      if (statusFilter === 'active' && !u.isActive) return false;
      if (statusFilter === 'disabled' && u.isActive) return false;

      return true;
    });
  }, [users, search, departmentFilter, roleFilter, entityFilter, statusFilter]);

  const handleAddClick = () => {
    if (onAddUser) {
      onAddUser();
    } else {
      setInternalCreateOpen(true);
    }
  };

  const handleEditClick = (user: AdminUser) => {
    if (onEditUser) {
      onEditUser(user);
    } else {
      setInternalEditUser(user);
    }
  };

  const handleDisableClick = (user: AdminUser) => {
    if (onDisableUser) {
      onDisableUser(user);
    } else {
      setInternalDisableUser(user);
    }
  };

  const handleViewDetailsClick = (user: AdminUser) => {
    if (onViewDetails) {
      onViewDetails(user);
    } else {
      setInternalDetailUser(user);
    }
  };

  const handleReEnableUser = async (user: AdminUser) => {
    try {
      await updateUser(user.id, {
        status: 'Active',
        isActive: true,
        expectedVersion: user.version ?? 1,
      });
    } catch (err) {
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().reset();
        setConflictOpen(true);
      }
    }
  };

  return (
    <div className="space-y-4" data-testid="user-list-table-container">
      {/* Divided KPI Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-y md:divide-y-0 divide-[#CBD5E1] bg-[#FFFFFF] p-0 rounded-[8px] border border-[#E2E8F0] shadow-none">
        <div className="bg-[#FFFFFF] p-4 rounded-none border-none shadow-none">
          <div className="flex items-center justify-between text-xs font-medium text-[#475569]">
            <span>Total Accounts</span>
            <Users className="h-4 w-4 text-[#475569]" />
          </div>
          <p className="mt-1 text-lg font-bold font-mono tabular-nums text-[#1E293B]">
            {users.length}
          </p>
          <p className="text-[11px] text-[#475569] mt-0.5">
            Registered accounts across entities
          </p>
        </div>

        <div className="bg-[#FFFFFF] p-4 rounded-none border-none shadow-none">
          <div className="flex items-center justify-between text-xs font-medium text-[#059669]">
            <span>Active Users</span>
            <UserCheck className="h-4 w-4 text-[#059669]" />
          </div>
          <p className="mt-1 text-lg font-bold font-mono tabular-nums text-[#047857]">
            {activeCount}
          </p>
          <p className="text-[11px] text-[#475569] mt-0.5">
            Currently active &amp; authenticated
          </p>
        </div>

        <div className="bg-[#FFFFFF] p-4 rounded-none border-none shadow-none">
          <div className="flex items-center justify-between text-xs font-medium text-[#475569]">
            <span>Disabled Users</span>
            <UserX className="h-4 w-4 text-[#475569]" />
          </div>
          <p className="mt-1 text-lg font-bold font-mono tabular-nums text-[#1E293B]">
            {disabledCount}
          </p>
          <p className="text-[11px] text-[#475569] mt-0.5">
            Soft-disabled accounts
          </p>
        </div>

        <div className="bg-[#FFFFFF] p-4 rounded-none border-none shadow-none">
          <div
            className={`flex items-center justify-between text-xs font-medium ${
              isAtOrAboveCap ? 'text-[#D97706]' : 'text-[#1D4ED8]'
            }`}
          >
            <span>Account Cap Remaining</span>
            <Shield
              className={`h-4 w-4 ${
                isAtOrAboveCap ? 'text-[#D97706]' : 'text-[#1D4ED8]'
              }`}
            />
          </div>
          <p
            className={`mt-1 text-lg font-bold font-mono tabular-nums ${
              isAtOrAboveCap ? 'text-[#B45309]' : 'text-[#1E40AF]'
            }`}
          >
            {remainingCap} <span className="text-xs font-normal text-[#475569]">/ 15</span>
          </p>
          <p className="text-[11px] text-[#475569] mt-0.5">
            Maximum active account capacity
          </p>
        </div>
      </div>

      {/* Active User Cap Notification Banner */}
      {isAtOrAboveCap && (
        <div
          className="flex items-center gap-2.5 rounded-[8px] border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-xs text-[#92400E]"
          data-testid="user-cap-banner"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#D97706]" />
          <span>
            <strong>User Account Cap Alert:</strong> System currently has {activeCount} active user accounts (maximum recommended cap is 15). Adding new accounts may be restricted until an inactive account is disabled.
          </span>
        </div>
      )}

      {/* Flat Filter Toolbar & Actions */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#475569]" />
            <Input
              type="text"
              placeholder="Search by ID, name, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-xs bg-[#FFFFFF] rounded-[6px] border-[#E2E8F0] text-[#1E293B] focus-visible:border-[#1D4ED8]"
              data-testid="user-search-input"
            />
          </div>

          {/* Department Filter */}
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger
              className="h-9 w-[155px] rounded-[6px] border-[#E2E8F0] text-xs bg-[#FFFFFF] text-[#1E293B]"
              data-testid="filter-department-select"
            >
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
              <SelectItem value="ALL" className="text-xs">All Departments</SelectItem>
              <SelectItem value="Management" className="text-xs">Management</SelectItem>
              <SelectItem value="Accounting" className="text-xs">Accounting</SelectItem>
              <SelectItem value="Operations" className="text-xs">Operations</SelectItem>
              <SelectItem value="Documentation" className="text-xs">Documentation</SelectItem>
              <SelectItem value="HR" className="text-xs">HR</SelectItem>
            </SelectContent>
          </Select>

          {/* Role Filter */}
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger
              className="h-9 w-[135px] rounded-[6px] border-[#E2E8F0] text-xs bg-[#FFFFFF] text-[#1E293B]"
              data-testid="filter-role-select"
            >
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
              <SelectItem value="ALL" className="text-xs">All Roles</SelectItem>
              <SelectItem value="Admin" className="text-xs">Admin</SelectItem>
              <SelectItem value="Manager" className="text-xs">Manager</SelectItem>
              <SelectItem value="Accounting" className="text-xs">Accounting</SelectItem>
              <SelectItem value="Operations" className="text-xs">Operations</SelectItem>
              <SelectItem value="Documentation" className="text-xs">Documentation</SelectItem>
              <SelectItem value="HR" className="text-xs">HR</SelectItem>
            </SelectContent>
          </Select>

          {/* Entity Filter */}
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger
              className="h-9 w-[125px] rounded-[6px] border-[#E2E8F0] text-xs bg-[#FFFFFF] text-[#1E293B]"
              data-testid="filter-entity-select"
            >
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
              <SelectItem value="ALL" className="text-xs">All Entities</SelectItem>
              <SelectItem value="ATA" className="text-xs">ATA</SelectItem>
              <SelectItem value="LTA" className="text-xs">LTA</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger
              className="h-9 w-[125px] rounded-[6px] border-[#E2E8F0] text-xs bg-[#FFFFFF] text-[#1E293B]"
              data-testid="filter-status-select"
            >
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
              <SelectItem value="ALL" className="text-xs">All Status</SelectItem>
              <SelectItem value="active" className="text-xs">Active</SelectItem>
              <SelectItem value="disabled" className="text-xs">Disabled</SelectItem>
            </SelectContent>
          </Select>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="text-xs font-medium h-9 text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/70 bg-[#FFFFFF] rounded-[6px] border border-[#E2E8F0] gap-1.5 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </Button>
          )}
        </div>

        {/* Action Button: Add User */}
        {canManageUsers && (
          <Button
            onClick={handleAddClick}
            size="sm"
            className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] text-xs font-medium rounded-[6px] h-9 gap-1.5 shadow-2xs cursor-pointer shrink-0"
            data-testid="add-user-button"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Add User</span>
          </Button>
        )}
      </div>

      {/* Users Table */}
      <div className="rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-[#475569] space-y-2">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-[#1D4ED8]" />
            <p>Loading enterprise user accounts...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-[#DC2626] space-y-2">
            <ShieldAlert className="h-6 w-6 mx-auto" />
            <p>Failed to load user accounts: {error.message}</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-10 text-center text-xs text-[#475569] space-y-1">
            <p className="font-semibold text-[#1E293B]">No users found</p>
            <p>Try adjusting your search criteria or filters.</p>
          </div>
        ) : (
          <Table data-testid="user-table">
            <TableHeader className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
              <TableRow className="hover:bg-[#F8FAFC] border-b border-[#E2E8F0]">
                <TableHead className="w-[80px] font-bold tracking-normal text-xs text-[#1E293B]">
                  ID
                </TableHead>
                <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                  User / Name
                </TableHead>
                <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                  Departments
                </TableHead>
                <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                  Email
                </TableHead>
                <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                  Entities
                </TableHead>
                <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                  Status
                </TableHead>
                <TableHead className="text-right font-bold tracking-normal text-xs text-[#1E293B]">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => {
                const isSelf = user.id === currentUser?.id;
                const userCode = user.userNumber || user.user_number || '—';

                return (
                  <TableRow
                    key={user.id}
                    data-testid={`user-row-${user.id}`}
                    onClick={() => handleViewDetailsClick(user)}
                    className="border-b border-[#E2E8F0] hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                  >
                    {/* Index / Key Tag */}
                    <TableCell
                      className="py-3 text-xs text-[#475569] font-mono tabular-nums font-medium"
                      data-testid={`user-id-${user.id}`}
                    >
                      {userCode}
                    </TableCell>

                    {/* Name + Self Indicator */}
                    <TableCell className="py-3">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar
                          userId={user.id}
                          name={user.name}
                          email={user.email}
                          avatarUrl={user.avatarUrl}
                          size="sm"
                          shape="rounded"
                          className="h-7 w-7 rounded-[5px] text-[12px]"
                        />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span
                              className="font-semibold text-xs text-[#1E293B]"
                              data-testid={`user-name-${user.id}`}
                            >
                              {user.name}
                            </span>
                            {isSelf && (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0 px-1.5 rounded-[6px] border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8] font-medium"
                              >
                                You
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Departments */}
                    <TableCell className="py-3">
                      <div className="flex flex-wrap gap-1 max-w-[230px]">
                        {user.departments.length > 0 ? (
                          user.departments.map((dept) => {
                            const isAdminUser =
                              user.role === 'Admin' || user.email === 'lorein@ata-lta.ph';
                            const displayDept =
                              isAdminUser && dept === 'Management' ? 'Admin' : dept;
                            return (
                              <Badge
                                key={dept}
                                variant="outline"
                                className={`text-[11px] rounded-[6px] py-0 px-2 font-medium ${
                                  displayDept === 'Admin'
                                    ? 'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]'
                                    : DEPARTMENT_BADGE_COLORS[dept] ??
                                      'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0]'
                                }`}
                              >
                                {displayDept}
                              </Badge>
                            );
                          })
                        ) : (
                          <span className="text-[#475569] text-xs">—</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Email */}
                    <TableCell className="py-3 text-xs text-[#475569] font-mono tabular-nums">
                      {user.email}
                    </TableCell>

                    {/* Entities */}
                    <TableCell className="py-3">
                      <div className="flex gap-1">
                        {user.entities.map((ent) => (
                          <Badge
                            key={ent}
                            variant="outline"
                            className={
                              ent === 'ATA'
                                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs border-[#E2E8F0] rounded-[6px] text-xs font-bold px-2 py-0.5'
                                : 'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0] rounded-[6px] text-xs font-bold px-2 py-0.5'
                            }
                          >
                            {ent}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>

                    {/* Status Pill */}
                    <TableCell className="py-3">
                      {user.isActive ? (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-xs font-medium text-[#047857]"
                          data-testid={`user-status-${user.id}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                          Active
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-xs font-medium text-[#475569]"
                          data-testid={`user-status-${user.id}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-[#94A3B8]" />
                          Disabled
                        </span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell
                      className="py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        {/* View User Profile */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewDetailsClick(user)}
                          className="h-7 w-7 p-0 rounded-[6px] text-[#475569] hover:text-[#1D4ED8] hover:bg-[#EFF6FF] cursor-pointer"
                          title="View User Profile"
                          data-testid={`user-detail-btn-${user.id}`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>

                        {/* Edit User */}
                        {canManageUsers && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditClick(user)}
                            className="h-7 w-7 p-0 rounded-[6px] text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/70 cursor-pointer"
                            title="Edit User"
                            data-testid={`user-edit-btn-${user.id}`}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Disable User with Self-Protection OR Re-enable Disabled User */}
                        {canManageUsers &&
                          (user.isActive ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDisableClick(user)}
                              disabled={isSelf}
                              className={`h-7 w-7 p-0 rounded-[6px] ${
                                isSelf
                                  ? 'text-[#CBD5E1] cursor-not-allowed'
                                  : 'text-[#475569] hover:text-[#DC2626] hover:bg-[#FEF2F2] cursor-pointer'
                              }`}
                              title={
                                isSelf
                                  ? 'Cannot disable your own account'
                                  : 'Disable User Account'
                              }
                              data-testid={`user-disable-btn-${user.id}`}
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReEnableUser(user)}
                              className="h-7 w-7 p-0 rounded-[6px] text-[#047857] hover:text-[#065F46] hover:bg-[#ECFDF5] cursor-pointer"
                              title="Re-enable user account"
                              data-testid={`user-enable-btn-${user.id}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          ))}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Standalone Fallback Modals when rendered outside AdminTabs */}
      {!onAddUser && (
        <UserCreateModal
          isOpen={internalCreateOpen}
          onClose={() => setInternalCreateOpen(false)}
          activeUsersCount={activeCount}
        />
      )}
      {!onEditUser && (
        <UserEditModal
          user={internalEditUser}
          isOpen={Boolean(internalEditUser)}
          onClose={() => setInternalEditUser(null)}
        />
      )}
      {!onDisableUser && (
        <UserDisableModal
          user={internalDisableUser}
          isOpen={Boolean(internalDisableUser)}
          onClose={() => setInternalDisableUser(null)}
        />
      )}
      {!onViewDetails && (
        <UserDetailModal
          user={internalDetailUser}
          isOpen={Boolean(internalDetailUser)}
          onClose={() => setInternalDetailUser(null)}
        />
      )}

      <ConflictResolutionModal
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        entityType="User Account"
        onRefreshLatest={() => {
          setConflictOpen(false);
          void refetch();
        }}
      />
    </div>
  );
}
