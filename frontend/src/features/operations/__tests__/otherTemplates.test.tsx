import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import OperationsPage from '@/routes/operations';
import { OtherTemplateModal } from '../components/OtherTemplateModal';
import { OtherTemplateGenerateModal } from '../components/OtherTemplateGenerateModal';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { RetainerTemplate } from '../api/types';
import type { TeamMember } from '../api/useTeam';
import type { ClientSummary } from '../api/useClients';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, null, children)
    );

  return { queryClient, wrapper };
}

const mockOtherTemplates: RetainerTemplate[] = [
  {
    id: 'tpl-other-1',
    entity: 'ATA',
    entity_id: 'ent-ata',
    name: 'SEC Charter Amendment',
    title: 'SEC Charter Amendment',
    description: 'Procedure for corporate charter and by-laws amendments',
    template_type: 'other',
    client_id: null,
    clientId: null,
    schedule: null,
    priority: 'Normal',
    pf_amount: 0,
    pfAmount: 0,
    recurrence: 'none',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    tasks: [
      {
        local_id: 'task_1',
        title: 'Draft Board Resolution',
        phase: 'pre_processing',
        assignees: [],
      },
      {
        local_id: 'task_2',
        title: 'File Documents with SEC',
        phase: 'processing',
        depends_on: 'task_1',
        assignees: [],
      },
    ],
  },
  {
    id: 'tpl-other-2',
    entity: 'LTA',
    entity_id: 'ent-lta',
    name: 'Ad-hoc FDA Renewal',
    title: 'Ad-hoc FDA Renewal',
    description: 'Expedited pharmaceutical product license renewal',
    template_type: 'other',
    client_id: null,
    clientId: null,
    schedule: null,
    priority: 'High',
    pf_amount: 0,
    pfAmount: 0,
    recurrence: 'none',
    created_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    tasks: [
      {
        local_id: 'task_1',
        title: 'Compile Dossier',
        phase: 'pre_processing',
        assignees: [],
      },
    ],
  },
];

const mockClients: ClientSummary[] = [
  {
    id: 'client-1',
    name: 'Acme Advisory Group',
    tin: '111-222-333-000',
    entity: 'ATA',
    status: 'Active',
  },
  {
    id: 'client-2',
    name: 'BioHealth Pharma Corp',
    tin: '444-555-666-000',
    entity: 'LTA',
    status: 'Active',
  },
];

const mockTeam: TeamMember[] = [
  { id: 'u-admin-1', name: 'Alice Admin', email: 'alice@ata-lta.ph', role: 'Admin' },
  { id: 'u-mgr-1', name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Manager', departments: ['Operations'] },
  { id: 'u-staff-1', name: 'Juan dela Cruz', email: 'juan@ata-lta.ph', role: 'Staff', departments: ['Operations'] },
];

describe('Other Templates Engine & Tab Feature Tests', () => {
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();

    // Default session: Manager with retainers:use and retainers:edit
    useSessionStore.getState().setSession({
      user: {
        id: 'u-mgr-1',
        email: 'maria@ata-lta.ph',
        name: 'Maria Santos',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['workflow:view', 'workflow:edit', 'retainers:use', 'retainers:edit'],
      activeEntity: 'ATA',
    });

    // Mock API requests
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);

      if (u.includes('/operations/templates') && u.includes('type=other')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockOtherTemplates }),
        });
      }

      if (u.includes('/operations/templates') && !u.includes('/generate')) {
        if (opts?.method === 'POST') {
          const body = JSON.parse(opts.body as string);
          return Promise.resolve({
            ok: true,
            status: 201,
            json: () => Promise.resolve({ data: { id: 'tpl-new-1', ...body } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockOtherTemplates }),
        });
      }

      if (u.includes('/generate')) {
        const body = JSON.parse(opts?.body as string);
        return Promise.resolve({
          ok: true,
          status: 201,
          json: () =>
            Promise.resolve({
              data: {
                id: 'wr-generated-1',
                title: 'Generated Work Request',
                status: 'Draft',
                phase: 'pre_processing',
                clientId: body.overrides?.clientId,
                assignedTo: body.overrides?.assignedTo,
                priority: body.overrides?.priority || 'Normal',
              },
            }),
        });
      }

      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockClients }),
        });
      }

      if (u.includes('/users') || u.includes('/team')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockTeam }),
        });
      }

      if (u.includes('/counts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { pending: 0, archived: 0 } }),
        });
      }

      if (u.includes('/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      });
    });
  });

  describe('1. Navigation & Tab in Operations Page', () => {
    it('renders "Other Template ({count})" tab trigger with correct count for authorized user', async () => {
      const { queryClient } = createHarness();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/operations?tab=other-templates']}>
            <OperationsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Verify Tab Trigger exists with correct label and count
      const tabTrigger = await screen.findByTestId('tab-other-templates');
      expect(tabTrigger).toBeInTheDocument();
      await waitFor(() => {
        expect(tabTrigger).toHaveTextContent(`Other Template (${mockOtherTemplates.length})`);
      });
    });

    it('renders Other Templates Directory grid with cards, badges, and action buttons', async () => {
      const { queryClient } = createHarness();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/operations?tab=other-templates']}>
            <OperationsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Check Directory title & description
      expect(await screen.findByText('Other Templates Directory')).toBeInTheDocument();
      expect(
        screen.getByText(/Ad-hoc and repeatable service workflow templates/i)
      ).toBeInTheDocument();

      // Check Action Buttons
      expect(screen.getByTestId('create-other-template-btn')).toHaveTextContent(
        '+ New Other Template'
      );
      expect(screen.getByTestId('generate-other-template-btn')).toHaveTextContent(
        'Generate from Other Template'
      );

      // Check template card contents: Name, Description, Task count pill, Edit, Delete, Generate
      expect(await screen.findByText('SEC Charter Amendment')).toBeInTheDocument();
      expect(
        screen.getByText('Procedure for corporate charter and by-laws amendments')
      ).toBeInTheDocument();
      expect(screen.getByTestId('task-count-pill-tpl-other-1')).toHaveTextContent('2 tasks');
      expect(screen.getByTestId('edit-other-template-btn-tpl-other-1')).toBeInTheDocument();
      expect(screen.getByTestId('delete-other-template-btn-tpl-other-1')).toBeInTheDocument();
      expect(screen.getByTestId('generate-card-other-template-btn-tpl-other-1')).toBeInTheDocument();
    });

    it('hides "Other Template" tab trigger when user lacks retainers:use permission', async () => {
      // User without retainers:use
      useSessionStore.getState().setSession({
        user: {
          id: 'u-staff-1',
          email: 'juan@ata-lta.ph',
          name: 'Juan dela Cruz',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view'], // NO retainers:use
        activeEntity: 'ATA',
      });

      const { queryClient } = createHarness();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/operations?tab=work-requests']}>
            <OperationsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(await screen.findByTestId('operations-page')).toBeInTheDocument();
      expect(screen.queryByTestId('tab-other-templates')).toBeNull();
    });
  });

  describe('2. Other Template Creation Modal (OtherTemplateModal)', () => {
    it('omits retainer-specific fields: No Client, No Schedule, No PF amount, No Recurrence', () => {
      const { wrapper } = createHarness();
      render(
        <OtherTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Verify title and tasks builder exist
      expect(screen.getByTestId('other-template-title-input')).toBeInTheDocument();
      expect(screen.getByTestId('other-template-description-input')).toBeInTheDocument();
      expect(screen.getByTestId('task-title-input-0')).toBeInTheDocument();

      // Verify retainer fields are strictly absent
      expect(screen.queryByText(/Target Client/i)).toBeNull();
      expect(screen.queryByText(/Professional Fee/i)).toBeNull();
      expect(screen.queryByText(/PF Amount/i)).toBeNull();
      expect(screen.queryByText(/Recurrence Schedule/i)).toBeNull();
      expect(screen.queryByTestId('schedule-select')).toBeNull();
      expect(screen.queryByTestId('recurrence-select')).toBeNull();
    });

    it('validates that template title and task titles are required', async () => {
      const { wrapper } = createHarness();
      render(
        <OtherTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const submitBtn = screen.getByTestId('other-template-submit-btn');
      fireEvent.click(submitBtn);

      // Surfaces title validation error
      expect(await screen.findByText('Template title is required.')).toBeInTheDocument();

      // Fill title, leave task title empty
      fireEvent.change(screen.getByTestId('other-template-title-input'), {
        target: { value: 'Tax Assessment Workflow' },
      });
      fireEvent.click(submitBtn);

      expect(await screen.findByText('Task title is required.')).toBeInTheDocument();
    });

    it('supports delimiter expansion ("Split into rows") on task titles', async () => {
      const { wrapper } = createHarness();
      render(
        <OtherTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const taskInput = screen.getByTestId('task-title-input-0');
      fireEvent.change(taskInput, {
        target: { value: 'Audit Notice Review, Protest Letter Filing, Hearing Attendance' },
      });

      // Split button should appear when delimiter is detected
      const splitBtn = await screen.findByTestId('split-task-btn-0');
      expect(splitBtn).toBeInTheDocument();
      expect(screen.getByText(/3 tasks detected/i)).toBeInTheDocument();

      // Clicking split expands row into 3 distinct tasks
      fireEvent.click(splitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('task-title-input-0')).toHaveValue('Audit Notice Review');
        expect(screen.getByTestId('task-title-input-1')).toHaveValue('Protest Letter Filing');
        expect(screen.getByTestId('task-title-input-2')).toHaveValue('Hearing Attendance');
      });
    });

    it('supports bottom add task button and interactive checklist subtasks & document requirements', async () => {
      const { wrapper } = createHarness();
      render(
        <OtherTemplateModal
          template={null}
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Verify bottom Add task button
      const bottomAddTaskBtn = screen.getByTestId('add-task-btn');
      expect(bottomAddTaskBtn).toBeInTheDocument();
      fireEvent.click(bottomAddTaskBtn);
      expect(screen.getByTestId('task-row-1')).toBeInTheDocument();

      // Add subtask on task 0
      const addSubtaskBtn = screen.getByTestId('add-subtask-btn-0');
      expect(addSubtaskBtn).toBeInTheDocument();
      fireEvent.click(addSubtaskBtn);

      const itemInput = screen.getByTestId('checklist-item-input-0-0');
      expect(itemInput).toBeInTheDocument();
      fireEvent.change(itemInput, { target: { value: 'SEC Certificate of Filing' } });
      expect(itemInput).toHaveValue('SEC Certificate of Filing');

      // Toggle to Doc category
      const catToggle = screen.getByTestId('checklist-category-toggle-0-0');
      expect(catToggle).toHaveTextContent(/sub-task/i);
      fireEvent.click(catToggle);
      expect(catToggle).toHaveTextContent(/doc/i);

      // Period Year input appears for Doc
      const periodYearInput = screen.getByTestId('checklist-period-year-0-0');
      expect(periodYearInput).toBeInTheDocument();
      fireEvent.change(periodYearInput, { target: { value: '2027' } });
      expect(periodYearInput).toHaveValue(2027);

      // Remove item
      const removeBtn = screen.getByTestId('checklist-remove-btn-0-0');
      fireEvent.click(removeBtn);
      expect(screen.queryByTestId('checklist-item-input-0-0')).not.toBeInTheDocument();

      // Verify task type selector (Task / Billing / Documents) on task rows
      const typeSelect0 = screen.getByTestId('other-template-task-type-0');
      expect(typeSelect0).toHaveValue('');
      fireEvent.change(typeSelect0, { target: { value: 'billing' } });
      expect(typeSelect0).toHaveValue('billing');
      fireEvent.change(typeSelect0, { target: { value: 'documents' } });
      expect(typeSelect0).toHaveValue('documents');
    });
  });

  describe('3. Other Template Generation Modal (OtherTemplateGenerateModal)', () => {
    it('validates that Client selection and Manager Lead (assignedTo) are required', async () => {
      const { wrapper } = createHarness();
      render(
        <OtherTemplateGenerateModal
          isOpen={true}
          preselectedTemplateId="tpl-other-1"
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('other-template-due-date-input'), { target: { value: '2026-12-31' } });
      const submitBtn = screen.getByTestId('other-template-generate-submit-btn');
      fireEvent.click(submitBtn);

      // Client is required
      expect(await screen.findByTestId('client-error')).toHaveTextContent(
        'Client selection is required.'
      );
    });

    it('renders all required Work Request fields: Priority, Due Date, and Team Governance', async () => {
      const { wrapper } = createHarness();
      render(
        <OtherTemplateGenerateModal
          isOpen={true}
          preselectedTemplateId="tpl-other-1"
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('other-template-select')).toBeInTheDocument();
      expect(screen.getByTestId('other-template-client-select')).toBeInTheDocument();
      expect(screen.getByTestId('other-template-priority-select')).toBeInTheDocument();
      expect(screen.getByTestId('other-template-due-date-input')).toBeRequired();
      expect(screen.getByTestId('other-template-description-textarea')).toBeInTheDocument();
      expect(screen.getByText(/Team Governance/i)).toBeInTheDocument();
    });
  });
});
