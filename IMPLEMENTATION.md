# Backend Implementation Plan: Operations WR & Task Approval Revalidation

## Overview
Implement approved WR creation admission gating (Parcel 1) and task creation review (Parcel 2) per CONTRACT.md policy R1–R10.

## Parcel 1: Work Request Creation Gate (`feat/wr-creation-gate-staging`)
- [x] DB Migration `000073_wr_creation_approval_gate.js`:
  - `creation_approval_status` text/varchar(30) default `'approved'` (CHECK: `approved`, `pending`, `rejected`)
  - `created_by` uuid NULL references `users(id)`
  - `reviewed_by` uuid NULL references `users(id)`
  - `reviewed_at` timestamptz NULL
  - `rejection_reason` text NULL
  - Index on `(entity_id, creation_approval_status)`
- [x] Model & Serialization in `service.js` / `schema.js`:
  - Map `creationApprovalStatus`, `createdBy`, `reviewedBy`, `reviewedAt`, `rejectionReason`
  - Compute `canReviewCreation`, `canResubmit`, `hasManagerLead`
  - Strip client-supplied approval fields from create/update payloads
- [x] Creation Gate Logic:
  - Enforce explicit Admin or Manager role at authoritative WR entry points
  - Admin creates `approved` WR (reviewedBy = actor, reviewedAt = now)
  - Manager creates `pending` WR (reviewedBy = null, reviewedAt = null)
  - Stop enqueueing old fake `wr_phase_transition` operations request
  - Ensure creator can view their newly created pending WR on return
- [x] Gated Visibility:
  - Exclude `creation_approval_status != 'approved'` from normal lists, boards, counts, search, dashboard, task operations
  - Restore cross-entity retrieval fallback for entitled users
- [x] HTTP Endpoints:
  - `GET /v1/operations/work-requests/creation-approvals`
  - `POST /v1/operations/work-requests/:id/creation-approval` (Admin only, reason required on rejection)
  - `POST /v1/operations/work-requests/:id/resubmit-creation` (Creator only, rejected only)
- [x] Parcel 1 Tests & Verification:
  - Dedicated test suite `src/modules/operations/__tests__/wrCreationApprovalGate.test.js` (16/16 passing)
  - Verify existing suites (44/44 passing across operations tests; 19/19 passing integration/operations.test.js)
  - Run backend lint (0 errors on `eslint src`)

## Parcel 2: Task Creation Review (`feat/task-creation-review-staging`)
- [x] Branch Creation: Create `feat/task-creation-review-staging` from verified Parcel 1 commit (`076e08ae`)
- [x] DB Migration `000074_task_creation_approval_review.js`:
  - `approval_status` text/varchar(30) default `'approved'` (CHECK: `approved`, `pending`, `rejected`)
  - `created_by` uuid NULL references `users(id)`
  - `reviewed_by` uuid NULL references `users(id)`
  - `reviewed_at` timestamptz NULL
  - `rejection_reason` text NULL
- [x] Model & Serialization:
  - Map `approvalStatus`, `createdBy`, `reviewedBy`, `reviewedAt`, `rejectionReason`, `canReview`, `canResubmit`
- [x] Task Creation Guard:
  - Pre-insert check: verify parent WR exists, admitted (`creationApprovalStatus === 'approved'`), writable
  - Employee check: require WR `assigned_to` is active Manager entitled to entity; reject before insert if missing
  - Employee creates `pending` task; Admin/Manager creates `approved` task
- [x] Strict Lead-Only Review:
  - Only assigned Manager lead approves/rejects; NO Admin override; co-assignees denied
  - `POST /v1/operations/work-requests/:wrId/tasks/:taskId/creation-approval`
  - `POST /v1/operations/work-requests/:wrId/tasks/:taskId/resubmit-creation`
- [x] Mutation Locks & Material Edits:
  - Lock rejected task mutations (status, checklist, time logs, comments, reorder)
  - Employee material edits (title, description, assignees, dependencies, due date) on approved task reset to `pending`
- [x] Phase & Completion Gates:
  - Pending/rejected tasks block phase advancement and WR completion
- [x] Parcel 2 Tests & Verification:
  - Dedicated test suite `src/modules/operations/__tests__/taskCreationReview.test.js` (32/32 passing)
  - Cherry-picked database acceptance suite `backend/tests/integration/acceptance.js` (45/45 passing on real PostgreSQL)
  - Verify all affected suites and lint (82/82 operations unit tests, 27/27 integration tests, 0 ESLint errors)
