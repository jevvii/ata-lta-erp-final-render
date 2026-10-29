/**
 * Zod validation schemas for reports@2.0.0.
 * Frozen per docs/api-contracts/modules/reports.md.
 */

import { z } from 'zod';

// ============================================================================
// Query Parameter Schemas
// ============================================================================

export const analyticsQuerySchema = z
  .object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .optional();

export const dailyQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

export const weeklyQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

export const monthlyPendingQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format')
    .optional(),
});

export const agingQuerySchema = z
  .object({
    clientId: z.string().guid().optional(),
  })
  .optional();

// ============================================================================
// Response Model Schemas
// ============================================================================

export const analyticsDataSchema = z.object({
  clients: z.object({ total: z.number() }),
  workRequests: z.object({ total: z.number() }),
  documents: z.object({ total: z.number() }),
  invoices: z.object({
    total: z.number(),
    totalBilled: z.number(),
    totalCollected: z.number(),
    totalOutstanding: z.number(),
    byStatus: z.record(z.string(), z.number()),
  }),
  disbursements: z.object({
    total: z.number(),
    totalAmount: z.number(),
    releasedAmount: z.number(),
    byStatus: z.record(z.string(), z.number()),
  }),
  transmittals: z.object({
    total: z.number(),
    byStatus: z.record(z.string(), z.number()),
  }),
  revenue: z.object({
    totalBilled: z.number(),
    totalCollected: z.number(),
    totalOutstanding: z.number(),
    totalExpenses: z.number(),
    netIncome: z.number(),
  }),
});

export const consolidatedAnalyticsSchema = z.object({
  analyticsByEntity: z.object({
    ATA: analyticsDataSchema,
    LTA: analyticsDataSchema,
  }),
});

export const calendarItemSchema = z.discriminatedUnion('type', [
  z.object({
    id: z.string(),
    type: z.literal('wr'),
    title: z.string(),
    status: z.string(),
    dueDate: z.string().nullable().optional(),
    clientId: z.string().nullable().optional(),
    assigneeId: z.string().nullable().optional(),
    entity: z.enum(['ATA', 'LTA']),
    tasks: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        assigneeId: z.string().nullable().optional(),
        assigneeName: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
      })
    ),
  }),
  z.object({
    id: z.string(),
    type: z.literal('db'),
    title: z.string(),
    status: z.string(),
    dueDate: z.string().nullable().optional(),
    clientId: z.string().nullable().optional(),
    entity: z.enum(['ATA', 'LTA']),
    amount: z.number(),
  }),
]);

export const dashboardResponseDataSchema = z.union([
  analyticsDataSchema.extend({
    calendar: z.array(calendarItemSchema),
  }),
  z.object({
    analyticsByEntity: z.object({
      ATA: analyticsDataSchema,
      LTA: analyticsDataSchema,
    }),
    ATA: analyticsDataSchema.optional(),
    LTA: analyticsDataSchema.optional(),
    calendar: z.array(calendarItemSchema),
  }),
]);

export const dailyReportDataSchema = z.object({
  date: z.string(),
  workRequests: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      created_at: z.string().optional(),
    })
  ),
  documents: z.array(
    z.object({
      id: z.string(),
      original_name: z.string(),
      category: z.string(),
      created_at: z.string().optional(),
    })
  ),
  invoices: z.array(
    z.object({
      id: z.string(),
      invoice_number: z.string(),
      total: z.union([z.number(), z.string()]),
      status: z.string(),
      created_at: z.string().optional(),
    })
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      amount: z.union([z.number(), z.string()]),
      method: z.string(),
      payment_date: z.string().optional(),
      invoice_id: z.string().optional(),
      created_at: z.string().optional(),
    })
  ),
  disbursements: z.array(
    z.object({
      id: z.string(),
      disbursement_number: z.string(),
      amount: z.union([z.number(), z.string()]),
      status: z.string(),
      created_at: z.string().optional(),
    })
  ),
  transmittals: z.array(
    z.object({
      id: z.string(),
      tracking_number: z.string(),
      status: z.string(),
      created_at: z.string().optional(),
    })
  ),
  summary: z.object({
    workRequests: z.number(),
    documents: z.number(),
    invoices: z.number(),
    invoicesTotal: z.number(),
    payments: z.number(),
    paymentsTotal: z.number(),
    disbursements: z.number(),
    disbursementsTotal: z.number(),
    transmittals: z.number(),
  }),
});

export const weeklyReportDataSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  summary: z.object({
    workRequests: z.number(),
    invoices: z.number(),
    invoicesTotal: z.number(),
    payments: z.number(),
    paymentsTotal: z.number(),
    disbursements: z.number(),
    disbursementsTotal: z.number(),
    documents: z.number(),
    transmittals: z.number(),
  }),
  details: z.object({
    workRequests: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.string(),
        created_at: z.string().optional(),
      })
    ),
    invoices: z.array(
      z.object({
        id: z.string(),
        invoice_number: z.string(),
        total: z.union([z.number(), z.string()]),
        status: z.string(),
        created_at: z.string().optional(),
      })
    ),
    payments: z.array(
      z.object({
        id: z.string(),
        amount: z.union([z.number(), z.string()]),
        method: z.string(),
        created_at: z.string().optional(),
      })
    ),
    disbursements: z.array(
      z.object({
        id: z.string(),
        disbursement_number: z.string(),
        amount: z.union([z.number(), z.string()]),
        status: z.string(),
        created_at: z.string().optional(),
      })
    ),
    documents: z.array(
      z.object({
        id: z.string(),
        original_name: z.string(),
        created_at: z.string().optional(),
      })
    ),
    transmittals: z.array(
      z.object({
        id: z.string(),
        tracking_number: z.string(),
        status: z.string(),
        created_at: z.string().optional(),
      })
    ),
  }),
});

export const monthlyPendingDataSchema = z.object({
  month: z.string(),
  overdueInvoices: z.object({
    count: z.number(),
    totalOutstanding: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        invoice_number: z.string(),
        client_id: z.string().nullable().optional(),
        due_date: z.string(),
        total: z.union([z.number(), z.string()]),
        balance: z.union([z.number(), z.string()]),
        status: z.string(),
        clients: z.object({ name: z.string() }).nullable().optional(),
      })
    ),
  }),
  pendingDisbursements: z.object({
    count: z.number(),
    totalAmount: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        disbursement_number: z.string(),
        amount: z.union([z.number(), z.string()]),
        status: z.string(),
        category: z.string().nullable().optional(),
        created_at: z.string().optional(),
      })
    ),
  }),
  staleTransmittals: z.object({
    count: z.number(),
    items: z.array(
      z.object({
        id: z.string(),
        tracking_number: z.string(),
        client_id: z.string().nullable().optional(),
        created_at: z.string().optional(),
        status: z.string().optional(),
        clients: z.object({ name: z.string() }).nullable().optional(),
      })
    ),
  }),
});

export const agingInvoiceEntrySchema = z.object({
  id: z.string(),
  invoiceNumber: z.string(),
  clientName: z.string(),
  clientId: z.string().nullable().optional(),
  dueDate: z.string(),
  total: z.number(),
  balance: z.number(),
  daysOverdue: z.number(),
});

export const agingBucketDetailSchema = z.object({
  total: z.number(),
  count: z.number(),
  invoices: z.array(agingInvoiceEntrySchema),
});

export const agingReportDataSchema = z.object({
  summary: z.object({
    current: z.number(),
    '1-30': z.number(),
    '31-60': z.number(),
    '61-90': z.number(),
    '90+': z.number(),
    grandTotal: z.number(),
  }),
  buckets: z.object({
    current: agingBucketDetailSchema,
    '1-30': agingBucketDetailSchema,
    '31-60': agingBucketDetailSchema,
    '61-90': agingBucketDetailSchema,
    '90+': agingBucketDetailSchema,
  }),
});
