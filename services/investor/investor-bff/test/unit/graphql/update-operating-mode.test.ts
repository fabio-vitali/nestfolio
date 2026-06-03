import { request, response } from '../../../src/graphql/js-function/update-operating-mode.fn.js';

const baseCtx = {
  stash: { tenantId: 't1', userId: 'u1', tableName: 'investor-bff-table' },
  arguments: { mode: 'AGGRESSIVE' },
  result: {},
};

describe('updateOperatingMode resolver (dual-write)', () => {
  it('produces a TransactWriteItems over the InvestorProfile and Mandate rows', () => {
    const req = request(baseCtx as any);
    expect(req.operation).toBe('TransactWriteItems');
    expect(req.transactItems).toHaveLength(2);

    const [profileWrite, mandateWrite] = req.transactItems;

    expect(profileWrite.table).toBe('investor-bff-table');
    expect(profileWrite.operation).toBe('UpdateItem');
    expect(profileWrite.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(profileWrite.key.sk.S).toBe('InvestorProfile');
    expect(profileWrite.update.expression).toBe(
      'SET operatingMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
    );
    expect(profileWrite.update.expressionNames['#v']).toBe('__version');
    expect(profileWrite.condition.expression).toBe('attribute_exists(pk)');

    expect(mandateWrite.table).toBe('investor-bff-table');
    expect(mandateWrite.operation).toBe('UpdateItem');
    expect(mandateWrite.key.pk.S).toBe('InvestorProfile#t1#u1');
    expect(mandateWrite.key.sk.S).toBe('Mandate');
    expect(mandateWrite.update.expression).toBe(
      'SET operatingMode = :mode, updatedAt = :now, #ts = :now, #v = if_not_exists(#v, :zero) + :one',
    );
    expect(mandateWrite.update.expressionNames['#v']).toBe('__version');
    expect(mandateWrite.condition.expression).toBe('attribute_exists(pk) AND #status = :active');
    expect(mandateWrite.condition.expressionNames['#status']).toBe('status');
  });

  it('rejects an invalid mode', () => {
    expect(() => request({ ...baseCtx, arguments: { mode: 'YOLO' } } as any)).toThrow();
  });

  it('maps a cancelled transaction to a clean InvalidState error', () => {
    expect(() => response({
      ...baseCtx,
      error: { message: 'cancelled', type: 'DynamoDB:TransactionCanceledException' },
    } as any)).toThrow(/operating mode/i);
  });

  it('passes ctx.result through on success', () => {
    expect(response(baseCtx as any)).toEqual({});
  });
});
