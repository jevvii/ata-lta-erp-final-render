import { Eye, Edit3, Archive, RotateCcw, FolderOpen, Building, CheckCircle, Mail, Phone } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePermission } from '@/lib/permissions';
import type { Client } from '../api/types';

export interface ClientTableProps {
  clients: Client[];
  isLoading: boolean;
  onView: (client: Client) => void;
  onEdit: (client: Client) => void;
  onArchive: (client: Client) => void;
  onRestore: (client: Client) => void;
}

export function ClientTable({
  clients,
  isLoading,
  onView,
  onEdit,
  onArchive,
  onRestore,
}: ClientTableProps) {
  const canEditClients = usePermission('clients:edit');

  if (isLoading) {
    return (
      <div className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] p-8 text-center" data-testid="clients-table-loading">
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="h-6 w-6 animate-spin rounded-full border-[#E2E8F0] border-t-transparent" />
          <p className="text-xs text-[#475569] tracking-normal">Loading client directory...</p>
        </div>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div
        className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] p-12 text-center"
        data-testid="clients-empty-state"
      >
        <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
          <div className="p-3 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] text-[#1E293B]">
            <FolderOpen className="h-8 w-8" />
          </div>
          <h3 className="font-bold text-sm text-[#1E293B] tracking-normal">No clients found</h3>
          <p className="text-xs text-[#475569]">
            No client records match your current filter parameters or tab selection.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] overflow-hidden" data-testid="clients-table-container">
      <Table data-testid="clients-table">
        <TableHeader>
          <TableRow className="bg-[#F8FAFC] border-b border-[#E2E8F0] hover:bg-[#F8FAFC]">
            <TableHead className="font-bold tracking-normal text-xs text-[#1E293B] w-1/4">Client Name</TableHead>
            <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">TIN & RDO</TableHead>
            <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">Entity</TableHead>
            <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">Agreement</TableHead>
            <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">Contact</TableHead>
            <TableHead className="font-bold tracking-normal text-xs text-[#1E293B] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.map((client) => {
            const isArchived = client.status === 'Archived' || Boolean(client.deletedAt);
            const primaryEmail = client.contactDetails?.find((c) => c.type === 'email')?.value;
            const primaryPhone = client.contactDetails?.find((c) => c.type === 'mobile' || c.type === 'phone')?.value;

            return (
              <TableRow
                key={client.id}
                className="hover:bg-[#E2E8F0] cursor-pointer transition-none border-b border-[#E2E8F0]"
                onClick={() => onView(client)}
                data-testid={`client-row-${client.id}`}
              >
                {/* Name & Trade Name */}
                <TableCell className="py-3">
                  <div className="space-y-0.5">
                    <div className="font-bold text-xs text-[#1E293B] flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                      <span className="truncate" data-testid={`client-name-${client.id}`}>
                        {client.name}
                      </span>
                    </div>
                    {client.tradeName && (
                      <p className="text-xs text-[#475569] pl-5 truncate">
                        DBA: {client.tradeName}
                      </p>
                    )}
                  </div>
                </TableCell>

                {/* TIN & RDO */}
                <TableCell className="py-3">
                  <div className="text-xs font-mono text-[#1E293B] tabular-nums font-semibold" data-testid={`client-tin-${client.id}`}>
                    {client.tin}
                  </div>
                  {client.rdoCode && (
                    <div className="text-xs text-[#475569] mt-0.5">
                      RDO {client.rdoCode}
                    </div>
                  )}
                </TableCell>

                {/* Entity */}
                <TableCell className="py-3">
                  <Badge
                    variant="outline"
                    className={`text-xs  font-bold tracking-normal rounded-[6px] px-2 py-0.5 ${
                      client.entity === 'ATA'
                        ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs border-[#E2E8F0]'
                        : 'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0]'
                    }`}
                    data-testid={`client-entity-${client.id}`}
                  >
                    {client.entity}
                  </Badge>
                </TableCell>

                {/* Agreement / Retainer */}
                <TableCell className="py-3">
                  {client.retainer ? (
                    <div className="space-y-0.5">
                      <Badge
                        variant="secondary"
                        className="bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs border-[#E2E8F0] rounded-[6px] text-xs font-bold uppercase flex items-center gap-1 w-fit"
                        data-testid={`client-retainer-badge-${client.id}`}
                      >
                        <CheckCircle className="h-3 w-3 text-[#FFFFFF]" />
                        Retainer
                      </Badge>
                      {client.retainerFee !== null && client.retainerFee !== undefined && (
                        <div className="text-xs text-[#1E293B] tabular-nums">
                          ₱{client.retainerFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}/mo
                        </div>
                      )}
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-xs uppercase rounded-[6px] text-[#475569] border-[#E2E8F0] bg-transparent">
                      Standard
                    </Badge>
                  )}
                </TableCell>

                {/* Contact */}
                <TableCell className="py-3">
                  <div className="space-y-0.5 text-xs text-[#1E293B]">
                    {client.contactPerson && (
                      <div className="font-semibold truncate">{client.contactPerson}</div>
                    )}
                    {primaryEmail && (
                      <div className="flex items-center gap-1 text-xs text-[#475569] truncate">
                        <Mail className="h-3 w-3 text-[#475569] shrink-0" />
                        <span className="truncate">{primaryEmail}</span>
                      </div>
                    )}
                    {!primaryEmail && primaryPhone && (
                      <div className="flex items-center gap-1 text-xs text-[#475569] truncate">
                        <Phone className="h-3 w-3 text-[#475569] shrink-0" />
                        <span className="truncate">{primaryPhone}</span>
                      </div>
                    )}
                  </div>
                </TableCell>

                {/* Actions */}
                <TableCell className="py-3 text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-1">
                    {/* View Details */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onView(client)}
                      className="h-8 w-8 p-0 rounded-[6px] text-[#1E293B] hover:bg-[#F8FAFC] hover:border hover:border-[#E2E8F0]"
                      data-testid={`view-client-btn-${client.id}`}
                      title="View Details"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>

                    {/* Edit Client (gated on clients:edit) */}
                    {canEditClients && !isArchived && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(client)}
                        className="h-8 w-8 p-0 rounded-[6px] text-[#1E293B] hover:bg-[#F8FAFC] hover:border hover:border-[#E2E8F0]"
                        data-testid={`edit-client-btn-${client.id}`}
                        title="Edit Client"
                      >
                        <Edit3 className="h-4 w-4" />
                      </Button>
                    )}

                    {/* Archive / Restore Button (gated on clients:edit) */}
                    {canEditClients && (
                      isArchived ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onRestore(client)}
                          className="h-8 w-8 p-0 rounded-[6px] text-[#1E293B] hover:bg-[#F8FAFC] hover:border hover:border-[#E2E8F0]"
                          data-testid={`restore-client-btn-${client.id}`}
                          title="Restore Client"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onArchive(client)}
                          className="h-8 w-8 p-0 rounded-[6px] text-[#DC2626] hover:bg-[#F8FAFC] hover:border hover:border-[#FCA5A5]"
                          data-testid={`archive-client-btn-${client.id}`}
                          title="Archive Client"
                        >
                          <Archive className="h-4 w-4" />
                        </Button>
                      )
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
