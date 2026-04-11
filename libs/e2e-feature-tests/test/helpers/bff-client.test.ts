const mockInstances: Array<{ service: string }> = [];
jest.mock('@nestfolio/integration-testing', () => ({
  AppSyncClient: jest.fn().mockImplementation((_ctx: unknown, _tokens: unknown, service: string) => {
    const instance = { service, query: jest.fn(), mutate: jest.fn() };
    mockInstances.push(instance);
    return instance;
  }),
}));

import { bffClient } from '../../src/helpers/bff-client';
import { AppSyncClient } from '@nestfolio/integration-testing';

describe('bffClient', () => {
  beforeEach(() => {
    mockInstances.length = 0;
    (AppSyncClient as unknown as jest.Mock).mockClear();
  });

  it('constructs one AppSyncClient per BFF service', () => {
    const ctx = {} as any;
    const tenant = {
      tenantId: 't',
      userId: 'u',
      idToken: 'id',
      accessToken: 'acc',
      cognitoTokens: { idToken: 'id', accessToken: 'acc' },
    } as any;

    const bff = bffClient(ctx, tenant);

    expect(bff.investor).toBeDefined();
    expect(bff.advisory).toBeDefined();
    expect(bff.ledger).toBeDefined();
    expect(bff.dashboard).toBeDefined();
    expect(AppSyncClient).toHaveBeenCalledTimes(4);
    expect(mockInstances.map((i) => i.service).sort()).toEqual([
      'advisory-bff',
      'dashboard-bff',
      'investor-bff',
      'ledger-bff',
    ]);
  });
});
