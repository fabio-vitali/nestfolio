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

// Mock isDevMode
let devMode = false;
const originalCore = jest.requireActual('@angular/core');
jest.mock('@angular/core', () => ({
  ...originalCore,
  isDevMode: () => devMode,
}));

import { validateEndpoints, RuntimeConfig } from '../../src/app/app.config';

function makeConfig(overrides?: Partial<Record<'investorBff' | 'portfolioBff' | 'advisoryBff' | 'dashboardBff' | 'orderLedgerBff', { endpoint: string; region: string }>>): RuntimeConfig {
  return {
    auth: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
    appsync: {
      investorBff: { endpoint: 'https://investor.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      portfolioBff: { endpoint: 'https://portfolio.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      advisoryBff: { endpoint: 'https://advisory.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      dashboardBff: { endpoint: 'https://dashboard.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      orderLedgerBff: { endpoint: 'https://order-ledger.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      ...overrides,
    },
  };
}

describe('validateEndpoints', () => {
  beforeEach(() => {
    devMode = false;
  });

  it('should accept valid HTTPS endpoints', () => {
    expect(() => validateEndpoints(makeConfig())).not.toThrow();
  });

  it('should accept empty endpoint strings', () => {
    const config = makeConfig({
      investorBff: { endpoint: '', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).not.toThrow();
  });

  it('should reject HTTP endpoints in production', () => {
    const config = makeConfig({
      investorBff: { endpoint: 'http://evil.com/graphql', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).toThrow('Invalid endpoint URL');
  });

  it('should reject http://localhost in production', () => {
    const config = makeConfig({
      portfolioBff: { endpoint: 'http://localhost:4200/graphql', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).toThrow('Invalid endpoint URL');
  });

  it('should allow http://localhost in dev mode', () => {
    devMode = true;
    const config = makeConfig({
      portfolioBff: { endpoint: 'http://localhost:4200/graphql', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).not.toThrow();
  });

  it('should still reject non-localhost HTTP in dev mode', () => {
    devMode = true;
    const config = makeConfig({
      advisoryBff: { endpoint: 'http://evil.com/graphql', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).toThrow('Invalid endpoint URL');
  });
});
