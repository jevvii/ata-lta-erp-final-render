# Billing statement printing and admin editing

The prototype transmittal keeps a company-details option shared between its detail controls, preview, and separate print window. Checked includes sender details. The prototype billing option is inversely worded: **No company details and logo**, where checked omits branding. Billing now uses that wording and behavior so the checked state matches the requested output.

Previously, React billing maintained separate JSX preview markup, a print-window renderer, and a different backend invoice PDF template. The preview and print window now use `buildStatementDocument`; the backend carries its equivalent pure statement renderer so independently deployed frontend/backend branches produce matching documents. Keep the statement renderer in `frontend/src/lib/printDocuments.ts` and `backend/src/modules/billing/statementDocument.js` synchronized when changing the document.

The checkbox affects preview, Print Document, and Download PDF. Each new preview starts with branding enabled. Omitting branding keeps header space and A4 margins (15 mm vertically, 20 mm horizontally), and uses the prototype generic layout. Blank CSS page margin boxes remove browser date/title/URL/page-count corner text from print output. Server PDFs explicitly disable headers and footers. PDF requests use separate storage paths so branded and unbranded downloads cannot overwrite each other.

Admins can edit inline in both invoice detail and print preview, or use Edit Invoice in detail view, including released invoices. Both editors share validation and persistence. Editable content includes invoice metadata, client snapshot name/TIN/address, line-item description/type/amount/order, notes, terms, printed payment details, and noted/prepared/received names. Totals derive from line items; balances and payment status are recalculated transactionally. Printed payment fields are invoice snapshots, distinct from recorded payment ledger entries. Master client records are not changed. Non-admin draft and address permission restrictions remain enforced.

Deploy backend migration `000067_invoice_statement_details_admin_edit.js` before using statement-field editing. It adds invoice `print_details` and updates the existing transactional invoice function while preserving row locks and version checks. The migration is reversible; rollback removes the new statement data.

Validation on 2026-10-19:

- Frontend billing and transmittal print regressions: 271 tests passed.
- Backend billing persistence/PDF/address/OCC regressions: 165 tests passed.
- Frontend production build and scoped frontend/backend ESLint checks passed.
- Temporary PostgreSQL runtime: migration up/down, admin/non-admin checks, stale-write rejection, unchanged line items after rejected edits, total/balance recalculation, and Paid/Partially Paid transitions verified.
- Chromium: ATA/LTA branded and plain previews inspected, inline fields exercised, PDFs generated with browser headers enabled and text extraction confirmed blank corners. Desktop/tablet/phone controls inspected; the A4 sheet scrolls within its preview container on narrow screens.
- Design inspector's legacy-document font/border rules and dialog shadow/title findings are accepted: this change preserves the requested prototype print design and the app's existing modal conventions.

No staging database migration was executed during verification.
