# TODO: Harden Creation Nav-Sync Against Mid-Round-Trip Re-Renders

**Date:** 2026-07-20  
**Branch:** `uat`  
**Status:** Primary regression fixes are in; these are follow-up hardening items.  
**No commits.** No Playwright. Verify with `node --check` and `cd backend && npm test`.

---

## 1. Background

After the regression-fix pass, creation/template flows now:
- insert the optimistic record before the API,
- render from the warm cache once,
- skip the next background fetch,
- replace the record in place when the server responds.

The remaining risk is that `_skipNextListFetch` is a boolean flag consumed on the **first** warm render. If anything calls `App.handleRoute()` again before the API response arrives, the flag is already false and the module re-fetches from the server, wiping the optimistic record and potentially re-rendering stale or empty state.

This TODO addresses three residual hardening items:

1. Replace the boolean `_skipNextListFetch` with a **generation / token** so a mutation's warm-render intent survives any number of `App.handleRoute()` calls until the API response arrives or the user explicitly refreshes / switches entity.
2. Add explicit `canDrag` / `onDrop` guards to board views so optimistic cards cannot be dragged and optimistic targets cannot be dropped on.
3. Document the intentional disbursement cache-stale behavior and the escape hatches (explicit refresh, entity switch).

---

## 2. Goal A: Generation-Based Skip Flag

### 2.1 Problem

Current pattern in most modules:

```js
// mutation
this._skipNextListFetch = true;
App.handleRoute();          // render #1 uses cache, clears flag
// ... API in flight ...
App.handleRoute();          // render #2 sees flag=false, re-fetches
// API returns, replaces optimistic record
```

Render #2 wipes the optimistic record.

### 2.2 Desired behavior

```js
// mutation
this._skipFetchGeneration = (this._skipFetchGeneration || 0) + 1;
const myGeneration = this._skipFetchGeneration;
App.handleRoute();          // render #1: generation matches, skip fetch
// ... API in flight ...
App.handleRoute();          // render #2: generation still matches, skip fetch
// API returns
this._skipFetchGeneration = null; // or leave until next mutation
App.handleRoute();          // now fetches fresh server state and replaces temp record
```

The renderer compares the current generation to the one it is supposed to skip; it only fetches when they differ.

### 2.3 Module-by-module plan

| Module | Current flag | Files to change |
|---|---|---|
| Workflow | `Workflow._skipNextListFetch` | `erp_prototype/js/workflow.js` |
| Billing | `Billing._skipNextListFetch` | `erp_prototype/js/billing.js` |
| Disbursement | `Disbursement._skipNextListFetch`, `Disbursement._skipNextTemplatesFetch` | `erp_prototype/js/disbursement.js` |
| Clients | `Clients._skipNextListFetch` | `erp_prototype/js/clients.js` |
| Transmittal | `Transmittal._skipNextListFetch` | `erp_prototype/js/transmittal.js` |
| Users | `Users._skipNextListFetch` | `erp_prototype/js/users.js` |

### 2.4 Recipe

1. Replace the boolean flag with two fields:
   ```js
   _skipFetchGeneration: 0,
   _activeSkipGeneration: 0, // generation currently honored by the renderer
   ```
2. On mutation, before `App.handleRoute()`:
   ```js
   this._skipFetchGeneration++;
   this._activeSkipGeneration = this._skipFetchGeneration;
   ```
3. In the renderer:
   ```js
   const shouldSkip = this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration;
   if (shouldSkip) {
     // render from cache
     // do NOT decrement/clear here
     return;
   }
   // fetch from server
   ```
4. After the API response arrives (success or failure), clear the active skip:
   ```js
   this._activeSkipGeneration = 0;
   App.handleRoute();
   ```
5. On explicit refresh or entity switch, also clear:
   ```js
   this._activeSkipGeneration = 0;
   ```

### 2.5 Edge cases

- **Multiple mutations in rapid succession:** Each mutation increments `_skipFetchGeneration` and sets `_activeSkipGeneration`. The renderer honors the latest generation. When the first API response returns, clearing `_activeSkipGeneration` must be done carefully — only clear if the current `_activeSkipGeneration` still matches the generation that just completed. If a newer mutation is in flight, leave `_activeSkipGeneration` alone.
  ```js
  const completedGeneration = this._activeSkipGeneration;
  apiCall().then(() => {
    if (this._activeSkipGeneration === completedGeneration) {
      this._activeSkipGeneration = 0;
    }
    App.handleRoute();
  });
  ```
- **Entity switch during a mutation:** `triggerSyncReload()` already invalidates caches. It should also reset `_skipFetchGeneration` and `_activeSkipGeneration`.

---

## 3. Goal B: Explicit Board Drag/Drop Guards

### 3.1 Problem

Optimistic cards in the Operations and Billing boards are mostly guarded against backend-bound actions, but the board library (`kanban.js`) may still allow them to be dragged. Dropping a card updates local order and can fire a backend update with a temp id, or move the optimistic card into a different column whose state does not exist on the server.

### 3.2 Desired behavior

- Optimistic cards cannot be dragged.
- Other cards cannot be dropped onto optimistic cards.
- The board visual feedback (cursor, opacity) reflects this.

### 3.3 Recipe

1. In the board card data object passed to `buildCompactBoardCard` / `renderKanbanBoard`, add a flag:
   ```js
   isOptimistic: this._isTempId(item.id)
   ```
2. In `kanban.js`, in the drag-start handler:
   ```js
   onDragStart: (item) => {
     if (item.isOptimistic) return false; // cancel drag
     return true;
   }
   ```
3. In the drop handler:
   ```js
   onDrop: (targetItem, droppedItem) => {
     if (targetItem.isOptimistic || droppedItem.isOptimistic) return false;
     // existing drop logic
   }
   ```
4. If the board library does not expose `onDragStart`/`onDrop` per item, add a CSS class to optimistic cards:
   ```js
   className: item.isOptimistic ? 'kanban-card-optimistic' : ''
   ```
   and add CSS:
   ```css
   .kanban-card-optimistic { pointer-events: none; opacity: 0.8; }
   ```
   This is less precise but stops drag/drop without library changes.

### 3.4 Modules to update

| Module | Board function | File |
|---|---|---|
| Workflow | `refreshBoard` | `erp_prototype/js/workflow.js` |
| Billing | `refreshBoard` | `erp_prototype/js/billing.js` |
| Disbursement | `renderBoardView` | `erp_prototype/js/disbursement.js` |

---

## 4. Goal C: Disbursement Cache-Stale Behavior

### 4.1 Current behavior

After creating a disbursement, `_skipNextListFetch` is sticky (following the regression fix), so the list renders from the warm cache. It will not auto-refresh until:
- the user switches entity,
- the user triggers an explicit refresh (if available),
- or the browser is reloaded.

### 4.2 Acceptance

This is intentional per the optimistic-cache recipe. However, it must be surfaced to the user so they do not think the data is stale.

### 4.3 UI guidance

Keep the existing cached-results indicator, or add one to disbursement list/board when rendering from cache:
```js
const isCached = this._activeSkipGeneration > 0;
if (isCached) {
  listContainer.appendChild(el('div', {
    class: 'disbursement-cached-indicator',
    style: 'text-align:center; padding:8px 0; font-size:12px; color:var(--color-text-muted);',
    text: 'Showing cached results — refresh or switch entity to fetch latest'
  }));
}
```

---

## 5. Implementation Order

1. **Generation-based skip flag** — highest impact. Start with one module, verify, then cascade.
   - Recommended pilot: Billing (simplest list renderer).
   - Then Workflow, Disbursement, Clients, Transmittal, Users.
2. **Board drag/drop guards** — while implementing generation flag in Workflow/Billing/Disbursement.
3. **Disbursement cached-results indicator** — small UI addition.
4. **Cross-cutting cleanup** — ensure `triggerSyncReload()` resets all skip generations.

---

## 6. Verification Checklist

- [ ] Create a billing invoice, then trigger two `App.handleRoute()` calls from the console before the API responds; the optimistic invoice remains visible and no server fetch occurs.
- [ ] After the API responds, the temp record is replaced by the server record.
- [ ] Try to drag an optimistic board card in Operations/Billing/Disbursement; it does not move.
- [ ] Try to drop a real card onto an optimistic card; it does not drop.
- [ ] Disbursement list shows a cached-results indicator after creation until explicit refresh.
- [ ] Entity switch clears the skip generation and fetches fresh data.
- [ ] `node --check` passes on every modified file.
- [ ] `cd backend && npm test` passes.

---

## 7. Notes for Implementing Agents

1. Preserve global-variable architecture.
2. No commits.
3. No Playwright.
4. Restart dev server and hard-refresh browser after JS changes.
5. If a module's renderer already uses `_listCacheGeneration`, be careful not to conflate it with `_skipFetchGeneration`. They serve different purposes (cache staleness vs. mutation warm-render intent).
