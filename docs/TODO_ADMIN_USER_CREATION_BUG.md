# Admin Page - User Creation "Unable to retrieve user" Bug Fix Plan

**Date:** 2026-07-21
**Scope:** Admin Page → Users tab — "Save User" (create new user) flow only
**Status:** Investigation complete, pending implementation

---

## Summary

When an admin fills out the "Add User" form and clicks "Save User", a dialog appears with the error **"Unable to retrieve user"**. The user is never created. The root cause is a branching bug in the frontend form submission logic that routes new user creation into the update path.

---

## Bug: `editingId = 'new'` Causes Create to Take the Update Path

### Symptom
Clicking "Save User" on a new user form always shows "Unable to retrieve user" error. The user is not created.

### Root Cause

**The primary bug is in `erp_prototype/js/users.js`, line 1310.**

The call chain:

1. **`showUserForm(null)`** (line 1181-1202) — Called when clicking "+ Add User". Since `userId` is null/undefined, line 1182 sets:
   ```javascript
   this.editingId = userId || 'new';  // → 'new'
   ```

2. **`submitUserForm(form)`** (line 1224) — Called on form submit. At line 1310:
   ```javascript
   if (this.editingId) {  // 'new' is truthy → enters UPDATE branch
   ```
   Since `'new'` is a truthy string, the code enters the **update** branch (lines 1310-1336) instead of the **create** branch (lines 1337-1378).

3. **Update path executes** — Line 1317 calls:
   ```javascript
   await window.apiClient.admin.updateUser(this.editingId, record);
   // → PUT /admin/users/new
   ```

4. **Backend receives `PUT /admin/users/new`** — The controller calls `adminService.updateUser({ id: 'new', ... })`, which calls `getUserById('new')` at `service.js:208`.

5. **`getUserById('new')` fails** — At `service.js:194`:
   ```javascript
   supabaseAdmin.from('users').select('*').eq('id', 'new').maybeSingle()
   ```
   The `id` column is type `uuid`. Passing `'new'` (not a valid UUID) causes PostgREST to return an error: `invalid input syntax for type uuid: "new"`. This triggers the `AppError` at line 196-200 with `detail: 'Unable to retrieve user'`.

6. **Error propagates to frontend** — `apiClient.js:115` throws `new Error(body.detail)` → caught at `users.js:1328-1332` → displayed via `Workflow.showMessage('Save User', e.message, 'error')`.

### Files Involved

| File | Lines | Role |
|------|-------|------|
| `erp_prototype/js/users.js` | 1182 | Sets `editingId = 'new'` (truthy) |
| `erp_prototype/js/users.js` | 1310 | `if (this.editingId)` — branches on truthiness, not on "is this an edit vs create" |
| `erp_prototype/js/users.js` | 1317 | Calls `updateUser('new', record)` — wrong API |
| `backend/src/modules/admin/service.js` | 194 | `getUserById('new')` → PostgREST error on invalid UUID |
| `backend/src/modules/admin/service.js` | 196-200 | Throws "Unable to retrieve user" |

### Fix

Change the condition at `users.js:1310` from:
```javascript
if (this.editingId) {
```
to:
```javascript
if (this.editingId && this.editingId !== 'new') {
```

This ensures that when `editingId` is `'new'`, the code falls through to the `else` branch (line 1337) which correctly calls `window.apiClient.admin.createUser(record)`.

---

## Secondary Bug: Password Field Stripped by Zod Validation

### Symptom
Even after fixing the primary bug, the password that the admin types in the form will be silently ignored. Every new user will be created with the hardcoded default password `'ChangeMe123!'`.

### Root Cause

The `createUserSchema` in `backend/src/modules/admin/schema.js:10-17` does NOT include a `password` field:

```javascript
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(['Admin', 'Manager', 'Accounting', 'Operations', 'Documentation']),
  departments: z.array(z.enum(ALLOWED_DEPARTMENTS)).optional(),
  entities: z.array(z.enum(['ATA', 'LTA'])).min(1),
  isActive: z.boolean().default(true),
});
```

Zod's `safeParse` uses **strict mode by default in the `parse` output** — `result.data` only contains fields defined in the schema. The `password` field sent from the frontend is stripped.

Then in `service.js:148`:
```javascript
const password = data.password || 'ChangeMe123!';
```

Since `data.password` is `undefined` (stripped by Zod), it always falls back to `'ChangeMe123!'`.

### Fix

Add `password` to the `createUserSchema` in `backend/src/modules/admin/schema.js`:

```javascript
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(['Admin', 'Manager', 'Accounting', 'Operations', 'Documentation']),
  departments: z.array(z.enum(ALLOWED_DEPARTMENTS)).optional(),
  entities: z.array(z.enum(['ATA', 'LTA'])).min(1),
  isActive: z.boolean().default(true),
  password: z.string().min(1).optional(),
});
```

Making it `optional()` keeps the existing default-password fallback working for any callers that don't send a password, while allowing the frontend-provided password to pass through when present.

---

## Implementation Order

| Step | What | File |
|------|------|------|
| 1 | Fix the create-vs-update branch condition | `erp_prototype/js/users.js:1310` |
| 2 | Add `password` to `createUserSchema` | `backend/src/modules/admin/schema.js:10-17` |

---

## Files to Modify

| File | Change |
|------|--------|
| `erp_prototype/js/users.js` | Line 1310: change `if (this.editingId)` to `if (this.editingId && this.editingId !== 'new')` |
| `backend/src/modules/admin/schema.js` | Add `password: z.string().min(1).optional()` to `createUserSchema` |

---

## Out of Scope

- Edit user flow (already works because `editingId` is a real UUID)
- Delete user flow
- User form UI layout or styling
- Audit log tab issues (covered in separate plan `TODO_ADMIN_AUDIT_LOG_BUGS.md`)
- Pending Approvals tab
- Any other modules or pages
