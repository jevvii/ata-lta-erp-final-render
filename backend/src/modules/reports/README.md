# Reports Module

**Owner:** Agent B / Team B  
**Phase:** 7

## Endpoints

| Method | Path | Permission | Query Params | Description |
|--------|------|------------|--------------|-------------|
| `GET` | `/v1/reports/analytics` | `reports:view` | none | Dashboard analytics |
| `GET` | `/v1/reports/daily` | `reports:view` | `date=YYYY-MM-DD` | Daily activity report |
| `GET` | `/v1/reports/weekly` | `reports:view` | `date=YYYY-MM-DD` | Weekly summary (Mon-Sun) |
| `GET` | `/v1/reports/monthly-pending` | `reports:view` | `month=YYYY-MM` | Pending items |
| `GET` | `/v1/reports/aging` | `billing:view` | none | AR aging report |

## Analytics Response

Returns counts and summaries for: clients, work requests, documents, invoices (with revenue breakdown), disbursements, transmittals, and net income.

## Aging Report

Groups unpaid invoices by bucket:
- Current (not yet due)
- 1-30 days overdue
- 31-60 days overdue
- 61-90 days overdue
- 90+ days overdue

Includes per-client breakdown and grand total.

## Notes

- All endpoints are **read-only** — no audit logging needed.
- Results are entity-scoped via `X-Active-Entity` header.
- Report calculations are designed to match the prototype's frontend logic.
