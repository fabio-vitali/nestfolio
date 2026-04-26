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

let devMode = false;
const originalCore = jest.requireActual('@angular/core');
jest.mock('@angular/core', () => ({
  ...originalCore,
  isDevMode: () => devMode,
}));

import { validateEndpoints, RuntimeConfig, loadRuntimeConfig, getRuntimeConfig } from '../../src/app/app.config';

function makeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  return {
    auth: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
    copilotApiUrl: 'https://example.cloudfront.net/api/copilotkit',
    ...overrides,
  };
}

describe('validateEndpoints', () => {
  beforeEach(() => { devMode = false; });

  it('accepts a valid HTTPS copilotApiUrl', () => {
    expect(() => validateEndpoints(makeConfig())).not.toThrow();
  });

  it('accepts an empty copilotApiUrl', () => {
    expect(() => validateEndpoints(makeConfig({ copilotApiUrl: '' }))).not.toThrow();
  });

  it('rejects an http:// copilotApiUrl in production', () => {
    expect(() =>
      validateEndpoints(makeConfig({ copilotApiUrl: 'http://evil.com/api/copilotkit' })),
    ).toThrow('Invalid endpoint URL');
  });

  it('rejects http://localhost in production', () => {
    expect(() =>
      validateEndpoints(makeConfig({ copilotApiUrl: 'http://localhost:4200/api/copilotkit' })),
    ).toThrow('Invalid endpoint URL');
  });

  it('allows http://localhost in dev mode', () => {
    devMode = true;
    expect(() =>
      validateEndpoints(makeConfig({ copilotApiUrl: 'http://localhost:4200/api/copilotkit' })),
    ).not.toThrow();
  });

  it('still rejects non-localhost http in dev mode', () => {
    devMode = true;
    expect(() =>
      validateEndpoints(makeConfig({ copilotApiUrl: 'http://evil.com/api/copilotkit' })),
    ).toThrow('Invalid endpoint URL');
  });
});

describe('loadRuntimeConfig (fail-hard)', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => { devMode = false; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('populates runtimeConfig on a successful fetch', async () => {
    const cfg = makeConfig();
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => cfg,
    } as unknown as Response);
    await loadRuntimeConfig()();
    expect(getRuntimeConfig()).toEqual(cfg);
  });

  it('throws with named remediation on HTTP 404', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({}),
    } as unknown as Response);
    await expect(loadRuntimeConfig()()).rejects.toThrow(
      /Runtime config not found.*nestfolio-host:config/,
    );
  });

  it('throws on malformed JSON', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); },
    } as unknown as Response);
    await expect(loadRuntimeConfig()()).rejects.toThrow(/Runtime config malformed/);
  });

  it('throws when validateEndpoints rejects', async () => {
    const bad = makeConfig({ copilotApiUrl: 'http://evil.com/api/copilotkit' });
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => bad,
    } as unknown as Response);
    await expect(loadRuntimeConfig()()).rejects.toThrow('Invalid endpoint URL');
  });

  it('throws on network error', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('NetworkError'));
    await expect(loadRuntimeConfig()()).rejects.toThrow(/Runtime config not reachable/);
  });
});
