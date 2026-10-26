# Disbursement voucher printing and admin editing

The current expense-report preview is the reference for the cleaned document: company header, requester/reference boxes, category/description/fund/amount table, amount in words, payment details, three signature lines, and footer. The cleaned layout uses one document typeface, readable black text, consistent rules and A4 margins, and wraps work-request names instead of truncating them. Notes are included.

`src/lib/disbursementDocument.ts` provides the preview/print body, styles, amount-to-words conversion, and printable field defaults. The backend equivalent is `backend/src/modules/disbursements/printDocument.js`. Keep both renderers synchronized; six ATA/LTA and header-mode combinations were compared directly during validation. Print Document opens an isolated document and waits for logo decoding, so the app shell, modal controls and other open dialogs never enter the printout.

Header options apply identically to preview, print, and Download PDF:

- Default: company name and logo.
- **No Logo (Generic)**: preserve the company name and omit the logo, matching the prototype.
- **No company details and logo**: omit both the company name and logo, including footer branding, while retaining header space.

Each preview session resets its options. Both print and PDF retain 15 mm vertical / 20 mm horizontal A4 margins and blank browser page corners. Narrow screens keep controls visible and scroll the A4 sheet within its own container.

Administrators can use Edit Voucher in detail view, or Edit inline in detail/preview. Both share one form and save through the existing version-checked update and cache/tab-sync flow. Category, description, amount, fund source, due date and notes are actual voucher fields. Printed requester/reference/submission/work-request fields, payment details, and prepared/approved/released names are editable snapshots. These snapshots never change requester or workflow audit identities. The existing Edit Payment Details action remains the way to change recorded payment data. Conflicts preserve the form and require explicitly loading the latest values.

Backend migration `000068_disbursement_print_details.js` must be applied before using saved printed-field edits. It adds a JSON object column with an empty default. No remote migration was run during development.

Validation (2026-10-19):

- Frontend billing + disbursement suites: 448 tests passed.
- Backend voucher print/edit, approval, API, concurrency, reports, and billing print suites: 89 tests passed.
- Production build, scoped ESLint, and whitespace checks passed.
- Chromium: before/after comparison; ATA/LTA branded, generic and company-free PDF generation; exact frontend/backend body comparison; inline edit persistence; desktop, tablet and phone screenshots; blank PDF corners and A4 sizing confirmed.
- Design inspector: no findings at 1440, 768 and 390 px, with existing dialog shadow and printed-document border/layout allowances.
- Temporary PostgreSQL runtime: migration up/down, existing-row defaults, JSON-object constraint, atomic update/version guard and unchanged audit identities verified.

Two failing regression fixtures were confirmed against the unchanged frontend baseline, then corrected: an obsolete email-only invoice admin expectation, and current-time-dependent approval queue ordering. No billing or queue product code was changed for those fixtures.
