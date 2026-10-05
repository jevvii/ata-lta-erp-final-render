/**
 * TypeScript types for Clients Module (Parcel CLI / Module #8)
 *
 * Citation: Frozen API Contract clients@2.0.0 (docs/api-contracts/modules/clients.md)
 */

export type ContactDetailType = 'email' | 'mobile' | 'phone' | 'landline' | 'other';

export interface ContactDetail {
  id?: string;
  type: ContactDetailType;
  value: string;
  label?: string | null;
}

export interface RelatedCompany {
  id?: string;
  relatedClientId: string;
  relationship?: string | null;
}

export interface Client {
  id: string;
  entity: 'ATA' | 'LTA' | string;
  name: string;
  tin: string;
  rdoCode?: string | null;
  address?: string | null;
  tradeName?: string | null;
  contactUserId?: string | null;
  contactPerson?: string | null;
  retainer: boolean;
  retainerFee?: number | null;
  status: 'Active' | 'Inactive' | 'Archived' | string;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  version: number;
  contactDetails?: ContactDetail[];
  relatedCompanies?: RelatedCompany[];
}

export interface ClientCounts {
  active: number;
  archived: number;
}

export interface ClientFilters {
  search?: string;
  status?: string;
  archived?: boolean;
  page?: number;
  limit?: number;
  sortBy?: 'name' | 'created_at' | 'updated_at' | 'status' | string;
  sortOrder?: 'asc' | 'desc';
  entity?: string | null;
  retainer?: boolean | 'all';
}

export interface CreateClientInput {
  name: string;
  tin: string;
  rdoCode?: string;
  address?: string;
  entity: 'ATA' | 'LTA';
  retainer?: boolean;
  retainerFee?: number | null;
  tradeName?: string;
  contactUserId?: string | null;
  contactPerson?: string | null;
  contactDetails?: Omit<ContactDetail, 'id'>[];
  relatedCompanies?: Omit<RelatedCompany, 'id'>[];
}

export interface UpdateClientInput extends Partial<CreateClientInput> {
  expectedVersion?: number;
}

export interface ClientListResponse {
  data: Client[];
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface ClientDetailResponse {
  data: Client;
}

export interface ClientCountsResponse {
  data: ClientCounts;
}
