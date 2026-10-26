---
title: Document Upload Confirmation 404 Defect — Remediation Specification
date: 2026-10-25
status: Ready for implementation / execution
tags: [ATA-LTA, remediation, fix, documents, dms]
---

# Document Upload Confirmation 404 Defect — Remediation Specification

**Spec ID:** `FIX-DOC-CONFIRM-404-20261025`  
**Target Branches:** `staging` (Backend), `enterprise-v2` (Frontend)  
**Parent Audit:** `[[Audit Report]]`

---

## 1. Problem Statement & Root Cause Review

When a user in **Consolidated View (`X-Active-Entity: ALL`)** uploads a file to a work request or task belonging to **LTA** (or any entity that is not the first entry in their user `entities` list):

1. **Step 1 (POST `/v1/documents`)**: Creates metadata row in database with `entity_id = LTA` and `status = 'pending_upload'`.
2. **Step 2 (Storage PUT)**: Uploads binary file to Supabase storage path under `entities/LTA/...`.
3. **Step 3 (POST `/v1/documents/:id/confirm-upload`)**:
   - `resolveEntity()` runs with `options.allowAll = false`.
   - `req.body` is empty (`{}`).
   - `req.params.id` contains the document UUID.
   - The route param entity detection cascade in `resolveEntity.js` checks `work_requests`, `operations_requests`, `clients`, `invoices`, `disbursements`, and `transmittals`. **It omits `documents`!**
   - As a result, `resolveEntity()` falls back to `req.user.entities[0]` (`'ATA'`).
   - `service.confirmUpload()` passes `entityId: 'ent-ata'` to `getDocumentById()`.
   - `getDocumentById()` appends `WHERE entity_id = 'ent-ata'`.
   - The document in the database has `entity_id = 'ent-lta'`. Postgres returns 0 rows.
   - The backend responds with **`404 Not Found: Document <id> not found`**.

---

## 2. Planned Code Remediations

### Change 1: Add `documents` Table to `resolveEntity.js` Detection Cascade

**File:** `backend/src/middleware/resolveEntity.js` (around line 183)

Insert `documents` table lookup immediately after `transmittals`:

```javascript
                  } else {
                    // Check documents table for document routes (/documents/:id/*)
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
                  }
```

### Change 2: Support `allowAll: true` on Document Mutation Endpoints

**File:** `backend/src/modules/documents/routes.js`

For `POST /:id/confirm-upload`, `POST /:id/comments`, `PUT /:id/comments/:commentId`, `DELETE /:id/comments/:commentId`, `PUT /:id`, `POST /:id/archive`, `POST /:id/unarchive`, `DELETE /:id`, and `PUT /:id/lifecycle`:
Configure the routes to allow consolidated resolution (`resolveEntity({ allowAll: true })`) or route-level entity resolution from the target document.

In `getDocumentById`, when `entityId === 'ALL'`, the service loads the document by ID without entity restriction, and `validateRecordProjectLinkage()` enforces that the user is authorized for that document's entity and parent project.

### Change 3: Supply `userId` to `confirmUpload` in `controller.js`

**File:** `backend/src/modules/documents/controller.js` (line 152)

```javascript
const confirmUpload = async (req, res, next) => {
  try {
    const data = await service.confirmUpload({
      entityId: req.activeEntity,
      id: req.params.id,
      userId: req.user?.id,
      user: req.user,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
};
```

### Change 4: Inherit `entity_id` from Parent Work Request in `createDocument`

**File:** `backend/src/modules/documents/service.js` (line 273)

When `data.workRequestId` or `data.linkedTaskId` is provided, resolve the parent `work_request.entity_id`:

```javascript
  let effectiveEntityId = entityId;
  if (data.workRequestId || data.linkedTaskId) {
    const parentWrId = data.workRequestId || task?.work_request_id;
    if (parentWrId) {
      const { data: parentWr } = await supabaseAdmin
        .from('work_requests')
        .select('entity_id')
        .eq('id', parentWrId)
        .maybeSingle();
      if (parentWr?.entity_id) {
        effectiveEntityId = parentWr.entity_id;
      }
    }
  }
```

This prevents entity conflict errors (`CONFLICTING_WR_ENTITY`) when a staff member with access to both entities creates a task document while active entity is set to ATA.

---

## 3. Staging Data Repair Script

A one-time idempotent script to activate the two stranded staging documents that have already been verified in storage:

```javascript
/**
 * Repair script: Activate verified pending_upload documents in staging
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const env = require(path.join(root, 'backend/node_modules/dotenv')).parse(
  fs.readFileSync(path.join(root, 'backend/.env.staging'))
);
const { createClient } = require(path.join(root, 'backend/node_modules/@supabase/supabase-js'));

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE_KEY);

const TARGET_IDS = [
  '2deabc18-31a7-4419-80c3-e0a854864d7d', // a_house_in_the_snow.png
  'd18ef320-fb30-48c8-b7bf-5e74fa08270b', // a_moon_over_a_mountain.png
];

async function repair() {
  for (const id of TARGET_IDS) {
    const { data: doc } = await db.from('documents').select('*').eq('id', id).single();
    if (!doc) {
      console.warn(`Document ${id} not found.`);
      continue;
    }
    if (doc.status === 'active') {
      console.log(`Document ${id} is already active.`);
      continue;
    }
    // Verify storage object exists before activating
    const { data: files } = await db.storage
      .from('ata-lta-erp-documents-staging')
      .list(path.dirname(doc.storage_path));
    const basename = path.basename(doc.storage_path);
    const exists = files?.some((f) => f.name === basename);
    if (!exists) {
      console.error(`Storage file ${doc.storage_path} does not exist. Skipping.`);
      continue;
    }

    const { error: updateError } = await db
      .from('documents')
      .update({
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error(`Failed to activate ${id}:`, updateError.message);
    } else {
      console.log(`Successfully activated document ${id} (${doc.original_name}).`);
    }
  }
}

repair().catch(console.error);
```

---

## 4. Verification & Testing Matrix

| Scenario | Pre-Condition | Action | Expected Post-Condition |
| --- | --- | --- | --- |
| **V01: Consolidated Upload (LTA)** | User with `['ATA', 'LTA']`, session active entity = `ALL` | Upload document to LTA task | POST `/confirm-upload` returns 200; status becomes `'active'`; no 404 error banner. |
| **V02: Consolidated Preview (LTA)** | Document in LTA | Call `GET /download-url` | Returns 200 with signed download URL. |
| **V03: Consolidated Comment (LTA)** | Document in LTA | POST `/:id/comments` | Returns 200 with added comment. |
| **V04: Entity Inheritance** | User in `ATA` active entity | Upload document to `LTA` task | Document `entity_id` matches `work_request.entity_id` (`LTA`); no `CONFLICTING_WR_ENTITY` error. |
| **V05: Audit Actor Persistence** | Upload confirmed | Inspect DB row | `updated_by` equals caller's user UUID. |
