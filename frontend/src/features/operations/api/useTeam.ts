import { useQuery } from '@tanstack/react-query';
import { apiRequest, type ApiError } from '@/lib/api';

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Manager' | 'Staff' | string;
  departments?: string[];
  entities?: string[];
  avatarUrl?: string | null;
}

export const TEAM_QUERY_KEY = ['me', 'team'] as const;

export function useTeam() {
  return useQuery<TeamMember[], ApiError>({
    queryKey: TEAM_QUERY_KEY,
    queryFn: async () => {
      const res = await apiRequest<{ data: TeamMember[] }>('/me/team');
      return res.data;
    },
    staleTime: 60 * 1000,
  });
}

/**
 * Filter team members who can act as Work Request Manager
 * (Role must be Manager or Admin)
 */
export function getManagers(team: TeamMember[] = []): TeamMember[] {
  return team.filter((m) => m.role === 'Manager' || m.role === 'Admin');
}

/**
 * Filter staff eligible to be added as Co-Assignees / Team Members
 * (Non-manager, non-admin staff, excluding currently selected manager and already assigned members)
 */
export function getEligibleStaff(
  team: TeamMember[] = [],
  selectedManagerId?: string | null,
  currentSelectedIds: string[] = []
): TeamMember[] {
  return team.filter((m) => {
    if (m.role === 'Admin') {
      return false;
    }
    // If Manager is also Operations, allow them to be assigned as team members by other managers
    if (m.role === 'Manager' && !(m.departments && m.departments.includes('Operations'))) {
      return false;
    }
    if (selectedManagerId && m.id === selectedManagerId) {
      return false;
    }
    if (currentSelectedIds.includes(m.id)) {
      return false;
    }
    return true;
  });
}
