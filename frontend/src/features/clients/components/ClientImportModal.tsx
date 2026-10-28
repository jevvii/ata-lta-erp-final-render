import React, { useState, useRef, useEffect } from 'react';
import {
  Upload,
  Download,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Loader2,
  Info,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { useSessionStore } from '@/lib/session';
import { useRegisteredUsers, useImportClients } from '../api/useClients';
import {
  parseCSV,
  validateCsvData,
  downloadCsvTemplate,
  type ValidatedClientRecord,
  type RowValidationError,
} from '../lib/csvImport';
import type { ImportRowResult, ImportClientsProgress } from '../api/useClients';

export interface ClientImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ImportStep = 'idle' | 'error' | 'validated' | 'importing' | 'results';

export function ClientImportModal({ isOpen, onClose }: ClientImportModalProps) {
  const [step, setStep] = useState<ImportStep>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [validatedRecords, setValidatedRecords] = useState<ValidatedClientRecord[]>([]);
  const [validationErrors, setValidationErrors] = useState<RowValidationError[]>([]);
  const [progress, setProgress] = useState<ImportClientsProgress>({ current: 0, total: 0 });
  const [importResults, setImportResults] = useState<ImportRowResult[]>([]);
  const [finalSuccessCount, setFinalSuccessCount] = useState(0);
  const [finalFailCount, setFinalFailCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeEntity = useSessionStore((state) => state.activeEntity);
  const { data: registeredUsers = [] } = useRegisteredUsers();
  const { importClients } = useImportClients();

  const isImporting = step === 'importing';

  // Reset state when modal is opened or closed
  useEffect(() => {
    if (isOpen) {
      setStep('idle');
      setErrorMessage('');
      setIsDragging(false);
      setValidatedRecords([]);
      setValidationErrors([]);
      setProgress({ current: 0, total: 0 });
      setImportResults([]);
      setFinalSuccessCount(0);
      setFinalFailCount(0);
    }
  }, [isOpen]);

  const handleClose = () => {
    if (isImporting) return;
    onClose();
  };

  const handleFile = (file: File) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = (e.target?.result as string) || '';
        const parsedRows = parseCSV(text);
        const validation = validateCsvData(parsedRows, registeredUsers);

        if (!validation.isValid) {
          setErrorMessage(validation.error || 'The uploaded file is empty or missing data rows.');
          setStep('error');
        } else {
          setValidatedRecords(validation.records);
          setValidationErrors(validation.errors);
          setStep('validated');
        }
      } catch (err: unknown) {
        setErrorMessage(
          'An error occurred while parsing the CSV file: ' +
            (err instanceof Error ? err.message : String(err))
        );
        setStep('error');
      }
    };

    reader.onerror = () => {
      setErrorMessage('Failed to read the uploaded CSV file.');
      setStep('error');
    };

    reader.readAsText(file);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFile(file);
    }
    // Reset file input so re-selecting same file triggers change
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFile(file);
    }
  };

  const handleStartImport = async () => {
    if (validatedRecords.length === 0) return;
    setStep('importing');
    setProgress({ current: 0, total: validatedRecords.length });

    const outcome = await importClients(validatedRecords, (p) => {
      setProgress(p);
    });

    setImportResults(outcome.results);
    setFinalSuccessCount(outcome.successCount);
    setFinalFailCount(outcome.failCount);
    setStep('results');
  };

  const handleDone = () => {
    if (finalSuccessCount > 0 && finalFailCount === 0) {
      toast.success(
        `Bulk import complete: ${finalSuccessCount} client${finalSuccessCount > 1 ? 's' : ''} successfully imported.`
      );
    } else if (finalSuccessCount > 0 && finalFailCount > 0) {
      toast.warning(
        `Bulk import finished: ${finalSuccessCount} imported, ${finalFailCount} failed.`
      );
    } else {
      toast.error(`Bulk import failed: 0 of ${importResults.length} clients imported.`);
    }
    handleClose();
  };

  const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  // Cross-entity detection: rows targeting an entity different from current active scope
  const differentEntityCounts: Record<string, number> = {};
  if (activeEntity && activeEntity !== 'ALL') {
    validatedRecords.forEach((item) => {
      const ent = item.record.entity;
      if (ent && ent !== activeEntity) {
        differentEntityCounts[ent] = (differentEntityCounts[ent] || 0) + 1;
      }
    });
  }
  const differentEntityEntries = Object.entries(differentEntityCounts);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!isImporting && !open) {
          handleClose();
        }
      }}
    >
      <DialogContent
        className={`max-w-xl duration-150 ${
          isImporting ? '[&>button:has(.sr-only)]:pointer-events-none [&>button:has(.sr-only)]:opacity-0' : ''
        }`}
        onEscapeKeyDown={(e) => {
          if (isImporting) {
            e.preventDefault();
          }
        }}
        onPointerDownOutside={(e) => {
          if (isImporting) {
            e.preventDefault();
          }
        }}
        data-testid="client-import-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-[#1D4ED8]" />
            Import Clients in Bulk
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            Upload a CSV spreadsheet to validate and register multiple client master records at once.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Idle (Drop Zone + Template) */}
        {step === 'idle' && (
          <div className="space-y-4 py-2">
            <p className="text-xs text-[#475569] leading-relaxed">
              Select a CSV file to import multiple clients at once. Please download the template to
              ensure your column headers match system requirements.
            </p>

            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={downloadCsvTemplate}
                className="text-xs font-medium border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px] h-8 gap-1.5 shadow-2xs cursor-pointer"
                data-testid="download-template-btn"
              >
                <Download className="h-3.5 w-3.5 text-[#1D4ED8]" />
                Download CSV Template
              </Button>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              tabIndex={-1}
              onChange={handleFileInputChange}
              data-testid="csv-file-input"
            />

            {/* Accessible Drop Zone */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload CSV file"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-[10px] p-8 text-center cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8] ${
                isDragging
                  ? 'border-[#1D4ED8] bg-[#EFF6FF]'
                  : 'border-[#CBD5E1] bg-[#F8FAFC] hover:border-[#94A3B8] hover:bg-[#F1F5F9]'
              }`}
              data-testid="csv-dropzone"
            >
              <div className="flex flex-col items-center justify-center gap-2">
                <div className="h-10 w-10 rounded-full bg-[#DBEAFE] flex items-center justify-center text-[#1D4ED8]">
                  <Upload className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-[#1E293B] block">
                    Click to browse or drag &amp; drop CSV file here
                  </span>
                  <span className="text-[11px] text-[#64748B] block mt-0.5">
                    Supports .csv files formatted according to the template
                  </span>
                </div>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClose}
                className="text-xs font-medium border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px] h-8 cursor-pointer"
              >
                Cancel
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Error State (missing headers, empty file) */}
        {step === 'error' && (
          <div className="space-y-4 py-2">
            <div className="p-4 rounded-[8px] bg-[#FEF2F2] border border-[#FCA5A5] flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-[#DC2626] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-[#991B1B]">File Validation Error</h4>
                <p className="text-xs text-[#B91C1C] leading-normal">{errorMessage}</p>
              </div>
            </div>

            <DialogFooter className="pt-2 flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStep('idle')}
                className="text-xs font-medium border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px] h-8 cursor-pointer"
                data-testid="reselect-file-btn"
              >
                Choose Another File
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleClose}
                className="text-xs font-medium bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] rounded-[6px] h-8 cursor-pointer"
              >
                Close
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Validated Summary */}
        {step === 'validated' && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px]">
              <span className="text-xs font-medium text-[#1E293B]">
                Validation Complete:
              </span>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="bg-[#F0FDF4] text-[#166534] border-[#BBF7D0] text-xs font-medium px-2 py-0.5"
                >
                  {validatedRecords.length} records valid
                </Badge>
                {validationErrors.length > 0 && (
                  <Badge
                    variant="outline"
                    className="bg-[#FEF2F2] text-[#991B1B] border-[#FECACA] text-xs font-medium px-2 py-0.5"
                  >
                    {validationErrors.length} records have errors
                  </Badge>
                )}
              </div>
            </div>

            {/* Informational cross-entity note when active entity isn't ALL */}
            {differentEntityEntries.length > 0 && (
              <div
                className="flex items-start gap-2.5 p-2.5 bg-[#EFF6FF] border border-[#BFDBFE] rounded-[8px] text-xs text-[#1E40AF]"
                data-testid="cross-entity-note"
              >
                <Info className="h-4 w-4 text-[#1D4ED8] shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="font-semibold block">Entity Notice</span>
                  <span className="text-[#1E40AF] block">
                    {differentEntityEntries
                      .map(
                        ([ent, count]) =>
                          `${count} row${count > 1 ? 's' : ''} will be created under ${ent}`
                      )
                      .join(', ')}{' '}
                    (current active entity is {activeEntity}).
                  </span>
                </div>
              </div>
            )}

            {validationErrors.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-[#DC2626] block">
                  Errors Found:
                </span>
                <div
                  className="max-h-52 overflow-y-auto border border-[#E2E8F0] rounded-[8px] p-2.5 bg-[#FFFFFF] divide-y divide-[#F1F5F9] space-y-1"
                  data-testid="validation-errors-list"
                >
                  {validationErrors.map((err) => (
                    <div key={err.rowNum} className="text-xs text-[#DC2626] py-1.5">
                      <span className="font-semibold text-[#991B1B]">
                        Row {err.rowNum} ({err.name}):{' '}
                      </span>
                      <span className="text-[#B91C1C]">{err.messages.join('; ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="pt-2 flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClose}
                className="text-xs font-medium border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px] h-8 cursor-pointer"
                data-testid="cancel-import-btn"
              >
                Cancel
              </Button>
              {validatedRecords.length > 0 && (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleStartImport}
                  className="text-xs font-medium bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] rounded-[6px] h-8 cursor-pointer"
                  data-testid="start-import-btn"
                >
                  Import {validatedRecords.length} Client{validatedRecords.length > 1 ? 's' : ''}
                </Button>
              )}
            </DialogFooter>
          </div>
        )}

        {/* Step 4: Importing Progress */}
        {step === 'importing' && (
          <div className="space-y-5 py-4">
            <div className="text-center space-y-1">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#1E293B]">
                <Loader2 className="h-4 w-4 animate-spin text-[#1D4ED8]" />
                Importing {progress.current} of {progress.total} clients...
              </div>
              {progress.currentRow && (
                <p className="text-xs text-[#475569] truncate max-w-sm mx-auto">
                  Row {progress.currentRow.rowNum}: {progress.currentRow.name}
                </p>
              )}
            </div>

            {/* Accessible Progress Bar */}
            <div className="space-y-1.5">
              <div
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Import progress"
                className="w-full h-2.5 bg-[#E2E8F0] rounded-full overflow-hidden"
                data-testid="import-progress-bar"
              >
                <div
                  className="h-full bg-[#1D4ED8] rounded-full transition-all duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-[#64748B]">
                <span>Progress</span>
                <span>{percent}%</span>
              </div>
            </div>

            <p className="text-[11px] text-center text-[#64748B]">
              Please do not close your browser or navigate away while the import is processing.
            </p>
          </div>
        )}

        {/* Step 5: Final Results */}
        {step === 'results' && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px]">
              <span className="text-xs font-semibold text-[#1E293B]">
                Import Results:
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#16A34A]">
                  ✓ {finalSuccessCount} Saved
                </span>
                <span className="text-xs text-[#CBD5E1]">|</span>
                <span
                  className={`text-xs font-semibold ${
                    finalFailCount > 0 ? 'text-[#DC2626]' : 'text-[#64748B]'
                  }`}
                >
                  ✗ {finalFailCount} Failed
                </span>
              </div>
            </div>

            {importResults.length > 0 && (
              <div
                className="max-h-56 overflow-y-auto border border-[#E2E8F0] rounded-[8px] p-2 bg-[#FFFFFF] divide-y divide-[#F1F5F9]"
                data-testid="import-results-list"
              >
                {importResults.map((res) => (
                  <div
                    key={res.rowNum}
                    className="flex items-center justify-between py-1.5 px-2 text-xs"
                  >
                    <span className="truncate max-w-[300px] text-[#1E293B]">
                      <strong className="text-[#475569]">Row {res.rowNum}:</strong> {res.name}
                    </span>
                    {res.success ? (
                      <span className="inline-flex items-center gap-1 text-[#16A34A] font-medium shrink-0">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Saved
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-[#DC2626] font-medium shrink-0 truncate max-w-[200px]"
                        title={res.error}
                      >
                        <XCircle className="h-3.5 w-3.5 shrink-0" />
                        Failed: {res.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <DialogFooter className="pt-2 flex justify-end">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleDone}
                className="text-xs font-medium bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] rounded-[6px] h-8 cursor-pointer"
                data-testid="import-done-btn"
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
