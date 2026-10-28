/**
 * Clients Route Page (Parcel CLI / Module #8)
 *
 * Citation: Frozen API Contract clients@2.0.0 (docs/api-contracts/modules/clients.md)
 * Gated by clients:view permission and 'Clients' feature flag.
 * Mounts BlockingActionModal at root.
 */

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Plus, Upload } from 'lucide-react';
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
  ClientImportModal,
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
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
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
    <div className="w-full space-y-6" data-testid="clients-page">
      {/* 1. Unified Module Header */}
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
          >
            <span>Modules</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#1E293B] font-semibold">Clients</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <Building2 className="h-6 w-6 text-[#1D4ED8]" />
            Clients &amp; Master Records
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
            Maintain registered entities, tax identification numbers, and contact channels.
          </p>
        </div>

        {/* Action Button: Gated on clients:edit */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {canEditClients && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsImportModalOpen(true)}
                className="text-xs font-medium border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px] h-9 gap-1.5 shadow-2xs cursor-pointer"
                data-testid="import-clients-btn"
              >
                <Upload className="h-4 w-4 text-[#475569]" />
                Import
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={handleCreate}
                className="text-xs font-medium bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] rounded-[6px] h-9 gap-1.5 shadow-2xs cursor-pointer"
                data-testid="new-client-btn"
              >
                <Plus className="h-4 w-4" />
                New Client
              </Button>
            </>
          )}
        </div>
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
      {canEditClients && (
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
      )}

      {/* Import Clients Modal */}
      {canEditClients && (
        <ClientImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
        />
      )}

      {/* Global Blocking Action Modal */}
      <BlockingActionModal />
    </div>
  );
}
