import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { workDate } from '@/lib/workDate';
import { useSessionStore } from '@/lib/session';

export const TIME_STUDIO_STORAGE_KEY = 'erp_time_studio_state_v1';

export interface TimeStudioState {
  isOpen: boolean;
  selectedTaskId: string;
  selectedDate: string;
  durationMinutes: number;
  durationSeconds: number;
  note: string;
  isTimerRunning: boolean;
  timerStartedAt: number | null;
  accumulatedSeconds: number;

  setIsOpen: (openOrUpdater: boolean | ((prev: boolean) => boolean)) => void;
  setSelectedTaskId: (taskId: string) => void;
  setSelectedDate: (date: string) => void;
  setDurationMinutes: (minutesOrUpdater: number | ((prev: number) => number)) => void;
  setDurationSeconds: (secondsOrUpdater: number | ((prev: number) => number)) => void;
  setNote: (note: string) => void;
  pinTask: (taskId: string) => void;
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  resetAll: () => void;
}

export function getLiveElapsedSeconds(
  state: Pick<TimeStudioState, 'isTimerRunning' | 'timerStartedAt' | 'accumulatedSeconds'>,
  nowMs: number = Date.now()
): number {
  if (!state.isTimerRunning || !state.timerStartedAt) {
    return state.accumulatedSeconds;
  }
  return state.accumulatedSeconds + Math.max(0, Math.floor((nowMs - state.timerStartedAt) / 1000));
}

export function formatStopwatch(sec: number): string {
  const mins = Math.floor(sec / 60);
  const remainderSecs = Math.floor(sec % 60);
  return `${String(mins).padStart(2, '0')}:${String(remainderSecs).padStart(2, '0')}`;
}

const getInitialState = () => ({
  isOpen: false,
  selectedTaskId: '',
  selectedDate: workDate(),
  durationMinutes: 30,
  durationSeconds: 0,
  note: '',
  isTimerRunning: false,
  timerStartedAt: null,
  accumulatedSeconds: 0,
});

export const useTimeStudioStore = create<TimeStudioState>()(
  persist(
    (set) => ({
      ...getInitialState(),

      setIsOpen: (openOrUpdater) => {
        set((state) => ({
          isOpen: typeof openOrUpdater === 'function' ? openOrUpdater(state.isOpen) : openOrUpdater,
        }));
      },

      setSelectedTaskId: (taskId: string) => {
        set({ selectedTaskId: taskId });
      },

      setSelectedDate: (date: string) => {
        set({ selectedDate: date });
      },

      setDurationMinutes: (minutesOrUpdater) => {
        set((state) => ({
          durationMinutes:
            typeof minutesOrUpdater === 'function'
              ? minutesOrUpdater(state.durationMinutes)
              : minutesOrUpdater,
        }));
      },

      setDurationSeconds: (secondsOrUpdater) => {
        set((state) => ({
          durationSeconds:
            typeof secondsOrUpdater === 'function'
              ? secondsOrUpdater(state.durationSeconds)
              : secondsOrUpdater,
        }));
      },

      setNote: (note: string) => {
        set({ note });
      },

      pinTask: (taskId: string) => {
        set({
          selectedTaskId: taskId,
          isOpen: true,
        });
      },

      startTimer: () => {
        set((state) => {
          if (state.isTimerRunning) return state;
          return {
            isTimerRunning: true,
            timerStartedAt: Date.now(),
          };
        });
      },

      pauseTimer: () => {
        set((state) => {
          if (!state.isTimerRunning) return state;
          const now = Date.now();
          const elapsed = getLiveElapsedSeconds(state, now);
          const exactMinutes = Math.floor(elapsed / 60);
          const exactSeconds = Math.floor(elapsed % 60);
          return {
            isTimerRunning: false,
            timerStartedAt: null,
            accumulatedSeconds: elapsed,
            durationMinutes: exactMinutes,
            durationSeconds: exactSeconds,
          };
        });
      },

      resetTimer: () => {
        set((state) => ({
          isTimerRunning: false,
          timerStartedAt: null,
          accumulatedSeconds: 0,
          durationMinutes: state.durationMinutes === 0 ? 30 : state.durationMinutes,
          durationSeconds: 0,
        }));
      },

      resetAll: () => {
        set(getInitialState());
      },
    }),
    {
      name: TIME_STUDIO_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        isOpen: state.isOpen,
        selectedTaskId: state.selectedTaskId,
        selectedDate: state.selectedDate,
        durationMinutes: state.durationMinutes,
        durationSeconds: state.durationSeconds,
        note: state.note,
        isTimerRunning: state.isTimerRunning,
        timerStartedAt: state.timerStartedAt,
        accumulatedSeconds: state.accumulatedSeconds,
      }),
    }
  )
);

// Cross-tab synchronization via storage event
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === TIME_STUDIO_STORAGE_KEY) {
      if (!event.newValue) {
        useTimeStudioStore.getState().resetAll();
        return;
      }
      try {
        const parsed = JSON.parse(event.newValue);
        const data = parsed?.state ?? parsed;
        if (data && typeof data === 'object') {
          useTimeStudioStore.setState((current) => ({
            ...current,
            ...data,
          }));
        }
      } catch {
        // ignore parse error
      }
    }
  });
}

// User-change subscription to useSessionStore for clean state reset
let prevUser = useSessionStore.getState().user;
useSessionStore.subscribe((state) => {
  const currentUser = state.user;
  if (currentUser !== prevUser) {
    prevUser = currentUser;
    useTimeStudioStore.getState().resetAll();
  }
});
