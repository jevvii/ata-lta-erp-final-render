import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskLineItems } from '../components/TaskLineItems';
import { getTaskDeletionReason } from '../lib/taskDeletion';

const cases = [
  { phase: 'processing' as const, hasDocuments: false, message: 'advanced beyond its phase' },
  { phase: 'pre_processing' as const, hasDocuments: true, message: 'has documents/receipts' },
];

describe('Work request edit task removal protection', () => {
  it.each(cases)('keeps the protected row: $message', ({ phase, hasDocuments, message }) => {
    const reason = getTaskDeletionReason({ phase: 'pre_processing', hasDocuments }, { phase, status: 'In Progress' });
    const onChange = vi.fn();
    render(<TaskLineItems projectTeam={[]} onChange={onChange} isEditMode tasks={[
      { id: 'protected', localId: 'protected', title: 'Protected task', phase: 'pre_processing', coAssignees: [], deletionBlockedReason: reason },
      { localId: 'new', title: 'New task', phase: 'processing', coAssignees: [] },
    ]} />);
    const button = screen.getByTestId('task-remove-btn-protected');
    expect(button).toBeDisabled();
    expect(screen.getByTestId('task-delete-reason-protected')).toHaveTextContent(message);
    fireEvent.click(button);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('task-remove-btn-new'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: 'protected' })]);
  });

  it('recognizes uploaded documents when the server flag is unavailable', () => {
    expect(getTaskDeletionReason({ phase: 'pre_processing', taskDocuments: [{ documentId: 'receipt', fileName: 'receipt.pdf', uploadDate: null, uploaderId: null }] }))
      .toContain('documents/receipts');
  });
});
