import { useState, useMemo } from 'react';
import {
  Search,
  UserPlus,
  ShieldAlert,
  KeyRound,
  Edit2,
  UserX,
  AlertTriangle,
} from 'lucide-react';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useUsersList } from '../api/useUsers';
import { useSessionStore } from '@/lib/session';
import { usePermission } from '@/lib/permissions';
import type { AdminUser, DepartmentName, UserRole, EntityCode } from '../api/types';

export interface UserListTableProps {
  onAddUser: () => void;
  onEditUser: (user: AdminUser) => void;
  onDisableUser: (user: AdminUser) => void;
  onViewDetails: (user: AdminUser) => void;
}

const DEPARTMENT_BADGE_COLORS: Record<DepartmentName, string> = {
  Management: 'bg-purple-50 text-purple-700 border-purple-200',
  Accounting: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Operations: 'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0]',
  Documentation: 'bg-amber-50 text-amber-700 border-amber-200',
  HR: 'bg-rose-50 text-rose-700 border-rose-200',
};

const ROLE_BADGE_COLORS: Record<UserRole, string> = {
  Admin: 'bg-red-50 text-red-700 border-red-200 font-semibold',
  Manager: 'bg-purple-50 text-purple-700 border-purple-200',
  Accounting: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Operations: 'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0]',
  Documentation: 'bg-amber-50 text-amber-700 border-amber-200',
  HR: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function UserListTable({
  onAddUser,
  onEditUser,
  onDisableUser,
  onViewDetails,
}: UserListTableProps) {
  const currentUser = useSessionStore((state) => state.user);
  const canManageUsers = usePermission('users:manage');

  // Filter States
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const { data: users = [], isLoading, error } = useUsersList();

  // Active users count
  const activeCount = useMemo(() => users.filter((u) => u.isActive).length, [users]);
  const isAtOrAboveCap = activeCount >= 15;

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      // Search by name or email
      if (search.trim()) {
        const query = search.toLowerCase();
        const matchesName = u.name.toLowerCase().includes(query);
        const matchesEmail = u.email.toLowerCase().includes(query);
        if (!matchesName && !matchesEmail) return false;
      }

      // Department filter
      if (departmentFilter !== 'ALL') {
        if (!u.departments.includes(departmentFilter as DepartmentName)) {
          return false;
        }
      }

      // Role filter
      if (roleFilter !== 'ALL') {
        if (u.role !== roleFilter) return false;
      }

      // Entity filter
      if (entityFilter !== 'ALL') {
        if (!u.entities.includes(entityFilter as EntityCode)) return false;
      }

      // Status filter
      if (statusFilter === 'active' && !u.isActive) return false;
      if (statusFilter === 'disabled' && u.isActive) return false;

      return true;
    });
  }, [users, search, departmentFilter, roleFilter, entityFilter, statusFilter]);

  return (
    <div className="space-y-4" data-testid="user-list-table-container">
      {/* Active User Cap Notification Banner */}
      {isAtOrAboveCap && (
        <div
          className="flex items-center gap-2 rounded-[6px] border-amber-300 bg-amber-50 p-3 text-xs text-amber-800"
          data-testid="user-cap-banner"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong>User Account Cap Alert:</strong> System currently has {activeCount} active user accounts (maximum recommended cap is 15). Adding new accounts may be restricted until an inactive account is disabled.
          </span>
        </div>
      )}

      {/* Filter Toolbar & Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Search Input */}
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#475569]" />
            <Input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 text-xs h-9 bg-white"
              data-testid="user-search-input"
            />
          </div>

          {/* Department Filter */}
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger
              className="h-9 w-[140px] text-xs bg-white"
              data-testid="filter-department-select"
            >
              <SelectValue placeholder="Department" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Departments</SelectItem>
              <SelectItem value="Management">Management</SelectItem>
              <SelectItem value="Accounting">Accounting</SelectItem>
              <SelectItem value="Operations">Operations</SelectItem>
              <SelectItem value="Documentation">Documentation</SelectItem>
              <SelectItem value="HR">HR</SelectItem>
            </SelectContent>
          </Select>

          {/* Role Filter */}
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger
              className="h-9 w-[120px] text-xs bg-white"
              data-testid="filter-role-select"
            >
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Roles</SelectItem>
              <SelectItem value="Admin">Admin</SelectItem>
              <SelectItem value="Manager">Manager</SelectItem>
              <SelectItem value="Accounting">Accounting</SelectItem>
              <SelectItem value="Operations">Operations</SelectItem>
              <SelectItem value="Documentation">Documentation</SelectItem>
              <SelectItem value="HR">HR</SelectItem>
            </SelectContent>
          </Select>

          {/* Entity Filter */}
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger
              className="h-9 w-[110px] text-xs bg-white"
              data-testid="filter-entity-select"
            >
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Entities</SelectItem>
              <SelectItem value="ATA">ATA</SelectItem>
              <SelectItem value="LTA">LTA</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger
              className="h-9 w-[110px] text-xs bg-white"
              data-testid="filter-status-select"
            >
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="disabled">Disabled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Action Button: Add User */}
        {canManageUsers && (
          <Button
            onClick={onAddUser}
            size="sm"
            className="h-9 gap-1.5 text-xs font-semibold bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs shadow-none shrink-0"
            data-testid="add-user-button"
          >
            <UserPlus className="h-4 w-4" />
            Add User
          </Button>
        )}
      </div>

      {/* Users Table */}
      <div className="rounded-[8px] border-[#E2E8F0] bg-white shadow-card shadow-none overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-xs text-[#475569] space-y-2">
            <div className="inline-block h-6 w-6 animate-spin rounded-[6px] border-[#E2E8F0] border-t-blue-600" />
            <p>Loading enterprise user accounts...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-xs text-rose-600 space-y-2">
            <ShieldAlert className="h-6 w-6 mx-auto" />
            <p>Failed to load user accounts: {error.message}</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#475569] space-y-1">
            <p className="font-semibold text-[#1E293B]">No users found</p>
            <p>Try adjusting your search criteria or filters.</p>
          </div>
        ) : (
          <Table data-testid="user-table">
            <TableHeader className="bg-[#F8FAFC]/75">
              <TableRow>
                <TableHead className="w-[60px] text-xs font-semibold text-[#1E293B]">#</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">User / Name</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Role</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Departments</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Email</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Entities</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Status</TableHead>
                <TableHead className="text-right text-xs font-semibold text-[#1E293B]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user, idx) => {
                const isSelf = user.id === currentUser?.id;
                const rowKey = `USR-${String(idx + 1).padStart(2, '0')}`;

                return (
                  <TableRow
                    key={user.id}
                    data-testid={`user-row-${user.id}`}
                    className="hover:bg-[#F8FAFC]/60 transition-colors"
                  >
                    {/* Index / Key Tag */}
                    <TableCell className="text-xs text-[#475569] font-medium">
                      {rowKey}
                    </TableCell>

                    {/* Name + Self Indicator */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#F8FAFC] text-xs font-bold text-[#1E293B] border-[#E2E8F0]">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium text-xs text-[#1E293B]" data-testid={`user-name-${user.id}`}>
                              {user.name}
                            </span>
                            {isSelf && (
                              <Badge variant="outline" className="text-xs py-0 px-1 border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B]">
                                You
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Role */}
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-xs  py-0.5 px-2 ${
                          ROLE_BADGE_COLORS[user.role] ?? 'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0]'
                        }`}
                        data-testid={`user-role-${user.id}`}
                      >
                        {user.role}
                      </Badge>
                    </TableCell>

                    {/* Departments */}
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {user.departments.length > 0 ? (
                          user.departments.map((dept) => {
                            const isAdminUser = user.role === 'Admin' || user.email === 'lorein@ata-lta.ph';
                            const displayDept = isAdminUser && dept === 'Management' ? 'Admin' : dept;
                            return (
                              <Badge
                                key={dept}
                                variant="outline"
                                className={`text-xs  py-0 px-1.5 ${
                                  displayDept === 'Admin'
                                    ? 'bg-red-50 text-red-700 border-red-200'
                                    : DEPARTMENT_BADGE_COLORS[dept] ?? 'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0]'
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
                    <TableCell className="text-xs text-[#475569]">
                      {user.email}
                    </TableCell>

                    {/* Entities */}
                    <TableCell>
                      <div className="flex gap-1">
                        {user.entities.map((ent) => (
                          <Badge
                            key={ent}
                            variant="outline"
                            className="text-xs py-0 px-1 border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B]"
                          >
                            {ent}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>

                    {/* Status Pill */}
                    <TableCell>
                      {user.isActive ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-[6px] bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border-emerald-200"
                          data-testid={`user-status-${user.id}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-[6px] bg-emerald-500" />
                          Active
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 rounded-[6px] bg-[#F8FAFC] px-2 py-0.5 text-xs font-medium text-[#475569] border-[#E2E8F0]"
                          data-testid={`user-status-${user.id}`}
                        >
                          <span className="h-1.5 w-1.5 rounded-[6px] bg-slate-400" />
                          Disabled
                        </span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* View Permissions Inspector */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onViewDetails(user)}
                          className="h-8 w-8 p-0 text-[#475569] hover:text-[#1E293B]"
                          title="View Effective Permissions"
                          data-testid={`user-view-perms-btn-${user.id}`}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>

                        {/* Edit User */}
                        {canManageUsers && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onEditUser(user)}
                            className="h-8 w-8 p-0 text-[#475569] hover:text-[#1E293B]"
                            title="Edit User"
                            data-testid={`user-edit-btn-${user.id}`}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Disable User with Self-Protection */}
                        {canManageUsers && user.isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDisableUser(user)}
                            disabled={isSelf}
                            className={`h-8 w-8 p-0 ${
                              isSelf
                                ? 'text-[#CBD5E1] cursor-not-allowed'
                                : 'text-[#475569] hover:text-rose-600 hover:bg-rose-50'
                            }`}
                            title={isSelf ? 'Cannot disable your own account' : 'Disable User Account'}
                            data-testid={`user-disable-btn-${user.id}`}
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
