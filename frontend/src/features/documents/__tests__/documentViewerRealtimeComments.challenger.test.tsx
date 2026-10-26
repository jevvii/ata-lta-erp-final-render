import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DocumentViewerModal } from '../components/DocumentViewerModal';
import { documentKeys } from '../api/queryKeys';
import type { DmsDocument } from '../api/types';
import { useSessionStore } from '@/lib/session';
import { clearChannelRegistryForTesting } from '@/lib/realtime/useEntityRealtimeSync';

const mocks = vi.hoisted(() => ({ api: vi.fn(), blocking: vi.fn(), remove: vi.fn(),
  receive: undefined as undefined | ((payload: unknown) => void) }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<object>()), apiRequest: mocks.api }));
vi.mock('@/features/operations/components/BlockingActionModal', () => ({ runBlockingAction: mocks.blocking }));
vi.mock('@/components/common/PresenceAvatars', () => ({ PresenceAvatars: () => null }));
vi.mock('@/features/operations/api/useTeam', () => ({ useTeam: () => ({ data: [] }) }));
vi.mock('@/lib/flags', () => ({ isFeatureEnabled: () => true }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  channel: () => {
    const channel = {
      on: (_type: string, _filter: unknown, callback: (payload: unknown) => void) => { mocks.receive = callback; return channel; },
      subscribe: () => channel,
    };
    return channel;
  },
  removeChannel: mocks.remove,
} }));

let client: QueryClient;
let serverDoc: DmsDocument;
const comment = (id: string, text: string, userId = 'author') => ({ id, text, userId, userName: userId, date: new Date().toISOString() });
const renderViewer = (doc = serverDoc, isOpen = true) => render(
  <QueryClientProvider client={client}><DocumentViewerModal isOpen={isOpen} document={doc} onClose={vi.fn()} /></QueryClientProvider>
);
async function emit(doc: DmsDocument) {
  serverDoc = doc;
  await act(async () => mocks.receive?.({ eventType: 'UPDATE', table: 'documents', new: { ...doc, entity: 'ATA' }, old: { id: doc.id } }));
}
beforeEach(() => {
  vi.clearAllMocks();
  clearChannelRegistryForTesting();
  mocks.receive = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  useSessionStore.setState({ activeEntity: 'ATA', user: { id: 'author', name: 'Author', email: 'author@example.test', role: 'Employee', departments: ['Documentation'], entities: ['ATA'] } });
  serverDoc = { id: 'document-a', can_comment: true, file_name: 'review.txt', original_name: 'review.txt', entity_id: 'ATA',
    work_request_id: null, linked_task_id: null, client_id: null, document_type: null,
    category: null, uploader_id: 'author', description: null, status: 'active',
    document_lifecycle: 'collected', file_size: null, storage_path: null, external_url: null,
    comments: [comment('one', 'Existing review')], archived: false, versions: [], content_type: 'text/plain',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  mocks.api.mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (path.includes('/download-url')) return { data: { url: '', fileName: 'review.txt' } };
    if (options?.method === 'POST') {
      serverDoc = { ...serverDoc, comments: [...serverDoc.comments, comment('posted', JSON.parse(options.body!).text)] };
    } else if (options?.method === 'PUT') {
      serverDoc = { ...serverDoc, comments: serverDoc.comments.map((c) => c.id === path.split('/').pop() ? { ...c, text: JSON.parse(options.body!).text, edited: true } : c) };
    } else if (options?.method === 'DELETE') {
      serverDoc = { ...serverDoc, comments: serverDoc.comments.filter((c) => c.id !== path.split('/').pop()) };
    }
    return { data: serverDoc };
  });
});
afterEach(() => { cleanup(); client.clear(); clearChannelRegistryForTesting(); });

describe('live document comments challenger', () => {
  it.each(['Employee', 'Manager', 'Admin'])('uses server authorization for %s regardless of DMS edit permissions', async (role) => {
    useSessionStore.setState({ user: { ...useSessionStore.getState().user!, role }, permissions: new Set() });
    serverDoc = { ...serverDoc, linked_task_id: 'task-a', can_comment: true };
    renderViewer();
    const input = await screen.findByTestId('new-comment-textarea');
    fireEvent.change(input, { target: { value: 'Assigned reviewer' } });
    fireEvent.click(screen.getByTestId('post-comment-btn'));
    await screen.findByText('Assigned reviewer');
    await emit({ ...serverDoc, can_comment: false });
    await waitFor(() => expect(screen.queryByTestId('new-comment-textarea')).not.toBeInTheDocument());
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    expect(screen.getByText('Only task assignees and admins can comment on this document.')).toBeInTheDocument();
  });

  it('hides comment controls when authorization is missing despite DMS edit permission', async () => {
    useSessionStore.setState({ permissions: new Set(['dms:edit']) });
    serverDoc = { ...serverDoc, can_comment: undefined, linked_task_id: 'task-a' };
    renderViewer();
    await screen.findByText('Existing review');
    expect(screen.queryByTestId('new-comment-textarea')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });

  it('renders authoritative detail data and receives live CDC updates through the subscription', async () => {
    const stale = { ...serverDoc, comments: [] };
    renderViewer(stale);
    expect(await screen.findByText('Existing review')).toBeInTheDocument();
    await emit({ ...serverDoc, comments: [...serverDoc.comments, comment('remote', 'Remote message', 'peer')] });
    expect(await screen.findByText('Remote message')).toBeInTheDocument();
    expect(client.getQueryData<DmsDocument>(documentKeys.detail(serverDoc.id))?.comments).toHaveLength(2);
    await emit({ ...serverDoc, comments: serverDoc.comments.map((c) => c.id === 'remote' ? { ...c, text: 'Remote edit', edited: true } : c) });
    expect(await screen.findByText('Remote edit')).toBeInTheDocument();
    expect(screen.getByText(/edited/)).toBeInTheDocument();
    await emit({ ...serverDoc, comments: serverDoc.comments.filter((c) => c.id !== 'remote') });
    await waitFor(() => expect(screen.queryByText('Remote edit')).not.toBeInTheDocument());
  });

  it('Enter sends text only, Shift+Enter and IME composition do not send, with no blocking overlay', async () => {
    renderViewer();
    await screen.findByText('Existing review');
    const input = await screen.findByTestId('new-comment-textarea');
    fireEvent.change(input, { target: { value: 'First line' } });
    expect(fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(mocks.api.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'First line\nSecond line' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(input).toHaveValue(''));
    expect(mocks.api).toHaveBeenCalledWith('/documents/document-a/comments', { method: 'POST', body: JSON.stringify({ text: 'First line\nSecond line' }) });
    expect(await screen.findByText(/Second line/)).toBeInTheDocument();
    expect(mocks.blocking).not.toHaveBeenCalled();
    expect(screen.queryByText('Updating Document')).not.toBeInTheDocument();
  });

  it('keeps typing responsive, prevents duplicate sends, and preserves new draft text while pending', async () => {
    renderViewer();
    await screen.findByText('Existing review');
    const original = mocks.api.getMockImplementation()!;
    let resolve!: (result: unknown) => void;
    mocks.api.mockImplementation((path: string, options?: { method?: string }) => options?.method === 'POST'
      ? new Promise((done) => { resolve = done; }) : original(path, options));
    const input = await screen.findByTestId('new-comment-textarea');
    fireEvent.change(input, { target: { value: 'Sending this' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Sending...');
    fireEvent.change(input, { target: { value: 'Next draft' } });
    expect(input).toHaveValue('Next draft');
    expect(input).not.toBeDisabled();
    expect(mocks.api.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(1);
    await act(async () => resolve({ data: serverDoc }));
    await waitFor(() => expect(screen.getByTestId('post-comment-btn')).not.toBeDisabled());
    expect(input).toHaveValue('Next draft');
    expect(mocks.blocking).not.toHaveBeenCalled();
  });

  it('surfaces failure inline and retains the draft for retry', async () => {
    renderViewer(); await screen.findByText('Existing review');
    mocks.api.mockRejectedValueOnce(new Error('Connection interrupted'));
    const input = await screen.findByTestId('new-comment-textarea');
    fireEvent.change(input, { target: { value: 'Keep my draft' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
    expect(input).toHaveValue('Keep my draft');
    expect(mocks.blocking).not.toHaveBeenCalled();
  });

  it('restricts controls by ownership and uses dedicated edit/delete requests without dialogs', async () => {
    serverDoc.comments.push(comment('peer', 'Peer review', 'peer'));
    const confirm = vi.spyOn(window, 'confirm');
    renderViewer(); await screen.findByText('Existing review');
    expect(within(screen.getByTestId('comment-item-peer')).queryByText('Edit')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('comment-item-peer')).queryByText('Delete')).not.toBeInTheDocument();
    fireEvent.click(await within(screen.getByTestId('comment-item-one')).findByText('Edit'));
    fireEvent.change(screen.getByLabelText('Edit comment'), { target: { value: 'My edit' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.queryByLabelText('Edit comment')).not.toBeInTheDocument());
    expect(screen.getByText('My edit')).toBeInTheDocument();
    expect(mocks.api).toHaveBeenCalledWith('/documents/document-a/comments/one', { method: 'PUT', body: JSON.stringify({ text: 'My edit' }) });
    fireEvent.click(within(screen.getByTestId('comment-item-one')).getByText('Delete'));
    await waitFor(() => expect(screen.queryByText('My edit')).not.toBeInTheDocument());
    expect(mocks.api).toHaveBeenCalledWith('/documents/document-a/comments/one', { method: 'DELETE' });
    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.blocking).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('lets admins delete other authors’ messages, but never edit them', async () => {
    useSessionStore.setState({ user: { ...useSessionStore.getState().user!, id: 'admin', role: 'Admin' } });
    renderViewer(); await screen.findByText('Existing review');
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(await screen.findByText('Delete')).toBeInTheDocument();
  });

  it('follows new comments unless scrolled up, and follows again after reopening', async () => {
    const height = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
    const view = renderViewer(); await screen.findByText('Existing review');
    const scroller = screen.getByTestId('comments-scroll-container');
    Object.defineProperties(scroller, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } });
    await emit({ ...serverDoc, comments: [...serverDoc.comments, comment('two', 'Second')] });
    expect(scroller.scrollTop).toBe(1000);
    scroller.scrollTop = 100; fireEvent.scroll(scroller);
    await emit({ ...serverDoc, comments: [...serverDoc.comments, comment('three', 'Third')] });
    expect(scroller.scrollTop).toBe(100);
    scroller.scrollTop = 800; fireEvent.scroll(scroller);
    await emit({ ...serverDoc, comments: [...serverDoc.comments, comment('four', 'Fourth')] });
    await waitFor(() => expect(scroller.scrollTop).toBe(1000));
    view.rerender(<QueryClientProvider client={client}><DocumentViewerModal isOpen={false} document={serverDoc} onClose={vi.fn()} /></QueryClientProvider>);
    expect(mocks.remove).toHaveBeenCalled();
    expect(screen.queryByTestId('document-viewer-modal')).not.toBeInTheDocument();
    view.rerender(<QueryClientProvider client={client}><DocumentViewerModal isOpen document={serverDoc} onClose={vi.fn()} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId('comments-scroll-container').scrollTop).toBe(1000));
    height.mockRestore();
  });
});
