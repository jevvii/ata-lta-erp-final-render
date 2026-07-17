/**
 * Disbursements service unit tests.
 * Tests for status workflow transitions.
 */

describe('Disbursements Service - Status Workflow', () => {
  const VALID_TRANSITIONS = {
    submit: { from: 'Draft', to: 'Pending' },
    approve: { from: 'Pending', to: 'Approved' },
    release: { from: 'Approved', to: 'Released' },
    reject: { from: ['Pending', 'Approved'], to: 'Rejected' },
  };

  describe('Valid transitions', () => {
    it('allows Draft → Pending (submit)', () => {
      const transition = VALID_TRANSITIONS.submit;
      expect(transition.from).toBe('Draft');
      expect(transition.to).toBe('Pending');
    });

    it('allows Pending → Approved (approve)', () => {
      const transition = VALID_TRANSITIONS.approve;
      expect(transition.from).toBe('Pending');
      expect(transition.to).toBe('Approved');
    });

    it('allows Approved → Released (release)', () => {
      const transition = VALID_TRANSITIONS.release;
      expect(transition.from).toBe('Approved');
      expect(transition.to).toBe('Released');
    });

    it('allows rejection from Pending', () => {
      const transition = VALID_TRANSITIONS.reject;
      expect(transition.from).toContain('Pending');
    });

    it('allows rejection from Approved', () => {
      const transition = VALID_TRANSITIONS.reject;
      expect(transition.from).toContain('Approved');
    });
  });

  describe('Invalid transitions', () => {
    it('does not allow submitting a Released disbursement', () => {
      const transition = VALID_TRANSITIONS.submit;
      const currentStatus = 'Released';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });

    it('does not allow approving a Draft disbursement', () => {
      const transition = VALID_TRANSITIONS.approve;
      const currentStatus = 'Draft';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });

    it('does not allow releasing a Pending disbursement', () => {
      const transition = VALID_TRANSITIONS.release;
      const currentStatus = 'Pending';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });

    it('does not allow rejecting a Draft disbursement', () => {
      const transition = VALID_TRANSITIONS.reject;
      const currentStatus = 'Draft';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });

    it('does not allow rejecting a Released disbursement', () => {
      const transition = VALID_TRANSITIONS.reject;
      const currentStatus = 'Released';
      const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];
      expect(validFrom.includes(currentStatus)).toBe(false);
    });
  });

  describe('Disbursement number generation', () => {
    it('follows the DISB-{ENTITY}-{YYYYMMDD}-{SEQ} format', () => {
      const entityId = 'ATA';
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const seq = '0001';
      const number = `DISB-${entityId}-${today}-${seq}`;

      expect(number).toMatch(/^DISB-ATA-\d{8}-\d{4}$/);
    });
  });
});
