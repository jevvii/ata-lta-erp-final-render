import type { InvoiceFilters, NextInvoiceNumberParams } from './types';

export const billingKeys = {
  all: ['billing'] as const,
  invoices: () => [...billingKeys.all, 'invoices'] as const,
  invoicesList: (entity: string | null | undefined, filters?: InvoiceFilters) =>
    [...billingKeys.invoices(), 'list', entity, filters] as const,
  invoiceDetail: (id: string | undefined) =>
    [...billingKeys.invoices(), 'detail', id] as const,
  counts: (entity: string | null | undefined) =>
    [...billingKeys.all, 'counts', entity] as const,
  nextNumber: (entity: string | null | undefined, params?: NextInvoiceNumberParams) =>
    [...billingKeys.all, 'next-number', entity, params] as const,
  aging: (entity: string | null | undefined) =>
    [...billingKeys.all, 'aging', entity] as const,
  templates: (entity: string | null | undefined) =>
    [...billingKeys.all, 'templates', entity] as const,
};
