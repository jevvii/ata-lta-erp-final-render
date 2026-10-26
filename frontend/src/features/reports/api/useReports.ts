/**
 * TanStack Query hooks for reports@2.0.0.
 * Frozen per docs/api-contracts/modules/reports.md.
 */

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { reportsKeys } from './queryKeys';
import type {
  AnalyticsQueryParams,
  AgingQueryParams,
  AnalyticsData,
  ConsolidatedAnalyticsData,
  AnalyticsResponse,
  DashboardData,
  DashboardResponse,
  DailyReportData,
  DailyReportResponse,
  WeeklyReportData,
  WeeklyReportResponse,
  MonthlyPendingData,
  MonthlyPendingResponse,
  AgingReportData,
  AgingReportResponse,
} from './types';

export function useReportsAnalytics(
  params?: AnalyticsQueryParams,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery<AnalyticsData | ConsolidatedAnalyticsData>({
    queryKey: reportsKeys.analytics(activeEntity, params),
    queryFn: async () => {
      const q = new URLSearchParams();
      if (params?.startDate) q.append('startDate', params.startDate);
      if (params?.endDate) q.append('endDate', params.endDate);
      const queryStr = q.toString();
      const path = `/reports/analytics${queryStr ? `?${queryStr}` : ''}`;
      const res = await apiRequest<AnalyticsResponse>(path);
      return res.data;
    },
    staleTime: 30 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useReportsDashboard(options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery<DashboardData>({
    queryKey: reportsKeys.dashboard(activeEntity),
    queryFn: async () => {
      const res = await apiRequest<DashboardResponse>('/reports/dashboard');
      return res.data;
    },
    staleTime: 30 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useDailyReport(date: string, options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery<DailyReportData>({
    queryKey: reportsKeys.daily(activeEntity, date),
    queryFn: async () => {
      const res = await apiRequest<DailyReportResponse>(
        `/reports/daily?date=${encodeURIComponent(date)}`
      );
      return res.data;
    },
    staleTime: 30 * 1000,
    enabled: activeEntity !== 'ALL' && Boolean(date) && (options?.enabled ?? true),
  });
}

export function useWeeklyReport(date: string, options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery<WeeklyReportData>({
    queryKey: reportsKeys.weekly(activeEntity, date),
    queryFn: async () => {
      const res = await apiRequest<WeeklyReportResponse>(
        `/reports/weekly?date=${encodeURIComponent(date)}`
      );
      return res.data;
    },
    staleTime: 30 * 1000,
    enabled: activeEntity !== 'ALL' && Boolean(date) && (options?.enabled ?? true),
  });
}

export function useMonthlyPending(month?: string, options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery<MonthlyPendingData>({
    queryKey: reportsKeys.monthlyPending(activeEntity, month),
    queryFn: async () => {
      const path = `/reports/monthly-pending${month ? `?month=${encodeURIComponent(month)}` : ''}`;
      const res = await apiRequest<MonthlyPendingResponse>(path);
      return res.data;
    },
    staleTime: 30 * 1000,
    enabled: activeEntity !== 'ALL' && (options?.enabled ?? true),
  });
}

export function useAgingReport(
  params?: AgingQueryParams,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery<AgingReportData>({
    queryKey: reportsKeys.aging(activeEntity, params),
    queryFn: async () => {
      const q = new URLSearchParams();
      if (params?.clientId) q.append('clientId', params.clientId);
      const queryStr = q.toString();
      const path = `/reports/aging${queryStr ? `?${queryStr}` : ''}`;
      const res = await apiRequest<AgingReportResponse>(path);
      return res.data;
    },
    staleTime: 30 * 1000,
    enabled: activeEntity !== 'ALL' && (options?.enabled ?? true),
  });
}

