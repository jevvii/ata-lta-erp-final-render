import { useState, useMemo } from 'react';
import {
  Check,
  Search,
  Layers,
  Calculator,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  PERMISSION_KEYS,
  ALL_DEPARTMENTS,
  DEPARTMENT_PERMISSIONS,
  ADMIN_EXCLUSIVE_PERMISSIONS,
  getPermissionModule,
  testPermission,
} from '../utils/permissionsMatrix';
import type { DepartmentName } from '../api/types';

export function PermissionsMatrixView() {
  const [search, setSearch] = useState('');
  const [selectedDepts, setSelectedDepts] = useState<DepartmentName[]>([
    'Operations',
    'Documentation',
  ]);

  // Precompute permission sets for standard departments and admin
  const deptSets = useMemo(() => {
    const map: Record<DepartmentName, Set<string>> = {
      Management: new Set(DEPARTMENT_PERMISSIONS.Management),
      Accounting: new Set(DEPARTMENT_PERMISSIONS.Accounting),
      Operations: new Set(DEPARTMENT_PERMISSIONS.Operations),
      Documentation: new Set(DEPARTMENT_PERMISSIONS.Documentation),
      HR: new Set(DEPARTMENT_PERMISSIONS.HR),
    };
    return map;
  }, []);

  const adminSet = useMemo(() => {
    const all = new Set<string>();
    for (const d of ALL_DEPARTMENTS) {
      for (const p of DEPARTMENT_PERMISSIONS[d] || []) {
        all.add(p);
      }
    }
    for (const p of ADMIN_EXCLUSIVE_PERMISSIONS) {
      all.add(p);
    }
    return all;
  }, []);

  // Compute union for interactive calculator
  const unionSet = useMemo(() => {
    const union = new Set<string>();
    for (const d of selectedDepts) {
      for (const p of DEPARTMENT_PERMISSIONS[d] || []) {
        union.add(p);
      }
    }
    return union;
  }, [selectedDepts]);

  const toggleCalculatorDept = (dept: DepartmentName) => {
    if (selectedDepts.includes(dept)) {
      setSelectedDepts(selectedDepts.filter((d) => d !== dept));
    } else {
      setSelectedDepts([...selectedDepts, dept]);
    }
  };

  // Filter keys
  const filteredKeys = useMemo(() => {
    if (!search.trim()) return PERMISSION_KEYS;
    const query = search.toLowerCase();
    return PERMISSION_KEYS.filter((k) => k.toLowerCase().includes(query));
  }, [search]);

  return (
    <div className="space-y-6" data-testid="permissions-matrix-view">
      {/* Top Controls & Union Calculator */}
      <div className="rounded-[8px] border-[#E2E8F0] bg-white shadow-card p-4 shadow-none space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#1E293B] flex items-center gap-2">
              <Calculator className="h-4 w-4 text-[#1E293B]" />
              Interactive Department Union Calculator
            </h3>
            <p className="text-xs text-[#475569] pt-0.5">
              Select assigned departments to compute effective permission grant unions in real time.
            </p>
          </div>

          <Badge variant="outline" className="text-xs bg-[#F8FAFC] text-[#1E293B] font-semibold self-start sm:self-center">
            {unionSet.size} / 52 Permissions Granted
          </Badge>
        </div>

        {/* Department Selection Checkboxes */}
        <div className="flex flex-wrap gap-3 pt-1 border-t border-[#E2E8F0]">
          {ALL_DEPARTMENTS.map((dept) => {
            const isChecked = selectedDepts.includes(dept);
            return (
              <label
                key={dept}
                className={`flex items-center gap-2 rounded-[6px] border px-3 py-1.5 text-xs cursor-pointer transition-all ${
                  isChecked
                    ? 'border-blue-400 bg-[#F8FAFC]/70 text-blue-900 font-medium shadow-none'
                    : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#475569] hover:bg-[#F8FAFC]'
                }`}
                data-testid={`calculator-toggle-${dept}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleCalculatorDept(dept)}
                  className="rounded-xs border-[#E2E8F0] text-[#1E293B] focus:ring-blue-500 h-3.5 w-3.5"
                />
                <span>{dept}</span>
                <span className="text-xs text-[#475569]">
                  ({(DEPARTMENT_PERMISSIONS[dept] || []).length})
                </span>
              </label>
            );
          })}
        </div>

        {/* Security Invariant Note */}
        <div className="flex items-center gap-2 rounded-[6px] bg-[#F8FAFC] p-2.5 text-xs text-[#475569] border-[#E2E8F0]">
          <Layers className="h-4 w-4 text-[#475569] shrink-0" />
          <span>
            <strong>RBAC Isolation Principle:</strong> Department unions expand operational capabilities but never grant the 8 administrative exclusive keys (e.g. <code className="font-mono text-[#1E293B]">users:manage</code>, <code className="font-mono text-[#1E293B]">retainers:edit</code>), which are strictly reserved for Administrator roles.
          </span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#475569]" />
          <Input
            type="text"
            placeholder="Search 52 permission keys..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-xs h-9 bg-white"
            data-testid="matrix-search-input"
          />
        </div>

        <span className="text-xs text-[#475569]">
          Showing {filteredKeys.length} of {PERMISSION_KEYS.length} keys
        </span>
      </div>

      {/* Master 52-Key Grid Table */}
      <div className="rounded-[8px] border-[#E2E8F0] bg-white shadow-card shadow-none overflow-hidden">
        <Table data-testid="master-permissions-table">
          <TableHeader className="bg-[#F8FAFC]/75">
            <TableRow>
              <TableHead className="w-[40px] text-xs font-semibold text-[#1E293B]">#</TableHead>
              <TableHead className="text-xs font-semibold text-[#1E293B]">Permission Key</TableHead>
              <TableHead className="text-xs font-semibold text-[#1E293B]">Module</TableHead>
              <TableHead className="text-center text-xs font-semibold text-red-700">Admin</TableHead>
              <TableHead className="text-center text-xs font-semibold text-purple-700">Management</TableHead>
              <TableHead className="text-center text-xs font-semibold text-emerald-700">Accounting</TableHead>
              <TableHead className="text-center text-xs font-semibold text-[#1E293B]">Operations</TableHead>
              <TableHead className="text-center text-xs font-semibold text-amber-700">Docs</TableHead>
              <TableHead className="text-center text-xs font-semibold text-rose-700">HR</TableHead>
              <TableHead className="text-center text-xs font-bold text-blue-900 bg-[#F8FAFC]/50">
                Union ({selectedDepts.length})
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredKeys.map((key, idx) => {
              const isAdminGranted = testPermission(adminSet, key);
              const isMgmtGranted = testPermission(deptSets.Management, key);
              const isAcctGranted = testPermission(deptSets.Accounting, key);
              const isOpsGranted = testPermission(deptSets.Operations, key);
              const isDocsGranted = testPermission(deptSets.Documentation, key);
              const isHrGranted = testPermission(deptSets.HR, key);
              const isUnionGranted = testPermission(unionSet, key);

              const mod = getPermissionModule(key);

              return (
                <TableRow
                  key={key}
                  data-testid={`matrix-row-${key}`}
                  className="hover:bg-[#F8FAFC]/50 transition-colors"
                >
                  {/* Row Index */}
                  <TableCell className="text-xs text-[#475569] tabular-nums">
                    {idx + 1}
                  </TableCell>

                  {/* Permission Key */}
                  <TableCell>
                    <span className="text-xs font-semibold text-[#1E293B]">
                      {key}
                    </span>
                  </TableCell>

                  {/* Module Tag */}
                  <TableCell>
                    <Badge variant="outline" className="text-xs py-0 px-1.5 text-[#475569] bg-[#F8FAFC] border-[#E2E8F0]">
                      {mod}
                    </Badge>
                  </TableCell>

                  {/* Admin */}
                  <TableCell className="text-center">
                    {isAdminGranted ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-red-50 text-red-700">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="text-[#CBD5E1] font-bold">—</span>
                    )}
                  </TableCell>

                  {/* Management */}
                  <TableCell className="text-center">
                    {isMgmtGranted ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-purple-50 text-purple-700">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="text-[#CBD5E1] font-bold">—</span>
                    )}
                  </TableCell>

                  {/* Accounting */}
                  <TableCell className="text-center">
                    {isAcctGranted ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-emerald-50 text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="text-[#CBD5E1] font-bold">—</span>
                    )}
                  </TableCell>

                  {/* Operations */}
                  <TableCell className="text-center">
                    {isOpsGranted ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-[#F8FAFC] text-[#1E293B]">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="text-[#CBD5E1] font-bold">—</span>
                    )}
                  </TableCell>

                  {/* Documentation */}
                  <TableCell className="text-center">
                    {isDocsGranted ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-amber-50 text-amber-700">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="text-[#CBD5E1] font-bold">—</span>
                    )}
                  </TableCell>

                  {/* HR */}
                  <TableCell className="text-center">
                    {isHrGranted ? (
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-rose-50 text-rose-700">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="text-[#CBD5E1] font-bold">—</span>
                    )}
                  </TableCell>

                  {/* Union Calculator Column */}
                  <TableCell className="text-center bg-[#F8FAFC]/30">
                    {isUnionGranted ? (
                      <span
                        className="inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-[#1D4ED8] text-white hover:bg-[#1E40AF] shadow-2xs font-bold"
                        data-testid={`union-granted-${key}`}
                      >
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <span className="text-[#CBD5E1] font-bold">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
