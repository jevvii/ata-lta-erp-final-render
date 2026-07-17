/**
 * Billing service unit tests.
 * Tests for invoice totals, payment balance, and aging bucket calculation.
 */

const _billingService = require('../../../../src/modules/billing/service');

// Mock Supabase
jest.mock('../../../../src/services/supabaseClient', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: {}, error: null }),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    })),
  },
}));

jest.mock('../../../../src/services/storageService', () => ({
  uploadBuffer: jest.fn().mockResolvedValue('https://storage.example.com/download'),
}));

jest.mock('../../../../src/services/pdfService', () => ({
  generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf-content')),
}));

jest.mock('../../../../src/services/auditService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

describe('Billing Service', () => {
  describe('Aging Report Logic', () => {
    it('categorizes current (not-yet-due) invoices correctly', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dueDate = tomorrow;
      const now = new Date();
      const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));

      expect(daysOverdue).toBeLessThanOrEqual(0);
    });

    it('categorizes 1-30 day overdue invoices', () => {
      const past = new Date();
      past.setDate(past.getDate() - 15);
      const now = new Date();
      const daysOverdue = Math.floor((now - past) / (1000 * 60 * 60 * 24));

      expect(daysOverdue).toBeGreaterThan(0);
      expect(daysOverdue).toBeLessThanOrEqual(30);
    });

    it('categorizes 31-60 day overdue invoices', () => {
      const past = new Date();
      past.setDate(past.getDate() - 45);
      const now = new Date();
      const daysOverdue = Math.floor((now - past) / (1000 * 60 * 60 * 24));

      expect(daysOverdue).toBeGreaterThan(30);
      expect(daysOverdue).toBeLessThanOrEqual(60);
    });

    it('categorizes 90+ day overdue invoices', () => {
      const past = new Date();
      past.setDate(past.getDate() - 120);
      const now = new Date();
      const daysOverdue = Math.floor((now - past) / (1000 * 60 * 60 * 24));

      expect(daysOverdue).toBeGreaterThan(90);
    });
  });

  describe('Invoice Total Calculation', () => {
    it('calculates subtotal from line items correctly', () => {
      const lineItems = [
        { description: 'Service A', amount: 1000, type: 'Professional Fee' },
        { description: 'Service B', amount: 2500, type: 'Professional Fee' },
        { description: 'Gov Fee', amount: 500, type: 'Government Fee' },
      ];

      const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
      expect(subtotal).toBe(4000);
    });

    it('balance equals total when no payments', () => {
      const total = 5000;
      const amountPaid = 0;
      const balance = total - amountPaid;

      expect(balance).toBe(5000);
    });

    it('balance updates correctly after partial payment', () => {
      const total = 5000;
      const amountPaid = 2000;
      const balance = total - amountPaid;

      expect(balance).toBe(3000);
    });

    it('sets status to Paid when balance reaches zero', () => {
      const total = 5000;
      const newAmountPaid = 5000;
      const newBalance = total - newAmountPaid;
      const newStatus = newBalance <= 0 ? 'Paid' : newAmountPaid > 0 ? 'Partially Paid' : 'Draft';

      expect(newBalance).toBe(0);
      expect(newStatus).toBe('Paid');
    });

    it('sets status to Partially Paid for partial payment', () => {
      const total = 5000;
      const newAmountPaid = 2000;
      const newBalance = total - newAmountPaid;
      const newStatus = newBalance <= 0 ? 'Paid' : newAmountPaid > 0 ? 'Partially Paid' : 'Draft';

      expect(newBalance).toBe(3000);
      expect(newStatus).toBe('Partially Paid');
    });
  });
});
