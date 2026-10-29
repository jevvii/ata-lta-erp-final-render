import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GuardedPasswordInput } from './GuardedPasswordInput';
import { useUserMutations } from '../api/useUsers';
import { createUserSchema } from '../api/schemas';
import type { DepartmentName, UserRole, EntityCode, CreateUserInput } from '../api/types';

export interface UserCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  activeUsersCount?: number;
}

const ALL_ROLES: UserRole[] = [
  'Admin',
  'Manager',
  'Accounting',
  'Operations',
  'Documentation',
  'HR',
];

const ALL_DEPARTMENTS: DepartmentName[] = [
  'Management',
  'Accounting',
  'Operations',
  'Documentation',
  'HR',
];

export function UserCreateModal({
  isOpen,
  onClose,
  onSuccess,
  activeUsersCount = 0,
}: UserCreateModalProps) {
  const { createUser } = useUserMutations();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('Operations');
  const [departments, setDepartments] = useState<DepartmentName[]>(['Operations']);
  const [entities, setEntities] = useState<EntityCode[]>(['ATA']);
  const [isActive, setIsActive] = useState(true);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (newRole === 'Manager' && !departments.includes('Management')) {
      setDepartments([...departments, 'Management']);
    } else if (
      ALL_DEPARTMENTS.includes(newRole as DepartmentName) &&
      !departments.includes(newRole as DepartmentName)
    ) {
      setDepartments([...departments, newRole as DepartmentName]);
    }
  };

  const toggleDepartment = (dept: DepartmentName) => {
    if (departments.includes(dept)) {
      setDepartments(departments.filter((d) => d !== dept));
    } else {
      setDepartments([...departments, dept]);
    }
  };

  const toggleEntity = (ent: EntityCode) => {
    if (entities.includes(ent)) {
      if (entities.length > 1) {
        setEntities(entities.filter((e) => e !== ent));
      }
    } else {
      setEntities([...entities, ent]);
    }
  };

  const resetForm = () => {
    setName('');
    setEmail('');
    setPassword('');
    setRole('Operations');
    setDepartments(['Operations']);
    setEntities(['ATA']);
    setIsActive(true);
    setErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const payload: CreateUserInput = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: password || undefined,
      role,
      departments,
      entities,
      isActive,
    };

    const validation = createUserSchema.safeParse(payload);
    if (!validation.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of validation.error.issues) {
        const path = issue.path[0];
        if (path) {
          fieldErrors[String(path)] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }

    if (role !== 'Admin' && departments.length === 0) {
      setErrors({ departments: 'At least one department must be assigned for non-admin users.' });
      return;
    }

    try {
      await createUser(payload);
      resetForm();
      if (onSuccess) onSuccess();
      onClose();
    } catch {
      // Errors handled verbatim by runBlockingAction
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-lg rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] p-6 shadow-float max-h-[90vh] overflow-y-auto space-y-4"
        data-testid="user-create-modal"
      >
        <DialogHeader className="border-b border-[#E2E8F0] pb-4">
          <DialogTitle className="text-lg font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-[#1D4ED8]" />
            <span>Create User Account</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569] pt-1">
            Provision a new enterprise team member with role-based permissions and entity scopes.
          </DialogDescription>
        </DialogHeader>

        {activeUsersCount >= 15 && (
          <div className="rounded-[8px] bg-[#FFFBEB] border border-[#FDE68A] p-3 text-xs text-[#92400E]">
            <strong>Active Account Cap Warning:</strong> The system has reached {activeUsersCount} active users. Creating a new active user may fail unless an existing account is disabled.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Full Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#1E293B]">
              Full Name <span className="text-[#DC2626]">*</span>
            </label>
            <Input
              type="text"
              placeholder="e.g. Maria Santos"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 text-xs rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] focus-visible:border-[#1D4ED8]"
              data-testid="create-user-name-input"
              required
            />
            {errors.name && <p className="text-xs text-[#DC2626]">{errors.name}</p>}
          </div>

          {/* Email Address */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#1E293B]">
              Email Address <span className="text-[#DC2626]">*</span>
            </label>
            <Input
              type="email"
              placeholder="e.g. maria@ata-lta.ph"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 text-xs rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] font-mono tabular-nums focus-visible:border-[#1D4ED8]"
              data-testid="create-user-email-input"
              required
            />
            {errors.email && <p className="text-xs text-[#DC2626]">{errors.email}</p>}
          </div>

          {/* Guarded Password Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#1E293B]">
              Password <span className="text-[#DC2626]">*</span>
            </label>
            <GuardedPasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Enter or generate initial password..."
              required
              data-testid="create-user-password-input"
            />
            {errors.password && <p className="text-xs text-[#DC2626]">{errors.password}</p>}
          </div>

          {/* Role Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#1E293B]">
              Primary Role <span className="text-[#DC2626]">*</span>
            </label>
            <Select value={role} onValueChange={(val) => handleRoleChange(val as UserRole)}>
              <SelectTrigger
                className="h-9 text-xs rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B]"
                data-testid="create-user-role-select"
              >
                <SelectValue placeholder="Select role" />
              </SelectTrigger>
              <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
                {ALL_ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="text-xs">
                    {r} {r === 'Admin' ? '(Super-User)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.role && <p className="text-xs text-[#DC2626]">{errors.role}</p>}
          </div>

          {/* Department Multi-Select Checkboxes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#1E293B]">
              Department Assignments {role !== 'Admin' && <span className="text-[#DC2626]">*</span>}
            </label>
            <div className="grid grid-cols-2 gap-2.5 rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              {ALL_DEPARTMENTS.map((dept) => {
                const checked = departments.includes(dept);
                return (
                  <label
                    key={dept}
                    className="flex items-center gap-2 text-xs text-[#1E293B] cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDepartment(dept)}
                      className="rounded-[4px] border-[#CBD5E1] text-[#1D4ED8] h-3.5 w-3.5 accent-[#1D4ED8]"
                      data-testid={`create-user-dept-${dept}`}
                    />
                    <span>{dept}</span>
                  </label>
                );
              })}
            </div>
            {errors.departments && (
              <p className="text-xs text-[#DC2626]">{errors.departments}</p>
            )}
          </div>

          {/* Entity Access Checkboxes */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#1E293B]">
              Entity Access <span className="text-[#DC2626]">*</span>
            </label>
            <div className="flex gap-4 rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              {(['ATA', 'LTA'] as EntityCode[]).map((ent) => {
                const checked = entities.includes(ent);
                return (
                  <label
                    key={ent}
                    className="flex items-center gap-2 text-xs text-[#1E293B] cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEntity(ent)}
                      className="rounded-[4px] border-[#CBD5E1] text-[#1D4ED8] h-3.5 w-3.5 accent-[#1D4ED8]"
                      data-testid={`create-user-entity-${ent}`}
                    />
                    <span className="font-semibold font-mono">{ent}</span>
                  </label>
                );
              })}
            </div>
            {errors.entities && <p className="text-xs text-[#DC2626]">{errors.entities}</p>}
          </div>

          {/* Active Status */}
          <div className="flex items-center gap-2 pt-1">
            <label className="flex items-center gap-2 text-xs text-[#1E293B] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded-[4px] border-[#CBD5E1] text-[#1D4ED8] h-3.5 w-3.5 accent-[#1D4ED8]"
                data-testid="create-user-active-checkbox"
              />
              <span className="font-medium">Active Account</span>
            </label>
          </div>

          <DialogFooter className="border-t border-[#E2E8F0] pt-4 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs h-9 rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] cursor-pointer"
              data-testid="create-user-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="text-xs h-9 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] font-medium shadow-2xs cursor-pointer"
              data-testid="create-user-submit-btn"
            >
              Create User
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
