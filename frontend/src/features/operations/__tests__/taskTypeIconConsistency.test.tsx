import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskTypeBadge, getTaskTypeMeta, normalizeTaskTypeValue } from '../lib/taskTypes';
import { PhaseKanbanBoard } from '../components/PhaseKanbanBoard';
import { WorkRequestSidePeek } from '../components/WorkRequestSidePeek';
import { PendingApprovalsInbox } from '../components/PendingApprovalsInbox';
import { useSessionStore } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import type { WorkRequest, Task } from '../api/types';

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

describe('Task Type Icon Consistency', () => {
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(async () => {
    await supabase.removeAllChannels();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin Test',
        role: 'Admin',
        departments: ['Operations', 'Management'],
        entities: ['ALL'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'workflow:phase_transition',
        'workflow:transition_request',
        'workflow:qa_review',
        'workflow:task_add',
        'workflow:approve',
      ],
      activeEntity: 'ALL',
    });
  });

  describe('0. getTaskTypeMeta & normalizeTaskTypeValue metadata mapping', () => {
    it('normalizes task type values as canonical types', () => {
      expect(normalizeTaskTypeValue(null)).toBe('');
      expect(normalizeTaskTypeValue('')).toBe('');
      expect(normalizeTaskTypeValue('task')).toBe('');
      expect(normalizeTaskTypeValue('standard')).toBe('');
      expect(normalizeTaskTypeValue('billing')).toBe('billing');
      expect(normalizeTaskTypeValue('invoice')).toBe('billing');
      expect(normalizeTaskTypeValue('documents')).toBe('documents');
      expect(normalizeTaskTypeValue('document')).toBe('documents');
      expect(normalizeTaskTypeValue('disbursement')).toBe('');
      expect(normalizeTaskTypeValue('transmittal')).toBe('');
    });

    it('returns accurate meta with custom labels for disbursement and transmittal', () => {
      const disbMeta = getTaskTypeMeta('disbursement');
      expect(disbMeta.label).toBe('Disbursement');
      expect(disbMeta.fullLabel).toBe('Disbursement');
      expect(disbMeta.iconClass).toBe('text-[#D97706]');

      const transMeta = getTaskTypeMeta('transmittal');
      expect(transMeta.label).toBe('Transmittal');
      expect(transMeta.fullLabel).toBe('Transmittal');
      expect(transMeta.iconClass).toBe('text-[#0369A1]');

      const stdMeta = getTaskTypeMeta(null);
      expect(stdMeta.label).toBe('Task');
      expect(stdMeta.fullLabel).toBe('Standard Task');

      const billMeta = getTaskTypeMeta('billing');
      expect(billMeta.label).toBe('Billing');
      expect(billMeta.fullLabel).toBe('Billing');

      const docMeta = getTaskTypeMeta('documents');
      expect(docMeta.label).toBe('Documents');
      expect(docMeta.fullLabel).toBe('Documents');
    });
  });

  describe('1. TaskTypeBadge default icon-only mode', () => {
    const testCases: Array<{
      value: string | null | undefined;
      expectedLabel: string;
      expectedIconColorClass: string;
    }> = [
      { value: '', expectedLabel: 'Standard Task', expectedIconColorClass: 'text-[#3B82F6]' },
      { value: null, expectedLabel: 'Standard Task', expectedIconColorClass: 'text-[#3B82F6]' },
      { value: undefined, expectedLabel: 'Standard Task', expectedIconColorClass: 'text-[#3B82F6]' },
      { value: 'task', expectedLabel: 'Standard Task', expectedIconColorClass: 'text-[#3B82F6]' },
      { value: 'standard', expectedLabel: 'Standard Task', expectedIconColorClass: 'text-[#3B82F6]' },
      { value: 'billing', expectedLabel: 'Billing', expectedIconColorClass: 'text-[#D97706]' },
      { value: 'invoice', expectedLabel: 'Billing', expectedIconColorClass: 'text-[#D97706]' },
      { value: 'disbursement', expectedLabel: 'Disbursement', expectedIconColorClass: 'text-[#D97706]' },
      { value: 'documents', expectedLabel: 'Documents', expectedIconColorClass: 'text-[#0369A1]' },
      { value: 'document', expectedLabel: 'Documents', expectedIconColorClass: 'text-[#0369A1]' },
      { value: 'transmittal', expectedLabel: 'Transmittal', expectedIconColorClass: 'text-[#0369A1]' },
    ];

    it.each(testCases)(
      'renders bare icon-only with empty textContent and proper role/aria-label for $value',
      ({ value, expectedLabel, expectedIconColorClass }) => {
        render(<TaskTypeBadge value={value} data-testid="test-badge" />);

        const badge = screen.getByTestId('test-badge');
        expect(badge.textContent).toBe('');
        expect(badge.getAttribute('title')).toBe(expectedLabel);
        expect(badge.className).not.toContain('border');
        expect(badge.className).toContain('inline-flex items-center justify-center shrink-0');

        const icon = screen.getByRole('img', { name: expectedLabel });
        expect(icon).toBeInTheDocument();
        expect(icon.getAttribute('aria-label')).toBe(expectedLabel);
        expect(icon.getAttribute('class')).toContain('h-3.5 w-3.5');
        expect(icon.getAttribute('class')).toContain(expectedIconColorClass);
      }
    );
  });

  describe('2. TaskTypeBadge labeled mode (showStandardLabel or showLabel)', () => {
    const labeledCases: Array<{
      value: string | null | undefined;
      expectedText: string;
      expectedFullLabel: string;
    }> = [
      { value: '', expectedText: 'Task', expectedFullLabel: 'Standard Task' },
      { value: null, expectedText: 'Task', expectedFullLabel: 'Standard Task' },
      { value: 'billing', expectedText: 'Billing', expectedFullLabel: 'Billing' },
      { value: 'invoice', expectedText: 'Billing', expectedFullLabel: 'Billing' },
      { value: 'disbursement', expectedText: 'Disbursement', expectedFullLabel: 'Disbursement' },
      { value: 'documents', expectedText: 'Documents', expectedFullLabel: 'Documents' },
      { value: 'document', expectedText: 'Documents', expectedFullLabel: 'Documents' },
      { value: 'transmittal', expectedText: 'Transmittal', expectedFullLabel: 'Transmittal' },
    ];

    it.each(labeledCases)(
      'renders badge pill with text label when showStandardLabel is true: $value -> $expectedText',
      ({ value, expectedText, expectedFullLabel }) => {
        render(<TaskTypeBadge value={value} showStandardLabel data-testid="labeled-badge" />);

        const badge = screen.getByTestId('labeled-badge');
        expect(badge.textContent).toBe(expectedText);
        expect(badge.getAttribute('title')).toBe(expectedFullLabel);
        expect(badge.className).toContain('border');
        expect(badge.className).toContain('rounded-[6px]');
      }
    );

    it('renders badge pill with text label when showLabel is true', () => {
      render(<TaskTypeBadge value="disbursement" showLabel data-testid="labeled-badge-2" />);

      const badge = screen.getByTestId('labeled-badge-2');
      expect(badge.textContent).toBe('Disbursement');
      expect(badge.className).toContain('border');
    });
  });

  describe('3. PhaseKanbanBoard icon consistency across task types', () => {
    const kanbanTasks: Task[] = [
      {
        id: 't-std',
        workRequestId: 'wr-kanban-1',
        title: 'Review Articles of Incorporation',
        phase: 'pre_processing',
        status: 'In Progress',
        requiredLinkType: null,
        boardOrder: 1000,
        checklist: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as unknown as Task,
      {
        id: 't-bill',
        workRequestId: 'wr-kanban-1',
        title: 'Issue Service Invoice',
        phase: 'pre_processing',
        status: 'In Progress',
        requiredLinkType: 'billing',
        boardOrder: 2000,
        checklist: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as unknown as Task,
      {
        id: 't-disb',
        workRequestId: 'wr-kanban-1',
        title: 'Disburse Filing Fee',
        phase: 'pre_processing',
        status: 'In Progress',
        requiredLinkType: 'disbursement',
        boardOrder: 3000,
        checklist: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as unknown as Task,
      {
        id: 't-doc',
        workRequestId: 'wr-kanban-1',
        title: 'Upload Notarized Deed',
        phase: 'pre_processing',
        status: 'In Progress',
        requiredLinkType: 'documents',
        boardOrder: 4000,
        checklist: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as unknown as Task,
      {
        id: 't-trans',
        workRequestId: 'wr-kanban-1',
        title: 'Transmit Docs to SEC',
        phase: 'pre_processing',
        status: 'In Progress',
        requiredLinkType: 'transmittal',
        boardOrder: 5000,
        checklist: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      } as unknown as Task,
    ];

    const kanbanWr: WorkRequest = {
      id: 'wr-kanban-1',
      title: 'SEC Registration 2026',
      entity: 'ATA',
      status: 'In Progress',
      phase: 'pre_processing',
      priority: 'High',
      clientId: 'c-1',
      clientName: 'Alpha Corp',
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      tasks: kanbanTasks,
    } as unknown as WorkRequest;

    it('renders bare icon only without text labels for all 5 task types on Kanban cards', async () => {
      const { wrapper } = createHarness();

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/wr-kanban-1/tasks')) {
          return new Response(JSON.stringify({ data: kanbanTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: [kanbanWr] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-kanban-1')) {
          return new Response(JSON.stringify({ data: kanbanWr }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(<PhaseKanbanBoard initialWorkRequestId="wr-kanban-1" />, { wrapper });

      // Check standard task card
      const stdBadge = await screen.findByTestId('kanban-task-type-t-std');
      expect(stdBadge.textContent).toBe('');
      expect(screen.getByRole('img', { name: 'Standard Task' })).toBeInTheDocument();

      // Check billing task card - must NOT show text 'Billing'
      const billBadge = screen.getByTestId('kanban-task-type-t-bill');
      expect(billBadge.textContent).toBe('');
      expect(screen.getByRole('img', { name: 'Billing' })).toBeInTheDocument();

      // Check disbursement task card - must NOT show text 'Disbursement'
      const disbBadge = screen.getByTestId('kanban-task-type-t-disb');
      expect(disbBadge.textContent).toBe('');
      expect(screen.getByRole('img', { name: 'Disbursement' })).toBeInTheDocument();

      // Check documents task card - must NOT show text 'Documents'
      const docBadge = screen.getByTestId('kanban-task-type-t-doc');
      expect(docBadge.textContent).toBe('');
      expect(screen.getByRole('img', { name: 'Documents' })).toBeInTheDocument();

      // Check transmittal task card - must NOT show text 'Transmittal'
      const transBadge = screen.getByTestId('kanban-task-type-t-trans');
      expect(transBadge.textContent).toBe('');
      expect(screen.getByRole('img', { name: 'Transmittal' })).toBeInTheDocument();
    });
  });

  describe('4. WorkRequestSidePeek icon consistency in Tasks Breakdown', () => {
    const sidePeekTasks: Task[] = [
      {
        id: 'sp-std',
        workRequestId: 'wr-peek-1',
        title: 'Review Financial Statements',
        phase: 'processing',
        status: 'In Progress',
        requiredLinkType: null,
        displayOrder: 1,
        version: 1,
        checklist: [],
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      } as unknown as Task,
      {
        id: 'sp-bill',
        workRequestId: 'wr-peek-1',
        title: 'Send Monthly Retainer Bill',
        phase: 'processing',
        status: 'In Progress',
        requiredLinkType: 'billing',
        displayOrder: 2,
        version: 1,
        checklist: [],
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      } as unknown as Task,
      {
        id: 'sp-disb',
        workRequestId: 'wr-peek-1',
        title: 'Reimburse Transport Expenses',
        phase: 'processing',
        status: 'In Progress',
        requiredLinkType: 'disbursement',
        displayOrder: 3,
        version: 1,
        checklist: [],
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      } as unknown as Task,
      {
        id: 'sp-doc',
        workRequestId: 'wr-peek-1',
        title: 'Compile Audited Financial Reports',
        phase: 'processing',
        status: 'In Progress',
        requiredLinkType: 'documents',
        displayOrder: 4,
        version: 1,
        checklist: [],
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      } as unknown as Task,
      {
        id: 'sp-trans',
        workRequestId: 'wr-peek-1',
        title: 'Courier Package to Client',
        phase: 'processing',
        status: 'In Progress',
        requiredLinkType: 'transmittal',
        displayOrder: 5,
        version: 1,
        checklist: [],
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      } as unknown as Task,
    ];

    const sidePeekWr: WorkRequest = {
      id: 'wr-peek-1',
      title: 'Corporate Year-End Audit',
      entity: 'ATA',
      clientId: 'c-1',
      clientName: 'Alpha Logistics Phils',
      status: 'In Progress',
      phase: 'processing',
      priority: 'High',
      archived: false,
      onHold: false,
      assignedTo: 'u-admin-1',
      assignedToName: 'Admin Test',
      version: 1,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
      tasks: sidePeekTasks,
    } as unknown as WorkRequest;

    it('renders side-peek-task-type-<id> icon-only with proper aria-label in Tasks Breakdown', async () => {
      const { wrapper } = createHarness();

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-peek-1/tasks')) {
          return new Response(JSON.stringify({ data: sidePeekTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-peek-1')) {
          return new Response(JSON.stringify({ data: sidePeekWr }), { status: 200 });
        }
        if (url.includes('/me/team')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (url.includes('/documents')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <WorkRequestSidePeek
          workRequestId="wr-peek-1"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Verify side-peek-task-type for each task type
      const stdIcon = await screen.findByTestId('side-peek-task-type-sp-std');
      expect(stdIcon.textContent).toBe('');
      expect(stdIcon.querySelector('[aria-label="Standard Task"]')).toBeInTheDocument();

      const billIcon = screen.getByTestId('side-peek-task-type-sp-bill');
      expect(billIcon.textContent).toBe('');
      expect(billIcon.querySelector('[aria-label="Billing"]')).toBeInTheDocument();

      const disbIcon = screen.getByTestId('side-peek-task-type-sp-disb');
      expect(disbIcon.textContent).toBe('');
      expect(disbIcon.querySelector('[aria-label="Disbursement"]')).toBeInTheDocument();

      const docIcon = screen.getByTestId('side-peek-task-type-sp-doc');
      expect(docIcon.textContent).toBe('');
      expect(docIcon.querySelector('[aria-label="Documents"]')).toBeInTheDocument();

      const transIcon = screen.getByTestId('side-peek-task-type-sp-trans');
      expect(transIcon.textContent).toBe('');
      expect(transIcon.querySelector('[aria-label="Transmittal"]')).toBeInTheDocument();
    });
  });

  describe('5. PendingApprovalsInbox compact task breakdown rows', () => {
    it('renders request-task-type-<id> icon-only in Work Request Tasks breakdown', async () => {
      const { wrapper } = createHarness();

      const mockWrWithTasks: WorkRequest = {
        id: 'wr-appr-1',
        title: 'Quarterly Filing Approval',
        entity: 'ATA',
        clientId: 'c-1',
        clientName: 'Megaworld Corp',
        clients: { name: 'Megaworld Corp' },
        status: 'In Progress',
        phase: 'pre_processing',
        priority: 'High',
        archived: false,
        onHold: false,
        assignedTo: 'u-lead-1',
        assignedToName: 'Maria Santos',
        version: 1,
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
        tasks: [
          {
            id: 't-appr-bill',
            workRequestId: 'wr-appr-1',
            title: 'Draft Billing Statement',
            phase: 'pre_processing',
            status: 'In Progress',
            requiredLinkType: 'billing',
            checklist: [],
            createdAt: '2026-03-01T00:00:00Z',
            updatedAt: '2026-03-01T00:00:00Z',
          } as unknown as Task,
          {
            id: 't-appr-doc',
            workRequestId: 'wr-appr-1',
            title: 'Gather Registration Docs',
            phase: 'pre_processing',
            status: 'Completed',
            requiredLinkType: 'documents',
            checklist: [],
            createdAt: '2026-03-01T00:00:00Z',
            updatedAt: '2026-03-01T00:00:00Z',
          } as unknown as Task,
        ],
      } as unknown as WorkRequest;

      const mockReq = {
        id: 'req-app-1',
        requestType: 'wr_phase_transition',
        workRequestId: 'wr-appr-1',
        fromPhase: 'pre_processing',
        toPhase: 'processing',
        status: 'pending',
        requestedBy: 'u-lead-1',
        requestedByName: 'Maria Santos',
        workRequestTitle: 'Quarterly Filing Approval',
        clientName: 'Megaworld Corp',
        clients: { name: 'Megaworld Corp' },
        createdAt: new Date().toISOString(),
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations-requests/counts')) {
          return new Response(JSON.stringify({ data: { pending: 1, rejected: 0, fulfilled: 0 } }), { status: 200 });
        }
        if (url.includes('/operations-requests')) {
          return new Response(JSON.stringify({ data: [mockReq] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-appr-1')) {
          return new Response(JSON.stringify({ data: mockWrWithTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/pending-creation-count')) {
          return new Response(JSON.stringify({ data: { count: 0 } }), { status: 200 });
        }
        if (url.includes('/me/team')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: {} }), { status: 200 });
      });

      render(<PendingApprovalsInbox />, { wrapper });

      const billBadge = await screen.findByTestId('request-task-type-t-appr-bill');
      expect(billBadge.textContent).toBe('');
      expect(billBadge.querySelector('[aria-label="Billing"]')).toBeInTheDocument();

      const docBadge = screen.getByTestId('request-task-type-t-appr-doc');
      expect(docBadge.textContent).toBe('');
      expect(docBadge.querySelector('[aria-label="Documents"]')).toBeInTheDocument();
    });
  });
});
