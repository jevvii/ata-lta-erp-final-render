import {
  Building2,
  Mail,
  Phone,
  Calendar,
  Layers,
  Edit3,
  CreditCard,
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
import { useRegisteredUsers, useClientsList } from '../api/useClients';
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
  const { data: registeredUsers = [] } = useRegisteredUsers();
  const { data: clientsData } = useClientsList({ limit: 100 });
  const allClients = clientsData?.data || [];

  if (!client) return null;

  const isArchived = client.status === 'Archived' || Boolean(client.deletedAt);
  const pocUser = client.contactUserId
    ? registeredUsers.find((u) => u.id === client.contactUserId)
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] overflow-y-auto p-6 space-y-6 rounded-[12px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float"
        data-testid="client-detail-modal"
      >
        <DialogHeader className="border-b border-[#E2E8F0] pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={`text-xs  font-bold tracking-normal rounded-[6px] ${
                    client.entity === 'ATA'
                      ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs border-[#E2E8F0]'
                      : 'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0]'
                  }`}
                  data-testid="client-detail-entity"
                >
                  {client.entity}
                </Badge>
                <Badge
                  variant="secondary"
                  className={`text-xs  font-bold tracking-normal rounded-[8px] border-[#E2E8F0] ${
                    isArchived
                      ? 'bg-[#FEF2F2] text-[#DC2626]'
                      : 'bg-[#F8FAFC] text-[#1E293B]'
                  }`}
                  data-testid="client-detail-status"
                >
                  {client.status}
                </Badge>
                {client.retainer && (
                  <Badge
                    variant="secondary"
                    className="bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs border-[#E2E8F0] rounded-[6px] text-xs font-bold tracking-normal"
                    data-testid="client-detail-retainer-badge"
                  >
                    Retainer
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-lg font-semibold uppercase tracking-tight text-[#1E293B] flex items-center gap-2 pt-1">
                <Building2 className="h-5 w-5 text-[#1D4ED8]" />
                <span data-testid="client-detail-name">{client.name}</span>
              </DialogTitle>
              {client.tradeName && (
                <DialogDescription className="text-xs text-[#475569]">
                  Trade Name / DBA: <span className="font-bold text-[#1E293B]">{client.tradeName}</span>
                </DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Master Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          {/* TIN */}
          <div className="p-3 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] space-y-1">
            <div className="text-xs font-bold text-[#475569] tracking-normal">
              Tax Identification Number (TIN)
            </div>
            <div className="font-mono font-bold text-[#1E293B] text-sm tabular-nums" data-testid="client-detail-tin">
              {client.tin}
            </div>
          </div>

          {/* RDO Code */}
          <div className="p-3 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] space-y-1">
            <div className="text-xs font-bold text-[#475569] tracking-normal">
              Revenue District Office (RDO)
            </div>
            <div className="font-bold text-[#1E293B]" data-testid="client-detail-rdo">
              {client.rdoCode ? `RDO ${client.rdoCode}` : '—'}
            </div>
          </div>

          {/* Official Address */}
          <div className="sm:col-span-2 p-3 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] space-y-1">
            <div className="text-xs font-bold text-[#475569] tracking-normal">
              Registered Address
            </div>
            <div className="text-[#1E293B]" data-testid="client-detail-address">
              {client.address || 'No address provided'}
            </div>
          </div>

          {/* Retainer Fee Info */}
          {client.retainer && (
            <div className="sm:col-span-2 p-3 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] space-y-1">
              <div className="text-xs font-bold text-[#1E293B] tracking-normal flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-[#1E293B]" />
                Retainer Agreement
              </div>
              <div className="text-[#1E293B] font-medium">
                {client.retainerFee !== null && client.retainerFee !== undefined ? (
                  <span>
                    Monthly Retainer Fee:{' '}
                    <span className="font-bold text-[#1E293B] tabular-nums" data-testid="client-detail-fee">
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
          <h4 className="text-xs font-bold tracking-normal text-[#1E293B]">
            Contact Information
          </h4>
          <div className="p-3 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] space-y-2">
            <div className="text-xs">
              <span className="text-[#475569]">Point of Contact: </span>
              <span className="font-bold text-[#1E293B]" data-testid="client-detail-contact-person">
                {pocUser ? `${pocUser.name}${pocUser.role ? ` (${pocUser.role})` : ''}` : client.contactPerson || '—'}
              </span>
            </div>

            {/* Contact Details List */}
            {client.contactDetails && client.contactDetails.length > 0 ? (
              <div className="pt-2 border-t border-[#E2E8F0] space-y-1.5">
                <div className="text-xs font-bold text-[#475569] tracking-normal">Channels:</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="client-detail-contact-channels">
                  {client.contactDetails.map((cd, index) => (
                    <div
                      key={cd.id || index}
                      className="flex items-center gap-2 p-2 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] text-xs"
                    >
                      {cd.type === 'email' ? (
                        <Mail className="h-3.5 w-3.5 text-[#1E293B] shrink-0" />
                      ) : (
                        <Phone className="h-3.5 w-3.5 text-[#1E293B] shrink-0" />
                      )}
                      <div className="truncate">
                        <span className="text-[#1E293B]">{cd.value}</span>
                        {cd.label && (
                          <span className="text-xs text-[#475569] block truncate">
                            {cd.label} ({cd.type})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-[#475569] italic">No additional contact details registered.</p>
            )}
          </div>
        </div>

        {/* Related Companies */}
        {client.relatedCompanies && client.relatedCompanies.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold tracking-normal text-[#1E293B]">
              Related Companies & Affiliates
            </h4>
            <div className="p-3 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] space-y-1.5" data-testid="client-detail-related-companies">
              {client.relatedCompanies.map((rc, idx) => (
                <div
                  key={rc.id || idx}
                  className="flex items-center justify-between p-2 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] text-xs"
                >
                  <div className="flex items-center gap-1.5 text-[#1E293B]">
                    <Layers className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                    {(() => {
                      const relClient = allClients.find((c) => c.id === rc.relatedClientId);
                      return relClient ? (
                        <span className="font-bold text-[#1E293B]">
                          {relClient.name}{' '}
                          <span className="text-xs font-normal text-[#475569]">
                            ({relClient.entity})
                          </span>
                        </span>
                      ) : (
                        <span className="font-mono text-xs">Client ID: {rc.relatedClientId}</span>
                      );
                    })()}
                  </div>
                  {rc.relationship && (
                    <Badge variant="outline" className="text-xs uppercase rounded-[6px] bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B]">
                      {rc.relationship}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Metadata Footer */}
        <div className="pt-2 border-t border-[#E2E8F0] flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-[#475569]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3 text-[#475569]" />
              Registered: {new Date(client.createdAt).toLocaleDateString()}
            </span>
          </div>
          <div className="break-all">ID: {client.id}</div>
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 pt-2 border-t border-[#E2E8F0]">
          {canEditClients && !isArchived && onEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onClose();
                onEdit(client);
              }}
              className="text-xs tracking-normal rounded-[6px] text-[#1E293B] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC]"
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
            className="text-xs tracking-normal font-bold rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
            data-testid="client-detail-close-btn"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
