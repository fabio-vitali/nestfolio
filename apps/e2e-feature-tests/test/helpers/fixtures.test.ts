jest.mock('@nestfolio/test-support', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    putEvent: jest.fn().mockResolvedValue(undefined),
  })),
}));

import {
  onboarded,
  applyFixtures,
} from '../../src/helpers/fixtures';
import { EventBridgeClient } from '@nestfolio/test-support';

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

import { funded } from '../../src/helpers/fixtures';

describe('fixtures — funded', () => {
  it('publishes BALANCE_UPDATED with the requested cashBalanceCents', async () => {
    const ctx = { tenantId: 't-2' } as any;
    const tenant = { tenantId: 't-2', userId: 'u-2', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    await applyFixtures(ctx, tenant, [funded({ cashBalanceCents: 2_500_000 })]);

    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'BALANCE_UPDATED',
      detail: expect.objectContaining({
        tenantId: 't-2',
        userId: 'u-2',
        cashBalanceCents: 2_500_000,
      }),
    }));
  });
});

import { withDecision, withNotification, withHoldings } from '../../src/helpers/fixtures';

describe('fixtures — withDecision', () => {
  it('publishes DECISION_PACKET_CREATED to the advisory bus and returns decisionId', async () => {
    const ctx = {} as any;
    const tenant = { tenantId: 't-3', userId: 'u-3', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    const result = await applyFixtures(ctx, tenant, [
      withDecision({ trigger: 'INITIAL_ALLOCATION' }),
    ]);

    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'advisory',
      targetService: 'advisory-bff',
      detailType: 'DECISION_PACKET_CREATED',
      detail: expect.objectContaining({
        tenantId: 't-3',
        trigger: 'INITIAL_ALLOCATION',
        confirmationRequired: true,
      }),
    }));
    expect(typeof result.decisionId).toBe('string');
    expect((result.decisionId as string).startsWith('e2e-decision-')).toBe(true);
  });
});

describe('fixtures — withNotification', () => {
  it('publishes NOTIFICATION_CREATED to the investor bus and returns notificationId', async () => {
    const ctx = {} as any;
    const tenant = { tenantId: 't-4', userId: 'u-4', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    const result = await applyFixtures(ctx, tenant, [
      withNotification({ title: 'hello', body: 'world' }),
    ]);

    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'NOTIFICATION_CREATED',
      detail: expect.objectContaining({
        tenantId: 't-4',
        userId: 'u-4',
        title: 'hello',
        body: 'world',
        channel: 'IN_APP',
      }),
    }));
    expect(typeof result.notificationId).toBe('string');
  });
});

describe('fixtures — withHoldings', () => {
  it('publishes one ORDER_FILLED per holding on the execution bus', async () => {
    const ctx = {} as any;
    const tenant = { tenantId: 't-5', userId: 'u-5', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    await applyFixtures(ctx, tenant, [
      withHoldings([
        { symbol: 'AAPL', quantity: 10, fillPriceCents: 15_000 },
        { symbol: 'GOOG', quantity: 3, fillPriceCents: 140_000 },
      ]),
    ]);

    expect(eb.putEvent).toHaveBeenCalledTimes(2);
    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'execution',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: expect.objectContaining({ symbol: 'AAPL', quantity: 10, fillPriceCents: 15_000 }),
    }));
    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'execution',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: expect.objectContaining({ symbol: 'GOOG', quantity: 3, fillPriceCents: 140_000 }),
    }));
  });
});
