import { subjectSchemas, exemptTypenames } from '../../src/handlers/publisher-schemas';

const EMITTED = ['VirtualTrade', 'DepositDetected', 'WithdrawalCompleted'];

describe('broker-sim-adpt CDC publisher registry', () => {
  it('covers every emitted __typename (schemas ∪ exempt === emitted)', () => {
    const registered = new Set([...Object.keys(subjectSchemas), ...exemptTypenames]);
    expect([...registered].sort()).toEqual([...EMITTED].sort());
  });

  it('every registered schema is a zod schema', () => {
    for (const s of Object.values(subjectSchemas)) {
      expect(typeof (s as { parse?: unknown }).parse).toBe('function');
    }
  });
});
