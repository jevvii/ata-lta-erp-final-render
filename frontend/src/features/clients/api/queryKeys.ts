/**
 * Centralized TanStack Query key factory for Clients Module (Parcel CLI / Module #8)
 *
 * Citation: Frozen API Contract clients@2.0.0 (docs/api-contracts/modules/clients.md)
 */

import type { ClientFilters } from './types';

export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (entity: string | null, filters?: ClientFilters) =>
    [...clientKeys.lists(), entity, filters ?? {}] as const,
  details: () => [...clientKeys.all, 'detail'] as const,
  detail: (id: string | undefined) => [...clientKeys.details(), id ?? ''] as const,
  counts: (entity: string | null) => [...clientKeys.all, 'counts', entity] as const,
};
