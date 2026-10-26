# Handoff Prompt for Claude Opus: Document Upload Confirmation 404 Defect Remediation

```markdown
You are acting as the lead implementation engineer on the ATA & LTA ERP platform. An exhaustive audit and empirical characterization have already been completed for the following defect:
"Document shows as 'not found' (404) during upload, but it still appears in the list and its file gets uploaded after."

Your mission is to review the evidence, implement the line-level backend and frontend fixes, run the test suites, and execute the staging data activation script.

---

### 1. Context & Forensic Staging Evidence

An audit performed on 25 October 2026 investigated live staging records in the Supabase project (`backend/.env.staging`) and discovered two active documents stranded in `status: 'pending_upload'`:
1. **Document `2deabc18-31a7-4419-80c3-e0a854864d7d`** (`a_house_in_the_snow.png`):
   - Created: `2026-10-25 12:05:28 UTC` (20:05 Local)
   - Uploader: `Loida Delgaco` (`loida@ata-lta.ph`), Role: `Operations`, Entities: `['ATA', 'LTA']`
   - Work Request: `ca85bc39-2afb-48b7-b754-44e821d4a105` (Entity: `LTA`)
   - Linked Task: `480ef431-2f33-404c-9c62-192603da267c`
   - Cloud Storage: Verified present in bucket `ata-lta-erp-documents-staging` at `entities/LTA/clients/a7351026-3e02-4b63-a9ec-6a57abb20667/documents/2deabc18-31a7-4419-80c3-e0a854864d7d/client-documents` (uploaded `12:05:29 UTC`).
2. **Document `d18ef320-fb30-48c8-b7bf-5e74fa08270b`** (`a_moon_over_a_mountain.png`):
   - Created: `2026-10-23 22:15:58 UTC`
   - Storage verified present in bucket at `entities/LTA/clients/.../d18ef320-.../a_moon_over_a_mountain.png`.

Audit and specification documents:
- Audit Report: `docs/audits/document-upload-confirmation-2026-10-25/Audit Report.md`
- Remediation Spec: `docs/audits/document-upload-confirmation-2026-10-25/fix/Remediation Specification.md`
- Obsidian Vault: `/home/deutz/Documents/Obsidian Vault/fix/` and `ATA-LTA/Audits/Document Upload Confirmation 404 Defect - 2026-10-25/`

---

### 2. Root Cause Mechanics

The upload follows a 3-step pipeline:
1. `POST /v1/documents` creates metadata with `entity_id = LTA` (from `workRequestId`) and `status = 'pending_upload'`.
2. Client streams binary directly to Supabase Storage via signed URL (succeeds).
3. `POST /v1/documents/:id/confirm-upload` is sent with `X-Active-Entity: ALL` and empty body `{}`:
   - In `backend/src/middleware/resolveEntity.js:85-188`, the middleware inspects route param `:id` across `work_requests`, `operations_requests`, `clients`, `invoices`, `disbursements`, and `transmittals`. **The `documents` table was omitted from this cascade.**
   - Finding no match, `resolveEntity()` falls back to `req.user.entities[0]` (`'ATA'`).
   - `req.activeEntity` is overwritten with ATA UUID (`e83dc90b-...`).
   - `service.confirmUpload` calls `getDocumentById({ entityId: 'ent-ata', id })`, querying `WHERE id = :id AND entity_id = 'ent-ata'`.
   - Because the document belongs to LTA, Postgres returns 0 rows, triggering `404 Not Found: Document <id> not found`.
4. **Why it still shows:** `listDocuments` does not filter out `pending_upload` status; the row created in Step 1 remains in the database and renders in tables and task detail cards upon refresh.
5. **Why it fails download/preview:** `GET /v1/documents/:id/download-url` rejects `pending_upload` documents with `409 Conflict: Document upload has not been confirmed yet`.

---

### 3. Required Deliverables & Fix Tasks

#### A. Backend Code Fixes
Check out directory: `/home/deutz/Migration_Final-render/ata-lta-erp-final-render` (branch `staging`).

1. **`backend/src/middleware/resolveEntity.js`**:
   - In Step 4 (`routeParamId` detection), add `documents` table lookup immediately after `transmittals`:
     ```javascript
     const { data: docRow, error: docParamErr } = await supabaseAdmin
       .from('documents')
       .select('entity_id')
       .eq('id', routeParamId)
       .maybeSingle();
     if (docParamErr) {
       throw new AppError({
         statusCode: 500,
         title: 'Database Error',
         detail: 'Unable to resolve entity for document',
       });
     }
     if (docRow?.entity_id) {
       resolvedUUID = docRow.entity_id;
       resolvedCode = await resolveEntityCode(docRow.entity_id);
     }
     ```
   - In Step 3 (body detection), support `req.body.linkedTaskId || req.body.taskId` by querying the task's parent `work_request.entity_id`.

2. **`backend/src/modules/documents/routes.js`**:
   - For `POST /:id/confirm-upload`, `POST /:id/comments`, `PUT /:id/comments/:commentId`, `DELETE /:id/comments/:commentId`, `PUT /:id`, `POST /:id/archive`, `POST /:id/unarchive`, `DELETE /:id`, and `PUT /:id/lifecycle`:
     Ensure these routes resolve the target document's entity accurately when `X-Active-Entity: ALL` is sent.

3. **`backend/src/modules/documents/controller.js`**:
   - In `confirmUpload` (line 152), pass `userId: req.user?.id` so `updated_by` is recorded:
     ```javascript
     const data = await service.confirmUpload({
       entityId: req.activeEntity,
       id: req.params.id,
       userId: req.user?.id,
       user: req.user,
     });
     ```

4. **`backend/src/modules/documents/service.js`**:
   - In `createDocument` (around line 273), inherit `entity_id` from the parent `work_request` when `data.workRequestId` or `data.linkedTaskId` is provided, preventing `CONFLICTING_WR_ENTITY` (400) when a multi-entity user uploads from ATA context to an LTA task.

#### B. Verification & Testing
1. Execute the empirical test suite:
   ```bash
   node backend/node_modules/jest/bin/jest.js --config docs/audits/document-upload-confirmation-2026-10-25/evidence/jest.config.json
   ```
   Update test expectations so that confirm-upload succeeds with `200 OK` (instead of 404), document status becomes `'active'`, download preview succeeds with `200 OK`, and comments/archives succeed in `ALL` view.
2. Run full backend regression tests:
   ```bash
   cd backend && npm test
   ```
3. Run linting:
   ```bash
   cd backend && npx prettier --check src/
   ```

#### C. Staging Data Repair
Execute an idempotent script to activate the two verified staging documents (`2deabc18-31a7-4419-80c3-e0a854864d7d` and `d18ef320-fb30-48c8-b7bf-5e74fa08270b`) whose binaries have already been validated in storage.
```

---
