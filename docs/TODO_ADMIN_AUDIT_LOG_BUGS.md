# Admin Page - Audit Log Bug Fix Plan

**Date:** 2026-07-20
**Scope:** Admin Page → Audit Logs only (consolidated, ATA, and LTA views)
**Status:** Investigation complete, pending implementation

---

## Summary of Problems Found

Six distinct bugs were identified in the admin audit log. All six share a common root cause family: the frontend `refreshAuditLog()` in `erp_prototype/js/users.js` does not normalize API data before use, has no pagination UI, and the filter toolbar in `erp_prototype/js/utils.js` has a checkbox event-handling race condition.

---

## Bug 1: Invalid Timestamps — Sort & Date Filter Broken

**Symptom:** Timestamps display as "Invalid Date". Sorting by "Newest first" / "Oldest first" does not work. The date filter options produce no results.

**Root Cause:** The backend API (`backend/src/modules/admin/service.js:581`) returns the field as `createdAt` (camelCase). But the frontend at `users.js:1637` reads `l.timestamp`, which does not exist on the API response object, resulting in `new Date(undefined)` → `Invalid Date`.

A normalizer function `_normalizeAuditLog()` exists at `users.js:78-91` that maps `l.createdAt` → `l.timestamp`, but it is **never called** on the fetched data. The raw API rows go directly into `allLogs` at line 1506.

This cascading failure breaks:
- **Display** (line 1637-1649): `new Date(l.timestamp)` → Invalid Date
- **Sorting** (lines 1574-1577): `new Date(a.timestamp || a.created_at || 0)` falls through to `a.created_at` which also doesn't exist (API returns `createdAt`), so it falls to `0`, making all dates epoch and sort order meaningless
- **Date filter** (line 1547): `(l.timestamp || '').slice(0, 10)` → empty string → `dStr` is falsy → `return false` for every log → all logs filtered out
- **Sequence numbering** (line 1519): Same cascading issue, all timestamps resolve to epoch so the chronological order is arbitrary

**Files involved:**
- `erp_prototype/js/users.js` — lines 1504-1506 (missing normalization), line 1637 (display), lines 1519/1574/1577 (sorting), line 1547 (date filter)

**Fix plan:**
1. In `refreshAuditLog()`, after fetching each page of results at line 1505, apply `_normalizeAuditLog()` to each row:
   ```
   const page = (res?.data || []).map(r => this._normalizeAuditLog(r));
   ```
2. This single change fixes timestamps, sorting, date filtering, and sequence numbering — all downstream code already references `l.timestamp` which the normalizer populates.

**ATA & LTA views affected?** Yes — the same `refreshAuditLog()` code path is used for all entity views (ATA, LTA, ALL). The entity scope is handled by the `X-Active-Entity` header at the API layer, but the frontend rendering code is shared. All three views have the same bug.

---

## Bug 2: Filter Checkbox Toggle Flicker (Check/Uncheck Race Condition)

**Symptom:** When clicking a checkbox in the filter dropdown, the check sometimes unticks immediately. When trying to uncheck a checked filter, the check reappears. Requires multiple clicks to register.

**Root Cause:** Event handling conflict in `createJiraFilterToolbar()` at `utils.js:2329-2349`. The filter option is a `<button>` row containing a `<input type="checkbox">` child:

1. The checkbox has `click → e.stopPropagation()` (line 2335) — this prevents the row handler from firing
2. The row has `click → toggle catSet, updateFilterUI(), onFilterChange()` (lines 2341-2348)

**The race condition:**
- When you click **directly on the checkbox**: The checkbox's native behavior toggles its visual state. But `stopPropagation()` prevents the row handler from firing, so the underlying data model (`catSet`) is never updated. Then `updateFilterUI()` is never called from this click, but the visual state is now out of sync with the data.
- When the `onFilterChange` callback fires from a *different* interaction (or when `renderFilterValues()` is called for any reason), it does `list.innerHTML = ''` (line 2276) and rebuilds all checkboxes from `catSet` — reverting the visual toggle since `catSet` was never updated.
- Net effect: clicking the checkbox toggles it visually for a moment, then it snaps back on the next render cycle.

**The uncheck problem:**
- When you try to uncheck a checked item by clicking the checkbox directly, the checkbox visually unchecks but `catSet` still has the value. On re-render, it checks itself again.
- When you click the row (not on the checkbox), the row handler fires correctly. But if the click target is the checkbox, the checkbox toggles twice — once from native behavior, once from the row handler — resulting in no net change.

**Files involved:**
- `erp_prototype/js/utils.js` — lines 2329-2349 (the row/checkbox event handler setup)

**Fix plan:**
1. Remove the checkbox's `stopPropagation` listener (line 2335)
2. Add `preventDefault` on the checkbox click to prevent native toggle (the row handler will control state)
3. In the row click handler, after toggling catSet, explicitly set `checkbox.checked = catSet.has(opt.value)` before calling `updateFilterUI()` — OR simply let `renderFilterValues()` rebuild do its job (which it already does via `updateFilterUI()`)

Concretely, replace lines 2333-2349 with:
```javascript
const checkbox = el('input', { type: 'checkbox', class: 'jira-filter-checkbox' });
checkbox.checked = isChecked;
// Prevent native toggle — row handler manages state
checkbox.addEventListener('click', (e) => {
  e.preventDefault();
});

// ... (label, row.appendChild)

row.addEventListener('click', (e) => {
  e.stopPropagation();
  if (catSet) {
    if (catSet.has(opt.value)) catSet.delete(opt.value);
    else catSet.add(opt.value);
  }
  checkbox.checked = catSet.has(opt.value);
  updateFilterUI();
  if (onFilterChange) onFilterChange();
});
```

**ATA & LTA views affected?** Yes — `createJiraFilterToolbar()` is a shared utility used by all modules (Operations, Billing, Disbursement, etc.). However, the fix is in the shared component, so it will fix the bug everywhere. The fix is correct behavior (not a hack), so it won't break other modules.

---

## Bug 3: Missing Pagination — Only 32 of 192 Logs Visible + Clipping

**Symptom:** The audit log count badge says "192 entries" but only ~32 are visible. Content is clipped with no scroll or pagination controls.

**Root Cause (data fetch):** The frontend fetches all logs in a loop (`users.js:1500-1509`) with `pageSize = 100`. The while-loop should fetch all pages. But if `l.timestamp` is undefined (Bug 1), some filters may silently discard logs, OR the rendering is the bottleneck.

**Root Cause (rendering/clipping):** `JiraBacklogList.render()` in `utils.js:3286-3665` renders ALL items in a single flat list with no pagination controls. The `jira-backlog-container` likely has CSS `overflow: hidden` or a `max-height` that clips content beyond the visible area. There are **no** "Previous/Next" buttons, no page controls, and no infinite scroll.

**Files involved:**
- `erp_prototype/js/users.js` — lines 1654-1669 (render call, no pagination params)
- `erp_prototype/js/utils.js` — lines 3286-3665 (`JiraBacklogList.render()`, no pagination support)
- `erp_prototype/css/styles.css` — audit card / backlog container styles (overflow clipping)

**Fix plan:**
1. Add client-side pagination to `JiraBacklogList.render()` specifically for the audit log use case. Add optional `pagination` config:
   ```javascript
   JiraBacklogList.render({
     items,
     pagination: { pageSize: 20, currentPage: 1 },
     onPageChange: (page) => { ... }
   });
   ```
2. When pagination is enabled, slice items to the current page window before rendering rows
3. Add a pagination footer with "Previous / Next" buttons and page indicator (e.g., "Page 1 of 10")
4. In `refreshAuditLog()`, pass `pagination: { pageSize: 20 }` to the render call
5. Store current page in the component state so it persists across filter changes (reset to page 1 when filters change)
6. Fix any CSS `overflow: hidden` or `max-height` on the audit log container that causes clipping

**ATA & LTA views affected?** Yes — same rendering code. The pagination will work across all entity views.

---

## Bug 4: Remove "Client" Filter from Admin Audit Log Only

**Symptom:** The filter dropdown shows a "Client" category, which is not relevant for audit logs and should be removed from the admin page filter only.

**Root Cause:** The filter categories are hardcoded at `users.js:1446-1450` to include `client`:
```javascript
const categories = {
  user: { label: 'User', getOptions: getUserOptions },
  client: { label: 'Client', getOptions: getClientOptions },  // ← remove this
  date: { label: 'Date', hasDatePicker: true, getOptions: getDueDateOptions }
};
```

Additionally, the client filter logic at lines 1530-1535 is broken anyway (tries to call `.toLowerCase()` on a JSONB object — see Bug 6).

**Files involved:**
- `erp_prototype/js/users.js` — line 1448 (category definition), lines 1410-1413 (activeFilters init), lines 1428-1433 (save/restore), lines 1530-1535 (filter logic)

**Fix plan:**
1. Remove the `client` key from the `categories` object at line 1448
2. Remove `client: new Set()` from `activeFilters` at line 1412
3. Remove the `client` entry from `saveCurrentFilters()` at line 1431
4. Remove the client filter block at lines 1530-1535
5. Clean up the `getClientOptions` function definition at line 1437 (now unused in this context)

**ATA & LTA views affected?** No — this filter is only defined in the admin page's `renderAuditSection()`. Other modules have their own filter categories. This change is scoped exactly to the admin audit log.

---

## Bug 5: Audit Log Numbering (AUD-01 Should Be Oldest)

**Symptom:** The AUD-XX numbering does not correctly reflect chronological order — AUD-01 should be the oldest (first-ever) log entry.

**Root Cause:** The numbering logic at `users.js:1519-1523` sorts all logs chronologically to build a sequence map:
```javascript
const chronological = [...allLogs].sort((a, b) =>
  new Date(a.timestamp || a.created_at || 0) - new Date(b.timestamp || b.created_at || 0)
);
```
But `a.timestamp` and `a.created_at` are both undefined (API returns `createdAt`), so every log resolves to `new Date(0)` (Unix epoch). When all values are equal, the sort is unstable and arbitrary. This is the same root cause as Bug 1.

**Fix plan:**
1. This is automatically fixed by Bug 1's fix — once `_normalizeAuditLog()` is applied, `l.timestamp` will be populated correctly and the chronological sort will work.
2. Verify after Bug 1 fix that AUD-01 is indeed the oldest entry (earliest `created_at`).
3. Consider zero-padding to 3 digits (`padStart(3, '0')`) since there are already 192+ logs (AUD-001 through AUD-192 reads better than AUD-01 through AUD-192).

**ATA & LTA views affected?** Yes — same code path, same fix via Bug 1.

---

## Bug 6: [object Object] Display — Raw Code in Audit Log Rows

**Symptom:** Audit log entries display `[object Object]` as the row title text instead of readable details.

**Root Cause:** The `details` column in the database is `JSONB` type. The API returns it as a parsed JavaScript object (e.g., `{ email: "user@test.com", role: "Admin" }`). At `users.js:1643`:
```javascript
name: l.details || '—',
```
When `l.details` is a non-null object, it gets passed as `item.name` to `JiraBacklogList.render()`. The renderer at `utils.js:3540` does:
```javascript
const titleNode = el('div', { class: 'jira-backlog-row-title', text: item.name });
```
Setting `textContent` to a JavaScript object coerces it to `"[object Object]"`.

**Same bug in search filter** (`users.js:1564`):
```javascript
l.details || '',  // object joins as "[object Object]"
```

**Files involved:**
- `erp_prototype/js/users.js` — line 1643 (card name), line 1564 (search filter)

**Fix plan:**
1. At line 1643, serialize `l.details` into a human-readable string:
   ```javascript
   name: (typeof l.details === 'object' && l.details !== null)
     ? Object.entries(l.details).map(([k, v]) => `${k}: ${v}`).join(', ')
     : (l.details || '—'),
   ```
2. At line 1564, do the same for search:
   ```javascript
   (typeof l.details === 'object' ? JSON.stringify(l.details) : (l.details || '')),
   ```
3. Alternatively, create a shared helper `formatAuditDetails(details)` to keep it DRY.

**ATA & LTA views affected?** Yes — same rendering code, same fix.

---

## Implementation Order

The bugs have dependencies — fixing them in the right order avoids rework:

| Step | Bug | Reason |
|------|-----|--------|
| 1 | Bug 1 (Timestamps) | Root cause for Bugs 5, and partially for 3. Must be fixed first. |
| 2 | Bug 6 ([object Object]) | Independent fix, no dependencies. |
| 3 | Bug 4 (Remove Client filter) | Independent fix, removes dead code. |
| 4 | Bug 2 (Checkbox flicker) | Independent fix in shared util. |
| 5 | Bug 5 (Numbering) | Verify auto-fixed by Bug 1. Adjust padStart if needed. |
| 6 | Bug 3 (Pagination) | Largest change — add pagination UI to JiraBacklogList + fix clipping CSS. |

---

## Files to Modify

| File | Changes |
|------|---------|
| `erp_prototype/js/users.js` | Apply `_normalizeAuditLog()` to fetched data; remove client filter category and logic; serialize `l.details` for display and search; add pagination config to render call; possibly adjust padStart width |
| `erp_prototype/js/utils.js` | Fix checkbox event handling in `createJiraFilterToolbar()`; add pagination support to `JiraBacklogList.render()` |
| `erp_prototype/css/styles.css` | Fix overflow clipping on audit log container; add pagination control styles |

---

## Out of Scope

- ATA/LTA entity-specific audit log views outside the admin page
- Other modules' filter toolbars (the checkbox fix improves them as a side effect but is not targeted at them)
- Backend API changes (the API is working correctly; all issues are frontend)
- Audit log data migration or schema changes
- Any other admin page sections (Users tab, Pending Approvals tab)
