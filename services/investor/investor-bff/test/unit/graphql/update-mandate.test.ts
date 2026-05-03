import { request, response } from '../../../src/graphql/js-function/update-mandate.fn.js';

describe('update-mandate resolver', () => {
  const stash = { tenantId: 'tenant-1', userId: 'user-1' };

  describe('request', () => {
    it('targets the composite InvestorProfile row (sk=InvestorProfile)', () => {
      const ctx = {
        stash,
        arguments: { input: { level: 'ADVISORY' } },
      };
      const op = request(ctx);

      expect(op.operation).toBe('UpdateItem');
      expect(op.key).toEqual({
        pk: { S: 'InvestorProfile#tenant-1#user-1' },
        sk: { S: 'InvestorProfile' },
      });
    });

    it('emits nested-path SET expressions of shape `mandate.#<field> = :<field>`', () => {
      const ctx = {
        stash,
        arguments: {
          input: {
            level: 'ADVISORY',
            monthlyTurnoverCapPercent: 25,
            maxSingleTradePercent: 10,
          },
        },
      };
      const op = request(ctx);

      expect(op.update.expression).toContain('mandate.#level = :level');
      expect(op.update.expression).toContain('mandate.#monthlyTurnoverCapPercent = :monthlyTurnoverCapPercent');
      expect(op.update.expression).toContain('mandate.#maxSingleTradePercent = :maxSingleTradePercent');
      expect(op.update.expression).toContain('updatedAt = :now');
      expect(op.update.expressionNames['#level']).toBe('level');
      expect(op.update.expressionNames['#monthlyTurnoverCapPercent']).toBe('monthlyTurnoverCapPercent');
      expect(op.update.expressionValues[':level']).toEqual({ S: 'ADVISORY' });
      expect(op.update.expressionValues[':monthlyTurnoverCapPercent']).toEqual({ N: '25' });
    });

    it('rejects monthlyTurnoverCapPercent < 0 via util.error', () => {
      const ctx = { stash, arguments: { input: { monthlyTurnoverCapPercent: -1 } } };
      expect(() => request(ctx)).toThrow('monthlyTurnoverCapPercent 0-100');
    });

    it('rejects monthlyTurnoverCapPercent > 100 via util.error', () => {
      const ctx = { stash, arguments: { input: { monthlyTurnoverCapPercent: 101 } } };
      expect(() => request(ctx)).toThrow('monthlyTurnoverCapPercent 0-100');
    });

    it('rejects maxSingleTradePercent < 0 via util.error', () => {
      const ctx = { stash, arguments: { input: { maxSingleTradePercent: -5 } } };
      expect(() => request(ctx)).toThrow('maxSingleTradePercent 0-100');
    });

    it('rejects maxSingleTradePercent > 100 via util.error', () => {
      const ctx = { stash, arguments: { input: { maxSingleTradePercent: 200 } } };
      expect(() => request(ctx)).toThrow('maxSingleTradePercent 0-100');
    });

    it('accepts boundary values 0 and 100 (no error)', () => {
      const ctx0 = { stash, arguments: { input: { monthlyTurnoverCapPercent: 0, maxSingleTradePercent: 0 } } };
      expect(() => request(ctx0)).not.toThrow();
      const ctx100 = { stash, arguments: { input: { monthlyTurnoverCapPercent: 100, maxSingleTradePercent: 100 } } };
      expect(() => request(ctx100)).not.toThrow();
    });

    it('drops undefined/null fields from the SET clause', () => {
      const ctx = {
        stash,
        arguments: { input: { level: 'ADVISORY', monthlyTurnoverCapPercent: undefined, maxSingleTradePercent: null } },
      };
      const op = request(ctx);

      expect(op.update.expression).toContain('mandate.#level = :level');
      expect(op.update.expression).not.toContain('monthlyTurnoverCapPercent');
      expect(op.update.expression).not.toContain('maxSingleTradePercent');
    });

    it('includes attribute_exists(pk) precondition', () => {
      const ctx = { stash, arguments: { input: { level: 'ADVISORY' } } };
      const op = request(ctx);

      expect(op.condition.expression).toBe('attribute_exists(pk)');
    });
  });

  describe('response', () => {
    it('returns ctx.result.mandate (the nested mandate object on the composite row)', () => {
      const mandate = { mandateId: 'm-1', level: 'ADVISORY', status: 'ACTIVE', monthlyTurnoverCapPercent: 25 };
      const ctx = {
        stash,
        arguments: { input: { level: 'ADVISORY' } },
        result: { goal: { objective: 'X' }, mandate },
      };

      expect(response(ctx)).toBe(mandate);
    });

    it('rethrows ctx.error via util.error', () => {
      const ctx = {
        stash,
        arguments: { input: { level: 'ADVISORY' } },
        error: { message: 'conditional failed', type: 'DynamoDB:ConditionalCheckFailedException' },
      };

      expect(() => response(ctx)).toThrow('conditional failed');
    });
  });
});
