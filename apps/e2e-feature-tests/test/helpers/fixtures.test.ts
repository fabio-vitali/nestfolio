jest.mock('@nestfolio/test-support', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    putEvent: jest.fn().mockResolvedValue(undefined),
  })),
  AppSyncClient: jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({}),
    mutate: jest.fn().mockResolvedValue({}),
  })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    destroy: jest.fn(),
  })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({
      send: jest.fn().mockResolvedValue({ Item: { pk: 'test', sk: 'CashBalance' } }),
    }),
  },
  GetCommand: jest.fn(),
}));

jest.mock('../../src/helpers/wait-for-graphql', () => ({
  waitForGraphQL: jest.fn().mockResolvedValue({ getProfile: { tenantId: 'tenant-1' } }),
}));

import {
  onboarded,
  applyFixtures,
} from '../../src/helpers/fixtures';
import { EventBridgeClient } from '@nestfolio/test-support';
import { waitForGraphQL } from '../../src/helpers/wait-for-graphql';

describe('fixtures — onboarded', () => {
  it('publishes USER_REGISTERED, waits for profile, then publishes ONBOARDING_COMPLETED', async () => {
    const ctx = {
      tenantId: 'tenant-1',
      region: 'us-east-1',
      ssm: { tableName: jest.fn().mockResolvedValue('test-table') },
    } as any;
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
    // Verify waitForGraphQL was called between the two putEvents (profile materialization)
    expect(waitForGraphQL).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('getProfile'),
      {},
      expect.any(Function),
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
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
    const ctx = { tenantId: 't-2', region: 'us-east-1', ssm: { tableName: jest.fn().mockResolvedValue('test-table') } } as any;
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
  it('publishes one ORDER_FILLED per holding on the ledger bus', async () => {
    const ctx = {} as any;
    const tenant = { tenantId: 't-5', userId: 'u-5', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    await applyFixtures(ctx, tenant, [
      withHoldings([
        { symbol: 'AAPL', quantity: 10, fillPrice: 150 },
        { symbol: 'GOOG', quantity: 3, fillPrice: 1400 },
      ]),
    ]);

    expect(eb.putEvent).toHaveBeenCalledTimes(2);
    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: expect.objectContaining({ symbol: 'AAPL', quantity: 10, fillPrice: 150 }),
    }));
    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: expect.objectContaining({ symbol: 'GOOG', quantity: 3, fillPrice: 1400 }),
    }));
  });
});
