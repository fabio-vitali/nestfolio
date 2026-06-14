import { request, response } from '../../../src/graphql/js-function/confirm-go-live.fn.js';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1', region: 'us-east-1', tableName: 'investor-bff-table' },
  arguments: {},
  result: {},
};

describe('confirmGoLive resolver (sim→live switch)', () => {
  it('TransactWriteItems: puts ExecutionModeChange + flips InvestorProfile executionMode to live', () => {
    const req = request(baseCtx as any);
    expect(req.operation).toBe('TransactWriteItems');
    // P1: two items (ExecutionModeChange Put + InvestorProfile Update). A later phase adds the Mandate item.
    expect(req.transactItems).toHaveLength(2);

    const put = req.transactItems.find((i: any) => i.operation === 'PutItem');
    expect(put.table).toBe('investor-bff-table');
    expect(put.attributeValues.__typename.S).toBe('ExecutionModeChange');
    expect(put.attributeValues.fromMode.S).toBe('simulation');
    expect(put.attributeValues.toMode.S).toBe('live');
    expect(put.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(put.key.sk.S).toMatch(/^ExecutionModeChange#/);
    // write-once: the audit row may not already exist
    expect(put.condition.expression).toContain('attribute_not_exists(pk)');
    // full RequestContext MUST be on the row — the CDC publisher builds the emitted
    // event's context from these; consumers reject events missing context.region.
    expect(put.attributeValues.tenantId.S).toBe('t1');
    expect(put.attributeValues.userId.S).toBe('u1');
    expect(put.attributeValues.region.S).toBe('us-east-1');

    const upd = req.transactItems.find((i: any) => i.operation === 'UpdateItem');
    expect(upd.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(upd.key.sk.S).toBe('InvestorProfile');
    // audit row shares the profile's pk (same item collection)
    expect(put.key.pk.S).toBe(upd.key.pk.S);
    expect(upd.update.expression).toContain('executionMode = :mode');
    expect(upd.update.expressionValues[':mode'].S).toBe('live');
    expect(upd.update.expression).toContain('#v = if_not_exists(#v, :zero) + :one');
    expect(upd.update.expressionNames['#v']).toBe('__version');
    expect(upd.condition.expression).toContain('attribute_exists(pk)');
    // double-confirm guard: only flips when still in simulation
    expect(upd.condition.expression).toContain('executionMode = :simulation');
  });

  it('maps a cancelled transaction to a clean InvalidState error', () => {
    expect(() => response({
      ...baseCtx,
      error: { message: 'cancelled', type: 'DynamoDB:TransactionCanceledException' },
    } as any)).toThrow(/go.?live/i);
  });

  it('passes ctx.result through on success (readback step returns the profile)', () => {
    expect(response(baseCtx as any)).toEqual({});
  });
});
