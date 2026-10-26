/**
 * Centralized TanStack Query Key Factory for Disbursements (Module #4)
 *
 * Citation: Frozen API Contract disbursements@2.0.0 (docs/api-contracts/modules/disbursements.md)
 */

import type { DisbursementFilters } from './types';

export const disbursementKeys = {
  all: ['disbursements'] as const,

  // --- List Queries ---
  lists: () => [...disbursementKeys.all, 'list'] as const,
  list: (entity: string | null, filters?: DisbursementFilters) =>
    [...disbursementKeys.lists(), entity, filters ?? {}] as const,

  // --- Queue Queries (v2 Segments & Workspaces) ---
  queues: () => [...disbursementKeys.all, 'queue'] as const,
  queue: (entity: string | null, queueName: string, filters?: DisbursementFilters) =>
    [...disbursementKeys.queues(), entity, queueName, filters ?? {}] as const,

  // --- Detail Queries ---
  details: () => [...disbursementKeys.all, 'detail'] as const,
  detail: (id: string) => [...disbursementKeys.details(), id] as const,

  // --- Tab Badge Counts ---
  counts: (entity: string | null) =>
    [...disbursementKeys.all, 'counts', entity] as const,

  // --- Receipt Download/Preview URL ---
  receiptUrl: (id: string) =>
    [...disbursementKeys.all, 'receiptUrl', id] as const,

  // --- Templates ---
  templates: (entity: string | null) =>
    [...disbursementKeys.all, 'templates', entity] as const,
  template: (id: string) =>
    [...disbursementKeys.all, 'template', id] as const,
};
