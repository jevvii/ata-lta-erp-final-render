# Brutalist × Minimalist Merged UI Redesign — Implementation Summary

This document details the end-to-end frontend implementation of the **Brutalist × Minimalist Merged UI** ("Structured Institutional Ledger") across the ATA & LTA Enterprise ERP. The implementation synthesizes the unwavering cross-module layout consistency of the Swiss Industrial Brutalist architecture with the tactile softness, concentric border radii, and logo-aligned corporate finance color system guided by the `better-ui` and `better-colors` skills.

---

## 1. Architectural Philosophy & Design System Synthesis

The design synthesis unites two contrasting design philosophies into an authoritative, ergonomic financial operating system tailored for middle-aged accounting partners, CPAs, and bookkeepers:

```
┌─────────────────────────────────────────────────────────────┐
│               STRUCTURED INSTITUTIONAL LEDGER               │
├──────────────────────────────┬──────────────────────────────┤
│  SWISS INDUSTRIAL BRUTALIST  │     MINIMALIST SOFTNESS      │
│     (Preserved Strength)     │     (Integrated Polish)      │
├──────────────────────────────┼──────────────────────────────┤
│ • Uniform outer shell gutter │ • Concentric border radii    │
│ • Unified module header grid │   (4px / 6px / 8px / 12px)   │
│ • Standardized inner tabs    │ • Layered transparent shadows│
│ • Structured report bands    │ • Corporate Finance Blue     │
│ • Strict >=12px text floor   │   accent (#1D4ED8)           │
│ • Tabular numbers everywhere │ • 4.76:1 form control borders│
│ • 100% print template parity │ • Humanist sans typography   │
└──────────────────────────────┴──────────────────────────────┘
```

### Core Design Rules
1. **Logo-Aligned Corporate Finance Blue System (`better-colors`)**:
   - Replaced brutalist Hazard Red (`#E61919`) on focus rings, active tabs, and navigation indicators with **Corporate Finance Blue** (`#1D4ED8` solid, `#EFF6FF` subtle surface, `#1E40AF` text).
   - Reserved red strictly for destructive actions, overdue invoices (61d+), and error states, ensuring unmistakable `>=122°` OKLCH hue separation from primary interactions (*"One color, one meaning"*).
   - Entity badges aligned with official company identity: **ATA** Deep Institutional Navy (`#1E3A8A` text / `#EFF6FF` surface / `#93C5FD` border) and **LTA** Corporate Cerulean (`#075985` text / `#F0F9FF` surface / `#7DD3FC` border).
2. **Concentric Surface Geometry (`better-ui`)**:
   - Replaced brutalist `0px` harsh square corners with concentric radii:
     - `--radius-xs: 4px`: Inline badges, chips, keyboard shortcuts.
     - `--radius-sm: 6px`: Buttons, inputs, selects, date pickers, inner tab triggers.
     - `--radius-md: 8px`: Cards, ledger table frames, segmented tab tracks (`p-1` outer track with `6px` inner triggers gives concentric `outer = inner + padding`).
     - `--radius-lg: 12px`: Modals, dialogs, drawers, dropdown popovers.
     - `--radius-pill: 999px`: Avatars and circular notification counters.
3. **Restrained Depth & High-Salience Framing (`better-ui` & `better-colors`)**:
   - Replaced `4px 4px 0px #0A0A0A` hard offset drop shadows with soft ambient elevation (`--shadow-card`, `--shadow-float`) layered over structural `1px solid #CBD5E1` borders to ensure high contrast in standard view and edge rendering in forced-colors mode.
   - Form inputs use `--color-control-border: #64748B` (**4.76:1** contrast on white), well above the WCAG 2.1 AA 3:1 non-text contrast threshold for middle-aged bookkeepers.
4. **Ergonomic Typography & Micro-Interactions**:
   - Eliminated aggressive all-caps monospace shouting from navigation, form labels, and sign-in cards in favor of sentence-case Inter (`font-sans`), reserving JetBrains Mono (`font-mono`) strictly for financial figures, codes, and IDs.
   - Micro-interactions respect `better-ui`: buttons scale to `0.96` on press (`motion-safe:enabled:active:scale-[0.96]`) with `static` opt-out support; transitions specify exact properties (no `transition-all`); modals feature `overscroll-contain`.

---

## 2. Phase-by-Phase Execution Summary

### Phase 1: Token Engine, Shared Primitives, App Shell & Sign-In Synthesis
- **Tokens & Global Styles**:
  - `frontend/src/index.css`: Defined Tier 1 primitives (`--slate-50` through `--slate-950`, `--blue-50` through `--blue-950`, `--sky-50` through `--sky-900`) and mapped them to Tier 2 semantic tokens (`--color-bg-app`, `--color-surface`, `--color-ink`, `--color-primary`, `--color-control-border`, status ramp tokens).
  - `frontend/src/styles/tokens.ts`: Exported strongly typed JS tokens mirroring CSS variables.
- **Shared Primitives (`frontend/src/components/ui/`)**:
  - `button.tsx`: Concentric `6px` radius, `0.96` press-scale, semantic primary/secondary/outline/destructive variants, explicit `transition-[background-color,border-color,color,box-shadow,transform]`.
  - `input.tsx`, `select.tsx`, `date-input.tsx`: Form control borders at `4.76:1` (`#64748B`), 6px radius, `focus:ring-2 focus:ring-[#1D4ED8] focus:ring-offset-2`.
  - `card.tsx`: `8px` radius, `1px solid #CBD5E1` structural frame, `--shadow-card`.
  - `badge.tsx`: 4px/6px radius, status color ramps with `>=6.6:1` contrast, official ATA (`#1E3A8A`) and LTA (`#075985`) entity styles.
  - `table.tsx`: `13px` dense data cells, `12px` headers, `1px` border dividers, `tabular-nums`.
  - `dialog.tsx`: `12px` radius, `--shadow-float`, `overscroll-contain`, clean translucent backdrop.
  - `tabs.tsx`: Standardized segmented tab strip architecture (`8px` track, `6px` triggers, finance blue active pill).
  - `dropdown-menu.tsx`, `toast.tsx`, `skeleton.tsx`: Softened radii and calm elevation.
- **Application Shell**:
  - `Shell.tsx`: Single outer gutter (`px-4 py-4 sm:px-6 sm:py-5 lg:px-8 lg:py-6`) maintaining edge alignment across all routes.
  - `Sidebar.tsx`: Swiss hierarchy with humanist sentence-case typography, logo-aligned brand badges, `6px` soft blue active navigation pill.
  - `Topbar.tsx`: 44px mobile touch targets, scope switcher, notification bell drawer.
  - Common Modals: `ConflictResolutionModal.tsx`, `PresenceAvatars.tsx`, `Forbidden.tsx`, `NotFound.tsx`, `ErrorBoundary.tsx`.
- **Sign-In Flow**:
  - `routes/login.tsx`: Professional institutional authentication card on `#F8FAFC` substrate, clean human-readable copy, accessible password toggle.

### Phase 2: Reports, Accounts Receivable Aging & Telemetry Ledgers
- **Reports Dashboard**:
  - `routes/reports.tsx`: Unified header block, standardized segmented tab strip, and persistent scope prompt.
- **Operational & Analytical Ledgers**:
  - `AnalyticsOverviewTab.tsx`: P&L summary band, 6-column record totals, status breakdown progress meters using semantic color tokens.
  - `DailyActivityTab.tsx`, `WeeklySummaryTab.tsx`, `MonthlyPendingTab.tsx`: High-density tabular reporting.
- **Accounts Receivable Aging Ledgers**:
  - `features/reports/components/AgingReportTab.tsx` and `features/billing/components/AgingReportTab.tsx`: Standardized 6-bucket interactive AR aging matrix (`[All]`, `[Current]`, `[1-30]`, `[31-60]`, `[61-90]`, `[90+]`), formula-injection shielded CSV export, and aggregate financial KPI bands.

### Phase 3: Module Headers, Inner Tabs, Tables, Kanban, Drawers & Modals
Standardized across all modules:
1. **Dashboard** (`routes/dashboard.tsx`): KPI metrics grid, `LogTimeWidget.tsx`, `PendingTasksCard.tsx`, time entry modals.
2. **Clients** (`routes/clients.tsx`): Client list, `ClientFilterBar.tsx`, `ClientTable.tsx`, `ClientModal.tsx`, `ClientDetailModal.tsx`.
3. **Operations** (`routes/operations.tsx`): `WorkRequestList.tsx`, `WorkRequestModal.tsx`, `WorkRequestSidePeek.tsx`, multi-lane `PhaseKanbanBoard.tsx`, `TaskDetailModal.tsx`, `TaskLineItems.tsx`, `PendingApprovalsInbox.tsx`, retainer generation and governance modals (`RetainerGenerateModal.tsx`, `BlockingActionModal.tsx`, `RerouteModal.tsx`, `RejectReasonModal.tsx`, `ArchiveConfirmModal.tsx`).
4. **Billing** (`routes/billing.tsx`): `InvoiceList.tsx`, `InvoiceCreateModal.tsx`, `InvoiceDetailModal.tsx`, `InvoiceEditModal.tsx`, `RecordPaymentModal.tsx`, `InvoiceArchiveTab.tsx`, `ViewModeToggle.tsx`.
5. **Disbursements** (`routes/disbursements.tsx`): `DisbursementsTable.tsx`, `CreateDisbursementModal.tsx`, `DisbursementDetailDrawer.tsx`, `AdminApprovalQueue.tsx`, `AdminApprovalModal.tsx`, `FundsReleaseActions.tsx`, `DisbursementArchiveTab.tsx`.
6. **Transmittals** (`routes/transmittals.tsx`): `TransmittalTable.tsx`, `TransmittalKanbanBoard.tsx`, `TransmittalCard.tsx`, `TransmittalFormModal.tsx`, `TransmittalDetailModal.tsx`, `TransmittalActionDialogs.tsx`.
7. **Documents** (`routes/documents.tsx`): `DocumentTable.tsx`, `DocumentFilterBar.tsx`, `DocumentUploadModal.tsx`, `DocumentViewerModal.tsx`, `DocumentLifecycleModal.tsx`.
8. **Admin & Profile** (`routes/admin.tsx`, `routes/profile.tsx`): `AdminTabs.tsx`, `UserListTable.tsx`, `UserCreateModal.tsx`, `UserDetailModal.tsx`, `UserEditModal.tsx`, `UserDisableModal.tsx`, `PermissionsMatrixView.tsx`, `RetainerTemplateList.tsx`, `RetainerTemplateModal.tsx`, `RetainerGenerationLogs.tsx`, `GuardedPasswordInput.tsx`, profile settings cards.

### Phase 4: Token Audit, Gate Verification & Test Suite Harmonization
- **Residual Hex & Typography Audit**: Verified zero brutalist hex values (`#0A0A0A`, `#FAF9F5`, `#F4F4F0`, `#EAE8E3`, `#E4E2DC`, `#DDDAD2`, `#C8C5BC`, `#4A4945`, `#5C5B57`, `#E61919`, `#3A3935`), zero prototype hex values (`#9494a0`, `#f4f6fb`, `#eef1ff`, `#f0f0f5`, `#f0f1f3`), and zero sub-12px classes in production code. Corrected single straggler in `InvoiceEditModal.tsx` line 607 to `text-xs`.
- **Quality Gates**:
  - `tsc -b`: 0 errors.
  - `vite build`: Clean production build (built in ~6.5s).
  - `eslint`: 111 errors / 8 warnings (within baseline limit).
  - `vitest`: 100% test files passing (146 of 146 test suites, 2,156 tests). Updated legacy Tailwind color assertions in `disbursementsUI.test.tsx` to match the semantic token classes.

---

## 3. Protected Print Document Parity

In strict compliance with statutory and tax-audit requirements, printed document templates maintain 100% pixel fidelity to official physical paper sheets:
- `frontend/src/lib/printDocuments.ts`
- `frontend/src/lib/disbursementDocument.ts`
- `frontend/src/features/billing/components/PrintPreviewModal.tsx`
- `frontend/src/features/disbursements/components/DisbursementPrintModal.tsx`
- `frontend/src/features/transmittals/components/TransmittalPrintModal.tsx`

The outer onscreen dialog containers, headers, and dismiss buttons adopt the merged design system tokens, while the embedded document sheets, print stylesheets (`@media print`), exact millimeter margins, BIR tax lines, and signatures remain identical to physical paper specifications.
