import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type WorkRequest,
  type Task,
  type Phase,
  type TaskStatus,
  type QaStatus,
  type RetainerTemplate,
  type Rfc7807ProblemDetails,
  parseTaskDelimiterInput,
  computeBoardOrder,
  evaluateAdvancementGate,
} from './e2e-contracts';
import { createTestQueryClient } from './e2e-test-utils';

export const TestQueryWrapper: React.FC<{ children: React.ReactNode; queryClient?: QueryClient }> = ({
  children,
  queryClient,
}) => {
  const client = queryClient ?? createTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

/**
 * Blocking Action Modal Component Harness
 * Implements the Zero Optimistic Updates doctrine with verbatim error surfacing.
 */
export const BlockingModalHarness: React.FC<{
  isOpen: boolean;
  isLoading: boolean;
  actionTitle: string;
  error?: Rfc7807ProblemDetails | null;
  onDismissError?: () => void;
  onConfirm?: () => void;
  children?: React.ReactNode;
}> = ({ isOpen, isLoading, actionTitle, error, onDismissError, onConfirm, children }) => {
  if (!isOpen && !error) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-busy={isLoading}
      data-testid="blocking-action-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      style={{ pointerEvents: isLoading ? 'none' : 'auto' }}
    >
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
        <h2 data-testid="modal-title" className="text-lg font-bold mb-2">
          {actionTitle}
        </h2>

        {isLoading && (
          <div data-testid="blocking-spinner" className="flex items-center gap-3 py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            <span data-testid="blocking-label" className="text-sm text-gray-700">
              Processing server action...
            </span>
          </div>
        )}

        {error && (
          <div data-testid="error-container" className="py-2">
            <div className="flex items-center gap-2 mb-2">
              <span
                data-testid="error-code-badge"
                className="bg-red-100 text-red-800 text-xs px-2 py-0.5 rounded font-bold"
              >
                {error.code || `HTTP_${error.status}`}
              </span>
              <span className="text-xs text-gray-500">Status: {error.status}</span>
            </div>
            <p data-testid="error-detail" className="text-sm text-red-600 break-words">
              {error.detail || error.title || 'An unexpected error occurred.'}
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                data-testid="dismiss-error-button"
                onClick={onDismissError}
                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {!isLoading && !error && (
          <div>
            {children}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                data-testid="confirm-action-button"
                onClick={onConfirm}
                className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
              >
                Confirm
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Delimiter Task Input Harness
 * Implements interactive tokenization with live chip preview and >50 limit warning.
 */
export const DelimiterInputHarness: React.FC<{
  initialValue?: string;
  onSubmitTasks?: (tokens: string[]) => void;
}> = ({ initialValue = '', onSubmitTasks }) => {
  const [input, setInput] = useState(initialValue);
  const parsed = parseTaskDelimiterInput(input);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsed.exceedsLimit || parsed.tokens.length === 0) return;
    onSubmitTasks?.(parsed.tokens);
  };

  return (
    <form onSubmit={handleSubmit} data-testid="delimiter-task-form" className="p-4 bg-gray-50 rounded">
      <label htmlFor="task-input-field" className="block text-sm font-medium text-gray-700 mb-1">
        Tasks Input
      </label>
      <p data-testid="delimiter-hint" className="text-xs text-gray-500 mb-2">
        Paste a list — we&apos;ll split it (use commas, semicolons, or newlines)
      </p>
      <textarea
        id="task-input-field"
        data-testid="delimiter-textarea"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="w-full p-2 border rounded text-sm"
        rows={3}
      />

      {parsed.shouldSplit && (
        <div data-testid="preview-chips-container" className="mt-2 p-2 bg-white border rounded">
          <div className="flex items-center justify-between mb-2">
            <span data-testid="chip-count-badge" className="text-xs font-semibold text-gray-600">
              Will create {parsed.count} tasks
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {parsed.tokens.map((token, idx) => (
              <span
                key={idx}
                data-testid="task-chip"
                className="inline-block bg-blue-50 border border-blue-200 text-blue-800 text-xs px-2 py-0.5 rounded"
              >
                {token}
              </span>
            ))}
          </div>
        </div>
      )}

      {parsed.exceedsLimit && (
        <div
          data-testid="limit-exceeded-warning"
          role="alert"
          className="mt-2 p-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded font-semibold"
        >
          Exceeds maximum limit of 50 tasks per request
        </div>
      )}

      <button
        type="submit"
        data-testid="submit-delimiter-btn"
        disabled={parsed.exceedsLimit || parsed.tokens.length === 0}
        className="mt-3 px-4 py-2 bg-blue-600 disabled:bg-gray-400 text-white rounded text-sm"
      >
        Submit Tasks
      </button>
    </form>
  );
};

/**
 * Phase Kanban Board Harness
 * 4 columns, intra-phase D&D, cross-phase restriction, gate tooltips, QA toggles, reroute dialog.
 */
export const PhaseKanbanHarness: React.FC<{
  workRequest: WorkRequest;
  canAdvance?: boolean;
  canRequestTransition?: boolean;
  canQaReview?: boolean;
  onAdvance?: (targetPhase: Phase) => void;
  onRequestTransition?: (notes?: string) => void;
  onQaSubmit?: (evaluations: Array<{ taskId: string; qaStatus: QaStatus }>) => void;
  onReroute?: (toPhase: 'pre_processing' | 'processing', reason: string) => void;
  onTaskDrop?: (taskId: string, targetStatus: TaskStatus, newOrder: number) => void;
}> = ({
  workRequest,
  canAdvance = false,
  canRequestTransition = false,
  canQaReview = false,
  onAdvance,
  onRequestTransition,
  onQaSubmit,
  onReroute,
  onTaskDrop,
}) => {
  const [qaState, setQaState] = useState<Record<string, QaStatus>>({});
  const [rerouteDialogOpen, setRerouteDialogOpen] = useState(false);
  const [reroutePhase, setReroutePhase] = useState<'pre_processing' | 'processing'>('processing');
  const [rerouteReason, setRerouteReason] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [draggedPhase, setDraggedPhase] = useState<Phase | null>(null);

  const phases: Phase[] = ['pre_processing', 'processing', 'quality_assurance', 'completion'];
  const tasks = workRequest.tasks ?? [];

  const handleDragStart = (e: React.DragEvent, task: Task) => {
    e.dataTransfer.setData('text/plain', task.id);
    setDraggedTaskId(task.id);
    setDraggedPhase(task.phase);
  };

  const handleDragOver = (e: React.DragEvent, columnPhase: Phase) => {
    // Physical UI restriction: prevent cross-phase drop
    if (draggedPhase && draggedPhase !== columnPhase) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, columnPhase: Phase, targetStatus: TaskStatus) => {
    e.preventDefault();
    if (draggedPhase !== columnPhase || !draggedTaskId) return;

    const columnTasks = tasks.filter((t) => t.phase === columnPhase);
    const newOrder = computeBoardOrder('last', { before: columnTasks.length * 1000 });
    onTaskDrop?.(draggedTaskId, targetStatus, newOrder);
    setDraggedTaskId(null);
    setDraggedPhase(null);
  };

  // Evaluate gate progress for current phase
  const gateCheck = evaluateAdvancementGate(
    workRequest.phase,
    phases[phases.indexOf(workRequest.phase) + 1] ?? 'completion',
    tasks
  );

  const handleQaToggle = (taskId: string, status: QaStatus) => {
    setQaState((prev) => ({ ...prev, [taskId]: status }));
  };

  const failedTasksInQa = tasks.filter((t) => (qaState[t.id] ?? t.qaStatus) === 'failed');

  return (
    <div data-testid="phase-kanban" className="p-4 bg-gray-100 min-h-[500px]">
      <div className="flex items-center justify-between mb-4 bg-white p-3 rounded shadow">
        <div>
          <h1 data-testid="wr-title" className="text-xl font-bold">
            {workRequest.title}
          </h1>
          <span data-testid="wr-current-phase" className="text-xs font-semibold px-2 py-0.5 bg-blue-100 rounded">
            Phase: {workRequest.phase}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canRequestTransition && (
            <div className="relative group">
              <button
                type="button"
                data-testid="manager-transition-trigger"
                disabled={!gateCheck.allowed}
                onClick={() => onRequestTransition?.()}
                className="px-3 py-1.5 bg-emerald-600 disabled:bg-gray-400 text-white rounded text-sm font-medium"
              >
                Notify Admin — ready for review
              </button>
              {!gateCheck.allowed && (
                <div
                  role="tooltip"
                  data-testid="gate-prerequisite-tooltip"
                  className="absolute right-0 top-full mt-1 hidden group-hover:block bg-gray-900 text-white text-xs p-2 rounded w-64 z-20"
                >
                  Advancement locked: {gateCheck.detail}
                </div>
              )}
            </div>
          )}

          {canAdvance && (
            <button
              type="button"
              data-testid="admin-advance-button"
              onClick={() => {
                const nextPhase = phases[phases.indexOf(workRequest.phase) + 1];
                if (nextPhase) onAdvance?.(nextPhase);
              }}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700"
            >
              Advance
            </button>
          )}

          {workRequest.phase === 'quality_assurance' && canQaReview && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="submit-qa-review-button"
                onClick={() => {
                  const evals = Object.entries(qaState).map(([taskId, qaStatus]) => ({ taskId, qaStatus }));
                  onQaSubmit?.(evals);
                }}
                className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm font-medium"
              >
                Submit QA Review
              </button>
              <button
                type="button"
                data-testid="reroute-button"
                disabled={failedTasksInQa.length === 0}
                onClick={() => setRerouteDialogOpen(true)}
                className="px-3 py-1.5 bg-amber-600 disabled:bg-gray-400 text-white rounded text-sm font-medium"
              >
                Reroute Work Request
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {phases.map((ph) => {
          const columnTasks = tasks.filter((t) => t.phase === ph);
          const activeColTasks = columnTasks.filter((t) => t.status !== 'Cancelled');
          const completedColTasks = activeColTasks.filter((t) => t.status === 'Completed');

          return (
            <div
              key={ph}
              data-testid={`phase-column-${ph}`}
              onDragOver={(e) => handleDragOver(e, ph)}
              className="bg-white p-3 rounded shadow flex flex-col min-h-[400px]"
            >
              <div className="flex items-center justify-between pb-2 mb-2 border-b">
                <h3 className="font-semibold text-sm capitalize">{ph.replace('_', ' ')}</h3>
                <span data-testid={`gate-progress-${ph}`} className="text-xs text-gray-500 font-medium">
                  {completedColTasks.length}/{activeColTasks.length} completed
                </span>
              </div>

              {ph === 'quality_assurance' && (
                <div data-testid="qa-eval-counter-badge" className="text-xs font-semibold mb-2 text-purple-700">
                  {tasks.filter((t) => (qaState[t.id] ?? t.qaStatus) === 'passed').length} Passed,{' '}
                  {tasks.filter((t) => (qaState[t.id] ?? t.qaStatus) === 'failed').length} Failed
                </div>
              )}

              <div
                data-testid={`dropzone-${ph}`}
                onDrop={(e) => handleDrop(e, ph, 'In Progress')}
                className="flex-1 space-y-2"
              >
                {columnTasks.map((t) => {
                  const currentQa = qaState[t.id] ?? t.qaStatus;
                  return (
                    <div
                      key={t.id}
                      draggable={t.status !== 'Cancelled'}
                      onDragStart={(e) => handleDragStart(e, t)}
                      data-testid={`task-card-${t.id}`}
                      className="p-2 border rounded bg-gray-50 shadow-sm cursor-grab"
                    >
                      <div className="flex items-center justify-between">
                        <span data-testid="task-title" className="text-sm font-medium">
                          {t.title}
                        </span>
                        <span data-testid="task-status-badge" className="text-xs px-1.5 py-0.5 bg-gray-200 rounded">
                          {t.status}
                        </span>
                      </div>

                      {ph === 'quality_assurance' && canQaReview && (
                        <div data-testid="qa-toggle-group" className="mt-2 flex items-center gap-2 text-xs">
                          <button
                            type="button"
                            data-testid={`qa-pass-${t.id}`}
                            onClick={() => handleQaToggle(t.id, 'passed')}
                            className={`px-2 py-0.5 rounded ${
                              currentQa === 'passed' ? 'bg-green-600 text-white font-bold' : 'bg-gray-200'
                            }`}
                          >
                            Pass
                          </button>
                          <button
                            type="button"
                            data-testid={`qa-fail-${t.id}`}
                            onClick={() => handleQaToggle(t.id, 'failed')}
                            className={`px-2 py-0.5 rounded ${
                              currentQa === 'failed' ? 'bg-red-600 text-white font-bold' : 'bg-gray-200'
                            }`}
                          >
                            Fail
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {rerouteDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="reroute-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="bg-white p-6 rounded-lg max-w-md w-full">
            <h2 className="text-lg font-bold mb-3">Reroute Work Request</h2>
            <div className="mb-3">
              <label htmlFor="reroute-phase-select" className="block text-xs font-semibold mb-1">
                Target Phase
              </label>
              <select
                id="reroute-phase-select"
                data-testid="reroute-phase-select"
                value={reroutePhase}
                onChange={(e) => setReroutePhase(e.target.value as 'pre_processing' | 'processing')}
                className="w-full p-2 border rounded text-sm"
              >
                <option value="processing">Processing</option>
                <option value="pre_processing">Pre-processing</option>
              </select>
            </div>

            <div className="mb-3">
              <h4 className="text-xs font-semibold text-gray-700 mb-1">Tasks that will be reopened:</h4>
              <ul data-testid="reopened-tasks-list" className="list-disc pl-5 text-xs text-red-600">
                {failedTasksInQa.map((t) => (
                  <li key={t.id}>{t.title}</li>
                ))}
              </ul>
            </div>

            <div className="mb-3">
              <label htmlFor="reroute-reason-textarea" className="block text-xs font-semibold mb-1">
                Reason for Reroute (Mandatory)
              </label>
              <textarea
                id="reroute-reason-textarea"
                data-testid="reroute-reason-input"
                value={rerouteReason}
                onChange={(e) => setRerouteReason(e.target.value)}
                className="w-full p-2 border rounded text-sm"
                rows={3}
                placeholder="Audit explanation for reroute..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="cancel-reroute-btn"
                onClick={() => setRerouteDialogOpen(false)}
                className="px-3 py-1.5 bg-gray-200 rounded text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-reroute-btn"
                disabled={!rerouteReason.trim()}
                onClick={() => {
                  if (!rerouteReason.trim()) return;
                  onReroute?.(reroutePhase, rerouteReason);
                  setRerouteDialogOpen(false);
                }}
                className="px-3 py-1.5 bg-red-600 disabled:bg-gray-400 text-white rounded text-sm font-medium"
              >
                Confirm Reroute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Assigner Select Harness
 * Multi-assignee dropdown that excludes selected staff and provides Assign all.
 */
export const AssignerSelectHarness: React.FC<{
  availableStaff: Array<{ id: string; name: string; role: string }>;
  selectedIds?: string[];
  onChange?: (selectedIds: string[]) => void;
}> = ({ availableStaff, selectedIds = [], onChange }) => {
  const [selected, setSelected] = useState<string[]>(selectedIds);

  const eligibleStaff = availableStaff.filter((s) => s.role !== 'Admin' && s.role !== 'Manager');
  const unselectedStaff = eligibleStaff.filter((s) => !selected.includes(s.id));

  const handleSelect = (userId: string) => {
    const next = [...selected, userId];
    setSelected(next);
    onChange?.(next);
  };

  const handleRemove = (userId: string) => {
    const next = selected.filter((id) => id !== userId);
    setSelected(next);
    onChange?.(next);
  };

  const handleAssignAll = () => {
    const next = eligibleStaff.map((s) => s.id);
    setSelected(next);
    onChange?.(next);
  };

  return (
    <div data-testid="assigner-select-component" className="p-3 bg-white border rounded">
      <div className="flex items-center justify-between mb-2">
        <label htmlFor="assignee-select-dropdown" className="text-xs font-semibold text-gray-700">
          Co-Assignees
        </label>
        <button
          type="button"
          data-testid="assign-all-btn"
          onClick={handleAssignAll}
          className="text-xs text-blue-600 hover:underline font-medium"
        >
          Assign all
        </button>
      </div>

      <div data-testid="selected-chips" className="flex flex-wrap gap-1 mb-2 min-h-[24px]">
        {selected.map((id) => {
          const user = availableStaff.find((s) => s.id === id);
          return (
            <span
              key={id}
              data-testid={`selected-chip-${id}`}
              className="inline-flex items-center gap-1 bg-gray-100 text-xs px-2 py-0.5 rounded border"
            >
              <span>{user?.name || id}</span>
              <button
                type="button"
                data-testid={`remove-chip-${id}`}
                onClick={() => handleRemove(id)}
                className="text-gray-400 hover:text-red-500 font-bold"
              >
                &times;
              </button>
            </span>
          );
        })}
      </div>

      <select
        id="assignee-select-dropdown"
        data-testid="assignee-dropdown"
        value=""
        onChange={(e) => {
          if (e.target.value) handleSelect(e.target.value);
        }}
        className="w-full p-1.5 border rounded text-xs"
      >
        <option value="">Select staff member...</option>
        {unselectedStaff.map((staff) => (
          <option key={staff.id} value={staff.id}>
            {staff.name} ({staff.role})
          </option>
        ))}
      </select>
    </div>
  );
};

/**
 * Retainer Generate Dialog Harness
 * Dialog gated by retainers:use with annual period_label prompt and 409 handling.
 */
export const RetainerGenerateHarness: React.FC<{
  templates: RetainerTemplate[];
  onGenerate?: (templateId: string, periodLabel?: string) => Promise<void>;
}> = ({ templates, onGenerate }) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
  const [periodLabel, setPeriodLabel] = useState('');
  const [error, setError] = useState<Rfc7807ProblemDetails | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);
  const isAnnual = selectedTemplate?.recurrence === 'annual';

  const handleGenerate = async () => {
    if (isAnnual && !periodLabel.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      await onGenerate?.(selectedTemplateId, isAnnual ? periodLabel : undefined);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err) {
        setError(err as Rfc7807ProblemDetails);
      } else {
        setError({
          status: 409,
          code: 'DUPLICATE_PERIOD_GENERATION',
          detail: 'A work request has already been generated for this template and period.',
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div data-testid="retainer-generate-dialog" className="p-4 bg-white border rounded max-w-md">
      <h3 className="text-base font-bold mb-3">Generate from Retainer Template</h3>
      <div className="mb-3">
        <label htmlFor="retainer-template-select" className="block text-xs font-semibold mb-1">
          Select Template
        </label>
        <select
          id="retainer-template-select"
          data-testid="template-select"
          value={selectedTemplateId}
          onChange={(e) => setSelectedTemplateId(e.target.value)}
          className="w-full p-2 border rounded text-sm"
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.recurrence})
            </option>
          ))}
        </select>
      </div>

      {isAnnual && (
        <div className="mb-3">
          <label htmlFor="period-label-field" className="block text-xs font-semibold mb-1">
            Period Label (Required for Annual Retainers)
          </label>
          <input
            id="period-label-field"
            data-testid="period-label-input"
            type="text"
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
            placeholder="e.g. FY-2026"
            className="w-full p-2 border rounded text-sm"
          />
        </div>
      )}

      {error && (
        <div data-testid="retainer-error-box" className="p-2 bg-red-50 border border-red-200 rounded mb-3">
          <span
            data-testid="retainer-error-badge"
            className="text-xs bg-red-200 text-red-800 px-1 py-0.5 rounded font-bold"
          >
            {error.code}
          </span>
          <p data-testid="retainer-error-detail" className="text-xs text-red-700 mt-1">
            {error.detail}
          </p>
        </div>
      )}

      <button
        type="button"
        data-testid="execute-generate-btn"
        disabled={isLoading || (isAnnual && !periodLabel.trim())}
        onClick={handleGenerate}
        className="w-full py-2 bg-blue-600 disabled:bg-gray-400 text-white rounded text-sm font-medium"
      >
        {isLoading ? 'Generating...' : 'Generate Work Request'}
      </button>
    </div>
  );
};
