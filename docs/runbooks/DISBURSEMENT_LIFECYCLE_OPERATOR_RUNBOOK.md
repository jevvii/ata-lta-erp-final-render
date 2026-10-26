# Disbursement workflow operator notes

## Current development scope

The owner confirmed that existing system records are test data. There is no legacy classification status, review tab, reconciliation form or reconciliation API. New requests use Draft → Approved → Funded → Released. The same Admin can create, approve, prepare and release their own request. Accounting may prepare payment but cannot perform final release.

## Preserve existing saved records

Migration 69 adds only technical workflow-version and review-readiness fields. It does not rewrite existing statuses, amounts, payment details, attribution, attachments or archive flags. Existing test vouchers remain readable and printable through standard endpoints. They remain outside new financial-action queues, preserving the meaning of older Funded/Released values without a reconciliation feature. Test the redesigned actions using a new request.

An internal version identifies which workflow created a row. This is compatibility metadata, not a user-facing status. Existing documents with missing attachments return an unavailable-document message rather than a crash. Existing authorized Admin print customization remains available without changing financial values. No future reset of the hosted test records is performed by these migrations.

## Normal actions

| Stage | Actor and action | Result |
| --- | --- | --- |
| Draft, ready for review | Admin approves, including their own request | Approved |
| Approved | Accounting or Admin enters method, bank/source, reference and valid date | Funded |
| Funded | Admin records release, including an instrument they prepared | Released |
| Draft or Funded | Admin rejects with a reason | Rejected |
| Rejected | Admin returns for correction | Draft, awaiting an actual correction |
| Released | Admin archives/restores | Released remains the financial state |

Every edit/action requires the current positive expectedVersion. Stale requests return a conflict and must be reviewed before retrying. Payment preparation does not increase paid totals. Final release uses the persisted instrument and cannot replace its fields. All actions append history atomically. Browser identity/financial writes remain blocked; actor and entity authority are checked by API and SQL.

## Deployment checks

Coordinate compatible backend and frontend releases and drain old writers. Back up the current test database/attachment metadata and rehearse compatibility against stored test records. Verify ordinary reads/PDFs, queue/count/report behavior, receipt uploads and the single-Admin workflow. A real financial-data reconciliation exercise is not required for the owner-confirmed test dataset.

The receipt reservation provider still needs RESERVATION_STORE_PATH set to an absolute path on a shared durable volume across backend instances. A prior database-provider draft is separate and unmerged. Verify hosted reservation storage and private bucket access before release; localhost uses an isolated local path.

Migration 70 refuses automatic destructive rollback; migration 71 retains financial read/write restrictions on down. Use a reviewed forward repair or a verified backup if recovery is required. Clearing development data for a future deployment is a separate operation and must target the explicitly chosen environment. These changes do not clear records.
