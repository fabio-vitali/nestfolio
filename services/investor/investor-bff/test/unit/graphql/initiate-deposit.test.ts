import { request, response } from '../../../src/graphql/js-function/initiate-deposit.fn.js';

describe('initiate-deposit resolver', () => {
  const stash = { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' };
  const validId = '11111111-1111-4111-8111-111111111111';

  describe('request', () => {
    it('persists a DepositIntent outbox row using the client-supplied depositId', () => {
      const op = request({
        stash,
        arguments: { input: { depositId: validId, amountCents: 10000, currency: 'USD' } },
      });

      expect(op.operation).toBe('PutItem');
      // Intent outbox row (sk=DepositIntent#) — CDC emits DEPOSIT_INITIATED from
      // it; the projected Deposit row is materialized later from broker-ctrl's
      // lifecycle events (single-writer).
      expect(op.key).toEqual({
        pk: `InvestorProfile#${stash.tenantId}#${stash.userId}`,
        sk: `DepositIntent#${validId}`,
      });
      expect(op.attributeValues.__typename).toBe('DepositIntent');
      expect(op.attributeValues.depositId).toBe(validId);
      expect(op.attributeValues.amountCents).toBe(10000);
      expect(op.attributeValues.status).toBe('INITIATED');
      expect(op.attributeValues.region).toBe('us-east-1');
    });

    it('throws ValidationError when depositId is missing', () => {
      expect(() => request({
        stash,
        arguments: { input: { amountCents: 10000, currency: 'USD' } },
      })).toThrow('depositId required');
    });

    it('throws ValidationError when depositId is not UUIDv4', () => {
      expect(() => request({
        stash,
        arguments: { input: { depositId: 'not-a-uuid', amountCents: 10000, currency: 'USD' } },
      })).toThrow('depositId must be UUID v4');
    });

    it('throws ValidationError when amountCents is missing or non-positive', () => {
      expect(() => request({
        stash,
        arguments: { input: { depositId: validId, currency: 'USD' } },
      })).toThrow('amountCents must be > 0');
      expect(() => request({
        stash,
        arguments: { input: { depositId: validId, amountCents: 0, currency: 'USD' } },
      })).toThrow('amountCents must be > 0');
    });

    it('throws ValidationError when currency is not 3 chars', () => {
      expect(() => request({
        stash,
        arguments: { input: { depositId: validId, amountCents: 100, currency: 'US' } },
      })).toThrow('currency must be 3 chars');
    });
  });

  describe('response', () => {
    it('returns the staged result on success', () => {
      const stashWithResult = {
        ...stash,
        _depositResult: {
          depositId: validId,
          amountCents: 10000,
          currency: 'USD',
          status: 'INITIATED',
          initiatedAt: '2026-04-22T00:00:00.000Z',
        },
      };
      const out = response({ stash: stashWithResult });
      expect(out.depositId).toBe(validId);
      expect(out.status).toBe('INITIATED');
    });

    it('rethrows ctx.error via util.error', () => {
      expect(() => response({
        stash, error: { message: 'boom', type: 'InternalError' },
      })).toThrow('boom');
    });
  });
});
