import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkRequestModal } from '../components/WorkRequestModal';
import { TaskLineItems } from '../components/TaskLineItems';
import {
  createWorkRequestSchema,
  generateRetainerTemplateSchema,
  updateWorkRequestSchema,
} from '../api/schemas';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';

const fixtures = vi.hoisted(() => ({
  clients: [],
  team: [
    {
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Maria Santos',
      email: 'maria@example.com',
      role: 'Manager',
    },
  ],
  create: vi.fn(),
  update: vi.fn(),
}));
vi.mock('../api/useClients', () => ({ useClients: () => ({ data: fixtures.clients }) }));
vi.mock('../api/useTeam', () => ({ useTeam: () => ({ data: fixtures.team }) }));
vi.mock('../api/useWorkRequests', () => ({
  useWorkRequestMutations: () => ({
    createWorkRequest: fixtures.create,
    updateWorkRequest: fixtures.update,
  }),
}));
vi.mock('../api/useTasks', () => ({
  useTaskMutations: () => ({ createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn() }),
}));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useBlockingModalStore.getState().reset();
  useSessionStore
    .getState()
    .setSession({
      user: { ...fixtures.team[0]!, departments: ['Operations'], entities: ['ATA'] },
      permissions: ['workflow:edit'],
      activeEntity: 'ATA',
    });
});

function mountCreate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WorkRequestModal isOpen onClose={vi.fn()} />
    </QueryClientProvider>
  );
}

async function selectManager() {
  const trigger = screen.getByTestId('assigner-primary-select');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.keyDown(trigger, { key: 'ArrowDown', code: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: /Maria Santos/ }));
}

describe('Required work request due date', () => {
  it.each([undefined, null, '', 'invalid', '2026-02-30', '2026-13-01'])(
    'rejects %p in create and generation schemas',
    (dueDate) => {
      expect(createWorkRequestSchema.safeParse({ title: 'Filing', dueDate }).success).toBe(false);
      expect(generateRetainerTemplateSchema.safeParse({ overrides: { dueDate } }).success).toBe(
        false
      );
    }
  );

  it('accepts date and timestamp payloads and partial legacy updates', () => {
    for (const dueDate of ['2026-12-31', '2026-12-31T00:00:00.000Z']) {
      expect(createWorkRequestSchema.safeParse({ title: 'Filing', dueDate }).success).toBe(true);
      expect(generateRetainerTemplateSchema.safeParse({ overrides: { dueDate } }).success).toBe(
        true
      );
      expect(
        generateRetainerTemplateSchema.safeParse({ overrides: { due_date: dueDate } }).success
      ).toBe(true);
    }
    expect(generateRetainerTemplateSchema.safeParse({}).success).toBe(false);
    expect(
      updateWorkRequestSchema.safeParse({ title: 'Legacy request', dueDate: null }).success
    ).toBe(true);
  });

  it('blocks submission without a due date before invoking the mutation', async () => {
    mountCreate();
    fireEvent.change(screen.getByTestId('wr-modal-title-input'), {
      target: { value: 'SEC filing' },
    });
    const form = screen.getByTestId('wr-modal-title-input').closest('form')!;
    fireEvent.submit(form);
    expect(await screen.findByRole('alert')).toHaveTextContent('Due date is required');
    expect(fixtures.create).not.toHaveBeenCalled();
  });

  it('submits the selected due date with a valid new work request', async () => {
    fixtures.create.mockResolvedValue({ id: 'created-wr', tasks: [] });
    mountCreate();
    fireEvent.change(screen.getByTestId('wr-modal-title-input'), {
      target: { value: 'SEC filing' },
    });
    await selectManager();
    fireEvent.change(screen.getByTestId('wr-modal-due-date'), { target: { value: '2026-12-31' } });
    fireEvent.submit(screen.getByTestId('wr-modal-title-input').closest('form')!);
    await waitFor(() =>
      expect(fixtures.create).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: '2026-12-31T00:00:00.000Z' })
      )
    );
  });

  it('keeps description editors fixed and the subtask action functional', () => {
    const onChange = vi.fn();
    render(
      <TaskLineItems
        projectTeam={[]}
        onChange={onChange}
        tasks={[{ localId: 'intake', title: 'Intake', phase: 'pre_processing', coAssignees: [] }]}
      />
    );
    const add = screen.getByTestId('task-add-checklist-btn-intake');
    expect(add).toHaveTextContent(/^Subtask$/);
    fireEvent.click(add);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ checklist: [expect.objectContaining({ category: 'subtask' })] }),
    ]);
    expect(screen.getByPlaceholderText(/Add details, instructions/)).toHaveClass('resize-none');
  });
});
