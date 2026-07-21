# Work Request Task Document Upload & Preview Redesign

**Date:** 2026-07-22  
**Branch:** `uat` (apply all changes here; do **not** commit or push)  
**Scope:** Work Request tasks only. The upload handler, attachment popover, and previewer live in `erp_prototype/js/workflow.js`. The backend document service lives in `backend/src/modules/documents/`.  
**Goal:**
1. Fix the `413 Payload Too Large` error on PDF uploads by replacing the broken base64-in-JSON upload with the existing signed-URL upload flow.
2. Redesign document preview to be inline and Notion-inspired instead of opening a raw `dataUrl` in a new tab.
3. Allow regular ERP document sizes (PDFs, scans, spreadsheets, images) to upload reliably.

---

## 1. Root-cause summary

### 1.1 Frontend uploads file bytes inside JSON metadata
`workflow.js:showAddDocumentModal()` and `workflow.js:showAttachmentPopover()` both do:

```js
const reader = new FileReader();
reader.onload = async (ev) => {
  const dataUrl = ev.target.result;        // base64 file contents
  const dmsRecord = { ..., dataUrl: dataUrl };
  await window.apiClient.documents.create(dmsRecord);
};
reader.readAsDataURL(file);
```

`apiClient.post()` sends this as `application/json`. The backend has:

```js
// backend/src/app.js:75
app.use(express.json({ limit: '100kb' }));
```

A 300 KB PDF becomes ~400 KB base64, which exceeds 100 KB and returns **413 Payload Too Large** before the route handler runs.

### 1.2 Frontend sends the wrong schema
The backend `createDocumentSchema` expects:
- `fileName`, `contentType`, `fileSize`
- `documentType` (camelCase)
- `category` as enum (`SEC`, `BIR`, `CONTRACT`, `PERMIT`, `FINANCIAL`, `CORRESPONDENCE`, `LEGAL`, `HR`, `OTHER`)
- optional `linkedTaskId`

The frontend sends:
- `document_type` (snake_case)
- `uploader` (backend uses JWT)
- `uploadDate` (backend uses `created_at`)
- `entity` (backend uses header middleware)
- `dataUrl` (ignored by backend, causes the 413)
- `documentLifecycle` (snake_case on backend as `document_lifecycle`)
- `category: 'Requirement Docs'` (not in the enum)
- `linkedTaskId` is missing, so the document is never tied to the task in the DMS table.

### 1.3 Backend already has the correct upload flow
`backend/src/modules/documents/README.md` documents the intended flow:

1. `POST /v1/documents` — create metadata, returns `{ document, uploadUrl }`.
2. Client `PUT`s file bytes directly to Supabase Storage using `uploadUrl`.
3. `POST /v1/documents/:id/confirm-upload` — marks status as `active`.

The frontend never implemented step 2 or 3; it must be wired in.

### 1.4 Permission mismatch for task uploaders
`backend/src/modules/documents/routes.js:25` requires `dms:edit` to create a document. Users who only have `workflow:task_upload` (the permission checked in `workflow.js:9648`) will be rejected by the documents endpoint. The fix must either:
- add a `workflow:task_upload` aware route/handler, or
- ensure the roles that can upload task documents also hold `dms:edit` (preferred if RBAC already allows it).

### 1.5 Current preview is fragile
`workflow.js:6320-6332` and `workflow.js:9672-9683` open a new blank window and write an iframe pointing at `dmsDoc.dataUrl`. Because `dataUrl` is not persisted in the DMS table (the backend does not accept it), the link works only for the current session and breaks on refresh. It also provides no metadata, download button, or safe fallback for non-PDF files.

---

## 2. Implementation plan

### Phase A — Make uploads work for regular ERP file sizes

#### A.1 Add `linkedTaskId` support to the backend document service
Files: `backend/src/modules/documents/schema.js`, `service.js`, `routes.js` (if permission changes)

- `createDocumentSchema`: `linkedTaskId` is already optional; no schema change needed unless stricter validation is desired.
- `service.createDocument`: already accepts `data.linkedTaskId` and writes `linked_task_id`. Confirm the frontend will send it.
- Add a small validation helper in `service.js` (optional): when `linkedTaskId` is provided, verify the task exists and belongs to the same work request / entity. This prevents orphan documents.

#### A.2 Replace base64 upload with signed-URL flow in `workflow.js`
Create a reusable helper, e.g. `Workflow.uploadTaskDocument(taskId, file)`:

```js
async uploadTaskDocument(taskId, file, options = {}) {
  const task = WorkflowData.getTaskById(taskId);
  const wr = WorkflowData.getWorkRequestById(task.workRequestId);

  // 1. Build a DMS metadata payload matching backend schema
  const metadata = {
    fileName: file.name,
    originalName: file.name,
    contentType: file.type || 'application/octet-stream',
    fileSize: file.size,
    documentType: options.documentType || 'original_scan',
    category: options.category || 'OTHER',          // must be enum value
    description: options.description || `Uploaded via task: ${task.title}`,
    workRequestId: task.workRequestId,
    linkedTaskId: taskId,
  };

  // 2. Create metadata and get signed URL
  const createRes = await window.apiClient.documents.create(metadata);
  const { document: dmsDoc, uploadUrl } = createRes.data;

  // 3. Upload raw bytes to Supabase Storage
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': metadata.contentType },
    body: file,
  });
  if (!uploadRes.ok) {
    throw new Error(`Storage upload failed: ${uploadRes.status}`);
  }

  // 4. Confirm upload so the row becomes active
  await window.apiClient.documents.confirmUpload(dmsDoc.id);

  // 5. Link the task to the DMS record
  const entry = {
    documentId: dmsDoc.id,      // NEW: stable id used for preview
    fileName: file.name,
    uploadDate: new Date().toISOString().slice(0, 10),
    uploaderId: Auth.user.id,
  };
  const updatedDocs = [...(task.taskDocuments || []), entry];
  await WorkflowData.updateTask(taskId, { taskDocuments: updatedDocs, updatedAt: new Date().toISOString() });

  WorkflowData.invalidateRelatedForWorkRequest(task.workRequestId);
  return dmsDoc;
}
```

Call sites to refactor:
- `showAddDocumentModal()` (~line 10209)
- `showAttachmentPopover()` Upload tab (~line 10296)
- Remove all `FileReader.readAsDataURL` usage for real files.

#### A.3 Fix link / Google Drive paths
For non-file entries (link URL, GDrive), the backend row should store the URL in a dedicated field rather than `dataUrl`. Options:
- Add a `source_url` or `external_url` column to the `documents` table and schema.
- Or keep links out of the DMS table entirely and only store them in `task.taskDocuments[].linkUrl`.

Recommended minimal change:
- Add `externalUrl` (text, nullable) to `documents` table migration.
- Add `externalUrl` to `createDocumentSchema` and `updateDocumentSchema`.
- For link / GDrive entries, skip the signed-URL flow and set `status: 'active'` immediately because there is no file to upload. The backend `confirmUpload` step should be skipped.
- Store `linkUrl` in both `taskDocuments` and `documents.externalUrl`.

#### A.4 Permission fix
Two options; pick one and document the decision:

**Option 1 (recommended — least backend change):** In `workflow.js`, before calling `documents.create`, check `Auth.can('dms:edit')`. If the user only has `workflow:task_upload`, show a message explaining they need DMS edit rights. If all task-upload roles already have `dms:edit`, no code change is needed; verify with `backend/src/lib/permissions.js`.

**Option 2:** Add a new endpoint or route-level permission fallback for task uploads:
```js
// routes.js
router.post(
  '/from-task',
  requirePermission('workflow:task_upload'),
  audit('document.create', { table: 'documents' }),
  documentsController.createDocument
);
```
This reuses the same controller and service. The frontend task upload path calls `/documents/from-task`.

#### A.5 File-size guardrails
- Frontend: reject files > 50 MB with a clear message before starting. This matches Supabase Storage practical limits and avoids browser memory issues.
- Backend: no body-parser size change is required because file bytes no longer hit Express. Add an optional `MAX_FILE_SIZE_BYTES` env var and validate `fileSize` in `createDocumentSchema` against it (default 50 MB).

---

### Phase B — Notion-inspired document preview

#### B.1 Add a preview modal component
Create `Workflow.showDocumentPreview(documentId)` in `workflow.js`:

```js
async showDocumentPreview(documentId) {
  // 1. Fetch document metadata
  const docRes = await window.apiClient.documents.get(documentId);
  const doc = docRes.data;

  // 2. Fetch signed download URL
  const urlRes = await window.apiClient.documents.downloadUrl(documentId);
  const { url, fileName } = urlRes.data;

  // 3. Render Notion-style side-pane overlay
  const overlay = el('div', { class: 'document-preview-overlay' });
  const pane = el('div', { class: 'document-preview-pane' });
  const header = el('div', { class: 'document-preview-header' });
  header.appendChild(el('h3', { text: fileName, class: 'document-preview-title' }));

  const closeBtn = el('button', { class: 'btn btn-ghost', text: 'Close' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);

  const downloadBtn = el('a', {
    href: url,
    download: fileName,
    class: 'btn btn-primary',
    text: 'Download',
    target: '_blank',
  });
  header.appendChild(downloadBtn);

  const viewer = el('div', { class: 'document-preview-viewer' });
  const contentType = doc.content_type || '';
  if (contentType.startsWith('image/')) {
    viewer.appendChild(el('img', { src: url, alt: fileName, style: 'max-width:100%;' }));
  } else if (contentType === 'application/pdf') {
    viewer.innerHTML = `<iframe src="${url}" frameborder="0" allowfullscreen></iframe>`;
  } else {
    viewer.appendChild(el('div', {
      class: 'document-preview-fallback',
      text: 'Preview not available for this file type. Use Download to open it.',
    }));
  }

  const meta = el('div', { class: 'document-preview-meta' });
  meta.appendChild(el('span', { text: `Type: ${contentType || 'unknown'}` }));
  meta.appendChild(el('span', { text: `Size: ${formatBytes(doc.file_size || 0)}` }));
  meta.appendChild(el('span', { text: `Uploaded: ${formatDate(doc.created_at)}` }));

  pane.appendChild(header);
  pane.appendChild(viewer);
  pane.appendChild(meta);
  overlay.appendChild(pane);
  document.body.appendChild(overlay);
}
```

#### B.2 Add CSS for the preview pane in `erp_prototype/css/styles.css`

```css
.document-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1000;
  display: flex;
  justify-content: flex-end;
}

.document-preview-pane {
  width: min(760px, 100vw);
  height: 100vh;
  background: var(--color-surface);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
}

.document-preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border);
}

.document-preview-title {
  flex: 1;
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.document-preview-viewer {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.document-preview-viewer iframe,
.document-preview-viewer img {
  width: 100%;
  height: 100%;
  border: none;
}

.document-preview-meta {
  display: flex;
  gap: 16px;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border);
  font-size: 0.8125rem;
  color: var(--color-text-muted);
}
```

#### B.3 Update document list rendering to open preview
In the two document list loops (`workflow.js:6293` and `workflow.js:9662`):
- Replace the current `dataUrl` match + `window.open` logic.
- Use `d.documentId` from `taskDocuments` to look up the DMS record.
- If `documentId` exists and the DMS record is active, render the filename as a clickable link that calls `this.showDocumentPreview(documentId)`.
- For legacy entries that only have `fileName` and no `documentId`, keep a fallback download link using `documents.downloadUrl` matched by filename, or show plain text if no match.

```js
const dmsDoc = wrDocs.find(doc => doc.id === d.documentId);
if (dmsDoc) {
  const link = el('a', { href: '#', text: '📎 ' + fName, class: 'document-preview-link' });
  link.addEventListener('click', (e) => {
    e.preventDefault();
    this.showDocumentPreview(dmsDoc.id);
  });
  leftSide.appendChild(link);
} else {
  leftSide.appendChild(el('span', { text: '📎 ' + fName }));
}
```

#### B.4 Backfill migration for existing task documents
Existing `task.taskDocuments` entries do not have `documentId`. Add a one-time normalization in `WorkflowData.normalizeTask`:

```js
normalized.taskDocuments = (task.taskDocuments || []).map(d => ({
  ...d,
  documentId: d.documentId || null,
}));
```

When rendering, if `documentId` is missing, attempt to match by `fileName` against `wrDocs` and, if exactly one match is found, patch the entry with the matched `id` locally. Do not call the backend for the patch; just set it so future previews work.

---

### Phase C — Tests and validation

#### C.1 Backend tests to add / update
File: `backend/tests/documents.test.js` (or create it)

- `POST /v1/documents` with valid metadata returns `{ document, uploadUrl }`.
- `POST /v1/documents` with `linkedTaskId` stores `linked_task_id`.
- `POST /v1/documents/:id/confirm-upload` transitions status from `pending_upload` to `active`.
- `GET /v1/documents/:id/download-url` returns a signed URL for active documents and 409 for pending.

#### C.2 Frontend smoke tests
File: `erp_prototype/smoke-test.js` or manual QA checklist (no Playwright per instruction)

- Upload a 50 KB PDF on a work-request task → success, no 413.
- Upload a 5 MB PDF → success.
- Upload a 60 MB file → rejected with a clear message before upload.
- Click a task document → Notion-style preview pane opens.
- Close / download buttons work.
- Refresh page → document still previews (because it now uses persisted DMS `id` and signed URL, not `dataUrl`).
- Link / GDrive entries still render and are removable.

#### C.3 Run backend test suite
```bash
cd backend && npm test
```
Target: all existing tests still pass (currently 128 passing per memory).

---

## 3. Files to touch

| File | Change |
|------|--------|
| `backend/src/modules/documents/schema.js` | Add `externalUrl` to create/update schemas; add optional `maxFileSize` validation. |
| `backend/src/modules/documents/service.js` | Add `externalUrl` handling; optional task existence check; set status `active` for external URLs. |
| `backend/src/app.js` | No body-parser size change needed if base64 removed; optionally remove `dataUrl` references. |
| `erp_prototype/js/workflow.js` | Replace `FileReader.readAsDataURL` upload with signed-URL flow; add `uploadTaskDocument` and `showDocumentPreview`; update task document list rendering. |
| `erp_prototype/js/apiClient.js` | No change unless Option 2 route (`/documents/from-task`) is added. |
| `erp_prototype/css/styles.css` | Add `.document-preview-*` styles. |
| `backend/migrations/...` | Add `external_url` text column to `documents` if link/GDrive storage is desired. |
| `backend/tests/documents.test.js` | Add tests for upload flow and download URL. |

---

## 4. Open decisions for the implementing agent

1. **Permission model:** Confirm whether roles with `workflow:task_upload` also have `dms:edit`. If not, implement Option 2 (`POST /v1/documents/from-task`) or update seed permissions.
2. **Link / GDrive storage:** Decide whether link-type attachments need a DMS row. The minimal fix keeps them only in `task.taskDocuments`. If a DMS row is required, add `external_url` column and schema.
3. **Max file size:** Choose a sensible cap (suggested 50 MB) and enforce it on frontend and in `createDocumentSchema`.
4. **PDF preview renderer:** The signed Supabase URL can be rendered directly in `<iframe>` for PDFs. For Office files, fall back to download only; embedding Office Online would require public URLs.
5. **Migration of legacy task documents:** Decide whether to run a data migration that matches old `taskDocuments` to DMS rows by filename and backfills `documentId`, or rely on the runtime fallback in `normalizeTask` / render.

---

## 5. Notes

- **No commits** should be made by the implementing agent unless explicitly requested by the user.
- **No Playwright plugin runs** — validate with backend tests and manual browser QA only.
- This plan intentionally leaves the old `dataUrl` paths in place until the refactor is complete; after verification, search `erp_prototype/js/workflow.js` for `dataUrl` and remove all production usages.
