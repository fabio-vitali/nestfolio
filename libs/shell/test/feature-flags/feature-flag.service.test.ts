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
import { AuthStore } from '../../src/stores/auth.store';
import { LogoutOrchestrator } from '../../src/logout-orchestrator';
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

const SAMPLE_USER = {
  userId: 'u1',
  username: 'alice',
  email: 'alice@example.com',
  tenantId: 't1',
  onboardingCompletedAt: '2026-01-01T00:00:00Z',
};

/**
 * Drives the synchronous part of the constructor effect plus the microtask
 * queue used by the Apollo client.query promise chain.
 */
async function flushAll(): Promise<void> {
  TestBed.tick();
  await Promise.resolve();
  await Promise.resolve();
}

describe('FeatureFlagService (shell-root, dedicated client)', () => {
  it('queries getFeatureFlags via the injected ApolloClient and pushes to the store after authentication', async () => {
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
    TestBed.inject(AuthStore).setAuthenticated(SAMPLE_USER);
    await flushAll();

    expect(client.query).toHaveBeenCalledTimes(1);
    const queryArg = (client.query as jest.Mock).mock.calls[0][0] as { query: { kind: string } };
    expect(queryArg.query.kind).toBe('Document');
    expect(setFlags).toHaveBeenCalledWith([{ name: 'foo', enabled: true, reason: 'default' }]);
  });

  it('subscribes to onFeatureFlagUpdate and pushes incremental updates to the store after authentication', async () => {
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
    TestBed.inject(AuthStore).setAuthenticated(SAMPLE_USER);
    await flushAll();

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

  it('is INERT when AuthStore.status is "unknown"', async () => {
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
    // Default AuthStore.status is 'unknown' (initial state). No transition yet.
    await flushAll();

    expect(client.query).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(setFlags).not.toHaveBeenCalled();
  });

  it('is INERT when AuthStore.status is "unauthenticated"', async () => {
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
    TestBed.inject(AuthStore).setUnauthenticated();
    await flushAll();

    expect(client.query).not.toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(setFlags).not.toHaveBeenCalled();
  });

  it('fires query + subscription exactly once on the "authenticated" transition', async () => {
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
    const authStore = TestBed.inject(AuthStore);

    // Status starts at 'unknown'; transition through 'unauthenticated' → 'authenticated'.
    authStore.setUnauthenticated();
    await flushAll();
    authStore.setAuthenticated(SAMPLE_USER);
    await flushAll();

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.subscribe).toHaveBeenCalledTimes(1);
  });

  it('does NOT re-fire when user data updates within the authenticated state', async () => {
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
    const authStore = TestBed.inject(AuthStore);
    authStore.setAuthenticated(SAMPLE_USER);
    await flushAll();
    expect(client.query).toHaveBeenCalledTimes(1);

    // Mutate the user without changing status.
    authStore.updateUser({ email: 'alice2@example.com' });
    await flushAll();

    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.subscribe).toHaveBeenCalledTimes(1);
  });

  it('clears FeatureFlagsStore and tears down the subscription on logout', async () => {
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
    TestBed.inject(AuthStore).setAuthenticated(SAMPLE_USER);
    await flushAll();

    setFlags.mockClear();
    TestBed.inject(LogoutOrchestrator).resetAll();

    expect(setFlags).toHaveBeenCalledWith([]);

    // Subscription is torn down — emissions after logout must NOT reach the store.
    updateFlag.mockClear();
    emitter.next({ data: { onFeatureFlagUpdate: { name: 'after-logout', enabled: true, reason: 'r' } } });
    expect(updateFlag).not.toHaveBeenCalled();
  });

  it('reloads on a re-login transition after logout', async () => {
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
    const authStore = TestBed.inject(AuthStore);

    authStore.setAuthenticated(SAMPLE_USER);
    await flushAll();
    expect(client.query).toHaveBeenCalledTimes(1);

    // Logout flows through AuthStore.logout() → LogoutOrchestrator.resetAll() → status 'unauthenticated'.
    authStore.logout();
    await flushAll();

    // Re-login: same user — irrelevant; the transition is what matters.
    authStore.setAuthenticated(SAMPLE_USER);
    await flushAll();

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.subscribe).toHaveBeenCalledTimes(2);
  });
});
