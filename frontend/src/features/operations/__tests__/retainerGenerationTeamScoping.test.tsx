import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RetainerGenerateModal } from '../components/RetainerGenerateModal';
import { RetainerTemplateModal } from '../components/RetainerTemplateModal';
import { TaskLineItems } from '../components/TaskLineItems';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import { TABLE_QUERY_KEY_MAP } from '@/lib/realtime';
import { handleIncomingTabSyncMessage } from '@/lib/tabSync';
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
    localStorage.clear();
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
      permissions: ['retainers:use', 'retainers:edit'],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method?.toUpperCase() || 'GET';
      if (u.includes('/operations/templates') && !u.includes('/generate')) {
        return Promise.resolve({
          ok: true,
          status: method === 'POST' ? 201 : 200,
          json: async () => ({
            data: method === 'POST' || method === 'PUT' ? mockTemplate : [mockTemplate],
          }),
        } as Response);
      }
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'c-1', name: 'Acme Philippines Corp', entity: 'ATA' },
              { id: 'c-2', name: 'LTA Holdings Corp', entity: 'LTA' },
            ],
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
      if (u.includes('/admin/users')) {
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
    localStorage.clear();
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

  describe('Retainer Template Modal Parity, Entity Scoping & Draft Retention', () => {
    it('shows Operating Entity toggle when activeEntity is ALL and allows switching to LTA', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'alice@ata-lta.ph',
        name: 'Alice Admin',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['retainers:edit', 'retainers:use'],
      activeEntity: 'ALL',
    });

    const { wrapper } = createHarness();
    render(<RetainerTemplateModal isOpen={true} template={null} onClose={vi.fn()} />, { wrapper });

    expect(screen.getByTestId('retainer-template-entity-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('retainer-template-entity-ata')).toBeInTheDocument();
    expect(screen.getByTestId('retainer-template-entity-lta')).toBeInTheDocument();

    // Switch to LTA
    fireEvent.click(screen.getByTestId('retainer-template-entity-lta'));

    // Fill form and submit
    fireEvent.change(screen.getByTestId('template-name-input'), {
      target: { value: 'LTA Retainer Template' },
    });
    fireEvent.change(screen.getByTestId('task-title-input-0'), {
      target: { value: 'LTA Phase 1 Review' },
    });

    fireEvent.click(screen.getByTestId('template-modal-submit-btn'));

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const tplPost = calls.find(
        (c) => String(c[0]).includes('/operations/templates') && c[1]?.method === 'POST'
      );
      expect(tplPost).toBeDefined();
      const body = JSON.parse(String(tplPost![1]?.body));
      expect(body.entity).toBe('LTA');
      expect(body.name).toBe('LTA Retainer Template');
    });
  });

  it('hides Operating Entity toggle when activeEntity is LTA and defaults entity to LTA', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-mgr-1',
        email: 'maria@ata-lta.ph',
        name: 'Maria Santos',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['LTA'],
      },
      permissions: ['retainers:edit', 'retainers:use'],
      activeEntity: 'LTA',
    });

    const { wrapper } = createHarness();
    render(<RetainerTemplateModal isOpen={true} template={null} onClose={vi.fn()} />, { wrapper });

    expect(screen.queryByTestId('retainer-template-entity-toggle')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('template-name-input'), {
      target: { value: 'Scoped LTA Template' },
    });
    fireEvent.change(screen.getByTestId('task-title-input-0'), {
      target: { value: 'Scoped LTA Task' },
    });

    fireEvent.click(screen.getByTestId('template-modal-submit-btn'));

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const tplPost = calls.find(
        (c) => String(c[0]).includes('/operations/templates') && c[1]?.method === 'POST'
      );
      expect(tplPost).toBeDefined();
      const body = JSON.parse(String(tplPost![1]?.body));
      expect(body.entity).toBe('LTA');
    });
  });

  it('renders checklist completion checkbox, toggles completed state and submits completed: true', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'alice@ata-lta.ph',
        name: 'Alice Admin',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['retainers:edit'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createHarness();
    render(<RetainerTemplateModal isOpen={true} template={null} onClose={vi.fn()} />, { wrapper });

    // Add subtask
    fireEvent.click(screen.getByTestId('add-subtask-btn-0'));

    const checkbox = screen.getByTestId('template-checklist-checkbox-0-0');
    expect(checkbox).toBeInTheDocument();
    expect((checkbox as HTMLInputElement).checked).toBe(false);

    const textInput = screen.getByTestId('checklist-item-input-0-0');
    expect(textInput.className).toContain('text-[#0F172A]');
    expect(textInput.className).not.toContain('line-through');

    // Toggle checkbox
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    expect(textInput.className).toContain('line-through');

    fireEvent.change(textInput, { target: { value: 'Submit SEC Annex' } });
    fireEvent.change(screen.getByTestId('template-name-input'), {
      target: { value: 'Checklist Parity Template' },
    });
    fireEvent.change(screen.getByTestId('task-title-input-0'), {
      target: { value: 'Compliance Task' },
    });

    fireEvent.click(screen.getByTestId('template-modal-submit-btn'));

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const tplPost = calls.find(
        (c) => String(c[0]).includes('/operations/templates') && c[1]?.method === 'POST'
      );
      expect(tplPost).toBeDefined();
      const body = JSON.parse(String(tplPost![1]?.body));
      expect(body.tasks[0].checklist[0].completed).toBe(true);
      expect(body.tasks[0].checklist[0].text).toBe('Submit SEC Annex');
    });
  });

  it('saves draft to localStorage, displays draft-restore-banner on reopen, restores and discards draft', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'alice@ata-lta.ph',
        name: 'Alice Admin',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['retainers:edit'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createHarness();
    const { unmount } = render(
      <RetainerTemplateModal isOpen={true} template={null} onClose={vi.fn()} />,
      { wrapper }
    );

    // Enter name to create dirty state
    fireEvent.change(screen.getByTestId('template-name-input'), {
      target: { value: 'Draft Retainer Persistence Test' },
    });

    // Wait for 1000ms debounce
    await waitFor(
      () => {
        const stored = localStorage.getItem(`erp_retainer_template_draft_new:${useSessionStore.getState().user?.id}`);
        expect(stored).not.toBeNull();
        expect(stored).toContain('Draft Retainer Persistence Test');
      },
      { timeout: 2500 }
    );

    // Unmount modal
    unmount();

    // Reopen modal: draft-restore-banner should be visible
    const { unmount: unmount2 } = render(
      <RetainerTemplateModal isOpen={true} template={null} onClose={vi.fn()} />,
      { wrapper }
    );

    expect(screen.getByTestId('draft-restore-banner')).toBeInTheDocument();
    expect(screen.getByTestId('restore-draft-btn')).toBeInTheDocument();
    expect(screen.getByTestId('discard-draft-btn')).toBeInTheDocument();

    // Click Restore
    fireEvent.click(screen.getByTestId('restore-draft-btn'));
    expect(screen.getByTestId('template-name-input')).toHaveValue('Draft Retainer Persistence Test');
    expect(screen.queryByTestId('draft-restore-banner')).not.toBeInTheDocument();

    unmount2();

    // Reopen and test Discard
    render(<RetainerTemplateModal isOpen={true} template={null} onClose={vi.fn()} />, { wrapper });

    expect(screen.getByTestId('draft-restore-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('discard-draft-btn'));
    expect(screen.queryByTestId('draft-restore-banner')).not.toBeInTheDocument();
    expect(localStorage.getItem(`erp_retainer_template_draft_new:${useSessionStore.getState().user?.id}`)).toBeNull();
    expect(screen.getByTestId('template-name-input')).toHaveValue('');
  });

  it('immediately clears unmapped assignee alert and blocker error when unmapped user is added to Team Governance in RetainerGenerateModal', async () => {
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

    const { wrapper } = createHarness();
    render(<RetainerGenerateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('template-select')).not.toBeDisabled();
    });

    // 1. Select template
    await openAndSelect(screen.getByTestId('template-select'), /Annual Corporate Retainer/);

    // 2. Select Manager
    await openAndSelect(screen.getByTestId('assigner-primary-select'), /Maria Santos/);

    // 3. Set Due Date
    fireEvent.change(screen.getByTestId('due-date-input'), { target: { value: '2026-12-31' } });

    // Task 1 alert is currently present (Carlos Reyes is unmapped)
    expect(screen.getByTestId('unmapped-assignee-alert-task_1')).toBeInTheDocument();

    // Attempt generate: should trigger assignee blocker error
    fireEvent.click(screen.getByTestId('generate-submit-btn'));
    expect(screen.getByTestId('generate-error')).toHaveTextContent(
      'All task assignees must belong to the selected project team. Please update unmapped assignees.'
    );

    // 4. Add Carlos Reyes to Co-Assignees in Team Governance
    await openAndSelect(screen.getByTestId('assigner-coassignee-select'), /Carlos Reyes/);

    // Alert should immediately disappear and error should automatically clear
    await waitFor(() => {
      expect(screen.queryByTestId('unmapped-assignee-alert-task_1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('generate-error')).not.toBeInTheDocument();
    });

    // 5. Submit should now succeed without blocker
    fireEvent.click(screen.getByTestId('generate-submit-btn'));

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const genCall = calls.find((c) => String(c[0]).includes('/generate'));
      expect(genCall).toBeDefined();
    });
  });

  it('supports drag-and-drop task reordering in RetainerTemplateModal and sanitizes invalidated dependencies', async () => {
    const templateWithTwoTasks: RetainerTemplate = {
      ...mockTemplate,
      tasks: [
        {
          local_id: 'task_1',
          title: 'First Prerequisite Task',
          phase: 'pre_processing',
          assignees: [],
        },
        {
          local_id: 'task_2',
          title: 'Second Dependent Task',
          phase: 'processing',
          depends_on_local_id: 'task_1',
          assignees: [],
        },
      ],
    };

    const { wrapper } = createHarness();
    render(
      <RetainerTemplateModal isOpen={true} template={templateWithTwoTasks} onClose={vi.fn()} />,
      { wrapper }
    );

    // Verify drag handles exist on both tasks
    const handle0 = screen.getByTestId('task-drag-handle-0');
    const handle1 = screen.getByTestId('task-drag-handle-1');
    expect(handle0).toBeInTheDocument();
    expect(handle1).toBeInTheDocument();

    // Verify initial titles and dependency
    expect(screen.getByTestId('task-title-input-0')).toHaveValue('First Prerequisite Task');
    expect(screen.getByTestId('task-title-input-1')).toHaveValue('Second Dependent Task');
    expect(screen.getByTestId('task-depends-select-1')).toHaveTextContent('First Prerequisite Task');

    // Drag Task 2 (index 1) onto Task 1 (index 0)
    const row0 = screen.getByTestId('task-row-0');

    fireEvent.dragStart(handle1, { dataTransfer: { setData: vi.fn(), getData: () => '1' } });
    fireEvent.dragOver(row0);
    fireEvent.drop(row0, { dataTransfer: { getData: () => '1' } });

    // After drop: Task 2 is now at index 0, Task 1 is at index 1
    await waitFor(() => {
      expect(screen.getByTestId('task-title-input-0')).toHaveValue('Second Dependent Task');
      expect(screen.getByTestId('task-title-input-1')).toHaveValue('First Prerequisite Task');
    });

    // Dependency of Task 2 on Task 1 should have been automatically cleared (since Task 1 is now after Task 2)
    expect(screen.getByTestId('task-depends-select-0')).toHaveTextContent('None (Can start immediately)');
  });

  it('supports drag-and-drop task reordering in TaskLineItems and cleans wildcard dependencies on index 0', async () => {
    const onChangeSpy = vi.fn();
    const initialTasks = [
      {
        localId: 'task-line-1',
        title: 'Task A',
        phase: 'pre_processing' as const,
        coAssignees: [],
        dependsOn: null,
      },
      {
        localId: 'task-line-2',
        title: 'Task B',
        phase: 'processing' as const,
        coAssignees: [],
        dependsOn: ['*'], // depends on all preceding
      },
    ];

    render(
      <TaskLineItems
        tasks={initialTasks}
        onChange={onChangeSpy}
        projectTeam={mockTeam}
      />
    );

    const handle0 = screen.getByTestId('task-drag-handle-0');
    const handle1 = screen.getByTestId('task-drag-handle-1');
    expect(handle0).toBeInTheDocument();
    expect(handle1).toBeInTheDocument();

    const row0 = screen.getByTestId('task-row-task-line-1');

    // Drag Task B (index 1) onto Task A (index 0)
    fireEvent.dragStart(handle1, { dataTransfer: { setData: vi.fn(), getData: () => '1' } });
    fireEvent.dragOver(row0);
    fireEvent.drop(row0, { dataTransfer: { getData: () => '1' } });

    expect(onChangeSpy).toHaveBeenCalled();
    const reorderedTasks = onChangeSpy.mock.calls[0]![0];
    expect(reorderedTasks[0].localId).toBe('task-line-2');
    expect(reorderedTasks[1].localId).toBe('task-line-1');
    // Task B moved to index 0, so '*' was removed from dependsOn
    expect(reorderedTasks[0].dependsOn).toBeNull();
  });

  it('co-invalidates [me, team] in TABLE_QUERY_KEY_MAP and on cross-tab admin mutations', async () => {
    // 1. TABLE_QUERY_KEY_MAP mapping includes ['me', 'team']
    expect(TABLE_QUERY_KEY_MAP.users).toContainEqual(['me', 'team']);
    expect(TABLE_QUERY_KEY_MAP.user_departments).toContainEqual(['me', 'team']);

    // 2. Tab sync cross-tab invalidation
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    handleIncomingTabSyncMessage(queryClient, {
      type: 'ENTITY_MUTATED',
      domain: 'admin',
      entityId: 'u-1',
      originTabId: 'tab-other',
      timestamp: Date.now(),
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['me', 'team'] })
    );
  });
});
});
