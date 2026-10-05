/**
 * Clients Route Page (Parcel CLI / Module #8)
 *
 * Citation: Frozen API Contract clients@2.0.0 (docs/api-contracts/modules/clients.md)
 * Gated by clients:view permission and 'Clients' feature flag.
 * Mounts BlockingActionModal at root.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Forbidden } from '@/components/common/Forbidden';
import { ModulePlaceholder } from '@/components/common/ModulePlaceholder';
import { isModuleEnabled } from '@/lib/flags';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import {
  ClientFilterBar,
  ClientTable,
  ClientDetailModal,
  ClientModal,
} from '@/features/clients/components';
import {
  useClientsList,
  useClientCounts,
  useArchiveClient,
  useUnarchiveClient,
} from '@/features/clients/api/useClients';
import type { Client, ClientFilters } from '@/features/clients/api/types';

export default function ClientsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('tab') as 'active' | 'archived') || 'active';
  const isArchived = activeTab === 'archived';

  // Permission & Flag Checks
  const permissions = useSessionStore((state) => state.permissions);
  const canViewClients = hasPermission(permissions, 'clients:view');
  const canEditClients = hasPermission(permissions, 'clients:edit');

  // Filter state
  const [filters, setFilters] = useState<ClientFilters>({
    search: searchParams.get('search') || '',
    retainer: undefined,
    page: 1,
    limit: 50,
  });

  // Modals state
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  // Queries & Mutations
  const { data: counts } = useClientCounts();
  const { data: clientsData, isLoading } = useClientsList({
    ...filters,
    archived: isArchived,
  });

  const { archiveWithBlocking } = useArchiveClient();
  const { unarchiveWithBlocking } = useUnarchiveClient();

  // Flag Check
  if (!isModuleEnabled('Clients')) {
    return <ModulePlaceholder name="Clients" />;
  }

  // Permission Check
  if (!canViewClients) {
    return <Forbidden requiredPermission="clients:view" />;
  }

  const handleTabChange = (tab: 'active' | 'archived') => {
    setSearchParams((prev) => {
      prev.set('tab', tab);
      return prev;
    });
  };

  const handleFilterChange = (newFilters: Partial<ClientFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const handleResetFilters = () => {
    setFilters({
      search: '',
      retainer: undefined,
      page: 1,
      limit: 50,
    });
  };

  const handleView = (client: Client) => {
    setSelectedClient(client);
    setIsDetailOpen(true);
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setIsFormModalOpen(true);
  };

  const handleCreate = () => {
    setEditingClient(null);
    setIsFormModalOpen(true);
  };

  const handleArchive = async (client: Client) => {
    try {
      await archiveWithBlocking(client.id, client.name);
    } catch {
      // Captured by BlockingActionModal
    }
  };

  const handleRestore = async (client: Client) => {
    try {
      await unarchiveWithBlocking(client.id, client.name);
    } catch {
      // Captured by BlockingActionModal
    }
  };

  const clients = (clientsData?.data || []).filter((c) => {
    if (filters.retainer === true) return c.retainer === true;
    if (filters.retainer === false) return c.retainer === false;
    return true;
  });

  return (
    <div className="space-y-6" data-testid="clients-page">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-blue-600" />
            Clients & Master Records
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Maintain registered entities, tax identification numbers, and contact channels.
          </p>
        </div>

        {/* Action Button: Gated on clients:edit */}
        {canEditClients && (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleCreate}
            className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shadow-sm"
            data-testid="new-client-btn"
          >
            <Plus className="h-4 w-4" />
            New Client
          </Button>
        )}
      </div>

      {/* Filter and Tab Bar */}
      <ClientFilterBar
        filters={filters}
        counts={counts}
        onFilterChange={handleFilterChange}
        onReset={handleResetFilters}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* Main Clients Table */}
      <ClientTable
        clients={clients}
        isLoading={isLoading}
        onView={handleView}
        onEdit={handleEdit}
        onArchive={handleArchive}
        onRestore={handleRestore}
      />

      {/* Client Detail Inspection Modal */}
      <ClientDetailModal
        client={selectedClient}
        isOpen={isDetailOpen}
        onClose={() => {
          setIsDetailOpen(false);
          setSelectedClient(null);
        }}
        onEdit={handleEdit}
      />

      {/* Create / Edit Client Modal */}
      <ClientModal
        isOpen={isFormModalOpen}
        client={editingClient}
        onClose={() => {
          setIsFormModalOpen(false);
          setEditingClient(null);
        }}
        onSuccess={() => {
          setIsFormModalOpen(false);
          setEditingClient(null);
        }}
      />

      {/* Global Blocking Action Modal */}
      <BlockingActionModal />
    </div>
  );
}
