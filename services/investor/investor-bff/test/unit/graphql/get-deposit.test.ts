import { request, response } from '../../../src/graphql/js-function/get-deposit.fn.js';

describe('get-deposit resolver', () => {
  const stash = { tenantId: 'tenant-1', userId: 'user-1' };
  const depositId = '22222222-2222-4222-8222-222222222222';

  describe('request', () => {
    it('issues a GetItem against the caller-scoped Deposit row', () => {
      const op = request({ stash, arguments: { depositId } });
      expect(op.operation).toBe('GetItem');
      expect(op.key).toEqual({
        pk: `InvestorProfile#${stash.tenantId}#${stash.userId}`,
        sk: `Deposit#${depositId}`,
      });
    });

    it('throws ValidationError when depositId is missing', () => {
      expect(() => request({ stash, arguments: {} })).toThrow('depositId required');
    });
  });

  describe('response', () => {
    it('returns the deposit row on success', () => {
      const row = {
        depositId, amountCents: 10000, currency: 'USD',
        status: 'INITIATED', initiatedAt: '2026-04-22T00:00:00.000Z',
      };
      const out = response({ stash, result: row });
      expect(out).toEqual(row);
    });

    it('throws NotFoundError when result is null', () => {
      expect(() => response({ stash, result: null })).toThrow('Deposit not found');
    });

    it('rethrows ctx.error via util.error', () => {
      expect(() => response({
        stash, error: { message: 'boom', type: 'InternalError' },
      })).toThrow('boom');
    });
  });
});
