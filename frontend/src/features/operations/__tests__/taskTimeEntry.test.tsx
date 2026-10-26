import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskTimeEntry } from '../components/TaskTimeEntry';
import { mapRawTimeEntry } from '@/features/dashboard/api/useTimeEntries';
import type { TimeEntry } from '@/features/dashboard/api/types';
import * as api from '@/lib/api';

const raw = { id: 'entry-1', user_id: 'logger-1', user_name: 'Maria Clara Reyes', user_role: 'Manager',
  task_id: 'task-1', entry_date: '2026-09-20', duration_minutes: 60,
  note: 'Reviewed the ledger.\nFollowed up every outstanding item and documented the complete reconciliation.',
  created_at: '2026-09-21T01:30:00Z', updated_at: '2026-09-21T01:30:00Z' };

describe('Task time entry details and inline actions', () => {
  let client: QueryClient;
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  });
  afterEach(() => { client.clear(); vi.restoreAllMocks(); });
  const show = (canManage = true, entry: TimeEntry = mapRawTimeEntry(raw)) => render(
    <QueryClientProvider client={client}><TaskTimeEntry entry={entry} canManage={canManage} /></QueryClientProvider>
  );

  it('shows logger initials, full name, role, work date, Manila logged timestamp, full note and one duration', () => {
    show();
    expect(screen.getByText('MR')).toBeInTheDocument();
    expect(screen.getByText('Maria Clara Reyes')).toBeInTheDocument();
    expect(screen.getByText('Manager')).toBeInTheDocument();
    expect(screen.getByText('2026-09-20').closest('time')).toHaveAttribute('dateTime', '2026-09-20');
    const logged = screen.getByText(/Sep 21, 2026.*9:30.*AM/);
    expect(logged.closest('time')).toHaveAttribute('dateTime', raw.created_at);
    const note = screen.getByText(/Reviewed the ledger/);
    expect(note.textContent).toBe(raw.note);
    expect(note).toHaveClass('whitespace-pre-wrap');
    expect(note).not.toHaveClass('line-clamp-1');
    expect(screen.getAllByText('60 min')).toHaveLength(1);
    expect(screen.queryByText('1h')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('keeps unresolvable logger details honest and actions hidden for a viewer', () => {
    show(false, { ...mapRawTimeEntry(raw), userName: null, userRole: null });
    expect(screen.getByText('Unknown logger')).toBeInTheDocument();
    expect(screen.getByText('Role unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('edits date, duration and the full note through the existing PATCH endpoint', async () => {
    const spy = vi.spyOn(api, 'apiRequest').mockResolvedValue({ data: { ...raw, duration_minutes: 61 } });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const minutes = screen.getByLabelText('Edit duration in minutes') as HTMLInputElement;
    fireEvent.change(minutes, { target: { value: '' } });
    expect(minutes.value).toBe('');
    fireEvent.change(minutes, { target: { value: '61' } });
    expect(minutes.checkValidity()).toBe(true);
    fireEvent.change(screen.getByLabelText('Edit work note'), { target: { value: 'Updated\nComplete note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/time-entries/entry-1', {
      method: 'PATCH', body: JSON.stringify({ entry_date: raw.entry_date, duration_minutes: 61, note: 'Updated\nComplete note' }),
    }));
    await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
  });

  it('retains the edit form and server error after a rejected update', async () => {
    vi.spyOn(api, 'apiRequest').mockRejectedValue(new Error('This time entry cannot be updated.'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This time entry cannot be updated.');
    expect(screen.getByLabelText('Edit work note')).toHaveValue(raw.note);
  });

  it('cancels deletion without a request, then confirms through the existing DELETE endpoint', async () => {
    const spy = vi.spyOn(api, 'apiRequest').mockResolvedValue(undefined);
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('/time-entries/entry-1', { method: 'DELETE' }));
  });

  it('shows the delete error when the server rejects deletion', async () => {
    vi.spyOn(api, 'apiRequest').mockRejectedValue(new Error('Deletion denied.'));
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Deletion denied.');
  });
});
