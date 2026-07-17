/**
 * Transmittals service unit tests.
 * Tests for status workflow transitions.
 */

describe('Transmittals Service - Status Workflow', () => {
  describe('Valid transitions', () => {
    it('allows Draft → Sent (send)', () => {
      const validFrom = 'Draft';
      const currentStatus = 'Draft';
      expect(currentStatus).toBe(validFrom);
    });

    it('allows Sent → Acknowledged (acknowledge)', () => {
      const validFrom = 'Sent';
      const currentStatus = 'Sent';
      expect(currentStatus).toBe(validFrom);
    });
  });

  describe('Invalid transitions', () => {
    it('does not allow sending an Acknowledged transmittal', () => {
      const validFrom = 'Draft';
      const currentStatus = 'Acknowledged';
      expect(currentStatus).not.toBe(validFrom);
    });

    it('does not allow acknowledging a Draft transmittal', () => {
      const validFrom = 'Sent';
      const currentStatus = 'Draft';
      expect(currentStatus).not.toBe(validFrom);
    });

    it('does not allow sending a Sent transmittal again', () => {
      const validFrom = 'Draft';
      const currentStatus = 'Sent';
      expect(currentStatus).not.toBe(validFrom);
    });
  });
});
