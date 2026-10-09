import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiRequest, type ApiError } from '@/lib/api';
import { runBlockingAction } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import { adminKeys } from './queryKeys';
import type {
  RetainerTemplate,
  CreateRetainerTemplateInput,
  UpdateRetainerTemplateInput,
} from './types';

// ============================================================================
// 1. Query Hooks
// ============================================================================

export interface UseRetainerTemplatesOptions {
  entity?: string | null;
  enabled?: boolean;
}

export function useRetainerTemplatesList(options?: UseRetainerTemplatesOptions) {
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const effectiveEntity = options?.entity ?? (activeEntity !== 'ALL' ? activeEntity : undefined);

  return useQuery<RetainerTemplate[], ApiError>({
    queryKey: adminKeys.templates(effectiveEntity),
    queryFn: async () => {
      const res = await apiRequest<{ data: RetainerTemplate[] }>('/operations/templates');
      return res.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: 60 * 1000,
    // Instant feel: keep previous entity's rows while the next fetch lands.
    placeholderData: keepPreviousData,
  });
}

export function useRetainerTemplateDetail(id: string | null | undefined, enabled = true) {
  return useQuery<RetainerTemplate, ApiError>({
    queryKey: adminKeys.templateDetail(id || ''),
    queryFn: async () => {
      if (!id) throw new Error('Template ID is required');
      const res = await apiRequest<{ data: RetainerTemplate }>(`/operations/templates/${id}`);
      return res.data;
    },
    enabled: Boolean(id) && enabled,
    staleTime: 60 * 1000,
  });
}

// ============================================================================
// 2. Direct Blocking Action Runners (Zero Optimistic Updates)
// ============================================================================

export async function createRetainerTemplateAction(
  data: CreateRetainerTemplateInput,
  activeEntity?: string | null
): Promise<RetainerTemplate> {
  return runBlockingAction<RetainerTemplate>({
    title: 'Creating Retainer Template',
    message: `Saving retainer blueprint "${data.name}" with ${data.tasks?.length ?? 0} task(s)...`,
    actionName: 'Create Retainer Template',
    successTitle: 'Template Created',
    successMessage: `Retainer template "${data.name}" created successfully.`,
    apiCall: async () => {
      const res = await apiRequest<{ data: RetainerTemplate }>('/operations/templates', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return res.data;
    },
    invalidateQueries: [
      adminKeys.allTemplates(),
      adminKeys.templates(activeEntity),
      ['retainer-templates'],
      ['operations', 'templates'],
    ],
  });
}

export async function updateRetainerTemplateAction(
  id: string,
  data: UpdateRetainerTemplateInput,
  activeEntity?: string | null
): Promise<RetainerTemplate> {
  return runBlockingAction<RetainerTemplate>({
    title: 'Updating Retainer Template',
    message: 'Persisting template modifications to server...',
    actionName: 'Update Retainer Template',
    successTitle: 'Template Updated',
    successMessage: 'Retainer template updated successfully.',
    apiCall: async () => {
      const res = await apiRequest<{ data: RetainerTemplate }>(`/operations/templates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      return res.data;
    },
    invalidateQueries: [
      adminKeys.allTemplates(),
      adminKeys.templates(activeEntity),
      adminKeys.templateDetail(id),
      ['retainer-templates'],
      ['operations', 'templates'],
    ],
  });
}

export async function deleteRetainerTemplateAction(
  id: string,
  templateName?: string,
  activeEntity?: string | null
): Promise<void> {
  return runBlockingAction<void>({
    title: 'Deleting Retainer Template',
    message: `Removing retainer template "${templateName || id}"...`,
    actionName: 'Delete Retainer Template',
    successTitle: 'Template Deleted',
    successMessage: `Retainer template "${templateName || id}" deleted successfully.`,
    apiCall: async () => {
      await apiRequest<void>(`/operations/templates/${id}`, {
        method: 'DELETE',
      });
    },
    invalidateQueries: [
      adminKeys.allTemplates(),
      adminKeys.templates(activeEntity),
      ['retainer-templates'],
      ['operations', 'templates'],
    ],
  });
}

// ============================================================================
// 3. React Mutation Hook Wrapper
// ============================================================================

export function useRetainerTemplateMutations() {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return {
    createTemplate: (data: CreateRetainerTemplateInput) =>
      createRetainerTemplateAction(data, activeEntity),
    updateTemplate: (id: string, data: UpdateRetainerTemplateInput) =>
      updateRetainerTemplateAction(id, data, activeEntity),
    deleteTemplate: (id: string, templateName?: string) =>
      deleteRetainerTemplateAction(id, templateName, activeEntity),
  };
}
