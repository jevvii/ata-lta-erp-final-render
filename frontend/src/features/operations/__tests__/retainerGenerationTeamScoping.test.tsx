import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RetainerGenerateModal } from '../components/RetainerGenerateModal';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { RetainerTemplate } from '../api/types';
import type { TeamMember } from '../api/useTeam';

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

const mockTeam: TeamMember[] = [
  { id: 'u-admin-1', name: 'Alice Admin', email: 'alice@ata-lta.ph', role: 'Admin' },
  { id: 'u-mgr-1', name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Manager', departments: ['Operations'] },
  { id: 'u-staff-1', name: 'Juan dela Cruz', email: 'juan@ata-lta.ph', role: 'Staff' },
  { id: 'u-staff-2', name: 'Carlos Reyes', email: 'carlos@ata-lta.ph', role: 'Staff' },
];

const mockTemplate: RetainerTemplate = {
  id: 'tpl-1',
  entity: 'ATA',
  entity_id: 'ent-ata',
  name: 'Annual Corporate Retainer',
  description: 'Annual statutory filings',
  clientId: 'c-1',
  client_id: 'c-1',
  priority: 'Normal',
  schedule: 'Annual',
  pf_amount: 50000,
  pfAmount: 50000,
  recurrence: 'annual',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  tasks: [
    {
      local_id: 'task_1',
      title: 'Collect Trial Balance',
      phase: 'pre_processing',
      default_assignees: ['u-staff-2'],
      assignees: ['u-staff-2'], // Carlos is unmapped initially
    },
    {
      local_id: 'task_2',
      title: 'Prepare Tax Returns',
      phase: 'processing',
      depends_on: 'task_1',
      assignees: [],
    },
  ],
};

async function openAndSelect(trigger: HTMLElement, optionMatcher: string | RegExp) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' });
  const option = await screen.findByRole('option', { name: optionMatcher });
  fireEvent.click(option);
}

describe('Retainer Template Generation & Team Scoping Parity (Requirement R2)', () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-mgr-1',
        email: 'maria@ata-lta.ph',
        name: 'Maria Santos',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['retainers:use'],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/operations/templates') && !u.includes('/generate')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [mockTemplate] }),
        } as Response);
      }
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'c-1', name: 'Acme Philippines Corp', entity: 'ATA' }],
          }),
        } as Response);
      }
      if (u.includes('/me/team')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockTeam }),
        } as Response);
      }
      if (u.includes('/generate')) {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({ data: { id: 'wr-gen-1', title: 'Generated WR' } }),
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

  it('mounts AssignerSelect with managerOnlyPrimary={true}', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('assigner-primary-select')).toBeInTheDocument();
    });

    expect(screen.getByText('Manager *')).toBeInTheDocument();
  });

  it('blocks submission when Manager Lead is unassigned', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    // Select template
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);

    // Attempt generate without manager
    const submitBtn = screen.getByTestId('generate-submit-btn');
    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });
    fireEvent.change(screen.getByTestId('due-date-input'), { target: { value: '2026-12-31' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('generate-error')).toHaveTextContent(
        'Manager is required to generate work requests.'
      );
    });
  });

  it('requires a due date before generating work requests', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('template-select')).not.toBeDisabled());
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);
    await openAndSelect(screen.getByTestId('assigner-primary-select'), /Maria Santos/);
    fireEvent.submit(screen.getByTestId('due-date-input').closest('form')!);
    expect(await screen.findByTestId('generate-error')).toHaveTextContent('Due date is required');
    expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('/generate'))).toBe(false);
  });

  it('strictly scopes task assignee dropdowns to projectTeam', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    // Select template
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);

    // Verify task blueprint preview rendered
    await waitFor(() => {
      expect(screen.getByTestId('blueprint-task-task_1')).toBeInTheDocument();
    });

    // Initially Carlos is in task_1 but not in projectTeam -> alert badge is rendered
    expect(screen.getByTestId('unmapped-assignee-alert-task_1')).toBeInTheDocument();

    // Select Manager (Maria Santos)
    await openAndSelect(screen.getByTestId('assigner-primary-select'), /Maria Santos/);

    // Open task_2 assignee selector
    const task2Select = screen.getByTestId('task-assignee-select-task_2');
    fireEvent.pointerDown(task2Select, { button: 0, ctrlKey: false });
    fireEvent.keyDown(task2Select, { key: 'ArrowDown', code: 'ArrowDown' });

    // Maria is present because she is in projectTeam
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Maria Santos/ })).toBeInTheDocument();
    });
    // Unassigned staff (e.g. Juan) is not present because Juan is not yet in coAssignees
    expect(screen.queryByRole('option', { name: /Juan dela Cruz/ })).not.toBeInTheDocument();
  });

  it('blocks submission when unmapped assignees remain outside projectTeam', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    // Select template
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);

    // Select Manager (Maria Santos) but DO NOT add Carlos to co-assignees
    await openAndSelect(screen.getByTestId('assigner-primary-select'), /Maria Santos/);

    // Task 1 still has Carlos (unmapped)
    const submitBtn = screen.getByTestId('generate-submit-btn');
    fireEvent.change(screen.getByTestId('due-date-input'), { target: { value: '2026-12-31' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('generate-error')).toHaveTextContent(
        'All task assignees must belong to the selected project team. Please update unmapped assignees.'
      );
    });
  });

  it('sends structured overrides payload on valid submission', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    // 1. Select template
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);

    // 2. Select Manager
    await openAndSelect(screen.getByTestId('assigner-primary-select'), /Maria Santos/);

    // 3. Add Co-assignee Carlos (resolving unmapped alert)
    const coSelect = screen.getByTestId('assigner-coassignee-select');
    await openAndSelect(coSelect, /Carlos Reyes/);

    // Verify alert cleared
    await waitFor(() => {
      expect(
        screen.queryByTestId('unmapped-assignee-alert-task_1')
      ).not.toBeInTheDocument();
    });

    // 4. Submit
    const submitBtn = screen.getByTestId('generate-submit-btn');
    fireEvent.change(screen.getByTestId('due-date-input'), { target: { value: '2026-12-31' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const genCall = calls.find((c) => String(c[0]).includes('/generate'));
      expect(genCall).toBeDefined();

      const body = JSON.parse(String(genCall![1]?.body));
      expect(body.period_label).toBe(String(new Date().getFullYear()));
      expect(body.overrides.assignedTo).toBe('u-mgr-1');
      expect(body.overrides.coAssignees).toEqual(['u-staff-2']);
      expect(body.overrides.tasks).toHaveLength(2);
      expect(body.overrides.tasks[0].local_id).toBe('task_1');
      expect(body.overrides.tasks[0].assignees).toEqual(['u-staff-2']);
    });
  });

  it('allows task re-assignment directly from task dropdown to clear unmapped warning', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    // 1. Select template
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);

    // 2. Select Manager
    await openAndSelect(screen.getByTestId('assigner-primary-select'), /Maria Santos/);

    // Task 1 alert is currently present
    expect(screen.getByTestId('unmapped-assignee-alert-task_1')).toBeInTheDocument();

    // 3. Reassign Task 1 to Maria Santos directly
    const task1Select = screen.getByTestId('task-assignee-select-task_1');
    await openAndSelect(task1Select, /Maria Santos/);

    // Alert should now be cleared
    await waitFor(() => {
      expect(
        screen.queryByTestId('unmapped-assignee-alert-task_1')
      ).not.toBeInTheDocument();
    });

    // 4. Submit
    const submitBtn = screen.getByTestId('generate-submit-btn');
    fireEvent.change(screen.getByTestId('due-date-input'), { target: { value: '2026-12-31' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const genCall = calls.find((c) => String(c[0]).includes('/generate'));
      expect(genCall).toBeDefined();

      const body = JSON.parse(String(genCall![1]?.body));
      expect(body.overrides.assignedTo).toBe('u-mgr-1');
      expect(body.overrides.tasks[0].assignees).toEqual(['u-mgr-1']);
    });
  });

  it('blocks submission when period label is missing for annual template', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    // 1. Select template
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);

    // 2. Select Manager
    await openAndSelect(screen.getByTestId('assigner-primary-select'), /Maria Santos/);

    // Clear period label
    const periodInput = screen.getByTestId('period-label-input');
    fireEvent.change(periodInput, { target: { value: '   ' } });

    // Submit
    const submitBtn = screen.getByTestId('generate-submit-btn');
    fireEvent.change(screen.getByTestId('due-date-input'), { target: { value: '2026-12-31' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('generate-error')).toHaveTextContent(
        'Period label is required for annual recurring templates.'
      );
    });
  });

  it('includes dueDate, priority, and client overrides in submission payload', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    // 1. Select template
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);

    // 2. Select Manager
    await openAndSelect(screen.getByTestId('assigner-primary-select'), /Maria Santos/);

    // 3. Add Carlos to team
    const coSelect = screen.getByTestId('assigner-coassignee-select');
    await openAndSelect(coSelect, /Carlos Reyes/);

    // 4. Set Due Date
    const dueDateInput = screen.getByTestId('due-date-input');
    fireEvent.change(dueDateInput, { target: { value: '2026-12-31' } });

    // 5. Change Priority to High
    const prioritySelect = screen.getByTestId('priority-select');
    await openAndSelect(prioritySelect, 'High');

    // Submit
    const submitBtn = screen.getByTestId('generate-submit-btn');
    fireEvent.change(screen.getByTestId('due-date-input'), { target: { value: '2026-12-31' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const genCall = calls.find((c) => String(c[0]).includes('/generate'));
      expect(genCall).toBeDefined();

      const body = JSON.parse(String(genCall![1]?.body));
      expect(body.overrides.dueDate).toBe('2026-12-31');
      expect(body.overrides.priority).toBe('High');
      expect(body.overrides.clientId).toBe('c-1');
    });
  });

  it('allows resetting an unmapped task directly to Unassigned to clear unmapped warning', async () => {
    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    // 1. Select template
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);

    // 2. Select Manager
    await openAndSelect(screen.getByTestId('assigner-primary-select'), /Maria Santos/);

    // Task 1 alert is currently present
    expect(screen.getByTestId('unmapped-assignee-alert-task_1')).toBeInTheDocument();

    // 3. Select '— Unassigned —' on Task 1
    const task1Select = screen.getByTestId('task-assignee-select-task_1');
    await openAndSelect(task1Select, /— Unassigned —/);

    // Alert should now be cleared
    await waitFor(() => {
      expect(screen.queryByTestId('unmapped-assignee-alert-task_1')).not.toBeInTheDocument();
    });

    // 4. Submit
    const submitBtn = screen.getByTestId('generate-submit-btn');
    fireEvent.change(screen.getByTestId('due-date-input'), { target: { value: '2026-12-31' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const genCall = calls.find((c) => String(c[0]).includes('/generate'));
      expect(genCall).toBeDefined();

      const body = JSON.parse(String(genCall![1]?.body));
      expect(body.overrides.assignedTo).toBe('u-mgr-1');
      expect(body.overrides.tasks[0].assignees).toEqual([]);
    });
  });

  it('renders clean template title without raw entity or template IDs', async () => {
    const rawUuidTemplate: RetainerTemplate = {
      ...mockTemplate,
      id: 'tpl-raw-uuid-test',
      entity: undefined,
      entity_id: 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822',
      name: 'Clean Annual Compliance',
      recurrence: 'annual',
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/operations/templates') && !u.includes('/generate')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [rawUuidTemplate] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });

    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    const trigger = screen.getByTestId('template-select');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' });

    // Should resolve to ATA and not display raw UUID
    expect(
      await screen.findByRole('option', {
        name: 'Clean Annual Compliance (ATA • annual)',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/e83dc90b/i)).not.toBeInTheDocument();
  });
});
