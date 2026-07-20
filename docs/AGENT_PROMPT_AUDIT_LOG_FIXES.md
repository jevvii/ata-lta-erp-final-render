# Agent Prompt: Admin Audit Log Bug Fixes

**Copy-paste this entire prompt to the next Claude Code session.**

---

Read the plan at `docs/TODO_ADMIN_AUDIT_LOG_BUGS.md` — it contains the full investigation of 6 bugs in the admin page audit logs. Implement all 6 fixes in the order specified. Do not commit or push.

## Constraints

- **Scope:** Only modify files for the admin page → audit logs. Do not touch other modules, backend code, or non-audit sections.
- **No commits, no pushes.** Leave changes unstaged.
- **No Playwright login.** Do not attempt to open a browser or log in.
- **Follow the plan exactly.** The plan has exact line numbers, root causes, and fix code. Read the relevant source files to confirm line numbers haven't shifted before editing.

## Implementation Steps (in order)

### Step 1 — Bug 1: Fix timestamps (root cause for Bugs 3, 5)
In `erp_prototype/js/users.js`, in `refreshAuditLog()`, at the line `const page = res?.data || [];` (around line 1505), change it to:
```javascript
const page = (res?.data || []).map(r => this._normalizeAuditLog(r));
```
This maps `createdAt` → `timestamp` using the existing `_normalizeAuditLog()` at line 78. Fixes timestamps, sorting, date filtering, and numbering all at once.

### Step 2 — Bug 6: Fix [object Object] display
In `erp_prototype/js/users.js`, in the `items = logs.map(...)` block:
1. At the `name:` line (around line 1643), replace `l.details || '—'` with a serializer that handles JSONB objects — use `Object.entries(l.details).map(([k, v]) => \`${k}: ${v}\`).join(', ')` when `typeof l.details === 'object' && l.details !== null`, otherwise fall back to `l.details || '—'`.
2. In the search filter (around line 1564), replace `l.details || ''` with `typeof l.details === 'object' ? JSON.stringify(l.details) : (l.details || '')`.

### Step 3 — Bug 4: Remove Client filter (admin audit log only)
In `erp_prototype/js/users.js`, in `renderAuditSection()`:
1. Remove `client: new Set()` from the `activeFilters` object (around line 1412)
2. Remove the `client: { label: 'Client', getOptions: getClientOptions }` line from `categories` (around line 1448)
3. Remove the `client` entry from `saveCurrentFilters()` (around line 1431)
4. Remove the `if (savedFilters.client)` restore line (around line 1424)
5. Remove the entire client filter block in `refreshAuditLog()` (the `if (activeFilters.client.size > 0)` block, around lines 1530-1535)
6. Remove the `getClientOptions` function definition (around line 1437)

### Step 4 — Bug 2: Fix checkbox toggle flicker
In `erp_prototype/js/utils.js`, in `createJiraFilterToolbar()` → `renderFilterValues()`, find the checkbox event handler setup (around lines 2333-2349). Replace the checkbox's `click → e.stopPropagation()` with `click → e.preventDefault()`. In the row's click handler, after toggling catSet, explicitly set `checkbox.checked = catSet.has(opt.value)` before calling `updateFilterUI()`. This is in the shared filter component so it fixes the issue system-wide (which is correct behavior, not a scope violation).

### Step 5 — Bug 5: Verify numbering + adjust padStart
After Bug 1 fix, the `chronological` sort at line 1519 will work correctly since `l.timestamp` is now populated. Change `padStart(2, '0')` to `padStart(3, '0')` at line 1642 since there are 192+ logs — `AUD-001` reads better than `AUD-01`.

### Step 6 — Bug 3: Add pagination to audit log
This is the largest change:
1. In `erp_prototype/js/utils.js`, add optional pagination support to `JiraBacklogList.render()`:
   - Accept `pagination: { pageSize, currentPage }` and `onPageChange` callback in options
   - When pagination is provided, slice items to the current page window before rendering rows
   - Add a pagination footer after the list body with Previous/Next buttons and "Page X of Y" indicator
   - The count badge in the header should still show total items count
2. In `erp_prototype/js/users.js`, in `refreshAuditLog()`:
   - Track `currentPage` state (start at 1, reset to 1 when filters/sort change)
   - Pass `pagination: { pageSize: 20, currentPage }` and an `onPageChange` callback to `JiraBacklogList.render()`
   - The `onPageChange` callback should update `currentPage` and re-render just the list
3. In `erp_prototype/css/styles.css`:
   - Check for `overflow: hidden` or `max-height` on `.jira-backlog-container` or its parents that causes clipping — remove or adjust as needed
   - Add styles for the pagination footer (flex row, centered, matching the existing design system)

## Verification Checklist
After all changes:
- [ ] `l.timestamp` is populated on every audit log row (Bug 1)
- [ ] Timestamps display correctly as "Jul 20, 2026 02:30 PM" format (Bug 1)
- [ ] Sorting by "Newest first" and "Oldest first" produces correct order (Bug 1)
- [ ] Date filter options work (Bug 1)
- [ ] Date picker in filter works (Bug 1)
- [ ] `[object Object]` no longer appears — details show as "key: value, key: value" (Bug 6)
- [ ] Search works against details content (Bug 6)
- [ ] No "Client" category in the filter dropdown on the admin audit log page (Bug 4)
- [ ] Checkboxes in filter toggle cleanly on single click (Bug 2)
- [ ] Unchecking works on single click without the check reappearing (Bug 2)
- [ ] AUD-001 is the oldest log entry, AUD-192 is the newest (Bug 5)
- [ ] Pagination controls (Previous/Next) appear below the audit log list (Bug 3)
- [ ] Page size is 20 items per page (Bug 3)
- [ ] All 192 entries are accessible by paging through (Bug 3)
- [ ] No content clipping (Bug 3)
- [ ] No changes to backend code
- [ ] No changes to other admin tabs (Users, Pending Approvals)
- [ ] No changes to other modules' filter toolbars beyond the checkbox fix (which is a correct behavior fix)
