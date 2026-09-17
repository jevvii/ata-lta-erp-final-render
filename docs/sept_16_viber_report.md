# Sept 16 Viber Report - Issue & Ticket Log (Arranged by Difficulty & Status)

## Prioritized Matrix (Arranged from Lowest to Highest Difficulty)

| Rank | Type / Status | Difficulty | Ticket Name | Module / Area | Estimated Effort |
|:---:|:---:|:---:|---|---|:---:|
| 1 | 💡 **ENHANCEMENT** | 🟢 **Low** | `[ENHANCEMENT] Authentication / Login: Add show/hide password toggle (eye icon) on password input field` | Auth / Login | 15–30 mins |
| 2 | 💡 **ENHANCEMENT** | 🟢 **Low** | `[ENHANCEMENT] Work Requests: Add border outline/styling to Work Request title for improved visual distinction` | Work Requests / UI | 15–30 mins |
| 3 | 🔴 **BUG** | 🟢 **Low** | `[BUG] Work Request Creation: Duplicate Work Requests generated upon submission (missing debounce)` | Work Requests | 30–45 mins |
| 4 | 🔴 **BUG** | 🟡 **Medium** | `[BUG] Client List: Dropdown options missing for Point of Contact (POC) and Client Relationship (ATA & LTA)` | Client List / Profile | 45–60 mins |
| 5 | 🔴 **BUG** | 🟡 **Medium** | `[BUG] Billing / Sales Invoice: Invoice number is hardcoded/fixed to 001 and fails to auto-increment` | Billing / Invoicing | 1–2 hours |
| 6 | 💡 **ENHANCEMENT** | 🟡 **Medium** | `[ENHANCEMENT] Admin Audit Log: Enable clickable links on Item/Record to navigate to and review Work Requests` | Admin / Audit Log | 1–2 hours |
| 7 | 💡 **ENHANCEMENT** | 🟡 **Medium** | `[ENHANCEMENT] Pending Approvals: Add option to view full parent Work Request (WR) details` | Pending Approvals / WR | 1.5–2 hours |
| 8 | 🔴 **BUG** | 🟠 **Med-High** | `[BUG] Operations: Work Requests assigned by Admin to Manager are not visible in Manager's Operations view` | Operations / WR | 2–3 hours |
| 9 | 🔴 **BUG** | 🟠 **Med-High** | `[BUG] Dashboard: Work Requests panel and calendar display unassigned/other workers' Work Requests` | Dashboard / Schedule | 2–3 hours |
| 10 | 🔴 **BUG / ENH.** | 🔴 **High** | `[BUG/ENHANCEMENT] Cache / State: Implement automatic cache invalidation to eliminate requirement for continuous Ctrl+Shift+R hard refresh` | System Cache / State | 3–5+ hours |

---

## Grouped Summary by Status

### 🔴 Bugs (6 Tickets)
1. **Low:** `[BUG] Work Request Creation: Duplicate Work Requests generated upon submission`
2. **Medium:** `[BUG] Client List: Dropdown options missing for Point of Contact (POC) and Client Relationship (ATA & LTA)`
3. **Medium:** `[BUG] Billing / Sales Invoice: Invoice number is hardcoded/fixed to 001 and fails to auto-increment`
4. **Med-High:** `[BUG] Operations: Work Requests assigned by Admin to Manager are not visible in Manager's Operations view`
5. **Med-High:** `[BUG] Dashboard: Work Requests panel and calendar display unassigned/other workers' Work Requests`
6. **High:** `[BUG/ENHANCEMENT] Cache / State: Implement automatic cache invalidation to eliminate requirement for continuous Ctrl+Shift+R hard refresh`

### 💡 Enhancements (4 Tickets)
1. **Low:** `[ENHANCEMENT] Authentication / Login: Add show/hide password toggle (eye icon) on password input field`
2. **Low:** `[ENHANCEMENT] Work Requests: Add border outline/styling to Work Request title for improved visual distinction`
3. **Medium:** `[ENHANCEMENT] Admin Audit Log: Enable clickable links on Item/Record to navigate to and review Work Requests`
4. **Medium:** `[ENHANCEMENT] Pending Approvals: Add option to view full parent Work Request (WR) details`

---

# Detailed Ticket Specifications (Sorted by Difficulty)

---

### Ticket #1 (Rank 1) — 💡 ENHANCEMENT
**Ticket Name:** `[ENHANCEMENT] Authentication / Login: Add show/hide password toggle (eye icon) on password input field`
* **Status / Type:** 💡 **ENHANCEMENT** *(UX / Usability)*
* **Difficulty:** 🟢 **Low** (~15–30 mins — Frontend state toggle)
* **Module:** Authentication / Login
* **User Feedback:** *"adding a view password in the login like the eye visual"*
* **English Translation:** *"Add a show/hide password toggle (eye icon button) to the password input field on the login screen to allow users to verify their password before submitting."*
* **Description:** Add an interactive eye icon inside the password field to toggle the HTML input type between `"password"` and `"text"`.

---

### Ticket #2 (Rank 2) — 💡 ENHANCEMENT
**Ticket Name:** `[ENHANCEMENT] Work Requests: Add border outline/styling to Work Request title for improved visual distinction`
* **Status / Type:** 💡 **ENHANCEMENT** *(UI / Visual Polish)*
* **Difficulty:** 🟢 **Low** (~15–30 mins — Pure CSS / Tailwind adjustment)
* **Module:** Work Requests / Kanban Board
* **User Feedback:** *"enhancement to have a border for the work request title"*
* **English Translation:** *"Add a visible border/outline around the Work Request title (on cards and detail headers) to improve visual contrast and readability."*
* **Description:** Add a subtle border or container outline around the title on Work Request cards to improve contrast and visual hierarchy on dense Kanban boards.

---

### Ticket #3 (Rank 3) — 🔴 BUG
**Ticket Name:** `[BUG] Work Request Creation: Duplicate Work Requests generated upon submission`
* **Status / Type:** 🔴 **BUG** *(Data duplication / Lack of submit debounce)*
* **Difficulty:** 🟢 **Low** (~30–45 mins — Button state & debounce)
* **Module:** Work Requests / Create Work Request
* **Evidence:**  
  ![Duplicate Work Requests Created](/home/kyle/Test run/docs/images/ticket4_duplicate_wr.png)
* **User Feedback:** *"dalawa na generate nag create ako WR"*
* **English Translation:** *"Two duplicate entries were generated when I created a Work Request."*
* **Description:** Submitting a Work Request creates twin entries with consecutive IDs (`WR-3` and `WR-4`). The submit button must immediately disable and debounce upon submission to prevent multiple clicks and duplicate API calls.

---

### Ticket #4 (Rank 4) — 🔴 BUG
**Ticket Name:** `[BUG] Client List: Dropdown options missing for Point of Contact (POC) and Client Relationship (ATA & LTA)`
* **Status / Type:** 🔴 **BUG** *(Data binding / Missing API options)*
* **Difficulty:** 🟡 **Medium** (~45–60 mins — Query & data binding)
* **Module:** Client List / Client Profile
* **Evidence:**  
  ![Point of Contact & Relationship Dropdowns Missing](/home/kyle/Test run/docs/images/ticket1_poc_dropdown.png)
* **User Feedback:** *"@Deutz Cymar Galila error sa client list. Walang lumalabas sa drop down to select employee names for POC, and wala din if sa drop down other client names to establish a Relationship. For both ATA and LTA view ito"*
* **English Translation:** *"@Deutz Cymar Galila There is an error in the Client List. Nothing appears in the dropdown to select employee names for Point of Contact (POC), and there are also no options in the dropdown to select other client names to establish a Relationship. This issue occurs in both ATA and LTA views."*
* **Description:** Both the Point of Contact (employee names) and Relationship (client names) dropdowns fail to populate options in ATA and LTA views.

---

### Ticket #5 (Rank 5) — 🔴 BUG
**Ticket Name:** `[BUG] Billing / Sales Invoice: Invoice number is hardcoded/fixed to 001 and fails to auto-increment`
* **Status / Type:** 🔴 **BUG** *(Auto-increment sequence logic)*
* **Difficulty:** 🟡 **Medium** (~1–2 hours — Backend sequence generation)
* **Module:** Billing / Invoicing
* **Evidence:**  
  ![Fixed Invoice Number 001](/home/kyle/Test run/docs/images/ticket5_invoice_fixed_001.png)
* **User Feedback:** *"The invoice number is fixed to 1 and didnt generate another knowing the ticket number for that already exist."*
* **English Translation:** *"When creating a new Sales Invoice, the invoice number is fixed at '001' (e.g., ATA-SI-2026-001) instead of auto-generating the next incremental number, even though an invoice with number 001 already exists in the system."*
* **Description:** The Sales Invoice number field defaults to ending in `-001` and fails to query the database for the next sequential number, risking duplicate key collisions.

---

### Ticket #6 (Rank 6) — 💡 ENHANCEMENT
**Ticket Name:** `[ENHANCEMENT] Admin Audit Log: Enable clickable links on Item/Record to navigate to and review Work Requests`
* **Status / Type:** 💡 **ENHANCEMENT** *(Deep linking & navigation)*
* **Difficulty:** 🟡 **Medium** (~1–2 hours — Table routing / drawer trigger)
* **Module:** Admin / Audit Log
* **Evidence:**  
  ![Admin Audit Log Table](/home/kyle/Test run/docs/images/ticket3_audit_log.png)  
  ![User Feedback on Opening WR from Audit Log](/home/kyle/Test run/docs/images/ticket3_feedback.png)
* **User Feedback:** *"dito din di ba ma open to WR to review?"*
* **English Translation:** *"Can we also open the Work Request from here to review it?"*
* **Description:** Items under the `ITEM / RECORD` column in Audit Log are static text. Convert them into interactive links or drawer triggers so reviewers can directly inspect modified Work Requests, tasks, or invoices.

---

### Ticket #7 (Rank 7) — 💡 ENHANCEMENT
**Ticket Name:** `[ENHANCEMENT] Pending Approvals: Add option to view full parent Work Request (WR) details`
* **Status / Type:** 💡 **ENHANCEMENT** *(Contextual UX navigation)*
* **Difficulty:** 🟡 **Medium** (~1.5–2 hours — Modal/drawer integration)
* **Module:** Pending Approvals / Work Requests
* **Evidence:**  
  ![Pending Approvals List](/home/kyle/Test run/docs/images/ticket2_approvals_list.png)  
  ![User Feedback on Missing WR Option](/home/kyle/Test run/docs/images/ticket2_feedback.png)
* **User Feedback:** *"May option ba to open to the specific work request? Hirap kasi i-approve if di ko makita buong WR kung saan under itong task"*
* **English Translation:** *"Is there an option to open the specific Work Request? It is difficult to approve requests without being able to see the full Work Request that this task falls under."*
* **Description:** Approvers reviewing billing or transmittal requests cannot inspect the full parent Work Request context before approving. Add a clickable link or drawer preview.

---

### Ticket #8 (Rank 8) — 🔴 BUG
**Ticket Name:** `[BUG] Operations: Work Requests assigned by Admin to Manager are not visible in Manager's Operations view`
* **Status / Type:** 🔴 **BUG** *(Role assignment visibility & query filtering)*
* **Difficulty:** 🟠 **Med-High** (~2–3 hours — Scope & permission query adjustment)
* **Module:** Operations / Work Requests
* **User Feedback:** *"admin assigned a work request to manager then the manager cant see the admins work request in operations."*
* **English Translation:** *"When an Admin assigns a Work Request to a Manager, the Work Request does not appear and cannot be viewed in the Manager's Operations module."*
* **Description:** When an Admin assigns a Work Request to a Manager, it disappears from the Manager's Operations view because queries only check `createdBy == managerId` rather than `assignedTo == managerId`.

---

### Ticket #9 (Rank 9) — 🔴 BUG
**Ticket Name:** `[BUG] Dashboard: Work Requests panel and calendar display unassigned/other workers' Work Requests`
* **Status / Type:** 🔴 **BUG** *(Data leakage & access control bypass)*
* **Difficulty:** 🟠 **Med-High** (~2–3 hours — Multi-tenant / role-based filtering)
* **Module:** Dashboard / Schedule
* **Evidence:**  
  ![Dashboard Work Requests Filter Bypass](/home/kyle/Test run/docs/images/ticket6_dashboard_wr_bypass.png)
* **User Feedback:** *"The dashboard has work request panel, and it also bypass because it also shows the other work request that shouldnt be assign to that worker."*
* **English Translation:** *"On the user dashboard, the Work Requests panel and schedule bypass user assignment filters and display Work Requests that should not be assigned to that worker (showing items belonging to other team members)."*
* **Description:** The worker dashboard calendar and side panel show all firm Work Requests regardless of who is assigned, bypassing role restrictions and cluttering user views.

---

### Ticket #10 (Rank 10) — 🔴 BUG / 💡 ENHANCEMENT
**Ticket Name:** `[BUG/ENHANCEMENT] Cache / State: Implement automatic cache invalidation to eliminate requirement for continuous Ctrl+Shift+R hard refresh`
* **Status / Type:** 🔴 **BUG / 💡 ENHANCEMENT** *(System architecture & cache invalidation)*
* **Difficulty:** 🔴 **High** (~3–5+ hours — Broad cache audit, invalidation keys, HTTP headers)
* **Module:** System Cache / Frontend State / API
* **User Feedback:** *"continuous control shift r for refresh"*
* **English Translation:** *"Users are forced to continuously perform a hard refresh (Ctrl + Shift + R) to view updated data and UI changes. Implement proper cache invalidation, cache-control headers, and reactive data revalidation so the application automatically reflects latest updates."*
* **Description:** Users are forced to constantly hard refresh to see new updates. Requires auditing mutation invalidations, setting proper Cache-Control headers, and configuring revalidation triggers on window focus.
