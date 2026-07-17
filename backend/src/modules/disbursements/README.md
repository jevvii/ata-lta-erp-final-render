# Disbursements Module

**Owner:** Agent B / Team B  
**Phase:** 6

## Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/v1/disbursements` | `disbursement:view` | List disbursements |
| `POST` | `/v1/disbursements` | `disbursement:create` | Create disbursement |
| `GET` | `/v1/disbursements/:id` | `disbursement:view` | Get single |
| `PUT` | `/v1/disbursements/:id` | `disbursement:edit` | Update (Draft only) |
| `POST` | `/v1/disbursements/:id/submit` | `disbursement:create` | Submit for approval |
| `POST` | `/v1/disbursements/:id/approve` | `disbursement:mark_released` | Approve |
| `POST` | `/v1/disbursements/:id/release` | `disbursement:mark_released` | Release funds |
| `POST` | `/v1/disbursements/:id/reject` | `disbursement:mark_released` | Reject with reason |

## Approval Workflow

```
Draft → Pending → Approved → Released
                ↘ Rejected ↗
```

- **Draft**: Can be edited
- **Pending**: Awaiting approval. Can be approved or rejected.
- **Approved**: Awaiting release. Can be released or rejected.
- **Released**: Final state. Payment details recorded.
- **Rejected**: Terminal state with reason.

## Disbursement Number Format

`DISB-{ENTITY}-{YYYYMMDD}-{SEQ}` (e.g., `DISB-ATA-20260712-0001`)

## Fund Sources

- Firm Fund
- Client Fund
