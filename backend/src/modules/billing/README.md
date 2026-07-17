# Billing / Invoices Module

**Owner:** Agent B / Team B  
**Phase:** 5

## Endpoints

### Invoices

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/v1/invoices` | `billing:view` | List invoices |
| `POST` | `/v1/invoices` | `billing:edit` | Create invoice with line items |
| `GET` | `/v1/invoices/:id` | `billing:view` | Get invoice with items + payments |
| `PUT` | `/v1/invoices/:id` | `billing:edit` | Update invoice |
| `DELETE` | `/v1/invoices/:id` | `billing:delete` | Soft-delete invoice |
| `POST` | `/v1/invoices/:id/payments` | `billing:payments` | Record a payment |
| `GET` | `/v1/invoices/:id/pdf` | `billing:view` | Generate invoice PDF |
| `GET` | `/v1/invoices/:id/voucher` | `billing:view` | Generate payment voucher PDF |
| `GET` | `/v1/invoices/aging` | `billing:view` | Aging report |

### Billing Templates

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/v1/invoices/templates` | `billing:view` | List templates |
| `POST` | `/v1/invoices/templates` | `billing:templates` | Create template |
| `PUT` | `/v1/invoices/templates/:id` | `billing:templates` | Update template |
| `DELETE` | `/v1/invoices/templates/:id` | `billing:templates` | Delete template |

## Invoice Statuses

Draft → Sent → Partially Paid → Paid

## Payment Recording

When a payment is recorded:
- `amount_paid` increases by the payment amount
- `balance` = `total` - `amount_paid`
- If `balance` ≤ 0, status → `Paid`
- If `balance` > 0 and `amount_paid` > 0, status → `Partially Paid`

## Aging Buckets

| Bucket | Days Overdue |
|--------|-------------|
| Current | Not yet due |
| 1-30 | 1–30 days past due |
| 31-60 | 31–60 days past due |
| 61-90 | 61–90 days past due |
| 90+ | Over 90 days past due |

## PDF Storage

Generated PDFs stored at: `entities/{entity_id}/invoices/{id}/pdf/{invoice_number}.pdf`
