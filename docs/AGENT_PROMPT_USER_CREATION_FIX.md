# Agent Prompt: Admin User Creation "Unable to retrieve user" Bug Fix

**Copy-paste this entire prompt to the next Claude Code session.**

---

Read the plan at `docs/TODO_ADMIN_USER_CREATION_BUG.md` — it contains the full investigation of the "Unable to retrieve user" bug when creating a new user in Admin → Users. Implement both fixes. Do not commit or push.

## Constraints

- **Scope:** Only modify files for the admin page → user creation flow. Do not touch audit log, pending approvals, or other modules.
- **No commits, no pushes.** Leave changes unstaged.
- **No Playwright login.** Do not attempt to open a browser or log in.
- **Follow the plan exactly.** The plan has exact line numbers, root causes, and fix code. Read the relevant source files to confirm line numbers haven't shifted before editing.

## Implementation Steps (in order)

### Step 1 — Fix the create-vs-update branch condition (PRIMARY BUG)

In `erp_prototype/js/users.js`, find the `submitUserForm` method. Locate the branching condition (around line 1310):

```javascript
if (this.editingId) {
```

Change it to:

```javascript
if (this.editingId && this.editingId !== 'new') {
```

**Why this works:** When adding a new user, `showUserForm(null)` sets `this.editingId = userId || 'new'` (line 1182). The string `'new'` is truthy, so the original condition `if (this.editingId)` incorrectly enters the update path (which calls `PUT /admin/users/new` — an invalid UUID that triggers the "Unable to retrieve user" error from PostgREST). With the fix, `editingId === 'new'` falls through to the `else` block (the create path) which correctly calls `POST /admin/users`.

### Step 2 — Add password field to createUserSchema (SECONDARY BUG)

In `backend/src/modules/admin/schema.js`, find the `createUserSchema` definition (around lines 10-17). Add a `password` field:

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

**Why this is needed:** Without `password` in the schema, Zod strips it from the validated payload. The service at `service.js:148` then falls back to the hardcoded default `'ChangeMe123!'`, ignoring whatever password the admin typed in the form. Making it `optional()` preserves backward compatibility — if no password is sent, the existing fallback still works.

## Verification Checklist

After both changes:
- [ ] The condition at the branch point reads `if (this.editingId && this.editingId !== 'new')`
- [ ] The `createUserSchema` includes `password: z.string().min(1).optional()`
- [ ] No other lines in `submitUserForm` were changed
- [ ] No other schemas were modified
- [ ] The edit user flow is unaffected (when `editingId` is a real UUID, the update branch still fires correctly)
- [ ] No changes to any other files, modules, or tabs
