jest.mock('../../src/services/supabaseClient', () => ({
  supabaseAdmin: require('../fixtures/supabaseMock').supabaseAdmin,
}));
jest.mock('../../src/services/pdfService', () => ({
  generatePdf: jest.fn(async () => Buffer.from('pdf')),
}));
jest.mock('../../src/services/storageService', () => {
  const actual = jest.requireActual('../../src/services/storageService');
  return {
    ...actual,
    uploadBuffer: jest.fn(actual.uploadBuffer),
    getSignedDownloadUrl: jest.fn(async ({ path }) => `https://s3.signed.url/${path}`),
  };
});

const {
  resetMock,
  seedDefaults,
  mockTables,
  registerUser,
} = require('../fixtures/supabaseMock');
const {
  buildStatementDocument,
} = require('../../src/modules/billing/statementDocument');
const {
  buildDisbursementDocument,
} = require('../../src/modules/disbursements/printDocument');
const billingService = require('../../src/modules/billing/service');
const disbursementService = require('../../src/modules/disbursements/service');
const {
  createDisbursementSchema,
  updateDisbursementSchema,
} = require('../../src/modules/disbursements/schema');
const storageService = require('../../src/services/storageService');
const actualStorageService = jest.requireActual('../../src/services/storageService');
const reservations = require('../../src/modules/disbursements/receiptReservationStore');

describe('Billing & Disbursement Adjustments Verification', () => {
  const ENT_ATA_ID = 'ent-ata';
  const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
  const WR_ID = '33333333-3333-3333-3333-333333333333';
  const TASK_ID = '44444444-4444-4444-4444-444444444444';
  const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const ACCT_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

  let adminUser;
  let acctUser;

  beforeEach(() => {
    resetMock();
    seedDefaults();
    jest.clearAllMocks();

    registerUser({
      id: ADMIN_ID,
      role: 'Admin',
      name: 'Admin User',
      email: 'admin@ata-lta.ph',
      entities: ['ATA', 'LTA'],
    });
    adminUser = mockTables.users.get(ADMIN_ID);

    registerUser({
      id: ACCT_ID,
      role: 'Accounting',
      name: 'Accounting User',
      email: 'acct@ata-lta.ph',
      entities: ['ATA', 'LTA'],
    });
    acctUser = mockTables.users.get(ACCT_ID);

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: ENT_ATA_ID,
      name: 'Test Client',
      address: 'Makati City',
    });

    mockTables.work_requests.set(WR_ID, {
      id: WR_ID,
      entity_id: ENT_ATA_ID,
      client_id: CLIENT_ID,
      title: 'Tax Consultation',
      status: 'In Progress',
      work_request_number: 'WR-2026-0001',
      co_assignees: [ACCT_ID, ADMIN_ID],
    });

    mockTables.tasks.set(TASK_ID, {
      id: TASK_ID,
      work_request_id: WR_ID,
      entity_id: ENT_ATA_ID,
      title: 'Prepare Filing',
      status: 'In Progress',
    });
  });

  describe('1. Company Names & NOTE Line Rendering', () => {
    it('renders exact company names in billing statement document', () => {
      const ataDoc = buildStatementDocument({ entity_code: 'ATA', print_details: {} });
      expect(ataDoc).toContain('ATA Business Consultancy Services');
      expect(ataDoc).not.toContain('ATA Business Consultancy<');
      expect(ataDoc).not.toContain('ATA Accounting Firm');

      const ltaDoc = buildStatementDocument({ entity_code: 'LTA', print_details: {} });
      expect(ltaDoc).toContain('LTA Business Management Corp');
      expect(ltaDoc).not.toContain('LTA Business Management Corp.');
      expect(ltaDoc).not.toContain('LTA Accounting Firm');
    });

    it('renders exact company names in disbursement document', () => {
      const ataDoc = buildDisbursementDocument({ entity_code: 'ATA' });
      expect(ataDoc).toContain('ATA Business Consultancy Services');
      expect(ataDoc).not.toContain('ATA Business Consultancy<');

      const ltaDoc = buildDisbursementDocument({ entity_code: 'LTA' });
      expect(ltaDoc).toContain('LTA Business Management Corp');
      expect(ltaDoc).not.toContain('LTA Business Management Corp.');
    });

    it('merges terms and notes into a single NOTE: line and eliminates Terms:/Notes: tags', () => {
      // Test terms only
      const docWithTerms = buildStatementDocument({
        entity_code: 'ATA',
        terms: 'Payment due within 30 days',
      });
      expect(docWithTerms).toContain('<strong>NOTE:</strong> Payment due within 30 days');
      expect(docWithTerms).not.toContain('<strong>Terms:</strong>');
      expect(docWithTerms).not.toContain('<strong>Notes:</strong>');

      // Test notes only
      const docWithNotes = buildStatementDocument({
        entity_code: 'ATA',
        notes: 'Strict delivery schedule',
      });
      expect(docWithNotes).toContain('<strong>NOTE:</strong> Strict delivery schedule');
      expect(docWithNotes).not.toContain('<strong>Terms:</strong>');
      expect(docWithNotes).not.toContain('<strong>Notes:</strong>');

      // Test neither
      const docEmpty = buildStatementDocument({
        entity_code: 'ATA',
      });
      expect(docEmpty).not.toContain('<strong>NOTE:</strong>');
      expect(docEmpty).not.toContain('<strong>Terms:</strong>');
      expect(docEmpty).not.toContain('<strong>Notes:</strong>');
    });
  });

  describe('2. Billing Service: Invoice Number Immutability & Consolidated Notes', () => {
    it('syncs notes to terms on createInvoice when only terms is provided', async () => {
      const inv = await billingService.createInvoice({
        entityId: ENT_ATA_ID,
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          clientId: CLIENT_ID,
          workRequestId: WR_ID,
          taskId: TASK_ID,
          issueDate: '2026-11-01',
          dueDate: '2026-11-30',
          terms: 'Net 30 days payment',
          lineItems: [{ description: 'Audit Fee', amount: 15000, type: 'Professional Fee' }],
        },
      });

      expect(inv.terms).toBe('Net 30 days payment');
      expect(inv.notes).toBe('Net 30 days payment');
    });

    it('syncs terms to notes on createInvoice when only notes is provided', async () => {
      const inv = await billingService.createInvoice({
        entityId: ENT_ATA_ID,
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          clientId: CLIENT_ID,
          workRequestId: WR_ID,
          taskId: TASK_ID,
          issueDate: '2026-11-01',
          dueDate: '2026-11-30',
          notes: 'Special client note',
          lineItems: [{ description: 'Audit Fee', amount: 15000, type: 'Professional Fee' }],
        },
      });

      expect(inv.terms).toBe('Special client note');
      expect(inv.notes).toBe('Special client note');
    });

    it('enforces invoice_number immutability on updateInvoice', async () => {
      const inv = await billingService.createInvoice({
        entityId: ENT_ATA_ID,
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          clientId: CLIENT_ID,
          workRequestId: WR_ID,
          taskId: TASK_ID,
          invoiceNumber: 'ATA-SI-2026-IMMUTABLE',
          issueDate: '2026-11-01',
          dueDate: '2026-11-30',
          lineItems: [{ description: 'Advisory', amount: 20000, type: 'Professional Fee' }],
        },
      });

      expect(inv.invoice_number).toBe('ATA-SI-2026-IMMUTABLE');

      // Attempt to mutate invoiceNumber in Draft status
      const updated = await billingService.updateInvoice({
        entityId: ENT_ATA_ID,
        id: inv.id,
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          invoiceNumber: 'ATA-SI-2026-MUTATED',
          expectedVersion: inv.version,
        },
      });

      // invoice_number must NOT be mutated
      expect(updated.invoice_number).toBe('ATA-SI-2026-IMMUTABLE');
    });

    it('allows updating notes and terms in Draft, syncing when only one is provided', async () => {
      const inv = await billingService.createInvoice({
        entityId: ENT_ATA_ID,
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          clientId: CLIENT_ID,
          workRequestId: WR_ID,
          taskId: TASK_ID,
          issueDate: '2026-11-01',
          dueDate: '2026-11-30',
          terms: 'Original terms',
          lineItems: [{ description: 'Consulting', amount: 10000, type: 'Professional Fee' }],
        },
      });

      const updatedWithTerms = await billingService.updateInvoice({
        entityId: ENT_ATA_ID,
        id: inv.id,
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          terms: 'Consolidated Note Update',
          expectedVersion: inv.version,
        },
      });

      expect(updatedWithTerms.terms).toBe('Consolidated Note Update');
      expect(updatedWithTerms.notes).toBe('Consolidated Note Update');
    });

    it('permits updating notes on non-Draft invoice without mutating terms or triggering INVOICE_NOT_DRAFT', async () => {
      const invoiceId = 'inv-issued-note-test';
      mockTables.invoices.set(invoiceId, {
        id: invoiceId,
        entity_id: ENT_ATA_ID,
        client_id: CLIENT_ID,
        work_request_id: WR_ID,
        task_id: TASK_ID,
        linked_task_id: TASK_ID,
        invoice_number: 'ATA-SI-2026-ISSUED',
        status: 'Issued',
        subtotal: 10000,
        total: 10000,
        amount_paid: 0,
        balance: 10000,
        terms: 'Original Financial Terms',
        notes: 'Original Notes',
        version: 1,
        archived: false,
      });

      // Non-admin accounting user updates only notes
      const updated = await billingService.updateInvoice({
        entityId: ENT_ATA_ID,
        id: invoiceId,
        userId: ACCT_ID,
        user: acctUser,
        data: {
          notes: 'Updated Delivery Notes',
        },
      });

      expect(updated.notes).toBe('Updated Delivery Notes');
      expect(updated.terms).toBe('Original Financial Terms');
    });
  });

  describe('3. Disbursement External URL Receipt Support', () => {
    it('validates externalUrl and receiptS3Key length up to 500 chars in schema and rejects over 500 chars', () => {
      // Exactly 500 characters URL
      const prefix = 'https://drive.google.com/file/d/';
      const valid500Url = prefix + 'a'.repeat(500 - prefix.length);
      expect(valid500Url.length).toBe(500);

      const valid = createDisbursementSchema.safeParse({
        category: 'Supplies',
        description: 'Office stationery',
        amount: 2500,
        fundSource: 'Firm Fund',
        workRequestId: WR_ID,
        taskId: TASK_ID,
        externalUrl: valid500Url,
        receiptFilename: 'google-drive-receipt.pdf',
      });
      expect(valid.success).toBe(true);

      // Exceeds 500 characters
      const tooLongUrl = prefix + 'a'.repeat(501 - prefix.length);
      expect(tooLongUrl.length).toBe(501);
      const invalidLength = createDisbursementSchema.safeParse({
        category: 'Supplies',
        description: 'Office stationery',
        amount: 2500,
        fundSource: 'Firm Fund',
        workRequestId: WR_ID,
        taskId: TASK_ID,
        externalUrl: tooLongUrl,
        receiptFilename: 'google-drive-receipt.pdf',
      });
      expect(invalidLength.success).toBe(false);

      // Exceeds 500 characters in receiptS3Key
      const tooLongKey = 'entities/ATA/receipts/' + 'x'.repeat(480);
      expect(tooLongKey.length).toBe(502);
      const invalidKeyLength = createDisbursementSchema.safeParse({
        category: 'Supplies',
        description: 'Office stationery',
        amount: 2500,
        fundSource: 'Firm Fund',
        workRequestId: WR_ID,
        taskId: TASK_ID,
        receiptS3Key: tooLongKey,
        receiptFilename: 'receipt.pdf',
      });
      expect(invalidKeyLength.success).toBe(false);

      const invalidUrl = createDisbursementSchema.safeParse({
        category: 'Supplies',
        description: 'Office stationery',
        amount: 2500,
        fundSource: 'Firm Fund',
        workRequestId: WR_ID,
        taskId: TASK_ID,
        externalUrl: 'not-a-valid-url',
        receiptFilename: 'receipt.pdf',
      });
      expect(invalidUrl.success).toBe(false);

      // Rejects externalUrl without receiptFilename
      const missingFilename = createDisbursementSchema.safeParse({
        category: 'Supplies',
        description: 'Office stationery',
        amount: 2500,
        fundSource: 'Firm Fund',
        workRequestId: WR_ID,
        taskId: TASK_ID,
        externalUrl: 'https://example.com/receipt.pdf',
      });
      expect(missingFilename.success).toBe(false);

      // Rejects receiptFilename without externalUrl or receiptS3Key
      const missingKey = createDisbursementSchema.safeParse({
        category: 'Supplies',
        description: 'Office stationery',
        amount: 2500,
        fundSource: 'Firm Fund',
        workRequestId: WR_ID,
        taskId: TASK_ID,
        receiptFilename: 'receipt.pdf',
      });
      expect(missingKey.success).toBe(false);
    });

    it('rejects non-HTTP/HTTPS URLs in externalUrl or receiptS3Key in schemas', () => {
      const baseDisb = {
        category: 'Supplies',
        description: 'Office stationery',
        amount: 2500,
        fundSource: 'Firm Fund',
        workRequestId: WR_ID,
        taskId: TASK_ID,
        receiptFilename: 'receipt.pdf',
      };

      const invalidExternalUrls = [
        'ftp://example.com/receipt.pdf',
        'file:///home/user/receipt.pdf',
        'mailto:billing@example.com',
        'gopher://gopher.example.com/receipt',
      ];

      for (const invalidUrl of invalidExternalUrls) {
        expect(createDisbursementSchema.safeParse({ ...baseDisb, externalUrl: invalidUrl }).success).toBe(false);
        expect(updateDisbursementSchema.safeParse({ ...baseDisb, externalUrl: invalidUrl, expectedVersion: 1 }).success).toBe(false);
      }

      const invalidS3KeyUrls = [
        'ftp://example.com/receipt.pdf',
        'file:///home/user/receipt.pdf',
        'gopher://gopher.example.com/receipt',
      ];

      for (const invalidUrl of invalidS3KeyUrls) {
        // Also if passed as receiptS3Key with a non-http scheme
        expect(createDisbursementSchema.safeParse({ ...baseDisb, receiptS3Key: invalidUrl }).success).toBe(false);
        expect(updateDisbursementSchema.safeParse({ ...baseDisb, receiptS3Key: invalidUrl, expectedVersion: 1 }).success).toBe(false);
      }
    });

    it('rejects conflicting receiptS3Key and externalUrl across schemas and service', async () => {
      const conflictingData = {
        category: 'Supplies',
        description: 'Office stationery',
        amount: 2500,
        fundSource: 'Firm Fund',
        workRequestId: WR_ID,
        taskId: TASK_ID,
        receiptS3Key: 'entities/ATA/receipts/receipt.pdf',
        externalUrl: 'https://drive.google.com/receipt.pdf',
        receiptFilename: 'receipt.pdf',
      };

      // createDisbursementSchema rejection
      const createParsed = createDisbursementSchema.safeParse(conflictingData);
      expect(createParsed.success).toBe(false);
      expect(
        createParsed.error.issues.some(
          (i) => i.path.includes('externalUrl') && i.message.includes('Cannot provide conflicting')
        )
      ).toBe(true);

      // updateDisbursementSchema rejection
      const updateParsed = updateDisbursementSchema.safeParse({
        ...conflictingData,
        expectedVersion: 1,
      });
      expect(updateParsed.success).toBe(false);
      expect(
        updateParsed.error.issues.some(
          (i) => i.path.includes('externalUrl') && i.message.includes('Cannot provide conflicting')
        )
      ).toBe(true);

      // service.createDisbursement rejection
      await expect(
        disbursementService.createDisbursement({
          entityId: ENT_ATA_ID,
          entityCode: 'ATA',
          userId: ADMIN_ID,
          user: adminUser,
          data: conflictingData,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'CONFLICTING_RECEIPT_SOURCES',
      });

      // service.updateDisbursement rejection
      const initial = await disbursementService.createDisbursement({
        entityId: ENT_ATA_ID,
        entityCode: 'ATA',
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          category: 'Supplies',
          description: 'Office stationery',
          amount: 2500,
          fundSource: 'Firm Fund',
          workRequestId: WR_ID,
          taskId: TASK_ID,
        },
      });

      await expect(
        disbursementService.updateDisbursement({
          entityId: ENT_ATA_ID,
          id: initial.id,
          userId: ADMIN_ID,
          user: adminUser,
          data: {
            ...conflictingData,
            expectedVersion: initial.version,
          },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'CONFLICTING_RECEIPT_SOURCES',
      });
    });

    it('falls back to receiptS3Key when externalUrl is null and claims/consumes reservation on create', async () => {
      const s3Key = 'entities/ATA/receipts/null-fallback-create.pdf';
      const uploadId = 'upload-null-fallback-create';
      await reservations.createReservation({
        uploadId,
        objectKey: s3Key,
        userId: ADMIN_ID,
        entityId: ENT_ATA_ID,
        filename: 'null-fallback.pdf',
        byteSize: 1024,
        mimeType: 'application/pdf',
      });
      await reservations.completeReservation(uploadId, {
        userId: ADMIN_ID,
        entityId: ENT_ATA_ID,
      });

      const created = await disbursementService.createDisbursement({
        entityId: ENT_ATA_ID,
        entityCode: 'ATA',
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          category: 'Miscellaneous',
          description: 'Client consultation expenses',
          amount: 3200,
          fundSource: 'Firm Fund',
          workRequestId: WR_ID,
          taskId: TASK_ID,
          receiptS3Key: s3Key,
          externalUrl: null,
          receiptFilename: 'null-fallback.pdf',
        },
      });

      expect(created.receipt_s3_key).toBe(s3Key);
      expect(created.receipt_filename).toBe('null-fallback.pdf');
      expect(created.external_url).toBeNull();
      expect(created.externalUrl).toBeNull();

      const reservation = await reservations.getReservation(uploadId);
      expect(reservation.status).toBe('consumed');
    });

    it('falls back to receiptS3Key when externalUrl is null and claims/consumes reservation on update', async () => {
      const initial = await disbursementService.createDisbursement({
        entityId: ENT_ATA_ID,
        entityCode: 'ATA',
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          category: 'Miscellaneous',
          description: 'Initial draft',
          amount: 1000,
          fundSource: 'Firm Fund',
          workRequestId: WR_ID,
          taskId: TASK_ID,
        },
      });

      const s3Key = 'entities/ATA/receipts/null-fallback-update.pdf';
      const uploadId = 'upload-null-fallback-update';
      await reservations.createReservation({
        uploadId,
        objectKey: s3Key,
        userId: ADMIN_ID,
        entityId: ENT_ATA_ID,
        filename: 'update-fallback.pdf',
        byteSize: 2048,
        mimeType: 'application/pdf',
      });
      await reservations.completeReservation(uploadId, {
        userId: ADMIN_ID,
        entityId: ENT_ATA_ID,
      });

      const updated = await disbursementService.updateDisbursement({
        entityId: ENT_ATA_ID,
        id: initial.id,
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          receiptS3Key: s3Key,
          externalUrl: null,
          receiptFilename: 'update-fallback.pdf',
          expectedVersion: initial.version,
        },
      });

      expect(updated.receipt_s3_key).toBe(s3Key);
      expect(updated.receipt_filename).toBe('update-fallback.pdf');
      expect(updated.externalUrl).toBeNull();

      const reservation = await reservations.getReservation(uploadId);
      expect(reservation.status).toBe('consumed');
    });

    it('creates disbursement with externalUrl without claiming storage reservation', async () => {
      const extUrl = 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/view';
      const created = await disbursementService.createDisbursement({
        entityId: ENT_ATA_ID,
        entityCode: 'ATA',
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          category: 'Miscellaneous',
          description: 'Client consultation expenses',
          amount: 3200,
          fundSource: 'Firm Fund',
          workRequestId: WR_ID,
          taskId: TASK_ID,
          externalUrl: extUrl,
          receiptFilename: 'google-drive-receipt.pdf',
        },
      });

      expect(created.receipt_s3_key).toBe(extUrl);
      expect(created.receipt_filename).toBe('google-drive-receipt.pdf');
      expect(created.external_url).toBe(extUrl);
      expect(created.externalUrl).toBe(extUrl);
    });

    it('updates disbursement with externalUrl on draft without reservation claim', async () => {
      const initial = await disbursementService.createDisbursement({
        entityId: ENT_ATA_ID,
        entityCode: 'ATA',
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          category: 'Miscellaneous',
          description: 'Team meal',
          amount: 1500,
          fundSource: 'Firm Fund',
          workRequestId: WR_ID,
          taskId: TASK_ID,
        },
      });

      expect(initial.receipt_s3_key).toBeNull();

      const extUrl = 'https://onedrive.live.com/download?cid=12345';
      const updated = await disbursementService.updateDisbursement({
        entityId: ENT_ATA_ID,
        id: initial.id,
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          externalUrl: extUrl,
          receiptFilename: 'onedrive-receipt.pdf',
          expectedVersion: initial.version,
        },
      });

      expect(updated.receipt_s3_key).toBe(extUrl);
      expect(updated.receipt_filename).toBe('onedrive-receipt.pdf');
      expect(updated.externalUrl).toBe(extUrl);
      expect(updated.external_url).toBe(extUrl);
    });

    it('rejects externalUrl update without filename if existing has no filename', async () => {
      const initial = await disbursementService.createDisbursement({
        entityId: ENT_ATA_ID,
        entityCode: 'ATA',
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          category: 'Transportation',
          description: 'Grab taxi fare',
          amount: 450,
          fundSource: 'Firm Fund',
          workRequestId: WR_ID,
          taskId: TASK_ID,
        },
      });

      await expect(
        disbursementService.updateDisbursement({
          entityId: ENT_ATA_ID,
          id: initial.id,
          userId: ADMIN_ID,
          user: adminUser,
          data: {
            externalUrl: 'https://example.com/receipt.pdf',
            expectedVersion: initial.version,
          },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_RECEIPT_ATTACHMENT',
      });
    });

    it('rejects externalUrl edit on non-Draft disbursement with 409', async () => {
      const disbId = 'disb-approved-lock';
      mockTables.disbursements.set(disbId, {
        id: disbId,
        entity_id: ENT_ATA_ID,
        category: 'Transportation',
        description: 'Approved travel',
        amount: 5000,
        fund_source: 'Firm Fund',
        status: 'Approved',
        lifecycle_version: 2,
        linked_work_request_id: WR_ID,
        linked_task_id: TASK_ID,
        task_id: TASK_ID,
        created_by: ADMIN_ID,
        requested_by: ADMIN_ID,
        version: 1,
      });

      await expect(
        disbursementService.updateDisbursement({
          entityId: ENT_ATA_ID,
          id: disbId,
          userId: ADMIN_ID,
          user: adminUser,
          data: {
            externalUrl: 'https://example.com/late-receipt.pdf',
            receiptFilename: 'late.pdf',
            expectedVersion: 1,
          },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT_CURRENT_STATUS',
      });
    });

    it('returns direct external link from getReceiptUrl without calling storage service', async () => {
      const extUrl = 'https://dropbox.com/s/receipt123?dl=1';
      const disb = await disbursementService.createDisbursement({
        entityId: ENT_ATA_ID,
        entityCode: 'ATA',
        userId: ADMIN_ID,
        user: adminUser,
        data: {
          category: 'Printing',
          description: 'Blueprint prints',
          amount: 800,
          fundSource: 'Firm Fund',
          workRequestId: WR_ID,
          taskId: TASK_ID,
          externalUrl: extUrl,
          receiptFilename: 'blueprint-receipt.pdf',
        },
      });

      const receiptMeta = await disbursementService.getReceiptUrl({
        entityId: ENT_ATA_ID,
        id: disb.id,
        user: adminUser,
      });

      expect(storageService.getSignedDownloadUrl).not.toHaveBeenCalled();
      expect(receiptMeta).toEqual({
        url: extUrl,
        externalUrl: extUrl,
        isExternal: true,
        filename: 'blueprint-receipt.pdf',
        contentType: 'text/html',
        expiresAt: null,
      });
    });

    it('storageService.getSignedDownloadUrl returns HTTP(S) URLs directly without Supabase storage call', async () => {
      const httpsUrl = 'https://drive.google.com/file/d/abc123xyz/view';
      const httpUrl = 'http://receipts.example.com/files/2026-11-invoice.pdf';

      const resHttps = await actualStorageService.getSignedDownloadUrl({ path: httpsUrl });
      expect(resHttps).toBe(httpsUrl);

      const resHttp = await actualStorageService.getSignedDownloadUrl({ path: httpUrl });
      expect(resHttp).toBe(httpUrl);
    });
  });
});
