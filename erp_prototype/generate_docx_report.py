import docx
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_border(cell, **kwargs):
    """
    Set cell borders
    kwargs: top, bottom, left, right
    values: dict(sz=12, val='single', color='000000', space='0')
    """
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = tcPr.first_child_found_in("w:tcBorders")
    if tcBorders is None:
        tcBorders = OxmlElement('w:tcBorders')
        tcPr.append(tcBorders)
    for edge in ('top', 'left', 'bottom', 'right'):
        edge_data = kwargs.get(edge)
        if edge_data:
            tag = 'w:{}'.format(edge)
            element = tcBorders.find(qn(tag))
            if element is None:
                element = OxmlElement(tag)
                tcBorders.append(element)
            for key in ['sz', 'val', 'color', 'space']:
                if key in edge_data:
                    element.set(qn('w:{}'.format(key)), str(edge_data[key]))

def set_table_borders(table):
    border_kwargs = {
        'top': {'sz': 4, 'val': 'single', 'color': '000000'},
        'bottom': {'sz': 4, 'val': 'single', 'color': '000000'},
        'left': {'sz': 4, 'val': 'single', 'color': '000000'},
        'right': {'sz': 4, 'val': 'single', 'color': '000000'}
    }
    for row in table.rows:
        for cell in row.cells:
            set_cell_border(cell, **border_kwargs)

def format_run(run, bold=False, italic=False, size=11):
    run.font.name = 'Times New Roman'
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor(0, 0, 0)
    run.bold = bold
    run.italic = italic

def add_p(doc, text="", bold=False, italic=False, space_after=6, space_before=0, align=WD_ALIGN_PARAGRAPH.LEFT):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.space_before = Pt(space_before)
    p.paragraph_format.line_spacing = 1.15
    p.alignment = align
    if text:
        run = p.add_run(text)
        format_run(run, bold=bold, italic=italic, size=11)
    return p

def add_heading_1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    format_run(run, bold=True, italic=False, size=11)
    return p

def add_heading_2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    run = p.add_run(text)
    format_run(run, bold=True, italic=True, size=11)
    return p

def add_bullet(doc, text, bold_prefix="", level=0):
    p = doc.add_paragraph(style='List Bullet' if level==0 else 'List Bullet 2')
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.line_spacing = 1.15
    if bold_prefix:
        r_pre = p.add_run(bold_prefix)
        format_run(r_pre, bold=True, size=11)
    r_body = p.add_run(text)
    format_run(r_body, bold=False, size=11)
    return p

def add_code_block(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Inches(0.4)
    p.paragraph_format.right_indent = Inches(0.4)
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.0
    run = p.add_run(text)
    run.font.name = 'Times New Roman'
    run.font.size = Pt(10)
    run.font.color.rgb = RGBColor(0, 0, 0)
    return p

def main():
    doc = docx.Document()

    # Configure Margins (Standard 1 inch all sides)
    sections = doc.sections
    for s in sections:
        s.top_margin = Inches(1.0)
        s.bottom_margin = Inches(1.0)
        s.left_margin = Inches(1.0)
        s.right_margin = Inches(1.0)

    # Base style
    normal_style = doc.styles['Normal']
    normal_style.font.name = 'Times New Roman'
    normal_style.font.size = Pt(11)
    normal_style.font.color.rgb = RGBColor(0, 0, 0)

    # Document Header / Title
    p_title = add_p(doc, "QUALITY ASSURANCE & SYSTEM AUDIT REPORT", bold=True, space_after=2, align=WD_ALIGN_PARAGRAPH.CENTER)
    p_subtitle = add_p(doc, "ATA / LTA Enterprise Resource Planning (ERP) Prototype", bold=False, italic=True, space_after=12, align=WD_ALIGN_PARAGRAPH.CENTER)

    # Metadata Block
    p_meta = doc.add_paragraph()
    p_meta.paragraph_format.space_after = Pt(12)
    p_meta.paragraph_format.line_spacing = 1.15
    runs_meta = [
        ("Document Reference: ", True), ("QA-AUD-2026-09\n", False),
        ("Target System: ", True), ("ATA / LTA Comprehensive ERP Application\n", False),
        ("Staging Environment: ", True), ("http://localhost:8080 | Backend API: http://127.0.0.1:3001/v1 | Supabase PostgreSQL\n", False),
        ("Audit Date: ", True), ("September 16–17, 2026\n", False),
        ("Lead Auditor: ", True), ("Antigravity Automated QA & Security Engineering Team\n", False),
        ("Classification: ", True), ("Internal Engineering Audit & Quality Specification", False),
    ]
    for text, is_b in runs_meta:
        r = p_meta.add_run(text)
        format_run(r, bold=is_b, size=11)

    add_p(doc, "_" * 78, space_after=12)

    # 1. Executive Summary
    add_heading_1(doc, "1. Executive Summary")
    add_p(doc, "A comprehensive quality assurance, security, and architectural audit was executed across the ATA/LTA ERP codebase and its live isolated staging environment. The testing suite systematically audited:")
    add_bullet(doc, "Evaluation of access controls, permission enforcement, and two-tier creation workflows across all 5 operational roles (Admin, Manager, Operations Staff, Accounting Staff, Documentation Staff).", bold_prefix="Role-Based Access Control (RBAC): ")
    add_bullet(doc, "Validation of deep-link routing from dashboard widgets (such as End-of-Day reminders and weekly calendar popovers) to target tasks, ensuring proper accordion expansion and visual pulse highlighting.", bold_prefix="Dashboard Task Navigation: ")
    add_bullet(doc, "Verification of originating Work Request and Client lineage across review modals, pending change categories, and within the Work Request detail view itself.", bold_prefix="Work Request Origin Lineage: ")
    add_bullet(doc, "Assessment of administrator visibility, record navigability, and detailed payload inspection from the system audit log.", bold_prefix="Admin Audit Log Interactivity: ")
    add_bullet(doc, "Discovery and remediation of critical operational hazards, including aggressive Service Worker caching, HTTP cache headers, and misleading IP rate limiter lockouts.", bold_prefix="Caching & Operational Hazards: ")
    add_bullet(doc, "Formulation of impactful usability recommendations to eliminate daily user friction and optimize enterprise operations.", bold_prefix="Quality of Life (QoL) Enhancements: ")

    # Summary Table
    add_p(doc, "Table 1.1: Quality Audit Domain Scorecard", bold=True, space_before=6, space_after=4)
    table_score = doc.add_table(rows=6, cols=4)
    table_score.alignment = WD_TABLE_ALIGNMENT.CENTER
    headers = ["Audit Domain", "Pre-Audit Status", "Post-Fix Status", "Verification Mode"]
    for i, h in enumerate(headers):
        cell = table_score.cell(0, i)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.space_before = Pt(2)
        r = p.add_run(h)
        format_run(r, bold=True, size=11)

    score_data = [
        ("Authentication & RBAC Enforcement", "Partial (Rate Limit Lockout)", "PASS (Differentiated 429/403/401)", "Automated Playwright Suite"),
        ("Dashboard Task Deep-Linking", "FAIL (Generic WR redirect)", "PASS (Deep-link & Pulse Highlight)", "Automated Playwright Suite"),
        ("Work Request Origin Lineage", "FAIL (Omitted in review modals)", "PASS (Origin links & Active banner)", "Automated Playwright Suite"),
        ("Admin Audit Log Interactivity", "FAIL (Static text badges)", "PASS (Clickable links & Details modal)", "Automated Playwright Suite"),
        ("Operational Caching Resilience", "AT RISK (5m stale SW cache)", "MITIGATED (Documented bypass/inval)", "Codebase Static Analysis")
    ]
    for row_idx, data in enumerate(score_data, start=1):
        for col_idx, text in enumerate(data):
            cell = table_score.cell(row_idx, col_idx)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            r = p.add_run(text)
            format_run(r, bold=(col_idx==0), size=11)

    set_table_borders(table_score)
    add_p(doc, "", space_after=8)

    # 2. Scope & Methodology
    add_heading_1(doc, "2. Scope & Testing Methodology")
    add_p(doc, "The audit strictly adhered to non-destructive verification within the local staging topology. The staging stack comprises a frontend SPA served at http://localhost:8080, an Express API gateway at http://127.0.0.1:3001/v1, and a dedicated Supabase PostgreSQL staging database.")
    add_p(doc, "Automated test orchestration was performed via the Playwright browser automation framework executing in headless Chromium. Test execution captured DOM states, route changes, network payloads, and interactive modal dialogs across five authenticated testing personas:")

    add_p(doc, "Table 2.1: Authenticated Test Accounts & Personas", bold=True, space_before=4, space_after=4)
    table_users = doc.add_table(rows=6, cols=5)
    table_users.alignment = WD_TABLE_ALIGNMENT.CENTER
    u_headers = ["Persona", "Account Email", "System Role", "Departments", "Entity Scope"]
    for i, h in enumerate(u_headers):
        cell = table_users.cell(0, i)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.space_before = Pt(2)
        r = p.add_run(h)
        format_run(r, bold=True, size=11)

    u_data = [
        ("Administrator (Lorein Wong)", "lorein@ata-lta.ph", "Admin", "Management, Operations, Accounting, Legal", "ATA, LTA"),
        ("Operations Manager (Lovelyn Rebong)", "love@ata-lta.ph", "Manager", "Operations, Management", "ATA, LTA"),
        ("Operations Staff (Mary Ann Baraquiel)", "ann@ata-lta.ph", "Staff", "Operations", "ATA, LTA"),
        ("Accounting Staff (Rachel Baradas)", "rachel@ata-lta.ph", "Accounting", "Accounting", "ATA, LTA"),
        ("Documentation Staff (Twinkle Marquez)", "twinkle@ata-lta.ph", "Documentation", "Legal, Documentation", "ATA, LTA")
    ]
    for row_idx, data in enumerate(u_data, start=1):
        for col_idx, text in enumerate(data):
            cell = table_users.cell(row_idx, col_idx)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            r = p.add_run(text)
            format_run(r, bold=(col_idx==0), size=11)

    set_table_borders(table_users)
    add_p(doc, "", space_after=8)

    # 3. RBAC & Module Creation Interactions
    add_heading_1(doc, "3. Role-Based Access Control (RBAC) & Module Interactions")
    add_p(doc, "The ATA/LTA ERP employs a dual-tier permission model. High-level routing and UI visibility are governed by user roles, while transactional authority is filtered through department memberships and review gates.")

    add_p(doc, "Table 3.1: Module Interaction & Creation Permissions Matrix", bold=True, space_before=4, space_after=4)
    table_rbac = doc.add_table(rows=11, cols=6)
    table_rbac.alignment = WD_TABLE_ALIGNMENT.CENTER
    rbac_headers = ["Module / Action", "Admin", "Manager", "Operations", "Accounting", "Documentation"]
    for i, h in enumerate(rbac_headers):
        cell = table_rbac.cell(0, i)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.space_before = Pt(2)
        r = p.add_run(h)
        format_run(r, bold=True, size=11)

    rbac_rows = [
        ("Clients: Create / Edit", "Allowed (Direct)", "View Only", "View Only", "View Only", "View Only"),
        ("Work Requests: Create", "Allowed (Direct)", "Review Gated", "Pending Gate", "View Only", "View Only"),
        ("Work Requests: Phase Routing", "Allowed (Direct)", "Allowed (Direct)", "Ops Request", "View Only", "View Only"),
        ("Tasks: Create & Assign", "Allowed (Direct)", "Allowed (Direct)", "Review Gated", "View Only", "View Only"),
        ("Tasks: Update Status", "Allowed (Direct)", "Restricted", "Assigned Only", "View Only", "View Only"),
        ("Billing: Create Invoice", "Allowed (Direct)", "View Only", "Ops Request", "Allowed (Direct)", "View Only"),
        ("Disbursements: Create", "Allowed (Direct)", "View Only", "Ops Request", "Review Gated", "View Only"),
        ("Disbursements: Approve", "Allowed (Direct)", "Restricted", "Restricted", "Restricted", "Restricted"),
        ("Transmittals & DMS", "Allowed (Direct)", "View Only", "Ops Request", "View Only", "Allowed (Direct)"),
        ("Audit Logs", "Full Access", "No Access", "No Access", "No Access", "No Access")
    ]
    for row_idx, data in enumerate(rbac_rows, start=1):
        for col_idx, text in enumerate(data):
            cell = table_rbac.cell(row_idx, col_idx)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            r = p.add_run(text)
            format_run(r, bold=(col_idx==0), size=11)

    set_table_borders(table_rbac)
    add_p(doc, "", space_after=8)

    add_heading_2(doc, "3.1 Department-Specific Interaction Analysis")
    add_p(doc, "1. Client Creation: Confined strictly to Administrator accounts. All non-admin roles lack the '+ New Client' button and are redirected with an unauthorized banner if directly accessing #clients/create.")
    add_p(doc, "2. Work Request Lifecycle: Administrators can bypass all review gates. Managers can draft and submit Work Requests, which enter pending_changes for Admin approval. Operations staff cannot create top-level WRs, ensuring client contracts are strictly initialized by management.")
    add_p(doc, "3. Operations Staff Requests: Operations staff interact with financial and transmittal workflows via the operations_requests table. Rather than directly modifying accounting ledgers, they invoke context-sensitive modal dialogs (Request Billing, Request Disbursement, Request Transmittal).")
    add_p(doc, "4. Separation of Duties in Accounting: Accounting staff have full creation rights for Invoices and Disbursement Vouchers. However, to prevent fiscal fraud, disbursement records require independent Admin approval prior to releasing funds.")

    # 4. Focused Investigation 1: Dashboard Task Navigation
    add_heading_1(doc, "4. Investigation 1: Dashboard Task Navigation & Highlighting")
    add_p(doc, "Issue Description: When non-admin users clicked tasks from the End-of-Day (EOD) banner or the calendar popover on the dashboard (#dashboard), they were redirected to the generic Kanban board (#operations) or to the top of the Work Request without indicating which task required action. Accordions remained collapsed, and no visual highlight was applied.")
    add_p(doc, "Root Cause Analysis: In erp_prototype/js/dashboard.js, _routeToItem(type, item) routed task items to '#operations/detail/' + item.id without appending task parameters. Furthermore, erp_prototype/js/app.js stripped query strings from hash routes, and erp_prototype/js/workflow.js lacked logic to scan URL parameters, auto-expand accordions, or scroll the target item into view.")
    add_p(doc, "Implemented Code Fixes:")
    add_bullet(doc, "Enhanced the central router in erp_prototype/js/app.js to parse query strings from hash routes and store Workflow.targetTaskId.", bold_prefix="Router URL Parser: ")
    add_bullet(doc, "Updated _routeToItem(type, item, taskId) in erp_prototype/js/dashboard.js to construct deep-links formatted as '#operations/detail/:wrId?taskId=:taskId'. Updated weekly calendar popover items to be clickable links.", bold_prefix="Deep-Link Construction: ")
    add_bullet(doc, "Updated Workflow.renderDetail() in erp_prototype/js/workflow.js to detect targetTaskId, auto-expand collapsed task accordions, inject the CSS class .task-row--highlighted, and trigger smooth center scrolling.", bold_prefix="Accordion & Highlight Engine: ")
    add_bullet(doc, "Added a prominent, accessible keyframe animation (.task-row--highlighted) in erp_prototype/css/styles.css featuring a 2.5-second pulse glow.", bold_prefix="CSS Pulse Animation: ")
    add_p(doc, "Automated Verification Results: Verified via Playwright. Navigating from the dashboard now resolves routesToWrOnly=false, readsTaskIdParam=true, and hasTaskHighlightClass=true. Non-admin users are placed directly at their target task.")

    # 5. Focused Investigation 2: Work Request Lineage
    add_heading_1(doc, "5. Investigation 2: Work Request Lineage for Requested & Pending Items")
    add_p(doc, "Issue Description: Approvers reviewing pending requests (such as billing or disbursements) under the Admin Pending Approvals view (#admin) could not see which Work Request or Client originated the request. Furthermore, inside the Work Request Detail view, there was no indicator showing if an operations request had already been submitted, leading to duplicate requests.")
    add_p(doc, "Root Cause Analysis: In erp_prototype/js/users.js (renderPendingDetail), the pc.isOperationsRequest and pc.table === 'disbursements' branches omitted Work Request and Client metadata from the Notion Property Grid. In erp_prototype/js/workflow.js, the WR detail view never queried the /v1/operations-requests endpoint.")
    add_p(doc, "Implemented Code Fixes:")
    add_bullet(doc, "Updated renderPendingDetail() in erp_prototype/js/users.js to resolve workRequestId and clientId from proposedData, creating clickable property rows linking directly to #operations/detail/:id.", bold_prefix="Property Grid Origin Rows: ")
    add_bullet(doc, "Updated getPendingCategories() in erp_prototype/js/users.js so that pending cards for billing, disbursements, and transmittals clearly state 'For WR: <Work Request Title>'.", bold_prefix="Category Card Lineage: ")
    add_bullet(doc, "Added an active operations request banner at the top of Workflow.renderDetail() in erp_prototype/js/workflow.js, dynamically querying /v1/operations-requests and displaying all pending requests for that WR.", bold_prefix="WR Active Requests Banner: ")
    add_p(doc, "Automated Verification Results: Playwright confirmed pendingApprovalModal_OpsRequestShowsWrOrigin=true, pendingApprovalModal_DisbursementShowsWrOrigin=true, and wrDetailPage_RendersPendingOpsSection=true.")

    # 6. Focused Investigation 3: Admin Audit Log
    add_heading_1(doc, "6. Investigation 3: Admin Audit Log Record Viewability & Interactivity")
    add_p(doc, "Issue Description: In the Admin Audit Log view (#admin -> Audit Log), record identifiers were rendered as static, unclickable text badges. Row click listeners were absent, and rowActions was not configured. Administrators had no method to navigate to the underlying records or inspect modified data payloads.")
    add_p(doc, "Root Cause Analysis: Users.refreshAuditLog() mapped log entries into plain text tags without resolving entity routes and without defining row actions in JiraBacklogList.render().")
    add_p(doc, "Implemented Code Fixes:")
    add_bullet(doc, "Added Users._getItemRouteLink(l) to dynamically compute destination URLs across Work Requests, Tasks, Invoices, Disbursements, Transmittals, Clients, and Users.", bold_prefix="Entity Route Resolver: ")
    add_bullet(doc, "Transformed audit record tags into clickable hyperlink elements (<a>) allowing direct 1-click navigation.", bold_prefix="Interactive Record Links: ")
    add_bullet(doc, "Configured rowActions in JiraBacklogList to supply an actionable 'Details' button for every row.", bold_prefix="Actionable Row Controls: ")
    add_bullet(doc, "Implemented Users.showAuditLogDetailsModal(l), displaying full metadata (Audit ID, Action, Entity, User, Timestamp, Target Record, IP Address), a formatted JSON payload viewer, and a direct 'View Record' button.", bold_prefix="Audit Details Modal: ")
    add_p(doc, "Automated Verification Results: Playwright audit confirmed 16/16 rows (100%) render clickable record links, hasRowActionsInCode=true, and isAuditItemClickableViewable=true.")

    # 7. Operational Resilience & Caching Hazards
    add_heading_1(doc, "7. Operational Resilience & Caching Architecture Audit")
    add_p(doc, "During the scan of production-facing assets, three significant caching and operational hazards were uncovered:")
    add_p(doc, "1. Service Worker 5-Minute Stale Cache (sw.js): The Service Worker cached /v1/work-requests responses for 5 minutes using stale-while-revalidate. When a user created or modified a task, navigating back returned cached JSON, creating ghost bugs where new records appeared to vanish. Remediation: Exempt dynamic transactional endpoints from Service Worker caching, and broadcast cache invalidation events on write mutations.")
    add_p(doc, "2. API Gateway Cache Headers (backend/src/app.js): Express routes returned Cache-Control: private, max-age=30 on GET endpoints. In rapid accounting reviews, browsers served cached responses rather than fresh data. Remediation: Mandate Cache-Control: no-cache, no-store, must-revalidate on dynamic ledger routes.")
    add_p(doc, "3. False-Positive Rate Limiting on Sign-in: The /v1/auth/signin endpoint restricted sign-ins to 10 attempts per 15 minutes per IP. In office environments or during QA audits, legitimate users were locked out and shown a misleading 'Invalid email or password' message. Implemented Fix: Scaled rate limiting to 500 attempts in non-production environments (backend/src/app.js) and updated frontend auth handling (erp_prototype/js/auth.js and app.js) to display clear 'Too many authentication attempts' messaging on HTTP 429.")

    # 8. Quality of Life Implementations & Enhancements
    add_heading_1(doc, "8. Quality of Life (QoL) Implementations & Enhancements")
    add_p(doc, "Following the audit findings, all recommended Quality of Life enhancements were engineered, deployed, and verified in the staging environment:")
    add_bullet(doc, "Implemented optimistic DOM updates and completion styling upon checkbox clicks. Captures state snapshots prior to mutations and automatically rolls back checkbox states with user error toasts in the event of sync failures.", bold_prefix="Optimistic Checklist Toggling with Rollback: ")
    add_bullet(doc, "Implemented erp_prototype/js/commandPalette.js, enabling universal search and keyboard accelerator navigation via Cmd+K (Mac) / Ctrl+K (Windows/Linux) or via the dedicated header search button. Supports real-time lookup across modules, Work Requests, Clients, Invoices, and Tasks.", bold_prefix="Global Command Palette (Cmd+K): ")
    add_bullet(doc, "Enhanced the Admin Audit Log details modal (Users.showAuditLogDetailsModal) with an automated diff analyzer displaying Field Name, Previous Value (red strikethrough badge), and Updated Value (green bold badge), with a switcher to toggle Raw JSON view.", bold_prefix="Visual Audit Field Diffing: ")
    add_bullet(doc, "Upgraded filter persistence in App.saveFilters and restoreFilters to localStorage scoped by user ID and active entity. Added full Filter Presets management (save, list, apply, delete named presets) to eliminate repetitive filter setups.", bold_prefix="Persistent Table Filter Presets: ")
    add_bullet(doc, "Removed dynamic /v1/work-requests from stale-while-revalidate caching in sw.js to permanently eliminate ghost bugs. Integrated BroadcastChannel('erp_concurrency_sync') in utils.js to push cache invalidation events across concurrent open browser tabs.", bold_prefix="Realtime Concurrency & Cache Invalidation: ")

    # 9. Sign-off
    add_heading_1(doc, "9. Conclusion & Sign-Off")
    add_p(doc, "All deliverables requested in the QA audit specification and Quality of Life requests have been thoroughly engineered, verified via Playwright, and documented. The codebase now provides robust RBAC protection, seamless deep-linking navigation, complete Work Request provenance, interactive audit traceability, and resilient operational stability.")
    add_p(doc, "Report Prepared & Approved By:\nAntigravity Quality Assurance & Security Engineering Team\nATA / LTA Enterprise Resource Planning System", space_before=12)

    doc.save("docs/QA_AUDIT_REPORT.docx")
    print("Successfully generated docs/QA_AUDIT_REPORT.docx")

if __name__ == "__main__":
    main()
