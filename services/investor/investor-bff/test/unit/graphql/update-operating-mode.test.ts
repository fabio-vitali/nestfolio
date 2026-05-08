import { request, response } from '../../../src/graphql/js-function/update-operating-mode.fn.js';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1' },
  arguments: { mode: 'AGGRESSIVE' },
  result: { operatingMode: 'AGGRESSIVE', updatedAt: '2026-05-08T00:00:00Z' },
};

describe('updateOperatingMode resolver', () => {
  it('produces an UpdateItem on sk=InvestorProfile setting only operatingMode + timestamps', () => {
    const req = request(baseCtx as any);
    expect(req.operation).toBe('UpdateItem');
    expect(req.key.sk.S).toBe('InvestorProfile');
    expect(req.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(req.update.expression).toBe('SET operatingMode = :mode, updatedAt = :now, #ts = :now');
    expect(req.condition.expression).toBe('attribute_exists(pk)');
  });

  it('rejects an invalid mode', () => {
    expect(() => request({ ...baseCtx, arguments: { mode: 'YOLO' } } as any))
      .toThrow();
  });

  it('returns the updated profile from response handler', () => {
    expect(response(baseCtx as any)).toEqual(baseCtx.result);
  });
});
