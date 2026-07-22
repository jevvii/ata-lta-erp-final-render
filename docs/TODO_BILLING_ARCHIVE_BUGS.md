# Billing Archive Bugs — Investigation & Fix Plan

**Date:** 2026-07-21  
**Status:** Implemented (pending testing)  
**Modules affected:** `erp_prototype/js/billing.js`, `backend/src/modules/billing/service.js`

---

## Bugs Reported

1. **Trashed/deleted draft invoices don't appear in the Archive page**
2. **"Unarchive" button on the Archive page does nothing for trashed (Cancelled) invoices**
3. **Auto-refresh needed — after trash/unarchive, the UI briefly updates then reverts until manual refresh**
4. **Archive nav badge count is incorrect (shows 0 while Archive list shows 3 items)**

---

## Root Cause Analysis

### Bug 1: Trashed invoices not showing in Archive

**What the user expects:** When a draft invoice is trashed from the billing board, it should appear in the Archive page under the "Cancelled" category.

**What actually happens:** The trashed invoice appears briefly (optimistic update), but after the page re-renders or on a fresh visit, it disappears.

**Root cause — Frontend category split logic in `renderArchive()`:**

```js
const paid = archivedInvoices.filter(inv => inv.archived === true);
const cancelled = archivedInvoices.filter(inv => inv.status === 'Cancelled' && !inv.archived);
```

The `cancelled` filter required `!inv.archived`. But `trashInvoice()` sets **both** `status: 'Cancelled'` AND `archived: true`:

```js
await window.apiClient.invoices.update(id, { status: 'Cancelled', archived: true });
```

So a trashed invoice matched the "Paid" bucket instead of "Cancelled", or was excluded entirely.

### Bug 2: "Unarchive" button doesn't work for trashed/Cancelled invoices

**Root cause — `unarchiveInvoice()` guard clause required `status !== 'Paid'`**, silently exiting for any non-Paid invoice. A trashed invoice has `status === 'Cancelled'`, so the function did nothing.

### Bug 3: Stale / reverting UI after mutations

**Root cause — cache merge logic and race conditions:**

1. Optimistic update writes new `archived`/`status` + `updatedAt` to `_detailCache` / `_listCache`.
2. Mutation fires `App.handleRoute()` → `renderArchive()` → `fetchInvoices({ archived: true })` (network request A).
3. Mutation API call completes, `_endSkipGeneration()` clears skip protection.
4. Network request A may return stale server data (archived still true) AFTER skip protection ends.
5. `fetchInvoices()` blindly overwrote `_detailCache[id]` and `_listCache` with stale data, reverting the UI.

Additionally, `_loadInvoices()` had merge logic that forcibly preserved old `archived` and `status` values from the previous cache, clobbering newer server values.

### Bug 4: Archive nav badge count wrong

**Root cause — two separate issues:**

1. **Backend mismatch:** The count API counted all `status='Cancelled'` invoices, but the list API with `archived=true` only returned `archived=true` invoices. If cancelled invoices had `archived=false`, the badge and list were out of sync.
2. **Stale cached server count:** `apiClient.cachedCount` caches the `/invoices/counts` response for 30 seconds. `renderTabNav` preferred this stale server count over the live local cache, so the badge often lagged behind the actual list or showed 0 while the list showed items.
3. **Timing:** `renderTabNav` was rendered before the invoice list cache was loaded, and it computed the badge synchronously from whatever cache/state existed at that moment.

---

## Implemented Fixes

### Fix 1: Correct `renderArchive()` category split

**File:** `erp_prototype/js/billing.js`

```js
const paid = archivedInvoices.filter(inv => inv.archived === true && inv.status !== 'Cancelled');
const cancelled = archivedInvoices.filter(inv => inv.status === 'Cancelled');
```

Cancelled invoices always go to "Cancelled", non-Cancelled archived invoices go to "Paid/Accomplished".

### Fix 2: Remove Paid-only guard from `unarchiveInvoice()`

```js
if (!inv || !inv.archived) return;
```

Any archived invoice can be unarchived. For Cancelled invoices, the method also reverts the status to `Draft` so the invoice returns to the active draft board.

### Fix 3: Timestamp-aware cache merges

Updated both `_loadInvoices()` and `fetchInvoices()` to skip overwriting cached entries when the locally cached record has a newer `updatedAt` than the incoming server record. This prevents stale in-flight fetches from reverting optimistic mutations.

Removed the merge logic that forcibly restored old `archived`/`status` values regardless of timestamps.

### Fix 4: Debounced post-mutation refresh

Added `_schedulePostMutationRefresh()` helper. After every successful mutation (`trashInvoice`, `restoreInvoice`, `archiveInvoice`, `bulkArchiveInvoices`, `bulkTrashInvoices`, `unarchiveInvoice`, `permanentDeleteInvoice`) it schedules a 600ms delayed refresh that:
- Reloads server counts (`loadCounts(true)`)
- Refreshes the invoice list in the background (`backgroundRefresh()`)
- Re-renders the UI with authoritative data

### Fix 5: Fix archive nav badge count + list consistency

**Backend change in `backend/src/modules/billing/service.js`:**

```js
if (isArchived) {
  // Archive view shows both explicitly archived invoices and cancelled (trashed) invoices.
  query = query.or('archived.eq.true,status.eq.Cancelled');
} else if (archived === false || archived === 'false') {
  query = query.eq('archived', false).neq('status', 'Cancelled');
}
```

This makes the archive list return the same set of invoices that the backend count reports.

**Frontend changes in `erp_prototype/js/billing.js`:**
- Updated `renderArchive()` filter so it no longer excludes Cancelled invoices that happen to have `archived=false`.
- Updated `render()` to `await this.ensure()` before rendering the tab nav, so badge counts are computed from a loaded cache.
- Removed the preference for the cached server `_counts.archived` in `renderTabNav()`. The Archive badge is now derived directly from `_listCache` + `rejected` count, so it always matches the actual list content.

---

## Files Modified

| File | Change |
|------|--------|
| `erp_prototype/js/billing.js` | Category split, unarchive guard, timestamp-aware cache merges, post-mutation refresh, badge count fix, archive filter fix, await cache before tab nav |
| `backend/src/modules/billing/service.js` | Archive list query now returns `archived=true OR status='Cancelled'` |

---

## Testing Checklist

1. **Trash a draft invoice** → Confirm it appears in Archive under "Cancelled" without manual refresh
2. **Archive a Paid invoice** → Confirm it appears in Archive under "Paid/Accomplished" category
3. **Click "Unarchive" on a Paid archived invoice** → Confirm it moves back to active list with Paid status
4. **Click "Restore to Draft" on a Cancelled/trashed invoice** → Confirm it moves back to active list as Draft
5. **Click "Unarchive" on a Cancelled/trashed invoice** → Confirm it moves back to active list as Draft
6. **Check nav badge counts** → Archive badge count must exactly match the number shown in the Archive list (e.g., "All 3" tab should correspond to badge 3)
7. **Refresh the page after trashing** → Trashed invoice should still appear in Archive
8. **Switch entities** → Archive should correctly show invoices for the selected entity
