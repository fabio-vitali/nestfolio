import { request, response } from '../../../src/graphql/js-function/revoke-mandate.fn.js';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1' },
  arguments: {},
  result: { mandateId: 'm1', level: 'DISCRETIONARY', status: 'REVOKED', effectiveDate: '2026-05-08T00:00:00Z', revokedAt: '2026-05-08T00:00:01Z' },
};

describe('revokeMandate resolver', () => {
  it('targets sk=Mandate row, not MandateStatus', () => {
    const req = request(baseCtx as any);
    expect(req.operation).toBe('UpdateItem');
    expect(req.key.sk.S).toBe('Mandate');
    expect(req.update.expression).toMatch(/SET #status = :revoked/);
    expect(req.condition.expression).toMatch(/#status = :active/);
  });

  it('returns the full Mandate row from response', () => {
    expect(response(baseCtx as any)).toEqual(baseCtx.result);
  });

  it('translates DDB ConditionalCheckFailedException into InvalidState', () => {
    const errCtx = {
      ...baseCtx,
      error: {
        type: 'DynamoDB:ConditionalCheckFailedException',
        message: 'The conditional request failed',
      },
    };
    expect(() => response(errCtx as any)).toThrow(/InvalidState|not active/);
  });
});
