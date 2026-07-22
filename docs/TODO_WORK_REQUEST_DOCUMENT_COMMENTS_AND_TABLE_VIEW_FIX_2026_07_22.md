# Work Request Task Document Comments Persistence & Table View Attachment Visibility

**Date:** 2026-07-22  
**Branch:** `uat` (apply all changes here; do **not** commit or push)  
**Scope:** Work Request task documents in `erp_prototype/js/workflow.js`, `backend/src/modules/documents/`, and `backend/src/modules/operations/`.

**Goal:**
1. Make per-document comments persistent and visible to everyone involved.
2. Fix the table/detail view so that uploaded task documents appear in the **Attached Documents** section of the task detail panel inside the table view, not just in the side pane or other view modes.

---

## 1. Root-cause summary

### 1.1 Document comments are only local
The `_renderTaskDocumentItem()` helper in `workflow.js` builds a comments UI, but it only mutates the in-memory `dmsDoc.comments` array. Nothing is sent to the backend. On refresh or for other users, the comments disappear because the DMS row is re-fetched and `comments` starts empty again.

The backend already has:
- `comments` JSONB column on `documents`.
- `updateDocumentSchema.comments` validation.
- `service.updateDocument` copies `data.comments` into `updates.comments`.

So the only missing piece is wiring the frontend add/edit/delete handlers to `apiClient.documents.update(id, { comments })`.

### 1.2 Detail/table view task panel doesn't show uploaded documents
`workflow.js` now has two places that render task documents:
- `showTaskSidePane()` — loads `documents.list({ linkedTaskId: task.id })` and renders successfully.
- `renderDetail()` task detail panel (the right pane of an expanded task row in **table view**) — filters `wrDocs` by `doc.linked_task_id === t.id` and should render documents, but it currently shows "No documents attached" in the user's screenshot.

The discrepancy happens because:

1. `renderDetail()` calls `documents.list({ workRequestId: this.detailWrId })` once at the top of the function.
2. It then passes that single `wrDocs` array to every expanded task row in the table view.
3. The task detail panel filters that array by `linked_task_id`.
4. However, the DMS service stores `linked_task_id` as a UUID, and the `documents.list` endpoint returns raw Postgres rows. If `linked_task_id` is missing or the filter comparison fails (e.g., camelCase vs snake_case in `toApiTask` or Supabase select), the documents don't show.
5. Additionally, if a user uploads a document while a task row is expanded, the existing `wrDocs` array in `renderDetail()` is stale because the upload only refreshes the side pane, not the whole detail view.

### 1.3 View-mode inconsistency
Board/list/checklist views open the **task side pane**, which was already fixed to load documents by `linkedTaskId`. The **table view** expands an inline detail panel that uses `renderDetail()`'s `wrDocs`, which is broken. This is why the user sees documents in non-table views but not in table view.

---

## 2. Implementation plan

### Phase A — Make document comments persistent

#### A.1 Add a helper to save comments in `workflow.js`

```js
async _saveDocumentComments(documentId, comments) {
  try {
    await window.apiClient.documents.update(documentId, { comments });
  } catch (err) {
    console.error('Failed to save document comments', err);
    this.showMessage('Error', 'Failed to save comment. Please try again.', 'danger');
    throw err;
  }
}
```

#### A.2 Update `_renderTaskDocumentItem()` add/edit/delete handlers
Inside `_renderTaskDocumentItem`, the comments section currently mutates `dmsDoc.comments` locally. Change each handler to:

- **Add comment:** push to `dmsDoc.comments`, then call `_saveDocumentComments(dmsDoc.id, dmsDoc.comments)`.
- **Edit comment:** mutate `dmsDoc.comments[cIdx]`, then call `_saveDocumentComments(...)`.
- **Delete comment:** splice `dmsDoc.comments`, then call `_saveDocumentComments(...)`.

For optimistic UI, call `renderComments()` immediately, then save in the background. If the save fails, optionally roll back or just show a message; the simpler path is to call save and only show an error toast on failure.

#### A.3 Ensure comments are visible to other users
Because comments are stored on the DMS row, any user who can view the document will fetch the same `comments` JSONB array. No extra work needed once the save is wired.

#### A.4 Permission check
Only users with `dms:edit` should be allowed to add/edit/delete comments. The current UI gates the comment add form by `Auth.can('workflow:approve')`, which is too restrictive and unrelated. Change the gate to `Auth.can('dms:edit')` for adding/editing/deleting comments.

#### A.5 Backend test
Add/update a test in `backend/tests/integration/documents.test.js` that:
- Creates a document.
- `PUT /v1/documents/:id` with `comments: [{ userId, date, text }]`.
- `GET /v1/documents/:id` and asserts the comments round-trip.

---

### Phase B — Fix task detail panel documents in table view

#### B.1 Make `renderDetail()` reload documents per-task instead of once
The cleanest fix is to move the document fetch into the task-row rendering path. Since `renderDetail()` already renders each task row synchronously-ish (it builds DOM and returns), the simplest robust fix is:

- Keep `wrDocs` for the WR-level `getDocBadgeForWr()` badge.
- Inside the task detail panel (around `workflow.js:9640`), when expanding a task, fetch documents for that task asynchronously and render them.

However, `renderDetail()` builds the full DOM before appending it, so async insertion mid-build is awkward. Two options:

**Option 1 (recommended):** Eagerly build the panel with a placeholder, then populate it after the DOM is mounted.

```js
// Inside the task detail panel builder
const docsSection = el('div', { class: 'detail-block' });
const docsList = el('div', { class: 'details-content-list' });
docsList.appendChild(renderEmptyState('Loading documents...'));
docsSection.appendChild(docsList);
rightPane.appendChild(docsSection);

// After DOM insertion, fetch task-specific docs
(async () => {
  try {
    const docsRes = await window.apiClient.documents.list({ linkedTaskId: t.id });
    const taskDocs = docsRes?.data || [];
    docsList.innerHTML = '';
    if (taskDocs.length === 0) {
      docsList.appendChild(renderEmptyState('No documents attached'));
    } else {
      taskDocs.forEach(dmsDoc => {
        docsList.appendChild(this._renderTaskDocumentItem(dmsDoc, { wr, isArchived, showComments: true }));
      });
    }
  } catch (err) {
    if (!isAbortError(err)) {
      console.error('Failed to load task documents in detail view', err);
      docsList.innerHTML = '';
      docsList.appendChild(renderEmptyState('Failed to load documents'));
    }
  }
})();
```

This requires `renderDetail()` to know when its container is in the DOM. Because the caller appends the returned container immediately, the placeholder will be inserted and the async fetch will run.

**Option 2 (simpler but less robust):** Fix the `wrDocs` filter.
Confirm that `documents.list({ workRequestId: wr.id })` returns rows with `linked_task_id` populated, and that the filter `doc.linked_task_id === t.id` is correct. If the issue is only stale data after upload, invalidate the related cache on upload and force a re-render.

However, because the user reports documents **never** appear in table view (not just after upload), Option 1 is the safer fix.

#### B.2 Invalidate related cache on upload
When `uploadTaskDocument()` or `linkTaskDocument()` succeeds, call:

```js
WorkflowData.invalidateRelatedForWorkRequest(task.workRequestId);
WorkflowData.invalidateRelatedForTask(taskId);
```

This ensures the table view's stale `wrDocs` is refreshed on the next `App.handleRoute()` if Option 2 is partially used, and it keeps the badge counts accurate.

#### B.3 Remove unused `task.taskDocuments` writes
Since the UI now renders from the DMS table, the local `task.taskDocuments` array is redundant. However, it is still written by `uploadTaskDocument()` and `linkTaskDocument()` and used by `_mergeTasks` in `WorkflowData` to preserve local extensions.

Recommendation: keep writing `taskDocuments` for now to avoid breaking checklist/comment local state, but update `normalizeTask` to ignore it on server-normalized tasks. The UI should always derive document visibility from `documents.list({ linkedTaskId })`.

#### B.4 Verify `linked_task_id` column has an index
Add an index in a new migration if not present:

```sql
CREATE INDEX IF NOT EXISTS idx_documents_linked_task_id ON documents(linked_task_id) WHERE deleted_at IS NULL;
```

This makes `documents.list({ linkedTaskId })` fast for many tasks.

---

### Phase C — Unified rendering

#### C.1 Use `_renderTaskDocumentItem()` everywhere
The side pane and detail view both already use `_renderTaskDocumentItem()`. Ensure the comments flag is consistent:
- Side pane: `showComments: false` (or true if you want comments visible in the side pane too).
- Detail/table view: `showComments: true`.

For user visibility, recommend `showComments: true` in both places so involved users can see discussion about a document regardless of where they open it.

#### C.2 Add a loading/empty/error state to `_renderTaskDocumentItem()` consumers
The helper itself is synchronous; the callers should handle async fetch states with `renderEmptyState()`.

---

## 3. Files to touch

| File | Change |
|------|--------|
| `erp_prototype/js/workflow.js` | Add `_saveDocumentComments()`; wire comment add/edit/delete to backend; fix table view task detail panel document fetch; invalidate related cache on upload. |
| `backend/src/modules/documents/schema.js` | Confirm `comments` schema supports the shape (already present). Optional: add `id` to each comment for stable edits/deletes. |
| `backend/tests/integration/documents.test.js` | Add round-trip test for document comments. |
| `backend/migrations/` | Add index on `documents(linked_task_id)`; optionally backfill legacy taskDocuments into DMS rows (if needed). |

---

## 4. Open decisions for the implementing agent

1. **Comment shape:** The current schema stores `{ userId, date, text }`. Should comments have a stable `id` so edits/deletes are robust? Recommended: add `id` (UUID or client-generated) so editing the 3rd comment doesn't depend on array order.
2. **Who can comment:** Use `dms:edit` for adding/editing/deleting comments, and `dms:view` for viewing them.
3. **Where to show comments:** Side pane vs detail view vs both? Recommended: both, via `showComments: true`.
4. **Backfill legacy taskDocuments:** Existing `task.taskDocuments` entries are not in the DMS table. Should a one-time migration/backfill be written to convert them into DMS rows? If yes, it can be done by matching by task + filename. If no, old uploads will remain invisible, which may be acceptable for a demo system.

---

## 5. Notes

- **No commits** should be made by the implementing agent unless explicitly requested by the user.
- **No Playwright runs** — validate with backend tests and manual browser QA only.
- This plan builds on the earlier document upload fix and assumes the signed-URL upload flow is already in place.
