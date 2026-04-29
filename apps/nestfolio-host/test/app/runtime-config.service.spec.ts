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

import { TestBed } from '@angular/core/testing';
import { RuntimeConfigService } from '../../src/app/runtime-config.service';
import { fetchRuntimeConfig, RuntimeConfig } from '../../src/app/app.config';

function makeConfig(): RuntimeConfig {
  return {
    auth: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
    copilotApiUrl: 'https://example.cloudfront.net/api/copilotkit',
    appsyncGraphqlUrls: {
      investor: 'https://investor.appsync-api.us-east-1.amazonaws.com/graphql',
      advisory: 'https://advisory.appsync-api.us-east-1.amazonaws.com/graphql',
      ledger: 'https://ledger.appsync-api.us-east-1.amazonaws.com/graphql',
      dashboard: 'https://dashboard.appsync-api.us-east-1.amazonaws.com/graphql',
    },
  };
}

describe('RuntimeConfigService (fail-hard runtime config)', () => {
  const originalFetch = globalThis.fetch;
  let service: RuntimeConfigService;

  beforeAll(async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => makeConfig(),
    } as unknown as Response);
    await fetchRuntimeConfig();
  });

  afterAll(() => { globalThis.fetch = originalFetch; });

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RuntimeConfigService);
  });

  it('reads the loaded runtime config (no environment fallback)', () => {
    const config = service.config;
    expect(config.auth).toEqual({ userPoolId: 'pool', clientId: 'client', region: 'us-east-1' });
    expect(config.copilotApiUrl).toBe('https://example.cloudfront.net/api/copilotkit');
  });

  it('exposes auth shortcut', () => {
    expect(service.auth).toEqual(service.config.auth);
  });

  it('exposes copilotApiUrl shortcut', () => {
    expect(service.copilotApiUrl).toBe('https://example.cloudfront.net/api/copilotkit');
  });

  it('exposes appsyncGraphqlUrl(domain) for each Facade-bearing BFF', () => {
    expect(service.appsyncGraphqlUrl('investor')).toBe(
      'https://investor.appsync-api.us-east-1.amazonaws.com/graphql',
    );
    expect(service.appsyncGraphqlUrl('advisory')).toBe(
      'https://advisory.appsync-api.us-east-1.amazonaws.com/graphql',
    );
    expect(service.appsyncGraphqlUrl('ledger')).toBe(
      'https://ledger.appsync-api.us-east-1.amazonaws.com/graphql',
    );
    expect(service.appsyncGraphqlUrl('dashboard')).toBe(
      'https://dashboard.appsync-api.us-east-1.amazonaws.com/graphql',
    );
  });
});
