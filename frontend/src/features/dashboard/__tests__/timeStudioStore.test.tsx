import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';
import {
  useTimeStudioStore,
  getLiveElapsedSeconds,
  formatStopwatch,
  TIME_STUDIO_STORAGE_KEY,
} from '../store/useTimeStudioStore';
import { LogTimeWidget, TimeStudioShellContext } from '../components/LogTimeWidget';
import { useSessionStore } from '@/lib/session';
import * as api from '@/lib/api';

describe('Time Studio Store & Chronometer Ticker', () => {
  let queryClient: QueryClient;

  const createWrapper = (inShell = false) => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
        mutations: { retry: false },
      },
    });
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        TimeStudioShellContext.Provider,
        { value: inShell },
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(BrowserRouter, null, children)
        )
      );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useTimeStudioStore.getState().resetAll();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-tester-1',
        email: 'test@ata-lta.ph',
        name: 'Tester User',
        role: 'Senior Accountant',
        departments: ['Taxation'],
        entities: ['ATA'],
      },
      permissions: ['timelog:create', 'timelog:view', 'timelog:edit_own'],
      unreadCount: 0,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default daylight state', () => {
    const state = useTimeStudioStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.selectedTaskId).toBe('');
    expect(state.durationMinutes).toBe(30);
    expect(state.isTimerRunning).toBe(false);
    expect(state.accumulatedSeconds).toBe(0);
    expect(state.timerStartedAt).toBeNull();
  });

  it('runs chronometer, accumulates elapsed time, and calculates duration upon pause', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const store = useTimeStudioStore.getState();
    store.startTimer();

    expect(useTimeStudioStore.getState().isTimerRunning).toBe(true);
    expect(useTimeStudioStore.getState().timerStartedAt).toBeTypeOf('number');

    act(() => {
      vi.advanceTimersByTime(125000); // 2 minutes and 5 seconds
    });

    const elapsed = getLiveElapsedSeconds(useTimeStudioStore.getState(), Date.now());
    expect(elapsed).toBe(125);
    expect(formatStopwatch(elapsed)).toBe('02:05');

    useTimeStudioStore.getState().pauseTimer();
    const pausedState = useTimeStudioStore.getState();
    expect(pausedState.isTimerRunning).toBe(false);
    expect(pausedState.timerStartedAt).toBeNull();
    expect(pausedState.accumulatedSeconds).toBe(125);
    // 125 seconds records exact 2 minutes and 5 seconds
    expect(pausedState.durationMinutes).toBe(2);
    expect(pausedState.durationSeconds).toBe(5);

    useTimeStudioStore.getState().resetTimer();
    expect(useTimeStudioStore.getState().accumulatedSeconds).toBe(0);
    expect(useTimeStudioStore.getState().durationSeconds).toBe(0);

    vi.useRealTimers();
  });

  it('pins task and opens studio', () => {
    useTimeStudioStore.getState().pinTask('task-xyz-999');
    const state = useTimeStudioStore.getState();
    expect(state.selectedTaskId).toBe('task-xyz-999');
    expect(state.isOpen).toBe(true);
  });

  it('syncs state across tabs via storage event', () => {
    const payload = JSON.stringify({
      state: {
        isOpen: true,
        selectedTaskId: 'task-cross-tab',
        durationMinutes: 45,
      },
    });

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: TIME_STUDIO_STORAGE_KEY,
          newValue: payload,
        })
      );
    });

    const state = useTimeStudioStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.selectedTaskId).toBe('task-cross-tab');
    expect(state.durationMinutes).toBe(45);
  });

  it('resets studio when session user changes', () => {
    useTimeStudioStore.getState().pinTask('task-confidential');
    useTimeStudioStore.getState().setDurationMinutes(90);

    // Switch user
    act(() => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-another-2',
          email: 'another@ata-lta.ph',
          name: 'Another User',
          role: 'Junior Accountant',
          departments: ['Audit'],
          entities: ['LTA'],
        },
        permissions: ['timelog:view'],
      });
    });

    const state = useTimeStudioStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.selectedTaskId).toBe('');
    expect(state.durationMinutes).toBe(30);
  });

  it('renders compact circular clock button when idle and morphs into green counting pill when running', async () => {
    vi.spyOn(api, 'apiRequest').mockImplementation(async () => {
      return { data: [] } as never;
    });

    // Render inside Shell where studio is initially closed
    render(<LogTimeWidget />, { wrapper: createWrapper(true) });

    // When idle: Compact circular Clock Icon button
    const idlePill = screen.getByTestId('floating-timer-pill');
    expect(idlePill).toBeInTheDocument();
    expect(idlePill).toHaveClass('rounded-full');
    expect(idlePill).toHaveAttribute('aria-label', expect.stringContaining('Task & Time Studio · 00:00'));

    // Start timer via store
    act(() => {
      useTimeStudioStore.getState().startTimer();
    });

    // When running: Morphs into green pulsing live counting pill
    const runningPill = screen.getByTestId('floating-timer-pill');
    expect(runningPill).toHaveClass('border-[#059669]');
    expect(runningPill).toHaveClass('bg-[#ECFDF5]');
    expect(runningPill).toHaveAttribute('aria-label', expect.stringContaining('Running'));

    // Clicking floating pill opens side peek
    fireEvent.click(runningPill);
    expect(useTimeStudioStore.getState().isOpen).toBe(true);
  });
});
