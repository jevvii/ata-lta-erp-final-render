import type { WorkRequestFilters, OperationsRequestFilters, DocumentFilterParams } from './types';

export const operationsKeys = {
  all: ['operations'] as const,

  // --- Work Requests ---
  workRequests: () => [...operationsKeys.all, 'workRequests'] as const,
  workRequestsList: (entity: string | null, filters?: WorkRequestFilters) =>
    [...operationsKeys.workRequests(), 'list', entity, filters ?? {}] as const,
  workRequestDetails: () => [...operationsKeys.workRequests(), 'detail'] as const,
  workRequestDetail: (id: string) => [...operationsKeys.workRequestDetails(), id] as const,
  workRequestCounts: (entity: string | null) =>
    [...operationsKeys.workRequests(), 'counts', entity] as const,
  workRequestRelated: (id: string) =>
    [...operationsKeys.workRequestDetail(id), 'related'] as const,

  // Aliases for compatibility with PROJECT.md contract
  list: (filters?: WorkRequestFilters) =>
    [...operationsKeys.workRequests(), 'list', filters ?? {}] as const,
  detail: (id: string) => [...operationsKeys.workRequestDetails(), id] as const,

  // --- Tasks (Sub-resources of Work Request) ---
  tasks: (wrId: string, entity?: string | null) =>
    entity !== undefined && entity !== null
      ? ([...operationsKeys.workRequestDetail(wrId), 'tasks', entity] as const)
      : ([...operationsKeys.workRequestDetail(wrId), 'tasks'] as const),
  taskDetail: (wrId: string, taskId: string) =>
    [...operationsKeys.tasks(wrId), taskId] as const,
  taskRelated: (taskId: string, entity?: string | null) =>
    entity !== undefined
      ? ([...operationsKeys.all, 'tasks', taskId, 'related', entity] as const)
      : ([...operationsKeys.all, 'tasks', taskId, 'related'] as const),

  // --- Operations / Phase Transition Requests ---
  requests: () => [...operationsKeys.all, 'requests'] as const,
  requestsList: (entity: string | null, filters?: OperationsRequestFilters) =>
    [...operationsKeys.requests(), 'list', entity, filters ?? {}] as const,
  requestDetail: (id: string) => [...operationsKeys.requests(), 'detail', id] as const,
  requestCounts: (entity: string | null) =>
    [...operationsKeys.requests(), 'counts', entity] as const,

  // --- Retainer Templates ---
  templates: () => [...operationsKeys.all, 'templates'] as const,
  templatesList: (entity: string | null, type?: 'retainer' | 'other' | string) =>
    [...operationsKeys.templates(), 'list', entity, type ?? 'all'] as const,
  templateDetail: (id: string) => [...operationsKeys.templates(), 'detail', id] as const,

  // --- Documents (DMS) ---
  documents: () => ['documents'] as const,
  documentsList: (params?: DocumentFilterParams) =>
    [...operationsKeys.documents(), 'list', params ?? {}] as const,
  documentDetail: (id: string) => [...operationsKeys.documents(), 'detail', id] as const,
  documentDownloadUrl: (id: string) =>
    [...operationsKeys.documents(), 'download-url', id] as const,

  // --- Ground Workers & Standard Templates ---
  groundWorkers: (entity: string | null) =>
    [...operationsKeys.all, 'groundWorkers', entity] as const,
  standardTaskTemplates: () =>
    [...operationsKeys.all, 'standardTaskTemplates'] as const,
};
