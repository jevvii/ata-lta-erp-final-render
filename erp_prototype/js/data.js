/**
 * Data Layer
 * localStorage persistence, seed data, schema versioning, and CRUD wrapper.
 */

// ============================================================
// SEED DATA
// ============================================================

const now = new Date().toISOString();
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
const inFiveDays = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

function makeId(prefix, num) {
  return prefix + '-' + String(num).padStart(4, '0');
}

function defaultRequirementChecklist(taskId) {
  const items = [
    { text: 'SEC Certificate', category: 'document' },
    { text: 'Articles of Incorporation', category: 'document' },
    { text: "Mayor's Permit", category: 'document' },
    { text: 'BIR Form 1901/1903', category: 'document' }
  ];
  return items.map((item, i) => ({
    id: taskId + '-cl-' + String(i + 1).padStart(3, '0'),
    text: item.text,
    category: item.category,
    completed: false,
    assigneeId: null,
    assigneeName: null,
    dependsOn: null,
    timeLogs: []
  }));
}

const seedData = {
  schemaVersion: 15,
  operationsRequests: [],

  departments: ['Accounting', 'Operations', 'Documentation', 'HR', 'Management', 'Legal', 'Tax', 'Audit', 'Business Development'],

  // Users are no longer seeded locally; they are managed via the backend API.
  // The first admin must be created directly in Supabase Auth + the users table.
  users: [],

  groundWorkers: [
    { id: makeId('gw', 1), name: 'Juan dela Cruz' },
    { id: makeId('gw', 2), name: 'Maria Santos' },
    { id: makeId('gw', 3), name: 'Pedro Garcia' }
  ],

  clients: [
    {
      id: makeId('c', 1),
      name: 'Manila Fresh Foods Inc.',
      tin: '123-456-789-00001',
      rdoCode: '034A',
      contactPerson: 'Juan dela Cruz',
      phone: '0917-123-4567',
      email: 'juan.dcruz@manilafresh.ph',
      address: '123 Mabini St, Ermita, Manila, Metro Manila',
      entity: 'ATA',
      retainer: true,
      tradeName: '',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 2),
      name: 'Cebu Trading Co.',
      tin: '234-567-890-00002',
      rdoCode: '082',
      contactPerson: 'Maria Santos',
      phone: '0918-234-5678',
      email: 'maria.santos@cebutrade.ph',
      address: '456 Osmena Blvd, Cebu City, Cebu',
      entity: 'ATA',
      retainer: false,
      tradeName: '',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 3),
      name: 'Davao Agri Ventures',
      tin: '345-678-901-00003',
      rdoCode: '113',
      contactPerson: 'Ricardo Reyes',
      phone: '0919-345-6789',
      email: 'ricardo.reyes@davaoagri.ph',
      address: '789 Roxas Ave, Davao City, Davao del Sur',
      entity: 'ATA',
      retainer: true,
      tradeName: '',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 4),
      name: 'Iloilo Manufacturing Corp.',
      tin: '456-789-012-00004',
      rdoCode: '074',
      contactPerson: 'Ana Lim',
      phone: '0920-456-7890',
      email: 'ana.lim@iloilomfg.ph',
      address: '321 Magsaysay St, Iloilo City, Iloilo',
      entity: 'ATA',
      retainer: false,
      tradeName: '',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 5),
      name: 'Batangas Industrial Group',
      tin: '567-890-123-00005',
      rdoCode: '039',
      contactPerson: 'Pedro Garcia',
      phone: '0921-567-8901',
      email: 'pedro.garcia@batindustrial.ph',
      address: '654 JP Laurel Hwy, Tanauan, Batangas',
      entity: 'LTA',
      retainer: true,
      tradeName: '',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 6),
      name: 'Laguna Logistics Ltd.',
      tin: '678-901-234-00006',
      rdoCode: '057',
      contactPerson: 'Elena Torres',
      phone: '0922-678-9012',
      email: 'elena.torres@lagunalogistics.ph',
      address: '987 National Hwy, Calamba, Laguna',
      entity: 'LTA',
      retainer: false,
      tradeName: '',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 7),
      name: 'Pampanga Retailers Inc.',
      tin: '789-012-345-00007',
      rdoCode: '021A',
      contactPerson: 'Carlos Mendoza',
      phone: '0923-789-0123',
      email: 'carlos.mendoza@pampangaretail.ph',
      address: '147 McArthur Hwy, Angeles, Pampanga',
      entity: 'LTA',
      retainer: true,
      tradeName: '',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 8),
      name: 'Tagaytay Hospitality Group',
      tin: '890-123-456-00008',
      rdoCode: '054B',
      contactPerson: 'Sofia Ramos',
      phone: '0924-890-1234',
      email: 'sofia.ramos@tagaytayhospitality.ph',
      address: '258 Aguinaldo Hwy, Tagaytay, Cavite',
      entity: 'LTA',
      retainer: false,
      tradeName: '',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 9),
      name: 'Pioneer Logistics Inc.',
      tin: '901-123-456-00009',
      rdoCode: '040',
      contactPerson: 'David Tan',
      phone: '0925-123-4567',
      email: 'david.tan@pioneerlog.ph',
      address: '77 Pioneer St, Mandaluyong, Metro Manila',
      entity: 'ATA',
      retainer: true,
      tradeName: 'Pioneer Log',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 10),
      name: 'Taguig Tech Solutions',
      tin: '012-234-567-00010',
      rdoCode: '044',
      contactPerson: 'Grace Lee',
      phone: '0926-234-5678',
      email: 'grace.lee@taguigtech.ph',
      address: '88 BGC High Street, Taguig, Metro Manila',
      entity: 'LTA',
      retainer: false,
      tradeName: 'Taguig Tech',
      contactUserId: '',
      relatedCompanies: [],
      contactDetails: [],
      createdAt: now
    },
    {
      id: makeId('c', 11),
      name: 'Apex Global Solutions (Archived)',
      tin: '901-234-567-00011',
      rdoCode: '040',
      contactPerson: 'Robert Tan',
      phone: '0925-901-2345',
      email: 'robert.tan@apexglobal.ph',
      address: '12 Pioneer St, Mandaluyong City',
      entity: 'ATA',
      retainer: true,
      tradeName: 'Apex Global',
      contactUserId: makeId('u', 4),
      relatedCompanies: [],
      contactDetails: [{ type: 'email', value: 'info@apexglobal.ph', label: 'Work' }],
      status: 'Archived',
      createdAt: lastMonth
    },
    {
      id: makeId('c', 12),
      name: 'Summit Summit Summit (Archived)',
      tin: '012-345-678-00012',
      rdoCode: '043',
      contactPerson: 'Lisa Go',
      phone: '0926-012-3456',
      email: 'lisa.go@summit.ph',
      address: '88 Shaw Blvd, Pasig City',
      entity: 'LTA',
      retainer: false,
      tradeName: 'Summit Group',
      contactUserId: makeId('u', 5),
      relatedCompanies: [],
      contactDetails: [{ type: 'mobile', value: '09260123456', label: 'Mobile' }],
      status: 'Archived',
      createdAt: lastMonth
    }
  ],

  workRequests: [
    {
      id: makeId('wr', 102),
      title: 'Completed Assessment - Mock',
      description: 'Mock completed item due today to demonstrate green styling.',
      clientId: makeId('c', 2),
      entity: 'ATA',
      status: 'Completed',
      requestedBy: makeId('u', 1),
      assignedTo: makeId('u', 4),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: today,
      updatedAt: today,
      dueDate: today
    },
    {
      id: makeId('wr', 101),
      title: 'Urgent Processing - All Staff (Mock)',
      description: 'Mock item due today to demonstrate daily task views.',
      clientId: makeId('c', 1),
      entity: 'ATA',
      status: 'Processing',
      requestedBy: makeId('u', 1),
      assignedTo: makeId('u', 4),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: today,
      updatedAt: today,
      dueDate: today
    },
    {
      id: makeId('wr', 99),
      title: 'Monthly VAT Declaration - Mock',
      description: 'Mock item due this week.',
      clientId: makeId('c', 1),
      entity: 'ATA',
      status: 'Processing',
      requestedBy: makeId('u', 1),
      assignedTo: makeId('u', 4),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: today,
      updatedAt: today,
      dueDate: inThreeDays
    },
    {
      id: makeId('wr', 1),
      title: 'Annual Tax Filing 2025',
      description: 'Comprehensive annual income tax return preparation and filing for CY 2024.',
      clientId: makeId('c', 1),
      entity: 'ATA',
      status: 'Processing',
      requestedBy: makeId('u', 1),
      assignedTo: makeId('u', 4),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    {
      id: makeId('wr', 2),
      title: 'Monthly Bookkeeping',
      description: 'Recurring monthly bookkeeping service for retainer client.',
      clientId: makeId('c', 3),
      entity: 'ATA',
      status: 'Completed',
      requestedBy: makeId('u', 3),
      assignedTo: makeId('u', 4),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    {
      id: makeId('wr', 3),
      title: 'VAT Compliance Review',
      description: 'Quarterly VAT reconciliation and BIR compliance review.',
      clientId: makeId('c', 2),
      entity: 'ATA',
      status: 'Billing',
      requestedBy: makeId('u', 2),
      assignedTo: makeId('u', 4),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    {
      id: makeId('wr', 4),
      title: 'Audited Financial Statements',
      description: 'Preparation of audited financial statements for SEC filing.',
      clientId: makeId('c', 5),
      entity: 'LTA',
      status: 'Pre-processing',
      requestedBy: makeId('u', 1),
      assignedTo: makeId('u', 5),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    {
      id: makeId('wr', 5),
      title: 'Quarterly Tax Filing Q1 2025',
      description: 'Quarterly percentage tax and income tax filing for Q1.',
      clientId: makeId('c', 7),
      entity: 'LTA',
      status: 'Draft',
      requestedBy: makeId('u', 2),
      assignedTo: null,
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: today,
      updatedAt: today
    },
    {
      id: makeId('wr', 6),
      title: 'Payroll Tax Compliance',
      description: 'Annualized withholding tax on compensation review and correction.',
      clientId: makeId('c', 6),
      entity: 'LTA',
      status: 'Cancelled',
      requestedBy: makeId('u', 2),
      assignedTo: makeId('u', 5),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    {
      id: makeId('wr', 7),
      title: 'Business Permit Renewal 2026',
      description: 'Local Government Unit (LGU) business permit renewal process.',
      clientId: makeId('c', 1),
      entity: 'ATA',
      status: 'Processing',
      requestedBy: makeId('u', 1),
      assignedTo: makeId('u', 6),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    {
      id: makeId('wr', 8),
      title: 'SEC GIS Filing 2026',
      description: 'General Information Sheet filing with the Securities and Exchange Commission.',
      clientId: makeId('c', 7),
      entity: 'LTA',
      status: 'Pre-processing',
      requestedBy: makeId('u', 4),
      assignedTo: makeId('u', 7),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: today,
      updatedAt: today
    },
    {
      id: makeId('wr', 9),
      title: 'Apex Setup Phase 1',
      description: 'Initial tax mapping and consulting setup.',
      clientId: makeId('c', 11),
      entity: 'ATA',
      status: 'Cancelled',
      requestedBy: makeId('u', 2),
      assignedTo: makeId('u', 4),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    {
      id: makeId('wr', 10),
      title: 'Summit Financial Audit',
      description: 'Staged financial audit of local accounts.',
      clientId: makeId('c', 12),
      entity: 'LTA',
      status: 'Cancelled',
      requestedBy: makeId('u', 3),
      assignedTo: makeId('u', 5),
      linkedInvoiceId: null,
      linkedDisbursementIds: [],
      linkedTransmittalIds: [],
      createdAt: lastMonth,
      updatedAt: now
    }
  ],

  tasks: [
    {
      id: makeId('t', 994),
      workRequestId: makeId('wr', 102),
      title: 'Complete assessment review',
      description: 'Review is done.',
      status: 'Completed',
      assigneeId: makeId('u', 4),
      predecessors: [],
      dueDate: today,
      timeLogs: [
        { startTime: '09:00', endTime: '11:30', date: today, hours: 2.5, userId: makeId('u', 4), note: 'Reviewed assessment documents for Manila Fresh Foods Inc.' }
      ],
      taskDocuments: [],
      createdAt: today,
      updatedAt: today
    },
    {
      id: makeId('t', 991),
      workRequestId: makeId('wr', 101),
      title: 'Review initial documentation',
      description: 'Check for completeness.',
      status: 'Pending',
      assigneeId: makeId('u', 4),
      predecessors: [],
      dueDate: today,
      timeLogs: [
        { startTime: '13:00', endTime: '15:15', date: today, hours: 2.25, userId: makeId('u', 4), note: 'Initial review of documentation completeness' }
      ],
      taskDocuments: [],
      createdAt: today,
      updatedAt: today
    },
    {
      id: makeId('t', 992),
      workRequestId: makeId('wr', 101),
      title: 'Process compliance',
      description: 'Ensure compliance with LTA/ATA standards.',
      status: 'In Progress',
      assigneeId: makeId('u', 5),
      predecessors: [],
      dueDate: today,
      timeLogs: [
        { startTime: '09:30', endTime: '12:00', date: today, hours: 2.5, userId: makeId('u', 5), note: 'Reviewed compliance documents' },
        { startTime: '14:00', endTime: '16:00', date: yesterday, hours: 2.0, userId: makeId('u', 5), note: 'LTA compliance checklist review' }
      ],
      taskDocuments: [],
      createdAt: today,
      updatedAt: today
    },
    {
      id: makeId('t', 993),
      workRequestId: makeId('wr', 99),
      title: 'Draft VAT Return',
      description: 'Drafting the VAT return.',
      status: 'Pending',
      assigneeId: makeId('u', 4),
      predecessors: [],
      dueDate: inThreeDays,
      timeLogs: [],
      taskDocuments: [],
      createdAt: today,
      updatedAt: today
    },
    // Work Request 1 - Annual Tax Filing 2025 (ATA)
    {
      id: makeId('t', 1),
      workRequestId: makeId('wr', 1),
      title: 'Gather source documents',
      description: 'Collect all receipts, invoices, and financial records from client.',
      status: 'Completed',
      assigneeId: makeId('u', 4),
      predecessors: [],
      dueDate: lastMonth,
      timeLogs: [
        { startTime: '09:00', endTime: '12:30', date: lastWeek, hours: 3.5, userId: makeId('u', 4), note: 'Gathering and sorting client receipts' }
      ],
      taskDocuments: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    {
      id: makeId('t', 2),
      workRequestId: makeId('wr', 1),
      title: 'Encode trial balance',
      description: 'Input client trial balance into accounting software.',
      status: 'Completed',
      assigneeId: makeId('u', 4),
      predecessors: [makeId('t', 1)],
      dueDate: lastWeek,
      timeLogs: [
        { startTime: '13:00', endTime: '16:15', date: lastWeek, hours: 3.25, userId: makeId('u', 4), note: 'Encoding trial balance' }
      ],
      taskDocuments: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    {
      id: makeId('t', 3),
      workRequestId: makeId('wr', 1),
      title: 'Prepare tax schedules',
      description: 'Build detailed tax computation schedules and supporting docs.',
      status: 'In Progress',
      assigneeId: makeId('u', 4),
      predecessors: [makeId('t', 2)],
      dueDate: today,
      timeLogs: [
        { startTime: '10:00', endTime: '12:30', date: today, hours: 2.5, userId: makeId('u', 4), note: 'Drafted annual tax schedules' }
      ],
      taskDocuments: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    // Work Request 2 - Monthly Bookkeeping (ATA)
    {
      id: makeId('t', 4),
      workRequestId: makeId('wr', 2),
      title: 'Reconcile bank statements',
      description: 'Match bank transactions with internal records.',
      status: 'Completed',
      assigneeId: makeId('u', 4),
      predecessors: [],
      dueDate: lastMonth,
      timeLogs: [
        { startTime: '10:00', endTime: '12:00', date: lastWeek, hours: 2.0, userId: makeId('u', 4), note: 'Reconciled bank statements' }
      ],
      taskDocuments: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    {
      id: makeId('t', 5),
      workRequestId: makeId('wr', 2),
      title: 'Generate financial reports',
      description: 'Produce income statement and balance sheet for review.',
      status: 'Completed',
      assigneeId: makeId('u', 4),
      predecessors: [makeId('t', 4)],
      dueDate: lastWeek,
      timeLogs: [
        { startTime: '13:30', endTime: '15:30', date: lastWeek, hours: 2.0, userId: makeId('u', 4), note: 'Generated financial reports' }
      ],
      taskDocuments: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    {
      id: makeId('t', 6),
      workRequestId: makeId('wr', 2),
      title: 'Client review meeting',
      description: 'Present reports to client and obtain sign-off.',
      status: 'Completed',
      assigneeId: makeId('u', 3),
      predecessors: [makeId('t', 5)],
      dueDate: lastWeek,
      timeLogs: [],
      taskDocuments: [],
      createdAt: lastMonth,
      updatedAt: now
    },
    // Work Request 3 - VAT Compliance Review (ATA)
    {
      id: makeId('t', 7),
      workRequestId: makeId('wr', 3),
      title: 'Extract VAT summary',
      description: 'Pull VAT input and output data from accounting system.',
      status: 'Completed',
      assigneeId: makeId('u', 4),
      predecessors: [],
      dueDate: lastWeek,
      timeLogs: [],
      taskDocuments: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    {
      id: makeId('t', 8),
      workRequestId: makeId('wr', 3),
      title: 'Cross-check with 2550Q returns',
      description: 'Validate quarterly VAT return figures against ledgers.',
      status: 'For Review',
      assigneeId: makeId('u', 4),
      predecessors: [makeId('t', 7)],
      dueDate: today,
      timeLogs: [
        { startTime: '14:00', endTime: '16:45', date: today, hours: 2.75, userId: makeId('u', 4), note: 'Cross-checked ledger with eBIR form 2550Q' }
      ],
      taskDocuments: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    {
      id: makeId('t', 9),
      workRequestId: makeId('wr', 3),
      title: 'Prepare compliance memo',
      description: 'Draft findings memo with recommendations for client.',
      status: 'Draft',
      assigneeId: makeId('u', 3),
      predecessors: [makeId('t', 8)],
      dueDate: today,
      timeLogs: [],
      taskDocuments: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    // Work Request 4 - Audited Financial Statements (LTA)
    {
      id: makeId('t', 10),
      workRequestId: makeId('wr', 4),
      title: 'Send PBC list to client',
      description: 'Request prepared-by-client documents and confirmations.',
      status: 'Completed',
      assigneeId: makeId('u', 5),
      predecessors: [],
      dueDate: lastWeek,
      timeLogs: [
        { startTime: '09:00', endTime: '11:30', date: lastWeek, hours: 2.5, userId: makeId('u', 5), note: 'Sent out PBC list to client contacts' }
      ],
      taskDocuments: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    {
      id: makeId('t', 11),
      workRequestId: makeId('wr', 4),
      title: 'Perform analytical review',
      description: 'Compare current year ratios and balances against prior year.',
      status: 'In Progress',
      assigneeId: makeId('u', 5),
      predecessors: [makeId('t', 10)],
      dueDate: today,
      timeLogs: [
        { startTime: '08:45', endTime: '11:45', date: today, hours: 3.0, userId: makeId('u', 5), note: 'Conducted analytical review on analytical assets' },
        { startTime: '13:30', endTime: '17:00', date: yesterday, hours: 3.5, userId: makeId('u', 5), note: 'Completed analytical review of revenue accounts' }
      ],
      taskDocuments: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    {
      id: makeId('t', 12),
      workRequestId: makeId('wr', 4),
      title: 'Draft audit report',
      description: 'Prepare independent auditor\'s report for partner review.',
      status: 'Assigned',
      assigneeId: makeId('u', 5),
      predecessors: [makeId('t', 11)],
      dueDate: today,
      timeLogs: [],
      taskDocuments: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    // Work Request 5 - Quarterly Tax Filing Q1 2025 (LTA)
    {
      id: makeId('t', 13),
      workRequestId: makeId('wr', 5),
      title: 'Verify gross revenue figures',
      description: 'Confirm Q1 gross revenue with client finance team.',
      status: 'Draft',
      assigneeId: null,
      predecessors: [],
      dueDate: today,
      timeLogs: [],
      taskDocuments: [],
      createdAt: today,
      updatedAt: today
    },
    {
      id: makeId('t', 14),
      workRequestId: makeId('wr', 5),
      title: 'Compute percentage tax due',
      description: 'Calculate 3% percentage tax on gross sales/receipts.',
      status: 'Draft',
      assigneeId: null,
      predecessors: [makeId('t', 13)],
      dueDate: today,
      timeLogs: [],
      taskDocuments: [],
      createdAt: today,
      updatedAt: today
    },
    {
      id: makeId('t', 15),
      workRequestId: makeId('wr', 5),
      title: 'File 2551Q via eBIR',
      description: 'Submit quarterly percentage tax return electronically.',
      status: 'Draft',
      assigneeId: null,
      predecessors: [makeId('t', 14)],
      dueDate: today,
      timeLogs: [],
      taskDocuments: [],
      createdAt: today,
      updatedAt: today
    },
    // Work Request 7 - Business Permit Renewal (ATA)
    {
      id: makeId('t', 16),
      workRequestId: makeId('wr', 7),
      title: 'Assess LGU requirements',
      description: 'Gather necessary documents for business permit renewal.',
      status: 'In Progress',
      assigneeId: makeId('u', 6),
      predecessors: [],
      dueDate: today,
      timeLogs: [],
      taskDocuments: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    {
      id: makeId('t', 17),
      workRequestId: makeId('wr', 7),
      title: 'Submit application to City Hall',
      description: 'Process and file the business permit renewal physically.',
      status: 'Draft',
      assigneeId: makeId('u', 6),
      predecessors: [makeId('t', 16)],
      dueDate: today,
      timeLogs: [],
      taskDocuments: [],
      createdAt: lastWeek,
      updatedAt: now
    },
    // Work Request 8 - SEC GIS Filing (LTA)
    {
      id: makeId('t', 18),
      workRequestId: makeId('wr', 8),
      title: 'Draft GIS 2026',
      description: 'Prepare the General Information Sheet for review.',
      status: 'For Review',
      assigneeId: makeId('u', 7),
      predecessors: [],
      dueDate: today,
      timeLogs: [],
      taskDocuments: [],
      createdAt: today,
      updatedAt: today
    },
    {
      id: makeId('t', 19),
      workRequestId: makeId('wr', 8),
      title: 'Upload GIS via eFAST',
      description: 'Upload the signed and notarized GIS through the SEC portal.',
      status: 'Draft',
      assigneeId: makeId('u', 7),
      predecessors: [makeId('t', 18)],
      dueDate: today,
      timeLogs: [],
      taskDocuments: [],
      createdAt: today,
      updatedAt: today
    }
  ],

  invoices: [
    {
      id: makeId('inv', 1),
      clientId: makeId('c', 1),
      entity: 'ATA',
      workRequestId: makeId('wr', 1),
      invoiceNumber: 'ATA-SI-2025-001',
      issueDate: lastWeek,
      dueDate: today,
      status: 'Sent',
      lineItems: [
        { description: 'Professional Fee - Annual Tax Filing', amount: 45000.00, type: 'Professional Fee' },
        { description: 'BIR DST', amount: 150.00, type: 'Government Fee' },
        { description: 'SEC Filing Fee', amount: 500.00, type: 'Government Fee' }
      ],
      subtotal: 45650.00,
      vat: 0,
      total: 45650.00,
      paidAmount: 0.00,
      payments: [],
      createdBy: makeId('u', 3),
      createdAt: lastWeek,
      updatedAt: lastWeek
    },
    {
      id: makeId('inv', 2),
      clientId: makeId('c', 3),
      entity: 'ATA',
      workRequestId: makeId('wr', 2),
      invoiceNumber: 'ATA-SI-2025-002',
      issueDate: lastMonth,
      dueDate: lastWeek,
      status: 'Paid',
      lineItems: [
        { description: 'Professional Fee - Monthly Bookkeeping (Retainer)', amount: 15000.00, type: 'Professional Fee' }
      ],
      subtotal: 15000.00,
      vat: 0,
      total: 15000.00,
      paidAmount: 15000.00,
      payments: [
        { amount: 15000.00, method: 'Cash', reference: 'Migrated', date: lastWeek, recordedBy: '' }
      ],
      createdBy: makeId('u', 3),
      createdAt: lastMonth,
      updatedAt: lastWeek
    },
    {
      id: makeId('inv', 5),
      clientId: makeId('c', 2),
      entity: 'ATA',
      workRequestId: makeId('wr', 3),
      invoiceNumber: 'ATA-SI-2025-003',
      issueDate: lastWeek,
      dueDate: today,
      status: 'Sent',
      lineItems: [
        { description: 'Professional Fee - VAT Compliance Review', amount: 25000.00, type: 'Professional Fee' },
        { description: 'BIR eFile Access Fee', amount: 200.00, type: 'Government Fee' }
      ],
      subtotal: 25200.00,
      vat: 0,
      total: 25200.00,
      paidAmount: 0.00,
      payments: [],
      createdBy: makeId('u', 3),
      createdAt: lastWeek,
      updatedAt: lastWeek
    },
    {
      id: makeId('inv', 3),
      clientId: makeId('c', 5),
      entity: 'LTA',
      invoiceNumber: 'LTA-SI-2025-001',
      issueDate: lastWeek,
      dueDate: today,
      status: 'Partially Paid',
      lineItems: [
        { description: 'Professional Fee - Audit Engagement', amount: 85000.00, type: 'Professional Fee' },
        { description: 'SEC Filing Fee', amount: 1000.00, type: 'Government Fee' },
        { description: 'PCC Fee', amount: 800.00, type: 'Government Fee' }
      ],
      subtotal: 86800.00,
      vat: 0,
      total: 86800.00,
      paidAmount: 48500.00,
      payments: [
        { amount: 48500.00, method: 'Cash', reference: 'Migrated', date: lastWeek, recordedBy: '' }
      ],
      createdBy: makeId('u', 3),
      createdAt: lastWeek,
      updatedAt: lastWeek
    },
    {
      id: makeId('inv', 4),
      clientId: makeId('c', 7),
      entity: 'LTA',
      invoiceNumber: 'LTA-SI-2025-002',
      issueDate: today,
      dueDate: today,
      status: 'Draft',
      lineItems: [
        { description: 'Professional Fee - Quarterly Tax Filing Q1', amount: 22000.00, type: 'Professional Fee' },
        { description: 'BIR eFiling Fee', amount: 100.00, type: 'Government Fee' }
      ],
      subtotal: 22100.00,
      vat: 0,
      total: 22100.00,
      paidAmount: 0.00,
      payments: [],
      createdBy: makeId('u', 3),
      createdAt: today,
      updatedAt: today
    }
  ],

  disbursements: [
    {
      id: makeId('d', 100),
      category: 'Representation',
      description: 'Completed representation expense (Mock)',
      amount: 4500.00,
      fundSource: 'Company Fund',
      linkedInvoiceId: null,
      linkedWorkRequestId: makeId('wr', 102),
      entity: 'ATA',
      employeeId: makeId('u', 4),
      requestedBy: makeId('u', 4),
      status: 'Released',
      submittedAt: today,
      dueDate: today,
      accountingApprovedBy: makeId('u', 1),
      paymentHandledBy: makeId('u', 1),
      paymentDetails: { method: 'Cash', reference: 'VOU-001', bank: '', date: today, processedBy: makeId('u', 1) },
      updatedAt: today
    },
    {
      id: makeId('d', 99),
      category: 'Travel',
      description: 'Client visit travel expenses (Mock)',
      amount: 1200.00,
      fundSource: 'Petty Cash',
      linkedInvoiceId: null,
      linkedWorkRequestId: makeId('wr', 99),
      entity: 'ATA',
      employeeId: makeId('u', 4),
      requestedBy: makeId('u', 4),
      status: 'Approved',
      submittedAt: today,
      dueDate: inFiveDays,
      accountingApprovedBy: makeId('u', 1),
      paymentHandledBy: makeId('u', 1),
      paymentDetails: { method: '', reference: '', bank: '', date: '', processedBy: '' },
      updatedAt: today
    },
    {
      id: makeId('d', 1),
      category: 'Government Fee',
      description: 'BIR Documentary Stamp Tax payment',
      amount: 150.00,
      fundSource: 'Client Fund',
      linkedInvoiceId: makeId('inv', 1),
      linkedWorkRequestId: makeId('wr', 1),
      entity: 'ATA',
      employeeId: makeId('u', 4),
      requestedBy: makeId('u', 4),
      status: 'Released',
      submittedAt: lastWeek,
      accountingApprovedBy: makeId('u', 3),
      releasedAt: lastWeek,
      receiptFilename: 'bir-dst-receipt.pdf',
      paymentHandledBy: makeId('u', 3),
      paymentDetails: { method: 'Cash', reference: '', bank: '', date: lastWeek, processedBy: makeId('u', 3) }
    },
    {
      id: makeId('d', 2),
      category: 'Government Fee',
      description: 'SEC Filing Fee payment',
      amount: 500.00,
      fundSource: 'Client Fund',
      linkedInvoiceId: makeId('inv', 1),
      linkedWorkRequestId: makeId('wr', 1),
      entity: 'ATA',
      employeeId: makeId('u', 4),
      requestedBy: makeId('u', 4),
      status: 'Released',
      submittedAt: lastWeek,
      accountingApprovedBy: makeId('u', 3),
      releasedAt: lastWeek,
      receiptFilename: 'sec-filing-receipt.pdf',
      paymentHandledBy: makeId('u', 3),
      paymentDetails: { method: 'Cash', reference: '', bank: '', date: lastWeek, processedBy: makeId('u', 3) }
    },
    {
      id: makeId('d', 3),
      category: 'Other',
      description: 'Office supplies procurement',
      amount: 3250.00,
      fundSource: 'Firm Fund',
      linkedInvoiceId: null,
      entity: 'ATA',
      employeeId: makeId('u', 6),
      requestedBy: makeId('u', 6),
      status: 'Approved',
      submittedAt: lastWeek,
      managerApprovedBy: makeId('u', 2),
      accountingApprovedBy: makeId('u', 3),
      releasedAt: null,
      receiptFilename: 'office-supplies.pdf',
      paymentHandledBy: '',
      paymentDetails: { method: '', reference: '', bank: '', date: '', processedBy: '' }
    },
    {
      id: makeId('d', 4),
      category: 'Government Fee',
      description: 'SEC Filing Fee for audited FS',
      amount: 1000.00,
      fundSource: 'Client Fund',
      linkedInvoiceId: makeId('inv', 3),
      entity: 'LTA',
      employeeId: makeId('u', 5),
      requestedBy: makeId('u', 5),
      status: 'Submitted',
      submittedAt: lastWeek,
      releasedAt: null,
      receiptFilename: null,
      paymentHandledBy: '',
      paymentDetails: { method: '', reference: '', bank: '', date: '', processedBy: '' }
    },
    {
      id: makeId('d', 5),
      category: 'Transportation',
      description: 'Transportation allowance - field audit',
      amount: 1800.00,
      fundSource: 'Firm Fund',
      linkedInvoiceId: null,
      entity: 'LTA',
      employeeId: makeId('u', 5),
      requestedBy: makeId('u', 5),
      status: 'Released',
      submittedAt: lastWeek,
      managerApprovedBy: makeId('u', 2),
      accountingApprovedBy: makeId('u', 3),
      releasedAt: lastWeek,
      receiptFilename: 'transportation-allowance.pdf',
      paymentHandledBy: makeId('u', 3),
      paymentDetails: { method: 'Cash', reference: '', bank: '', date: lastWeek, processedBy: makeId('u', 3) }
    },
    {
      id: makeId('d', 6),
      category: 'Other',
      description: 'Employee training seminar fee',
      amount: 12500.00,
      fundSource: 'Firm Fund',
      linkedInvoiceId: null,
      entity: 'LTA',
      employeeId: makeId('u', 9),
      requestedBy: makeId('u', 9),
      status: 'Under Review',
      submittedAt: lastWeek,
      managerApprovedBy: makeId('u', 2),
      releasedAt: null,
      receiptFilename: null,
      paymentHandledBy: '',
      paymentDetails: { method: '', reference: '', bank: '', date: '', processedBy: '' }
    }
  ],

  documents: [
    {
      id: makeId('doc', 1),
      fileName: 'BIR-2303-ManilaFresh.pdf',
      workRequestId: makeId('wr', 1),
      document_type: 'original_scan',
      category: 'Requirement Docs',
      uploader: makeId('u', 4),
      uploadDate: lastMonth,
      description: 'BIR Form 2303 copy for reference.',
      handover_log: [
        { handed_to: 'Juan dela Cruz', handed_date: lastMonth, method: 'In-Person' }
      ],
      entity: 'ATA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 2),
      fileName: 'Articles-of-Incorporation-ManilaFresh.pdf',
      workRequestId: makeId('wr', 1),
      document_type: 'generated_copy',
      category: 'Requirement Docs',
      uploader: makeId('u', 4),
      uploadDate: lastMonth,
      description: 'Certified copy of Articles of Incorporation.',
      handover_log: [],
      entity: 'ATA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 3),
      fileName: 'AFS-2024-DavaoAgri.pdf',
      workRequestId: makeId('wr', 2),
      document_type: 'original_scan',
      category: 'Final Deliverables',
      uploader: makeId('u', 4),
      uploadDate: lastWeek,
      description: 'Signed audited financial statements.',
      handover_log: [
        { handed_to: 'Ricardo Reyes', handed_date: lastWeek, method: 'Courier' }
      ],
      entity: 'ATA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 4),
      fileName: 'GIS-2024-DavaoAgri.pdf',
      workRequestId: makeId('wr', 2),
      document_type: 'original_scan',
      category: 'Processed Forms',
      uploader: makeId('u', 4),
      uploadDate: lastWeek,
      description: 'GIS 2024 submission copy.',
      handover_log: [
        { handed_to: 'Ricardo Reyes', handed_date: lastWeek, method: 'In-Person' }
      ],
      entity: 'ATA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 5),
      fileName: 'BIR-1701-ManilaFresh.pdf',
      workRequestId: makeId('wr', 1),
      document_type: 'generated_copy',
      category: 'Processed Forms',
      uploader: makeId('u', 4),
      uploadDate: lastWeek,
      description: 'Annual ITR filing copy.',
      handover_log: [],
      entity: 'ATA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 6),
      fileName: 'Bank-Recon-Feb-2025.pdf',
      workRequestId: makeId('wr', 2),
      document_type: 'generated_copy',
      category: 'Final Deliverables',
      uploader: makeId('u', 4),
      uploadDate: lastWeek,
      description: 'Bank reconciliation for Feb 2025.',
      handover_log: [],
      entity: 'ATA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 7),
      fileName: 'BIR-2303-BatangasIndustrial.pdf',
      workRequestId: makeId('wr', 4),
      document_type: 'original_scan',
      category: 'Requirement Docs',
      uploader: makeId('u', 5),
      uploadDate: lastMonth,
      description: 'BIR Form 2303 original scan.',
      handover_log: [
        { handed_to: 'Pedro Garcia', handed_date: lastMonth, method: 'Pickup' }
      ],
      entity: 'LTA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 8),
      fileName: 'AFS-2024-BatangasIndustrial.pdf',
      workRequestId: makeId('wr', 4),
      document_type: 'generated_copy',
      category: 'Final Deliverables',
      uploader: makeId('u', 5),
      uploadDate: lastWeek,
      description: 'Audit engagement deliverable copy.',
      handover_log: [],
      entity: 'LTA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 9),
      fileName: 'GIS-2024-PampangaRetailers.pdf',
      workRequestId: makeId('wr', 5),
      document_type: 'original_scan',
      category: 'Processed Forms',
      uploader: makeId('u', 5),
      uploadDate: lastMonth,
      description: 'GIS 2024 original scan.',
      handover_log: [
        { handed_to: 'Carlos Mendoza', handed_date: lastMonth, method: 'Courier' }
      ],
      entity: 'LTA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 10),
      fileName: 'BIR-2551Q-Q4-2024.pdf',
      workRequestId: makeId('wr', 5),
      document_type: 'generated_copy',
      category: 'Government Receipts',
      uploader: makeId('u', 5),
      uploadDate: lastWeek,
      description: 'Filed 2551Q copy for Q4 2024.',
      handover_log: [],
      entity: 'LTA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 11),
      fileName: 'ASM-Minutes-2024-BatangasIndustrial.pdf',
      workRequestId: makeId('wr', 4),
      document_type: 'original_scan',
      category: 'Requirement Docs',
      uploader: makeId('u', 5),
      uploadDate: lastMonth,
      description: 'Minutes of annual stockholders meeting.',
      handover_log: [
        { handed_to: 'Pedro Garcia', handed_date: lastMonth, method: 'In-Person' }
      ],
      entity: 'LTA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 12),
      fileName: 'Payroll-Register-Mar-2025.pdf',
      workRequestId: makeId('wr', 6),
      document_type: 'generated_copy',
      category: 'Other',
      uploader: makeId('u', 5),
      uploadDate: lastWeek,
      description: 'Payroll register for March 2025.',
      handover_log: [],
      entity: 'LTA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: ''
    },
    {
      id: makeId('doc', 13),
      fileName: 'Apex-Tax-Plan-2025.pdf',
      workRequestId: makeId('wr', 9),
      document_type: 'original_scan',
      category: 'Requirement Docs',
      uploader: makeId('u', 4),
      uploadDate: lastMonth,
      description: 'Archived draft tax planning paper.',
      handover_log: [],
      entity: 'ATA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: '',
      status: 'Archived',
      archived: true
    },
    {
      id: makeId('doc', 14),
      fileName: 'Summit-Trial-Balance.xlsx',
      workRequestId: makeId('wr', 10),
      document_type: 'original_scan',
      category: 'Requirement Docs',
      uploader: makeId('u', 5),
      uploadDate: lastMonth,
      description: 'Archived preliminary trial balance.',
      handover_log: [],
      entity: 'LTA',
      dataUrl: '',
      versions: [],
      comments: [],
      documentLifecycle: 'collected',
      scannedBy: '',
      envelopeId: '',
      storedLocation: '',
      status: 'Archived',
      archived: true
    }
  ],

  retainerTemplates: [
    {
      id: makeId('rt', 1),
      name: 'Monthly Bookkeeping',
      description: 'Standard monthly bookkeeping package including bank reconciliation, expense coding, and financial report generation.',
      entity: 'ATA',
      clientId: makeId('c', 3),
      schedule: 'monthly',
      pfAmount: 15000.00,
      tasks: [
        { id: makeId('rtt', 1), title: 'Reconcile bank statements', predecessors: [] },
        { id: makeId('rtt', 2), title: 'Encode transactions', predecessors: [makeId('rtt', 1)] },
        { id: makeId('rtt', 3), title: 'Generate financial reports', predecessors: [makeId('rtt', 2)] },
        { id: makeId('rtt', 4), title: 'Client review meeting', predecessors: [makeId('rtt', 3)] }
      ],
      createdAt: now
    },
    {
      id: makeId('rt', 2),
      name: 'Quarterly Tax Filing',
      description: 'Quarterly percentage tax and income tax return preparation and electronic filing.',
      entity: 'LTA',
      clientId: makeId('c', 7),
      schedule: 'quarterly',
      pfAmount: 22000.00,
      tasks: [
        { id: makeId('rtt', 5), title: 'Verify gross revenue figures', predecessors: [] },
        { id: makeId('rtt', 6), title: 'Compute percentage tax due', predecessors: [makeId('rtt', 5)] },
        { id: makeId('rtt', 7), title: 'Prepare 2551Q / 1701Q', predecessors: [makeId('rtt', 6)] },
        { id: makeId('rtt', 8), title: 'File via eBIR Forms', predecessors: [makeId('rtt', 7)] }
      ],
      createdAt: now
    }
  ],

  auditLog: [
    {
      id: makeId('al', 1),
      action: 'LOGIN',
      entity: 'ATA',
      userId: makeId('u', 1),
      details: 'Admin logged in from Chrome on Windows',
      timestamp: lastMonth + 'T08:30:00Z'
    },
    {
      id: makeId('al', 2),
      action: 'WORK_REQUEST_CREATED',
      entity: 'ATA',
      userId: makeId('u', 1),
      details: 'Created work request WR-0001: Annual Tax Filing 2025',
      timestamp: lastMonth + 'T09:15:00Z'
    },
    {
      id: makeId('al', 3),
      action: 'TASK_COMPLETED',
      entity: 'ATA',
      userId: makeId('u', 4),
      details: 'Completed task T-0001: Gather source documents for WR-0001',
      timestamp: lastMonth + 'T14:20:00Z'
    },
    {
      id: makeId('al', 4),
      action: 'INVOICE_SENT',
      entity: 'ATA',
      userId: makeId('u', 3),
      details: 'Sent invoice ATA-INV-2025-001 to Manila Fresh Foods Inc.',
      timestamp: lastWeek + 'T10:00:00Z'
    },
    {
      id: makeId('al', 5),
      action: 'DISBURSEMENT_RELEASED',
      entity: 'ATA',
      userId: makeId('u', 3),
      details: 'Released BIR DST payment of P150.00 for client C-0001',
      timestamp: lastWeek + 'T11:30:00Z'
    },
    {
      id: makeId('al', 6),
      action: 'LOGIN',
      entity: 'LTA',
      userId: makeId('u', 2),
      details: 'Manager logged in from Firefox on macOS',
      timestamp: lastWeek + 'T08:45:00Z'
    },
    {
      id: makeId('al', 7),
      action: 'WORK_REQUEST_CREATED',
      entity: 'LTA',
      userId: makeId('u', 2),
      details: 'Created work request WR-0005: Quarterly Tax Filing Q1 2025',
      timestamp: today + 'T09:00:00Z'
    },
    {
      id: makeId('al', 8),
      action: 'DOCUMENT_STORED',
      entity: 'LTA',
      userId: makeId('u', 8),
      details: 'Stored original DOC-0007 for Batangas Industrial Group in Vault A',
      timestamp: lastMonth + 'T16:00:00Z'
    },
    {
      id: makeId('al', 9),
      action: 'DISBURSEMENT_SUBMITTED',
      entity: 'LTA',
      userId: makeId('u', 5),
      details: 'Submitted SEC Filing Fee disbursement of P1,000.00 for client C-0005',
      timestamp: lastWeek + 'T13:15:00Z'
    },
    {
      id: makeId('al', 10),
      action: 'LOGOUT',
      entity: 'ATA',
      userId: makeId('u', 1),
      details: 'Admin logged out',
      timestamp: lastWeek + 'T17:00:00Z'
    }
  ],

  pendingChanges: [],
  transmittals: [],
  billingTemplates: [],
  disbursementTemplates: []
};

// Seed derived/default fields for Phase 1.
(function seedTaskChecklists() {
  seedData.tasks.forEach(t => {
    const titleLower = (t.title || '').toLowerCase();
    if (titleLower.includes('requirement') || titleLower.includes('gather')) {
      t.checklist = defaultRequirementChecklist(t.id);
    } else if (!Array.isArray(t.checklist)) {
      t.checklist = [];
    }
  });
})();

(function seedTaskTimeLogAttribution() {
  const userNameById = Object.fromEntries(seedData.users.map(u => [u.id, u.name]));
  seedData.tasks.forEach(t => {
    if (!Array.isArray(t.timeLogs)) {
      t.timeLogs = [];
    }
    t.timeLogs.forEach(log => {
      if (!('loggedByUserId' in log) && log.userId) {
        log.loggedByUserId = log.userId;
      }
      if (!('workerName' in log)) {
        log.workerName = userNameById[log.userId || log.loggedByUserId] || t.assigneeName || 'Unknown';
      }
    });
  });
})();

(function seedTaskCoAssignees() {
  seedData.tasks.forEach(t => {
    if (!Array.isArray(t.coAssignees)) {
      t.coAssignees = [];
    }
  });
})();

// ============================================================
// LOCALSTORAGE DB API
// ============================================================

const DB = {
  SCHEMA_VERSION: 16,
  _pendingWrIdsCache: null,

  init() {
    const stored = localStorage.getItem('erp_schema_version');
    let oldVersion = stored ? parseInt(stored, 10) : 0;
    if (!stored || oldVersion !== this.SCHEMA_VERSION) {
      if (oldVersion === 2) {
        this.migrateV2ToV3();
        oldVersion = 3;
      }
      if (oldVersion > 0 && oldVersion < this.SCHEMA_VERSION) {
        if (oldVersion < 10) this.migrateV9ToV10();
        if (oldVersion < 11) this.migrateV10ToV11();
        if (oldVersion < 12) this.migrateV11ToV12();
        if (oldVersion < 13) this.migrateV12ToV13();
        if (oldVersion < 14) this.migrateV13ToV14();
        if (oldVersion < 15) this.migrateV14ToV15();
        if (oldVersion < 16) this.migrateV15ToV16();
      } else if (oldVersion === 0) {
        this.resetToSeed();
      }
    }
    this.ensureWorkRequestBoardOrder();
  },

  migrateV2ToV3() {
    // Migrate users: remove department
    const users = this.getAll('users');
    users.forEach(u => { delete u.department; });
    this.save('users', users);

    // Migrate clients: add new fields
    const clients = this.getAll('clients');
    clients.forEach(c => {
      c.tradeName = c.tradeName || '';
      c.contactUserId = c.contactUserId || '';
      c.relatedCompanies = c.relatedCompanies || [];
      c.contactDetails = c.contactDetails || [];
    });
    this.save('clients', clients);

    // Migrate workRequests: add linkage fields
    const workRequests = this.getAll('workRequests');
    workRequests.forEach(wr => {
      wr.linkedInvoiceId = wr.linkedInvoiceId || null;
      wr.linkedDisbursementIds = wr.linkedDisbursementIds || [];
      wr.linkedTransmittalIds = wr.linkedTransmittalIds || [];
    });
    this.save('workRequests', workRequests);

    // Migrate tasks: add taskDocuments, transform timeLogs
    const tasks = this.getAll('tasks');
    tasks.forEach(t => {
      t.taskDocuments = t.taskDocuments || [];
      if (Array.isArray(t.timeLogs)) {
        t.timeLogs = t.timeLogs.map(log => {
          if (log.startTime !== undefined) return log;
          const startTime = '09:00';
          const hours = parseFloat(log.hours) || 0;
          const endH = Math.floor(9 + hours);
          const endM = Math.round((9 + hours - endH) * 60);
          const endTime = String(endH).padStart(2, '0') + ':' + String(endM).padStart(2, '0');
          return { startTime, endTime, date: log.date || today, note: log.note || '', hours: log.hours };
        });
      } else {
        t.timeLogs = [];
      }
    });
    this.save('tasks', tasks);

    // Migrate invoices: remove VAT, recalculate totals, add payments/createdBy
    const invoices = this.getAll('invoices');
    invoices.forEach(inv => {
      inv.vat = 0;
      inv.total = inv.subtotal || 0;
      if (inv.lineItems) {
        inv.lineItems.forEach(li => { delete li.vatTreatment; });
      }
      inv.payments = inv.payments || [];
      if ((inv.paidAmount || 0) > 0 && inv.payments.length === 0) {
        inv.payments.push({
          amount: inv.paidAmount,
          method: 'Cash',
          reference: 'Migrated',
          date: inv.updatedAt || inv.issueDate || today,
          recordedBy: ''
        });
      }
      inv.createdBy = inv.createdBy || '';
      inv.paymentCollectedBy = inv.paymentCollectedBy || '';
    });
    this.save('invoices', invoices);

    // Migrate disbursements: add requestedBy, paymentHandledBy, paymentDetails
    const disbursements = this.getAll('disbursements');
    disbursements.forEach(d => {
      d.requestedBy = d.requestedBy || d.employeeId || '';
      d.paymentHandledBy = d.paymentHandledBy || '';
      d.paymentDetails = d.paymentDetails || { method: '', reference: '', bank: '', date: '', processedBy: '' };
    });
    this.save('disbursements', disbursements);

    // Migrate documents: add lifecycle fields
    const documents = this.getAll('documents');
    documents.forEach(doc => {
      doc.comments = doc.comments || [];
      doc.documentLifecycle = doc.documentLifecycle || 'collected';
      doc.scannedBy = doc.scannedBy || '';
      doc.envelopeId = doc.envelopeId || '';
      doc.storedLocation = doc.storedLocation || '';
    });
    this.save('documents', documents);

    // Initialize new tables
    if (!localStorage.getItem('erp_pendingChanges')) this.save('pendingChanges', []);
    if (!localStorage.getItem('erp_transmittals')) this.save('transmittals', []);
    if (!localStorage.getItem('erp_billingTemplates')) this.save('billingTemplates', []);
    if (!localStorage.getItem('erp_disbursementTemplates')) this.save('disbursementTemplates', []);

    localStorage.setItem('erp_schema_version', '3');
  },

  migrateV9ToV10() {
    const users = this.getAll('users');
    const userNameById = {};
    users.forEach(u => { userNameById[u.id] = u.name; });

    const tasks = this.getAll('tasks');
    tasks.forEach(t => {
      if (!Array.isArray(t.checklist)) {
        t.checklist = [];
      }
      if (!Array.isArray(t.timeLogs)) {
        t.timeLogs = [];
      }
      t.timeLogs.forEach(log => {
        if (!('loggedByUserId' in log) && log.userId) {
          log.loggedByUserId = log.userId;
        }
        if (!('workerName' in log)) {
          log.workerName = userNameById[log.userId || log.loggedByUserId] || t.assigneeName || 'Unknown';
        }
      });
    });
    this.save('tasks', tasks);

    if (!localStorage.getItem('erp_groundWorkers')) {
      this.save('groundWorkers', seedData.groundWorkers || []);
    }

    localStorage.setItem('erp_schema_version', '10');
  },

  migrateV10ToV11() {
    const tasks = this.getAll('tasks');
    tasks.forEach(t => {
      if (!Array.isArray(t.checklist)) {
        t.checklist = [];
      }
      t.checklist = t.checklist.map(item => {
        if (typeof item === 'string') {
          return { id: generateId('chk'), text: item, category: 'subtask', completed: false, assigneeId: null, assigneeName: null };
        }
        return {
          id: item.id || generateId('chk'),
          text: item.text || '',
          category: item.category || 'subtask',
          completed: !!item.completed,
          assigneeId: item.assigneeId || null,
          assigneeName: item.assigneeName || null
        };
      });
    });
    this.save('tasks', tasks);

    localStorage.setItem('erp_schema_version', String(this.SCHEMA_VERSION));
  },

  migrateV11ToV12() {
    const tasks = this.getAll('tasks');
    tasks.forEach(t => {
      if (!Array.isArray(t.timeLogs)) {
        t.timeLogs = [];
      }
      if (!Array.isArray(t.checklist)) {
        t.checklist = [];
      }
      if (!Array.isArray(t.coAssignees)) {
        t.coAssignees = [];
      }
      t.checklist.forEach(item => {
        if (!item.id) item.id = generateId('chk');
        item.dependsOn = item.dependsOn || null;
        item.timeLogs = item.timeLogs || [];
      });
    });
    this.save('tasks', tasks);

    localStorage.setItem('erp_schema_version', '12');
  },

  migrateV12ToV13() {
    if (!localStorage.getItem('erp_operationsRequests')) {
      this.save('operationsRequests', []);
    }
    localStorage.setItem('erp_schema_version', '13');
  },

  migrateV13ToV14() {
    this.ensureWorkRequestBoardOrder();
    localStorage.setItem('erp_schema_version', '14');
  },

  migrateV14ToV15() {
    // Seed departments table if missing
    if (!localStorage.getItem('erp_departments')) {
      const defaultDepartments = (seedData.departments || [])
        .map(name => ({ id: 'dept-' + name.toLowerCase().replace(/\s+/g, '-'), name }));
      this.save('departments', defaultDepartments);
    }

    // Back-fill departments for legacy users based on their role.
    const roleToDept = {
      Admin: 'Administration',
      Manager: 'Management',
      Accounting: 'Accounting',
      Operations: 'Operations',
      Documentation: 'Documentation',
      HR: 'HR'
    };
    const users = this.getAll('users').map(u => {
      const normalized = Array.isArray(u.departments) ? u.departments : [];
      if (normalized.length === 0 && roleToDept[u.role]) {
        return { ...u, departments: [roleToDept[u.role]] };
      }
      return { ...u, departments: normalized };
    });
    this.save('users', users);

    localStorage.setItem('erp_schema_version', '15');
  },

  migrateV15ToV16() {
    this.resetToSeed();
  },

  ensureWorkRequestBoardOrder() {
    const wrs = this.getAll('workRequests');
    const hasMissing = wrs.some(wr => typeof wr.boardOrder !== 'number');
    if (!hasMissing) return;
    const sorted = [...wrs].sort((a, b) => {
      const ta = new Date(a.createdAt || 0).getTime();
      const tb = new Date(b.createdAt || 0).getTime();
      if (ta !== tb) return ta - tb;
      return String(a.id).localeCompare(String(b.id));
    });
    const orderById = new Map();
    sorted.forEach((wr, i) => { orderById.set(wr.id, (i + 1) * 1000); });
    const updated = wrs.map(wr => {
      const clean = { ...wr };
      delete clean.isPendingApproval;
      if (typeof clean.boardOrder !== 'number') {
        clean.boardOrder = orderById.get(wr.id);
      }
      return clean;
    });
    this.save('workRequests', updated);
  },

  getAll(table) {
    let records = JSON.parse(localStorage.getItem('erp_' + table) || '[]');
    if (table === 'workRequests' && records.length > 0) {
      records = records.map(r => ({ ...r }));
      if (!this._pendingWrIdsCache) {
        const pcStr = localStorage.getItem('erp_pendingChanges') || '[]';
        try {
          const pcs = JSON.parse(pcStr);
          this._pendingWrIdsCache = new Set(
            pcs.filter(pc => pc.status === 'pending' && pc.table === 'workRequests' && pc.proposedData)
               .map(pc => pc.proposedData.id || pc.proposedData.key || pc.proposedData.workRequestId)
               .filter(Boolean)
          );
        } catch (e) {
          this._pendingWrIdsCache = new Set();
        }
      }
      records.forEach(r => {
        if (this._pendingWrIdsCache.has(r.id)) {
          r.isPendingApproval = true;
        }
      });
    }
    return records;
  },

  getById(table, id) {
    if (typeof PendingChanges !== 'undefined' && PendingChanges.editingPendingId) {
      const pc = this.getAll('pendingChanges').find(p => p.id === PendingChanges.editingPendingId);
      if (pc && pc.table === table && (pc.parentRecordId === id || (pc.proposedData && pc.proposedData.id === id))) {
        return pc.proposedData;
      }
    }
    return this.getAll(table).find(r => r.id === id);
  },

  getWhere(table, filterFn) {
    return this.getAll(table).filter(filterFn);
  },

  save(table, records) {
    localStorage.setItem('erp_' + table, JSON.stringify(records));
  },

  insert(table, record) {
    this._pendingWrIdsCache = null;
    const all = this.getAll(table);
    const cleanRecord = { ...record };
    if (table === 'workRequests') {
      delete cleanRecord.isPendingApproval;
    }
    const trackedTables = ['workRequests', 'invoices', 'disbursements', 'transmittals'];
    if (trackedTables.includes(table) && typeof cleanRecord.boardOrder !== 'number') {
      const maxOrder = Math.max(0, ...all.map(r => r.boardOrder || 0));
      cleanRecord.boardOrder = maxOrder + 1000;
    }
    all.push(cleanRecord);
    this.save(table, all);
  },

  update(table, id, changes) {
    if (typeof PendingChanges !== 'undefined' && PendingChanges.editingPendingId) {
      const pc = this.getById('pendingChanges', PendingChanges.editingPendingId);
      if (pc && pc.table === table) {
        const pendingId = PendingChanges.editingPendingId;
        PendingChanges.editingPendingId = null; // Reset

        const updatedData = { ...pc.proposedData, ...changes };
        this.update('pendingChanges', pendingId, {
          proposedData: updatedData,
          submittedAt: new Date().toISOString(),
          status: 'pending',
          rejectionReason: '',
          reviewedBy: '',
          reviewedAt: ''
        });
        return;
      }
    }
    this._pendingWrIdsCache = null;
    const all = this.getAll(table);
    const idx = all.findIndex(r => r.id === id);
    if (idx !== -1) {
      const cleanChanges = { ...changes };
      if (table === 'workRequests') {
        delete cleanChanges.isPendingApproval;
      }
      all[idx] = { ...all[idx], ...cleanChanges };
      if (table === 'workRequests') {
        delete all[idx].isPendingApproval;
      }
      this.save(table, all);
    }
  },

  delete(table, id) {
    this._pendingWrIdsCache = null;
    const all = this.getAll(table).filter(r => r.id !== id);
    this.save(table, all);
  },

  resetToSeed() {
    for (const [key, value] of Object.entries(seedData)) {
      localStorage.setItem('erp_' + key, JSON.stringify(value));
    }
    localStorage.setItem('erp_schema_version', String(this.SCHEMA_VERSION));
  }
};

// Dynamic seedData adjustments requested:
// 1. Keep only the first 10 users (with original avatars)
seedData.users = seedData.users.slice(0, 10);

// Helper for generating dates relative to current date/time
const dateOffset = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

// 2. Add 10 new operations requests
seedData.operationsRequests = [
  {
    id: 'opreq-01',
    type: 'billing',
    workRequestId: makeId('wr', 101),
    clientId: makeId('c', 1),
    requestedBy: makeId('u', 6),
    requestedAt: dateOffset(-3) + 'T10:00:00Z',
    status: 'pending',
    rejectionReason: '',
    linkedTaskId: makeId('t', 1),
    amount: 15000,
    notes: 'Please bill Batangas Industrial Group for Phase 1 milestone.',
    receiptFilename: null
  },
  {
    id: 'opreq-02',
    type: 'disbursement',
    workRequestId: makeId('wr', 1),
    clientId: makeId('c', 1),
    requestedBy: makeId('u', 6),
    requestedAt: dateOffset(-2) + 'T14:30:00Z',
    status: 'pending',
    rejectionReason: '',
    disbursementType: 'Petty Cash',
    category: 'Travel',
    amount: 2500,
    paymentMethod: 'Cash',
    notes: 'Transport costs for Batangas site visit.',
    receiptFilename: null,
    linkedTaskId: ''
  },
  {
    id: 'opreq-03',
    type: 'transmittal',
    workRequestId: makeId('wr', 2),
    clientId: makeId('c', 3),
    requestedBy: makeId('u', 7),
    requestedAt: dateOffset(-1) + 'T09:15:00Z',
    status: 'pending',
    rejectionReason: '',
    documents: ['Form 1701Q Q1', 'Tax Receipt Voucher'],
    notes: 'Transmit Q1 documents to Manila Water.',
    recipientDetails: 'Manila Water Office, Quezon City'
  },
  {
    id: 'opreq-04',
    type: 'billing',
    workRequestId: makeId('wr', 99),
    clientId: makeId('c', 1),
    requestedBy: makeId('u', 7),
    requestedAt: dateOffset(-5) + 'T11:00:00Z',
    status: 'approved',
    rejectionReason: '',
    linkedTaskId: makeId('t', 99),
    amount: 12000,
    notes: 'Monthly retainer fee billing.',
    receiptFilename: null
  },
  {
    id: 'opreq-05',
    type: 'disbursement',
    workRequestId: makeId('wr', 2),
    clientId: makeId('c', 3),
    requestedBy: makeId('u', 6),
    requestedAt: dateOffset(-4) + 'T15:45:00Z',
    status: 'rejected',
    rejectionReason: 'Invalid category selection.',
    disbursementType: 'Company Fund',
    category: 'Representation',
    amount: 5000,
    paymentMethod: 'Bank Transfer',
    notes: 'Client lunch representation expense.',
    receiptFilename: null,
    linkedTaskId: ''
  },
  {
    id: 'opreq-06',
    type: 'transmittal',
    workRequestId: makeId('wr', 102),
    clientId: makeId('c', 2),
    requestedBy: makeId('u', 6),
    requestedAt: dateOffset(-6) + 'T08:30:00Z',
    status: 'approved',
    rejectionReason: '',
    documents: ['SEC Registration Document'],
    notes: 'Fulfill approved transmittal request.',
    recipientDetails: 'Batangas Industrial Group HQ'
  },
  {
    id: 'opreq-07',
    type: 'billing',
    workRequestId: makeId('wr', 102),
    clientId: makeId('c', 2),
    requestedBy: makeId('u', 7),
    requestedAt: dateOffset(-1) + 'T16:20:00Z',
    status: 'pending',
    rejectionReason: '',
    linkedTaskId: makeId('t', 102),
    amount: 8500,
    notes: 'Document collection service billing.',
    receiptFilename: null
  },
  {
    id: 'opreq-08',
    type: 'disbursement',
    workRequestId: makeId('wr', 101),
    clientId: makeId('c', 1),
    requestedBy: makeId('u', 6),
    requestedAt: dateOffset(-2) + 'T10:10:00Z',
    status: 'pending',
    rejectionReason: '',
    disbursementType: 'Client Fund',
    category: 'Government Fee',
    amount: 3000,
    paymentMethod: 'Cash',
    notes: 'BIR Registration Renewal Fee.',
    receiptFilename: null,
    linkedTaskId: ''
  },
  {
    id: 'opreq-09',
    type: 'transmittal',
    workRequestId: makeId('wr', 1),
    clientId: makeId('c', 1),
    requestedBy: makeId('u', 7),
    requestedAt: dateOffset(-3) + 'T13:40:00Z',
    status: 'pending',
    rejectionReason: '',
    documents: ['Annual Audited Financial Statements'],
    notes: 'Send AFS to BIR office.',
    recipientDetails: 'RDO 39 Office'
  },
  {
    id: 'opreq-10',
    type: 'disbursement',
    workRequestId: makeId('wr', 99),
    clientId: makeId('c', 1),
    requestedBy: makeId('u', 6),
    requestedAt: dateOffset(-1) + 'T11:50:00Z',
    status: 'pending',
    rejectionReason: '',
    disbursementType: 'Petty Cash',
    category: 'Office Supplies',
    amount: 1500,
    paymentMethod: 'Cash',
    notes: 'Purchase of archive files and folders.',
    receiptFilename: null,
    linkedTaskId: ''
  }
];

// 3. Add 10 new billing (invoices)
seedData.invoices = [
  {
    id: makeId('inv', 1),
    clientId: makeId('c', 1),
    entity: 'ATA',
    workRequestId: makeId('wr', 1),
    invoiceNumber: 'ATA-SI-2025-001',
    issueDate: dateOffset(-10),
    dueDate: dateOffset(20),
    status: 'Sent',
    lineItems: [{ description: 'Tax Compliance Retainer', amount: 20000.00, type: 'Professional Fee' }],
    subtotal: 20000.00,
    vat: 0,
    total: 20000.00,
    paidAmount: 0.00,
    payments: [],
    createdBy: makeId('u', 4),
    createdAt: dateOffset(-10),
    updatedAt: dateOffset(-10)
  },
  {
    id: makeId('inv', 12),
    clientId: makeId('c', 2),
    entity: 'ATA',
    workRequestId: makeId('wr', 1),
    invoiceNumber: 'ATA-SI-2026-012',
    issueDate: dateOffset(-12),
    dueDate: dateOffset(18),
    status: 'Paid',
    lineItems: [{ description: 'AFS Audit Fee Part 1', amount: 50000.00, type: 'Professional Fee' }],
    subtotal: 50000.00,
    vat: 0,
    total: 50000.00,
    paidAmount: 50000.00,
    payments: [{ amount: 50000.00, method: 'Bank Transfer', reference: 'PAY-1122', date: dateOffset(-5), recordedBy: makeId('u', 4) }],
    createdBy: makeId('u', 4),
    createdAt: dateOffset(-12),
    updatedAt: dateOffset(-5)
  },
  {
    id: makeId('inv', 13),
    clientId: makeId('c', 3),
    entity: 'LTA',
    workRequestId: makeId('wr', 2),
    invoiceNumber: 'LTA-SI-2026-013',
    issueDate: dateOffset(-8),
    dueDate: dateOffset(22),
    status: 'Partially Paid',
    lineItems: [{ description: 'Bookkeeping Fee - Q1', amount: 30000.00, type: 'Professional Fee' }],
    subtotal: 30000.00,
    vat: 0,
    total: 30000.00,
    paidAmount: 15000.00,
    payments: [{ amount: 15000.00, method: 'Cash', reference: 'CSH-9988', date: dateOffset(-2), recordedBy: makeId('u', 5) }],
    createdBy: makeId('u', 5),
    createdAt: dateOffset(-8),
    updatedAt: dateOffset(-2)
  },
  {
    id: makeId('inv', 14),
    clientId: makeId('c', 1),
    entity: 'LTA',
    workRequestId: makeId('wr', 99),
    invoiceNumber: 'LTA-SI-2026-014',
    issueDate: dateOffset(-1),
    dueDate: dateOffset(29),
    status: 'Draft',
    lineItems: [{ description: 'Corporate Secretarial Services', amount: 12000.00, type: 'Professional Fee' }],
    subtotal: 12000.00,
    vat: 0,
    total: 12000.00,
    paidAmount: 0.00,
    payments: [],
    createdBy: makeId('u', 5),
    createdAt: dateOffset(-1),
    updatedAt: dateOffset(-1)
  },
  {
    id: makeId('inv', 15),
    clientId: makeId('c', 4),
    entity: 'ATA',
    workRequestId: makeId('wr', 101),
    invoiceNumber: 'ATA-SI-2026-015',
    issueDate: dateOffset(-15),
    dueDate: dateOffset(15),
    status: 'Sent',
    lineItems: [{ description: 'Business Registration Service', amount: 25000.00, type: 'Professional Fee' }],
    subtotal: 25000.00,
    vat: 0,
    total: 25000.00,
    paidAmount: 0.00,
    payments: [],
    createdBy: makeId('u', 4),
    createdAt: dateOffset(-15),
    updatedAt: dateOffset(-15)
  },
  {
    id: makeId('inv', 16),
    clientId: makeId('c', 5),
    entity: 'LTA',
    workRequestId: makeId('wr', 102),
    invoiceNumber: 'LTA-SI-2026-016',
    issueDate: dateOffset(-20),
    dueDate: dateOffset(10),
    status: 'Paid',
    lineItems: [{ description: 'General Consultation Retainer', amount: 15000.00, type: 'Professional Fee' }],
    subtotal: 15000.00,
    vat: 0,
    total: 15000.00,
    paidAmount: 15000.00,
    payments: [{ amount: 15000.00, method: 'Check', reference: 'CHK-0044', date: dateOffset(-10), recordedBy: makeId('u', 5) }],
    createdBy: makeId('u', 5),
    createdAt: dateOffset(-20),
    updatedAt: dateOffset(-10)
  },
  {
    id: makeId('inv', 17),
    clientId: makeId('c', 6),
    entity: 'ATA',
    workRequestId: makeId('wr', 99),
    invoiceNumber: 'ATA-SI-2026-017',
    issueDate: dateOffset(-2),
    dueDate: dateOffset(28),
    status: 'Sent',
    lineItems: [{ description: 'BIR Audit Representation Fee', amount: 80000.00, type: 'Professional Fee' }],
    subtotal: 80000.00,
    vat: 0,
    total: 80000.00,
    paidAmount: 0.00,
    payments: [],
    createdBy: makeId('u', 4),
    createdAt: dateOffset(-2),
    updatedAt: dateOffset(-2)
  },
  {
    id: makeId('inv', 18),
    clientId: makeId('c', 7),
    entity: 'LTA',
    workRequestId: makeId('wr', 1),
    invoiceNumber: 'LTA-SI-2026-018',
    issueDate: dateOffset(-4),
    dueDate: dateOffset(26),
    status: 'Draft',
    lineItems: [{ description: 'Local Business Permit Assistance', amount: 10000.00, type: 'Professional Fee' }],
    subtotal: 10000.00,
    vat: 0,
    total: 10000.00,
    paidAmount: 0.00,
    payments: [],
    createdBy: makeId('u', 5),
    createdAt: dateOffset(-4),
    updatedAt: dateOffset(-4)
  },
  {
    id: makeId('inv', 19),
    clientId: makeId('c', 8),
    entity: 'ATA',
    workRequestId: makeId('wr', 2),
    invoiceNumber: 'ATA-SI-2026-019',
    issueDate: dateOffset(-3),
    dueDate: dateOffset(27),
    status: 'Sent',
    lineItems: [{ description: 'SEC General Information Sheet filing', amount: 5000.00, type: 'Professional Fee' }],
    subtotal: 5000.00,
    vat: 0,
    total: 5000.00,
    paidAmount: 0.00,
    payments: [],
    createdBy: makeId('u', 4),
    createdAt: dateOffset(-3),
    updatedAt: dateOffset(-3)
  },
  {
    id: makeId('inv', 20),
    clientId: makeId('c', 9),
    entity: 'LTA',
    workRequestId: makeId('wr', 101),
    invoiceNumber: 'LTA-SI-2026-020',
    issueDate: dateOffset(-14),
    dueDate: dateOffset(16),
    status: 'Paid',
    lineItems: [{ description: 'SEC Incorporation Service', amount: 35000.00, type: 'Professional Fee' }],
    subtotal: 35000.00,
    vat: 0,
    total: 35000.00,
    paidAmount: 35000.00,
    payments: [{ amount: 35000.00, method: 'Bank Transfer', reference: 'PAY-8822', date: dateOffset(-7), recordedBy: makeId('u', 5) }],
    createdBy: makeId('u', 5),
    createdAt: dateOffset(-14),
    updatedAt: dateOffset(-7)
  }
];

// 4. Add 10 new disbursements
seedData.disbursements = [
  {
    id: makeId('d', 201),
    category: 'Government Fee',
    description: 'BIR Annual Registration Fee payment',
    amount: 500.00,
    fundSource: 'Client Fund',
    linkedInvoiceId: makeId('inv', 1),
    linkedWorkRequestId: makeId('wr', 1),
    entity: 'ATA',
    employeeId: makeId('u', 4),
    requestedBy: makeId('u', 4),
    status: 'Released',
    submittedAt: dateOffset(-10),
    dueDate: dateOffset(-10),
    accountingApprovedBy: makeId('u', 1),
    releasedAt: dateOffset(-10),
    receiptFilename: 'bir-reg-fee-receipt.pdf',
    paymentHandledBy: makeId('u', 1),
    paymentDetails: { method: 'Cash', reference: 'REF-201', bank: '', date: dateOffset(-10), processedBy: makeId('u', 1) },
    updatedAt: dateOffset(-10)
  },
  {
    id: makeId('d', 202),
    category: 'Travel',
    description: 'Site inspection transport allowance',
    amount: 1500.00,
    fundSource: 'Petty Cash',
    linkedInvoiceId: null,
    linkedWorkRequestId: makeId('wr', 1),
    entity: 'ATA',
    employeeId: makeId('u', 6),
    requestedBy: makeId('u', 6),
    status: 'Approved',
    submittedAt: dateOffset(-5),
    dueDate: dateOffset(5),
    accountingApprovedBy: makeId('u', 4),
    releasedAt: '',
    receiptFilename: null,
    paymentHandledBy: '',
    paymentDetails: { method: '', reference: '', bank: '', date: '', processedBy: '' },
    updatedAt: dateOffset(-5)
  },
  {
    id: makeId('d', 203),
    category: 'Representation',
    description: 'Business lunch client meeting',
    amount: 3200.00,
    fundSource: 'Company Fund',
    linkedInvoiceId: null,
    linkedWorkRequestId: makeId('wr', 2),
    entity: 'LTA',
    employeeId: makeId('u', 5),
    requestedBy: makeId('u', 2),
    status: 'Pending Approval',
    submittedAt: dateOffset(-1),
    dueDate: dateOffset(4),
    accountingApprovedBy: '',
    releasedAt: '',
    receiptFilename: null,
    paymentHandledBy: '',
    paymentDetails: { method: '', reference: '', bank: '', date: '', processedBy: '' },
    updatedAt: dateOffset(-1)
  },
  {
    id: makeId('d', 204),
    category: 'Office Supplies',
    description: 'Archive folders and folders labels',
    amount: 1200.00,
    fundSource: 'Petty Cash',
    linkedInvoiceId: null,
    linkedWorkRequestId: makeId('wr', 99),
    entity: 'LTA',
    employeeId: makeId('u', 8),
    requestedBy: makeId('u', 8),
    status: 'Released',
    submittedAt: dateOffset(-8),
    dueDate: dateOffset(-8),
    accountingApprovedBy: makeId('u', 1),
    releasedAt: dateOffset(-8),
    receiptFilename: 'supplies-receipt-01.pdf',
    paymentHandledBy: makeId('u', 1),
    paymentDetails: { method: 'Cash', reference: 'REF-204', bank: '', date: dateOffset(-8), processedBy: makeId('u', 1) },
    updatedAt: dateOffset(-8)
  },
  {
    id: makeId('d', 205),
    category: 'Government Fee',
    description: 'SEC Registration Filing Fee',
    amount: 10000.00,
    fundSource: 'Client Fund',
    linkedInvoiceId: makeId('inv', 12),
    linkedWorkRequestId: makeId('wr', 101),
    entity: 'ATA',
    employeeId: makeId('u', 4),
    requestedBy: makeId('u', 4),
    status: 'Released',
    submittedAt: dateOffset(-12),
    dueDate: dateOffset(-12),
    accountingApprovedBy: makeId('u', 1),
    releasedAt: dateOffset(-12),
    receiptFilename: 'sec-reg-fee-receipt.pdf',
    paymentHandledBy: makeId('u', 1),
    paymentDetails: { method: 'Check', reference: 'CHK-205', bank: 'Metrobank', date: dateOffset(-12), processedBy: makeId('u', 1) },
    updatedAt: dateOffset(-12)
  },
  {
    id: makeId('d', 206),
    category: 'Travel',
    description: 'Client document pickup courier costs',
    amount: 600.00,
    fundSource: 'Petty Cash',
    linkedInvoiceId: null,
    linkedWorkRequestId: makeId('wr', 102),
    entity: 'ATA',
    employeeId: makeId('u', 6),
    requestedBy: makeId('u', 6),
    status: 'Approved',
    submittedAt: dateOffset(-2),
    dueDate: dateOffset(3),
    accountingApprovedBy: makeId('u', 4),
    releasedAt: '',
    receiptFilename: null,
    paymentHandledBy: '',
    paymentDetails: { method: '', reference: '', bank: '', date: '', processedBy: '' },
    updatedAt: dateOffset(-2)
  },
  {
    id: makeId('d', 207),
    category: 'Representation',
    description: 'Documentation staff overtime dinner',
    amount: 1800.00,
    fundSource: 'Company Fund',
    linkedInvoiceId: null,
    linkedWorkRequestId: makeId('wr', 99),
    entity: 'ATA',
    employeeId: makeId('u', 8),
    requestedBy: makeId('u', 8),
    status: 'Released',
    submittedAt: dateOffset(-6),
    dueDate: dateOffset(-6),
    accountingApprovedBy: makeId('u', 1),
    releasedAt: dateOffset(-6),
    receiptFilename: 'dinner-receipt-207.pdf',
    paymentHandledBy: makeId('u', 1),
    paymentDetails: { method: 'Cash', reference: 'REF-207', bank: '', date: dateOffset(-6), processedBy: makeId('u', 1) },
    updatedAt: dateOffset(-6)
  },
  {
    id: makeId('d', 208),
    category: 'Government Fee',
    description: 'BIR DST Payment',
    amount: 450.00,
    fundSource: 'Client Fund',
    linkedInvoiceId: makeId('inv', 13),
    linkedWorkRequestId: makeId('wr', 2),
    entity: 'LTA',
    employeeId: makeId('u', 5),
    requestedBy: makeId('u', 5),
    status: 'Released',
    submittedAt: dateOffset(-4),
    dueDate: dateOffset(-4),
    accountingApprovedBy: makeId('u', 1),
    releasedAt: dateOffset(-4),
    receiptFilename: 'bir-dst-receipt.pdf',
    paymentHandledBy: makeId('u', 1),
    paymentDetails: { method: 'Cash', reference: 'REF-208', bank: '', date: dateOffset(-4), processedBy: makeId('u', 1) },
    updatedAt: dateOffset(-4)
  },
  {
    id: makeId('d', 209),
    category: 'Office Supplies',
    description: 'Overtime printing paper supply',
    amount: 950.00,
    fundSource: 'Petty Cash',
    linkedInvoiceId: null,
    linkedWorkRequestId: makeId('wr', 1),
    entity: 'LTA',
    employeeId: makeId('u', 5),
    requestedBy: makeId('u', 5),
    status: 'Pending Approval',
    submittedAt: dateOffset(-1),
    dueDate: dateOffset(5),
    accountingApprovedBy: '',
    releasedAt: '',
    receiptFilename: null,
    paymentHandledBy: '',
    paymentDetails: { method: '', reference: '', bank: '', date: '', processedBy: '' },
    updatedAt: dateOffset(-1)
  },
  {
    id: makeId('d', 210),
    category: 'Travel',
    description: 'Travel to BIR RDO for AFS filing',
    amount: 1100.00,
    fundSource: 'Petty Cash',
    linkedInvoiceId: null,
    linkedWorkRequestId: makeId('wr', 101),
    entity: 'LTA',
    employeeId: makeId('u', 7),
    requestedBy: makeId('u', 7),
    status: 'Released',
    submittedAt: dateOffset(-3),
    dueDate: dateOffset(-3),
    accountingApprovedBy: makeId('u', 1),
    releasedAt: dateOffset(-3),
    receiptFilename: 'taxi-receipt-210.pdf',
    paymentHandledBy: makeId('u', 1),
    paymentDetails: { method: 'Cash', reference: 'REF-210', bank: '', date: dateOffset(-3), processedBy: makeId('u', 1) },
    updatedAt: dateOffset(-3)
  }
];

// 5. Add 10 new transmittals
seedData.transmittals = [
  {
    id: makeId('tx', 201),
    workRequestId: makeId('wr', 102),
    clientId: makeId('c', 2),
    trackingNumber: 'ATA-TX-2026-001',
    status: 'Acknowledged',
    items: [{ description: 'Original SEC Registration Certificate', documentType: 'Corporate' }],
    notes: 'Original document returned to Batangas Industrial Group.',
    entity: 'ATA',
    sentAt: dateOffset(-10) + 'T09:00:00Z',
    acknowledgedAt: dateOffset(-10) + 'T14:30:00Z',
    sentBy: makeId('u', 8),
    acknowledgedBy: makeId('u', 2),
    createdAt: dateOffset(-10) + 'T08:00:00Z',
    createdBy: makeId('u', 8)
  },
  {
    id: makeId('tx', 202),
    workRequestId: makeId('wr', 1),
    clientId: makeId('c', 1),
    trackingNumber: 'ATA-TX-2026-002',
    status: 'Sent',
    items: [{ description: 'Annual Income Tax Return AFS 2025', documentType: 'Tax Document' }],
    notes: 'Submitting for client review before filing.',
    entity: 'ATA',
    sentAt: dateOffset(-2) + 'T11:00:00Z',
    acknowledgedAt: '',
    sentBy: makeId('u', 8),
    acknowledgedBy: '',
    createdAt: dateOffset(-3) + 'T10:00:00Z',
    createdBy: makeId('u', 8)
  },
  {
    id: makeId('tx', 203),
    workRequestId: makeId('wr', 2),
    clientId: makeId('c', 3),
    trackingNumber: 'LTA-TX-2026-003',
    status: 'Draft',
    items: [{ description: 'Monthly Bookkeeping Ledger Reports', documentType: 'Financial Statement' }],
    notes: 'Prepare draft transmittal for client ledger books.',
    entity: 'LTA',
    sentAt: '',
    acknowledgedAt: '',
    sentBy: '',
    acknowledgedBy: '',
    createdAt: dateOffset(-1) + 'T16:00:00Z',
    createdBy: makeId('u', 8)
  },
  {
    id: makeId('tx', 204),
    workRequestId: makeId('wr', 99),
    clientId: makeId('c', 1),
    trackingNumber: 'LTA-TX-2026-004',
    status: 'Acknowledged',
    items: [{ description: 'Quarterly VAT Reports Form 2550Q', documentType: 'Tax Document' }],
    notes: 'Sent to accounting division.',
    entity: 'LTA',
    sentAt: dateOffset(-12) + 'T10:00:00Z',
    acknowledgedAt: dateOffset(-11) + 'T09:15:00Z',
    sentBy: makeId('u', 8),
    acknowledgedBy: makeId('u', 2),
    createdAt: dateOffset(-12) + 'T08:30:00Z',
    createdBy: makeId('u', 8)
  },
  {
    id: makeId('tx', 205),
    workRequestId: makeId('wr', 101),
    clientId: makeId('c', 4),
    trackingNumber: 'ATA-TX-2026-005',
    status: 'Sent',
    items: [{ description: 'Approved Business Permit License copy', documentType: 'Corporate' }],
    notes: 'Copy sent to site manager.',
    entity: 'ATA',
    sentAt: dateOffset(-4) + 'T13:00:00Z',
    acknowledgedAt: '',
    sentBy: makeId('u', 8),
    acknowledgedBy: '',
    createdAt: dateOffset(-4) + 'T09:00:00Z',
    createdBy: makeId('u', 8)
  },
  {
    id: makeId('tx', 206),
    workRequestId: makeId('wr', 102),
    clientId: makeId('c', 5),
    trackingNumber: 'LTA-TX-2026-006',
    status: 'Draft',
    items: [{ description: 'Audited Financial Statements 2025', documentType: 'Financial Statement' }],
    notes: 'AFS draft for client signing.',
    entity: 'LTA',
    sentAt: '',
    acknowledgedAt: '',
    sentBy: '',
    acknowledgedBy: '',
    createdAt: dateOffset(-2) + 'T14:45:00Z',
    createdBy: makeId('u', 8)
  },
  {
    id: makeId('tx', 207),
    workRequestId: makeId('wr', 99),
    clientId: makeId('c', 6),
    trackingNumber: 'ATA-TX-2026-007',
    status: 'Sent',
    items: [{ description: 'BIR Audit Notice response document', documentType: 'Legal Document' }],
    notes: 'Official response filed.',
    entity: 'ATA',
    sentAt: dateOffset(-1) + 'T15:30:00Z',
    acknowledgedAt: '',
    sentBy: makeId('u', 8),
    acknowledgedBy: '',
    createdAt: dateOffset(-1) + 'T13:00:00Z',
    createdBy: makeId('u', 8)
  },
  {
    id: makeId('tx', 208),
    workRequestId: makeId('wr', 1),
    clientId: makeId('c', 7),
    trackingNumber: 'LTA-TX-2026-008',
    status: 'Acknowledged',
    items: [{ description: 'Local Permit Filing Forms and Receipts', documentType: 'Receipt' }],
    notes: 'Original receipts delivered.',
    entity: 'LTA',
    sentAt: dateOffset(-7) + 'T09:30:00Z',
    acknowledgedAt: dateOffset(-7) + 'T11:00:00Z',
    sentBy: makeId('u', 8),
    acknowledgedBy: makeId('u', 2),
    createdAt: dateOffset(-7) + 'T08:00:00Z',
    createdBy: makeId('u', 8)
  },
  {
    id: makeId('tx', 209),
    workRequestId: makeId('wr', 2),
    clientId: makeId('c', 8),
    trackingNumber: 'ATA-TX-2026-009',
    status: 'Sent',
    items: [{ description: 'Annual Information Return Form 1604CF', documentType: 'Tax Document' }],
    notes: 'AFS annex files.',
    entity: 'ATA',
    sentAt: dateOffset(-2) + 'T10:00:00Z',
    acknowledgedAt: '',
    sentBy: makeId('u', 8),
    acknowledgedBy: '',
    createdAt: dateOffset(-2) + 'T09:00:00Z',
    createdBy: makeId('u', 8)
  },
  {
    id: makeId('tx', 210),
    workRequestId: makeId('wr', 101),
    clientId: makeId('c', 9),
    trackingNumber: 'LTA-TX-2026-010',
    status: 'Acknowledged',
    items: [{ description: 'Approved Incorporation Articles and By-laws', documentType: 'Corporate' }],
    notes: 'SEC Official copy.',
    entity: 'LTA',
    sentAt: dateOffset(-6) + 'T11:00:00Z',
    acknowledgedAt: dateOffset(-6) + 'T16:00:00Z',
    sentBy: makeId('u', 8),
    acknowledgedBy: makeId('u', 2),
    createdAt: dateOffset(-6) + 'T10:00:00Z',
    createdBy: makeId('u', 8)
  }
];

DB.init();
