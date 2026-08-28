# PROJECT SIGN-OFF & CLIENT ACCEPTANCE DOCUMENT
**ENTERPRISE SOFTWARE ACCEPTANCE & TECHNICAL HANDOVER CERTIFICATE**

---

| **Document Reference** | `MICROAXIS-ATALTA-PSD-2026-001` |
|:---|:---|
| **Project Title** | Custom Web-Based Enterprise Resource Planning (ERP) System |
| **Client Organization** | **ATA & LTA ACCOUNTING FIRM** (Dual-Entity Accounting Practice) |
| **Service Provider** | **MICROAXIS** |
| **Contract Reference** | Software Development Agreement dated May 27, 2026 |
| **Total Contract Value** | **PHP 50,000.00** (VAT Exclusive) |
| **Payment Status** | **100% FULLY SETTLED & RECEIVED** (PHP 50,000.00 Paid in Full) |
| **Acceptance / Effective Date**| August 28, 2026 |
| **Warranty / Support Period** | Three (3) Months Free Maintenance (Aug 28, 2026 – Nov 28, 2026) |
| **Document Version** | Version 1.2 (Asset Turnover Options & Client Decision Matrix Added) |

---

## 1. EXECUTIVE SUMMARY & PURPOSE

This **Project Sign-Off & Client Acceptance Document** serves as the formal certificate of project completion, technical handover verification, and contractual acceptance between **MICROAXIS** (the "Provider") and **ATA & LTA ACCOUNTING FIRM** (the "Client").

Pursuant to the **Software Development Agreement** executed on **May 27, 2026**, MICROAXIS was engaged to design, develop, test, deploy, onboard, and support a comprehensive, web-based Enterprise Resource Planning (ERP) System specifically customized for the dual-entity operations of ATA & LTA Accounting Firm.

By signing this document, both Parties formally certify that:
1. All agreed functional modules, workflows, user interfaces, database architectures, and reporting engines have been delivered, verified, and accepted in accordance with the project scope and the *ERP Feedback V1* specifications.
2. User Acceptance Testing (UAT), administrative orientation, and operational training sessions have been successfully completed across all firm tiers (Admins, Managers, and Staff).
3. The agreed project investment of **PHP 50,000.00 (VAT Exclusive) has been 100% fully settled and received in full by the Provider**.
4. The Three (3) Months Free Consultation and Maintenance Support period is officially activated effective August 28, 2026 until November 28, 2026.
5. The technical transfer of hosting accounts and repositories is outlined as an open-ended selection item in Section 7, enabling the Client to determine their preferred transfer strategy independently.

---

## 2. PROJECT IDENTIFICATION & STAKEHOLDERS

### 2.1 Service Provider Information
* **Company Name:** MICROAXIS
* **Authorized Representative:** Mr. Mark Anthony C. Ureta
* **Position:** Project Manager
* **Business Address:** Meycauayan, Bulacan, Philippines
* **Email Address:** simplekramateru14@gmail.com
* **Contact Number:** +63 916 314 3623

### 2.2 Client Information
* **Organization Name:** ATA & LTA ACCOUNTING FIRM
* **Operating Entities:** 
  1. **ATA Entity** (Audit, Tax Advisory, and Accounting Operations)
  2. **LTA Entity** (Legal Tax Advisory, Compliance, and Special Permits)
* **Authorized Representatives:** Managing Partners / Authorized Operational Directors
* **Principal Address:** Metro Manila, Philippines
* **Designated Project Leads:** Admin Partner, Operations Lead, Accounting Lead, Documentation Officer

---

## 3. SCOPE RECONCILIATION & DELIVERABLES VERIFICATION MATRIX

Every module defined in Section 2 of the Software Development Agreement has been mapped against the implemented system, tested in the staging/UAT environments, and validated for operational readiness.

| # | Contract Module | Delivered Functional Scope & Implementation Details | Contract Status | Verification Method |
|:---|:---|:---|:---:|:---:|
| **A** | **Authentication & Role-Based Access Control (RBAC)** | • Supabase JWT authentication with secure session state.<br>• Granular 5-tier role enforcement: `Admin`, `Manager`, `Staff: Operations`, `Staff: Accounting`, `Staff: Documentation`.<br>• Dual-entity scoping: locked single-entity views for specialized staff (`ATA` or `LTA`) and dynamic multi-entity switching for `Admin`, `Manager`, and `Docs`.<br>• Immutable system audit logging for sensitive actions. | **DELIVERED & ACCEPTED** | Automated Tests + UAT Security Audit |
| **B** | **Executive & Operational Dashboards** | • Dual dashboard modes: **Consolidated Firm Overview** (firm-wide KPIs, SVG trend analytics) and **Scoped Entity Dashboard** (active-entity operational focus).<br>• Real-time widgets for upcoming disbursements, weekly due work requests, pending managerial/admin approvals, and employee task load monitoring. | **DELIVERED & ACCEPTED** | UAT Workflow Verification |
| **C** | **Client & Taxpayer Management** | • Centralized taxpayer registry with TIN, RDO, trade name, and business structure tracking.<br>• Contact directory with multiple points of contact per client.<br>• Related companies relationship graph.<br>• Retainer fee configurations and billing linkage.<br>• Full client archival and restore lifecycle. | **DELIVERED & ACCEPTED** | Data Migration & CRUD Testing |
| **D** | **Operations Module (Work Requests & Tasks)** | • Multi-view operational management: **Kanban Board**, **Table View**, and **List View**.<br>• 3-tier priority categorization (`Urgent`, `Priority`, `Low Priority`).<br>• Dynamic task breakdown with sub-task checklists, dependencies, and period year tracking.<br>• Precise from-to time logging per staff member and checklist item.<br>• Ground worker assignments and task-specific document attachments.<br>• Bi-directional linking to Billing Invoices and Disbursement Vouchers. | **DELIVERED & ACCEPTED** | End-to-End Operational Walkthrough |
| **E** | **Original Document & Transmittal Tracking** | • Physical document custody and lifecycle management.<br>• Tracking types: Client Pickup, Courier Delivery, Direct Transfer, Government Submission.<br>• Status workflow: `Draft` → `Approved` → `Sent` → `Received` with board order sorting.<br>• Document scanning/safekeeping logs and release acknowledgement records. | **DELIVERED & ACCEPTED** | Transmittal Flow Simulation |
| **F** | **Billing & Invoicing Module** | • Professional Sales Invoice generation and billing voucher creation.<br>• Client-ready PDF export functionality.<br>• Recurring billing templates for monthly retainer clients.<br>• Collection monitoring with multi-status tracking (`Draft`, `Pending Approval`, `Released`, `Partially Paid`, `Paid`).<br>• Payment recording with official receipt reference and audit accountability. | **DELIVERED & ACCEPTED** | Financial Reconciliation & PDF Verification |
| **G** | **Disbursement & Expense Module** | • Multi-tiered expense filing, reimbursement tracking, and petty cash releases.<br>• Role-gated approval pipeline (Admin/Accounting approvals; self-approval strictly blocked).<br>• Disbursement voucher generation and recurring expense templates.<br>• Receipt upload attachment to Supabase Storage.<br>• Status tracking: `Draft` → `Pending Approval` → `Approved` → `Funded` → `Released`. | **DELIVERED & ACCEPTED** | Expense Cycle & Security Testing |
| **H** | **Document Management System (DMS)** | • Secure cloud document repository hosted on Supabase Storage.<br>• Categorized by entity (`ATA`, `LTA`, `Consolidated`), client, and department.<br>• Version control and administrative document comments/validation.<br>• Pre-signed secure URLs for upload/download (zero file streaming bottleneck on API).<br>• Strict RBAC preventing cross-entity unauthorized access. | **DELIVERED & ACCEPTED** | File Upload/Download & RLS Audit |
| **I** | **Reports & Operational Analytics** | • Modern Bento-Grid analytical reporting interface.<br>• Employee productivity and time-log utilization reports.<br>• Daily, weekly, and monthly operational summaries.<br>• P&L snapshots, billing vs. collection efficiency analytics.<br>• Due date distribution and pending workload analysis. | **DELIVERED & ACCEPTED** | Reporting Data Consistency Check |
| **J** | **Administrative Portal & Governance** | • Comprehensive user management: create, edit, deactivate user accounts, and assign entity/department roles.<br>• System-wide audit log viewer with filtering by actor, entity, date, and action.<br>• Pending changes governance pipeline: Admin review and approval/rejection for operational and financial edits. | **DELIVERED & ACCEPTED** | Admin Governance Walkthrough |
| **K** | **Deployment, CI/CD & Cloud Infrastructure** | • Monorepo deployment topology: Render Web Service (API Docker container) + Render Static Site (Frontend SPA).<br>• Supabase PostgreSQL database with connection pooling and automated migration scripts.<br>• GitHub Actions CI/CD pipelines (automated testing, linting, dry-run migrations, and automated nightly backups at 2 AM UTC).<br>• Comprehensive operational runbooks for Incident Response, Rollback, Secret Rotation, and Migration Failure. | **DELIVERED & ACCEPTED** | Cloud Staging Verification |

---

## 4. USER ACCEPTANCE TESTING (UAT) & QUALITY ASSURANCE RESULTS

The ERP platform underwent thorough automated regression testing, integration testing, and hands-on User Acceptance Testing conducted by designated representatives of ATA & LTA Accounting Firm.

### 4.1 Automated Test Execution Summary
* **Testing Framework:** Jest + Supertest (Backend API) & Headless Browser Smoke Test Harness (Frontend SPA).
* **Test Suites Passing:** **18 of 18 Test Suites (100% Pass Rate)**
* **Individual Tests Executed:** **154 of 154 Tests Passing (100% Pass Rate)**
* **Snapshot Failures:** 0
* **Code Coverage Areas:** Authentication, RBAC middleware, Client CRUD & Archival, Work Request lifecycles, Task checklists & dependencies, Time logging, Invoicing & Billing, Disbursements & Approvals, Transmittal workflows, DMS Storage RLS, Audit Logging, and Health/Readiness endpoints.

### 4.2 User Acceptance Testing (UAT) Execution Matrix

| Test Domain | User Role Evaluator | Test Scenarios Validated | UAT Result | Acceptance Sign |
|:---|:---|:---|:---:|:---:|
| **Identity & Access** | System Administrator | Login, session timeout, entity switching, role restriction checks | **PASSED** | ✅ Approved |
| **Client Management** | Operations & Accounting | Client profile creation, contact management, retainers, client archival/unarchival | **PASSED** | ✅ Approved |
| **Operations Engine** | Operations Staff & Manager | WR creation, Kanban drag-and-drop, task checklists, time-logging, ground worker assignment | **PASSED** | ✅ Approved |
| **Billing & Payments** | Accounting Staff & Manager | Invoice generation, PDF export, retainer billing generation, recording partial/full payments | **PASSED** | ✅ Approved |
| **Disbursements** | Accounting Staff & Admin | Expense filing, multi-tier approval, voucher generation, funding and release lifecycle | **PASSED** | ✅ Approved |
| **Transmittal Tracking**| Documentation Staff | Custody tracking, courier dispatch, document receiving, status updates | **PASSED** | ✅ Approved |
| **DMS & Storage** | Documentation & Admin | Uploading BIR forms, client receipts, version comments, secure downloads | **PASSED** | ✅ Approved |
| **Reports & Analytics**| Managing Partner / Admin | Bento grid view, employee productivity summaries, billing collection ratios | **PASSED** | ✅ Approved |

---

## 5. DEFECT DISPOSITION & KNOWN EXCEPTIONS LOG

In adherence to enterprise release standards and the Defect Decision Framework:

* **Severity 1 (Critical / Blocker):** **0 Open** (Zero tolerance met; no system crashes, security vulnerabilities, or data loss vectors exist).
* **Severity 2 (Major / Workflow Breaking):** **0 Open** (All primary business and accounting workflows operate without blocking issues).
* **Severity 3 (Minor / Cosmetic / Operational Enhancement):** Minor future continuous improvement opportunities identified during UAT are logged in the project backlog for routine maintenance or post-warranty enhancement phases:

| Item ID | Classification | Description | Agreed Disposition | Target Window |
|:---|:---:|:---|:---:|:---:|
| `DEP-001` | Minor / Maintenance | Routine dependency version bumps during scheduled quarterly maintenance. | Monitored under 3-Month Maintenance | Standard Maintenance Window |
| `DOC-002` | Enhancement | Future addition of customized BIR specialized tax form export templates. | Categorized as Out-of-Scope (Section 10) | Optional Phase 2 SOW |
| `UX-003` | Minor Tuning | Optional localized UI theme customizations for specific workstation displays. | Cosmetic / Minor UI Adjustment | Maintenance Period |

---

## 6. TRAINING, ONBOARDING & OPERATIONAL READINESS

In accordance with Section 8 of the Software Development Agreement, MICROAXIS has conducted intensive operational onboarding sessions:

1. **Administrative Orientation:** System configuration, user provisioning, role assignments, audit trail monitoring, and pending change reviews.
2. **Managerial & Workflow Training:** Cross-entity performance tracking, work request orchestration, and approval workflows.
3. **Staff Hands-on Walkthroughs:** Step-by-step training for Operations Staff (work requests, checklists, time-logging), Accounting Staff (invoices, receipts, expense vouchers), and Documentation Staff (transmittals and DMS).
4. **Delivered Documentation Package:**
   * `docs/business/Contract-Agreement-Form.docx` (Governing Agreement)
   * `docs/actions_by_module.docx` (RBAC Functional Matrix)
   * `erp_prototype/ERP_User_Credentials_and_Roles.docx` (User Guide & Account Credentials)
   * `docs/DEPLOYMENT_SPECS.md` (Complete Architecture & Infrastructure Guide)
   * `docs/ENVIRONMENT_CONFIGURATION.md` (Secrets & Environment Parameters Guide)
   * `docs/runbooks/` (`INCIDENT_RESPONSE.md`, `ROLLBACK.md`, `SECRET_ROTATION.md`, `MIGRATION_FAILURE.md`)
   * `docs/business/Asset-Turnover-and-Account-Transfer-Guide.md` (Technical Turnover Playbook)

---

## 7. SYSTEM HANDOVER & ASSET TURNOVER SPECIFICATIONS

Pursuant to Section 12 and Section 13 of the Software Development Agreement, technical turnover of system assets is initiated following full payment settlement.

### 7.1 Asset Inventory Overview
* **Git Source Code Repository:** Complete monorepo containing `/backend` (Express API), `/erp_prototype` (SPA Frontend), database migrations (`/backend/migrations`), and automated GitHub Actions workflows (`.github/workflows/`).
* **Compute Services (Render):**
  * Backend Web Service: `ata-lta-erp-api` (Docker containerized Node.js API)
  * Frontend Static Site: `ata-lta-erp-spa` (Single-Page Application)
* **Database & Authentication (Supabase):**
  * Dedicated client Supabase Project containing PostgreSQL Database (45+ migrations applied) and Supabase Auth configuration.
* **Cloud Storage (Supabase Storage):**
  * Secure, non-public document buckets (`ata-lta-erp-documents`) with authenticated RLS access policies.
* **Operational Runbooks & Automation:**
  * CI/CD pipelines and automated nightly database backups scheduled via GitHub Actions (`backup-uat.yml` / `backup-prod.yml`) at 2:00 AM UTC.

### 7.2 Strategic Account Transfer & Support Co-Management Options (Open-Ended Client Decision Item)

During development and staging, several infrastructure services were provisioned using developer staging accounts (GitHub monorepo and Render hosting), while database and auth services were provisioned on a dedicated Client Supabase project.

To ensure uninterrupted database monitoring, bug fixes, and performance tuning during the **Three (3) Months Maintenance Support Period (August 28, 2026 – November 28, 2026)**, the technical handover may be executed under one of the three strategies below.

> [!NOTE]
> **Decision Decoupling:** The Client is not required to finalize this technical transfer model to execute the Project Sign-Off. The Client may review the separate companion document [`Asset-Turnover-and-Account-Transfer-Guide.docx`](file:///home/javvii/FreelanceProject/Project4_Final-Render/docs/business/Asset-Turnover-and-Account-Transfer-Guide.docx) (or [Markdown Guide](file:///home/javvii/FreelanceProject/Project4_Final-Render/docs/business/Asset-Turnover-and-Account-Transfer-Guide.md)) and select the preferred transfer strategy independently:

| Transfer Strategy | GitHub Repository Handover | Render Hosting Handover | Supabase DB Co-Management | Operational Assessment |
|:---|:---|:---|:---|:---|
| **Option A (Recommended ⭐)<br>Organization Transfer + Team Co-Management** | Transfer repo to a new **Client GitHub Organization** (`ata-lta-accounting`). Developer retains **Admin / Collaborator** access during warranty. | Client creates a **Render Team/Workspace** (`ATA-LTA-Accounting`) with billing; invites developer as team collaborator. | Client owns master Supabase project; invites developer (`simplekramateru14@gmail.com`) as **Admin Member**. | • **Pros:** Client owns all assets immediately; developers maintain continuous CI/CD & deploy access; 1-click clean offboarding on Day 90.<br>• **Cons:** Requires a 15-minute setup session with Client IT. |
| **Option B<br>Repository Mirroring to Client Account** | Developer pushes full codebase as a clean mirror to a fresh Client GitHub repository (`git remote add client`). | Client sets up new Render services connected to their repo. | Developer maintains direct DB connection credentials or member invite. | • **Pros:** Complete separation of accounts.<br>• **Cons:** Dual-remote syncing required for bug fixes during warranty; risk of branch divergence. |
| **Option C<br>Phased Custody (Day-90 Final Cutover)** | Retain existing repository during warranty with Client as outside collaborator. Transfer ownership on Nov 28, 2026. | Retain existing Render services during warranty; hand over on Day 90. | Developer maintains member access; full secret rotation executed on Day 90. | • **Pros:** Zero immediate setup friction.<br>• **Cons:** Client does not hold direct account-level hosting/repo ownership during the 90-day window. |

#### Client Asset Transfer Selection (To be confirmed separately by Client IT):
* `[ ]` **Option A (Recommended):** GitHub Organization Transfer + Render Team Workspace Co-Management
* `[ ]` **Option B:** Repository Mirroring / Clean Push to Client Account
* `[ ]` **Option C:** Phased Custody with Full Transfer on Day 90 (November 28, 2026)

*(Detailed step-by-step execution procedures are documented in [`docs/business/Asset-Turnover-and-Account-Transfer-Guide.docx`](file:///home/javvii/FreelanceProject/Project4_Final-Render/docs/business/Asset-Turnover-and-Account-Transfer-Guide.docx)).*

---

## 8. THREE (3) MONTHS WARRANTY & MAINTENANCE SUPPORT (SLA)

Pursuant to Section 9 of the Software Development Agreement, MICROAXIS provides **Three (3) Months of Free Consultation and Maintenance Support**, commencing on the date of this signed acceptance:

### 8.1 Maintenance Support Term
* **Commencement Date:** **August 28, 2026**
* **Expiration Date:** **November 28, 2026**

### 8.2 Included Maintenance Coverage
* **Defect Remediation:** Prompt investigation and resolution of any software bugs or functional discrepancies tracing back to delivered specifications.
* **Technical Troubleshooting:** Backend API, database connection pooler, and authentication troubleshooting.
* **Performance Monitoring:** Proactive health check monitoring (`/health` endpoint) and error log diagnostics.
* **Minor Non-Structural UI Adjustments:** Minor cosmetic adjustments, text corrections, and responsive display tweaks.
* **Preventive Maintenance:** Database index health monitoring and routine service-level checkups.
* **Online Support Coordination:** Direct technical support coordination via designated communication channels during standard Philippine business hours (Monday – Friday, 9:00 AM – 6:00 PM PHT).

### 8.3 Service Level Agreement (SLA) Response Targets
* **Severity 1 (Critical Outage / Service Down):** Initial response within **2 to 4 hours**; continuous effort until resolved.
* **Severity 2 (Major Workflow Degraded):** Initial response within **8 hours**; resolution target within 24–48 hours.
* **Severity 3 (Minor Bug / Inquiry):** Initial response within **24 hours**; resolution in scheduled maintenance updates.

### 8.4 Warranty Exclusions & Limitations
In accordance with standard enterprise software practices and Section 14 of the Agreement:
1. **Third-Party Outages:** Disruptions caused by external internet service providers, cloud infrastructure outages (Render, Supabase, AWS), or force majeure events are excluded from Provider liability.
2. **Unauthorized Code Modifications:** Any unauthorized modifications made to the backend or frontend code by third parties or unauthorized personnel shall void warranty coverage for the modified component.
3. **Out-of-Scope Requests:** New modules, major workflow redesigns, external third-party API integrations, and mobile applications requested after sign-off shall be governed by Section 10 (Change Requests) as separate chargeable work orders.
4. **Exclusive Remedy:** The Client's sole and exclusive remedy for any covered defect during the warranty period shall be the repair, correction, or re-performance of the defective software service by the Provider.

---

## 9. DATA PRIVACY & CONFIDENTIALITY AFFIRMATION (RA 10173)

In strict compliance with Section 11 and Section 12 of the Software Development Agreement and the **Republic Act No. 10173 (Data Privacy Act of 2012)**:

1. **Data Confidentiality:** MICROAXIS confirms that all Client data, financial records, taxpayer information, uploaded documents, and business operational workflows remain strictly confidential.
2. **Development Data Purging:** MICROAXIS certifies that all temporary copies of Client data, staging test files, and local development data dumps have been securely purged from developer machines and non-production storage.
3. **No Commercial Use or AI Training:** No Client data has been or will ever be copied, retained, disclosed, commercialized, or used for AI training purposes.
4. **Credential Security:** All master administrative credentials, database connection strings, and service role keys have been turned over directly to the Client’s authorized management.

---

## 10. FINANCIAL RECONCILIATION & FULL PAYMENT ACKNOWLEDGEMENT

### 10.1 Project Cost Summary
* **Agreed Total Investment:** **PHP 50,000.00** (VAT Exclusive)
* **Total Amount Paid:** **PHP 50,000.00**
* **Outstanding Balance:** **PHP 0.00 (Fully Settled)**

### 10.2 Milestone Payment Settlement Record

| Milestone # | Milestone Description | Percentage | Amount (PHP) | Payment Status | Settlement Verification |
|:---:|:---|:---:|:---:|:---:|:---:|
| **Milestone 1** | Contract Signing & Project Kickoff | 40% | PHP 20,000.00 | **PAID & CLEARED** | Fully Received |
| **Milestone 2** | Alpha Release / Sprint Completion | 30% | PHP 15,000.00 | **PAID & CLEARED** | Fully Received |
| **Milestone 3** | **UAT Approval & Final Deployment** | **30%** | **PHP 15,000.00** | **PAID & CLEARED** | **Fully Received Earlier** |
| **TOTAL** | **Full Project Engagement** | **100%** | **PHP 50,000.00** | **100% FULLY SETTLED** | **ZERO BALANCE** |

### 10.3 Certificate of Full Payment Settlement
MICROAXIS hereby formally acknowledges and certifies that the full contract price of **PHP 50,000.00** has been received in full from ATA & LTA Accounting Firm. No outstanding balances, unpaid milestone claims, or disputed financial items remain under this engagement.

---

## 11. INTELLECTUAL PROPERTY & USAGE RIGHTS

Pursuant to Section 13 of the Agreement, with full payment 100% settled:
1. **Perpetual Usage Rights:** ATA & LTA Accounting Firm is granted full, perpetual, non-exclusive, and royalty-free rights to utilize, operate, and modify the custom ERP system for its internal business operations across all firm branches and entities.
2. **Provider Frameworks:** MICROAXIS retains intellectual property rights over its generic background libraries, boilerplate scaffolding, and reusable development tools.
3. **Turnover Confirmation:** Complete source code repository ownership and master administrative keys are released unconditionally to ATA & LTA Accounting Firm.

---

## 12. FORMAL ACCEPTANCE & STAKEHOLDER SIGNATURES

By affixing their signatures below, both Parties formally declare that the ATA & LTA Enterprise Resource Planning (ERP) System has been thoroughly reviewed, tested, delivered, and accepted in full satisfaction of all contractual terms and operational specifications.

---

### FOR THE CLIENT: ATA & LTA ACCOUNTING FIRM

I, the undersigned authorized representative of **ATA & LTA Accounting Firm**, hereby declare that the deliverables outlined in this Project Sign-Off Document have been thoroughly inspected, tested during UAT, and accepted. I certify that all milestone payments have been fully settled, and I confirm the commencement of the 3-month maintenance support period.

<br>

**Authorized Managing Partner / Client Representative:**

____________________________________________________  
**Signature**

**Name:** ___________________________________________  
**Title / Position:** Managing Partner / Director  
**Date Signed:** August 28, 2026  

<br>

**Operational / Financial Reviewers:**

| Role | Name | Signature | Date |
|:---|:---|:---:|:---:|
| **Lead Operations Reviewer** | _______________________ | ___________________ | August 28, 2026 |
| **Lead Accounting Reviewer** | _______________________ | ___________________ | August 28, 2026 |
| **Documentation Reviewer**   | _______________________ | ___________________ | August 28, 2026 |

---

### FOR THE SERVICE PROVIDER: MICROAXIS

I, the undersigned Project Manager of **MICROAXIS**, hereby certify that all agreed project deliverables, source code assets, documentation runbooks, and cloud configurations have been professionally completed, verified, and turned over to ATA & LTA Accounting Firm. I acknowledge receipt of full payment in the amount of PHP 50,000.00 and commit to providing full maintenance and consultation support pursuant to Section 8 of this document.

<br>

**Authorized Project Manager:**

____________________________________________________  
**Mr. Mark Anthony C. Ureta**  
Project Manager  
**MICROAXIS**  
**Date Signed:** August 28, 2026  

---
*End of Project Sign-Off and Client Acceptance Document — MICROAXIS & ATA / LTA Accounting Firm (2026)*
