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
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center" data-testid="clients-table-loading">
        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-sm text-slate-500">Loading client directory...</p>
        </div>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div
        className="rounded-lg border border-slate-200 bg-white p-12 text-center"
        data-testid="clients-empty-state"
      >
        <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
          <div className="p-3 bg-slate-100 rounded-full text-slate-400">
            <FolderOpen className="h-8 w-8" />
          </div>
          <h3 className="font-semibold text-slate-900">No clients found</h3>
          <p className="text-sm text-slate-500">
            No client records match your current filter parameters or tab selection.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden" data-testid="clients-table-container">
      <Table data-testid="clients-table">
        <TableHeader>
          <TableRow className="bg-slate-50 hover:bg-slate-50">
            <TableHead className="font-semibold text-xs text-slate-700 w-1/4">Client Name</TableHead>
            <TableHead className="font-semibold text-xs text-slate-700">TIN & RDO</TableHead>
            <TableHead className="font-semibold text-xs text-slate-700">Entity</TableHead>
            <TableHead className="font-semibold text-xs text-slate-700">Agreement</TableHead>
            <TableHead className="font-semibold text-xs text-slate-700">Contact</TableHead>
            <TableHead className="font-semibold text-xs text-slate-700 text-right">Actions</TableHead>
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
                className="hover:bg-slate-50/80 cursor-pointer transition-colors"
                onClick={() => onView(client)}
                data-testid={`client-row-${client.id}`}
              >
                {/* Name & Trade Name */}
                <TableCell className="py-3">
                  <div className="space-y-0.5">
                    <div className="font-semibold text-xs text-slate-900 flex items-center gap-1.5">
                      <Building className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span className="truncate" data-testid={`client-name-${client.id}`}>
                        {client.name}
                      </span>
                    </div>
                    {client.tradeName && (
                      <p className="text-[11px] text-slate-500 pl-5 truncate">
                        DBA: {client.tradeName}
                      </p>
                    )}
                  </div>
                </TableCell>

                {/* TIN & RDO */}
                <TableCell className="py-3">
                  <div className="text-xs font-mono text-slate-800" data-testid={`client-tin-${client.id}`}>
                    {client.tin}
                  </div>
                  {client.rdoCode && (
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      RDO {client.rdoCode}
                    </div>
                  )}
                </TableCell>

                {/* Entity */}
                <TableCell className="py-3">
                  <Badge
                    variant="outline"
                    className={`text-[11px] font-semibold px-2 py-0.5 ${
                      client.entity === 'ATA'
                        ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
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
                        className="bg-purple-100 text-purple-800 border-purple-200 text-[11px] flex items-center gap-1 w-fit"
                        data-testid={`client-retainer-badge-${client.id}`}
                      >
                        <CheckCircle className="h-3 w-3" />
                        Retainer
                      </Badge>
                      {client.retainerFee !== null && client.retainerFee !== undefined && (
                        <div className="text-[11px] text-slate-600 font-mono">
                          ₱{client.retainerFee.toLocaleString('en-US', { minimumFractionDigits: 2 })}/mo
                        </div>
                      )}
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-[11px] text-slate-500 border-slate-200">
                      Standard
                    </Badge>
                  )}
                </TableCell>

                {/* Contact */}
                <TableCell className="py-3">
                  <div className="space-y-0.5 text-xs text-slate-700">
                    {client.contactPerson && (
                      <div className="font-medium truncate">{client.contactPerson}</div>
                    )}
                    {primaryEmail && (
                      <div className="flex items-center gap-1 text-[11px] text-slate-500 truncate">
                        <Mail className="h-3 w-3 text-slate-400 shrink-0" />
                        <span className="truncate">{primaryEmail}</span>
                      </div>
                    )}
                    {!primaryEmail && primaryPhone && (
                      <div className="flex items-center gap-1 text-[11px] text-slate-500 truncate">
                        <Phone className="h-3 w-3 text-slate-400 shrink-0" />
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
                      className="h-8 w-8 p-0 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
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
                        className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
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
                          className="h-8 w-8 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
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
                          className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50"
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
