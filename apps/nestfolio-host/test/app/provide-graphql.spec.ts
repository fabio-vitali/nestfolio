// Mock modules that cause ESM issues in jest before any imports
jest.mock('@angular-architects/native-federation', () => ({
  loadRemoteModule: jest.fn(),
}));

jest.mock('aws-amplify', () => ({
  Amplify: { configure: jest.fn() },
}));

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn(),
  getCurrentUser: jest.fn(),
  signIn: jest.fn(),
  signUp: jest.fn(),
  confirmSignUp: jest.fn(),
  signOut: jest.fn(),
}));

const mockAppsyncConfig = { endpoint: 'https://investor.appsync.example.com/graphql', region: 'us-east-1' };
const MockGraphqlService = class {};
const mockAPPSYNC_CONFIG = 'APPSYNC_CONFIG_TOKEN';

jest.mock('@nestfolio/appsync-client', () => ({
  APPSYNC_CONFIG: mockAPPSYNC_CONFIG,
  GraphqlService: MockGraphqlService,
}));

const mockGetRuntimeConfig = jest.fn();

jest.mock('../../src/app/app.config', () => ({
  getRuntimeConfig: mockGetRuntimeConfig,
}));

import { provideGraphqlFor } from '../../src/app/provide-graphql';

describe('provideGraphqlFor', () => {
  beforeEach(() => {
    mockGetRuntimeConfig.mockReturnValue({
      auth: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
      appsync: {
        investorBff: { endpoint: 'https://investor.appsync.example.com/graphql', region: 'us-east-1' },
        portfolioBff: { endpoint: 'https://portfolio.appsync.example.com/graphql', region: 'us-east-1' },
        advisoryBff: { endpoint: 'https://advisory.appsync.example.com/graphql', region: 'us-east-1' },
        dashboardBff: { endpoint: 'https://dashboard.appsync.example.com/graphql', region: 'us-east-1' },
        orderLedgerBff: { endpoint: 'https://order-ledger.appsync.example.com/graphql', region: 'us-east-1' },
      },
    });
  });

  it('should return an array of 2 providers', () => {
    const providers = provideGraphqlFor('investorBff');
    expect(providers).toHaveLength(2);
  });

  it('should have APPSYNC_CONFIG as the first provider token', () => {
    const providers = provideGraphqlFor('investorBff');
    const first = providers[0] as { provide: unknown; useFactory: () => unknown };
    expect(first.provide).toBe(mockAPPSYNC_CONFIG);
    expect(typeof first.useFactory).toBe('function');
  });

  it('should have a useFactory that returns the correct endpoint config for investorBff', () => {
    const providers = provideGraphqlFor('investorBff');
    const first = providers[0] as { provide: unknown; useFactory: () => unknown };
    const result = first.useFactory();
    expect(result).toEqual({
      endpoint: 'https://investor.appsync.example.com/graphql',
      region: 'us-east-1',
    });
  });

  it('should have a useFactory that returns the correct endpoint config for portfolioBff', () => {
    const providers = provideGraphqlFor('portfolioBff');
    const first = providers[0] as { provide: unknown; useFactory: () => unknown };
    const result = first.useFactory();
    expect(result).toEqual({
      endpoint: 'https://portfolio.appsync.example.com/graphql',
      region: 'us-east-1',
    });
  });

  it('should have GraphqlService as the second provider token with useClass', () => {
    const providers = provideGraphqlFor('investorBff');
    const second = providers[1] as { provide: unknown; useClass: unknown };
    expect(second.provide).toBe(MockGraphqlService);
    expect(second.useClass).toBe(MockGraphqlService);
  });
});
