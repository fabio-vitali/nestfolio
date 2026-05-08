import * as fn1 from '../../../src/graphql/js-function/get-profile.fn.js';
import * as fn2 from '../../../src/graphql/js-function/get-profile-mandate.fn.js';

describe('getProfile pipeline resolver', () => {
  const baseCtx = {
    stash: { tenantId: 't1', userId: 'u1' },
    prev: { result: { tenantId: 't1', userId: 'u1', email: 'u1@x', operatingMode: 'BALANCED', mandateId: 'm1', mandateLevel: 'DISCRETIONARY' } },
    result: { mandateId: 'm1', level: 'DISCRETIONARY', status: 'ACTIVE', effectiveDate: '2026-05-08T00:00:00Z', revokedAt: null },
  };

  it('function 1: gets the InvestorProfile row', () => {
    const req = fn1.request({ stash: { tenantId: 't1', userId: 'u1' } } as any);
    expect(req.operation).toBe('GetItem');
    expect(req.key.sk.S).toBe('InvestorProfile');
  });

  it('function 2: gets the Mandate row using the same pk', () => {
    const req = fn2.request(baseCtx as any);
    expect(req.operation).toBe('GetItem');
    expect(req.key.sk.S).toBe('Mandate');
    expect(req.key.pk.S).toBe('InvestorProfile#t1#u1');
  });

  it('function 2 response merges Mandate row into profile.mandate', () => {
    const merged = fn2.response(baseCtx as any);
    expect(merged.email).toBe('u1@x');
    expect(merged.mandate).toEqual({
      mandateId: 'm1', level: 'DISCRETIONARY', status: 'ACTIVE',
      effectiveDate: '2026-05-08T00:00:00Z', revokedAt: null,
    });
  });
});
