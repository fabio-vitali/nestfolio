jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn().mockResolvedValue({ tokens: { idToken: { toString: () => 'jwt' } } }),
}));
jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: jest.fn().mockReturnValue({ request: jest.fn() }),
  AUTH_TYPE: { AMAZON_COGNITO_USER_POOLS: 'AMAZON_COGNITO_USER_POOLS' },
}));
jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: jest.fn().mockReturnValue({ request: jest.fn() }),
}));

import { APP_INITIALIZER } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApolloClient } from '@apollo/client/core';
import { AuthConfig } from '../../src/auth';
import { FEATURE_FLAG_APOLLO_CLIENT } from '../../src/feature-flags/feature-flag-apollo-client';
import { FeatureFlagService } from '../../src/feature-flags/feature-flag.service';
import { provideFeatureFlags } from '../../src/feature-flags/provide-feature-flags';

describe('provideFeatureFlags()', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthConfig,
          useValue: { userPoolId: 'pool', clientId: 'client', region: 'us-east-1' },
        },
        provideFeatureFlags(),
      ],
    });
  });

  it('provides FEATURE_FLAG_APOLLO_CLIENT as an ApolloClient instance', () => {
    const client = TestBed.inject(FEATURE_FLAG_APOLLO_CLIENT);
    expect(client).toBeInstanceOf(ApolloClient);
  });

  it('provides FeatureFlagService at the root', () => {
    // No throw = injector resolved without MFE_DOMAIN / GraphqlService.
    expect(() => TestBed.inject(FeatureFlagService)).not.toThrow();
  });

  it('registers an APP_INITIALIZER that warms FeatureFlagService', () => {
    const initializers = TestBed.inject(APP_INITIALIZER);
    const fns = (Array.isArray(initializers) ? initializers : [initializers]) as Array<() => unknown>;
    expect(fns.length).toBeGreaterThan(0);
    return Promise.all(fns.map((fn) => fn()));
  });
});
