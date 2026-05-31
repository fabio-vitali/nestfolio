import { request, response } from '../../../src/graphql/js-function/update-goal.fn.js';

describe('update-goal resolver', () => {
  const stash = { tenantId: 'tenant-1', userId: 'user-1' };

  describe('request', () => {
    it('targets the composite InvestorProfile row (sk=InvestorProfile, NOT Goal#${id})', () => {
      const ctx = {
        stash,
        arguments: { input: { objective: 'Retirement' } },
      };
      const op = request(ctx);

      expect(op.operation).toBe('UpdateItem');
      expect(op.key).toEqual({
        pk: { S: 'InvestorProfile#tenant-1#user-1' },
        sk: { S: 'InvestorProfile' },
      });
    });

    it('emits nested-path SET expressions of shape `goal.#<field> = :<field>`', () => {
      const ctx = {
        stash,
        arguments: {
          input: {
            objective: 'Retirement',
            timeHorizonMonths: 240,
            targetAmountCents: 1_000_000,
          },
        },
      };
      const op = request(ctx);

      expect(op.update.expression).toContain('goal.#objective = :objective');
      expect(op.update.expression).toContain('goal.#timeHorizonMonths = :timeHorizonMonths');
      expect(op.update.expression).toContain('goal.#targetAmountCents = :targetAmountCents');
      expect(op.update.expression).toContain('updatedAt = :now');
      expect(op.update.expressionNames['#objective']).toBe('objective');
      expect(op.update.expressionNames['#timeHorizonMonths']).toBe('timeHorizonMonths');
      expect(op.update.expressionValues[':objective']).toEqual({ S: 'Retirement' });
      expect(op.update.expressionValues[':timeHorizonMonths']).toEqual({ N: '240' });
    });

    it('drops undefined fields from the SET clause', () => {
      const ctx = {
        stash,
        arguments: {
          input: { objective: 'Retirement', timeHorizonMonths: undefined },
        },
      };
      const op = request(ctx);

      expect(op.update.expression).toContain('goal.#objective = :objective');
      expect(op.update.expression).not.toContain('timeHorizonMonths');
      expect(op.update.expressionNames['#timeHorizonMonths']).toBeUndefined();
    });

    it('drops null fields from the SET clause', () => {
      const ctx = {
        stash,
        arguments: {
          input: { objective: 'Retirement', targetAmountCents: null },
        },
      };
      const op = request(ctx);

      expect(op.update.expression).toContain('goal.#objective = :objective');
      expect(op.update.expression).not.toContain(':targetAmountCents');
    });

    it('includes attribute_exists(pk) precondition (composite row must exist)', () => {
      const ctx = {
        stash,
        arguments: { input: { objective: 'Retirement' } },
      };
      const op = request(ctx);

      expect(op.condition.expression).toBe('attribute_exists(pk)');
    });

    it('increments __version in the update expression', () => {
      const ctx = {
        stash,
        arguments: { input: { targetReturn: 0.1 } },
      };
      const op = request(ctx);

      expect(op.update.expression).toContain('#v = if_not_exists(#v, :zero) + :one');
      expect(op.update.expressionNames['#v']).toBe('__version');
    });
  });

  describe('response', () => {
    it('returns ctx.result.goal (the nested goal object on the composite row)', () => {
      const goal = { objective: 'Retirement', timeHorizonMonths: 240, targetAmountCents: 1_000_000 };
      const ctx = {
        stash,
        arguments: { input: { objective: 'Retirement' } },
        result: { goal, mandate: { level: 'DISCRETIONARY' } },
      };

      expect(response(ctx)).toBe(goal);
    });

    it('rethrows ctx.error via util.error', () => {
      const ctx = {
        stash,
        arguments: { input: { objective: 'Retirement' } },
        error: { message: 'conditional failed', type: 'DynamoDB:ConditionalCheckFailedException' },
      };

      expect(() => response(ctx)).toThrow('conditional failed');
    });
  });
});
