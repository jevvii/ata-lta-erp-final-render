# RESUME-DOCUMENT-LOCKS.md: Task Review Document Locks Implementation & Verification

## 1. Executive Summary & Approved Policy Enforcement
This lane completes the security review and implementation for task-linked document locks on branch `fix/task-review-document-locks-staging`.

### Approved User Policy Contract:
1. **Rejected Task Locks All Ordinary Work**: A rejected task retains its history, documents, and download capabilities for audit and review, but **ALL ordinary mutations lock unconditionally with `409 Conflict (code: TASK_REJECTED_LOCKED)`**:
   - New document uploads / attachments (`createDocument`)
   - Confirming storage upload (`confirmUpload`)
   - Document metadata modifications (`updateDocument`)
   - Relinking away from a rejected task or to another rejected task (`updateDocument`)
   - Soft deletion (`deleteDocument`)
   - Archive and unarchive operations (`archiveDocument`, `unarchiveDocument`)
   - Lifecycle state transitions (`updateLifecycle`)
   - Comment operations: adding, editing, or deleting comments (`mutateDocumentComment` / `addDocumentComment`, `updateDocumentComment`, `deleteDocumentComment`)
   - Document comment capability indicator: `canCommentOnDocument` reports `can_comment: false` when linked task is rejected.
2. **Pending Task Remains Usable**: Pending tasks remain fully usable within standard RBAC and task assignment permissions (assigned staff and admins can create documents, confirm uploads, add comments, and modify metadata).
3. **Pending/Rejected Work Request Admission Gate**: Documents whose parent work request has not been admitted (`creation_approval_status !== 'approved'`) are inaccessible via DMS (`GET /v1/documents/:id` and download URLs return `404 Not Found`; `listDocuments` and `countDocuments` filter them out).
4. **Leakage Prevention**: Cross-WR and cross-entity linkage attempts fail closed (`400 Validation Error`).

---

## 2. Concrete Mutation Paths & Shared Guard Architecture

### Implementation:
- Located in `backend/src/modules/documents/service.js`, `controller.js`, and `backend/src/lib/projectLinkage.js`.
- In `backend/src/lib/projectLinkage.js`:
  - `validateRecordProjectLinkage` enforces that parent work requests have `creation_approval_status === 'approved'` (unless `internal: true`), aligning single-record project visibility with `filterValidProjectRecords` so unadmitted (pending/rejected) WR documents return 404 in DMS even for Admin.
- Shared guard: `assertTaskDocumentMutationAllowed({ taskId, entityId, user, workRequestId, action, requireAssignment })`:
  - Fetches task `approval_status`, `work_request_id`, `assignee_id`, `deleted_at`.
  - Rejects rejected task with `409 TASK_REJECTED_LOCKED` (`detail: 'Task is rejected and locked against document attachments'` for attachment action; `'Task is rejected and locked against document modifications'` for other mutations).
  - Validates parent work request existence, entity alignment (`wr.entity_id === entityId`), and WR admission (`wr.creation_approval_status === 'approved'`).
  - Validates user assignment via `isUserAssignedToTask` or `task_assignees` table when `requireAssignment` is enabled for non-admin callers.
- All mutation functions guard their target/existing task before applying database updates:
  - `createDocument`: guards `data.linkedTaskId` before inserting metadata.
  - `confirmUpload`: checks existing `doc.linked_task_id` before transitioning status to `active`.
  - `updateDocument`: guards existing `doc.linked_task_id` against modifications/relinking; validates target `data.linkedTaskId` on relinking.
  - `deleteDocument`: guards existing `doc.linked_task_id` against deletion.
  - `archiveDocument` & `unarchiveDocument`: guards existing `doc.linked_task_id`.
  - `updateLifecycle`: guards existing `doc.linked_task_id`.
  - `mutateDocumentComment`: guards existing `document.linked_task_id` before invoking database RPC.
  - `canCommentOnDocument`: checks if linked task is rejected; returns `false` if rejected.
  - `getDocumentById`: preserves read access and history for rejected tasks; enforces WR admission gate for DMS.

---

## 3. Test Evidence

### Executed Test Suites:
All 4 document test suites run in-band under `PORT=0`:

1. `backend/tests/integration/documentTaskLocks.test.js` (Dedicated 18 integration tests):
   - `rejects POST /v1/documents (attachment on rejected task) with 409 TASK_REJECTED_LOCKED` (PASS)
   - `rejects POST /v1/documents/:id/confirm-upload on document linked to rejected task with 409 TASK_REJECTED_LOCKED` (PASS)
   - `rejects PUT /v1/documents/:id metadata edit on document linked to rejected task with 409 TASK_REJECTED_LOCKED` (PASS)
   - `rejects relinking document away from rejected task or to another rejected task with 409 TASK_REJECTED_LOCKED` (PASS)
   - `rejects DELETE /v1/documents/:id on document linked to rejected task with 409 TASK_REJECTED_LOCKED` (PASS)
   - `rejects POST /v1/documents/:id/archive on document linked to rejected task with 409 TASK_REJECTED_LOCKED` (PASS)
   - `rejects POST /v1/documents/:id/unarchive on document linked to rejected task with 409 TASK_REJECTED_LOCKED` (PASS)
   - `rejects PUT /v1/documents/:id/lifecycle on document linked to rejected task with 409 TASK_REJECTED_LOCKED` (PASS)
   - `rejects comment mutations (add, edit, delete) on document linked to rejected task with 409 TASK_REJECTED_LOCKED` (PASS)
   - `allows GET /v1/documents/:id, shows history, and reports can_comment: false` (PASS)
   - `allows GET /v1/documents/:id/download-url for active documents on rejected tasks` (PASS)
   - `lists documents by linkedTaskId for rejected tasks` (PASS)
   - `allows assigned user to create document, confirm upload, edit, comment, and delete on pending task` (PASS)
   - `rejects document creation when linked task does not belong to specified work request (400)` (PASS)
   - `rejects document creation when linked task belongs to a different entity (400)` (PASS)
   - `rejects relinking document to a task in a different entity (400)` (PASS)
   - `denies DMS access to documents whose parent work request is pending or rejected (404 / filtered)` (PASS)
   - `rejects unassigned non-admin user with 403 FORBIDDEN_TASK_ATTACHMENT` (PASS)

2. `backend/tests/unit/modules/documents/service.test.js` (19 unit tests):
   - Path generation, sanitization, and `assertTaskDocumentMutationAllowed` branch coverage (PASS)

3. `backend/tests/integration/documents.test.js` (18 integration tests): (PASS)

4. `backend/tests/integration/documentComments.test.js` (8 integration tests): (PASS)

**Summary: 4 test suites passed, 63 tests total passed, 0 failures, 0 lint warnings.**

---

## 4. SQL Atomic Guard Recommendation for Root

Per policy constraint: *Do not alter operation service/controller/mock or SQL migrations owned by other active lanes. If safe SQL atomic guard needed beyond existing checks, report exact requirement to root, do not invent new migration number. Root will compose locally.*

### Recommended Atomic Guard Specification for Root:
To provide defense-in-depth at the database layer (preventing bypasses via direct SQL or concurrent race conditions):
1. **Trigger on `documents` (BEFORE INSERT OR UPDATE OR DELETE)**:
   ```sql
   CREATE OR REPLACE FUNCTION public.check_task_document_mutation_lock()
   RETURNS TRIGGER AS $$
   DECLARE
     v_task_id UUID;
     v_task_status TEXT;
   BEGIN
     -- Determine target task ID from OLD or NEW
     v_task_id := COALESCE(NEW.linked_task_id, OLD.linked_task_id);
     
     IF v_task_id IS NOT NULL THEN
       SELECT approval_status INTO v_task_status
       FROM public.tasks
       WHERE id = v_task_id;
       
       IF v_task_status = 'rejected' THEN
         RAISE EXCEPTION 'TASK_REJECTED_LOCKED: Task is rejected and locked against document modifications'
           USING ERRCODE = 'P0001';
       END IF;
     END IF;
     
     -- Also verify if moving from a rejected task during relink
     IF TG_OP = 'UPDATE' AND OLD.linked_task_id IS NOT NULL AND OLD.linked_task_id <> NEW.linked_task_id THEN
       SELECT approval_status INTO v_task_status
       FROM public.tasks
       WHERE id = OLD.linked_task_id;
       
       IF v_task_status = 'rejected' THEN
         RAISE EXCEPTION 'TASK_REJECTED_LOCKED: Cannot relink documents from a rejected task'
           USING ERRCODE = 'P0001';
       END IF;
     END IF;
     
     RETURN COALESCE(NEW, OLD);
   END;
   $$ LANGUAGE plpgsql;

   CREATE TRIGGER trg_check_task_document_mutation_lock
   BEFORE INSERT OR UPDATE OR DELETE ON public.documents
   FOR EACH ROW
   EXECUTE FUNCTION public.check_task_document_mutation_lock();
   ```

2. **RPC `mutate_document_comment` Check**:
   Within the `mutate_document_comment` stored procedure, add an upfront check:
   ```sql
   IF v_doc.linked_task_id IS NOT NULL THEN
     SELECT approval_status INTO v_task_status FROM public.tasks WHERE id = v_doc.linked_task_id;
     IF v_task_status = 'rejected' THEN
       RAISE EXCEPTION 'TASK_REJECTED_LOCKED: Task is rejected and locked against document comments'
         USING ERRCODE = '42501';
     END IF;
   END IF;
   ```
Root can compose these trigger/RPC guards into the appropriate central migration sequence without conflicting with active migration numbering.
