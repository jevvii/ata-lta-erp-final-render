# Backend OCC & Cache Correctness Handoff

**Branch**: `fix/approval-occ-cache-staging`  
**Base Commit**: `1ba1b8061807f34d566607368d9164b71d65e4ae` (reviewed HEAD)  
**Dedicated Commit**: `7199b356b0641988621d074e07a8fabf40d23b3b`  
**Date**: 2026-10-26 (Asia/Manila)  
**Scope**: BACKEND ONLY  

---

## 1. Executive Summary

This parcel resolves concurrency and cache correctness gaps identified in multi-user review and approval workflows:
1. **Ordinary Task CAS & Intervening Rejection Protection**: `updateTask` ordinary update path now enforces compare-and-swap against `existing.version` even when legacy `expectedVersion` is omitted. If the row was concurrently rejected by the Manager lead, it strictly rejects with `409 TASK_REJECTED_LOCKED` rather than silently overwriting the rejection.
2. **Elimination of Fallback Rebases on Material Updates**: Material employee revisions now enforce strict OCC version matching. Supplied stale versions are never silently rebased to `existing.version || 1`; they reject immediately with `409 TASK_REVIEW_CONFLICT`.
3. **WR Admission & Resubmit Service Boundary Gating**: `decideWorkRequestCreationApproval` and `resubmitWorkRequestCreation` enforce mandatory positive integer `expectedVersion`, stale mutation checks (409 `CONCURRENT_MODIFICATION`), and atomic compare-and-swap SQL updates (`WHERE id = :id AND version = :expectedVersion AND creation_approval_status = :status AND deleted_at IS NULL`). Competing review decisions and resubmissions fail closed with zero partial writes.
4. **Task Review RPC Boundary Hardening**: `decideTaskCreationApproval` and `resubmitTaskCreation` strictly validate `expectedVersion` and pass it directly to `task_creation_review_decide` and `task_creation_review_resubmit` RPCs without fallback rebase expressions (`p_expected_version: Number(expectedVersion)`).
5. **Fresh Actor Authorization & Cache Safety**: Approval operations re-verify actor active status and roles directly against PostgreSQL `users` to prevent cached in-memory profiles (`profileCache`) from granting stale authority. Authenticated responses enforce `no-store, no-cache, must-revalidate, proxy-revalidate`, `Surrogate-Control: no-store`, and `Vary: X-Active-Entity, Authorization`.

---

## 2. Detailed Technical Fixes

### A. Task Update CAS and Overwrite Prevention (`backend/src/modules/operations/service.js`)
* **Declared vs Stale Version Resolution**: Explicitly resolves `declaredExpectedVersion` and checks whether an invalid or stale version was supplied in the request body. If declared version does not match `existing.version`, throws `409 ERR_CONCURRENCY_CONFLICT` before touching child relations.
* **Ordinary Branch Compare-and-Swap**: When updating routine task fields (status, checklist completions, display order), the database update unconditionally binds `.eq('version', casVersion)` where `casVersion = declaredExpectedVersion ?? (existing.version || 1)`.
* **Intervening Rejection Guard**: Appends `.neq('approval_status', 'rejected')` to the update query. If 0 rows match because an assigned lead concurrently rejected the task, inspects the current database state and throws `409 TASK_REJECTED_LOCKED`.
* **Zero-Row Mutation Abortion**: If 0 rows are updated, the service throws immediately and skips downstream checklist upserts and `task_assignees` mutations, eliminating partial state corruption.
* **Material Reset Branch**: Never silently rebases; if an employee submits a material change with a stale version, it raises `409 TASK_REVIEW_CONFLICT` instead of falling back to `existing.version || 1`.

### B. WR Admission Review & Resubmission (`backend/src/modules/operations/service.js`)
* **Mandatory Version Boundary**: Both `decideWorkRequestCreationApproval` and `resubmitWorkRequestCreation` reject missing, null, or non-positive `expectedVersion` with `409 CONCURRENT_MODIFICATION`.
* **Atomic Conditional SQL Update**:
  - `decideWorkRequestCreationApproval`: `.eq('id', id).eq('version', Number(expectedVersion)).eq('creation_approval_status', 'pending').is('deleted_at', null)`
  - `resubmitWorkRequestCreation`: `.eq('id', id).eq('version', Number(expectedVersion)).eq('creation_approval_status', 'rejected').is('deleted_at', null)`
* **Competing Decisions / Resubmission**: Competing transactions fail closed; audit logs and creator notifications are only emitted after row update confirms exactly 1 modified row.
* **Authorization Freshness**: Re-queries `users` table directly for active account status (`is_active === true`) and uses verified actor data for entity entitlement and creator linkage.

### C. Task Decisions & Resubmission Service Layer (`backend/src/modules/operations/service.js`)
* Removed fallback rebase `p_expected_version: expectedVersion || currentVersion` in `decideTaskCreationApproval` and `resubmitTaskCreation`.
* Passes strictly verified `Number(expectedVersion)` to SQL RPCs (`task_creation_review_decide` / `task_creation_review_resubmit`).
* Verified actor active status before executing resubmission to avoid stale in-memory role/active token states.

### D. Reverse Proxy and Browser Cache Defense (`backend/src/app.js` & `controller.js`)
* Added `Surrogate-Control: no-store` to the `/v1/` middleware alongside existing `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`, `Pragma: no-cache`, `Expires: 0`, and `Vary: X-Active-Entity, Authorization`.
* Controllers utilize `injectExpectedVersion(req, req.body)` to support both body `expectedVersion` and standard `If-Match` headers.

---

## 3. Verification Evidence

HTTP/service suites use the project test fixtures. Only the explicitly named PostgreSQL acceptance and service bridge suites execute against the isolated loopback database at `127.0.0.1:55493`. No remote migration or business data mutation was performed in this follow-up:

| Test Suite | Location | Result | Details |
| --- | --- | --- | --- |
| **WR Creation Gate & Competing OCC** | `src/modules/operations/__tests__/wrCreationApprovalGate.test.js` | **24 / 24 passing** | Verified competing decisions (200 vs 409) and competing resubmissions (200 vs 409). |
| **Task Creation Review & CAS Guards** | `src/modules/operations/__tests__/taskCreationReview.test.js` | **35 / 35 passing** | Verified ordinary CAS version compare, intervening rejection 409 lock, and competing decisions. |
| **Real PG Application Service Bridge** | `tests/integration/taskAppBridgeAcceptance.js` | **6 / 6 passing** | Real PG transactional RPC integration verifying employee creation, lead decision, material reset, and stale OCC rejection. |
| **Real PG Review Database Acceptance** | `tests/integration/acceptance.js` | **87 / 87 passing** | Full database parcel acceptance: 8-way decide race, 4-way resubmit race, trigger append-only history enforcement. |
| **Real PG Read Scope Acceptance** | `tests/integration/operations_approval_read_scope_database.acceptance.js` | **34 / 34 passing** | Database RLS read isolation across entities, pending/rejected isolation, anonymous rejection. |
| **OCC & Concurrency Races Integration** | `tests/integration/occ.test.js` & `concurrency-races.test.js` | **12 / 12 passing** | Verified general HTTP If-Match / expectedVersion OCC contracts. |
| **Code Quality & Linting** | `npx eslint src` | **0 errors, 0 warnings** | All modified application source files and test files are completely clean. |

---

## 4. Risks & Operational Boundaries

1. **Database Schema & Migrations**:
   - No new migration (000077) was required; existing applied migrations 000073–000076 already provide the necessary row locks, constraints, and RPC signatures.
   - Applied staging migrations (73–76) were untouched.
2. **Authority & Role Policy**:
   - Preserves strict Policy R5: assigned Manager lead exclusively decides task reviews; Admin override remains strictly denied.
   - Ordinary task updates on rejected tasks remain strictly denied; creator resubmission is required.
3. **No Target Merge / Deploy**:
   - Changes are committed exclusively to dedicated branch `fix/approval-occ-cache-staging`.
   - No remote branch was pushed or merged. Backend code is ready for staging composition when authorized.

## Root follow-up verification

After agy quota exhaustion, Codex completed review directly. Commit7bb4190 also guards ordinary WR writes with the version read when a legacy client omits expectedVersion, and requires an explicit version for approved employee material edits. Final focused backend checks:218/218 across14suites; selected changed source/test lint clean. The real application-service/PostgreSQL bridge was rerun after this patch:6/6. The unchanged87SQL and34RLS acceptance results above remain earlier evidence, not part of the218fixture-based test count. Frontend supplies captured versions for material task edits. No additional migration was required.
