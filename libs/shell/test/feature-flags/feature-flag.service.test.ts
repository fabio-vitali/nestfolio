// Mock ESM-shipped AWS AppSync links so their `export` syntax doesn't
// reach jest's CJS pipeline. The service under test never invokes them —
// we provide the ApolloClient via the FEATURE_FLAG_APOLLO_CLIENT token.
jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: jest.fn(),
  AUTH_TYPE: { AMAZON_COGNITO_USER_POOLS: 'AMAZON_COGNITO_USER_POOLS' },
}));
jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: jest.fn(),
}));
jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn().mockResolvedValue({ tokens: { idToken: { toString: () => 'jwt' } } }),
}));

import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';
import { FeatureFlagService } from '../../src/feature-flags/feature-flag.service';
import { FEATURE_FLAG_APOLLO_CLIENT } from '../../src/feature-flags/feature-flag-apollo-client';

interface MockApolloClient {
  query: jest.Mock;
  subscribe: jest.Mock;
  stop: jest.Mock;
}

function makeMockClient(subscriptionEmitter?: Subject<unknown>): MockApolloClient {
  return {
    query: jest.fn().mockResolvedValue({
      data: {
        getFeatureFlags: [
          { name: 'foo', enabled: true, reason: 'default' },
        ],
      },
    }),
    subscribe: jest.fn().mockReturnValue({
      subscribe: (observer: { next: (v: unknown) => void; error: (e: unknown) => void; complete: () => void }) => {
        const sub = (subscriptionEmitter ?? new Subject<unknown>()).subscribe(observer);
        return { unsubscribe: () => sub.unsubscribe() };
      },
    }),
    stop: jest.fn(),
  };
}

describe('FeatureFlagService (shell-root, dedicated client)', () => {
  it('queries getFeatureFlags via the injected ApolloClient and pushes to the store', async () => {
    const client = makeMockClient();
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    // Allow the constructor's loadInitialFlags promise to resolve.
    await Promise.resolve();
    await Promise.resolve();

    expect(client.query).toHaveBeenCalledTimes(1);
    const queryArg = (client.query as jest.Mock).mock.calls[0][0] as { query: { kind: string } };
    expect(queryArg.query.kind).toBe('Document');
    expect(setFlags).toHaveBeenCalledWith([{ name: 'foo', enabled: true, reason: 'default' }]);
  });

  it('subscribes to onFeatureFlagUpdate and pushes incremental updates to the store', async () => {
    const emitter = new Subject<{ data: { onFeatureFlagUpdate: { name: string; enabled: boolean; reason: string } } }>();
    const client = makeMockClient(emitter);
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    TestBed.inject(FeatureFlagService);
    await Promise.resolve();
    await Promise.resolve();

    emitter.next({ data: { onFeatureFlagUpdate: { name: 'bar', enabled: false, reason: 'override' } } });
    expect(updateFlag).toHaveBeenCalledWith({ name: 'bar', enabled: false, reason: 'override' });
  });

  it('does NOT inject GraphqlService or MFE_DOMAIN (architectural invariant)', () => {
    const client = makeMockClient();
    const setFlags = jest.fn();
    const updateFlag = jest.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: FEATURE_FLAG_APOLLO_CLIENT, useValue: client },
        { provide: FeatureFlagsStore, useValue: { setFlags, updateFlag } },
        FeatureFlagService,
      ],
    });

    // No MFE_DOMAIN provider, no GraphqlService provider — must still resolve.
    expect(() => TestBed.inject(FeatureFlagService)).not.toThrow();
  });
});
