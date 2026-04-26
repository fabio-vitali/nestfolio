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
import { loadRuntimeConfig, RuntimeConfig } from '../../src/app/app.config';

function makeConfig(): RuntimeConfig {
  return {
    auth: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
    copilotApiUrl: 'https://example.cloudfront.net/api/copilotkit',
  };
}

describe('RuntimeConfigService (fail-hard runtime config)', () => {
  const originalFetch = globalThis.fetch;
  let service: RuntimeConfigService;

  beforeAll(async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => makeConfig(),
    } as unknown as Response);
    await loadRuntimeConfig()();
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
});
