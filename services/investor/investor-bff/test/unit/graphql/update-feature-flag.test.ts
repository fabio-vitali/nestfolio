import { request, response } from '../../../src/graphql/js-function/update-feature-flag.fn.js';

describe('update-feature-flag resolver', () => {
  describe('request', () => {
    it('writes the FeatureFlag#SYSTEM row unconditionally when eventTimestamp is absent (manual/ops path)', () => {
      const ctx = {
        arguments: { name: 'initiateDeposit', enabled: false, reason: 'maintenance' },
      };
      const op = request(ctx);

      expect(op.operation).toBe('PutItem');
      expect(op.key).toEqual({
        pk: { S: 'FeatureFlag#SYSTEM' },
        sk: { S: 'FeatureFlag#initiateDeposit' },
      });
      expect(op.condition).toBeUndefined();
      // A manual write stamps lastEventAt with server time so it outranks any
      // event emitted before it.
      expect(op.attributeValues['lastEventAt']).toEqual({ S: '2026-04-22T00:00:00.000Z' });
      expect(op.attributeValues['enabled']).toEqual({ BOOL: false });
      expect(op.attributeValues['reason']).toEqual({ S: 'maintenance' });
    });

    it('guards the write on event freshness when eventTimestamp is present (broadcast path)', () => {
      const ctx = {
        arguments: {
          name: 'initiateDeposit',
          enabled: false,
          reason: 'Broker connectivity issue',
          eventTimestamp: '2026-06-26T17:16:23.159Z',
        },
      };
      const op = request(ctx);

      expect(op.operation).toBe('PutItem');
      expect(op.condition).toEqual({
        expression: 'attribute_not_exists(lastEventAt) OR lastEventAt < :et',
        expressionValues: { ':et': { S: '2026-06-26T17:16:23.159Z' } },
      });
      expect(op.attributeValues['lastEventAt']).toEqual({ S: '2026-06-26T17:16:23.159Z' });
    });

    it('rejects equal timestamps via strict <, making duplicate redeliveries no-ops', () => {
      const ctx = {
        arguments: { name: 'confirmDecision', enabled: true, eventTimestamp: '2026-06-26T17:16:25.488Z' },
      };
      const op = request(ctx);
      expect(op.condition.expression).toBe('attribute_not_exists(lastEventAt) OR lastEventAt < :et');
    });
  });

  describe('response', () => {
    it('returns the flag projection on success', () => {
      const ctx = {
        error: undefined,
        result: { name: 'initiateDeposit', enabled: true, reason: null, lastEventAt: 'x' },
      };
      expect(response(ctx)).toEqual({ name: 'initiateDeposit', enabled: true, reason: null });
    });

    it('propagates errors (including the conditional stale-write rejection)', () => {
      const ctx = {
        error: { message: 'conditional check failed', type: 'DynamoDB:ConditionalCheckFailedException' },
        result: null,
      };
      expect(() => response(ctx)).toThrow('conditional check failed');
    });
  });
});
