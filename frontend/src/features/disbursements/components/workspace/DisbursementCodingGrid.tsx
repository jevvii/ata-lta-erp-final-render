import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronUp, Loader2, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/lib/session';
import { apiRequest } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { DisbursementStatusBadge } from '../DisbursementStatusBadge';
import { useDisbursementDetail, useUpdateDisbursement } from '../../api/useDisbursements';
import { useLiveModalContext } from '../../lib/useLiveModalContext';
import { useWorkRequestDetail } from '@/features/operations/api/useWorkRequests';
import { disbursementKeys } from '../../api/queryKeys';
import type { Disbursement, FundSource, UpdateDisbursementInput } from '../../api/types';

export const CODING_COLLAPSED_STORAGE_KEY = 'disb.codingCollapsed';

const isUuid = (val?: string | null) =>
  Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim()));

type EditableField = 'category' | 'amount' | 'fundSource';

export interface DisbursementCodingGridProps {
  disbursementId?: string | null;
  disbursement?: Disbursement | null;
  className?: string;
}

export function DisbursementCodingGrid({
  disbursementId,
  disbursement: directDisbursement,
  className,
}: DisbursementCodingGridProps) {
  // If directDisbursement is passed, use it; otherwise fetch by ID if ID is present
  const { data: fetchedDisbursement } = useDisbursementDetail(
    directDisbursement ? undefined : (disbursementId ?? undefined)
  );
  const disbursement = directDisbursement ?? fetchedDisbursement ?? null;

  const queryClient = useQueryClient();
  const currentUser = useSessionStore((s) => s.user);
  const isAdmin = currentUser?.role === 'Admin';

  // Lifecycle v2, Draft, not archived, valid positive version
  const isLifecycleV2 = disbursement?.lifecycle_version === 2;
  const isDraft = disbursement?.status === 'Draft';
  const isNotArchived = Boolean(disbursement && !disbursement.archived);
  const isValidPositiveVersion =
    typeof disbursement?.version === 'number' &&
    Number.isInteger(disbursement.version) &&
    disbursement.version > 0;

  // Admin + lifecycle v2 + Draft + not archived + valid version: financial cells editable
  const isFinancialEditable = Boolean(
    disbursement &&
      isAdmin &&
      isLifecycleV2 &&
      isDraft &&
      isNotArchived &&
      isValidPositiveVersion
  );

  // Live modal / context guard
  const { captureContext, contextKey } = useLiveModalContext({
    isOpen: Boolean(disbursement),
    disbursementId: disbursement?.id,
    version: disbursement?.version,
  });

  const { updateWithBlocking } = useUpdateDisbursement();

  // Collapsible bottom pane state
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(CODING_COLLAPSED_STORAGE_KEY) === 'true';
      }
    } catch {
      // ignore storage access errors
    }
    return false;
  });

  const handleToggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(CODING_COLLAPSED_STORAGE_KEY, String(next));
        }
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Inline editing state
  const [editingField, setEditingField] = useState<EditableField | null>(null);
  const [categoryValue, setCategoryValue] = useState('');
  const [amountValue, setAmountValue] = useState('');
  const [fundSourceValue, setFundSourceValue] = useState<FundSource>('Firm Fund');
  const [savingField, setSavingField] = useState<EditableField | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const isSubmittingRef = useRef(false);
  const isCancellingRef = useRef(false);

  // Synchronize internal edit values with current disbursement
  useEffect(() => {
    if (disbursement) {
      setCategoryValue(disbursement.category || '');
      setAmountValue(String(disbursement.amount ?? ''));
      setFundSourceValue(
        (disbursement.fund_source || disbursement.fundSource || 'Firm Fund') as FundSource
      );
    }
    setEditingField(null);
    setSavingField(null);
    setFieldError(null);
    setConflict(false);
    isSubmittingRef.current = false;
  }, [contextKey, disbursement?.id, disbursement?.version]);

  // Start editing a field
  const startEditing = (field: EditableField) => {
    if (!isFinancialEditable || savingField) return;
    if (disbursement) {
      setCategoryValue(disbursement.category || '');
      setAmountValue(String(disbursement.amount ?? ''));
      setFundSourceValue(
        (disbursement.fund_source || disbursement.fundSource || 'Firm Fund') as FundSource
      );
    }
    setFieldError(null);
    setConflict(false);
    isCancellingRef.current = false;
    setEditingField(field);
  };

  // Cancel edit
  const handleCancel = () => {
    isCancellingRef.current = true;
    if (disbursement) {
      setCategoryValue(disbursement.category || '');
      setAmountValue(String(disbursement.amount ?? ''));
      setFundSourceValue(
        (disbursement.fund_source || disbursement.fundSource || 'Firm Fund') as FundSource
      );
    }
    setFieldError(null);
    setConflict(false);
    setEditingField(null);
    setTimeout(() => {
      isCancellingRef.current = false;
    }, 100);
  };

  // Save edited cell
  const handleSave = async (field: EditableField) => {
    if (!disbursement || isSubmittingRef.current || isCancellingRef.current) return;

    // Field-level validations
    if (field === 'category') {
      if (!categoryValue.trim()) {
        setFieldError('Category is required.');
        return;
      }
      if (categoryValue.trim() === disbursement.category) {
        setEditingField(null);
        setFieldError(null);
        return;
      }
    }

    if (field === 'amount') {
      const parsed = Math.round(Number(amountValue) * 100) / 100;
      if (!amountValue.trim() || !Number.isFinite(parsed) || parsed <= 0) {
        setFieldError('Enter an amount greater than zero.');
        return;
      }
      if (parsed === disbursement.amount) {
        setEditingField(null);
        setFieldError(null);
        return;
      }
    }

    if (field === 'fundSource') {
      const currentSource = disbursement.fund_source || disbursement.fundSource || 'Firm Fund';
      if (fundSourceValue === currentSource) {
        setEditingField(null);
        setFieldError(null);
        return;
      }
    }

    isSubmittingRef.current = true;
    setSavingField(field);
    setFieldError(null);

    const { startId, isStale } = captureContext();

    try {
      const payload: UpdateDisbursementInput = {
        expectedVersion: disbursement.version,
      };

      if (field === 'category') {
        payload.category = categoryValue.trim();
      } else if (field === 'amount') {
        payload.amount = Math.round(Number(amountValue) * 100) / 100;
      } else if (field === 'fundSource') {
        payload.fundSource = fundSourceValue;
      }

      await updateWithBlocking({
        id: startId!,
        data: payload,
      });

      if (isStale()) return;
      setEditingField(null);
      toast.success('Disbursement updated successfully');
    } catch (err) {
      if (isStale()) return;
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflict(true);
        setFieldError(
          'This voucher changed elsewhere. Your edits are preserved. Load the latest values before editing again.'
        );
      } else {
        setFieldError(err instanceof Error ? err.message : 'Unable to save the voucher.');
      }
    } finally {
      if (!isStale()) {
        isSubmittingRef.current = false;
        setSavingField(null);
      }
    }
  };

  const handleLoadLatest = async () => {
    if (!disbursement) return;
    try {
      const latest = await apiRequest<{ data: Disbursement }>(`/disbursements/${disbursement.id}`);
      queryClient.setQueryData(disbursementKeys.detail(disbursement.id), latest.data);
      setConflict(false);
      setFieldError(null);
      setEditingField(null);
    } catch (err) {
      setFieldError(err instanceof Error ? err.message : 'Unable to refresh the voucher.');
    }
  };

  // Summary strip computations
  const formattedAmount = disbursement
    ? `₱${disbursement.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
    : '—';

  const fundSource =
    disbursement?.fund_source || disbursement?.fundSource || (disbursement ? 'Firm Fund' : '—');

  const isFunded = disbursement?.status === 'Funded' || disbursement?.status === 'Released';
  const paymentMethod = disbursement?.payment_method || disbursement?.paymentMethod;
  const paymentReference = disbursement?.payment_reference || disbursement?.paymentReference;
  const paymentInfo =
    isFunded && (paymentMethod || paymentReference)
      ? [paymentMethod, paymentReference].filter(Boolean).join(' / ')
      : '—';

  // Coding column values for selected disbursement
  const entityCode =
    disbursement?.entity_code ||
    disbursement?.entityCode ||
    (disbursement?.disbursement_number?.includes('LTA')
      ? 'LTA'
      : disbursement?.disbursement_number?.includes('ATA')
        ? 'ATA'
        : 'ATA');

  const linkedWrId =
    disbursement?.linked_work_request_id ||
    disbursement?.linkedWorkRequestId ||
    undefined;
  const rawWrName = disbursement?.linked_work_request_name;
  const hasHumanReadableName = Boolean(rawWrName && !isUuid(rawWrName));

  const { data: linkedWrDetail } = useWorkRequestDetail(linkedWrId, {
    enabled: Boolean(linkedWrId && !hasHumanReadableName),
  });

  const effectiveWrOrder =
    disbursement?.linked_work_request_order_number ||
    linkedWrDetail?.work_order_number ||
    null;
  const effectiveWrName =
    (hasHumanReadableName ? rawWrName : null) ||
    linkedWrDetail?.title ||
    null;
  const wrDisplay =
    effectiveWrOrder && effectiveWrName
      ? `${effectiveWrOrder} — ${effectiveWrName}`
      : effectiveWrName || effectiveWrOrder || '—';

  const taskDisplay =
    (disbursement?.linked_task_summary
      ? `${disbursement.linked_task_summary.task_number} — ${disbursement.linked_task_summary.title}`
      : null) ||
    disbursement?.linked_task_title ||
    disbursement?.linked_task_id ||
    disbursement?.linkedTaskId ||
    '—';

  const clientName =
    disbursement?.clients?.name ||
    disbursement?.client_name ||
    disbursement?.clientName ||
    disbursement?.client_id ||
    disbursement?.clientId ||
    '—';

  const employeeName =
    disbursement?.employee_name ||
    disbursement?.employeeName ||
    disbursement?.employee_id ||
    disbursement?.employeeId ||
    '—';

  const inv =
    disbursement?.linked_invoice_summary?.invoice_number ||
    disbursement?.linked_invoice_number ||
    disbursement?.linked_invoice?.invoice_number ||
    disbursement?.linked_invoice_id ||
    disbursement?.linkedInvoiceId;
  const trans =
    disbursement?.linked_transmittal_summary?.tracking_number ||
    disbursement?.linked_transmittal_tracking_number ||
    disbursement?.linked_transmittal?.tracking_number ||
    disbursement?.linked_transmittal_id ||
    disbursement?.linkedTransmittalId;
  const invTransDisplay = inv && trans ? `${inv} / ${trans}` : inv || trans || '—';

  return (
    <div
      className={cn('flex flex-col w-full bg-surface select-none', className)}
      data-testid="disbursement-coding-grid"
    >
      {/* 1. Summary Strip & Controls Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-2 bg-sidebar/50 border-b border-border">
        {/* Left: Summary Strip */}
        <div
          className="flex items-center flex-wrap gap-x-4 gap-y-1 text-[13px]"
          data-testid="coding-summary-strip"
        >
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider pr-1">
            Coding Summary
          </span>

          {/* Amount */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Amount:</span>
            <span
              className="text-[13px] font-bold text-ink tabular-nums font-mono"
              data-testid="coding-summary-amount"
            >
              {formattedAmount}
            </span>
          </div>

          <span className="text-border" aria-hidden="true">
            ·
          </span>

          {/* Fund Source */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Fund source:</span>
            <span
              className="text-[13px] font-medium text-ink"
              data-testid="coding-summary-fund-source"
            >
              {fundSource}
            </span>
          </div>

          <span className="text-border" aria-hidden="true">
            ·
          </span>

          {/* Status */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Status:</span>
            <span data-testid="coding-summary-status">
              {disbursement ? (
                <DisbursementStatusBadge status={disbursement.status} />
              ) : (
                <span className="text-[13px] text-muted font-medium">—</span>
              )}
            </span>
          </div>

          <span className="text-border" aria-hidden="true">
            ·
          </span>

          {/* Payment Method / Reference */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-muted">Payment:</span>
            <span
              className="text-[13px] font-mono tabular-nums text-ink"
              data-testid="coding-summary-payment"
            >
              {paymentInfo}
            </span>
          </div>
        </div>

        {/* Right: Collapsible Toggle Button */}
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToggleCollapse}
            aria-expanded={!isCollapsed}
            aria-controls="disbursement-coding-table"
            className="h-8 px-2.5 text-xs font-medium text-muted hover:text-ink hover:bg-hover/60 rounded-[6px] flex items-center gap-1.5 cursor-pointer transition-colors"
            data-testid="disb-toggle-coding"
            aria-label={isCollapsed ? 'Show coding details' : 'Hide coding details'}
          >
            {isCollapsed ? (
              <>
                <ChevronDown className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>Show coding</span>
              </>
            ) : (
              <>
                <ChevronUp className="h-3.5 w-3.5 text-muted shrink-0" />
                <span>Hide coding</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 2. Coding Grid Table (Horizontally Scrollable, ~2 rows + header) */}
      {!isCollapsed && (
        <div
          id="disbursement-coding-table"
          className="w-full overflow-x-auto max-h-[140px] overscroll-contain"
          data-testid="disbursement-coding-content"
        >
          <table
            className="w-full text-left text-[13px] border-collapse min-w-[950px]"
            data-testid="disbursement-coding-table"
          >
            <thead className="bg-sidebar border-b border-border sticky top-0 z-10">
              <tr>
                <th className="text-xs font-semibold text-text-secondary h-9 px-3 py-1.5 whitespace-nowrap">
                  Entity
                </th>
                <th className="text-xs font-semibold text-text-secondary h-9 px-3 py-1.5 whitespace-nowrap">
                  Category
                </th>
                <th className="text-xs font-semibold text-text-secondary h-9 px-3 py-1.5 whitespace-nowrap">
                  Work Request
                </th>
                <th className="text-xs font-semibold text-text-secondary h-9 px-3 py-1.5 whitespace-nowrap">
                  Task
                </th>
                <th className="text-xs font-semibold text-text-secondary h-9 px-3 py-1.5 whitespace-nowrap">
                  Fund Source
                </th>
                <th className="text-xs font-semibold text-text-secondary h-9 px-3 py-1.5 whitespace-nowrap">
                  Client
                </th>
                <th className="text-xs font-semibold text-text-secondary h-9 px-3 py-1.5 whitespace-nowrap">
                  Employee
                </th>
                <th className="text-xs font-semibold text-text-secondary h-9 px-3 py-1.5 whitespace-nowrap">
                  Invoice / Transmittal
                </th>
                <th className="text-xs font-semibold text-text-secondary h-9 px-3 py-1.5 text-right whitespace-nowrap">
                  Amount (PHP)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-surface">
              {disbursement ? (
                <tr
                  className="h-10 hover:bg-hover/60 transition-[background-color] duration-150"
                  data-testid="coding-grid-row"
                >
                  {/* 1. Entity */}
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span
                      className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-xs font-semibold border',
                        entityCode === 'LTA'
                          ? 'bg-info-surface text-info border-info-border'
                          : 'bg-primary-light text-ata border-blue-300'
                      )}
                      data-testid="coding-grid-entity"
                    >
                      {entityCode}
                    </span>
                  </td>

                  {/* 2. Category (Editable for Admin on v2 Draft) */}
                  <td
                    className={cn(
                      'px-3 py-1.5 whitespace-nowrap',
                      isFinancialEditable && 'cursor-pointer hover:bg-hover/80'
                    )}
                    data-testid="coding-grid-category"
                    tabIndex={isFinancialEditable ? 0 : -1}
                    role={isFinancialEditable ? 'button' : undefined}
                    aria-label={isFinancialEditable ? 'Click or press Enter to edit Category' : undefined}
                    onClick={() => {
                      if (editingField !== 'category') startEditing('category');
                    }}
                    onKeyDown={(e) => {
                      if (isFinancialEditable && editingField !== 'category' && e.key === 'Enter') {
                        e.preventDefault();
                        startEditing('category');
                      }
                    }}
                  >
                    {editingField === 'category' ? (
                      <div className="flex flex-col gap-1 min-w-[140px]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Input
                            autoFocus
                            aria-label="Category"
                            value={categoryValue}
                            maxLength={50}
                            disabled={Boolean(savingField)}
                            className="h-7 text-xs px-2 py-0.5 bg-surface border-control-border text-ink"
                            data-testid="input-edit-category"
                            onChange={(e) => setCategoryValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSave('category');
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                handleCancel();
                              }
                            }}
                            onBlur={() => handleSave('category')}
                          />
                          {savingField === 'category' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-primary shrink-0"
                              data-testid="cell-saving-spinner"
                            />
                          )}
                        </div>
                        {fieldError && (
                          <div role="alert" className="text-xs text-danger" data-testid="cell-error">
                            {fieldError}
                            {conflict && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleLoadLatest}
                                className="mt-1 h-6 px-2 text-xs"
                                data-testid="cell-load-latest"
                              >
                                Load latest values
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="flex items-center gap-1 font-medium text-ink">
                        <span>{disbursement.category}</span>
                        {isFinancialEditable && (
                          <Pencil className="h-3 w-3 text-muted/60 opacity-0 group-hover:opacity-100 shrink-0" />
                        )}
                      </span>
                    )}
                  </td>

                  {/* 3. Work Request */}
                  <td
                    className="px-3 py-1.5 whitespace-nowrap text-text-secondary max-w-[200px] truncate"
                    data-testid="coding-grid-work-request"
                    title={wrDisplay}
                  >
                    {Boolean(disbursement.workRequestNumber || disbursement.work_request_number) && (
                      <span className="font-mono text-xs font-medium text-text-secondary tabular-nums mr-1 bg-canvas border border-border px-1 py-0.2 rounded">
                        {disbursement.workRequestNumber || disbursement.work_request_number}
                      </span>
                    )}
                    {wrDisplay}
                  </td>

                  {/* 4. Task */}
                  <td
                    className="px-3 py-1.5 whitespace-nowrap font-mono text-xs text-text-secondary"
                    data-testid="coding-grid-task"
                  >
                    {taskDisplay}
                  </td>

                  {/* 5. Fund Source (Editable for Admin on v2 Draft) */}
                  <td
                    className={cn(
                      'px-3 py-1.5 whitespace-nowrap',
                      isFinancialEditable && 'cursor-pointer hover:bg-hover/80'
                    )}
                    data-testid="coding-grid-fund-source"
                    tabIndex={isFinancialEditable ? 0 : -1}
                    role={isFinancialEditable ? 'button' : undefined}
                    aria-label={isFinancialEditable ? 'Click or press Enter to edit Fund Source' : undefined}
                    onClick={() => {
                      if (editingField !== 'fundSource') startEditing('fundSource');
                    }}
                    onKeyDown={(e) => {
                      if (isFinancialEditable && editingField !== 'fundSource' && e.key === 'Enter') {
                        e.preventDefault();
                        startEditing('fundSource');
                      }
                    }}
                  >
                    {editingField === 'fundSource' ? (
                      <div className="flex flex-col gap-1 min-w-[120px]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <select
                            autoFocus
                            aria-label="Fund source"
                            value={fundSourceValue}
                            disabled={Boolean(savingField)}
                            className="h-7 text-xs px-2 py-0.5 bg-surface border border-control-border rounded-[6px] text-ink focus:outline-none focus:ring-1 focus:ring-primary"
                            data-testid="select-edit-fund-source"
                            onChange={(e) => setFundSourceValue(e.target.value as FundSource)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSave('fundSource');
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                handleCancel();
                              }
                            }}
                            onBlur={() => handleSave('fundSource')}
                          >
                            <option>Firm Fund</option>
                            <option>Client Fund</option>
                          </select>
                          {savingField === 'fundSource' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-primary shrink-0"
                              data-testid="cell-saving-spinner"
                            />
                          )}
                        </div>
                        {fieldError && (
                          <div role="alert" className="text-xs text-danger" data-testid="cell-error">
                            {fieldError}
                            {conflict && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleLoadLatest}
                                className="mt-1 h-6 px-2 text-xs"
                                data-testid="cell-load-latest"
                              >
                                Load latest values
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="flex items-center gap-1 text-text-secondary">
                        <span>{fundSource}</span>
                        {isFinancialEditable && (
                          <Pencil className="h-3 w-3 text-muted/60 opacity-0 group-hover:opacity-100 shrink-0" />
                        )}
                      </span>
                    )}
                  </td>

                  {/* 6. Client */}
                  <td
                    className="px-3 py-1.5 whitespace-nowrap text-text-secondary max-w-[150px] truncate"
                    data-testid="coding-grid-client"
                    title={clientName}
                  >
                    {Boolean(disbursement.clientNumber || disbursement.client_number || disbursement.clients?.clientNumber || disbursement.clients?.client_number) && (
                      <span className="font-mono text-xs font-medium text-text-secondary tabular-nums mr-1 bg-canvas border border-border px-1 py-0.2 rounded">
                        {disbursement.clientNumber || disbursement.client_number || disbursement.clients?.clientNumber || disbursement.clients?.client_number}
                      </span>
                    )}
                    {clientName}
                  </td>

                  {/* 7. Employee */}
                  <td
                    className="px-3 py-1.5 whitespace-nowrap text-text-secondary max-w-[150px] truncate"
                    data-testid="coding-grid-employee"
                    title={employeeName}
                  >
                    {employeeName}
                  </td>

                  {/* 8. Invoice / Transmittal */}
                  <td
                    className="px-3 py-1.5 whitespace-nowrap font-mono text-xs text-text-secondary"
                    data-testid="coding-grid-invoice-transmittal"
                  >
                    {invTransDisplay}
                  </td>

                  {/* 9. Amount (PHP) (Editable for Admin on v2 Draft) */}
                  <td
                    className={cn(
                      'px-3 py-1.5 whitespace-nowrap text-right',
                      isFinancialEditable && 'cursor-pointer hover:bg-hover/80'
                    )}
                    data-testid="coding-grid-amount"
                    tabIndex={isFinancialEditable ? 0 : -1}
                    role={isFinancialEditable ? 'button' : undefined}
                    aria-label={isFinancialEditable ? 'Click or press Enter to edit Amount' : undefined}
                    onClick={() => {
                      if (editingField !== 'amount') startEditing('amount');
                    }}
                    onKeyDown={(e) => {
                      if (isFinancialEditable && editingField !== 'amount' && e.key === 'Enter') {
                        e.preventDefault();
                        startEditing('amount');
                      }
                    }}
                  >
                    {editingField === 'amount' ? (
                      <div className="flex flex-col items-end gap-1 min-w-[130px]" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Input
                            autoFocus
                            aria-label="Amount (PHP)"
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={amountValue}
                            disabled={Boolean(savingField)}
                            className="h-7 text-xs px-2 py-0.5 bg-surface border-control-border text-ink text-right font-mono tabular-nums"
                            data-testid="input-edit-amount"
                            onChange={(e) => setAmountValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSave('amount');
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                handleCancel();
                              }
                            }}
                            onBlur={() => handleSave('amount')}
                          />
                          {savingField === 'amount' && (
                            <Loader2
                              className="h-3.5 w-3.5 animate-spin text-primary shrink-0"
                              data-testid="cell-saving-spinner"
                            />
                          )}
                        </div>
                        {fieldError && (
                          <div role="alert" className="text-xs text-danger text-right" data-testid="cell-error">
                            {fieldError}
                            {conflict && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleLoadLatest}
                                className="mt-1 h-6 px-2 text-xs"
                                data-testid="cell-load-latest"
                              >
                                Load latest values
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="flex items-center justify-end gap-1 font-bold font-mono text-ink tabular-nums">
                        <span>{formattedAmount}</span>
                        {isFinancialEditable && (
                          <Pencil className="h-3 w-3 text-muted/60 opacity-0 group-hover:opacity-100 shrink-0" />
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ) : (
                <tr className="h-14">
                  <td
                    colSpan={9}
                    className="px-4 py-3 text-center text-xs text-muted"
                    data-testid="coding-grid-empty"
                  >
                    Select a voucher to view accounting coding
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export interface DisbursementCodingDefinitionListProps {
  disbursement: Disbursement;
  className?: string;
  wrName?: string | null;
  wrOrder?: string | null;
}

export function DisbursementCodingDefinitionList({
  disbursement,
  className,
  wrName: propWrName,
  wrOrder: propWrOrder,
}: DisbursementCodingDefinitionListProps) {
  const entityCode =
    disbursement.entity_code ||
    disbursement.entityCode ||
    (disbursement.disbursement_number?.includes('LTA')
      ? 'LTA'
      : disbursement.disbursement_number?.includes('ATA')
        ? 'ATA'
        : 'ATA');

  const category = disbursement.category || '—';

  const candidatePropWrName = propWrName || disbursement.linked_work_request_name;
  const hasValidPropWrName = Boolean(candidatePropWrName && !isUuid(candidatePropWrName));
  const wrOrder = propWrOrder || disbursement.linked_work_request_order_number;
  const wrName = hasValidPropWrName ? candidatePropWrName : null;
  const wrDisplay =
    wrOrder && wrName
      ? `${wrOrder} — ${wrName}`
      : wrName || wrOrder || '—';

  const taskDisplay =
    (disbursement.linked_task_summary
      ? `${disbursement.linked_task_summary.task_number} — ${disbursement.linked_task_summary.title}`
      : null) ||
    disbursement.linked_task_title ||
    disbursement.linked_task_id ||
    disbursement.linkedTaskId ||
    '—';

  const fundSource =
    disbursement.fund_source ||
    disbursement.fundSource ||
    disbursement.source_of_funds ||
    disbursement.sourceOfFunds ||
    'Firm Fund';

  const clientName =
    disbursement.clients?.name ||
    disbursement.client_name ||
    disbursement.clientName ||
    disbursement.client_id ||
    disbursement.clientId ||
    '—';

  const employeeName =
    disbursement.employee_name ||
    disbursement.employeeName ||
    disbursement.employee_id ||
    disbursement.employeeId ||
    '—';

  const inv =
    disbursement.linked_invoice_summary?.invoice_number ||
    disbursement.linked_invoice_number ||
    disbursement.linked_invoice?.invoice_number ||
    disbursement.linked_invoice_id ||
    disbursement.linkedInvoiceId;
  const trans =
    disbursement.linked_transmittal_summary?.tracking_number ||
    disbursement.linked_transmittal_tracking_number ||
    disbursement.linked_transmittal?.tracking_number ||
    disbursement.linked_transmittal_id ||
    disbursement.linkedTransmittalId;
  const invTransDisplay = inv && trans ? `${inv} / ${trans}` : inv || trans || '—';

  const formattedAmount =
    '₱' + disbursement.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 });

  return (
    <dl
      className={cn(
        'grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-canvas rounded-md border border-border',
        className
      )}
      data-testid="disbursement-coding-definition-list"
    >
      {/* 1. Entity */}
      <div className="space-y-1">
        <dt className="text-xs font-medium text-muted">Entity</dt>
        <dd className="text-xs font-semibold text-ink" data-testid="dl-coding-entity">
          <span
            className={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-xs font-semibold border',
              entityCode === 'LTA'
                ? 'bg-info-surface text-info border-info-border'
                : 'bg-primary-light text-ata border-blue-300'
            )}
          >
            {entityCode}
          </span>
        </dd>
      </div>

      {/* 2. Category */}
      <div className="space-y-1">
        <dt className="text-xs font-medium text-muted">Category</dt>
        <dd className="text-xs font-semibold text-ink" data-testid="dl-coding-category">
          {category}
        </dd>
      </div>

      {/* 3. Work Request */}
      <div className="space-y-1 sm:col-span-2">
        <dt className="text-xs font-medium text-muted">Work Request</dt>
        <dd className="text-xs font-semibold text-ink" data-testid="dl-coding-work-request">
          {Boolean(disbursement.workRequestNumber || disbursement.work_request_number) && (
            <span className="font-mono text-xs font-medium text-text-secondary tabular-nums mr-1.5 bg-canvas border border-border px-1 py-0.2 rounded">
              {disbursement.workRequestNumber || disbursement.work_request_number}
            </span>
          )}
          {wrDisplay}
        </dd>
      </div>

      {/* 4. Task */}
      <div className="space-y-1">
        <dt className="text-xs font-medium text-muted">Task</dt>
        <dd className="text-xs font-mono text-ink" data-testid="dl-coding-task">
          {taskDisplay}
        </dd>
      </div>

      {/* 5. Fund Source */}
      <div className="space-y-1">
        <dt className="text-xs font-medium text-muted">Fund Source</dt>
        <dd className="text-xs font-semibold text-ink" data-testid="dl-coding-fund-source">
          {fundSource}
        </dd>
      </div>

      {/* 6. Client */}
      <div className="space-y-1">
        <dt className="text-xs font-medium text-muted">Client</dt>
        <dd className="text-xs font-semibold text-ink" data-testid="dl-coding-client">
          {Boolean(disbursement.clientNumber || disbursement.client_number || disbursement.clients?.clientNumber || disbursement.clients?.client_number) && (
            <span className="font-mono text-xs font-medium text-text-secondary tabular-nums mr-1.5 bg-canvas border border-border px-1 py-0.2 rounded">
              {disbursement.clientNumber || disbursement.client_number || disbursement.clients?.clientNumber || disbursement.clients?.client_number}
            </span>
          )}
          {clientName}
        </dd>
      </div>

      {/* 7. Employee */}
      <div className="space-y-1">
        <dt className="text-xs font-medium text-muted">Employee</dt>
        <dd className="text-xs font-semibold text-ink" data-testid="dl-coding-employee">
          {employeeName}
        </dd>
      </div>

      {/* 8. Invoice / Transmittal */}
      <div className="space-y-1">
        <dt className="text-xs font-medium text-muted">Invoice / Transmittal</dt>
        <dd className="text-xs font-mono text-ink" data-testid="dl-coding-invoice-transmittal">
          {invTransDisplay}
        </dd>
      </div>

      {/* 9. Amount (PHP) */}
      <div className="space-y-1">
        <dt className="text-xs font-medium text-muted">Amount (PHP)</dt>
        <dd
          className="text-xs font-bold font-mono tabular-nums text-ink"
          data-testid="dl-coding-amount"
        >
          {formattedAmount}
        </dd>
      </div>
    </dl>
  );
}
