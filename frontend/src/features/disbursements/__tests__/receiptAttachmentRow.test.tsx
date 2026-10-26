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

describe('Receipt attachment row', () => {
  it('shows only a friendly filename for a path-valued API filename and removes the generated UUID', () => {
    render(<ReceiptViewer {...defaults} />, { wrapper });
    expect(screen.getByTestId('receipt-file-name')).toHaveTextContent('client-receipt.png');
    expect(screen.getByTestId('receipt-viewer-container').textContent).not.toContain('entities/');
    expect(screen.getByTestId('receipt-viewer-container').textContent).not.toContain('aaaaaaaa');
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'download',
      'client-receipt.png'
    );
    expect(receiptDisplayName('C:\\receipts\\receipt.pdf')).toBe('receipt.pdf');
  });

  it('uses a generic attachment name when only an internal key exists', () => {
    render(
      <ReceiptViewer
        {...defaults}
        receiptData={{ url: 'https://storage.test/file', contentType: 'image/png' }}
      />,
      { wrapper }
    );
    expect(screen.getByTestId('receipt-file-name')).toHaveTextContent(/^Receipt$/);
    expect(screen.getByTestId('receipt-viewer-container').textContent).not.toContain(key);
  });

  it('shows loading and unavailable states without offering a usable View or Download action', () => {
    const { rerender } = render(
      <ReceiptViewer {...defaults} receiptData={undefined} isLoadingReceipt />,
      { wrapper }
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading receipt');
    expect(screen.getByRole('button', { name: 'View' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
    rerender(<ReceiptViewer {...defaults} receiptData={{ status: 'unavailable' }} />);
    expect(screen.getByTestId('receipt-legacy-unavailable')).toHaveTextContent(
      'Supporting document unavailable'
    );
    expect(screen.getByRole('button', { name: 'View' })).toBeDisabled();
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
    expect(screen.queryByRole('link', { name: 'Download' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('btn-retry-receipt'));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('opens a read-only receipt preview without document-detail or document-download requests', async () => {
    const fetch = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    try {
      render(<ReceiptViewer {...defaults} />, { wrapper });
      fireEvent.click(screen.getByRole('button', { name: 'View' }));
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
