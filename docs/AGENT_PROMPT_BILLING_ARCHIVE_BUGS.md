# Agent Prompt: Fix Billing Archive Bugs

You are fixing billing archive bugs. Read `docs/TODO_BILLING_ARCHIVE_BUGS.md` for the full investigation and root cause analysis.

## Summary of Bugs

1. Trashed draft invoices don't show correctly in the Archive tab
2. "Unarchive" button doesn't work for trashed/Cancelled invoices
3. After trash/unarchive, the UI briefly updates then reverts (requires manual refresh)
4. Archive nav badge count is wrong — badge shows items that the archive list does not display, or vice versa

## Required Changes

### 1. Frontend: Fix `renderArchive()` category split

In `erp_prototype/js/billing.js`, `renderArchive()`:

```js
// Before
const paid = archivedInvoices.filter(inv => inv.archived === true);
const cancelled = archivedInvoices.filter(inv => inv.status === 'Cancelled' && !inv.archived);

// After
const paid = archivedInvoices.filter(inv => inv.archived === true && inv.status !== 'Cancelled');
const cancelled = archivedInvoices.filter(inv => inv.status === 'Cancelled');
```

### 2. Frontend: Fix `unarchiveInvoice()` guard

In `erp_prototype/js/billing.js`, `unarchiveInvoice()`:

```js
// Before
if (!inv || inv.status !== 'Paid' || !inv.archived) return;

// After
if (!inv || !inv.archived) return;
```

Also ensure Cancelled invoices are restored to `Draft` status when unarchived.

### 3. Frontend: Timestamp-aware cache merges

Update `_loadInvoices()` and `fetchInvoices()` in `erp_prototype/js/billing.js` so incoming server records do NOT overwrite locally cached records when the cached record has a newer `updatedAt`.

Remove the old merge logic that forcibly restored old `archived` and `status` values regardless of timestamps.

### 4. Frontend: Debounced post-mutation refresh

Add `_schedulePostMutationRefresh()` helper:

```js
_schedulePostMutationRefresh() {
  clearTimeout(this._postMutationTimer);
  this._postMutationTimer = setTimeout(() => {
    this._listCacheGeneration++;
    this.loadCounts(true).finally(() => {
      this.backgroundRefresh().then(() => App.handleRoute());
    });
  }, 600);
}
```

Call it in the success path of every mutation:
- `trashInvoice`
- `restoreInvoice`
- `archiveInvoice`
- `bulkArchiveInvoices`
- `bulkTrashInvoices`
- `unarchiveInvoice`
- `permanentDeleteInvoice`

### 5. Frontend: Fix archive filter in `renderArchive()`

Change the filter that excludes items from the archive list so it does NOT exclude Cancelled invoices that have `archived=false`:

```js
archivedInvoices = Array.from(invMap.values()).filter(inv => {
  const cached = this.getInvoiceById(inv.id);
  return !cached || cached.archived !== false || cached.status === 'Cancelled';
});
```

### 6. Frontend: Fix archive badge count timing and source

In `render()`:
- `await this.ensure()` before rendering the tab nav so badge counts are computed from a loaded cache.

In `renderTabNav()`:
- Remove the preference for cached server `_counts.archived`.
- Derive the Archive badge directly from `_listCache` + `rejected` count:

```js
const archiveCount = cachedInvoices.filter(inv => this._isArchiveInvoice(inv, entity)).length + (this._counts?.rejected || 0);
```

### 7. Backend: Align archive list query with archive count

In `backend/src/modules/billing/service.js`, `listInvoices()`:

```js
if (isArchived) {
  // Archive view shows both explicitly archived invoices and cancelled (trashed) invoices.
  query = query.or('archived.eq.true,status.eq.Cancelled');
} else if (archived === false || archived === 'false') {
  query = query.eq('archived', false).neq('status', 'Cancelled');
}
```

## Verification

- Do NOT commit or push
- Do NOT use Playwright for testing
- Run `node -c erp_prototype/js/billing.js` and `node -c backend/src/modules/billing/service.js` to verify syntax
- The Archive nav badge count must exactly match the number of items shown in the Archive list
- After trashing/unarchiving, the UI should stay consistent without manual refresh
