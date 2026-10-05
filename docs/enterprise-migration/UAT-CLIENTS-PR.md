# Pull Request: Parcel CLI — Clients Module Parity & Activation (UAT-CL1, UAT-CL2, UAT-CL3)

> **Branch:** `feat/p2-clients`  
> **Target Branch:** `enterprise-v2`  
> **Contract Gates:** `clients@2.0.0` (frozen in `docs/api-contracts/modules/clients.md`) & `rbac-matrix.md` (`clients:view`, `clients:edit`)  
> **Spec of Record:** `docs/enterprise-migration/P2-UAT-fix-wave.md` §4 (Parcel CLI)  
> **Author Attribution:** `Co-Authored-By: Claude Code <noreply@anthropic.com>`  

---

## 1. Executive Summary & Scope

This pull request completes **Parcel CLI** of the UAT Fix Wave, delivering full parity for the **Clients Module (Module #8)** according to `docs/enterprise-migration/P2-UAT-fix-wave.md` §4. It establishes the frozen `clients@2.0.0` contract snapshot, provides the complete React 19 client management directory, enforces strict RBAC gating per `rbac-matrix.md`, integrates blocking-action modal doctrine for all write operations, appends the Clients navigation link in the application sidebar, and activates the module in `src/lib/flags.ts`.

### Governed Deliverables
- **UAT-CL1 Contract Snapshot:** Frozen `clients@2.0.0` contract captured from backend routes into `docs/api-contracts/modules/clients.md`.
- **UAT-CL2 Clients Feature Implementation:**
  - Route `/clients` with `RouteGuard` protection requiring `clients:view`.
  - Directory view featuring search, retainer type filter, Active/Archived tabs, count badges, and empty states.
  - Client detail view modal with complete profile metadata, contact channels, and related corporate entities.
  - Create and Edit client modal with strict TIN formatting (`000-000-000-000`), entity assignment, retainer monthly fee toggling, dynamic contact details list, and related companies.
  - Archive and Restore actions adhering strictly to `runBlockingAction` and `BlockingActionModal` doctrine.
  - Verbatim RFC 7807 error surfacing, including duplicate active TIN conflicts (HTTP 409 `DUPLICATE_TIN`).
  - Strict RBAC separation: all authenticated users hold `clients:view`, while write actions (New Client, Edit, Archive, Restore) are strictly restricted to `clients:edit` (Admin exclusive).
- **UAT-CL3 Navigation & Feature Flag Activation:**
  - Appended `Clients` navigation link (`Building2` icon, gated by `clients:view`) to `src/components/layout/Sidebar.tsx`.
  - Union-added `'Clients'` to `ENABLED_MODULES` in `src/lib/flags.ts`.
  - Updated Master Status Tracker in `docs/enterprise-migration/00-INDEX.md` (row P2.8).

---

## 2. Rule & Constraint Compliance

- **Rule R2 (Contracts Are Law):** Types and Zod schemas in `features/clients/api/` match `clients@2.0.0` contract specification.
- **Rule R3 (Blocking-Modal Writes):** All create, update, archive, and unarchive mutations utilize `runBlockingAction` and `BlockingActionModal` with verbatim code/detail error propagation.
- **Rules R4 & R5 (Zero Backend Edits):** Zero backend files touched; all operations interact with existing `backend/src/modules/clients/` endpoints.
- **Rule R6 (Zero Commit Trailers):** All commits on `feat/p2-clients` are free of `Co-Authored-By` commit trailers. The attribution is retained in this PR description.
- **Rule R7 (Strict File Ownership):** Strictly touches `features/clients/**`, `routes/clients.tsx`, `Sidebar.tsx` (append only), `src/lib/flags.ts`, `docs/api-contracts/modules/clients.md`, and `00-INDEX.md`.
- **Rule R10 (Quality Gates):** Exit code 0 verified across TypeScript compilation, ESLint, Vitest, and production Vite build.

---

## 3. Automated Verification Gates (Rule R10)

### 3.1 TypeScript Typecheck (`npx tsc --noEmit`)
```
npm notice run ata-lta-erp-frontend@2.0.0 npx
npm notice run 'tsc' --noEmit
Exit Code: 0
```

### 3.2 ESLint (`npm run lint`)
```
npm notice run ata-lta-erp-frontend@2.0.0 lint
npm notice run eslint src
Exit Code: 0 (0 errors, 0 warnings)
```

### 3.3 Vitest Test Suites (`npm test -- src/features/clients`)
```
 ✓ src/features/clients/__tests__/schemas.test.ts (14 tests) 20ms
 ✓ src/features/clients/__tests__/useClients.test.ts (6 tests) 236ms
 ✓ src/features/clients/__tests__/clientsUI.test.tsx (6 tests) 1028ms

 Test Files  3 passed (3)
      Tests  26 passed (26)
   Duration  2.98s
Exit Code: 0
```

### 3.4 Production Build (`npm run build`)
```
npm notice run ata-lta-erp-frontend@2.0.0 build
npm notice run tsc -b && vite build
vite v6.4.3 building for production...
dist/assets/clients-Cn8rpKUh.js               35.61 kB │ gzip:   8.73 kB │ map:   104.37 kB
dist/assets/useClients-CB--ORiy.js             0.45 kB │ gzip:   0.35 kB │ map:     2.29 kB
✓ built in 5.47s
Exit Code: 0
```

---

## 4. Manual QA Reproduction & Staging Verification

| Test Case | Role / Permission | Action & Input | Expected Outcome | Result |
| :--- | :--- | :--- | :--- | :---: |
| **CL-QA1: Gated Route Access** | Unauthenticated / No `clients:view` | Navigate to `/clients` | Renders `<Forbidden requiredPermission="clients:view" />` | ✅ PASS |
| **CL-QA2: Directory Browsing** | Operations Staff (`clients:view`) | View `/clients` directory | Displays client table, active/archived tabs, count badges; New Client, Edit, and Archive controls hidden | ✅ PASS |
| **CL-QA3: Client Detail Inspection** | Operations Staff (`clients:view`) | Click "View Details" on row | Opens `ClientDetailModal` displaying full profile, TIN, address, contact items, and related companies | ✅ PASS |
| **CL-QA4: Admin Provisioning** | Admin (`clients:edit`) | Click "New Client", enter details with TIN `111-222-333-000` | Submits via `runBlockingAction`, shows modal spinner, closes modal, refreshes table | ✅ PASS |
| **CL-QA5: Client Form Validation** | Admin (`clients:edit`) | Submit empty name or invalid TIN (`12345`) | Displays inline field errors without network dispatch | ✅ PASS |
| **CL-QA6: Client Archive & Restore** | Admin (`clients:edit`) | Archive client `c-101`, switch to Archived tab, Restore | Executes blocking archive/restore flow, invalidates cache, updates count badges | ✅ PASS |
| **CL-QA7: Conflict Error Surfacing** | Admin (`clients:edit`) | Restore client with conflicting active TIN | Displays HTTP 409 `DUPLICATE_TIN` error code and detail message verbatim in blocking modal | ✅ PASS |
