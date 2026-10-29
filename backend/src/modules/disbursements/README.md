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

## Voucher PDF and printed details

Apply migration `000068_disbursement_print_details.js` before enabling printed voucher edits. It adds `disbursements.print_details`, a JSON object with an empty default. Rollback removes those snapshots.

`GET /v1/disbursements/:id/pdf` generates the expense report shown in the frontend preview and returns `{ data: { url } }`. The endpoint enforces the same entity and ownership checks as detail reads, including when the active entity is ALL. Boolean query options are:

- `noLogo=true`: omit only the logo (prototype Generic mode).
- `includeCompanyDetails=false`: omit company name, logo and branded footer; this takes precedence over `noLogo`.

The default includes the company name and logo. The backend embeds existing billing logo assets. A4 margins are 15 mm vertically and 20 mm horizontally; page headers/footers are disabled. Keep `printDocument.js` synchronized with the frontend's `src/lib/disbursementDocument.ts`.

PDF keys are stable per actual voucher number and header variant:

- `entities/{entity_code}/disbursements/{id}/pdf/{disbursement_number}.pdf`
- `entities/{entity_code}/disbursements/{id}/pdf/{disbursement_number}-no-logo.pdf`
- `entities/{entity_code}/disbursements/{id}/pdf/{disbursement_number}-no-company-details.pdf`

Generation upserts the existing variant, so it does not accumulate an object for each request or overwrite a differently branded variant. Editing the printed reference number does not change the storage key.

`PUT /v1/disbursements/:id` accepts administrator-only `printDetails` snapshots with `expectedVersion`: `requesterName`, `referenceNumber`, `submittedDate`, `workRequestName`, `paymentDate`, `paymentMethod`, `paymentReference`, `paymentBank`, `preparedBy`, `approvedBy`, and `releasedBy`. Submit the complete snapshot; supplied objects replace previous snapshots. Empty strings deliberately clear printed fields. Administrators may also correct core voucher fields after release, with a required version. Other roles retain existing edit restrictions. Snapshot edits do not reassign requester/employee or approval/release audit identities and do not change recorded payments; use the payment-details endpoint for those. Workflow status transitions remain separate from snapshot edits.

Regression coverage: `tests/disbursements.print.spec.js`, existing disbursement approval/API tests, concurrency and reports tests. Migration up/down and update/version behavior were additionally exercised in a temporary PostgreSQL runtime. No remote database was changed during development.
