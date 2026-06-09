import { ReconciliationResultSchema, DriftRecordSchema } from '../../../src/domain/contracts';

describe('reconciliation-ctrl contracts', () => {
  it('ReconciliationResultSchema parses a result aggregate (no identity)', () => {
    const subject = { reconciliationId: 'r1', status: 'DRIFT_DETECTED', driftCount: 2 };
    expect(ReconciliationResultSchema.parse(subject)).toEqual(subject);
  });

  it('ReconciliationResultSchema rejects an unknown status', () => {
    expect(() => ReconciliationResultSchema.parse({
      reconciliationId: 'r1', status: 'PENDING', driftCount: 0,
    })).toThrow();
  });

  it('DriftRecordSchema parses a drift aggregate (no identity)', () => {
    const subject = {
      reconciliationId: 'r1', instrument: 'VTI',
      intentQty: 50, settlementQty: 45, drift: 5,
    };
    expect(DriftRecordSchema.parse(subject)).toEqual(subject);
  });
});
