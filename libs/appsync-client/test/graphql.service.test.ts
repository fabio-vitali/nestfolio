const mockRegister = jest.fn();
const mockUnregister = jest.fn();
const mockStop = jest.fn();
const mockApolloQuery = jest.fn();
const mockApolloMutate = jest.fn();
const mockApolloSubscribe = jest.fn();

const mockConfig = { endpoint: 'https://example.appsync.com/graphql', region: 'us-east-1' };
const mockLogoutOrchestrator = { register: mockRegister, unregister: mockUnregister };

jest.mock('@angular/core', () => ({
  Injectable: () => (target: any) => target,
  inject: (token: any) => {
    // APPSYNC_CONFIG token is identified by description
    if (token && token.toString && token.toString().includes('APPSYNC_CONFIG')) {
      return mockConfig;
    }
    return mockLogoutOrchestrator;
  },
  InjectionToken: class InjectionToken {
    constructor(private desc: string) {}
    toString() { return `InjectionToken ${this.desc}`; }
  },
}));

const mockApolloClientInstance = {
  query: mockApolloQuery,
  mutate: mockApolloMutate,
  subscribe: mockApolloSubscribe,
  stop: mockStop,
};

// Track constructor calls to return fresh instances for resetClient tests
let apolloInstanceCount = 0;
const apolloInstances: typeof mockApolloClientInstance[] = [];

jest.mock('@apollo/client/core', () => {
  const actualGql = (strings: TemplateStringsArray | string) => {
    // Simple passthrough for gql tagged template
    if (typeof strings === 'string') return strings;
    return strings.raw ? strings.raw.join('') : String(strings);
  };

  return {
    ApolloClient: jest.fn().mockImplementation(() => {
      const instance = {
        query: mockApolloQuery,
        mutate: mockApolloMutate,
        subscribe: mockApolloSubscribe,
        stop: mockStop,
      };
      apolloInstances.push(instance);
      apolloInstanceCount++;
      return instance;
    }),
    InMemoryCache: jest.fn().mockImplementation(() => ({})),
    HttpLink: jest.fn().mockImplementation(() => ({})),
    gql: actualGql,
    ApolloLink: {
      from: jest.fn().mockReturnValue({}),
    },
    NormalizedCacheObject: {},
  };
});

jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: jest.fn().mockReturnValue({}),
  AUTH_TYPE: {
    AMAZON_COGNITO_USER_POOLS: 'AMAZON_COGNITO_USER_POOLS',
  },
}));

jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: jest.fn().mockReturnValue({}),
}));

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'mock-jwt-token' } },
  }),
}));

jest.mock('@nestfolio/shared-state', () => ({
  LogoutOrchestrator: class {},
}));

import { GraphqlService } from '../src/graphql.service';
import { ApolloClient } from '@apollo/client/core';

describe('GraphqlService', () => {
  let service: GraphqlService;

  beforeEach(() => {
    jest.clearAllMocks();
    apolloInstanceCount = 0;
    apolloInstances.length = 0;
    service = new GraphqlService();
  });

  describe('constructor', () => {
    it('creates an ApolloClient on construction', () => {
      expect(ApolloClient).toHaveBeenCalledTimes(1);
    });

    it('registers resetFn with LogoutOrchestrator on construction', () => {
      expect(mockRegister).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('query', () => {
    it('calls ApolloClient.query with gql-wrapped statement and returns data', async () => {
      const data = { getProfile: { name: 'Test' } };
      mockApolloQuery.mockResolvedValue({ data });

      const result = await service.query('query Q { getProfile { name } }', { id: '1' });

      expect(mockApolloQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { id: '1' },
          fetchPolicy: 'no-cache',
        }),
      );
      expect(result).toEqual(data);
    });

    it('uses empty variables by default', async () => {
      mockApolloQuery.mockResolvedValue({ data: { result: true } });

      await service.query('query Q { result }');

      expect(mockApolloQuery).toHaveBeenCalledWith(
        expect.objectContaining({ variables: {} }),
      );
    });

    it('returns data directly from ApolloClient result', async () => {
      const data = { getPortfolio: { id: 'p1', value: 1000 } };
      mockApolloQuery.mockResolvedValue({ data });

      const result = await service.query<typeof data>('query Q { getPortfolio { id value } }');
      expect(result).toEqual(data);
    });
  });

  describe('mutate', () => {
    it('calls ApolloClient.mutate with gql-wrapped statement and returns data', async () => {
      const data = { setGoal: { id: 'g1' } };
      mockApolloMutate.mockResolvedValue({ data });

      const result = await service.mutate('mutation M { setGoal { id } }', { input: {} });

      expect(mockApolloMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          variables: { input: {} },
        }),
      );
      expect(result).toEqual(data);
    });

    it('uses empty variables by default', async () => {
      mockApolloMutate.mockResolvedValue({ data: { ok: true } });

      await service.mutate('mutation M { doSomething }');

      expect(mockApolloMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: {} }),
      );
    });
  });

  describe('subscribe', () => {
    it('returns an Observable that wraps ApolloClient.subscribe', () => {
      const mockUnsub = jest.fn();
      let capturedNext: any;

      mockApolloSubscribe.mockReturnValue({
        subscribe: (handlers: any) => {
          capturedNext = handlers.next;
          return { unsubscribe: mockUnsub };
        },
      });

      const values: any[] = [];

      const sub = service.subscribe('subscription S { onUpdate { id } }').subscribe({
        next: (v) => values.push(v),
      });

      capturedNext({ data: { onUpdate: { id: '1' } } });
      expect(values).toEqual([{ onUpdate: { id: '1' } }]);

      // data=null should not emit
      capturedNext({ data: null });
      expect(values).toHaveLength(1);

      sub.unsubscribe();
      expect(mockUnsub).toHaveBeenCalled();
    });

    it('forwards errors from ApolloClient.subscribe', () => {
      const mockUnsub = jest.fn();
      let capturedError: any;

      mockApolloSubscribe.mockReturnValue({
        subscribe: (handlers: any) => {
          capturedError = handlers.error;
          return { unsubscribe: mockUnsub };
        },
      });

      const errors: any[] = [];
      service.subscribe('subscription S { onUpdate }').subscribe({
        next: () => {},
        error: (e) => errors.push(e),
      });

      const err = new Error('subscription error');
      capturedError(err);
      expect(errors).toEqual([err]);
    });

    it('passes variables to ApolloClient.subscribe', () => {
      mockApolloSubscribe.mockReturnValue({
        subscribe: () => ({ unsubscribe: jest.fn() }),
      });

      service.subscribe('subscription S { onUpdate }', { filter: 'test' }).subscribe({
        next: () => {},
      });

      expect(mockApolloSubscribe).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { filter: 'test' } }),
      );
    });
  });

  describe('ngOnDestroy', () => {
    it('stops the client and unregisters from LogoutOrchestrator', () => {
      service.ngOnDestroy();

      expect(mockStop).toHaveBeenCalled();
      expect(mockUnregister).toHaveBeenCalledWith(expect.any(Function));
    });

    it('unregisters the same function that was registered', () => {
      const registeredFn = mockRegister.mock.calls[0][0];
      service.ngOnDestroy();
      const unregisteredFn = mockUnregister.mock.calls[0][0];
      expect(registeredFn).toBe(unregisteredFn);
    });
  });

  describe('resetClient', () => {
    it('stops the old client and creates a new ApolloClient', () => {
      expect(ApolloClient).toHaveBeenCalledTimes(1);
      expect(mockStop).not.toHaveBeenCalled();

      service.resetClient();

      expect(mockStop).toHaveBeenCalledTimes(1);
      expect(ApolloClient).toHaveBeenCalledTimes(2);
    });

    it('registered logout callback triggers resetClient', () => {
      const resetCallback = mockRegister.mock.calls[0][0];

      expect(ApolloClient).toHaveBeenCalledTimes(1);
      resetCallback();
      expect(ApolloClient).toHaveBeenCalledTimes(2);
      expect(mockStop).toHaveBeenCalledTimes(1);
    });
  });
});
