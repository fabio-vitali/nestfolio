import { request, response } from '../../../src/graphql/js-function/get-profile.fn.js';

describe('get-profile resolver', () => {
  const stash = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    tableName: 'inv-bff',
  };

  describe('request', () => {
    it('issues a BatchGetItem against two SKs of the composite InvestorProfile row', () => {
      const op = request({ stash });

      expect(op.operation).toBe('BatchGetItem');
      expect(op.tables).toBeDefined();
      expect(op.tables['inv-bff']).toBeDefined();
      const keys = op.tables['inv-bff'].keys;
      expect(keys).toHaveLength(2);
      const pk = `InvestorProfile#${stash.tenantId}#${stash.userId}`;
      expect(keys[0]).toEqual({ pk, sk: 'InvestorProfile' });
      expect(keys[1]).toEqual({ pk, sk: 'MandateStatus' });
    });
  });

  describe('response', () => {
    it('merges MandateStatus.status + revokedAt onto profile.mandate', () => {
      const profile = {
        sk: 'InvestorProfile',
        __typename: 'InvestorProfile',
        tenantId: 'tenant-1',
        userId: 'user-1',
        mandate: { mandateId: 'm-1', level: 'DISCRETIONARY', status: 'ACTIVE', revokedAt: null },
      };
      const mandateStatus = {
        sk: 'MandateStatus',
        __typename: 'MandateStatus',
        status: 'REVOKED',
        revokedAt: '2026-05-03T10:00:00.000Z',
      };
      const ctx = {
        stash,
        result: { data: { 'inv-bff': [profile, mandateStatus] } },
      };

      const out = response(ctx);

      expect(out.mandate.status).toBe('REVOKED');
      expect(out.mandate.revokedAt).toBe('2026-05-03T10:00:00.000Z');
      expect(out.mandate.level).toBe('DISCRETIONARY');
      expect(out.mandate.mandateId).toBe('m-1');
    });

    it('returns profile with mandate untouched when MandateStatus is absent', () => {
      const profile = {
        sk: 'InvestorProfile',
        __typename: 'InvestorProfile',
        mandate: { mandateId: 'm-1', level: 'DISCRETIONARY', status: 'ACTIVE', revokedAt: null },
      };
      const ctx = {
        stash,
        result: { data: { 'inv-bff': [profile, null] } },
      };

      const out = response(ctx);

      expect(out.mandate.status).toBe('ACTIVE');
      expect(out.mandate.revokedAt).toBeNull();
    });

    it('throws "Profile not found" via util.error when InvestorProfile sk is absent', () => {
      const ctx = {
        stash,
        result: { data: { 'inv-bff': [null, null] } },
      };

      expect(() => response(ctx)).toThrow('Profile not found');
    });

    it('rethrows ctx.error via util.error', () => {
      const ctx = {
        stash,
        error: { message: 'boom', type: 'InternalError' },
      };

      expect(() => response(ctx)).toThrow('boom');
    });

    it('handles empty BatchGetItem result (data array missing) by erroring', () => {
      const ctx = {
        stash,
        result: { data: {} },
      };

      expect(() => response(ctx)).toThrow('Profile not found');
    });
  });
});
