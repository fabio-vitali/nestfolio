import { request, response } from '../../../src/graphql/js-function/revoke-mandate.fn.js';

describe('revoke-mandate resolver', () => {
  const stash = { tenantId: 'tenant-1', userId: 'user-1' };

  describe('request', () => {
    it('targets the MandateStatus sibling row (sk=MandateStatus, NOT InvestorProfile composite — avoids spurious INVESTOR_PROFILE_UPDATED CDC)', () => {
      const op = request({ stash });

      expect(op.operation).toBe('UpdateItem');
      expect(op.key).toEqual({
        pk: { S: 'InvestorProfile#tenant-1#user-1' },
        sk: { S: 'MandateStatus' },
      });
    });

    it('flips status to REVOKED and sets revokedAt + updatedAt + timestamp = now', () => {
      const op = request({ stash });

      expect(op.update.expression).toContain('#status = :revoked');
      expect(op.update.expression).toContain('revokedAt = :now');
      expect(op.update.expression).toContain('updatedAt = :now');
      expect(op.update.expression).toContain('#ts = :now');
      expect(op.update.expressionNames['#status']).toBe('status');
      expect(op.update.expressionNames['#ts']).toBe('timestamp');
      expect(op.update.expressionValues[':revoked']).toEqual({ S: 'REVOKED' });
      expect(op.update.expressionValues[':now']).toEqual({ S: '2026-04-22T00:00:00.000Z' });
    });

    it('includes attribute_exists(pk) AND status=ACCEPTED precondition (prevents double-revoke + missing-row revoke)', () => {
      const op = request({ stash });

      expect(op.condition.expression).toBe('attribute_exists(pk) AND #status = :active');
      expect(op.condition.expressionNames['#status']).toBe('status');
      expect(op.condition.expressionValues[':active']).toEqual({ S: 'ACCEPTED' });
    });
  });

  describe('response', () => {
    it('returns the MandateStatus shape {status, acceptedAt, revokedAt} from ctx.result', () => {
      const ctx = {
        stash,
        result: {
          status: 'REVOKED',
          acceptedAt: '2026-05-01T00:00:00.000Z',
          revokedAt: '2026-05-03T00:00:00.000Z',
          updatedAt: '2026-05-03T00:00:00.000Z',
          timestamp: '2026-05-03T00:00:00.000Z',
        },
      };

      expect(response(ctx)).toEqual({
        status: 'REVOKED',
        acceptedAt: '2026-05-01T00:00:00.000Z',
        revokedAt: '2026-05-03T00:00:00.000Z',
      });
    });

    it('maps DynamoDB:ConditionalCheckFailedException to InvalidState (already-revoked / not-active guard)', () => {
      const ctx = {
        stash,
        error: { message: 'The conditional request failed', type: 'DynamoDB:ConditionalCheckFailedException' },
      };

      expect(() => response(ctx)).toThrow('Mandate is not active or already revoked');
    });

    it('rethrows non-conditional ctx.error verbatim via util.error', () => {
      const ctx = {
        stash,
        error: { message: 'boom', type: 'InternalError' },
      };

      expect(() => response(ctx)).toThrow('boom');
    });
  });
});
