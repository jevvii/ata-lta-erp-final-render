import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeReceiptMimeType,
  isValidReceiptMimeType,
  useDisbursementReceiptUrl,
} from '../api/useDisbursements';
import { isDisbursementReceiptDocument } from '@/features/documents/api/useDocuments';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

describe('Receipt MIME Normalization & DMS Isolation', () => {
  describe('normalizeReceiptMimeType', () => {
    it('normalizes standard MIME types', () => {
      expect(normalizeReceiptMimeType('application/pdf')).toBe('application/pdf');
      expect(normalizeReceiptMimeType('image/png')).toBe('image/png');
      expect(normalizeReceiptMimeType('image/jpeg')).toBe('image/jpeg');
    });

    it('normalizes image/jpg and image/pjpeg variants to image/jpeg', () => {
      expect(normalizeReceiptMimeType('image/jpg')).toBe('image/jpeg');
      expect(normalizeReceiptMimeType('image/pjpeg')).toBe('image/jpeg');
      expect(normalizeReceiptMimeType('IMAGE/JPG')).toBe('image/jpeg');
      expect(normalizeReceiptMimeType('IMAGE/JPEG')).toBe('image/jpeg');
    });

    it('infers MIME from filename when MIME is missing or empty', () => {
      expect(normalizeReceiptMimeType('', 'receipt.jpg')).toBe('image/jpeg');
      expect(normalizeReceiptMimeType('', 'scan.JPEG')).toBe('image/jpeg');
      expect(normalizeReceiptMimeType('', 'invoice.png')).toBe('image/png');
      expect(normalizeReceiptMimeType('', 'document.PDF')).toBe('application/pdf');
    });
  });

  describe('isValidReceiptMimeType', () => {
    it('accepts valid PDF, PNG, and JPEG formats', () => {
      expect(isValidReceiptMimeType('application/pdf', 'file.pdf')).toBe(true);
      expect(isValidReceiptMimeType('image/png', 'file.png')).toBe(true);
      expect(isValidReceiptMimeType('image/jpeg', 'file.jpg')).toBe(true);
      expect(isValidReceiptMimeType('image/jpg', 'file.jpg')).toBe(true);
      expect(isValidReceiptMimeType('', 'file.jpg')).toBe(true);
      expect(isValidReceiptMimeType('', 'file.jpeg')).toBe(true);
      expect(isValidReceiptMimeType('', 'file.png')).toBe(true);
      expect(isValidReceiptMimeType('', 'file.pdf')).toBe(true);
    });

    it('rejects unsupported file formats', () => {
      expect(isValidReceiptMimeType('image/gif', 'file.gif')).toBe(false);
      expect(isValidReceiptMimeType('application/msword', 'file.doc')).toBe(false);
      expect(isValidReceiptMimeType('text/plain', 'file.txt')).toBe(false);
      expect(isValidReceiptMimeType('', 'file.exe')).toBe(false);
    });
  });

  describe('isDisbursementReceiptDocument (DMS exclusion)', () => {
    it('identifies disbursement receipts by storage path', () => {
      expect(
        isDisbursementReceiptDocument({
          storage_path: 'entities/ATA/disbursements/receipts/uuid-test.pdf',
        })
      ).toBe(true);
      expect(
        isDisbursementReceiptDocument({
          storage_path: 'entities/LTA/disbursements/receipts/abc-receipt.png',
        })
      ).toBe(true);
      expect(
        isDisbursementReceiptDocument({
          storage_path: 'entities/ATA/disbursements/uuid-receipt.jpeg',
        })
      ).toBe(true);
    });

    it('identifies disbursement receipts by category or document type', () => {
      expect(
        isDisbursementReceiptDocument({
          storage_path: 'entities/ATA/documents/file.pdf',
          category: 'Receipt',
        })
      ).toBe(true);
      expect(
        isDisbursementReceiptDocument({
          storage_path: 'entities/ATA/documents/file.pdf',
          category: 'receipts',
        })
      ).toBe(true);
      expect(
        isDisbursementReceiptDocument({
          storage_path: 'entities/ATA/documents/file.pdf',
          document_type: 'disbursement_receipt',
        })
      ).toBe(true);
    });

    it('does not flag normal DMS documents', () => {
      expect(
        isDisbursementReceiptDocument({
          storage_path: 'entities/ATA/documents/dms-upload-uuid-tax.pdf',
          category: 'BIR',
          document_type: 'TAX_DECLARATION',
        })
      ).toBe(false);
      expect(
        isDisbursementReceiptDocument({
          storage_path: 'entities/LTA/documents/sec-registration.pdf',
          category: 'SEC',
          document_type: 'REGISTRATION',
        })
      ).toBe(false);
    });
  });

  describe('useDisbursementReceiptUrl entity parameter', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('passes entity header when entity is provided in options', async () => {
      let capturedHeaders: Record<string, string> = {};
      global.fetch = vi.fn().mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> || {};
        capturedHeaders = { ...headers };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              url: 'https://storage.test/receipt.png',
              filename: 'receipt.png',
              contentType: 'image/png',
            },
          }),
        };
      });

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children);

      const { result } = renderHook(
        () => useDisbursementReceiptUrl('test-disb-id', { entity: 'LTA' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(capturedHeaders['X-Active-Entity']).toBe('LTA');
      expect(result.current.data?.url).toBe('https://storage.test/receipt.png');
    });
  });
});
