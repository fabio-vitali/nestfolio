# B3 — Apollo per-MFE clients — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline Apollo client construction in `GraphqlService` (which reads absolute AppSync URLs from runtime config) with a workspace-lib factory that builds one Apollo client per MFE-route against relative `/graphql/<domain>` and `${origin}/realtime/<domain>` URLs, satisfying charter §5 row 11, §7 R6, §8 (post-R6 payload shape), and Pillar 2.

**Architecture:** Extract `createApolloClient(opts)` as a free function in `@nestfolio/shell/graphql`. Add a sibling `provideMfeGraphql(domain)` Angular DI helper. Refactor `GraphqlService` to inject `MFE_DOMAIN` + `AuthConfig` (drops `APPSYNC_CONFIG`), build its inner client via the factory, and expose `handleAuthFailure()` (mirrors `LogoutButtonComponent.logout()`) wired through the factory's `onAuthFailure` callback. Move `provideGraphqlFor` from the host into the lib (renamed `provideMfeGraphql`); collapse `RuntimeConfig` to charter §8 verbatim by deleting the dead `appsync.*` block from the type, the producer, and the producer test.

**Tech Stack:** Angular 21, `@apollo/client@^4.1.6`, `aws-appsync-auth-link`, `aws-appsync-subscription-link`, `aws-amplify/auth`, NgRx Signals (`@ngrx/signals`), Jest (lib + host), `node:test` (producer), Nx 21, pnpm.

**Spec reference:** [`docs/superpowers/specs/2026-04-26-b3-apollo-per-mfe-clients-design.md`](../specs/2026-04-26-b3-apollo-per-mfe-clients-design.md).

**Charter reference:** [`docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md`](../specs/2026-04-24-mfe-architecture-charter.md) §5 row 11, §7 R6, §8, Pillar 2.

---

## Pre-flight checklist

Before Task 1, the executor must have:

- [ ] **B2 merged to `main`.** Verify: `git log main --oneline | grep 'b2-federation-mechanical-fixes'` returns a merge commit. If not, the B2 branch (`feat/b2-federation-mechanical-fixes`) is still in flight — do not start B3 against it; wait for the merge.
- [ ] **Branch cut.** From `main`:
  ```bash
  git checkout main && git pull --ff-only
  git checkout -b feat/b3-apollo-per-mfe-clients
  ```
- [ ] **Workspace install current.** Run `pnpm install --frozen-lockfile` and verify zero output diff. (No new package additions in this plan; `@apollo/client/link/error` is a subpath of the already-installed `@apollo/client@^4.1.6`.)
- [ ] **Baseline green.** `pnpm nx run-many --target=test -p shell,nestfolio-host` passes on the cut branch.
- [ ] **A4 + B1 + B2 invariants verifiable.** Confirm in code:
  - `libs/shell/src/auth/auth.config.ts` exports `class AuthConfig`. `getRuntimeConfig().auth` is wired into the `AuthConfig` provider in `apps/nestfolio-host/src/app/app.config.ts:108-110`.
  - `libs/frontend-deps/index.js` lists `aws-appsync-auth-link` and `aws-appsync-subscription-link` with `includeSecondaries: true`, and `@apollo/client` as a `singleton`. `@nestfolio/shell/graphql` is in `sharedMappings`.
  - CloudFront `/graphql/<domain>` and `/realtime/<domain>` behaviors are deployed to the dev account (B1). Verify with `aws ssm get-parameter --name /nestfolio/dev-investor-bff/api/graphqlUrl --region us-east-1 --query Parameter.Value --output text` returning a real URL.

---

## File structure

**New files:**
- `libs/shell/src/graphql/mfe-domain.token.ts` — DI `InjectionToken<string>` for the `<domain>` literal injected by `provideMfeGraphql`.
- `libs/shell/src/graphql/create-apollo-client.ts` — pure factory function; no Angular deps; takes `{domain, region, jwtTokenProvider, onAuthFailure}` and returns a configured `ApolloClient`. Owns the `errorLink` definition.
- `libs/shell/src/graphql/provide-mfe-graphql.ts` — Angular DI helper exporting `provideMfeGraphql(domain): Provider[]`.
- `libs/shell/test/graphql/create-apollo-client.test.ts` — factory + URL composition + link-order assertions; mocks the Apollo and AppSync link modules.
- `libs/shell/test/graphql/error-link.test.ts` — extracts the `onError` callback captured by the factory test mock and asserts the `onAuthFailure` dispatch contract.
- `libs/shell/test/graphql/provide-mfe-graphql.test.ts` — `TestBed`-driven assertion that the helper provides `MFE_DOMAIN` and `GraphqlService`.

**Modified files:**
- `libs/shell/src/graphql/graphql.service.ts` — drop `APPSYNC_CONFIG`; inject `MFE_DOMAIN`, `AuthConfig`, `Router`, `AuthStore`; build via `createApolloClient`; add `handleAuthFailure`.
- `libs/shell/src/graphql/index.ts` — drop `APPSYNC_CONFIG`/`AppSyncConfig` exports; add `MFE_DOMAIN`, `provideMfeGraphql`, `createApolloClient`, `CreateApolloClientOptions`.
- `libs/shell/test/graphql/graphql.service.test.ts` — extend `inject` mock for new tokens; add `Router` + `AuthStore` mocks; new `handleAuthFailure` describe block.
- `apps/nestfolio-host/src/app/app.routes.ts` — import `provideMfeGraphql` from `@nestfolio/shell/graphql`; pass `<domain>` literals.
- `apps/nestfolio-host/src/app/app.config.ts` — drop `appsync` from `RuntimeConfig`; simplify `validateEndpoints` to check only `copilotApiUrl`.
- `apps/nestfolio-host/src/app/runtime-config.service.ts` — delete `appsync` getter.
- `apps/nestfolio-host/test/app/runtime-config.service.spec.ts` — drop `appsync` fixture/assertions.
- `apps/nestfolio-host/test/app/app.config.spec.ts` — rewrite fixture and `validateEndpoints` cases against the new shape.
- `scripts/fetch-runtime-config.sh` — delete the four `*-bff/api/graphqlUrl` SSM lookups + the `appsync` JSON block.
- `scripts/fetch-runtime-config.test.mjs` — drop the four `*-bff` mocks; assert the new `Object.keys(cfg)` set.

**Deleted files:**
- `libs/shell/src/graphql/appsync.config.ts`
- `libs/shell/test/graphql/appsync-config.test.ts`
- `apps/nestfolio-host/src/app/provide-graphql.ts`
- `apps/nestfolio-host/test/app/provide-graphql.spec.ts`

**Unchanged:**
- All eight MFE service consumers (`apps/{advisory,dashboard,investor,ledger}-mfe/src/app/services/*.ts`) and their specs.
- `libs/shell/src/graphql/cached-query.ts` and its test.
- `libs/shell/src/logout-orchestrator.ts` and its test.
- `libs/frontend-deps/index.js` (B2-shipped).

---

## Task 1: `createApolloClient` factory + `errorLink`

**Files:**
- Create: `libs/shell/src/graphql/create-apollo-client.ts`
- Create: `libs/shell/test/graphql/create-apollo-client.test.ts`
- Create: `libs/shell/test/graphql/error-link.test.ts`

The factory is a pure function with no Angular DI. Tests run under `@jest-environment node` and stub `globalThis.window` so `window.location.origin` resolves.

- [ ] **Step 1: Write the factory test (failing)**

Create `libs/shell/test/graphql/create-apollo-client.test.ts`:

```typescript
/** @jest-environment node */
const mockHttpLink = jest.fn().mockImplementation(() => ({ kind: 'http' }));
const mockInMemoryCache = jest.fn().mockImplementation(() => ({ kind: 'cache' }));
const mockApolloClientCtor = jest.fn().mockImplementation((opts: unknown) => ({ kind: 'client', opts }));
const mockApolloLinkFrom = jest.fn().mockImplementation((links: unknown[]) => ({ kind: 'composed', links }));
const mockOnError = jest.fn().mockImplementation((cb: unknown) => ({ kind: 'errorLink', cb }));
const mockCreateAuthLink = jest.fn().mockImplementation(() => ({ kind: 'authLink' }));
const mockCreateSubscriptionHandshakeLink = jest
  .fn()
  .mockImplementation(() => ({ kind: 'wsLink' }));

jest.mock('@apollo/client/core', () => ({
  ApolloClient: mockApolloClientCtor,
  InMemoryCache: mockInMemoryCache,
  HttpLink: mockHttpLink,
  ApolloLink: { from: mockApolloLinkFrom },
}));
jest.mock('@apollo/client/link/error', () => ({ onError: mockOnError }));
jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: mockCreateAuthLink,
  AUTH_TYPE: { AMAZON_COGNITO_USER_POOLS: 'AMAZON_COGNITO_USER_POOLS' },
}));
jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: mockCreateSubscriptionHandshakeLink,
}));

// jsdom is not the default for this file; stub window.location.origin manually.
(globalThis as unknown as { window: { location: { origin: string } } }).window = {
  location: { origin: 'https://test.example.com' },
};

import { createApolloClient } from '../../src/graphql/create-apollo-client';

describe('createApolloClient', () => {
  const baseOpts = {
    domain: 'investor',
    region: 'us-east-1',
    jwtTokenProvider: jest.fn().mockResolvedValue('jwt-xyz'),
    onAuthFailure: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds HttpLink against /graphql/<domain> (relative)', () => {
    createApolloClient(baseOpts);
    expect(mockHttpLink).toHaveBeenCalledWith({ uri: '/graphql/investor' });
  });

  it('builds the subscription link against ${window.location.origin}/realtime/<domain>', () => {
    createApolloClient({ ...baseOpts, domain: 'advisory' });
    expect(mockCreateSubscriptionHandshakeLink).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://test.example.com/realtime/advisory',
        region: 'us-east-1',
        auth: expect.objectContaining({ type: 'AMAZON_COGNITO_USER_POOLS' }),
      }),
      expect.objectContaining({ kind: 'http' }),
    );
  });

  it('builds the auth link against the relative HTTP URI with the same auth options', () => {
    createApolloClient({ ...baseOpts, domain: 'ledger' });
    expect(mockCreateAuthLink).toHaveBeenCalledWith({
      url: '/graphql/ledger',
      region: 'us-east-1',
      auth: expect.objectContaining({
        type: 'AMAZON_COGNITO_USER_POOLS',
        jwtToken: baseOpts.jwtTokenProvider,
      }),
    });
  });

  it('composes links in order [errorLink, authLink, subscriptionLink]', () => {
    createApolloClient(baseOpts);
    expect(mockApolloLinkFrom).toHaveBeenCalledTimes(1);
    const links = mockApolloLinkFrom.mock.calls[0][0] as { kind: string }[];
    expect(links.map((l) => l.kind)).toEqual(['errorLink', 'authLink', 'wsLink']);
  });

  it('builds an ApolloClient with the composed link, an InMemoryCache, and no-cache fetch policies', () => {
    createApolloClient(baseOpts);
    expect(mockInMemoryCache).toHaveBeenCalled();
    expect(mockApolloClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        link: expect.objectContaining({ kind: 'composed' }),
        cache: expect.objectContaining({ kind: 'cache' }),
        defaultOptions: {
          query: { fetchPolicy: 'no-cache' },
          mutate: { fetchPolicy: 'no-cache' },
        },
      }),
    );
  });

  it('produces /graphql/<domain> for each of the four domains', () => {
    for (const domain of ['investor', 'advisory', 'dashboard', 'ledger']) {
      mockHttpLink.mockClear();
      createApolloClient({ ...baseOpts, domain });
      expect(mockHttpLink).toHaveBeenCalledWith({ uri: `/graphql/${domain}` });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm nx test shell --testPathPattern=create-apollo-client
```
Expected: FAIL with "Cannot find module '../../src/graphql/create-apollo-client'" (or similar resolution error).

- [ ] **Step 3: Write the factory implementation**

Create `libs/shell/src/graphql/create-apollo-client.ts`:

```typescript
import { ApolloClient, InMemoryCache, HttpLink, ApolloLink } from '@apollo/client/core';
import { onError } from '@apollo/client/link/error';
import { createAuthLink, AUTH_TYPE, AuthOptions } from 'aws-appsync-auth-link';
import { createSubscriptionHandshakeLink } from 'aws-appsync-subscription-link';

export interface CreateApolloClientOptions {
  /** BFF domain literal: 'investor' | 'advisory' | 'dashboard' | 'ledger'. */
  domain: string;
  /** AWS region for AppSync auth-link header construction. */
  region: string;
  /** Returns a Cognito ID token for outgoing requests. */
  jwtTokenProvider: () => Promise<string>;
  /** Invoked synchronously by errorLink on 401/403 / UNAUTHORIZED. */
  onAuthFailure: (reason: string) => void;
}

export function createApolloClient(opts: CreateApolloClientOptions): ApolloClient {
  const { domain, region, jwtTokenProvider, onAuthFailure } = opts;

  const httpUri = `/graphql/${domain}`;
  const realtimeUrl = `${window.location.origin}/realtime/${domain}`;

  const auth: AuthOptions = {
    type: AUTH_TYPE.AMAZON_COGNITO_USER_POOLS,
    jwtToken: jwtTokenProvider,
  };

  const errorLink = onError(({ networkError, graphQLErrors }) => {
    const networkAuthFailure =
      networkError !== undefined &&
      networkError !== null &&
      'statusCode' in networkError &&
      ((networkError as { statusCode?: number }).statusCode === 401 ||
        (networkError as { statusCode?: number }).statusCode === 403);
    const graphqlAuthFailure =
      graphQLErrors !== undefined &&
      graphQLErrors.some((e) => e.extensions?.['code'] === 'UNAUTHORIZED');
    if (networkAuthFailure || graphqlAuthFailure) {
      onAuthFailure('apollo-401');
    }
  });

  const httpLink = new HttpLink({ uri: httpUri });
  const authLink = createAuthLink({ url: httpUri, region, auth });
  const subscriptionLink = createSubscriptionHandshakeLink(
    { url: realtimeUrl, region, auth },
    httpLink,
  );

  return new ApolloClient({
    link: ApolloLink.from([errorLink, authLink, subscriptionLink]),
    cache: new InMemoryCache(),
    defaultOptions: {
      query: { fetchPolicy: 'no-cache' },
      mutate: { fetchPolicy: 'no-cache' },
    },
  });
}
```

- [ ] **Step 4: Run the factory test to verify it passes**

```bash
pnpm nx test shell --testPathPattern=create-apollo-client
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the errorLink test (failing)**

Create `libs/shell/test/graphql/error-link.test.ts`:

```typescript
/** @jest-environment node */
type ErrorHandler = (e: {
  networkError?: { statusCode?: number };
  graphQLErrors?: { extensions?: Record<string, unknown> }[];
}) => void;

let capturedHandler: ErrorHandler | undefined;

const mockOnError = jest.fn().mockImplementation((cb: ErrorHandler) => {
  capturedHandler = cb;
  return { kind: 'errorLink' };
});

jest.mock('@apollo/client/core', () => ({
  ApolloClient: jest.fn().mockImplementation(() => ({})),
  InMemoryCache: jest.fn().mockImplementation(() => ({})),
  HttpLink: jest.fn().mockImplementation(() => ({})),
  ApolloLink: { from: jest.fn().mockReturnValue({}) },
}));
jest.mock('@apollo/client/link/error', () => ({ onError: mockOnError }));
jest.mock('aws-appsync-auth-link', () => ({
  createAuthLink: jest.fn().mockReturnValue({}),
  AUTH_TYPE: { AMAZON_COGNITO_USER_POOLS: 'AMAZON_COGNITO_USER_POOLS' },
}));
jest.mock('aws-appsync-subscription-link', () => ({
  createSubscriptionHandshakeLink: jest.fn().mockReturnValue({}),
}));

(globalThis as unknown as { window: { location: { origin: string } } }).window = {
  location: { origin: 'https://test.example.com' },
};

import { createApolloClient } from '../../src/graphql/create-apollo-client';

describe('errorLink', () => {
  let onAuthFailure: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    capturedHandler = undefined;
    onAuthFailure = jest.fn();
    createApolloClient({
      domain: 'investor',
      region: 'us-east-1',
      jwtTokenProvider: jest.fn().mockResolvedValue('jwt'),
      onAuthFailure,
    });
    expect(capturedHandler).toBeDefined();
  });

  it('triggers onAuthFailure on networkError statusCode 401', () => {
    capturedHandler!({ networkError: { statusCode: 401 } });
    expect(onAuthFailure).toHaveBeenCalledWith('apollo-401');
  });

  it('triggers onAuthFailure on networkError statusCode 403', () => {
    capturedHandler!({ networkError: { statusCode: 403 } });
    expect(onAuthFailure).toHaveBeenCalledWith('apollo-401');
  });

  it("triggers onAuthFailure on a graphQLError with extensions.code === 'UNAUTHORIZED'", () => {
    capturedHandler!({ graphQLErrors: [{ extensions: { code: 'UNAUTHORIZED' } }] });
    expect(onAuthFailure).toHaveBeenCalledWith('apollo-401');
  });

  it('does NOT trigger onAuthFailure on networkError statusCode 500', () => {
    capturedHandler!({ networkError: { statusCode: 500 } });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('does NOT trigger onAuthFailure on a graphQLError without UNAUTHORIZED', () => {
    capturedHandler!({ graphQLErrors: [{ extensions: { code: 'BAD_USER_INPUT' } }] });
    expect(onAuthFailure).not.toHaveBeenCalled();
  });

  it('does NOT trigger onAuthFailure on an empty error event', () => {
    capturedHandler!({});
    expect(onAuthFailure).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run the errorLink test**

```bash
pnpm nx test shell --testPathPattern=error-link
```
Expected: PASS, 6 tests. (The factory implementation from Step 3 already supplies the behaviour.)

- [ ] **Step 7: Commit**

```bash
git add libs/shell/src/graphql/create-apollo-client.ts \
        libs/shell/test/graphql/create-apollo-client.test.ts \
        libs/shell/test/graphql/error-link.test.ts
git commit -m "$(cat <<'EOF'
feat(b3): add createApolloClient factory + errorLink in @nestfolio/shell/graphql

Pure factory; no Angular deps. Builds HttpLink against /graphql/<domain>
(relative) and the AppSync subscription link against
${window.location.origin}/realtime/<domain>. Composes
[errorLink, authLink, subscriptionLink]; errorLink invokes the caller-
supplied onAuthFailure on 401/403 / UNAUTHORIZED.
EOF
)"
```

---

## Task 2: `MFE_DOMAIN` injection token

**Files:**
- Create: `libs/shell/src/graphql/mfe-domain.token.ts`

The token replaces `APPSYNC_CONFIG`. Implementation is a one-liner; test coverage comes from Task 4's `provide-mfe-graphql.test.ts` and Task 3's updated `graphql.service.test.ts`. No standalone test file (mirrors how `copilot-api-url.token.ts` ships in this workspace).

- [ ] **Step 1: Write the implementation**

Create `libs/shell/src/graphql/mfe-domain.token.ts`:

```typescript
import { InjectionToken } from '@angular/core';

/**
 * BFF domain literal for the active route — one of 'investor' | 'advisory' |
 * 'dashboard' | 'ledger'. Wired by provideMfeGraphql(domain) in route providers.
 */
export const MFE_DOMAIN = new InjectionToken<string>('MFE_DOMAIN');
```

- [ ] **Step 2: Verify the token is importable**

```bash
pnpm nx test shell --testPathPattern=create-apollo-client
```
Expected: still PASS — sanity-check that the new file does not break the build.

- [ ] **Step 3: Commit**

```bash
git add libs/shell/src/graphql/mfe-domain.token.ts
git commit -m "feat(b3): add MFE_DOMAIN injection token (replaces APPSYNC_CONFIG)"
```

---

## Task 3: Refactor `GraphqlService`

**Files:**
- Modify: `libs/shell/src/graphql/graphql.service.ts`
- Modify: `libs/shell/test/graphql/graphql.service.test.ts`

`GraphqlService` switches from `APPSYNC_CONFIG` to `MFE_DOMAIN` + `AuthConfig`, builds via the factory, and adds `handleAuthFailure` (the LogoutButton equivalent). Public surface (`query`, `mutate`, `subscribe`, `resetClient`, `ngOnDestroy`) is preserved verbatim, so MFE service consumers do not move.

- [ ] **Step 1: Update the existing test (failing)**

Overwrite `libs/shell/test/graphql/graphql.service.test.ts` with:

```typescript
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

jest.mock('@nestfolio/shell/auth', () => ({
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
      expect(mockAuthStoreLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(['/login']);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm nx test shell --testPathPattern=graphql.service
```
Expected: FAIL — the current `graphql.service.ts` injects `APPSYNC_CONFIG`, not `MFE_DOMAIN`/`AuthConfig`/`Router`/`AuthStore`, and has no `handleAuthFailure`.

- [ ] **Step 3: Refactor the service**

Overwrite `libs/shell/src/graphql/graphql.service.ts` with:

```typescript
import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable } from 'rxjs';
import { ApolloClient, gql } from '@apollo/client/core';
import { fetchAuthSession } from 'aws-amplify/auth';
import { AuthConfig, authSignOut } from '@nestfolio/shell/auth';
import { LogoutOrchestrator } from '../logout-orchestrator';
import { AuthStore } from '../stores/auth.store';
import { MFE_DOMAIN } from './mfe-domain.token';
import { createApolloClient } from './create-apollo-client';

@Injectable()
export class GraphqlService implements OnDestroy {
  private readonly domain = inject(MFE_DOMAIN);
  private readonly authConfig = inject(AuthConfig);
  private readonly logoutOrchestrator = inject(LogoutOrchestrator);
  private readonly router = inject(Router);
  private readonly authStore = inject(AuthStore);
  private client: ApolloClient;
  private readonly resetFn = () => this.resetClient();

  constructor() {
    this.client = this.build();
    this.logoutOrchestrator.register(this.resetFn);
  }

  ngOnDestroy(): void {
    this.logoutOrchestrator.unregister(this.resetFn);
    this.client.stop();
  }

  async query<T>(statement: string, variables?: Record<string, unknown>): Promise<T> {
    const result = await this.client.query<T>({
      query: gql(statement),
      variables: variables ?? {},
    });
    return result.data as T;
  }

  async mutate<T>(statement: string, variables?: Record<string, unknown>): Promise<T> {
    const result = await this.client.mutate<T>({
      mutation: gql(statement),
      variables: variables ?? {},
    });
    return result.data as T;
  }

  subscribe<T>(statement: string, variables?: Record<string, unknown>): Observable<T> {
    return new Observable<T>((subscriber) => {
      const sub = this.client
        .subscribe<T>({
          query: gql(statement),
          variables: variables ?? {},
        })
        .subscribe({
          next: ({ data }: { data: T | null | undefined }) => {
            if (data) subscriber.next(data);
          },
          error: (err: unknown) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      return () => sub.unsubscribe();
    });
  }

  resetClient(): void {
    this.client.stop();
    this.client = this.build();
  }

  private build(): ApolloClient {
    return createApolloClient({
      domain: this.domain,
      region: this.authConfig.region,
      jwtTokenProvider: async () =>
        (await fetchAuthSession()).tokens?.idToken?.toString() ?? '',
      onAuthFailure: () => { void this.handleAuthFailure(); },
    });
  }

  /**
   * Mirrors LogoutButtonComponent.logout() — see libs/shell/src/components/logout-button.component.ts.
   * Single-flighted in practice because Apollo emits at most one auth-failure
   * error per client and the eventual /login redirect tears down the route
   * tree (and this service).
   */
  private async handleAuthFailure(): Promise<void> {
    try { await authSignOut(); } catch { /* fail-safe: still clear state + navigate */ }
    this.authStore.logout();
    await this.router.navigate(['/login']);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm nx test shell --testPathPattern=graphql.service
```
Expected: PASS — all 13 tests green.

- [ ] **Step 5: Commit**

```bash
git add libs/shell/src/graphql/graphql.service.ts \
        libs/shell/test/graphql/graphql.service.test.ts
git commit -m "$(cat <<'EOF'
refactor(b3): GraphqlService injects MFE_DOMAIN+AuthConfig and builds via factory

Drops APPSYNC_CONFIG. Builds the inner ApolloClient via createApolloClient.
Adds handleAuthFailure mirroring LogoutButtonComponent.logout() — wired
through the factory's onAuthFailure callback so 401/403/UNAUTHORIZED
from any GraphQL op signs the user out and routes to /login.
EOF
)"
```

---

## Task 4: `provideMfeGraphql` DI helper

**Files:**
- Create: `libs/shell/src/graphql/provide-mfe-graphql.ts`
- Create: `libs/shell/test/graphql/provide-mfe-graphql.test.ts`

The helper exists so the host's `app.routes.ts` can move from `provideGraphqlFor('investorBff')` to `provideMfeGraphql('investor')` with all wiring centralised in the lib.

- [ ] **Step 1: Write the test (failing)**

Create `libs/shell/test/graphql/provide-mfe-graphql.test.ts`:

```typescript
/** @jest-environment node */
jest.mock('@angular/core', () => ({
  InjectionToken: class { constructor(private desc: string) {} toString() { return `InjectionToken ${this.desc}`; } },
}));

import { MFE_DOMAIN } from '../../src/graphql/mfe-domain.token';
import { GraphqlService } from '../../src/graphql/graphql.service';
import { provideMfeGraphql } from '../../src/graphql/provide-mfe-graphql';

// Mock the GraphqlService import path used by provideMfeGraphql.
jest.mock('../../src/graphql/graphql.service', () => ({
  GraphqlService: class GraphqlServiceStub {},
}));

describe('provideMfeGraphql', () => {
  it('returns two providers', () => {
    const providers = provideMfeGraphql('investor');
    expect(providers).toHaveLength(2);
  });

  it('provides MFE_DOMAIN with the supplied literal', () => {
    const providers = provideMfeGraphql('advisory');
    const first = providers[0] as { provide: unknown; useValue: string };
    expect(first.provide).toBe(MFE_DOMAIN);
    expect(first.useValue).toBe('advisory');
  });

  it('provides GraphqlService as useClass: GraphqlService (forces a route-scoped instance)', () => {
    const providers = provideMfeGraphql('ledger');
    const second = providers[1] as { provide: unknown; useClass: unknown };
    expect(second.provide).toBe(GraphqlService);
    expect(second.useClass).toBe(GraphqlService);
  });

  it('passes the domain through verbatim for each of the four BFF domains', () => {
    for (const domain of ['investor', 'advisory', 'dashboard', 'ledger']) {
      const providers = provideMfeGraphql(domain);
      const first = providers[0] as { useValue: string };
      expect(first.useValue).toBe(domain);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
pnpm nx test shell --testPathPattern=provide-mfe-graphql
```
Expected: FAIL with "Cannot find module '../../src/graphql/provide-mfe-graphql'".

- [ ] **Step 3: Write the implementation**

Create `libs/shell/src/graphql/provide-mfe-graphql.ts`:

```typescript
import { Provider } from '@angular/core';
import { GraphqlService } from './graphql.service';
import { MFE_DOMAIN } from './mfe-domain.token';

/**
 * Per-route DI providers for an MFE's Apollo client. Pass the BFF domain
 * literal — one of 'investor' | 'advisory' | 'dashboard' | 'ledger'.
 *
 * Use in a route:
 *   { path: 'investor', providers: [provideMfeGraphql('investor')], ... }
 *
 * `useClass: GraphqlService` is intentional: it forces a per-route instance
 * under Angular's hierarchical injector. Otherwise a parent-route singleton
 * would be reused across siblings and MFE_DOMAIN would resolve from the
 * wrong scope.
 */
export function provideMfeGraphql(domain: string): Provider[] {
  return [
    { provide: MFE_DOMAIN, useValue: domain },
    { provide: GraphqlService, useClass: GraphqlService },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm nx test shell --testPathPattern=provide-mfe-graphql
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add libs/shell/src/graphql/provide-mfe-graphql.ts \
        libs/shell/test/graphql/provide-mfe-graphql.test.ts
git commit -m "feat(b3): add provideMfeGraphql(domain) DI helper to @nestfolio/shell/graphql"
```

---

## Task 5: Update `@nestfolio/shell/graphql` barrel + remove `APPSYNC_CONFIG`

**Files:**
- Modify: `libs/shell/src/graphql/index.ts`
- Delete: `libs/shell/src/graphql/appsync.config.ts`
- Delete: `libs/shell/test/graphql/appsync-config.test.ts`

The barrel exposes the new factory, token, and helper, and stops exporting the obsoleted `APPSYNC_CONFIG`/`AppSyncConfig`. The host (Task 6) and the obsolete `appsync-config.test.ts` are the only remaining consumers; both go in this branch.

- [ ] **Step 1: Rewrite the barrel**

Overwrite `libs/shell/src/graphql/index.ts` with:

```typescript
export { GraphqlService } from './graphql.service';
export { CachedQuery } from './cached-query';
export { MFE_DOMAIN } from './mfe-domain.token';
export { provideMfeGraphql } from './provide-mfe-graphql';
export { createApolloClient } from './create-apollo-client';
export type { CreateApolloClientOptions } from './create-apollo-client';
```

- [ ] **Step 2: Delete the obsolete files**

```bash
git rm libs/shell/src/graphql/appsync.config.ts \
       libs/shell/test/graphql/appsync-config.test.ts
```

- [ ] **Step 3: Run the lib test suite**

```bash
pnpm nx test shell
```
Expected: PASS for `create-apollo-client`, `error-link`, `provide-mfe-graphql`, `graphql.service`, `cached-query`. No failures from removed files.

- [ ] **Step 4: Commit**

```bash
git add libs/shell/src/graphql/index.ts
git commit -m "$(cat <<'EOF'
chore(b3): re-export factory + token + helper; delete APPSYNC_CONFIG

@nestfolio/shell/graphql now exposes MFE_DOMAIN, provideMfeGraphql,
createApolloClient (+ its options type). APPSYNC_CONFIG / AppSyncConfig
deleted along with their unit test.
EOF
)"
```

---

## Task 6: Wire host route providers + delete `provide-graphql.ts`

**Files:**
- Modify: `apps/nestfolio-host/src/app/app.routes.ts`
- Delete: `apps/nestfolio-host/src/app/provide-graphql.ts`
- Delete: `apps/nestfolio-host/test/app/provide-graphql.spec.ts`

After this task no host code references the old `provideGraphqlFor` helper or any `appsync.*` runtime-config field.

- [ ] **Step 1: Rewrite `app.routes.ts`**

Overwrite `apps/nestfolio-host/src/app/app.routes.ts` with:

```typescript
import { Route } from '@angular/router';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { authGuard, onboardingPendingGuard, onboardingCompletedGuard } from '@nestfolio/shell/auth';
import { provideMfeGraphql } from '@nestfolio/shell/graphql';
import { MfeErrorComponent } from './mfe-error.component';

function loadMfe(remoteName: string, exposedModule: string) {
  return () =>
    loadRemoteModule(remoteName, exposedModule).catch(() => ({
      remoteRoutes: [{ path: '**', component: MfeErrorComponent }],
    }));
}

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'signup',
    loadComponent: () => import('./auth/signup.component').then((m) => m.SignupComponent),
  },
  {
    path: 'confirm',
    loadComponent: () => import('./auth/confirm.component').then((m) => m.ConfirmComponent),
  },
  {
    path: 'onboarding',
    canActivate: [authGuard, onboardingPendingGuard],
    loadChildren: loadMfe('onboarding-mfe', './routes'),
  },
  {
    path: 'investor',
    providers: [provideMfeGraphql('investor')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('investor-mfe', './routes'),
  },
  {
    path: 'dashboard',
    providers: [provideMfeGraphql('dashboard')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('dashboard-mfe', './routes'),
  },
  {
    path: 'advisory',
    providers: [provideMfeGraphql('advisory')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('advisory-mfe', './routes'),
  },
  {
    path: 'ledger',
    providers: [provideMfeGraphql('ledger')],
    canActivate: [authGuard, onboardingCompletedGuard],
    loadChildren: loadMfe('ledger-mfe', './routes'),
  },
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
```

- [ ] **Step 2: Delete `provide-graphql.ts` + its spec**

```bash
git rm apps/nestfolio-host/src/app/provide-graphql.ts \
       apps/nestfolio-host/test/app/provide-graphql.spec.ts
```

- [ ] **Step 3: Run the host test suite**

```bash
pnpm nx test nestfolio-host
```
Expected: failures in `runtime-config.service.spec.ts` and `app.config.spec.ts` because the `appsync` field is still typed and asserted (Task 7 fixes those). The route file itself does not have a dedicated spec; routes are exercised via integration. Continue.

- [ ] **Step 4: Commit**

```bash
git add apps/nestfolio-host/src/app/app.routes.ts
git commit -m "$(cat <<'EOF'
feat(b3): wire host routes to provideMfeGraphql; delete provideGraphqlFor

app.routes.ts now imports provideMfeGraphql from @nestfolio/shell/graphql
and passes the BFF domain literal ('investor'|'advisory'|'dashboard'|
'ledger'). Host-local provide-graphql.ts and its spec removed.
EOF
)"
```

---

## Task 7: Collapse `RuntimeConfig` to charter §8 verbatim

**Files:**
- Modify: `apps/nestfolio-host/src/app/app.config.ts`
- Modify: `apps/nestfolio-host/src/app/runtime-config.service.ts`
- Modify: `apps/nestfolio-host/test/app/app.config.spec.ts`
- Modify: `apps/nestfolio-host/test/app/runtime-config.service.spec.ts`

The runtime-config payload reduces to `{auth, copilotApiUrl}`. `validateEndpoints` shrinks to a single check (`copilotApiUrl`).

- [ ] **Step 1: Update `app.config.spec.ts` (failing)**

Overwrite `apps/nestfolio-host/test/app/app.config.spec.ts` with:

```typescript
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
```

- [ ] **Step 2: Update `runtime-config.service.spec.ts` (failing)**

Overwrite `apps/nestfolio-host/test/app/runtime-config.service.spec.ts` with:

```typescript
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
```

- [ ] **Step 3: Run the host tests to verify they fail**

```bash
pnpm nx test nestfolio-host
```
Expected: FAIL — `RuntimeConfig` still types `appsync`; the new tests refuse to compile/run.

- [ ] **Step 4: Update `app.config.ts`**

In `apps/nestfolio-host/src/app/app.config.ts`, replace lines 11-48 (the `RuntimeConfig` interface and `validateEndpoints` function) with:

```typescript
export interface RuntimeConfig {
  auth: { userPoolId: string; clientId: string; region: string };
  copilotApiUrl: string;
}

let runtimeConfig: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (!runtimeConfig) {
    throw new Error(
      'Runtime config not initialised. loadRuntimeConfig must run as an APP_INITIALIZER before any consumer reads getRuntimeConfig().',
    );
  }
  return runtimeConfig;
}

export function validateEndpoints(config: RuntimeConfig): void {
  const url = config.copilotApiUrl;
  if (!url) return;
  if (url.startsWith('https://')) return;
  if (isDevMode() && url.startsWith('http://localhost')) return;
  throw new Error(`Invalid endpoint URL: "${url}". All endpoints must use HTTPS.`);
}
```

The `loadRuntimeConfig`, `initializeAuth`, and `appConfig` blocks below stay verbatim. Note: confirm that `getRuntimeConfig` is defined exactly once after the edit (the original file already had it at lines 22-31; this rewrite consolidates the `RuntimeConfig` interface, `runtimeConfig` mutable, `getRuntimeConfig`, and `validateEndpoints` into a single contiguous block).

- [ ] **Step 5: Update `runtime-config.service.ts`**

In `apps/nestfolio-host/src/app/runtime-config.service.ts`, delete the `appsync` getter. The file becomes:

```typescript
import { Injectable } from '@angular/core';
import { getRuntimeConfig, RuntimeConfig } from './app.config';

/**
 * Injectable service that provides access to the runtime configuration.
 * The config is loaded at bootstrap via APP_INITIALIZER (loadRuntimeConfig),
 * so it is guaranteed to be available by the time any component or service injects this.
 *
 * Values always come from /assets/config.json — produced by
 * `pnpm nx run nestfolio-host:config --prefix=<prefix>`. No environment.ts
 * fallback exists; if the producer hasn't run, bootstrap fails hard.
 */
@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  get config(): RuntimeConfig {
    return getRuntimeConfig();
  }

  get auth(): RuntimeConfig['auth'] {
    return this.config.auth;
  }

  get copilotApiUrl(): string {
    return this.config.copilotApiUrl;
  }
}
```

- [ ] **Step 6: Run the host tests to verify they pass**

```bash
pnpm nx test nestfolio-host
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/nestfolio-host/src/app/app.config.ts \
        apps/nestfolio-host/src/app/runtime-config.service.ts \
        apps/nestfolio-host/test/app/app.config.spec.ts \
        apps/nestfolio-host/test/app/runtime-config.service.spec.ts
git commit -m "$(cat <<'EOF'
refactor(b3): collapse RuntimeConfig to charter §8 shape

RuntimeConfig now { auth, copilotApiUrl }. The appsync.*.endpoint/region
block is gone — the per-MFE Apollo factory takes a <domain> literal +
relative URLs (B3 lib changes). validateEndpoints shrinks to one check
(copilotApiUrl). RuntimeConfigService loses the appsync getter.
EOF
)"
```

---

## Task 8: Simplify the runtime-config producer

**Files:**
- Modify: `scripts/fetch-runtime-config.sh`
- Modify: `scripts/fetch-runtime-config.test.mjs`

The producer stops querying the four `*-bff/api/graphqlUrl` SSM parameters and stops emitting the `appsync` JSON block.

- [ ] **Step 1: Update the producer test (failing)**

Overwrite `scripts/fetch-runtime-config.test.mjs` with:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = new URL('./fetch-runtime-config.sh', import.meta.url).pathname;

function runScript({ awsResponses, args, outDir }) {
  const sandbox = mkdtempSync(join(tmpdir(), 'fetch-rtcfg-'));
  const stubBin = join(sandbox, 'bin');
  mkdirSync(stubBin, { recursive: true });

  const responsesPath = join(sandbox, 'responses.json');
  writeFileSync(responsesPath, JSON.stringify(awsResponses));
  const stubPath = join(stubBin, 'aws');
  writeFileSync(stubPath, `#!/usr/bin/env bash
NAME=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    *) shift ;;
  esac
done
RESPONSES_FILE="${responsesPath}" NAME="$NAME" node -e "
  const r = JSON.parse(require('fs').readFileSync(process.env.RESPONSES_FILE, 'utf-8'));
  const entry = r[process.env.NAME];
  if (!entry) { process.stderr.write('ParameterNotFound: ' + process.env.NAME + '\\n'); process.exit(1); }
  if (entry.exitCode && entry.exitCode !== 0) { process.stderr.write(entry.value + '\\n'); process.exit(entry.exitCode); }
  process.stdout.write(entry.value);
"
`, { mode: 0o755 });
  chmodSync(stubPath, 0o755);

  const outRoot = outDir ?? join(sandbox, 'workspace');
  mkdirSync(join(outRoot, 'apps/nestfolio-host/public/assets'), { recursive: true });

  const result = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      PATH: `${stubBin}:${process.env.PATH}`,
      RUNTIME_CONFIG_OUT_ROOT: outRoot,
    },
  });

  let written = null;
  try {
    written = readFileSync(join(outRoot, 'apps/nestfolio-host/public/assets/config.json'), 'utf-8');
  } catch { /* not written — test will check */ }

  rmSync(sandbox, { recursive: true, force: true });
  return { ...result, written };
}

const HAPPY_RESPONSES = {
  '/nestfolio/dev-investor/auth/userPoolId':       { value: 'us-east-1_POOL' },
  '/nestfolio/dev-investor/auth/userPoolClientId': { value: 'CLIENT_ID' },
  '/nestfolio/dev-investor/auth/region':           { value: 'us-east-1' },
  '/nestfolio/dev-investor/web/distributionUrl':   { value: 'https://d111111abcdef8.cloudfront.net' },
};

test('emits a charter-§8 config.json (auth + copilotApiUrl only) when SSM is healthy', () => {
  const result = runScript({ awsResponses: HAPPY_RESPONSES, args: ['--prefix=dev'] });
  assert.equal(result.status, 0, `script failed: ${result.stderr}`);
  const cfg = JSON.parse(result.written);
  assert.deepEqual(cfg.auth, {
    userPoolId: 'us-east-1_POOL',
    clientId: 'CLIENT_ID',
    region: 'us-east-1',
  });
  assert.equal(cfg.copilotApiUrl, 'https://d111111abcdef8.cloudfront.net/api/copilotkit');
  assert.equal(Object.keys(cfg).sort().join(','), 'auth,copilotApiUrl');
  assert.equal(cfg.appsync, undefined);
});

test('does NOT query *-bff/api/graphqlUrl SSM paths', () => {
  // If the script tried to query a BFF endpoint that isn't in HAPPY_RESPONSES,
  // the stub would exit non-zero and the script would propagate the failure.
  // The previous test passing therefore covers this — restate explicitly:
  const result = runScript({ awsResponses: HAPPY_RESPONSES, args: ['--prefix=dev'] });
  assert.equal(result.status, 0);
});

test('exits non-zero with a named-path error when an SSM param is missing', () => {
  const broken = { ...HAPPY_RESPONSES };
  delete broken['/nestfolio/dev-investor/auth/userPoolId'];
  const result = runScript({ awsResponses: broken, args: ['--prefix=dev'] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\/nestfolio\/dev-investor\/auth\/userPoolId/);
  assert.match(result.stderr, /deploy\.sh/);
  assert.equal(result.written, null);
});

test('exits non-zero with usage when --prefix is missing', () => {
  const result = runScript({ awsResponses: HAPPY_RESPONSES, args: [] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--prefix/);
});

test('accepts --region as an explicit override', () => {
  const result = runScript({
    awsResponses: HAPPY_RESPONSES,
    args: ['--prefix=dev', '--region=us-east-1'],
  });
  assert.equal(result.status, 0, result.stderr);
});
```

- [ ] **Step 2: Run the producer test to verify it fails**

```bash
node --test scripts/fetch-runtime-config.test.mjs
```
Expected: FAIL — the script still queries the four BFF SSM paths (which no longer exist in `HAPPY_RESPONSES`) and emits an `appsync` block.

- [ ] **Step 3: Update the producer**

In `scripts/fetch-runtime-config.sh`, delete lines 94-97 (the four `*-bff/api/graphqlUrl` lookups) and replace lines 102-118 (the entire JSON emission block) with:

```bash
mkdir -p "$(dirname "$OUT_PATH")"
{
  printf '{\n'
  printf '  "auth": {\n'
  printf '    "userPoolId": %s,\n' "$(json_str "$USER_POOL_ID")"
  printf '    "clientId": %s,\n'   "$(json_str "$CLIENT_ID")"
  printf '    "region": %s\n'      "$(json_str "$AUTH_REGION")"
  printf '  },\n'
  printf '  "copilotApiUrl": %s\n' "$(json_str "${DIST_URL}/api/copilotkit")"
  printf '}\n'
} > "$OUT_PATH"

echo "Wrote ${OUT_PATH}"
```

Concretely the post-edit script body (from line 90 onward) reads:

```bash
USER_POOL_ID="$(get_ssm "/nestfolio/${PREFIX}-investor/auth/userPoolId" "investor-web")"
CLIENT_ID="$(get_ssm "/nestfolio/${PREFIX}-investor/auth/userPoolClientId" "investor-web")"
AUTH_REGION="$(get_ssm "/nestfolio/${PREFIX}-investor/auth/region" "investor-web")"
DIST_URL="$(get_ssm "/nestfolio/${PREFIX}-investor/web/distributionUrl" "investor-web")"

# JSON encoder: minimal, used per-string to escape backslash and double-quote.
json_str() { printf '"%s"' "${1//\"/\\\"}" ; }

mkdir -p "$(dirname "$OUT_PATH")"
{
  printf '{\n'
  printf '  "auth": {\n'
  printf '    "userPoolId": %s,\n' "$(json_str "$USER_POOL_ID")"
  printf '    "clientId": %s,\n'   "$(json_str "$CLIENT_ID")"
  printf '    "region": %s\n'      "$(json_str "$AUTH_REGION")"
  printf '  },\n'
  printf '  "copilotApiUrl": %s\n' "$(json_str "${DIST_URL}/api/copilotkit")"
  printf '}\n'
} > "$OUT_PATH"

echo "Wrote ${OUT_PATH}"
```

- [ ] **Step 4: Run the producer test to verify it passes**

```bash
node --test scripts/fetch-runtime-config.test.mjs
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/fetch-runtime-config.sh scripts/fetch-runtime-config.test.mjs
git commit -m "$(cat <<'EOF'
refactor(b3): runtime-config producer drops appsync.* (4 SSM lookups gone)

scripts/fetch-runtime-config.sh now emits charter §8 verbatim:
{auth: {userPoolId, clientId, region}, copilotApiUrl}. The four
*-bff/api/graphqlUrl SSM lookups are deleted along with the appsync
JSON block. Producer test asserts the new shape.
EOF
)"
```

---

## Task 9: Verification gates + manual smoke

**Files:** none modified.

Final cross-cutting verification before the PR.

- [ ] **Step 1: Run all affected unit tests**

```bash
pnpm nx run-many --target=test -p shell,nestfolio-host,investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe
```
Expected: PASS for all six projects. The four MFE projects' tests are unchanged by this branch and serve as a regression check that `GraphqlService`'s public surface really is preserved.

- [ ] **Step 2: Run the producer test**

```bash
node --test scripts/fetch-runtime-config.test.mjs
```
Expected: PASS, 5 tests.

- [ ] **Step 3: Lint**

```bash
pnpm nx run-many --target=lint -p shell,nestfolio-host,investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe
```
Expected: PASS for all six projects.

- [ ] **Step 4: Build the host (re-runs B2's assert-shell-html.mjs invariant gate)**

```bash
pnpm nx run nestfolio-host:build
```
Expected: PASS — `assert-shell-html.mjs` checks the chained build output. No new HTML invariants introduced by B3.

- [ ] **Step 5: Build all MFEs**

```bash
pnpm nx run-many --target=build -p investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe,onboarding-mfe
```
Expected: PASS. Reasserts the federation singleton surface from B2 still holds — no MFE accidentally pulls in a new dep that breaks the shell ⊇ MFE rule.

- [ ] **Step 6: Manual browser smoke**

Requires AWS credentials in the dev account (771924376645) via Leapp.

```bash
pnpm nx run nestfolio-host:config --prefix=dev   # produces apps/nestfolio-host/public/assets/config.json
cat apps/nestfolio-host/public/assets/config.json   # verify the new shape
pnpm nx serve nestfolio-host                       # default port (NF chooses)
```

Open the served URL in a browser. Sign in. For each route — `/dashboard`, `/investor`, `/advisory`, `/ledger` — open DevTools Network panel and:

- [ ] Confirm GraphQL HTTP requests target `POST /graphql/<domain>` (relative; resolved against the dev-server origin).
- [ ] Trigger a subscription path (initiate a deposit on `/investor`; visit a decision detail on `/advisory`; mark a notification read). Confirm the WSS connection targets `WS /realtime/<domain>` (the dev-server origin's WSS upgrade).
- [ ] Confirm zero requests target any `*.amazonaws.com` host.
- [ ] Sign out via the LogoutButton in the shell. Sign back in. Repeat the routes. Confirm fresh Apollo clients are constructed (you can verify via a console breakpoint inside `GraphqlService.build()` if needed).

Note: in `nx serve` mode, the dev-server proxies are not configured, so the browser will resolve `/graphql/<domain>` against the dev origin, which has no upstream — the requests fail. This is **expected** for local serve. The real verification is the deployed CloudFront topology (B1-shipped). To smoke against deployed infra, run `pnpm nx run investor-web:deploy --prefix=dev` (no shell change required by B3 — just the deployed JS bundles) and browse the CloudFront distribution URL.

- [ ] **Step 7: Open the PR**

```bash
git push -u origin feat/b3-apollo-per-mfe-clients
gh pr create --title "feat(b3): Apollo per-MFE clients" --body "$(cat <<'EOF'
## Summary
- Extracts `createApolloClient(opts)` factory in `@nestfolio/shell/graphql`; HTTP `/graphql/<domain>` (relative) + WSS `${origin}/realtime/<domain>`
- Adds `MFE_DOMAIN` token + `provideMfeGraphql(domain)` DI helper; route providers in the host now pass a `<domain>` literal
- `GraphqlService` injects `MFE_DOMAIN` + `AuthConfig` + `Router` + `AuthStore`; new `handleAuthFailure()` mirrors `LogoutButtonComponent.logout()` (wired through the factory's `onAuthFailure` callback for 401/403/UNAUTHORIZED)
- Collapses `RuntimeConfig` to charter §8 shape (`{auth, copilotApiUrl}`); producer drops 4 BFF SSM lookups
- Realises charter §5 row 11, §7 R6, §8, Pillar 2

## Test plan
- [ ] `pnpm nx run-many --target=test -p shell,nestfolio-host,investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe`
- [ ] `node --test scripts/fetch-runtime-config.test.mjs`
- [ ] `pnpm nx run-many --target=lint -p shell,nestfolio-host,investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe`
- [ ] `pnpm nx run nestfolio-host:build`
- [ ] `pnpm nx run-many --target=build -p investor-mfe,advisory-mfe,dashboard-mfe,ledger-mfe,onboarding-mfe`
- [ ] Browser smoke against a deployed CloudFront distribution: `/graphql/<domain>` HTTP and `/realtime/<domain>` WSS, no `*.amazonaws.com` traffic

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-check (executor)

After Task 9, verify:

- [ ] No file under `libs/shell/src/graphql/` mentions `APPSYNC_CONFIG`. Search: `grep -r APPSYNC_CONFIG libs/shell/ apps/`. Expected: no matches.
- [ ] No file under `apps/nestfolio-host/` references `provideGraphqlFor`. Search: `grep -r provideGraphqlFor apps/`. Expected: no matches.
- [ ] No file under `apps/` or `libs/` names `appsync` as a `RuntimeConfig` field. Search: `grep -r 'config.appsync' apps/ libs/` and `grep -rn '"appsync"' apps/`. Expected: no matches.
- [ ] `apps/nestfolio-host/public/assets/config.json` (after running the producer) has exactly two top-level keys (`auth`, `copilotApiUrl`). Verify with `jq -r 'keys | sort | join(",")' apps/nestfolio-host/public/assets/config.json` → `auth,copilotApiUrl`.
- [ ] `libs/shell/src/graphql/index.ts` exports `MFE_DOMAIN`, `provideMfeGraphql`, `createApolloClient`, `CreateApolloClientOptions`, `GraphqlService`, `CachedQuery` — and nothing else.

---

## What this plan does NOT cover

- **onboarding-mfe Apollo wiring.** onboarding-bff has no Facade/AppSync API; onboarding-mfe drives CopilotKit via `/api/copilotkit*`. No factory call, no DI helper. Untouched.
- **Server-side AppSync clients** (e2e-feature-tests, integration-testing, event-listener Lambdas). Pillar 5: SigV4 IAM auth, server-to-server, never transits CloudFront. Out of scope.
- **CSP `connect-src` tightening.** A1 already shipped the canonical CSP file. After B3, no MFE code reaches AppSync directly; the existing CSP is already tighter than required. No charter follow-up needed.
- **`AuthConfig` rename** (charter §8 calls it `AUTH_CONFIG`). A4 shipped the abstract-class symbol; B3 leaves it. Renaming is a workspace-wide refactor that belongs to Phase C cleanup at the earliest.
- **Per-client lazy loading of `aws-appsync-subscription-link`.** The lib is already a federation singleton; lazy-loading per client is premature optimization.
- **Adding new test for `app.routes.ts`.** Routes are exercised via the deployed app and the manual smoke gate in Task 9. Adding a route-config unit test is out of scope.
