---
id: 00-INDEX
program: enterprise-migration
phase: meta
status: active
version: 1.0
date: 2026-10-03
---

# Enterprise Migration Program — Master Index & Agent Doctrine

**Master alignment doc (humans):** Obsidian vault → `Knowledge/Projects/ATA-LTA/Enterprise-Migration-Architecture-Specification.md` (ALIGNED v2.0).
> **Phase 0 Status:** Phase 0 frozen at contract 2.0.0 on 2026-10-04 (P0-H exit gate passed).
**This directory:** the executable spec set for implementer agents. One file = one work parcel.

---

## 1. Program Scope (Locked)

SPA-only migration. Frontend → React 19 + TypeScript + Vite + Tailwind + Shadcn. Backend → **Express retained** (NestJS/Drizzle deferred). Supabase DB/Storage untouched logically. Render hosting unchanged; $0 throughout; `erp.ltabmcorp.com` flips to the React build in one rehearsed atomic window.

## 2. Frozen Decisions — Do Not Reopen

Any agent who believes one of these is wrong must **stop and ask the user**. Do not improvise deviations.

| # | Decision |
| :-: | :--- |
| D1 | Decoupled SPA + API. No SSR. No Next.js. |
| D2/D3 | Express backend retained. No NestJS/Drizzle work. |
| D4 | Phase-0 backend first; vanilla frontend feature-frozen; React module builds gated on frozen contracts (P0-H). |
| D5 | No hotfix wave. WR-creation bugs fold into P0-D. Production carries the outage. |
| D6 | Legacy data promoted by backfill mapping (see P0-C §4). No dual-run. No force-archive. |
| D7 | QA = per-task Admin compliance review (`tasks.qa_status`). |
| D8 | RBAC = permission-key matrix; departments/entities = data scoping only. |
| D9 | Notifications in-app only (4 triggers). Time log duration-canonical. No v2 API service. Atomic cutover. |

## 3. Parcel Dependency Graph

```
P0-A (permissions) ──┬─► P0-B (notifications) ──┐
                     ├─► P0-C (migrations) ────┬─► P0-D (operations rework)
                     │                         │      ├─► P0-E (retainers)
                     │                         └─► P0-F (time entries)
                     └─► P0-G (disb/billing) ───┴─► P0-H (contract freeze)

P1 (React scaffold) starts immediately, parallel, zero dependency on P0.
P2 (module migrations) gated per-module on P0-H contract freeze.
P3 (cutover) gated on P2 completion + staging rehearsal.
```

## 4. Status Tracker (orchestrator updates after each parcel completes)

> **Phase 0 Status:** Phase 0 frozen at contract 2.0.0 on 2026-10-04. All backend contracts under `docs/api-contracts/modules/` version-stamped @2.0.0.

| Parcel | Title | Depends On | Status |
| :-: | :--- | :--- | :-: |
| P0-A | Permission-Key Manifest | — | ✅ merged (staging @8a01755; feat/p0-a-permission-keys) |
| P0-B | Notifications Module | P0-A | ✅ merged (staging @571d585; feat/p0-b-notifications, shim-free) |
| P0-C | Phase Migrations + Backfill | P0-A | ✅ merged (staging @6f973a5; feat/p0-c-phase-migrations, 000054 env-gated) |
| P0-D | Operations Phase-Routing Rework | P0-A, P0-B, P0-C | ✅ merged (staging @6a7887b; feat/p0-d-phase-routing) |
| P0-E | Retainer Templates + Recurrence | P0-A, P0-D | ✅ merged (staging @d8a3202; feat/p0-e-retainer-templates) |
| P0-F | Time Entries Module | P0-C | ✅ merged (staging @b32bec6; feat/p0-f-time-entries) |
| P0-G | Disbursement/Billing Permission Changes | P0-A | ✅ merged (staging @0d845dd; feat/p0-g-financial-permissions, manifest-resolved) |
| P0-H | Contract Freeze | all P0 | ✅ done (feat/p0-h-contract-freeze) |
| P1 | React Scaffold + Design System | none (parallel) | ✅ done (feat/p1-react-scaffold) |
| P2.1 | Module #1: Operations | P1 + P0-H | ✅ merged (PR #147; feat/p2-operations) |
| P2.2 | Module #2: Dashboard widgets | P2.1 | ✅ done (feat/p2-dashboard-widgets) |
| P2.3 | Module #3: Billing | P2.2 | ✅ done (feat/p2-billing) |
| P2.4 | Module #4: Disbursements | P2.3 | ✅ done (PR #148; feat/p2-disbursements) |
| P2.5 | Module #5: Transmittals | P2.4 | ✅ done (PR #149; feat/p2-transmittals) |
| P2.6 | Module #6: Admin/Users & Retainer Templates | P2.5 | ✅ done (feat/p2-admin-users) |
| P2.7 | Module #7: Reports & Documents (DMS) | P2.6 | ✅ done (feat/p2-reports-dms) |
| P2.8 | Module #8: Clients | P2.7 | ✅ done (feat/p2-clients) |
| P3 | Cutover Runbook | P2 | ☐ pending |

## 5. Working Rules for Every Agent

1. **Branch discipline:** branch off `staging` named `feat/<parcel-id>-<slug>`. PR targets `staging`. **Never** touch `main`. Never push without explicit user instruction. Never self-merge.
2. **TDD:** write/extend Jest + Supertest tests alongside code; `npm test` (backend) must stay green. New behavior requires new tests, named per spec §6.
3. **Lint/format:** `npm run lint` and Prettier clean before PR.
4. **Vanilla freeze:** do not modify `erp_prototype/` unless the parcel explicitly says so. Bugfix-only exceptions require user approval first.
5. **Contract duty:** any endpoint or payload you create/change → update `docs/api-contracts/` in the same PR (P0-H audits this).
6. **Superset constraint discipline (P0-C era):** during the transition window, DB CHECK constraints keep legacy values valid. Never write a migration that breaks the currently-deployed API build.
7. **Commit attribution:** end every commit message with `Co-Authored-By: Claude Code <noreply@anthropic.com>`.
8. **Uncertainty = stop:** ambiguous spec → comment in PR description and ask the user. Never guess on business rules.
9. **On completion:** flip your parcel's Status cell above to `✅ done (PR #…)` inside the PR.

## 6. Spec Grammar (every parcel file follows this skeleton)

0. YAML frontmatter: `id, phase, depends_on, touches, status`
1. **Mission** — one paragraph; what done looks like.
2. **Ground Truth** — verified current state with `file:line` citations. Trust it; verify only if code drifted.
3. **Contract** — exact DDL / endpoints / payloads this parcel freezes.
4. **Rules** — numbered R1…Rn, each independently testable.
5. **Acceptance Criteria** — binary checklist, each AC citing its rules.
6. **Tests Required** — named test cases (file + description).
7. **Explicit Non-Goals** — what this parcel must NOT do.
8. **Working Constraints** — parcel-specific deltas to §5.
9. **Handoff** — artifacts this parcel produces for downstream parcels.
10. **References** — vault doc, related memories, related specs.
