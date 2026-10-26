import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskLineItems } from '../components/TaskLineItems';
import { TaskChecklist } from '../components/TaskChecklist';
import type { ChecklistItem } from '../api/types';

const doc: ChecklistItem = {
  id: 'a3512c21-578d-4194-82d9-ea56c4b367fe', text: 'Tax certificate', completed: false,
  category: 'document', periodYear: '2025/2026', assigneeId: 'owner-id', assigneeName: 'Filing owner',
  dependsOn: ['prerequisite-a', 'prerequisite-b'],
};

afterEach(cleanup);

function setup(overrides: Partial<Parameters<typeof TaskChecklist>[0]> = {}) {
  const onChange = vi.fn().mockResolvedValue(undefined);
  const onRetry = vi.fn();
  const onToggle = vi.fn().mockResolvedValue(undefined);
  render(<TaskChecklist items={[]} canEdit canComplete ready loading={false} loadError={false}
    onRetry={onRetry} onChange={onChange} onToggle={onToggle} {...overrides} />);
  return { onChange, onRetry, onToggle };
}

describe('Task checklist editing', () => {
  it('adds a document with its year while preserving all existing metadata', async () => {
    const { onChange } = setup({ items: [doc] });
    fireEvent.change(screen.getByLabelText('New checklist item'), { target: { value: 'Signed filing' } });
    fireEvent.change(screen.getByLabelText('New checklist item type'), { target: { value: 'document' } });
    fireEvent.click(screen.getByLabelText('Include year (optional)'));
    fireEvent.change(screen.getByLabelText('New document year'), { target: { value: '2026' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(onChange.mock.calls[0]?.[0]).toEqual([doc, expect.objectContaining({
      text: 'Signed filing', category: 'document', periodYear: '2026', completed: false,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    })]);
    await waitFor(() => expect(screen.getByLabelText('New checklist item')).toHaveValue(''));
  });

  it('adds a subtask by default and prevents a duplicate submission while saving', async () => {
    let finish!: () => void;
    const onChange = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    setup({ onChange });
    const input = screen.getByLabelText('New checklist item');
    fireEvent.change(input, { target: { value: 'Review records' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0][0]).toMatchObject({ category: 'subtask', periodYear: null });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    finish();
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('edits text, type and optional year while preserving assignments and prerequisites', async () => {
    const { onChange } = setup({ items: [doc] });
    fireEvent.click(screen.getByRole('button', { name: 'Edit checklist item Tax certificate' }));
    fireEvent.change(screen.getByLabelText('Checklist text'), { target: { value: 'Updated tax certificate' } });
    fireEvent.change(screen.getByLabelText('Document year (optional)'), { target: { value: '2027' } });
    fireEvent.change(screen.getByLabelText('Checklist item type'), { target: { value: 'subtask' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ ...doc, text: 'Updated tax certificate', category: 'subtask', periodYear: '2027' }]));
  });

  it('hides missing years and lets editors add or remove an optional year', async () => {
    const noYear = { ...doc, periodYear: null };
    const { onChange } = setup({ items: [noYear] });
    expect(screen.queryByLabelText('Document year for Tax certificate')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Year (optional)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit checklist item Tax certificate' }));
    expect(screen.queryByLabelText('Document year (optional)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add year' }));
    fireEvent.change(screen.getByLabelText('Document year (optional)'), { target: { value: '2028' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove year' }));
    expect(screen.queryByLabelText('Document year (optional)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([noYear]));
  });

  it('adds documents without assigning a year by default', async () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText('New checklist item'), { target: { value: 'Company records' } });
    fireEvent.change(screen.getByLabelText('New checklist item type'), { target: { value: 'document' } });
    expect(screen.queryByLabelText('New document year')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
    expect(onChange.mock.calls[0]?.[0][0]).toMatchObject({ category: 'document', periodYear: null });
  });

  it('allows assignees to tick items without any content editing controls', async () => {
    const item = { ...doc, dependsOn: [] };
    const { onToggle, onChange } = setup({ items: [item], canEdit: false, canComplete: true });
    expect(screen.queryByRole('button', { name: /Edit checklist/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('New checklist item')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Document year (optional)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: doc.text }));
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(doc.id, true));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes an item and prunes its prerequisite links without dropping other metadata', async () => {
    const prerequisite = { id: 'prerequisite-a', text: 'Collect records', completed: false, category: 'subtask' };
    const { onChange } = setup({ items: [prerequisite, doc] });
    fireEvent.click(screen.getByRole('button', { name: 'Edit checklist item Collect records' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove checklist item Collect records' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([{ ...doc, dependsOn: ['prerequisite-b'] }]));
  });

  it('keeps unrelated viewers read-only', () => {
    setup({ items: [doc], canEdit: false, canComplete: false });
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Edit checklist/ })).not.toBeInTheDocument();
  });

  it('keeps completion blocked until all checklist prerequisites are done', () => {
    setup({ items: [
      { id: 'prerequisite-a', text: 'Collect', completed: true },
      { id: 'prerequisite-b', text: 'Verify', completed: false }, doc,
    ] });
    expect(screen.getByRole('checkbox', { name: doc.text })).toBeDisabled();
  });

  it.each([
    { ready: false, loading: true, loadError: false },
    { ready: false, loading: false, loadError: true },
    { ready: false, loading: false, loadError: false },
  ])('blocks replacement saves until the checklist was successfully loaded (%j)', (state) => {
    const { onChange, onRetry } = setup(state);
    expect(screen.getByLabelText('New checklist item')).toBeDisabled();
    expect(screen.queryByText('No checklist items yet.')).not.toBeInTheDocument();
    if (!state.loading) {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledOnce();
    }
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows save failures and keeps the entered text for retry', async () => {
    setup({ onChange: vi.fn().mockRejectedValue(new Error('Checklist could not be saved')) });
    fireEvent.change(screen.getByLabelText('New checklist item'), { target: { value: 'Review records' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Checklist could not be saved');
    expect(screen.getByLabelText('New checklist item')).toHaveValue('Review records');
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
  });

  it('honors completed-work-request and past-phase locks', () => {
    const { onChange } = setup({ items: [doc], disabled: true, disabledReason: 'This phase is locked' });
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByLabelText('New checklist item type')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit checklist item Tax certificate' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('keeps document years optional in the work request creation editor too', () => {
    const onChange = vi.fn();
    render(<TaskLineItems tasks={[{ localId: 'task-a', title: 'Filing', phase: 'pre_processing', coAssignees: [],
      checklist: [{ id: doc.id, text: 'Tax certificate', category: 'document', completed: false, periodYear: null }] }]}
      onChange={onChange} projectTeam={[]} />);
    fireEvent.click(screen.getByTestId('task-checklist-badge-task-a'));
    expect(screen.queryByLabelText('Document year for Tax certificate')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Year' }));
    const year = screen.getByLabelText('Document year for Tax certificate');
    expect(year).toHaveValue(null);
    fireEvent.change(year, { target: { value: '2028' } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ checklist: [expect.objectContaining({ periodYear: 2028 })] })]);
  });

});
