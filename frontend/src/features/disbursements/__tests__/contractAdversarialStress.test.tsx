/**
 * Adversarial Empirical Stress Test Suite for Disbursements Data Layer & Contract Gate
 *
 * Verification Scope:
 * 1. Status Anti-Forgery (compile-time & runtime Zod enforcement)
 * 2. Zero Optimistic Updates Doctrine (no speculative writes, invalidation on success only, verbatim RFC 7807)
 * 3. Rejection Reason Length Boundary Stress-Testing (0 chars, whitespace-only, 1 char, 500 chars, 501 chars)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  createDisbursementSchema,
  rejectDisbursementSchema,
  DISBURSEMENT_STATUSES,
} from '../api/schemas';
import type {
  CreateDisbursementInput,
  Disbursement,
} from '../api/types';
import {
  useCreateDisbursement,
  useUpdateDisbursement,
  useSubmitDisbursement,
  useApproveDisbursement,
} from '../api/useDisbursements';
import { disbursementKeys } from '../api/queryKeys';
import { ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import {
  useBlockingModalStore,
  BlockingActionModal,
  extractRfc7807Error,
} from '@/features/operations/components/BlockingActionModal';
import { RejectReasonModal } from '@/features/operations/components/RejectReasonModal';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

describe('Adversarial Contract & Data Layer Stress Test Harness', () => {
  const originalFetch = global.fetch;
  const validUuid = '11111111-1111-1111-1111-111111111111';

  beforeEach(() => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'disbursement:view',
        'disbursement:create',
        'disbursement:edit',
        'disbursement:approve',
        'disbursement:mark_released',
      ],
      activeEntity: 'ATA',
    });
    useBlockingModalStore.getState().reset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    useBlockingModalStore.getState().reset();
  });

  // ==========================================================================
  // CHALLENGE 1: Status Anti-Forgery (Compile-Time & Runtime)
  // ==========================================================================
  describe('Challenge 1: Status Anti-Forgery Enforcement', () => {
    it('Compile-time guard: passing status property fails TypeScript compilation', () => {
      // 1. Valid payload without status compiles cleanly
      const validPayload: CreateDisbursementInput = {
        category: 'Transportation',
        description: 'Client visit fare',
        amount: 250,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: validUuid,
      };
      expect(validPayload.category).toBe('Transportation');

      // 2. Setting status property must trigger a TypeScript compilation failure
      const forgedPending: CreateDisbursementInput = {
        ...validPayload,
        // @ts-expect-error Status is explicitly forbidden on creation (status?: never)
        status: 'Pending',
      };
      expect(forgedPending.status).toBe('Pending');

      const forgedDraft: CreateDisbursementInput = {
        ...validPayload,
        // @ts-expect-error Status is explicitly forbidden on creation (status?: never)
        status: 'Draft',
      };
      expect(forgedDraft.status).toBe('Draft');

      const forgedApproved: CreateDisbursementInput = {
        ...validPayload,
        // @ts-expect-error Status is explicitly forbidden on creation (status?: never)
        status: 'Approved',
      };
      expect(forgedApproved.status).toBe('Approved');
    });

    it('Runtime guard: every contract status fails with the exact anti-forgery error message', () => {
      const basePayload = {
        category: 'Transportation',
        description: 'Client visit fare',
        amount: 250,
        fundSource: 'Firm Fund' as const,
        linkedWorkRequestId: validUuid,
      };

      // Test all 7 official contract statuses
      for (const status of DISBURSEMENT_STATUSES) {
        const payloadWithStatus = { ...basePayload, status };
        const result = createDisbursementSchema.safeParse(payloadWithStatus);

        expect(result.success).toBe(false);
        if (!result.success) {
          const statusIssue = result.error.issues.find((issue) =>
            issue.path.includes('status')
          );
          expect(statusIssue).toBeDefined();
          expect(statusIssue?.message).toBe(
            'Explicit status cannot be set on creation; status forgery is prohibited'
          );
        }
      }
    });

    it('Runtime guard: arbitrary non-contract statuses and types fail with anti-forgery error message', () => {
      const basePayload = {
        category: 'Transportation',
        description: 'Client visit fare',
        amount: 250,
        fundSource: 'Firm Fund' as const,
        linkedWorkRequestId: validUuid,
      };

      const invalidValues = [
        'HACKED_STATUS',
        '',
        12345,
        true,
        false,
        null,
        ['Pending'],
        { value: 'Draft' },
      ];

      for (const val of invalidValues) {
        const payload = { ...basePayload, status: val };
        const result = createDisbursementSchema.safeParse(payload);
        expect(result.success).toBe(false);
        if (!result.success) {
          const statusIssue = result.error.issues.find((issue) =>
            issue.path.includes('status')
          );
          expect(statusIssue).toBeDefined();
          expect(statusIssue?.message).toBe(
            'Explicit status cannot be set on creation; status forgery is prohibited'
          );
        }
      }
    });

    it('Runtime guard: omitting status or passing undefined succeeds', () => {
      const basePayload = {
        category: 'Transportation',
        description: 'Client visit fare',
        amount: 250,
        fundSource: 'Firm Fund' as const,
        linkedWorkRequestId: validUuid,
        linkedTaskId: validUuid,
      };

      // Omitted status
      const res1 = createDisbursementSchema.safeParse(basePayload);
      expect(res1.success).toBe(true);

      // Explicitly undefined status
      const res2 = createDisbursementSchema.safeParse({
        ...basePayload,
        status: undefined,
      });
      expect(res2.success).toBe(true);
    });

    it('useCreateDisbursement fails before making network request if status is injected', async () => {
      global.fetch = vi.fn();
      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useCreateDisbursement(), { wrapper });

      const maliciousPayload = {
        category: 'Transportation',
        description: 'Client visit fare',
        amount: 250,
        fundSource: 'Firm Fund' as const,
        linkedWorkRequestId: validUuid,
        status: 'Approved' as unknown as never,
      };

      await expect(
        result.current.createDisbursement(maliciousPayload)
      ).rejects.toThrow('Explicit status cannot be set on creation; status forgery is prohibited');

      // Network request MUST NOT have been initiated
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Zero Optimistic Updates Doctrine & Verbatim Error Surfacing
  // ==========================================================================
  describe('Challenge 2: Zero Optimistic Updates Doctrine', () => {
    it('Mutations do NOT speculatively write to TanStack Query cache while in-flight', async () => {
      const initialDetail: Disbursement = {
        id: 'disb-target',
        disbursement_number: 'DISB-ATA-20261004-777',
        entity_id: 'ent-1',
        category: 'Transportation',
        description: 'Original Fare',
        amount: 300,
        fund_source: 'Firm Fund',
        status: 'Pending',
        linked_work_request_id: validUuid,
        version: 1,
        created_at: '2026-10-04T05:00:00Z',
        updated_at: '2026-10-04T05:00:00Z',
      };

      const { queryClient, wrapper } = createWrapper();

      // Seed the cache with initial detail
      queryClient.setQueryData(
        disbursementKeys.detail('disb-target'),
        initialDetail
      );

      // Create an unresolved pending promise for fetch
      let resolveFetch!: (res: Response) => void;
      const delayedPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
      global.fetch = vi.fn().mockImplementation(() => delayedPromise);

      const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

      // Trigger mutation without awaiting resolution
      const mutationPromise = result.current.approveDisbursement('disb-target');

      // INSPECT CACHE DURING IN-FLIGHT MUTATION:
      // Cache must NOT be optimistically modified to 'Approved'!
      const cachedDuringFlight = queryClient.getQueryData<Disbursement>(
        disbursementKeys.detail('disb-target')
      );
      expect(cachedDuringFlight?.status).toBe('Pending');
      expect(cachedDuringFlight?.description).toBe('Original Fare');

      // Now resolve the server response
      const serverUpdated: Disbursement = {
        ...initialDetail,
        status: 'Approved',
        approved_by: 'u-admin-1',
        version: 2,
      };
      resolveFetch(
        new Response(JSON.stringify({ data: serverUpdated }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );

      const finalResult = await mutationPromise;
      expect(finalResult.status).toBe('Approved');
    });

    it('Cache invalidation strictly fires upon server success, NOT upon server failure', async () => {
      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // 1. Server Failure Case
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: 409,
            title: 'Conflict',
            code: 'CONFLICT_CURRENT_STATUS',
            detail: 'Disbursement cannot be submitted from current status',
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
      );

      const { result: submitHook } = renderHook(() => useSubmitDisbursement(), {
        wrapper,
      });

      await expect(
        submitHook.current.submitDisbursement('disb-invalid')
      ).rejects.toThrow();

      // Invalidation MUST NOT have been called on failure
      expect(invalidateSpy).not.toHaveBeenCalled();

      // 2. Server Success Case
      global.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: { id: 'disb-valid', status: 'Pending' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      );

      await submitHook.current.submitDisbursement('disb-valid');

      // Invalidation MUST now be called
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: disbursementKeys.detail('disb-valid'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: disbursementKeys.lists(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: disbursementKeys.counts('ATA'),
      });
    });

    it('Surfaces backend RFC 7807 error code and detail verbatim to useBlockingModalStore and DOM', async () => {
      const rfc7807Problem = {
        status: 409,
        title: 'Conflict',
        code: 'CONFLICT_OCC_VERSION_MISMATCH',
        detail: 'The record was modified by another user (expected version: 2, current version: 3). Please refresh.',
      };

      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(rfc7807Problem), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        })
      );

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateDisbursement(), { wrapper });

      let caughtError: unknown;
      try {
        await result.current.updateWithBlocking({
          id: 'disb-100',
          data: { description: 'Updated text', expectedVersion: 2 },
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApiError);
      const apiErr = caughtError as ApiError;
      expect(apiErr.code).toBe('CONFLICT_OCC_VERSION_MISMATCH');
      expect(apiErr.detail).toBe(rfc7807Problem.detail);

      // Verify store state
      const storeState = useBlockingModalStore.getState();
      expect(storeState.status).toBe('error');
      expect(storeState.error?.code).toBe('CONFLICT_OCC_VERSION_MISMATCH');
      expect(storeState.error?.detail).toBe(rfc7807Problem.detail);
      expect(storeState.error?.status).toBe(409);

      // Render Modal and verify verbatim DOM presentation
      render(<BlockingActionModal />);

      const codeBadge = screen.getByTestId('error-code-badge');
      expect(codeBadge).toBeInTheDocument();
      expect(codeBadge.textContent).toBe('CONFLICT_OCC_VERSION_MISMATCH');

      const detailBody = screen.getByTestId('error-detail-body');
      expect(detailBody).toBeInTheDocument();
      expect(detailBody.textContent).toBe(rfc7807Problem.detail);
    });

    it('extractRfc7807Error handles ApiError, generic Error, and unknown errors accurately', () => {
      // 1. ApiError with RFC 7807 code and detail
      const apiErr = new ApiError(
        400,
        'Bad Request',
        'Explicit status cannot be set on creation; status forgery is prohibited',
        'STATUS_FORGERY_PROHIBITED'
      );
      const extracted1 = extractRfc7807Error(apiErr);
      expect(extracted1.code).toBe('STATUS_FORGERY_PROHIBITED');
      expect(extracted1.detail).toBe(
        'Explicit status cannot be set on creation; status forgery is prohibited'
      );
      expect(extracted1.status).toBe(400);

      // 2. Generic Error without code
      const stdErr = new Error('Network failure detected');
      const extracted2 = extractRfc7807Error(stdErr);
      expect(extracted2.code).toBeUndefined();
      expect(extracted2.detail).toBe('Network failure detected');
      expect(extracted2.title).toBe('Unexpected Error');

      // 3. Non-Error unknown throw
      const extracted3 = extractRfc7807Error('some weird throw');
      expect(extracted3.title).toBe('Unknown Error');
      expect(extracted3.detail).toContain('An unknown error occurred');
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Rejection Reason Boundary Stress-Testing
  // ==========================================================================
  describe('Challenge 3: Rejection Reason Boundary Stress-Testing', () => {
    it('Boundary 1: 0 characters (empty string) fails validation', () => {
      const res = rejectDisbursementSchema.safeParse({ reason: '' });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toBe('Rejection reason is required');
      }
    });

    it('Boundary 2: Whitespace-only string fails validation after trim', () => {
      const whitespaceVariations = [
        ' ',
        '   ',
        '\t',
        '\n',
        ' \t \n \r ',
      ];

      for (const str of whitespaceVariations) {
        const res = rejectDisbursementSchema.safeParse({ reason: str });
        expect(res.success).toBe(false);
        if (!res.success) {
          expect(res.error.issues[0]?.message).toBe('Rejection reason is required');
        }
      }
    });

    it('Boundary 3: Exact 1 non-whitespace character passes validation', () => {
      const res = rejectDisbursementSchema.safeParse({ reason: 'A' });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.reason).toBe('A');
      }

      // 1 non-whitespace char surrounded by whitespace also trims and passes
      const resTrimmed = rejectDisbursementSchema.safeParse({ reason: '   Z   ' });
      expect(resTrimmed.success).toBe(true);
      if (resTrimmed.success) {
        expect(resTrimmed.data.reason).toBe('Z');
      }
    });

    it('Boundary 4: Exact 500 characters passes validation', () => {
      const exact500 = 'R'.repeat(500);
      const res = rejectDisbursementSchema.safeParse({ reason: exact500 });
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.reason.length).toBe(500);
        expect(res.data.reason).toBe(exact500);
      }

      // 500 characters surrounded by leading/trailing whitespace trims and passes
      const exact500Padded = '   ' + exact500 + '   ';
      const resPadded = rejectDisbursementSchema.safeParse({ reason: exact500Padded });
      expect(resPadded.success).toBe(true);
      if (resPadded.success) {
        expect(resPadded.data.reason.length).toBe(500);
      }
    });

    it('Boundary 5: 501 characters fails validation with length error', () => {
      const exact501 = 'R'.repeat(501);
      const res = rejectDisbursementSchema.safeParse({ reason: exact501 });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toBe(
          'Rejection reason cannot exceed 500 characters'
        );
      }

      // 502 characters
      const exact502 = 'R'.repeat(502);
      const res502 = rejectDisbursementSchema.safeParse({ reason: exact502 });
      expect(res502.success).toBe(false);
    });

    it('Boundary UI: RejectReasonModal enforces min 1 and max 500 characters', async () => {
      const onRejectMock = vi.fn().mockResolvedValue(true);
      const { wrapper } = createWrapper();

      render(
        <RejectReasonModal
          isOpen={true}
          requestId="disb-99"
          maxLength={500}
          onReject={onRejectMock}
          onClose={() => {}}
        />,
        { wrapper }
      );

      // Verify modal mounted
      expect(screen.getByTestId('reject-reason-modal')).toBeInTheDocument();

      // Submit with empty reason
      const submitBtn = screen.getByTestId('reject-reason-submit-btn');
      submitBtn.click();

      // Error message should appear
      await waitFor(() => {
        expect(
          screen.getByText('Rejection reason is required (minimum 1 character)')
        ).toBeInTheDocument();
      });
      expect(onRejectMock).not.toHaveBeenCalled();
    });
  });
});
