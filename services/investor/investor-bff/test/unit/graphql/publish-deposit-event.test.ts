import { request, response } from '../../../src/graphql/js-function/publish-deposit-event.fn.js';

describe('publish-deposit-event resolver', () => {
  const baseInput = {
    depositId: 'dep-123',
    tenantId: 'tenant-1',
    userId: 'user-1',
    status: 'DETECTED',
    amountCents: 500_000,
    currency: 'USD',
    occurredAt: '2026-04-22T10:00:00.000Z',
    reason: null,
  };

  it('request: builds an UpdateItem with attribute_exists(pk) condition and status + timestamp set', () => {
    const ctx = { arguments: { input: baseInput } };
    const op = request(ctx);

    expect(op.operation).toBe('UpdateItem');
    expect(op.key).toEqual({
      pk: { S: 'InvestorProfile#tenant-1#user-1' },
      sk: { S: 'Deposit#dep-123' },
    });
    expect(op.condition.expression).toContain('attribute_exists(pk)');
    expect(op.update.expression).toContain('SET');
    expect(op.update.expression).toContain('#status = :status');
    expect(op.update.expressionValues[':status']).toEqual({ S: 'DETECTED' });
    expect(op.update.expressionValues[':amountCents']).toEqual({ N: '500000' });
    expect(op.update.expressionValues[':occurredAt']).toEqual({ S: '2026-04-22T10:00:00.000Z' });
  });

  it('response: returns the DepositEvent shape', () => {
    const ctx = {
      arguments: { input: baseInput },
      result: {
        depositId: 'dep-123',
        tenantId: 'tenant-1',
        status: 'DETECTED',
        amountCents: 500_000,
        currency: 'USD',
        occurredAt: '2026-04-22T10:00:00.000Z',
        reason: null,
      },
    };
    const out = response(ctx);

    expect(out).toEqual({
      depositId: 'dep-123',
      tenantId: 'tenant-1',
      status: 'DETECTED',
      amountCents: 500_000,
      currency: 'USD',
      occurredAt: '2026-04-22T10:00:00.000Z',
      reason: null,
    });
  });

  it('response: rethrows ConditionalCheckFailedException via util.error', () => {
    const ctx = {
      arguments: { input: baseInput },
      error: { message: 'The conditional request failed', type: 'DynamoDB:ConditionalCheckFailedException' },
    };
    expect(() => response(ctx)).toThrow('The conditional request failed');
  });
});
