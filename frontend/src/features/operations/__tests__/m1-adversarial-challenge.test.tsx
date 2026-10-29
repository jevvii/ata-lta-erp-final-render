import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import {
  phaseEnum,
  creatablePhaseEnum,
  createTaskSchema,
  updateTaskSchema,
  createWorkRequestSchema,
  phaseTaskInputSchema,
  createPhaseTransitionRequestSchema,
  resolveTransitionRequestSchema,
  rerouteSchema,
} from '../api/schemas';
import {
  BlockingActionModal,
  useBlockingModalStore,
  runBlockingAction,
  extractRfc7807Error,
} from '../components/BlockingActionModal';
import { ApiError } from '@/lib/api';
import {
  parseTaskDelimiterInput,
  validateDependencies,
} from './e2e/e2e-contracts';

describe('Milestone 1 Adversarial Challenge & Boundary Stress Suite', () => {
  beforeEach(() => {
    useBlockingModalStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // AREA 1: ZOD SCHEMAS & DOMAIN BOUNDARY CONDITIONS
  // ==========================================================================
  describe('Area 1: Zod Schemas & Domain Boundary Conditions', () => {
    describe('1.1 Phase Enumeration & Creatable Phase Boundaries', () => {
      it('phaseEnum strictly accepts only the 4 canonical phases', () => {
        expect(phaseEnum.safeParse('pre_processing').success).toBe(true);
        expect(phaseEnum.safeParse('processing').success).toBe(true);
        expect(phaseEnum.safeParse('quality_assurance').success).toBe(true);
        expect(phaseEnum.safeParse('completion').success).toBe(true);

        // Adversarial values
        expect(phaseEnum.safeParse('planning').success).toBe(false);
        expect(phaseEnum.safeParse('qa').success).toBe(false);
        expect(phaseEnum.safeParse('completed').success).toBe(false);
        expect(phaseEnum.safeParse('PRE_PROCESSING').success).toBe(false);
        expect(phaseEnum.safeParse('').success).toBe(false);
        expect(phaseEnum.safeParse(null).success).toBe(false);
        expect(phaseEnum.safeParse(123).success).toBe(false);
      });

      it('creatablePhaseEnum restricts creation to pre_processing and processing only', () => {
        expect(creatablePhaseEnum.safeParse('pre_processing').success).toBe(true);
        expect(creatablePhaseEnum.safeParse('processing').success).toBe(true);

        // Cannot create tasks directly in quality_assurance or completion
        expect(creatablePhaseEnum.safeParse('quality_assurance').success).toBe(false);
        expect(creatablePhaseEnum.safeParse('completion').success).toBe(false);
      });
    });

    describe('1.2 Task Phase Immutability Guards (TASK_PHASE_IMMUTABLE)', () => {
      it('createTaskSchema allows creatable phases but rejects QA and completion', () => {
        expect(
          createTaskSchema.safeParse({ title: 'Task 1', phase: 'pre_processing' }).success
        ).toBe(true);
        expect(
          createTaskSchema.safeParse({ title: 'Task 2', phase: 'processing' }).success
        ).toBe(true);
        expect(
          createTaskSchema.safeParse({ title: 'Task 3', phase: 'quality_assurance' }).success
        ).toBe(false);
        expect(
          createTaskSchema.safeParse({ title: 'Task 4', phase: 'completion' }).success
        ).toBe(false);
      });

      it('updateTaskSchema strictly rejects ANY attempt to mutate phase', () => {
        // Attempting to pass any phase value must fail
        const r1 = updateTaskSchema.safeParse({ phase: 'processing' });
        expect(r1.success).toBe(false);
        if (!r1.success) {
          expect(r1.error.issues[0]?.message).toMatch(/immutable/i);
        }

        const r2 = updateTaskSchema.safeParse({ phase: 'pre_processing' });
        expect(r2.success).toBe(false);

        const r3 = updateTaskSchema.safeParse({ phase: 'quality_assurance' });
        expect(r3.success).toBe(false);

        const r4 = updateTaskSchema.safeParse({ phase: 'completion' });
        expect(r4.success).toBe(false);

        const r5 = updateTaskSchema.safeParse({ phase: null });
        expect(r5.success).toBe(false);

        const r6 = updateTaskSchema.safeParse({ phase: '' });
        expect(r6.success).toBe(false);

        // When phase is omitted or explicitly undefined, update is permitted
        const rValid1 = updateTaskSchema.safeParse({ title: 'Updated Title' });
        expect(rValid1.success).toBe(true);

        const rValid2 = updateTaskSchema.safeParse({ title: 'Updated', phase: undefined });
        expect(rValid2.success).toBe(true);
      });
    });

    describe('1.3 Invalid UUID and Dependency Identifier Handling', () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';

      it('phaseTaskInputSchema rejects dependency identifier "0", empty string, or arrays containing them', () => {
        // "0" rejected
        expect(
          phaseTaskInputSchema.safeParse({ title: 'T', depends_on: '0' }).success
        ).toBe(false);

        // "" rejected
        expect(
          phaseTaskInputSchema.safeParse({ title: 'T', depends_on: '' }).success
        ).toBe(false);

        // Array containing "0" rejected
        expect(
          phaseTaskInputSchema.safeParse({ title: 'T', depends_on: [validUuid, '0'] }).success
        ).toBe(false);

        // Array containing "" rejected
        expect(
          phaseTaskInputSchema.safeParse({ title: 'T', depends_on: [validUuid, ''] }).success
        ).toBe(false);

        // Valid dependency passes
        expect(
          phaseTaskInputSchema.safeParse({ title: 'T', depends_on: validUuid }).success
        ).toBe(true);
        expect(
          phaseTaskInputSchema.safeParse({ title: 'T', depends_on: [validUuid] }).success
        ).toBe(true);
      });

      it('createWorkRequestSchema rejects malformed UUIDs on clientId and assignedTo', () => {
        // Valid UUID
        expect(
          createWorkRequestSchema.safeParse({ title: 'WR', clientId: validUuid, dueDate: '2026-12-31' }).success
        ).toBe(true);

        // Empty string preprocessed to null
        expect(
          createWorkRequestSchema.safeParse({ title: 'WR', clientId: '', dueDate: '2026-12-31' }).success
        ).toBe(true);

        // Invalid UUIDs
        expect(
          createWorkRequestSchema.safeParse({ title: 'WR', clientId: '0', dueDate: '2026-12-31' }).success
        ).toBe(false);
        expect(
          createWorkRequestSchema.safeParse({ title: 'WR', clientId: 'not-a-uuid', dueDate: '2026-12-31' }).success
        ).toBe(false);
        expect(
          createWorkRequestSchema.safeParse({ title: 'WR', assignedTo: 'not-a-uuid', dueDate: '2026-12-31' }).success
        ).toBe(false);
      });

      it('createPhaseTransitionRequestSchema rejects invalid work_request_id and missing phases', () => {
        // Missing work_request_id
        expect(
          createPhaseTransitionRequestSchema.safeParse({
            from_phase: 'pre_processing',
            to_phase: 'processing',
          }).success
        ).toBe(false);

        // Invalid UUID for work_request_id
        expect(
          createPhaseTransitionRequestSchema.safeParse({
            work_request_id: 'not-a-uuid',
            from_phase: 'pre_processing',
            to_phase: 'processing',
          }).success
        ).toBe(false);

        // Valid transition request
        expect(
          createPhaseTransitionRequestSchema.safeParse({
            work_request_id: validUuid,
            from_phase: 'pre_processing',
            to_phase: 'processing',
          }).success
        ).toBe(true);
      });

      it('resolveTransitionRequestSchema enforces mandatory non-empty rejectionReason on rejection', () => {
        // Rejected with reason -> valid
        expect(
          resolveTransitionRequestSchema.safeParse({
            status: 'rejected',
            rejectionReason: 'Missing tax document',
          }).success
        ).toBe(true);

        // Rejected with empty reason -> invalid
        expect(
          resolveTransitionRequestSchema.safeParse({
            status: 'rejected',
            rejectionReason: '',
          }).success
        ).toBe(false);

        // Rejected with whitespace reason -> invalid
        expect(
          resolveTransitionRequestSchema.safeParse({
            status: 'rejected',
            rejectionReason: '   ',
          }).success
        ).toBe(false);

        // Fulfilled without rejectionReason -> valid
        expect(
          resolveTransitionRequestSchema.safeParse({
            status: 'fulfilled',
          }).success
        ).toBe(true);
      });

      it('rerouteSchema enforces pre_processing or processing target and non-empty reason', () => {
        // Valid
        expect(
          rerouteSchema.safeParse({
            to_phase: 'pre_processing',
            reason: 'Quality audit failed on item 3',
          }).success
        ).toBe(true);

        // Invalid target phase
        expect(
          rerouteSchema.safeParse({
            to_phase: 'quality_assurance',
            reason: 'Reroute to QA',
          }).success
        ).toBe(false);

        // Empty reason -> invalid
        expect(
          rerouteSchema.safeParse({
            to_phase: 'pre_processing',
            reason: '   ',
          }).success
        ).toBe(false);
      });
    });
  });

  // ==========================================================================
  // AREA 2: DELIMITER TOKENIZATION & DEPENDENCY CYCLES ORACLES
  // ==========================================================================
  describe('Area 2: Delimiter Tokenizer Caps & Dependency Cycle Prevention', () => {
    describe('2.1 Delimiter Tokenizer Matrix and 50-Task Limit Cap', () => {
      it('returns single token without split when no delimiters or single token present', () => {
        const res = parseTaskDelimiterInput('Single Task Title');
        expect(res.tokens).toEqual(['Single Task Title']);
        expect(res.count).toBe(1);
        expect(res.shouldSplit).toBe(false);
        expect(res.exceedsLimit).toBe(false);
      });

      it('splits correctly on comma, semicolon, newline, and period-space', () => {
        const input = 'Task 1, Task 2; Task 3\nTask 4. Task 5';
        const res = parseTaskDelimiterInput(input);
        expect(res.tokens).toEqual(['Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5']);
        expect(res.count).toBe(5);
        expect(res.shouldSplit).toBe(true);
        expect(res.exceedsLimit).toBe(false);
      });

      it('does NOT split on decimal numbers like "Version 2.0" (period without space)', () => {
        const res = parseTaskDelimiterInput('Draft Version 2.0 Specification');
        expect(res.count).toBe(1);
        expect(res.shouldSplit).toBe(false);
        expect(res.tokens).toEqual(['Draft Version 2.0 Specification']);
      });

      it('handles exactly 50 tokens without exceeding limit', () => {
        const fiftyTasks = Array.from({ length: 50 }, (_, i) => `Task ${i + 1}`).join(', ');
        const res = parseTaskDelimiterInput(fiftyTasks);
        expect(res.count).toBe(50);
        expect(res.exceedsLimit).toBe(false);
        expect(res.shouldSplit).toBe(true);
      });

      it('flags exceedsLimit: true when input splits into >50 tokens (e.g. 51 and 75)', () => {
        const fiftyOneTasks = Array.from({ length: 51 }, (_, i) => `Item ${i + 1}`).join('\n');
        const res51 = parseTaskDelimiterInput(fiftyOneTasks);
        expect(res51.count).toBe(51);
        expect(res51.exceedsLimit).toBe(true);

        const seventyFiveTasks = Array.from({ length: 75 }, (_, i) => `Subtask ${i + 1}`).join('; ');
        const res75 = parseTaskDelimiterInput(seventyFiveTasks);
        expect(res75.count).toBe(75);
        expect(res75.exceedsLimit).toBe(true);
      });
    });

    describe('2.2 Dependency Cycle Detection Oracle', () => {
      it('validates linear and diamond DAGs without false positives', () => {
        // Linear DAG: A -> B -> C
        const linear = [
          { id: 'task-a', dependsOn: null },
          { id: 'task-b', dependsOn: 'task-a' },
          { id: 'task-c', dependsOn: 'task-b' },
        ];
        expect(validateDependencies(linear)).toEqual({ hasCycle: false });

        // Diamond DAG: A -> B, A -> C, B -> D, C -> D
        const diamond = [
          { id: 'task-a', dependsOn: null },
          { id: 'task-b', dependsOn: 'task-a' },
          { id: 'task-c', dependsOn: 'task-a' },
          { id: 'task-d', dependsOn: ['task-b', 'task-c'] },
        ];
        expect(validateDependencies(diamond)).toEqual({ hasCycle: false });
      });

      it('detects self-dependency (A -> A)', () => {
        const selfDep = [{ id: 'task-a', dependsOn: 'task-a' }];
        const res = validateDependencies(selfDep);
        expect(res.hasCycle).toBe(true);
        expect(res.error).toContain('Self-dependency detected');
      });

      it('detects direct 2-node cycle (A -> B -> A)', () => {
        const cycle = [
          { id: 'task-a', dependsOn: 'task-b' },
          { id: 'task-b', dependsOn: 'task-a' },
        ];
        const res = validateDependencies(cycle);
        expect(res.hasCycle).toBe(true);
        expect(res.error).toMatch(/Circular dependency/);
      });

      it('detects indirect 3-node cycle (A -> B -> C -> A)', () => {
        const cycle3 = [
          { id: 'task-a', dependsOn: 'task-c' },
          { id: 'task-b', dependsOn: 'task-a' },
          { id: 'task-c', dependsOn: 'task-b' },
        ];
        const res = validateDependencies(cycle3);
        expect(res.hasCycle).toBe(true);
        expect(res.error).toMatch(/Circular dependency/);
      });

      it('detects cycle in a disconnected subgraph', () => {
        const disconnected = [
          { id: 'ok-1', dependsOn: null },
          { id: 'ok-2', dependsOn: 'ok-1' },
          { id: 'bad-1', dependsOn: 'bad-2' },
          { id: 'bad-2', dependsOn: 'bad-1' },
        ];
        const res = validateDependencies(disconnected);
        expect(res.hasCycle).toBe(true);
        expect(res.error).toMatch(/Circular dependency/);
      });

      it('detects large 50-node chain with 1 back-edge', () => {
        const nodes = Array.from({ length: 50 }, (_, i) => ({
          id: `t-${i + 1}`,
          dependsOn: i === 0 ? 't-50' : `t-${i}`, // t-1 depends on t-50, forming a 50-node cycle
        }));
        const res = validateDependencies(nodes);
        expect(res.hasCycle).toBe(true);
        expect(res.error).toMatch(/Circular dependency/);
      });

      it('flags non-existent dependency targets and invalid identifiers', () => {
        const missing = [{ id: 't-1', dependsOn: 't-nonexistent' }];
        expect(validateDependencies(missing).hasCycle).toBe(true);
        expect(validateDependencies(missing).error).toContain('does not exist');

        const zeroId = [{ id: 't-1', dependsOn: '0' }];
        expect(validateDependencies(zeroId).hasCycle).toBe(true);
        expect(validateDependencies(zeroId).error).toContain("Invalid dependency identifier '0'");
      });
    });
  });

  // ==========================================================================
  // AREA 3: ADVERSARIAL ERROR PARSING & BLOCKINGACTIONMODAL RESILIENCE
  // ==========================================================================
  describe('Area 3: Adversarial Error Parsing & BlockingActionModal Resilience', () => {
    it('surfaces RFC 7807 problem code in badge and detail in body verbatim', () => {
      const err = new ApiError(
        409,
        'Conflict',
        'Cannot transition to completion: 3 tasks incomplete in QA phase',
        'GATE_PREREQUISITE_FAILED'
      );

      const extracted = extractRfc7807Error(err);
      expect(extracted.code).toBe('GATE_PREREQUISITE_FAILED');
      expect(extracted.detail).toBe(
        'Cannot transition to completion: 3 tasks incomplete in QA phase'
      );
      expect(extracted.status).toBe(409);

      useBlockingModalStore.getState().openLoading({ title: 'Advancing Phase', message: '...' });
      useBlockingModalStore.getState().setError(extracted);

      render(React.createElement(BlockingActionModal));

      const badge = screen.getByTestId('error-code-badge');
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toBe('GATE_PREREQUISITE_FAILED');

      const body = screen.getByTestId('error-detail-body');
      expect(body).toBeInTheDocument();
      expect(body.textContent).toBe(
        'Cannot transition to completion: 3 tasks incomplete in QA phase'
      );
    });

    it('gracefully handles empty error code without rendering broken badge or crashing', () => {
      const err = new ApiError(400, 'Bad Request', 'Malformed request body', '');
      const extracted = extractRfc7807Error(err);

      expect(extracted.code).toBe('');
      expect(extracted.detail).toBe('Malformed request body');

      useBlockingModalStore.getState().openLoading({ title: 'Submitting', message: '...' });
      useBlockingModalStore.getState().setError(extracted);

      render(React.createElement(BlockingActionModal));

      // Badge should not be rendered when code is empty string
      expect(screen.queryByTestId('error-code-badge')).not.toBeInTheDocument();

      // Detail is rendered correctly
      const body = screen.getByTestId('error-detail-body');
      expect(body).toBeInTheDocument();
      expect(body.textContent).toBe('Malformed request body');
    });

    it('gracefully handles missing code (undefined) on 500 server error', () => {
      const err = new ApiError(500, 'Internal Server Error', 'Database deadlock encountered');
      const extracted = extractRfc7807Error(err);

      expect(extracted.code).toBeUndefined();
      expect(extracted.title).toBe('Server Error');
      expect(extracted.detail).toBe('Database deadlock encountered');

      useBlockingModalStore.getState().openLoading({ title: 'Saving', message: '...' });
      useBlockingModalStore.getState().setError(extracted);

      render(React.createElement(BlockingActionModal));

      expect(screen.queryByTestId('error-code-badge')).not.toBeInTheDocument();
      expect(screen.getByText('Database deadlock encountered')).toBeInTheDocument();
    });

    it('extracts and renders non-standard Error instances without crashing', () => {
      const standardError = new TypeError('Failed to fetch resource');
      const extracted = extractRfc7807Error(standardError);

      expect(extracted.title).toBe('Unexpected Error');
      expect(extracted.detail).toBe('Failed to fetch resource');

      useBlockingModalStore.getState().openLoading({ title: 'Loading', message: '...' });
      useBlockingModalStore.getState().setError(extracted);

      render(React.createElement(BlockingActionModal));
      expect(screen.getByText('Failed to fetch resource')).toBeInTheDocument();
    });

    it('safely handles non-object and null errors thrown in pipeline', () => {
      const extractedNull = extractRfc7807Error(null);
      expect(extractedNull.title).toBe('Unknown Error');
      expect(extractedNull.detail).toBe('An unknown error occurred during the transaction.');

      const extractedString = extractRfc7807Error('Connection dropped by peer');
      expect(extractedString.title).toBe('Unknown Error');
      expect(extractedString.detail).toBe('An unknown error occurred during the transaction.');

      useBlockingModalStore.getState().openLoading({ title: 'Action', message: '...' });
      useBlockingModalStore.getState().setError(extractedString);

      render(React.createElement(BlockingActionModal));
      expect(
        screen.getByText('An unknown error occurred during the transaction.')
      ).toBeInTheDocument();
    });

    it('renders multi-line error details cleanly with whitespace-pre-wrap', () => {
      const multilineDetail = 'Validation Errors:\n- Title is required\n- Assignee must be assigned';
      const err = new ApiError(400, 'Validation Error', multilineDetail, 'VALIDATION_FAILED');

      useBlockingModalStore.getState().openLoading({ title: 'Validation', message: '...' });
      useBlockingModalStore.getState().setError(extractRfc7807Error(err));

      render(React.createElement(BlockingActionModal));

      const body = screen.getByTestId('error-detail-body');
      expect(body.textContent).toBe(multilineDetail);
    });
  });

  // ==========================================================================
  // AREA 4: WATCHDOG BEHAVIOR UNDER SIMULATED NETWORK HANGS
  // ==========================================================================
  describe('Area 4: Watchdog Behavior Under Simulated Network Hangs', () => {
    it('aborts hanging network request at configured watchdog timeout and surfaces WATCHDOG_TIMEOUT', async () => {
      vi.useFakeTimers();

      let signalObserved: AbortSignal | null = null;

      try {
        const hangingPromise = runBlockingAction({
          title: 'Advancing Phase to Completion',
          message: 'Validating gate completion...',
          timeoutMs: 5000, // 5s watchdog
          apiCall: (signal) => {
            signalObserved = signal;
            return new Promise((_resolve, _reject) => {
              // Never settles (simulating network hang)
            });
          },
        });

        expect(signalObserved).not.toBeNull();
        expect((signalObserved as AbortSignal | null)?.aborted).toBe(false);

        // Advance fake timer by 5000ms
        vi.advanceTimersByTime(5000);

        await expect(hangingPromise).rejects.toSatisfy((err: unknown) => {
          expect(err).toBeInstanceOf(ApiError);
          const apiErr = err as ApiError;
          expect(apiErr.status).toBe(504);
          expect(apiErr.code).toBe('WATCHDOG_TIMEOUT');
          expect(apiErr.detail).toContain('The operation timed out after 5 seconds');
          return true;
        });

        // Verify signal was aborted
        expect((signalObserved as AbortSignal | null)?.aborted).toBe(true);

        // Verify store transitioned to error with WATCHDOG_TIMEOUT
        const state = useBlockingModalStore.getState();
        expect(state.status).toBe('error');
        expect(state.error?.code).toBe('WATCHDOG_TIMEOUT');
        expect(state.error?.status).toBe(504);
        expect(state.isLocked).toBe(false); // Mutex unlocked after timeout
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears watchdog timer if network request settles before timeout', async () => {
      vi.useFakeTimers();
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      try {
        const fastPromise = runBlockingAction({
          title: 'Quick Operation',
          message: 'Saving...',
          timeoutMs: 30000,
          apiCall: async () => {
            return { success: true };
          },
        });

        const result = await fastPromise;
        expect(result).toEqual({ success: true });
        expect(clearTimeoutSpy).toHaveBeenCalled();
        expect(useBlockingModalStore.getState().isOpen).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('enforces mutex concurrency lock while request is in-flight, preventing parallel corruption', async () => {
      // In-flight operation
      useBlockingModalStore.getState().openLoading({
        title: 'Primary Operation',
        message: 'In flight...',
      });

      // Attempt second operation
      await expect(
        runBlockingAction({
          title: 'Secondary Corrupting Operation',
          message: 'Attempting...',
          apiCall: async () => ({ corrupted: true }),
        })
      ).rejects.toThrow('Another operation is already in progress. Please wait.');

      // Once first operation finishes, subsequent operations are permitted
      useBlockingModalStore.getState().close();

      const secondPromise = runBlockingAction({
        title: 'Subsequent Allowed Operation',
        message: 'Running...',
        apiCall: async () => 'success',
      });

      const res = await secondPromise;
      expect(res).toBe('success');
    });

    it('watchdog timeout unlocks mutex allowing user retry or recovery actions', async () => {
      vi.useFakeTimers();

      try {
        const hanging = runBlockingAction({
          title: 'Hanging Action',
          message: 'Running...',
          timeoutMs: 2000,
          apiCall: () => new Promise(() => {}),
        });

        // Mutex is locked while in-flight
        expect(useBlockingModalStore.getState().isLocked).toBe(true);

        vi.advanceTimersByTime(2000);
        await expect(hanging).rejects.toThrow();

        // Mutex is unlocked after timeout error
        expect(useBlockingModalStore.getState().isLocked).toBe(false);
        expect(useBlockingModalStore.getState().status).toBe('error');

        // User can now execute a retry action
        let retried = false;
        const retryCall = runBlockingAction({
          title: 'Recovery Action',
          message: 'Retrying...',
          apiCall: async () => {
            retried = true;
            return true;
          },
        });

        await expect(retryCall).resolves.toBe(true);
        expect(retried).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
