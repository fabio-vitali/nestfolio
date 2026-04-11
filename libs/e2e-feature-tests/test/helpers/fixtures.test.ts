jest.mock('@nestfolio/integration-testing', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    putEvent: jest.fn().mockResolvedValue(undefined),
  })),
}));

import {
  onboarded,
  applyFixtures,
} from '../../src/helpers/fixtures';
import { EventBridgeClient } from '@nestfolio/integration-testing';

describe('fixtures — onboarded', () => {
  it('publishes USER_REGISTERED then ONBOARDING_COMPLETED to the investor bus', async () => {
    const ctx = { tenantId: 'tenant-1', region: 'us-east-1' } as any;
    const tenant = { tenantId: 'tenant-1', userId: 'user-1', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    await applyFixtures(ctx, tenant, [onboarded()]);

    expect(eb.putEvent).toHaveBeenCalledTimes(2);
    expect(eb.putEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'USER_REGISTERED',
      detail: expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
    }));
    expect(eb.putEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'ONBOARDING_COMPLETED',
      detail: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        operatingMode: 'BALANCED',
        mandateAccepted: true,
      }),
    }));
  });
});
