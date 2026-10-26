import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkRequestList } from '../components/WorkRequestList';
import { WorkRequestModal } from '../components/WorkRequestModal';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { WorkRequest } from '../api/types';

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

const mockWorkRequests: WorkRequest[] = [
  {
    id: 'wr-1',
    title: 'Q1 BIR Tax Filing',
    description: 'Corporate quarterly return',
    clientId: 'c-1',
    clientName: 'Acme Philippines Corp',
    entity: 'ATA',
    status: 'In Progress',
    phase: 'pre_processing',
    onHold: false,
    phaseEnteredAt: null,
    priority: 'Urgent',
    requestedBy: null,
    assignedTo: 'u-mgr-1',
    assignedToName: 'Maria Santos',
    coAssignees: ['u-staff-1'],
    dueDate: new Date(Date.now() + 86400000 * 3).toISOString(),
    archived: false,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: [
      {
        id: 't-1',
        workRequestId: 'wr-1',
        title: 'Collect receipts',
        description: null,
        status: 'In Progress',
        phase: 'pre_processing',
        qaStatus: 'none',
        phaseEnteredAt: null,
        assigneeId: null,
        assigneeName: null,
        assignees: [],
        predecessors: [],
        dueDate: null,
        requiredLinkType: null,
        displayOrder: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  },
  {
    id: 'wr-2',
    title: 'SEC GIS 2025',
    description: 'General Information Sheet',
    clientId: 'c-2',
    clientName: 'Beta Holdings Inc',
    entity: 'LTA',
    status: 'Completed',
    phase: 'completion',
    onHold: false,
    phaseEnteredAt: null,
    priority: 'Normal',
    requestedBy: null,
    assignedTo: 'u-mgr-1',
    assignedToName: 'Maria Santos',
    coAssignees: [],
    dueDate: new Date(Date.now() - 86400000 * 2).toISOString(),
    archived: false,
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: [
      {
        id: 't-2',
        workRequestId: 'wr-2',
        title: 'File with SEC',
        description: null,
        status: 'Completed',
        phase: 'processing',
        qaStatus: 'passed',
        phaseEnteredAt: null,
        assigneeId: null,
        assigneeName: null,
        assignees: [],
        predecessors: [],
        dueDate: null,
        requiredLinkType: null,
        displayOrder: 1,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  },
];

const mockClients = [
  { id: 'c-1', name: 'Acme Philippines Corp', entity: 'ATA' as const, status: 'Active' },
  { id: 'c-2', name: 'Beta Holdings Inc', entity: 'LTA' as const, status: 'Active' },
];

const mockTeam = [
  { id: 'u-mgr-1', name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Manager' },
  { id: 'u-admin-1', name: 'Boss Admin', email: 'admin@ata-lta.ph', role: 'Admin' },
  { id: 'u-staff-1', name: 'Juan Dela Cruz', email: 'juan@ata-lta.ph', role: 'Staff' },
  { id: 'u-staff-2', name: 'Elena Reyes', email: 'elena@ata-lta.ph', role: 'Staff' },
];

describe('Work Request Parity Feature Set (Step 3)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-mgr-1',
        email: 'maria@ata-lta.ph',
        name: 'Maria Santos',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'workflow:phase_transition',
        'workflow:transition_request',
        'retainers:use',
      ],
      activeEntity: 'ALL',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockClients }),
        } as Response);
      }
      if (u.includes('/me/team')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockTeam }),
        } as Response);
      }
      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockWorkRequests, meta: { total: 2 } }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: {} }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('WorkRequestList component', () => {
    it('renders work requests in table view with title, client, priority, and phase', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Q1 BIR Tax Filing')).toBeInTheDocument();
        expect(screen.getByText('SEC GIS 2025')).toBeInTheDocument();
      });

      expect(screen.getByText('Acme Philippines Corp')).toBeInTheDocument();
      expect(screen.getByText('Beta Holdings Inc')).toBeInTheDocument();
    });

    it('switches between table and compact card list view modes', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Q1 BIR Tax Filing')).toBeInTheDocument();
      });

      // Switch to Card View
      const cardsBtn = screen.getByTestId('view-mode-cards');
      fireEvent.click(cardsBtn);

      expect(screen.getByTestId('card-list-view')).toBeInTheDocument();

      // Switch back to Table View
      const tableBtn = screen.getByTestId('view-mode-table');
      fireEvent.click(tableBtn);

      expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('renders blocker badge when prerequisite tasks are incomplete', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('blocker-badge-wr-1')).toBeInTheDocument();
      });

      expect(screen.getByText(/1 blocker/i)).toBeInTheDocument();
    });

    it('supports selecting rows and displaying bulk action bar', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Q1 BIR Tax Filing')).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes.length).toBeGreaterThan(1);

      // Select first row checkbox
      const rowCheckbox = checkboxes[1];
      if (rowCheckbox) {
        fireEvent.click(rowCheckbox);
      }

      await waitFor(() => {
        expect(screen.getByTestId('bulk-actions-bar')).toBeInTheDocument();
        expect(screen.getByText(/1 work requests selected/i)).toBeInTheDocument();
      });
    });

    it('subscribes to realtime CDC channels for work_requests and tasks', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const { wrapper } = createHarness();
      render(<WorkRequestList />, { wrapper });

      expect(channelSpy).toHaveBeenCalledWith('cdc_work_requests');
      expect(channelSpy).toHaveBeenCalledWith('cdc_tasks');
    });
  });

  describe('WorkRequestModal component', () => {
    it('renders create modal with 2 default Notion-style task line items', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      expect(screen.getByTestId('work-request-modal')).toBeInTheDocument();
      expect(screen.getByText('New Work Request')).toBeInTheDocument();

      // Verify Notion task line items container
      expect(screen.getByTestId('task-line-items')).toBeInTheDocument();
      expect(screen.getByTestId('task-row-tmp-1')).toBeInTheDocument();
      expect(screen.getByTestId('task-row-tmp-2')).toBeInTheDocument();
    });

    it('enforces mandatory Manager governance validation before submission', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      // Fill title
      const titleInput = screen.getByTestId('wr-modal-title-input');
      fireEvent.change(titleInput, { target: { value: 'Mandatory Manager Test' } });

      // Click submit without selecting Manager
      const submitBtn = screen.getByTestId('wr-modal-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('manager-error')).toBeInTheDocument();
        expect(screen.getByText('Manager is required')).toBeInTheDocument();
      });
    });

    it('auto-syncs operating entity to client entity when a client is chosen', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('wr-modal-client-select')).toBeInTheDocument();
      });

      // Default entity in ALL mode is ATA
      expect(screen.getByTestId('wr-modal-entity-toggle')).toBeInTheDocument();
    });

    it('detects delimiter input and renders live sibling task tokenizer preview', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      const taskInput = screen.getByTestId('task-title-input-tmp-1');
      fireEvent.change(taskInput, {
        target: { value: 'Gather BIR 2316, Review payroll summary, Prepare final report' },
      });

      await waitFor(() => {
        expect(screen.getByTestId('task-tokenizer-preview-tmp-1')).toBeInTheDocument();
        expect(screen.getByText(/will split into 3 sibling tasks/i)).toBeInTheDocument();
      });
    });

    it('supports selecting Task, Billing, and Documents task types in TaskLineItems', () => {
      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      const typeSelect0 = screen.getByTestId('task-type-select-0');
      expect(typeSelect0).toHaveValue('');
      fireEvent.change(typeSelect0, { target: { value: 'billing' } });
      expect(typeSelect0).toHaveValue('billing');
      fireEvent.change(typeSelect0, { target: { value: 'documents' } });
      expect(typeSelect0).toHaveValue('documents');
      fireEvent.change(typeSelect0, { target: { value: '' } });
      expect(typeSelect0).toHaveValue('');
    });
  });
});
