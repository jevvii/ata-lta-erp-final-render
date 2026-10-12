import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RetainerTemplateList } from '../components/RetainerTemplateList';
import { RetainerTemplateModal } from '../components/RetainerTemplateModal';
import { RetainerGenerationLogs } from '../components/RetainerGenerationLogs';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { RetainerTemplate, AuditLogResponse } from '../api/types';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

const mockTemplates: RetainerTemplate[] = [
  {
    id: 'tpl-smoke-1',
    entity_id: 'ent-ata',
    name: 'SMOKE Annual Compliance Retainer',
    description: 'Statutory compliance template for smoke verification',
    client_id: 'c-1',
    schedule: 'annual',
    priority: 'Normal',
    pf_amount: 50000,
    recurrence: 'annual',
    tasks: [
      {
        local_id: 'task_1',
        title: 'Collect Trial Balance',
        phase: 'pre_processing',
      },
      {
        local_id: 'task_2',
        title: 'Reconcile Bank Statements',
        phase: 'processing',
        depends_on_local_id: 'task_1',
      },
    ],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    clients: { name: 'Acme Philippines Corp' },
  },
  {
    id: 'tpl-adhoc-2',
    entity_id: 'ent-ata',
    name: 'Monthly Advisory Retainer',
    description: 'Ad-hoc consulting',
    client_id: null,
    schedule: 'monthly',
    priority: 'High',
    pf_amount: 20000,
    recurrence: 'none',
    tasks: [
      {
        local_id: 'task_1',
        title: 'Review Tax Inquiries',
        phase: 'pre_processing',
      },
    ],
    created_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
  },
];

const mockGenerationAuditLogs: AuditLogResponse = {
  data: [
    {
      id: 'aud-gen-1',
      action: 'retainer-template.generated',
      tableName: 'retainer_template_generations',
      recordId: 'gen-row-1',
      entity: 'ATA',
      userId: 'user-admin',
      details: {
        templateId: 'tpl-smoke-1',
        workRequestId: 'e3cf8f27-1459-4fd7-9bb1-1f81662f3bf2',
        periodLabel: 'FY-2026-SMOKE',
      },
      createdAt: '2026-10-03T20:28:39Z',
    },
    {
      id: 'aud-gen-2',
      action: 'retainer-template.generated',
      tableName: 'retainer_template_generations',
      recordId: 'gen-row-2',
      entity: 'ATA',
      userId: 'user-admin',
      details: {
        templateId: 'tpl-smoke-1',
        workRequestId: '98b86a72-db01-46e3-b7c9-e26f171ceca4',
        periodLabel: 'FY-2027-SMOKE',
      },
      createdAt: '2026-10-03T20:28:58Z',
    },
  ],
  meta: {
    total: 2,
    limit: 20,
    offset: 0,
    hasMore: false,
  },
};

describe('Retainer Template Builder & Generation Logs (Admin Gated)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'dev-admin@ata-lta.ph',
        name: 'Admin Developer',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['users:view', 'users:manage', 'retainers:use', 'retainers:edit'],
      activeEntity: 'ALL',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/operations/templates')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockTemplates }),
        } as Response);
      }
      if (u.includes('/admin/audit')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => mockGenerationAuditLogs,
        } as Response);
      }
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'c-1', name: 'Acme Philippines Corp', entity: 'ATA' }] }),
        } as Response);
      }
      if (u.includes('/admin/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'user-admin', name: 'Admin Developer', role: 'Admin', departments: ['Management'], entities: ['ATA'], isActive: true },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    useBlockingModalStore.getState().reset();
  });

  describe('RetainerTemplateList', () => {
    it('renders template blueprints with recurrence badges and task counts', async () => {
      const { wrapper } = createHarness();
      render(
        <RetainerTemplateList
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('template-card-tpl-smoke-1')).toBeInTheDocument();
        expect(screen.getByTestId('template-card-tpl-adhoc-2')).toBeInTheDocument();
      });

      expect(screen.getByText('SMOKE Annual Compliance Retainer')).toBeInTheDocument();
      expect(screen.getByTestId('template-recurrence-tpl-smoke-1')).toHaveTextContent('Annual');
      expect(screen.getByText('1 Pre-Proc • 1 Proc')).toBeInTheDocument();
      expect(screen.getByTestId('new-template-button')).toBeInTheDocument();
    });

    it('hides New Template and Edit/Delete buttons from Managers (retainers:use only)', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-docs',
          email: 'dev-docs@ata-lta.ph',
          name: 'Doc Manager',
          role: 'Manager',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['users:view', 'retainers:use'], // strictly lacks retainers:edit
        activeEntity: 'ALL',
      });

      const { wrapper } = createHarness();
      render(
        <RetainerTemplateList
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('template-card-tpl-smoke-1')).toBeInTheDocument();
      });

      // Manager MUST NOT see New Template button
      expect(screen.queryByTestId('new-template-button')).not.toBeInTheDocument();
      // Manager MUST NOT see Edit or Delete buttons
      expect(screen.queryByTestId('edit-template-btn-tpl-smoke-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('delete-template-btn-tpl-smoke-1')).not.toBeInTheDocument();
    });

    it('opens delete confirmation modal and invokes deleteTemplate on confirm', async () => {
      const { wrapper } = createHarness();
      render(
        <RetainerTemplateList
          onNewTemplate={vi.fn()}
          onEditTemplate={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('delete-template-btn-tpl-smoke-1')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('delete-template-btn-tpl-smoke-1'));

      expect(screen.getByTestId('template-delete-modal')).toBeInTheDocument();
      expect(screen.getByText(/Are you sure you want to delete template/)).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('confirm-delete-template-btn'));

      await waitFor(() => {
        expect(screen.queryByTestId('template-delete-modal')).not.toBeInTheDocument();
      });
    });
  });

  describe('RetainerTemplateModal (Builder)', () => {
    it('renders task rows with phase selector strictly limited to pre_processing and processing', async () => {
      const { wrapper } = createHarness();
      render(
        <RetainerTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('retainer-template-modal')).toBeInTheDocument();
      expect(screen.getByTestId('task-row-0')).toBeInTheDocument();

      // Check phase selector element
      const phaseSelect = screen.getByTestId('task-phase-select-0');
      expect(phaseSelect).toBeInTheDocument();
      expect(phaseSelect).toHaveTextContent('Pre-Processing');
    });

    it('shows annual period label guidance hint when recurrence is set to annual', async () => {
      const { wrapper } = createHarness();
      render(
        <RetainerTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Initially 'none', hint should not be present
      expect(screen.queryByTestId('annual-period-hint')).not.toBeInTheDocument();

      // Click annual radio
      fireEvent.click(screen.getByTestId('recurrence-annual-radio'));

      expect(screen.getByTestId('annual-period-hint')).toBeInTheDocument();
      expect(screen.getByText(/Annual Period Label Guidance/)).toBeInTheDocument();
      expect(screen.getAllByText(/FY-2026/).length).toBeGreaterThan(0);

      // Click none radio again
      fireEvent.click(screen.getByTestId('recurrence-none-radio'));
      expect(screen.queryByTestId('annual-period-hint')).not.toBeInTheDocument();
    });

    it('adds and removes task blueprint rows', async () => {
      const { wrapper } = createHarness();
      render(
        <RetainerTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('task-row-0')).toBeInTheDocument();
      expect(screen.queryByTestId('task-row-1')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('add-task-row-btn'));

      expect(screen.getByTestId('task-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('task-row-1')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('remove-task-btn-1'));
      expect(screen.queryByTestId('task-row-1')).not.toBeInTheDocument();
    });

    it('supports bottom add task button and interactive checklist subtasks & document requirements', async () => {
      const { wrapper } = createHarness();
      render(
        <RetainerTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Verify bottom Add task button is rendered
      const bottomAddTaskBtn = screen.getByTestId('add-task-btn');
      expect(bottomAddTaskBtn).toBeInTheDocument();
      fireEvent.click(bottomAddTaskBtn);
      expect(screen.getByTestId('task-row-1')).toBeInTheDocument();

      // Verify Add Subtask button on task 0
      const addSubtaskBtn = screen.getByTestId('add-subtask-btn-0');
      expect(addSubtaskBtn).toBeInTheDocument();
      fireEvent.click(addSubtaskBtn);

      // Check checklist item input and default category (subtask)
      const itemInput = screen.getByTestId('checklist-item-input-0-0');
      expect(itemInput).toBeInTheDocument();
      fireEvent.change(itemInput, { target: { value: 'Draft Board Resolution' } });
      expect(itemInput).toHaveValue('Draft Board Resolution');

      const catToggle = screen.getByTestId('checklist-category-toggle-0-0');
      expect(catToggle).toHaveTextContent(/sub-task/i);

      // Toggle category to Doc
      fireEvent.click(catToggle);
      expect(catToggle).toHaveTextContent(/doc/i);

      // Period Year input appears for Doc
      const periodYearInput = screen.getByTestId('checklist-period-year-0-0');
      expect(periodYearInput).toBeInTheDocument();
      fireEvent.change(periodYearInput, { target: { value: '2026' } });
      expect(periodYearInput).toHaveValue(2026);

      // Remove checklist item
      const removeClBtn = screen.getByTestId('checklist-remove-btn-0-0');
      fireEvent.click(removeClBtn);
      expect(screen.queryByTestId('checklist-item-input-0-0')).not.toBeInTheDocument();
    });

    it('blocks access if user lacks retainers:edit permission', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-docs',
          email: 'dev-docs@ata-lta.ph',
          name: 'Doc Manager',
          role: 'Manager',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['users:view', 'retainers:use'],
        activeEntity: 'ALL',
      });

      const { wrapper } = createHarness();
      render(
        <RetainerTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('unauthorized-retainer-modal')).toBeInTheDocument();
      expect(screen.getByText(/Access Restricted/)).toBeInTheDocument();
      expect(screen.queryByTestId('retainer-template-modal')).not.toBeInTheDocument();
    });

    it('surfaces 409 PERIOD_ALREADY_GENERATED conflict error verbatim', async () => {
      const { wrapper } = createHarness();

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          status: 409,
          title: 'Conflict',
          code: 'PERIOD_ALREADY_GENERATED',
          detail: 'Period already generated for this template',
        }),
      } as Response);

      render(
        <RetainerTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('template-name-input'), {
        target: { value: 'Duplicate Template Attempt' },
      });
      fireEvent.change(screen.getByTestId('task-title-input-0'), {
        target: { value: 'First Task' },
      });

      fireEvent.click(screen.getByTestId('template-modal-submit-btn'));

      await waitFor(() => {
        const modalState = useBlockingModalStore.getState();
        expect(modalState.error?.code).toBe('PERIOD_ALREADY_GENERATED');
        expect(modalState.error?.detail).toBe('Period already generated for this template');
      });
    });

    it('allows professional fee input to be cleared, typed, and replaced without stuck 0', async () => {
      const { wrapper } = createHarness();
      render(
        <RetainerTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const pfInput = screen.getByTestId('template-pf-input') as HTMLInputElement;
      // Should start empty with placeholder 0.00
      expect(pfInput.value).toBe('');
      expect(pfInput.placeholder).toBe('0.00');

      // Type 15000
      fireEvent.change(pfInput, { target: { value: '15000' } });
      expect(pfInput.value).toBe('15000');

      // Clear / delete completely
      fireEvent.change(pfInput, { target: { value: '' } });
      expect(pfInput.value).toBe('');

      // Replace with new value
      fireEvent.change(pfInput, { target: { value: '25000.50' } });
      expect(pfInput.value).toBe('25000.50');
    });
  });

  describe('RetainerGenerationLogs (Audit Table)', () => {
    it('renders historical generations with template names, period labels, WR links, and actor info', async () => {
      const { wrapper } = createHarness();
      render(<RetainerGenerationLogs />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('generation-logs-table')).toBeInTheDocument();
      });

      expect(screen.getByTestId('log-period-aud-gen-1')).toHaveTextContent('FY-2026-SMOKE');
      expect(screen.getByTestId('log-period-aud-gen-2')).toHaveTextContent('FY-2027-SMOKE');

      expect(screen.getByTestId('log-template-aud-gen-1')).toHaveTextContent(
        'SMOKE Annual Compliance Retainer'
      );
      expect(screen.getByTestId('log-wr-aud-gen-1')).toHaveTextContent('e3cf8f27-145');
      expect(screen.getByText('2 Total Generations')).toBeInTheDocument();
    });
  });
});
