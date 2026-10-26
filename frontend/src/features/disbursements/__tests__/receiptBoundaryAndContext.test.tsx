import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { uploadReceiptFile } from '../api/useDisbursements';
import { useLiveModalContext } from '../lib/useLiveModalContext';
import { useSessionStore } from '@/lib/session';

const originalFetch = globalThis.fetch;
const validReservation = {
  uploadId: 'receipt-1', uploadUrl: 'https://storage.test/put',
  objectKey: 'entities/ATA/receipts/example.pdf', expiresAt: '2026-10-20T12:00:00Z',
};
const file = () => new File(['%PDF-example'], 'example.pdf', { type: 'application/pdf' });
const jsonResponse = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) }) as Response;

beforeEach(() => {
  vi.restoreAllMocks();
  useSessionStore.setState({ activeEntity: 'ATA' });
});
afterEach(() => { globalThis.fetch = originalFetch; });

describe('Verified receipt boundaries', () => {
  it.each([
    {},
    { ...validReservation, uploadId: '' },
    { ...validReservation, uploadUrl: '' },
    { ...validReservation, objectKey: '' },
    { ...validReservation, uploadUrl: 'javascript:alert(1)' },
  ])('rejects an incomplete reservation before binary upload (%j)', async (data) => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(data));
    globalThis.fetch = fetch;
    await expect(uploadReceiptFile(file())).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { receiptS3Key: '', receiptFilename: 'example.pdf' }, { receiptS3Key: 'different-key', receiptFilename: 'example.pdf' }])(
    'rejects missing or mismatched completed metadata (%j)', async (completion) => {
      const fetch = vi.fn().mockResolvedValueOnce(jsonResponse(validReservation))
        .mockResolvedValueOnce({ ok: true, status: 200 })
        .mockResolvedValueOnce(jsonResponse(completion));
      globalThis.fetch = fetch;
      await expect(uploadReceiptFile(file())).rejects.toThrow();
      expect(fetch).toHaveBeenCalledTimes(3);
    }
  );

  it('does not upload or complete against a changed form context', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse(validReservation));
    globalThis.fetch = fetch;
    await expect(uploadReceiptFile(file(), () => false)).rejects.toThrow('form changed');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Async modal lifecycle', () => {
  it('allows its own authoritative version update, invalidates a new record, and invalidates unmount', () => {
    const { result, rerender, unmount } = renderHook(
      ({ id, version }) => useLiveModalContext({ isOpen: true, disbursementId: id, version }),
      { initialProps: { id: 'first', version: 1 } }
    );
    const first = result.current.captureContext();
    rerender({ id: 'first', version: 2 });
    expect(first.isStale()).toBe(false);
    expect(first.startVersion).toBe(1);
    rerender({ id: 'second', version: 1 });
    expect(first.isStale()).toBe(true);
    const second = result.current.captureContext();
    unmount();
    expect(second.isStale()).toBe(true);
  });
});
