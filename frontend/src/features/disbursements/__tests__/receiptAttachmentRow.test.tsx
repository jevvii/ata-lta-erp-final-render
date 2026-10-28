import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReceiptViewer, type ReceiptViewerProps } from '../components/ReceiptViewer';
import { receiptDisplayName } from '../lib/receiptDisplayName';

const key =
  'entities/LTA/disbursements/receipts/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa-client-receipt.png';
const defaults: ReceiptViewerProps = {
  receiptS3Key: key,
  receiptData: { filename: key, url: 'https://storage.test/signed.png', contentType: 'image/png' },
  onRefetchReceiptUrl: vi.fn(),
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('Receipt attachment controls and viewer', () => {
  it('removes redundant top attachment card and renders compact toolbar with download', () => {
    render(<ReceiptViewer {...defaults} />, { wrapper });
    expect(screen.queryByTestId('receipt-attachment-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('receipt-viewer-container').textContent).not.toContain('entities/');
    expect(screen.getByTestId('receipt-viewer-container').textContent).not.toContain('aaaaaaaa');
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByTestId('btn-download-receipt')).toHaveAttribute(
      'download',
      'client-receipt.png'
    );
    expect(receiptDisplayName('C:\\receipts\\receipt.pdf')).toBe('receipt.pdf');
  });

  it('keeps internal storage path details out of the viewer container text', () => {
    render(
      <ReceiptViewer
        {...defaults}
        receiptData={{ url: 'https://storage.test/file', contentType: 'image/png' }}
      />,
      { wrapper }
    );
    expect(screen.getByTestId('receipt-viewer-container').textContent).not.toContain(key);
  });

  it('shows loading and unavailable states without offering a usable Download action', () => {
    const { rerender } = render(
      <ReceiptViewer {...defaults} receiptData={undefined} isLoadingReceipt />,
      { wrapper }
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading receipt');
    expect(screen.queryByTestId('btn-download-receipt')).not.toBeInTheDocument();
    rerender(<ReceiptViewer {...defaults} receiptData={{ status: 'unavailable' }} />);
    expect(screen.getByTestId('receipt-legacy-unavailable')).toHaveTextContent(
      'Supporting document unavailable'
    );
    expect(screen.queryByTestId('btn-download-receipt')).not.toBeInTheDocument();
  });

  it('keeps internal storage error details out of the attachment and offers retry', () => {
    const retry = vi.fn();
    render(
      <ReceiptViewer
        {...defaults}
        isReceiptError
        receiptError={new Error(`Could not read ${key}`)}
        onRefetchReceiptUrl={retry}
      />,
      { wrapper }
    );
    expect(screen.getByRole('alert')).not.toHaveTextContent('entities/');
    expect(screen.queryByTestId('btn-download-receipt')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('btn-retry-receipt'));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('triggers blob fetch and direct file download when download button is clicked', async () => {
    const mockBlob = new Blob(['fake image content'], { type: 'image/png' });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(mockBlob),
    });
    globalThis.fetch = fetchMock;

    const createObjectURLMock = vi.fn().mockReturnValue('blob:https://storage.test/mock-blob-uuid');
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName.toLowerCase() === 'a') {
        vi.spyOn(el, 'click').mockImplementation(() => {});
      }
      return el;
    });

    try {
      render(<ReceiptViewer {...defaults} />, { wrapper });
      const downloadBtn = screen.getByTestId('btn-download-receipt');
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('https://storage.test/signed.png');
        expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob);
      });
    } finally {
      globalThis.fetch = originalFetch;
      createElementSpy.mockRestore();
    }
  });

  it('opens a read-only receipt preview without document-detail or document-download requests via Modal button', async () => {
    const fetch = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    try {
      render(<ReceiptViewer {...defaults} />, { wrapper });
      fireEvent.click(screen.getByTestId('btn-open-modal-receipt'));
      expect(await screen.findByTestId('doc-preview-image')).toHaveAttribute(
        'src',
        'https://storage.test/signed.png'
      );
      expect(screen.queryByTestId('upload-doc-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('comments-scroll-container')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(fetch.mock.calls.some(([url]) => String(url).includes('/documents'))).toBe(false)
      );
    } finally {
      fetch.mockRestore();
    }
  });
});
