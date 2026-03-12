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

import { TestBed } from '@angular/core/testing';
import { RuntimeConfigService } from '../../src/app/runtime-config.service';

describe('RuntimeConfigService', () => {
  let service: RuntimeConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RuntimeConfigService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should provide default config with auth section', () => {
    const config = service.config;
    expect(config.auth).toBeDefined();
    expect(config.auth.region).toBe('us-east-1');
    expect(config.auth.userPoolId).toBeTruthy();
    expect(config.auth.clientId).toBeTruthy();
  });

  it('should provide default config with all appsync endpoints', () => {
    const config = service.config;
    expect(config.appsync.investorBff).toBeDefined();
    expect(config.appsync.investorBff.endpoint).toBeTruthy();
    expect(config.appsync.advisoryBff).toBeDefined();
    expect(config.appsync.advisoryBff.endpoint).toBeTruthy();
    expect(config.appsync.dashboardBff).toBeDefined();
    expect(config.appsync.dashboardBff.endpoint).toBeTruthy();
    expect(config.appsync.ledgerBff).toBeDefined();
    expect(config.appsync.ledgerBff.endpoint).toBeTruthy();
  });

  it('should expose auth shortcut', () => {
    expect(service.auth).toBe(service.config.auth);
  });

  it('should expose appsync shortcut', () => {
    expect(service.appsync).toBe(service.config.appsync);
  });

  it('should have all required config fields', () => {
    const config = service.config;
    expect(config).toHaveProperty('auth');
    expect(config).toHaveProperty('appsync');
    expect(config.auth).toHaveProperty('userPoolId');
    expect(config.auth).toHaveProperty('clientId');
    expect(config.auth).toHaveProperty('region');
    expect(config.appsync).toHaveProperty('investorBff');
    expect(config.appsync).toHaveProperty('advisoryBff');
    expect(config.appsync).toHaveProperty('dashboardBff');
    expect(config.appsync).toHaveProperty('ledgerBff');
  });
});
