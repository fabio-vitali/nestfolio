import { request, response } from '../../../src/graphql/js-function/update-risk-profile.fn.ts';
import { computeRiskProfile } from '../../../src/domain/risk-profile.service';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1', region: 'us-east-1', tableName: 'investor-bff-table' },
  arguments: { toleranceIdx: 3, experienceIdx: 1 },
  result: {},
};

describe('updateRiskProfile resolver', () => {
  it('recomputes riskProfile via the canonical computeRiskProfile and writes it', () => {
    const req = request(baseCtx as any);
    const expected = computeRiskProfile(3, 1);
    expect(req.operation).toBe('UpdateItem');
    expect(req.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(req.key.sk.S).toBe('InvestorProfile');
    expect(req.update.expression).toContain('riskProfile = :rp');
    expect(req.update.expression).toContain('#v = if_not_exists(#v, :zero) + :one');
    expect(req.update.expressionNames['#v']).toBe('__version');
    const rp = req.update.expressionValues[':rp'].M;
    expect(Number(rp.score.N)).toBe(expected.score);
    expect(rp.band.M.minEquity.N).toBe(String(expected.band.minEquity));
    // computeRiskProfile returns `tolerance`; resolver maps it to `toleranceResponse`
    expect(rp.toleranceResponse.S).toBe(expected.tolerance);
    expect(rp.experienceLevel.S).toBe(expected.experienceLevel);
  });

  it('guards on profile existence', () => {
    const req = request(baseCtx as any);
    expect(req.condition.expression).toContain('attribute_exists(pk)');
  });

  it('passes ctx.result through on success', () => {
    expect(response(baseCtx as any)).toEqual({});
  });
});
