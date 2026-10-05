import {
  Building2,
  Mail,
  Phone,
  Calendar,
  Layers,
  Edit3,
  CreditCard,
  Hash,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePermission } from '@/lib/permissions';
import type { Client } from '../api/types';

export interface ClientDetailModalProps {
  client: Client | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit?: (client: Client) => void;
}

export function ClientDetailModal({
  client,
  isOpen,
  onClose,
  onEdit,
}: ClientDetailModalProps) {
  const canEditClients = usePermission('clients:edit');

  if (!client) return null;

  const isArchived = client.status === 'Archived' || Boolean(client.deletedAt);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-6"
        data-testid="client-detail-modal"
      >
        <DialogHeader className="border-b border-slate-100 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-[11px] font-semibold ${
                    client.entity === 'ATA'
                      ? 'bg-blue-50 text-blue-700 border-blue-200'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}
                  data-testid="client-detail-entity"
                >
                  {client.entity}
                </Badge>
                <Badge
                  variant="secondary"
                  className={`text-[11px] ${
                    isArchived
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                  data-testid="client-detail-status"
                >
                  {client.status}
                </Badge>
                {client.retainer && (
                  <Badge
                    variant="secondary"
                    className="bg-purple-100 text-purple-800 border-purple-200 text-[11px]"
                    data-testid="client-detail-retainer-badge"
                  >
                    Retainer
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2 pt-1">
                <Building2 className="h-5 w-5 text-slate-600" />
                <span data-testid="client-detail-name">{client.name}</span>
              </DialogTitle>
              {client.tradeName && (
                <DialogDescription className="text-xs text-slate-500">
                  Trade Name / DBA: <span className="font-semibold text-slate-700">{client.tradeName}</span>
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Master Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* TIN */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Tax Identification Number (TIN)
            </div>
            <div className="font-mono font-bold text-slate-800 text-sm" data-testid="client-detail-tin">
              {client.tin}
            </div>
          </div>

          {/* RDO Code */}
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Revenue District Office (RDO)
            </div>
            <div className="font-mono font-semibold text-slate-800" data-testid="client-detail-rdo">
              {client.rdoCode ? `RDO ${client.rdoCode}` : '—'}
            </div>
          </div>

          {/* Official Address */}
          <div className="sm:col-span-2 p-3 bg-slate-50 rounded-lg border border-slate-100 space-y-1">
            <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">
              Registered Address
            </div>
            <div className="text-slate-800" data-testid="client-detail-address">
              {client.address || 'No address provided'}
            </div>
          </div>

          {/* Retainer Fee Info */}
          {client.retainer && (
            <div className="sm:col-span-2 p-3 bg-purple-50/60 rounded-lg border border-purple-100 space-y-1">
              <div className="text-[11px] font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5" />
                Retainer Agreement
              </div>
              <div className="text-slate-800 font-medium">
                {client.retainerFee !== null && client.retainerFee !== undefined ? (
                  <span>
                    Monthly Retainer Fee:{' '}
                    <span className="font-mono font-bold text-purple-900" data-testid="client-detail-fee">
                      ₱{client.retainerFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  </span>
                ) : (
                  <span>Active retainer (fee unspecified)</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Primary Contact Person */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">
            Contact Information
          </h4>
          <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-2">
            <div className="text-xs">
              <span className="text-slate-500">Contact Person: </span>
              <span className="font-semibold text-slate-800" data-testid="client-detail-contact-person">
                {client.contactPerson || '—'}
              </span>
            </div>

            {/* Contact Details List */}
            {client.contactDetails && client.contactDetails.length > 0 ? (
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <div className="text-[11px] font-medium text-slate-500">Channels:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="client-detail-contact-channels">
                  {client.contactDetails.map((cd, index) => (
                    <div
                      key={cd.id || index}
                      className="flex items-center gap-2 p-2 bg-slate-50 rounded border border-slate-100 text-xs"
                    >
                      {cd.type === 'email' ? (
                        <Mail className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      ) : (
                        <Phone className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      )}
                      <div className="truncate">
                        <span className="font-mono text-slate-800">{cd.value}</span>
                        {cd.label && (
                          <span className="text-[10px] text-slate-500 block truncate">
                            {cd.label} ({cd.type})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">No additional contact details registered.</p>
            )}
          </div>
        </div>

        {/* Related Companies */}
        {client.relatedCompanies && client.relatedCompanies.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-600">
              Related Companies & Affiliates
            </h4>
            <div className="p-3 bg-white border border-slate-200 rounded-lg space-y-1.5" data-testid="client-detail-related-companies">
              {client.relatedCompanies.map((rc, idx) => (
                <div
                  key={rc.id || idx}
                  className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-100 text-xs"
                >
                  <div className="flex items-center gap-1.5 font-mono text-slate-700">
                    <Layers className="h-3.5 w-3.5 text-slate-400" />
                    <span>Client ID: {rc.relatedClientId}</span>
                  </div>
                  {rc.relationship && (
                    <Badge variant="outline" className="text-[10px] bg-white text-slate-600">
                      {rc.relationship}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata Footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Registered: {new Date(client.createdAt).toLocaleDateString()}
            </span>
            <span className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              Version: {client.version}
            </span>
          </div>
          <div>ID: {client.id}</div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 pt-2">
          {canEditClients && !isArchived && onEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                onEdit(client);
              }}
              className="text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
              data-testid="client-detail-edit-btn"
            >
              <Edit3 className="h-3.5 w-3.5 mr-1" />
              Edit Client
            </Button>
          ) : (
            <div />
          )}

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onClose}
            className="text-xs bg-slate-800 hover:bg-slate-900 text-white"
            data-testid="client-detail-close-btn"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
