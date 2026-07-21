# Cancelled Work Request Archive Visibility Fix

**Date:** 2026-07-21  
**Branch:** uat  
**File:** `erp_prototype/js/workflow.js` (`renderArchive`)

## Problem

Cancelling a work request (status `Cancelled`, `archived: true) successfully removed it from the active list and updated the Operations tab nav archive count, but the cancelled work request did not appear in the Archive page's **Cancelled** category.

## Root Cause

`renderArchive()` built its visibility filter with `Auth.canViewWr(wr)`, which only looks at `wr.tasks`. The tab nav count, however, uses `Auth.canViewWrWithTasks(wr, taskMap)`, which consults a pre-built map of all tasks. This created two failure modes:

1. **Inconsistent visibility rules** — a work request could satisfy tab-nav visibility but be filtered out of the archive list because `wr.tasks` was empty or stale.
2. **Server/local merge mismatch** — the `cancelled` category iterated both server-fetched archived rows and the local cache, but it filtered on the raw server row (`wr`) while the merged local state (`cached || wr`) was what actually carried the cancelled/archived flags and the latest tasks.

## Fix

In `Workflow.renderArchive()`:

1. Build a `taskMap` from `this._tempTaskMap` (already populated by `render()`) or `buildTaskMap()`.
2. Merge any tasks returned by the server `archived=true` fetch into that map so server-only archived rows remain visible to staff users. The merge also falls back to server tasks when the local entry is an empty array, preventing an empty local task list from blocking visibility.
3. Replace `Auth.canViewWr(wr)` with `Auth.canViewWrWithTasks(wr, taskMap)`.
4. Apply the filter to the merged `state` (`cached || wr`) instead of the raw server row.
5. Store the merged `state` in the cancelled map so the rendered item reflects the current local data.

This aligns archive-page visibility with tab-nav counting and ensures a just-cancelled work request is rendered immediately from the local cache, even while the optimistic skip generation is active.

## Verification Steps

1. Open Operations → Work Requests.
2. Cancel a non-terminal work request.
3. Confirm the active list decrements, the archive tab count increments, and the cancelled row appears under Operations → Archive → Cancelled.
4. Refresh the page and confirm the cancelled row still appears in the Cancelled category (requires backend `archived=true` persistence, already in place).
5. Restore the cancelled work request to Draft and confirm it leaves the Cancelled category and returns to the active list.

## Related

- [[archive-flow-immediate-feedback-root-cause]] — prior archive/cancel optimistic-update fixes
- [[archive-pattern-final-parity-2026-07-21]] — recent restored-WR parity work that exposed this regression
