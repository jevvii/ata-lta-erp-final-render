import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DocumentsPage from '@/routes/documents';
import { useSessionStore } from '@/lib/session';

vi.mock('@/lib/flags', () => ({ isModuleEnabled: () => true }));
vi.mock('@/features/operations/components/BlockingActionModal', () => ({ BlockingActionModal: () => null }));
vi.mock('@/features/operations/api/useWorkRequests', () => ({ useWorkRequests: () => ({ data: [] }) }));
vi.mock('@/features/operations/api/useClients', () => ({ useClients: () => ({ data: [] }) }));
vi.mock('@/features/operations/api/useTeam', () => ({ useTeam: () => ({ data: [] }) }));
vi.mock('@/features/documents', () => ({
  DocumentFilterBar: () => null, DocumentTable: () => null, DocumentUploadModal: () => null,
  DocumentLifecycleModal: () => null, DocumentViewerModal: () => null,
}));
vi.mock('@/features/documents/api/useDocuments', () => ({
  useDocumentsList: () => ({ data: { data: [], meta: { total: 0 } } }),
  useDocumentCounts: () => ({ data: {} }),
  useLifecycleTransition: () => ({}), useArchiveDocument: () => ({}),
  useUnarchiveDocument: () => ({}), useDeleteDocument: () => ({}),
}));
afterEach(() => { useSessionStore.getState().clearSession(); });

it('can gain and lose document access without changing hook order', async () => {
  useSessionStore.setState({ permissions: new Set() });
  render(<MemoryRouter><DocumentsPage /></MemoryRouter>);
  expect(screen.queryByTestId('documents-page')).toBeNull();
  await act(async () => { useSessionStore.setState({ permissions: new Set(['dms:view']) }); });
  expect(screen.getByTestId('documents-page')).toBeInTheDocument();
  await act(async () => { useSessionStore.setState({ permissions: new Set() }); });
  expect(screen.queryByTestId('documents-page')).toBeNull();
});
