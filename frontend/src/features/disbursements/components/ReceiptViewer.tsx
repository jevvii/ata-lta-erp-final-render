import { useState, useEffect, useMemo } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  Maximize2,
  RotateCw,
  ExternalLink,
  Download,
  RefreshCw,
  Receipt,
  AlertCircle,
  FileText,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DocumentViewerModal } from '@/features/documents/components/DocumentViewerModal';
import type { DmsDocument } from '@/features/documents/api/types';
import type { ReceiptUrlData } from '../api/types';
import { receiptDisplayName } from '../lib/receiptDisplayName';

export interface ReceiptViewerProps {
  receiptFileName?: string | null;
  receiptS3Key?: string | null;
  receiptData?: ReceiptUrlData | null;
  isLoadingReceipt?: boolean;
  isFetchingReceipt?: boolean;
  isReceiptError?: boolean;
  receiptError?: unknown;
  onRefetchReceiptUrl: () => void | Promise<unknown>;
  workRequestTitle?: string | null;
}

const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 250, 300];

export function ReceiptViewer({
  receiptFileName,
  receiptS3Key,
  receiptData,
  isLoadingReceipt = false,
  isFetchingReceipt = false,
  isReceiptError = false,
  receiptError: _receiptError,
  onRefetchReceiptUrl,
  workRequestTitle,
}: ReceiptViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setImageLoadError(false);
    setZoom(100);
    setRotation(0);
  }, [receiptData?.url]);

  const hasReceipt = Boolean(receiptFileName || receiptS3Key);
  const fileName = receiptDisplayName(receiptFileName || receiptData?.filename);

  const isPdf = Boolean(
    receiptData?.contentType?.toLowerCase().includes('pdf') ||
      /\.pdf$/i.test(fileName)
  );

  const isImage = Boolean(
    receiptData?.contentType?.toLowerCase().startsWith('image/') ||
      /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(fileName)
  );

  const fileType = isPdf ? 'PDF receipt' : isImage ? 'Image receipt' : 'Receipt attachment';
  const unavailable = receiptData?.status === 'unavailable';
  const canView = Boolean(receiptData?.url && !isReceiptError && !unavailable);

  const documentForModal = useMemo<DmsDocument | null>(() => {
    if (!receiptData?.url) return null;
    return {
      id: '',
      file_name: fileName,
      original_name: fileName,
      content_type: receiptData.contentType || (isPdf ? 'application/pdf' : 'image/jpeg'),
      category: 'RECEIPT',
      document_lifecycle: 'stored',
      status: 'active',
      archived: false,
      storage_path: receiptS3Key || null,
      uploader_id: '',
      entity_id: '',
      description: null,
      file_size: null,
      work_request_id: null,
      linked_task_id: null,
      client_id: null,
      created_at: '',
      updated_at: '',
      work_request_title: workRequestTitle || null,
      comments: [],
      versions: [],
    } as unknown as DmsDocument;
  }, [receiptData?.url, receiptData?.contentType, fileName, isPdf, receiptS3Key, workRequestTitle]);

  const handleZoomIn = () => {
    setZoom((prev) => {
      const next = ZOOM_STEPS.find((step) => step > prev);
      return next !== undefined ? next : 300;
    });
  };

  const handleZoomOut = () => {
    setZoom((prev) => {
      const reversed = [...ZOOM_STEPS].reverse();
      const next = reversed.find((step) => step < prev);
      return next !== undefined ? next : 50;
    });
  };

  const handleFit = () => {
    setZoom(100);
    setRotation(0);
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  // Case 1: Empty state — No receipt attached to this voucher
  if (!hasReceipt) {
    return (
      <div
        className="flex flex-col items-center justify-center p-8 bg-surface rounded-md border border-border text-center space-y-3"
        data-testid="receipt-empty-state"
      >
        <div className="w-12 h-12 rounded-full bg-sidebar border border-border flex items-center justify-center">
          <Receipt className="h-6 w-6 text-placeholder" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-ink">No receipt attached</h3>
          <p className="text-xs text-muted max-w-xs">
            This voucher has no attached receipt or supporting document.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2.5 h-full" data-testid="receipt-viewer-container">
      {/* Compact attachment row */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-2.5 shrink-0"
        data-testid="receipt-attachment-row"
      >
        <FileText className="h-4 w-4 shrink-0 text-muted" />
        <div className="min-w-0 flex-1 basis-32">
          <p className="break-words text-xs font-medium text-ink" data-testid="receipt-file-name">
            {fileName}
          </p>
          <p className="text-[11px] text-muted">{fileType}</p>
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Receipt attachment actions"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canView}
            onClick={() => setIsModalOpen(true)}
            className="h-7 px-2.5 text-xs font-medium text-ink hover:bg-hover inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
            data-testid="btn-preview-receipt"
            aria-label="View"
            title="Open canonical document viewer modal"
          >
            <Eye className="h-3 w-3" />
            <span>View</span>
          </Button>
          {canView && (
            <a
              href={receiptData?.url}
              download={fileName}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 text-xs font-medium text-ink hover:bg-hover"
              data-testid="btn-download-receipt"
              aria-label="Download"
            >
              <Download className="h-3 w-3" />
              <span>Download</span>
            </a>
          )}
        </div>
      </div>

      {/* Loading signed URL status */}
      {(isLoadingReceipt || (isFetchingReceipt && !receiptData?.url)) && (
        <p role="status" className="text-xs text-muted">
          Loading receipt…
        </p>
      )}

      {/* Error state */}
      {isReceiptError && (
        <div
          role="alert"
          className="space-y-2 text-xs text-danger"
          data-testid="receipt-error-state"
        >
          <p>Unable to load this receipt. Please try again.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isFetchingReceipt}
            onClick={() => {
              setImageLoadError(false);
              void onRefetchReceiptUrl();
            }}
            data-testid="btn-retry-receipt"
          >
            Retry Loading Receipt
          </Button>
        </div>
      )}

      {/* Legacy unavailable */}
      {unavailable && (
        <p className="text-xs text-muted" data-testid="receipt-legacy-unavailable">
          Supporting document unavailable for this voucher.
        </p>
      )}

      {/* Receipt URL available — render rich viewer with labeled toolbar and inline preview */}
      {canView && receiptData?.url && (
        <>
          {/* Compact Viewer Toolbar */}
          <div
            className="flex items-center gap-1 p-1 bg-sidebar rounded-[4px] border border-border overflow-x-auto scrollbar-none shrink-0"
            role="toolbar"
            aria-label="Receipt document controls"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleZoomOut}
              disabled={zoom <= 50}
              className="h-6 w-6 p-0 text-xs font-medium text-ink bg-surface border-border hover:bg-hover flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
              title="Zoom out"
              aria-label="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5 text-muted shrink-0" />
            </Button>

            <div
              className="h-6 px-1 flex items-center justify-center text-[10px] font-mono tabular-nums text-text-secondary bg-surface rounded-[4px] border border-border min-w-[36px] select-none shrink-0 whitespace-nowrap"
              title="Current zoom level"
            >
              {zoom}%
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleZoomIn}
              disabled={zoom >= 300}
              className="h-6 w-6 p-0 text-xs font-medium text-ink bg-surface border-border hover:bg-hover flex items-center justify-center cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap"
              title="Zoom in"
              aria-label="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5 text-muted shrink-0" />
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleFit}
              className="h-6 px-1.5 text-xs font-medium text-ink bg-surface border-border hover:bg-hover flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
              title="Reset zoom and rotation to 100%"
              aria-label="Fit"
            >
              <Maximize2 className="h-3 w-3 text-muted shrink-0" />
              <span>Fit</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRotate}
              className="h-6 px-1.5 text-xs font-medium text-ink bg-surface border-border hover:bg-hover flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
              title="Rotate 90 degrees clockwise"
              aria-label="Rotate"
            >
              <RotateCw className="h-3 w-3 text-muted shrink-0" />
              <span>Rotate</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(true)}
              data-testid="btn-open-modal-receipt"
              aria-label="Open modal viewer"
              title="Open full document modal viewer"
              className="h-6 px-1.5 text-xs font-medium text-ink bg-surface border-border hover:bg-hover flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
            >
              <Maximize className="h-3 w-3 text-muted shrink-0" />
              <span>Modal</span>
            </Button>

            <a
              href={receiptData.url}
              target="_blank"
              rel="noopener noreferrer"
              className="h-6 px-1.5 text-xs font-medium text-ink bg-surface border-border rounded-[4px] hover:bg-hover inline-flex items-center gap-1 cursor-pointer transition-colors shrink-0 whitespace-nowrap"
              data-testid="btn-open-newtab-receipt"
              title="Open receipt in a new browser tab"
              aria-label="Open in new tab"
            >
              <ExternalLink className="h-3 w-3 text-muted shrink-0" />
              <span>New tab</span>
            </a>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setImageLoadError(false);
                void onRefetchReceiptUrl();
              }}
              className="h-6 w-6 p-0 text-xs font-medium text-muted hover:text-ink bg-surface border-border hover:bg-hover flex items-center justify-center cursor-pointer shrink-0 whitespace-nowrap ml-auto"
              title="Refresh signed link"
              aria-label="Refresh Link"
              data-testid="btn-refresh-receipt"
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5 text-muted shrink-0', isFetchingReceipt && 'animate-spin')}
              />
            </Button>
          </div>

          {/* Document Well */}
          {isImage ? (
            <div
              className="w-full flex-1 min-h-[220px] bg-viewer-bg rounded-[4px] border border-border p-2 overflow-auto flex items-center justify-center relative overscroll-contain"
              data-testid="receipt-preview-viewport"
            >
              {imageLoadError ? (
                <div
                  className="p-6 text-center space-y-3 bg-surface rounded-md border border-border max-w-sm"
                  data-testid="receipt-image-load-error"
                >
                  <AlertCircle className="h-8 w-8 text-danger mx-auto" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-ink">Image rendering failed</p>
                    <p className="text-[11px] text-muted">
                      The image could not be displayed directly. The link may have expired or the
                      format is unsupported.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setImageLoadError(false);
                      void onRefetchReceiptUrl();
                    }}
                    className="min-h-[36px] text-xs font-medium text-primary border-primary hover:bg-hover inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw
                      className={cn('h-3.5 w-3.5 shrink-0', isFetchingReceipt && 'animate-spin')}
                    />
                    <span>Refresh Link</span>
                  </Button>
                </div>
              ) : (
                <img
                  src={receiptData.url}
                  alt={fileName}
                  onError={() => setImageLoadError(true)}
                  style={{
                    transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
                    transition: 'transform 0.15s ease-out',
                    transformOrigin: 'center center',
                    maxWidth: zoom <= 100 ? '100%' : 'none',
                    maxHeight: zoom <= 100 ? '100%' : 'none',
                  }}
                  className="object-contain select-none cursor-grab active:cursor-grabbing rounded-[2px]"
                  data-testid="receipt-preview-image"
                  loading="lazy"
                />
              )}
            </div>
          ) : isPdf ? (
            <div
              className="w-full flex-1 min-h-[220px] bg-viewer-bg rounded-[4px] border border-border overflow-hidden flex flex-col"
              data-testid="receipt-preview-viewport"
            >
              <object
                data={receiptData.url}
                type="application/pdf"
                className="w-full flex-1 min-h-[220px]"
                data-testid="receipt-pdf-object"
              >
                <iframe
                  src={receiptData.url}
                  className="w-full h-full border-0"
                  title={`PDF Preview: ${fileName}`}
                  data-testid="receipt-pdf-frame"
                />
                <div className="p-6 text-center space-y-2 bg-surface border-t border-border">
                  <FileText className="h-8 w-8 text-muted mx-auto" />
                  <p className="text-xs text-muted">
                    Your browser does not support inline PDF previews.
                  </p>
                  <a
                    href={receiptData.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Download or view PDF in new window
                  </a>
                </div>
              </object>
            </div>
          ) : (
            <div className="w-full bg-viewer-bg rounded-md border border-border p-8 flex flex-col items-center justify-center text-center space-y-3 min-h-[220px]">
              <div className="w-12 h-12 rounded-full bg-surface border border-border flex items-center justify-center">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-semibold text-ink">{fileName}</p>
                <p className="text-xs text-muted">
                  Direct inline preview is not supported for this file type. Use the links below to view
                  or download.
                </p>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <a
                  href={receiptData.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[40px] px-3 text-xs font-medium text-ink bg-surface border border-border rounded-[6px] hover:bg-hover inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="h-4 w-4 text-muted" />
                  <span>Open File</span>
                </a>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal Dialog Viewer */}
      {documentForModal && isModalOpen && (
        <DocumentViewerModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          document={documentForModal}
          previewUrl={receiptData?.url}
          attachmentOnly={true}
          onRefreshPreview={onRefetchReceiptUrl}
          isRefreshingPreview={isFetchingReceipt}
        />
      )}
    </div>
  );
}
