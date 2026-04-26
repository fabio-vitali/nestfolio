/** @jest-environment node */
const mockRegister = jest.fn();
const mockUnregister = jest.fn();
const mockApolloQuery = jest.fn();
const mockApolloMutate = jest.fn();
const mockApolloSubscribe = jest.fn();
const mockClientStop = jest.fn();
const mockNavigate = jest.fn().mockResolvedValue(true);
const mockAuthStoreLogout = jest.fn();
const mockAuthSignOut = jest.fn().mockResolvedValue(undefined);

const mockAuthConfig = { region: 'us-east-1', userPoolId: 'pool', clientId: 'client' };
const mockLogoutOrchestrator = { register: mockRegister, unregister: mockUnregister };
const mockRouter = { navigate: mockNavigate };
const mockAuthStore = { logout: mockAuthStoreLogout };

jest.mock('@angular/core', () => ({
  Injectable: () => (target: unknown) => target,
  InjectionToken: class {
    constructor(private desc: string) {}
    toString() { return `InjectionToken ${this.desc}`; }
  },
  inject: (token: { toString?: () => string } | unknown) => {
    const desc = (token as { toString?: () => string })?.toString?.() ?? '';
    if (desc.includes('MFE_DOMAIN')) return 'investor';
    if (desc.includes('AuthConfig') || (token as { name?: string })?.name === 'AuthConfig') return mockAuthConfig;
    if (desc.includes('LogoutOrchestrator') || (token as { name?: string })?.name === 'LogoutOrchestrator') return mockLogoutOrchestrator;
    if (desc.includes('Router') || (token as { name?: string })?.name === 'Router') return mockRouter;
    if (desc.includes('AuthStore') || (token as { name?: string })?.name === 'AuthStore') return mockAuthStore;
    return undefined;
  },
}));

jest.mock('@angular/router', () => ({
  Router: class Router {},
}));

// Capture the onAuthFailure passed to the factory.
let capturedOnAuthFailure: ((reason: string) => void) | undefined;
const mockApolloInstances: { stop: jest.Mock }[] = [];
const mockCreateApolloClient = jest.fn().mockImplementation((opts: { onAuthFailure: (r: string) => void }) => {
  capturedOnAuthFailure = opts.onAuthFailure;
  const instance = {
    query: mockApolloQuery,
    mutate: mockApolloMutate,
    subscribe: mockApolloSubscribe,
    stop: mockClientStop,
  };
  mockApolloInstances.push(instance);
  return instance;
});

jest.mock('../../src/graphql/create-apollo-client', () => ({
  createApolloClient: mockCreateApolloClient,
}));

jest.mock('@apollo/client/core', () => ({
  gql: (s: TemplateStringsArray | string) =>
    typeof s === 'string' ? s : (s.raw ? s.raw.join('') : String(s)),
}));

jest.mock('aws-amplify/auth', () => ({
  fetchAuthSession: jest.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'mock-jwt-token' } },
  }),
}));

jest.mock('../../src/auth', () => ({
  AuthConfig: class AuthConfig {},
  authSignOut: mockAuthSignOut,
}));

jest.mock('../../src/stores/auth.store', () => ({
  AuthStore: class AuthStore {},
}));

import { GraphqlService } from '../../src/graphql/graphql.service';

describe('GraphqlService', () => {
  let service: GraphqlService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockApolloInstances.length = 0;
    capturedOnAuthFailure = undefined;
    service = new GraphqlService();
  });

  describe('constructor', () => {
    it('builds an ApolloClient via createApolloClient with the resolved DI values', () => {
      expect(mockCreateApolloClient).toHaveBeenCalledTimes(1);
      const opts = mockCreateApolloClient.mock.calls[0][0];
      expect(opts.domain).toBe('investor');
      expect(opts.region).toBe('us-east-1');
      expect(typeof opts.jwtTokenProvider).toBe('function');
      expect(typeof opts.onAuthFailure).toBe('function');
    });

    it('registers a reset function with LogoutOrchestrator', () => {
      expect(mockRegister).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('jwtTokenProvider', () => {
    it('resolves to the Cognito id-token string', async () => {
      const opts = mockCreateApolloClient.mock.calls[0][0];
      const token = await opts.jwtTokenProvider();
      expect(token).toBe('mock-jwt-token');
    });
  });

  describe('query', () => {
    it('forwards to ApolloClient.query and returns data', async () => {
      mockApolloQuery.mockResolvedValue({ data: { ok: 1 } });
      const result = await service.query('query Q { ok }', { id: '1' });
      expect(mockApolloQuery).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { id: '1' } }),
      );
      expect(result).toEqual({ ok: 1 });
    });

    it('uses empty variables by default', async () => {
      mockApolloQuery.mockResolvedValue({ data: { ok: 1 } });
      await service.query('query Q { ok }');
      expect(mockApolloQuery).toHaveBeenCalledWith(
        expect.objectContaining({ variables: {} }),
      );
    });
  });

  describe('mutate', () => {
    it('forwards to ApolloClient.mutate and returns data', async () => {
      mockApolloMutate.mockResolvedValue({ data: { saved: true } });
      const result = await service.mutate('mutation M { saved }', { input: {} });
      expect(mockApolloMutate).toHaveBeenCalledWith(
        expect.objectContaining({ variables: { input: {} } }),
      );
      expect(result).toEqual({ saved: true });
    });
  });

  describe('subscribe', () => {
    it('returns an Observable that wraps ApolloClient.subscribe', () => {
      const mockUnsub = jest.fn();
      let capturedNext!: (r: { data: Record<string, unknown> | null }) => void;
      mockApolloSubscribe.mockReturnValue({
        subscribe: (h: { next: typeof capturedNext }) => {
          capturedNext = h.next;
          return { unsubscribe: mockUnsub };
        },
      });
      const values: unknown[] = [];
      const sub = service.subscribe('subscription S { onUpdate { id } }').subscribe({
        next: (v) => values.push(v),
      });
      capturedNext({ data: { onUpdate: { id: '1' } } });
      expect(values).toEqual([{ onUpdate: { id: '1' } }]);
      capturedNext({ data: null });
      expect(values).toHaveLength(1);
      sub.unsubscribe();
      expect(mockUnsub).toHaveBeenCalled();
    });

    it('forwards errors from the inner subscription', () => {
      let capturedError!: (e: Error) => void;
      mockApolloSubscribe.mockReturnValue({
        subscribe: (h: { error: typeof capturedError }) => {
          capturedError = h.error;
          return { unsubscribe: jest.fn() };
        },
      });
      const errors: unknown[] = [];
      service.subscribe('subscription S { onUpdate }').subscribe({
        next: () => {},
        error: (e) => errors.push(e),
      });
      const err = new Error('boom');
      capturedError(err);
      expect(errors).toEqual([err]);
    });
  });

  describe('resetClient', () => {
    it('stops the old client and rebuilds via createApolloClient', () => {
      expect(mockCreateApolloClient).toHaveBeenCalledTimes(1);
      expect(mockClientStop).not.toHaveBeenCalled();
      service.resetClient();
      expect(mockClientStop).toHaveBeenCalledTimes(1);
      expect(mockCreateApolloClient).toHaveBeenCalledTimes(2);
    });

    it('the registered logout-orchestrator callback drives resetClient', () => {
      const cb = mockRegister.mock.calls[0][0];
      cb();
      expect(mockClientStop).toHaveBeenCalledTimes(1);
      expect(mockCreateApolloClient).toHaveBeenCalledTimes(2);
    });
  });

  describe('ngOnDestroy', () => {
    it('stops the client and unregisters from the orchestrator', () => {
      service.ngOnDestroy();
      expect(mockClientStop).toHaveBeenCalled();
      expect(mockUnregister).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('handleAuthFailure (driven by onAuthFailure callback)', () => {
    it('signs out, clears the auth store, and navigates to /login', async () => {
      capturedOnAuthFailure!('apollo-401');
      // handleAuthFailure is async but onAuthFailure is fire-and-forget.
      await new Promise((r) => setImmediate(r));
      expect(mockAuthSignOut).toHaveBeenCalled();
      expect(mockAuthStoreLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(['/login']);
    });

    it('still clears state and navigates when authSignOut rejects', async () => {
      mockAuthSignOut.mockRejectedValueOnce(new Error('amplify down'));
      capturedOnAuthFailure!('apollo-401');
      await new Promise((r) => setImmediate(r));
      expect(mockAuthSignOut).toHaveBeenCalled();
      expect(mockAuthStoreLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(['/login']);
    });
  });
});
