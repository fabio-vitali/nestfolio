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

import { validateEndpoints, RuntimeConfig, loadRuntimeConfig, getRuntimeConfig } from '../../src/app/app.config';

function makeConfig(overrides?: Partial<Record<'investorBff' | 'advisoryBff' | 'dashboardBff' | 'ledgerBff', { endpoint: string; region: string }>>): RuntimeConfig {
  return {
    auth: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
    appsync: {
      investorBff: { endpoint: 'https://investor.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      advisoryBff: { endpoint: 'https://advisory.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      dashboardBff: { endpoint: 'https://dashboard.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      ledgerBff: { endpoint: 'https://ledger.appsync-api.us-east-1.amazonaws.com/graphql', region: 'us-east-1' },
      ...overrides,
    },
    copilotApiUrl: 'https://example.cloudfront.net/api/copilotkit',
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
      ledgerBff: { endpoint: 'http://localhost:4200/graphql', region: 'us-east-1' },
    });
    expect(() => validateEndpoints(config)).toThrow('Invalid endpoint URL');
  });

  it('should allow http://localhost in dev mode', () => {
    devMode = true;
    const config = makeConfig({
      ledgerBff: { endpoint: 'http://localhost:4200/graphql', region: 'us-east-1' },
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

describe('loadRuntimeConfig (fail-hard)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    devMode = false;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('populates runtimeConfig on a successful fetch', async () => {
    const cfg = makeConfig();
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => cfg,
    } as unknown as Response);

    await loadRuntimeConfig()();
    expect(getRuntimeConfig()).toEqual(cfg);
  });

  it('throws with named remediation when fetch returns 404', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as unknown as Response);

    await expect(loadRuntimeConfig()()).rejects.toThrow(
      /Runtime config not found.*nestfolio-host:config/,
    );
  });

  it('throws with named remediation when JSON is malformed', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('unexpected token'); },
    } as unknown as Response);

    await expect(loadRuntimeConfig()()).rejects.toThrow(
      /Runtime config malformed/,
    );
  });

  it('throws when validateEndpoints rejects', async () => {
    const bad = makeConfig({ investorBff: { endpoint: 'http://evil.com/graphql', region: 'us-east-1' } });
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => bad,
    } as unknown as Response);

    await expect(loadRuntimeConfig()()).rejects.toThrow('Invalid endpoint URL');
  });

  it('throws on network error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('NetworkError'));

    await expect(loadRuntimeConfig()()).rejects.toThrow(
      /Runtime config not reachable/,
    );
  });
});
