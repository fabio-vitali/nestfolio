jest.mock('@nestfolio/test-support', () => ({
  CognitoFixture: jest.fn().mockImplementation(() => ({
    setup: jest.fn().mockResolvedValue({
      idToken: 'header.' + Buffer.from(JSON.stringify({ sub: 'cog-sub-xyz' })).toString('base64url') + '.sig',
      accessToken: 'access',
    }),
  })),
}));

import { freshTenant } from '../../src/helpers/fresh-tenant';
import { CognitoFixture } from '@nestfolio/test-support';

describe('freshTenant', () => {
  it('creates a tenant, a cognito user, extracts sub as userId, returns tokens', async () => {
    const ctx = { tenantId: 'integ-tenant-aaa', userId: 'integ-user-aaa', region: 'us-east-1' } as any;

    const tenant = await freshTenant(ctx);

    expect(CognitoFixture).toHaveBeenCalledWith(ctx);
    expect(tenant.tenantId).toBe('e2e-tenant-aaa');
    expect(tenant.userId).toBe('cog-sub-xyz');
    expect(tenant.idToken).toContain('header.');
    expect(tenant.accessToken).toBe('access');
  });
});
