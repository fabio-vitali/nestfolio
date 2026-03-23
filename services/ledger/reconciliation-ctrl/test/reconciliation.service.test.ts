jest.mock('@nestfolio/event-processor', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { ReconciliationService } from '../src/services/reconciliation.service';

describe('ReconciliationService', () => {
  let service: ReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReconciliationService();
  });

  describe('reconcile', () => {
    it('should return COMPLETED when no drift detected', () => {
      const result = service.reconcile('test-reconciliation-id', {
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'MSFT', quantity: 50 },
        ],
        settlementPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'MSFT', quantity: 50 },
        ],
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.drifts).toHaveLength(0);
    });

    it('should return DRIFT_DETECTED when drift exists', () => {
      const result = service.reconcile('test-reconciliation-id', {
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'MSFT', quantity: 50 },
        ],
        settlementPositions: [
          { instrument: 'AAPL', quantity: 95 },
          { instrument: 'MSFT', quantity: 50 },
        ],
      });

      expect(result.status).toBe('DRIFT_DETECTED');
      expect(result.drifts).toHaveLength(1);
      expect(result.drifts[0]).toMatchObject({
        instrument: 'AAPL',
        intentQty: 100,
        settlementQty: 95,
        drift: 5,
      });
    });

    it('should handle multiple instruments with drift', () => {
      const result = service.reconcile('test-reconciliation-id', {
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'MSFT', quantity: 50 },
          { instrument: 'GOOG', quantity: 25 },
        ],
        settlementPositions: [
          { instrument: 'AAPL', quantity: 95 },
          { instrument: 'MSFT', quantity: 50 },
          { instrument: 'GOOG', quantity: 30 },
        ],
      });

      expect(result.status).toBe('DRIFT_DETECTED');
      expect(result.drifts).toHaveLength(2);

      const aaplDrift = result.drifts.find((d) => d.instrument === 'AAPL');
      expect(aaplDrift).toMatchObject({ drift: 5 });

      const googDrift = result.drifts.find((d) => d.instrument === 'GOOG');
      expect(googDrift).toMatchObject({ drift: -5 });
    });

    it('should handle instruments present only in intent', () => {
      const result = service.reconcile('test-reconciliation-id', {
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'TSLA', quantity: 20 },
        ],
        settlementPositions: [
          { instrument: 'AAPL', quantity: 100 },
        ],
      });

      expect(result.status).toBe('DRIFT_DETECTED');
      expect(result.drifts).toHaveLength(1);
      expect(result.drifts[0]).toMatchObject({
        instrument: 'TSLA',
        intentQty: 20,
        settlementQty: 0,
        drift: 20,
      });
    });

    it('should handle instruments present only in settlement', () => {
      const result = service.reconcile('test-reconciliation-id', {
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [
          { instrument: 'AAPL', quantity: 100 },
        ],
        settlementPositions: [
          { instrument: 'AAPL', quantity: 100 },
          { instrument: 'TSLA', quantity: 20 },
        ],
      });

      expect(result.status).toBe('DRIFT_DETECTED');
      expect(result.drifts).toHaveLength(1);
      expect(result.drifts[0]).toMatchObject({
        instrument: 'TSLA',
        intentQty: 0,
        settlementQty: 20,
        drift: -20,
      });
    });

    it('should ignore tiny floating-point differences below threshold', () => {
      const result = service.reconcile('test-reconciliation-id', {
        tenantId: 't1',
        portfolioId: 'p1',
        intentPositions: [{ instrument: 'AAPL', quantity: 100.0005 }],
        settlementPositions: [{ instrument: 'AAPL', quantity: 100 }],
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.drifts).toHaveLength(0);
    });
  });
});
