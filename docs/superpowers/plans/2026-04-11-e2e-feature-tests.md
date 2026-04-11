# E2E Feature Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a black-box e2e feature test suite in a new Nx library `libs/e2e-feature-tests` that validates 13 user-facing features end-to-end against a deployed Nestfolio sandbox via GraphQL only, plus the single code prerequisite (Alpaca paper-only safety guard) that unblocks it.

**Architecture:** One new Nx TypeScript library with Jest runner, `maxWorkers: 1`, 5 min per-test timeout, and a `globalTeardown` hook that wipes paper Alpaca state. The suite reuses `createIntegrationContext`, `CognitoFixture`, `EventBridgeClient`, and `AppSyncClient` from `libs/integration-testing` but imports **only those three** — no `EventBusTrap`, no `TableAssertions`, no DDB reads. Each test file is a self-contained `describe` block: `freshTenant() → applyFixtures() → mutate/publish → waitForGraphQL()`.

**Tech Stack:** TypeScript, Nx `@nx/jest`, ts-jest, `@aws-sdk/client-*`, `@nestfolio/integration-testing`, `@nestfolio/event-types`, branded event-name constants re-exported from the existing per-service `domain/events.ts` files. Runs against real AWS (us-east-1, dev account 771924376645) via the AWS credentials already used by integration tests.

---

## File Structure

```
libs/e2e-feature-tests/
├── project.json
├── jest.config.js
├── jest.global-teardown.ts
├── tsconfig.json
├── tsconfig.spec.json
├── src/
│   ├── index.ts                       # re-exports helper surface
│   └── helpers/
│       ├── fresh-tenant.ts
│       ├── fixtures.ts
│       ├── bff-client.ts
│       ├── wait-for-graphql.ts
│       └── alpaca-paper-reset.ts
└── test/
    ├── funding/
    │   ├── fund-account.e2e.test.ts
    │   └── withdraw-cash.e2e.test.ts
    ├── advisory/
    │   ├── first-decision.e2e.test.ts
    │   ├── accept-decision.e2e.test.ts
    │   ├── reject-decision.e2e.test.ts
    │   ├── view-decision-explanation.e2e.test.ts
    │   ├── rebalance-on-drift.e2e.test.ts
    │   └── reconciliation-correction.e2e.test.ts
    ├── profile/
    │   ├── update-goal.e2e.test.ts
    │   ├── update-mandate.e2e.test.ts
    │   └── revoke-mandate.e2e.test.ts
    ├── notifications/
    │   └── mark-notification-read.e2e.test.ts
    └── account/
        └── request-closure.e2e.test.ts
```

**Production code modifications (prerequisite only):**
- `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts` — constructor safety guard
- `services/execution/broker-alpaca-adpt/src/service.stack.ts` — add `NESTFOLIO_PREFIX` env var
- `services/execution/broker-alpaca-adpt/test/unit/alpaca.client.test.ts` — unit tests for guard

---

## Resolved spec ambiguities (read before starting)

1. **Spec says `getGoal` / `getMandate` queries.** These do NOT exist in `services/investor/investor-bff/src/schema.graphql`. The real schema exposes `getGoals: [Goal!]!` (plural) and has no mandate query at all. Mandate state is only returned from the mutation itself (`updateMandate`, `revokeMandate` both return the `Mandate!`). This plan uses `getGoals` for goal assertions and asserts mandate state by inspecting the mutation's return value, followed by a second round-trip to `revokeMandate`/`updateMandate` where a second read is needed.
2. **Spec says "reconciliation scheduler event".** The concrete event is `RECONCILIATION_REQUIRED` on the `ledger` bus (defined in `services/ledger/reconciliation-ctrl/src/domain/events.ts`). This plan uses that exact name.
3. **`prefix` for the Alpaca guard.** `broker-alpaca-adpt` does not currently expose `prefix` as a Lambda env var — it's only interpolated into `ALPACA_BASE_URL_PARAM`. We add an explicit `NESTFOLIO_PREFIX` env var in the stack so the guard can read it without parsing SSM paths.
4. **`applyFixtures` seeding path.** The existing `investor-bff` integration test proves `ONBOARDING_COMPLETED` requires a preceding `USER_REGISTERED` event because the Cognito-driven ConditionExpression requires the `InvestorProfile` row to already exist. The `onboarded()` fixture composes both events in order.
5. **Cognito `sub` = `userId`.** Integration tests extract the Cognito `sub` claim from the idToken and use it as `userId`. `freshTenant()` does the same so fixtures can key events correctly.

---

## Task 1: Alpaca cold-start paper-only safety guard (prerequisite)

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts`
- Modify: `services/execution/broker-alpaca-adpt/src/service.stack.ts`
- Modify: `services/execution/broker-alpaca-adpt/test/unit/alpaca.client.test.ts`

- [ ] **Step 1: Add failing unit tests for the guard**

Open `services/execution/broker-alpaca-adpt/test/unit/alpaca.client.test.ts` and append the following describe block **before** the closing brace of the top-level `describe('AlpacaClient', ...)` block (i.e. at the same nesting level as the existing `it('submitOrder ...')` cases):

```ts
describe('cold-start paper-only safety guard', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('allows paper baseUrl in any prefix', () => {
    process.env.NESTFOLIO_PREFIX = 'dev';
    expect(() => new AlpacaClient({
      baseUrl: 'https://paper-api.alpaca.markets',
      apiKeyId: 'k',
      apiKeySecret: 's',
    })).not.toThrow();
  });

  it('allows non-paper baseUrl only when NESTFOLIO_PREFIX is prod', () => {
    process.env.NESTFOLIO_PREFIX = 'prod';
    expect(() => new AlpacaClient({
      baseUrl: 'https://api.alpaca.markets',
      apiKeyId: 'k',
      apiKeySecret: 's',
    })).not.toThrow();
  });

  it('refuses non-paper baseUrl in a non-prod prefix', () => {
    process.env.NESTFOLIO_PREFIX = 'dev';
    expect(() => new AlpacaClient({
      baseUrl: 'https://api.alpaca.markets',
      apiKeyId: 'k',
      apiKeySecret: 's',
    })).toThrow(/refuses to start: non-paper baseUrl/);
  });

  it('refuses non-paper baseUrl when NESTFOLIO_PREFIX is unset', () => {
    delete process.env.NESTFOLIO_PREFIX;
    expect(() => new AlpacaClient({
      baseUrl: 'https://api.alpaca.markets',
      apiKeyId: 'k',
      apiKeySecret: 's',
    })).toThrow(/refuses to start: non-paper baseUrl/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm nx test broker-alpaca-adpt --testPathPattern=alpaca.client.test.ts -t "cold-start paper-only safety guard"`

Expected: 4 tests FAIL (the first two should pass because no guard is present; the last two should fail because the constructor does not throw).

Actual behavior when guard is missing: 2 PASS, 2 FAIL — the two `expect().toThrow()` assertions fail because no throw occurs.

- [ ] **Step 3: Implement the guard in `alpaca.client.ts`**

Open `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts`. Replace the existing constructor (lines 32–48) and insert the guard helper above the class. The full replacement for the top of the file (from line 32 through the end of the constructor) becomes:

```ts
const PAPER_BASE_URLS = new Set(['https://paper-api.alpaca.markets']);
const LIVE_ALLOWED_PREFIXES = new Set(['prod']);

function assertAlpacaSafe(baseUrl: string, prefix: string | undefined): void {
  if (PAPER_BASE_URLS.has(baseUrl)) return;
  if (prefix && LIVE_ALLOWED_PREFIXES.has(prefix)) return;
  throw new Error(
    `broker-alpaca-adpt refuses to start: non-paper baseUrl '${baseUrl}' ` +
    `is not allowed in prefix '${prefix ?? '<unset>'}'. Only 'prod' may use live Alpaca.`,
  );
}

export class AlpacaClient {
  private baseUrl?: string;
  private apiKeyId?: string;
  private apiKeySecret?: string;
  private readonly staticConfig: boolean;

  constructor(config?: { baseUrl?: string; apiKeyId?: string; apiKeySecret?: string }) {
    // Direct config injection for unit tests — bypasses resolve()
    if (config?.baseUrl) {
      assertAlpacaSafe(config.baseUrl, process.env.NESTFOLIO_PREFIX);
      this.baseUrl = config.baseUrl;
      this.apiKeyId = config.apiKeyId;
      this.apiKeySecret = config.apiKeySecret;
      this.staticConfig = true;
    } else {
      this.staticConfig = false;
    }
  }
```

Then, inside the existing `resolve()` method, after the line `this.baseUrl = paramData.Parameter.Value;` (line 64), add the runtime guard:

```ts
    this.baseUrl = paramData.Parameter.Value;
    assertAlpacaSafe(this.baseUrl, process.env.NESTFOLIO_PREFIX);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm nx test broker-alpaca-adpt --testPathPattern=alpaca.client.test.ts -t "cold-start paper-only safety guard"`

Expected: 4 tests PASS.

Also run the full file to confirm nothing else broke: `pnpm nx test broker-alpaca-adpt --testPathPattern=alpaca.client.test.ts`

Expected: ALL tests PASS.

Note: the pre-existing tests construct `AlpacaClient` with `baseUrl: 'https://paper-api.alpaca.markets'` (see test/unit/alpaca.client.test.ts line 12), so they continue to pass regardless of `NESTFOLIO_PREFIX`.

- [ ] **Step 5: Wire `NESTFOLIO_PREFIX` in the stack**

Open `services/execution/broker-alpaca-adpt/src/service.stack.ts`. Find the `Ingress` construct invocation (starts around line 19) and its `environment` block (lines 28–31). Replace the `environment` object with:

```ts
      environment: {
        ALPACA_BASE_URL_PARAM: `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
        ALPACA_SECRET_ID: `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
        NESTFOLIO_PREFIX: props.prefix,
      },
```

- [ ] **Step 6: Run broker-alpaca-adpt's full unit suite + stack test**

Run: `pnpm nx test broker-alpaca-adpt`

Expected: ALL tests PASS.

- [ ] **Step 7: Commit the prerequisite**

```bash
git add services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts \
         services/execution/broker-alpaca-adpt/src/service.stack.ts \
         services/execution/broker-alpaca-adpt/test/unit/alpaca.client.test.ts
git commit -m "$(cat <<'EOF'
feat(broker-alpaca-adpt): cold-start paper-only safety guard

Refuses non-paper Alpaca baseUrl in any prefix except prod. Prerequisite
for the e2e feature test suite — converts a misconfigured SSM value into
a deploy-time failure instead of a silent real-money trade. Adds
NESTFOLIO_PREFIX env var so the guard has explicit context.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Scaffold the `libs/e2e-feature-tests` Nx library

**Files:**
- Create: `libs/e2e-feature-tests/project.json`
- Create: `libs/e2e-feature-tests/tsconfig.json`
- Create: `libs/e2e-feature-tests/tsconfig.spec.json`
- Create: `libs/e2e-feature-tests/jest.config.js`
- Create: `libs/e2e-feature-tests/src/index.ts`
- Create: `libs/e2e-feature-tests/jest.global-teardown.ts`
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Create `project.json`**

Write `libs/e2e-feature-tests/project.json`:

```json
{
  "name": "e2e-feature-tests",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/e2e-feature-tests/src",
  "projectType": "library",
  "targets": {
    "test-e2e-features": {
      "executor": "@nx/jest:jest",
      "options": {
        "jestConfig": "libs/e2e-feature-tests/jest.config.js",
        "passWithNoTests": true,
        "runInBand": true
      }
    },
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  },
  "tags": ["scope:platform", "type:lib"]
}
```

- [ ] **Step 2: Create `tsconfig.json`**

Write `libs/e2e-feature-tests/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ES2022",
    "target": "ES2022",
    "outDir": "../../dist/libs/e2e-feature-tests",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create `tsconfig.spec.json`**

Write `libs/e2e-feature-tests/tsconfig.spec.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "jest.global-teardown.ts"]
}
```

- [ ] **Step 4: Create `jest.config.js`**

Write `libs/e2e-feature-tests/jest.config.js`:

```js
const preset = require('../../jest.preset');
module.exports = {
  ...preset,
  displayName: 'e2e-feature-tests',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e.test.ts'],
  testTimeout: 300_000,
  maxWorkers: 1,
  globalTeardown: '<rootDir>/jest.global-teardown.ts',
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
  },
  coverageThreshold: undefined,
  collectCoverageFrom: undefined,
};
```

- [ ] **Step 5: Create a minimal `src/index.ts` placeholder**

Write `libs/e2e-feature-tests/src/index.ts`:

```ts
// Helper surface for the e2e feature test suite. Populated by Tasks 4–9.
export {};
```

- [ ] **Step 6: Create a minimal `jest.global-teardown.ts` stub**

Write `libs/e2e-feature-tests/jest.global-teardown.ts`:

```ts
// Populated by Task 9 to invoke alpacaPaperReset() at end of suite.
export default async function globalTeardown(): Promise<void> {
  // no-op until alpaca-paper-reset helper is implemented
}
```

- [ ] **Step 7: Wire the path alias in `tsconfig.base.json`**

Open `tsconfig.base.json` and find the `paths` section. Insert **after** the existing `@nestfolio/integration-testing/*` entry (currently line 59):

```json
      "@nestfolio/e2e-feature-tests": ["libs/e2e-feature-tests/src/index.ts"],
      "@nestfolio/e2e-feature-tests/*": ["libs/e2e-feature-tests/src/*"],
```

The surrounding block should now read:

```json
      "@nestfolio/integration-testing": ["libs/integration-testing/src/index.ts"],
      "@nestfolio/integration-testing/*": ["libs/integration-testing/src/*"],
      "@nestfolio/e2e-feature-tests": ["libs/e2e-feature-tests/src/index.ts"],
      "@nestfolio/e2e-feature-tests/*": ["libs/e2e-feature-tests/src/*"],
      "@nestfolio/ui": ["libs/ui/src/index.ts"]
```

- [ ] **Step 8: Verify Nx recognizes the new project**

Run: `pnpm nx show project e2e-feature-tests --json`

Expected: JSON output that includes `"name": "e2e-feature-tests"`, `"sourceRoot": "libs/e2e-feature-tests/src"`, and a `targets.test-e2e-features` entry. No error.

- [ ] **Step 9: Verify the suite runs (empty)**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features`

Expected: Jest reports "No tests found" and exits successfully because `passWithNoTests: true`. Output includes the displayName `e2e-feature-tests`.

- [ ] **Step 10: Commit the scaffold**

```bash
git add libs/e2e-feature-tests tsconfig.base.json
git commit -m "$(cat <<'EOF'
feat(e2e-feature-tests): scaffold Nx library

Empty library wired to pnpm nx run e2e-feature-tests:test-e2e-features.
maxWorkers 1, 5 min per-test timeout, globalTeardown stub. Path alias
added to tsconfig.base.json.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Helper — `fresh-tenant.ts`

**Files:**
- Create: `libs/e2e-feature-tests/src/helpers/fresh-tenant.ts`
- Create: `libs/e2e-feature-tests/test/helpers/fresh-tenant.test.ts`
- Modify: `libs/e2e-feature-tests/src/index.ts`

- [ ] **Step 1: Write failing unit test**

Create `libs/e2e-feature-tests/test/helpers/fresh-tenant.test.ts`:

```ts
jest.mock('@nestfolio/integration-testing', () => ({
  CognitoFixture: jest.fn().mockImplementation(() => ({
    setup: jest.fn().mockResolvedValue({
      idToken: 'header.' + Buffer.from(JSON.stringify({ sub: 'cog-sub-xyz' })).toString('base64url') + '.sig',
      accessToken: 'access',
    }),
  })),
}));

import { freshTenant } from '../../src/helpers/fresh-tenant';
import { CognitoFixture } from '@nestfolio/integration-testing';

describe('freshTenant', () => {
  it('creates a tenant, a cognito user, extracts sub as userId, returns tokens', async () => {
    const ctx = { tenantId: 'tenant-aaa', region: 'us-east-1' } as any;

    const tenant = await freshTenant(ctx);

    expect(CognitoFixture).toHaveBeenCalledWith(ctx);
    expect(tenant.tenantId).toBe('tenant-aaa');
    expect(tenant.userId).toBe('cog-sub-xyz');
    expect(tenant.idToken).toContain('header.');
    expect(tenant.accessToken).toBe('access');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=fresh-tenant`

Expected: FAIL with "Cannot find module '../../src/helpers/fresh-tenant'".

- [ ] **Step 3: Implement `fresh-tenant.ts`**

Create `libs/e2e-feature-tests/src/helpers/fresh-tenant.ts`:

```ts
import {
  CognitoFixture,
  type CognitoTokens,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

export interface FreshTenant {
  tenantId: string;
  userId: string;
  idToken: string;
  accessToken: string;
  cognitoTokens: CognitoTokens;
}

/**
 * Create a fresh Cognito user bound to the context's tenantId. The Cognito
 * `sub` claim becomes `userId`, matching the convention used by AppSync
 * resolvers throughout the codebase.
 */
export async function freshTenant(ctx: IntegrationContext): Promise<FreshTenant> {
  const cognito = new CognitoFixture(ctx);
  const tokens = await cognito.setup();

  const payload = JSON.parse(
    Buffer.from(tokens.idToken.split('.')[1], 'base64url').toString(),
  ) as { sub: string };

  return {
    tenantId: ctx.tenantId,
    userId: payload.sub,
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    cognitoTokens: tokens,
  };
}
```

- [ ] **Step 4: Re-export from `src/index.ts`**

Replace the contents of `libs/e2e-feature-tests/src/index.ts` with:

```ts
export { freshTenant, type FreshTenant } from './helpers/fresh-tenant';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=fresh-tenant`

Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add libs/e2e-feature-tests/src/helpers/fresh-tenant.ts \
         libs/e2e-feature-tests/test/helpers/fresh-tenant.test.ts \
         libs/e2e-feature-tests/src/index.ts
git commit -m "$(cat <<'EOF'
feat(e2e-feature-tests): add freshTenant helper

Wraps CognitoFixture.setup() and extracts the Cognito sub as userId so
test fixtures can key events at the same pk AppSync resolvers use.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Helper — `wait-for-graphql.ts`

**Files:**
- Create: `libs/e2e-feature-tests/src/helpers/wait-for-graphql.ts`
- Create: `libs/e2e-feature-tests/test/helpers/wait-for-graphql.test.ts`
- Modify: `libs/e2e-feature-tests/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `libs/e2e-feature-tests/test/helpers/wait-for-graphql.test.ts`:

```ts
import { waitForGraphQL } from '../../src/helpers/wait-for-graphql';

describe('waitForGraphQL', () => {
  const QUERY = 'query X { dummy { n } }';

  it('returns the first result that satisfies the predicate', async () => {
    let calls = 0;
    const client = {
      query: jest.fn(async () => ({ dummy: { n: ++calls } })),
    };

    const result = await waitForGraphQL<{ dummy: { n: number } }>(
      client as any,
      QUERY,
      { id: 'x' },
      (r) => r.dummy.n >= 3,
      { timeoutMs: 5_000, intervalMs: 10 },
    );

    expect(result.dummy.n).toBe(3);
    expect(client.query).toHaveBeenCalledWith(QUERY, { id: 'x' });
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it('throws if the predicate never succeeds within timeoutMs', async () => {
    const client = { query: jest.fn(async () => ({ dummy: { n: 0 } })) };

    await expect(waitForGraphQL<{ dummy: { n: number } }>(
      client as any,
      QUERY,
      {},
      (r) => r.dummy.n > 5,
      { timeoutMs: 50, intervalMs: 10 },
    )).rejects.toThrow(/timed out/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=wait-for-graphql`

Expected: FAIL with "Cannot find module '../../src/helpers/wait-for-graphql'".

- [ ] **Step 3: Implement `wait-for-graphql.ts`**

Create `libs/e2e-feature-tests/src/helpers/wait-for-graphql.ts`:

```ts
import type { AppSyncClient } from '@nestfolio/integration-testing';

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

/**
 * Poll a GraphQL query until `predicate(result) === true` or timeout.
 * Defaults: 60 s timeout, 2 s interval. Used for every assertion that
 * depends on CDC -> read-model projection lag.
 */
export async function waitForGraphQL<T>(
  client: AppSyncClient,
  operation: string,
  variables: Record<string, unknown>,
  predicate: (result: T) => boolean,
  opts: WaitOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await client.query<T>(operation, variables);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `waitForGraphQL timed out after ${timeoutMs}ms. Last result: ${JSON.stringify(last)}`,
  );
}
```

- [ ] **Step 4: Re-export from `src/index.ts`**

Open `libs/e2e-feature-tests/src/index.ts` and append:

```ts
export { waitForGraphQL, type WaitOptions } from './helpers/wait-for-graphql';
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=wait-for-graphql`

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add libs/e2e-feature-tests/src/helpers/wait-for-graphql.ts \
         libs/e2e-feature-tests/test/helpers/wait-for-graphql.test.ts \
         libs/e2e-feature-tests/src/index.ts
git commit -m "$(cat <<'EOF'
feat(e2e-feature-tests): add waitForGraphQL polling helper

Polls a GraphQL query until predicate satisfied or timeout. 60s default
timeout, 2s interval. Used by every read-side assertion in the suite.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Helper — `bff-client.ts`

**Files:**
- Create: `libs/e2e-feature-tests/src/helpers/bff-client.ts`
- Create: `libs/e2e-feature-tests/test/helpers/bff-client.test.ts`
- Modify: `libs/e2e-feature-tests/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `libs/e2e-feature-tests/test/helpers/bff-client.test.ts`:

```ts
const mockInstances: Array<{ service: string }> = [];
jest.mock('@nestfolio/integration-testing', () => ({
  AppSyncClient: jest.fn().mockImplementation((_ctx: unknown, _tokens: unknown, service: string) => {
    const instance = { service, query: jest.fn(), mutate: jest.fn() };
    mockInstances.push(instance);
    return instance;
  }),
}));

import { bffClient } from '../../src/helpers/bff-client';
import { AppSyncClient } from '@nestfolio/integration-testing';

describe('bffClient', () => {
  beforeEach(() => {
    mockInstances.length = 0;
    (AppSyncClient as unknown as jest.Mock).mockClear();
  });

  it('constructs one AppSyncClient per BFF service', () => {
    const ctx = {} as any;
    const tenant = {
      tenantId: 't',
      userId: 'u',
      idToken: 'id',
      accessToken: 'acc',
      cognitoTokens: { idToken: 'id', accessToken: 'acc' },
    } as any;

    const bff = bffClient(ctx, tenant);

    expect(bff.investor).toBeDefined();
    expect(bff.advisory).toBeDefined();
    expect(bff.ledger).toBeDefined();
    expect(bff.dashboard).toBeDefined();
    expect(AppSyncClient).toHaveBeenCalledTimes(4);
    expect(mockInstances.map((i) => i.service).sort()).toEqual([
      'advisory-bff',
      'dashboard-bff',
      'investor-bff',
      'ledger-bff',
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=bff-client`

Expected: FAIL with "Cannot find module '../../src/helpers/bff-client'".

- [ ] **Step 3: Implement `bff-client.ts`**

Create `libs/e2e-feature-tests/src/helpers/bff-client.ts`:

```ts
import {
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import type { FreshTenant } from './fresh-tenant';

export interface BffClients {
  investor: AppSyncClient;
  advisory: AppSyncClient;
  ledger: AppSyncClient;
  dashboard: AppSyncClient;
}

/**
 * Construct an AppSyncClient per BFF service, all authenticated with the
 * same Cognito tokens from the given tenant. Thin — does not hide anything.
 */
export function bffClient(ctx: IntegrationContext, tenant: FreshTenant): BffClients {
  return {
    investor: new AppSyncClient(ctx, tenant.cognitoTokens, 'investor-bff'),
    advisory: new AppSyncClient(ctx, tenant.cognitoTokens, 'advisory-bff'),
    ledger: new AppSyncClient(ctx, tenant.cognitoTokens, 'ledger-bff'),
    dashboard: new AppSyncClient(ctx, tenant.cognitoTokens, 'dashboard-bff'),
  };
}
```

- [ ] **Step 4: Re-export from `src/index.ts`**

Append to `libs/e2e-feature-tests/src/index.ts`:

```ts
export { bffClient, type BffClients } from './helpers/bff-client';
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=bff-client`

Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add libs/e2e-feature-tests/src/helpers/bff-client.ts \
         libs/e2e-feature-tests/test/helpers/bff-client.test.ts \
         libs/e2e-feature-tests/src/index.ts
git commit -m "$(cat <<'EOF'
feat(e2e-feature-tests): add bffClient fan-out helper

Constructs one authenticated AppSyncClient per BFF (investor, advisory,
ledger, dashboard) so tests can round-trip reads against any read-side.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Helper — `fixtures.ts` (onboarded)

**Files:**
- Create: `libs/e2e-feature-tests/src/helpers/fixtures.ts`
- Create: `libs/e2e-feature-tests/test/helpers/fixtures.test.ts`
- Modify: `libs/e2e-feature-tests/src/index.ts`

- [ ] **Step 1: Write failing test for `onboarded()`**

Create `libs/e2e-feature-tests/test/helpers/fixtures.test.ts`:

```ts
jest.mock('@nestfolio/integration-testing', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    putEvent: jest.fn().mockResolvedValue(undefined),
  })),
}));

import {
  onboarded,
  applyFixtures,
} from '../../src/helpers/fixtures';
import { EventBridgeClient } from '@nestfolio/integration-testing';

describe('fixtures — onboarded', () => {
  it('publishes USER_REGISTERED then ONBOARDING_COMPLETED to the investor bus', async () => {
    const ctx = { tenantId: 'tenant-1', region: 'us-east-1' } as any;
    const tenant = { tenantId: 'tenant-1', userId: 'user-1', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    await applyFixtures(ctx, tenant, [onboarded()]);

    expect(eb.putEvent).toHaveBeenCalledTimes(2);
    expect(eb.putEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'USER_REGISTERED',
      detail: expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
    }));
    expect(eb.putEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'ONBOARDING_COMPLETED',
      detail: expect.objectContaining({
        tenantId: 'tenant-1',
        userId: 'user-1',
        operatingMode: 'BALANCED',
        mandateAccepted: true,
      }),
    }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=fixtures`

Expected: FAIL with "Cannot find module '../../src/helpers/fixtures'".

- [ ] **Step 3: Implement `fixtures.ts` (onboarded + applyFixtures)**

Create `libs/e2e-feature-tests/src/helpers/fixtures.ts`:

```ts
import {
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import { InvestorBffEventTypes } from '../../../../services/investor/investor-bff/src/domain/events';
import { ReconciliationEventTypes } from '../../../../services/ledger/reconciliation-ctrl/src/domain/events';
import type { FreshTenant } from './fresh-tenant';

/**
 * A Fixture is an async function that publishes whatever events are needed
 * to bring a fresh tenant to a specific observable precondition.
 */
export type Fixture = (
  ctx: IntegrationContext,
  tenant: FreshTenant,
  eb: EventBridgeClient,
) => Promise<FixtureResult>;

export interface FixtureResult {
  // Populated by fixtures that return identifiers (decisionId, depositId, etc.)
  [key: string]: unknown;
}

export async function applyFixtures(
  ctx: IntegrationContext,
  tenant: FreshTenant,
  fixtures: Fixture[],
): Promise<FixtureResult> {
  const eb = new EventBridgeClient(ctx);
  const merged: FixtureResult = {};
  for (const fixture of fixtures) {
    const result = await fixture(ctx, tenant, eb);
    Object.assign(merged, result);
  }
  return merged;
}

/**
 * Seeds the minimum viable onboarded state:
 *   1. USER_REGISTERED  — materializes InvestorProfile (required by ONBOARDING_COMPLETED's ConditionExpression)
 *   2. ONBOARDING_COMPLETED — materializes Goal, RiskProfile, Mandate, OperatingMode, AccountMode, Deposit
 *
 * Matches the seeding chain used by services/investor/investor-bff/test/integration/.
 */
export function onboarded(overrides?: {
  operatingMode?: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
  capitalAmount?: number;
  currency?: string;
}): Fixture {
  return async (_ctx, tenant, eb) => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: InvestorBffEventTypes.USER_REGISTERED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        email: `${tenant.userId}@integ-e2e.example`,
      },
    });
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: InvestorBffEventTypes.ONBOARDING_COMPLETED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        goal: { objective: 'GROWTH' },
        horizonYears: 10,
        accountMode: 'simulation',
        capitalAmount: overrides?.capitalAmount ?? 100_000,
        currency: overrides?.currency ?? 'USD',
        riskTolerance: 7,
        riskExperience: 5,
        operatingMode: overrides?.operatingMode ?? 'BALANCED',
        mandateAccepted: true,
      },
    });
    return {};
  };
}
```

- [ ] **Step 4: Re-export from `src/index.ts`**

Append to `libs/e2e-feature-tests/src/index.ts`:

```ts
export {
  applyFixtures,
  onboarded,
  type Fixture,
  type FixtureResult,
} from './helpers/fixtures';
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=fixtures`

Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add libs/e2e-feature-tests/src/helpers/fixtures.ts \
         libs/e2e-feature-tests/test/helpers/fixtures.test.ts \
         libs/e2e-feature-tests/src/index.ts
git commit -m "$(cat <<'EOF'
feat(e2e-feature-tests): add applyFixtures + onboarded fixture

First of five fixtures. Composes USER_REGISTERED and ONBOARDING_COMPLETED
in order so a fresh tenant reaches the observable state every downstream
scenario requires. Uses typed event-name constants from
InvestorBffEventTypes.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Fixture — `funded()`

**Files:**
- Modify: `libs/e2e-feature-tests/src/helpers/fixtures.ts`
- Modify: `libs/e2e-feature-tests/test/helpers/fixtures.test.ts`

- [ ] **Step 1: Add failing test for `funded()`**

Append to `libs/e2e-feature-tests/test/helpers/fixtures.test.ts` (inside the existing `describe('fixtures — onboarded', ...)` file, as a new top-level `describe`):

```ts
import { funded } from '../../src/helpers/fixtures';

describe('fixtures — funded', () => {
  it('publishes BALANCE_UPDATED with the requested cashBalanceCents', async () => {
    const ctx = { tenantId: 't-2' } as any;
    const tenant = { tenantId: 't-2', userId: 'u-2', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    await applyFixtures(ctx, tenant, [funded({ cashBalanceCents: 2_500_000 })]);

    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'BALANCE_UPDATED',
      detail: expect.objectContaining({
        tenantId: 't-2',
        userId: 'u-2',
        cashBalanceCents: 2_500_000,
      }),
    }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=fixtures`

Expected: FAIL — `funded` is not exported.

- [ ] **Step 3: Implement `funded()`**

Append to `libs/e2e-feature-tests/src/helpers/fixtures.ts` below the `onboarded` function. Note: funding the read-side `CashBalance` row is driven by `BALANCE_UPDATED` (investor-bff materializes it on the `InvestorProfile#{tenant}#{user}` pk, as seen in `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts:82-107`). That's the earliest observable state a "funded" tenant needs.

```ts
/**
 * Seeds cash balance by publishing BALANCE_UPDATED. That event materializes
 * the CashBalance row at pk=InvestorProfile#{tenantId}#{userId}, which
 * requestWithdrawal's ConditionExpression depends on.
 */
export function funded(opts: { cashBalanceCents: number }): Fixture {
  return async (_ctx, tenant, eb) => {
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'BALANCE_UPDATED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        cashBalanceCents: opts.cashBalanceCents,
      },
    });
    return {};
  };
}
```

- [ ] **Step 4: Re-export `funded` from `src/index.ts`**

Update the existing fixtures export in `libs/e2e-feature-tests/src/index.ts` to:

```ts
export {
  applyFixtures,
  onboarded,
  funded,
  type Fixture,
  type FixtureResult,
} from './helpers/fixtures';
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=fixtures`

Expected: PASS (2 tests now).

- [ ] **Step 6: Commit**

```bash
git add libs/e2e-feature-tests/src/helpers/fixtures.ts \
         libs/e2e-feature-tests/test/helpers/fixtures.test.ts \
         libs/e2e-feature-tests/src/index.ts
git commit -m "$(cat <<'EOF'
feat(e2e-feature-tests): add funded fixture

Seeds CashBalance at pk=InvestorProfile#{tenant}#{user} via BALANCE_UPDATED
so withdrawal scenarios pass the ConditionExpression on requestWithdrawal.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Fixtures — `withDecision()`, `withNotification()`, `withHoldings()`

**Files:**
- Modify: `libs/e2e-feature-tests/src/helpers/fixtures.ts`
- Modify: `libs/e2e-feature-tests/test/helpers/fixtures.test.ts`
- Modify: `libs/e2e-feature-tests/src/index.ts`

- [ ] **Step 1: Write failing tests for all three**

Append to `libs/e2e-feature-tests/test/helpers/fixtures.test.ts`:

```ts
import { withDecision, withNotification, withHoldings } from '../../src/helpers/fixtures';

describe('fixtures — withDecision', () => {
  it('publishes DECISION_PACKET_CREATED to the advisory bus and returns decisionId', async () => {
    const ctx = {} as any;
    const tenant = { tenantId: 't-3', userId: 'u-3', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    const result = await applyFixtures(ctx, tenant, [
      withDecision({ trigger: 'INITIAL_ALLOCATION' }),
    ]);

    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'advisory',
      targetService: 'advisory-bff',
      detailType: 'DECISION_PACKET_CREATED',
      detail: expect.objectContaining({
        tenantId: 't-3',
        trigger: 'INITIAL_ALLOCATION',
        confirmationRequired: true,
      }),
    }));
    expect(typeof result.decisionId).toBe('string');
    expect((result.decisionId as string).startsWith('e2e-decision-')).toBe(true);
  });
});

describe('fixtures — withNotification', () => {
  it('publishes NOTIFICATION_CREATED to the investor bus and returns notificationId', async () => {
    const ctx = {} as any;
    const tenant = { tenantId: 't-4', userId: 'u-4', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    const result = await applyFixtures(ctx, tenant, [
      withNotification({ title: 'hello', body: 'world' }),
    ]);

    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: 'NOTIFICATION_CREATED',
      detail: expect.objectContaining({
        tenantId: 't-4',
        userId: 'u-4',
        title: 'hello',
        body: 'world',
        channel: 'IN_APP',
      }),
    }));
    expect(typeof result.notificationId).toBe('string');
  });
});

describe('fixtures — withHoldings', () => {
  it('publishes one ORDER_FILLED per holding on the execution bus', async () => {
    const ctx = {} as any;
    const tenant = { tenantId: 't-5', userId: 'u-5', idToken: '', accessToken: '', cognitoTokens: {} as any };
    const eb = { putEvent: jest.fn().mockResolvedValue(undefined) };
    (EventBridgeClient as unknown as jest.Mock).mockImplementation(() => eb);

    await applyFixtures(ctx, tenant, [
      withHoldings([
        { symbol: 'AAPL', quantity: 10, fillPriceCents: 15_000 },
        { symbol: 'GOOG', quantity: 3, fillPriceCents: 140_000 },
      ]),
    ]);

    expect(eb.putEvent).toHaveBeenCalledTimes(2);
    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'execution',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: expect.objectContaining({ symbol: 'AAPL', quantity: 10, fillPriceCents: 15_000 }),
    }));
    expect(eb.putEvent).toHaveBeenCalledWith(expect.objectContaining({
      bus: 'execution',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: expect.objectContaining({ symbol: 'GOOG', quantity: 3, fillPriceCents: 140_000 }),
    }));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=fixtures`

Expected: FAIL — the three new symbols are not exported.

- [ ] **Step 3: Implement `withDecision`, `withNotification`, `withHoldings`**

Append to `libs/e2e-feature-tests/src/helpers/fixtures.ts`:

```ts
import { AdvisoryCtrlEventTypes } from '../../../../services/advisory/advisory-ctrl/src/domain/events';
import { InvestorCtrlEventTypes } from '../../../../services/investor/investor-ctrl/src/domain/events';

/**
 * Seeds a PENDING decision read-model on advisory-bff by publishing a
 * synthetic DECISION_PACKET_CREATED. Returns the generated decisionId so
 * scenarios can reference it in confirmDecision/rejectDecision mutations.
 */
export function withDecision(opts: {
  trigger: 'INITIAL_ALLOCATION' | 'REBALANCE' | 'ADJUSTMENT';
  proposedTrades?: Array<{ symbol: string; side: 'BUY' | 'SELL'; quantityOrAmountCents: number }>;
  explanation?: string;
}): Fixture {
  return async (_ctx, tenant, eb) => {
    const decisionId = `e2e-decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await eb.putEvent({
      bus: 'advisory',
      targetService: 'advisory-bff',
      detailType: AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED,
      detail: {
        tenantId: tenant.tenantId,
        decisionId,
        trigger: opts.trigger,
        proposedTrades: opts.proposedTrades ?? [
          { symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500_000 },
        ],
        explanation: opts.explanation ?? 'E2E test synthetic decision',
        confirmationRequired: true,
      },
    });
    return { decisionId };
  };
}

/**
 * Seeds a CREATED notification on investor-bff by publishing a synthetic
 * NOTIFICATION_CREATED. Returns the generated notificationId.
 */
export function withNotification(opts: {
  title: string;
  body: string;
  channel?: 'IN_APP' | 'EMAIL' | 'PUSH' | 'SMS';
  relatedEntityType?: string;
  relatedEntityId?: string;
}): Fixture {
  return async (_ctx, tenant, eb) => {
    const notificationId = `e2e-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await eb.putEvent({
      bus: 'investor',
      targetService: 'investor-bff',
      detailType: InvestorCtrlEventTypes.NOTIFICATION_CREATED,
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        notificationId,
        channel: opts.channel ?? 'IN_APP',
        title: opts.title,
        body: opts.body,
        relatedEntityType: opts.relatedEntityType ?? 'System',
        relatedEntityId: opts.relatedEntityId ?? 'system',
      },
    });
    return { notificationId };
  };
}

/**
 * Seeds portfolio holdings by publishing one synthetic ORDER_FILLED per
 * holding on the execution bus. The ledger-ctrl reducer projects these
 * into the ledger-bff read model (Portfolio / Positions).
 */
export function withHoldings(
  holdings: Array<{ symbol: string; quantity: number; fillPriceCents: number }>,
): Fixture {
  return async (_ctx, tenant, eb) => {
    for (const h of holdings) {
      await eb.putEvent({
        bus: 'execution',
        targetService: 'ledger-ctrl',
        detailType: 'ORDER_FILLED',
        detail: {
          tenantId: tenant.tenantId,
          userId: tenant.userId,
          orderId: `e2e-order-${h.symbol}-${Date.now()}`,
          symbol: h.symbol,
          quantity: h.quantity,
          fillPriceCents: h.fillPriceCents,
          side: 'BUY',
        },
      });
    }
    return {};
  };
}
```

- [ ] **Step 4: Re-export from `src/index.ts`**

Update the fixtures export in `libs/e2e-feature-tests/src/index.ts` to:

```ts
export {
  applyFixtures,
  onboarded,
  funded,
  withDecision,
  withNotification,
  withHoldings,
  type Fixture,
  type FixtureResult,
} from './helpers/fixtures';
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=fixtures`

Expected: PASS (5 tests total now).

- [ ] **Step 6: Commit**

```bash
git add libs/e2e-feature-tests/src/helpers/fixtures.ts \
         libs/e2e-feature-tests/test/helpers/fixtures.test.ts \
         libs/e2e-feature-tests/src/index.ts
git commit -m "$(cat <<'EOF'
feat(e2e-feature-tests): add withDecision, withNotification, withHoldings

Completes the fixture set. withDecision and withNotification return their
generated IDs so scenarios can reference them in mutations; withHoldings
seeds portfolio state via synthetic ORDER_FILLED events on the execution
bus. All three use typed event-name constants.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Helper — `alpaca-paper-reset.ts` + `globalTeardown`

**Files:**
- Create: `libs/e2e-feature-tests/src/helpers/alpaca-paper-reset.ts`
- Create: `libs/e2e-feature-tests/test/helpers/alpaca-paper-reset.test.ts`
- Modify: `libs/e2e-feature-tests/jest.global-teardown.ts`
- Modify: `libs/e2e-feature-tests/src/index.ts`

- [ ] **Step 1: Write failing test for the safety assertion**

Create `libs/e2e-feature-tests/test/helpers/alpaca-paper-reset.test.ts`:

```ts
const mockFetch = jest.fn() as jest.Mock & typeof fetch;
global.fetch = mockFetch;

jest.mock('@aws-sdk/client-ssm', () => {
  const send = jest.fn();
  return {
    SSMClient: jest.fn().mockImplementation(() => ({ send, destroy: jest.fn() })),
    GetParameterCommand: jest.fn().mockImplementation((args) => ({ __cmd: 'GetParameter', ...args })),
    __mockSend: send,
  };
});

jest.mock('@aws-sdk/client-secrets-manager', () => {
  const send = jest.fn();
  return {
    SecretsManagerClient: jest.fn().mockImplementation(() => ({ send, destroy: jest.fn() })),
    GetSecretValueCommand: jest.fn().mockImplementation((args) => ({ __cmd: 'GetSecretValue', ...args })),
    __mockSend: send,
  };
});

import { alpacaPaperReset } from '../../src/helpers/alpaca-paper-reset';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ssmMod = require('@aws-sdk/client-ssm');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const smMod = require('@aws-sdk/client-secrets-manager');

describe('alpacaPaperReset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses to run if the resolved baseUrl is not in the paper allowlist', async () => {
    ssmMod.__mockSend.mockResolvedValueOnce({ Parameter: { Value: 'https://api.alpaca.markets' } });
    smMod.__mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify({ apiKeyId: 'k', apiKeySecret: 's' }) });

    await expect(alpacaPaperReset('dev')).rejects.toThrow(/not in the paper allowlist/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('issues DELETE /v2/orders and DELETE /v2/positions when baseUrl is paper', async () => {
    ssmMod.__mockSend.mockResolvedValueOnce({ Parameter: { Value: 'https://paper-api.alpaca.markets' } });
    smMod.__mockSend.mockResolvedValueOnce({ SecretString: JSON.stringify({ apiKeyId: 'k', apiKeySecret: 's' }) });
    mockFetch.mockResolvedValue({ status: 207, json: async () => [] } as any);

    await alpacaPaperReset('dev');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/orders',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://paper-api.alpaca.markets/v2/positions?cancel_orders=true',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=alpaca-paper-reset`

Expected: FAIL with "Cannot find module '../../src/helpers/alpaca-paper-reset'".

- [ ] **Step 3: Implement `alpaca-paper-reset.ts`**

Create `libs/e2e-feature-tests/src/helpers/alpaca-paper-reset.ts`:

```ts
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const PAPER_ALLOWLIST = new Set(['https://paper-api.alpaca.markets']);

export interface AlpacaResetOptions {
  region?: string;
}

/**
 * Jest globalTeardown helper: wipes open orders + positions in the paper
 * Alpaca account for the given prefix. Refuses to touch anything outside
 * the paper allowlist. Reuses the adapter's own SSM param + secret names.
 */
export async function alpacaPaperReset(
  prefix: string,
  opts: AlpacaResetOptions = {},
): Promise<void> {
  const region = opts.region ?? process.env.AWS_REGION ?? 'us-east-1';
  const ssm = new SSMClient({ region });
  const sm = new SecretsManagerClient({ region });

  try {
    const paramName = `/nestfolio/${prefix}-broker-alpaca-adpt/alpaca/baseUrl`;
    const secretId = `${prefix}-broker-alpaca-adpt/alpaca-api-keys`;

    const paramRes = await ssm.send(new GetParameterCommand({ Name: paramName }));
    const baseUrl = paramRes.Parameter?.Value;
    if (!baseUrl) throw new Error(`alpacaPaperReset: SSM parameter ${paramName} not found`);

    if (!PAPER_ALLOWLIST.has(baseUrl)) {
      throw new Error(
        `alpacaPaperReset: refusing to run — resolved baseUrl '${baseUrl}' is not in the paper allowlist.`,
      );
    }

    const secretRes = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
    if (!secretRes.SecretString) throw new Error(`alpacaPaperReset: secret ${secretId} empty`);
    const keys = JSON.parse(secretRes.SecretString) as { apiKeyId: string; apiKeySecret: string };

    const headers = {
      'APCA-API-KEY-ID': keys.apiKeyId,
      'APCA-API-SECRET-KEY': keys.apiKeySecret,
      'Content-Type': 'application/json',
    };

    await fetch(`${baseUrl}/v2/orders`, { method: 'DELETE', headers });
    await fetch(`${baseUrl}/v2/positions?cancel_orders=true`, { method: 'DELETE', headers });
  } finally {
    ssm.destroy();
    sm.destroy();
  }
}
```

- [ ] **Step 4: Wire `globalTeardown`**

Replace `libs/e2e-feature-tests/jest.global-teardown.ts` with:

```ts
import { alpacaPaperReset } from './src/helpers/alpaca-paper-reset';

export default async function globalTeardown(): Promise<void> {
  const prefix = process.env.NESTFOLIO_INTEG_PREFIX ?? 'dev';
  try {
    await alpacaPaperReset(prefix);
    // eslint-disable-next-line no-console
    console.log(`[globalTeardown] alpacaPaperReset OK (prefix=${prefix})`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[globalTeardown] alpacaPaperReset FAILED (prefix=${prefix}):`, err);
    // Do not fail the suite on teardown errors — surface and continue.
  }
}
```

- [ ] **Step 5: Re-export from `src/index.ts`**

Append to `libs/e2e-feature-tests/src/index.ts`:

```ts
export { alpacaPaperReset } from './helpers/alpaca-paper-reset';
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=alpaca-paper-reset`

Expected: PASS (2 tests).

Then run the full unit suite for the library to confirm all helper tests still pass and globalTeardown runs without error:

Run: `pnpm nx run e2e-feature-tests:test-e2e-features`

Expected: All helper tests PASS (fresh-tenant, wait-for-graphql, bff-client, fixtures, alpaca-paper-reset). globalTeardown executes and logs either an OK line or a FAILED line (in unit test mode the SSM call will fail — that's acceptable because it's caught). Exit code 0.

- [ ] **Step 7: Commit**

```bash
git add libs/e2e-feature-tests/src/helpers/alpaca-paper-reset.ts \
         libs/e2e-feature-tests/test/helpers/alpaca-paper-reset.test.ts \
         libs/e2e-feature-tests/jest.global-teardown.ts \
         libs/e2e-feature-tests/src/index.ts
git commit -m "$(cat <<'EOF'
feat(e2e-feature-tests): add alpacaPaperReset + wire globalTeardown

Reuses the adapter's own SSM baseUrl param + secret to fire blanket
DELETE /v2/orders and DELETE /v2/positions against the paper endpoint at
end of suite. Refuses to run if baseUrl isn't in the paper allowlist.
Suite teardown swallows errors so setup failures don't mask test results.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Scenario tasks (10–22) — Important reading

Each scenario task writes one `.e2e.test.ts` file that hits the real deployed sandbox. Unlike the helper tasks, these don't follow strict red-green TDD — you write the full file, run it against dev (or another `NESTFOLIO_INTEG_PREFIX`), fix anything that breaks, and commit once it's green. Each task's "run to verify" step is a full e2e run against the live sandbox.

**Precondition for every scenario task:** the dev sandbox must be deployed and `dev-broker-alpaca-adpt/alpaca-api-keys` + `/nestfolio/dev-broker-alpaca-adpt/alpaca/baseUrl` must be populated with paper credentials + `https://paper-api.alpaca.markets` (spec section 8).

**Command template used in every scenario task's verification step:**

```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=<path-fragment>
```

---

## Task 10: Scenario 1 — Fund account

**Files:**
- Create: `libs/e2e-feature-tests/test/funding/fund-account.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/funding/fund-account.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 1 — investor funds their account', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('initiateDeposit surfaces a pending deposit on the dashboard + activity feed', async () => {
    const bff = bffClient(ctx, tenant);

    // TRIGGER: mutation
    const deposit = await bff.investor.mutate<{
      initiateDeposit: { depositId: string; amountCents: number; currency: string; status: string; initiatedAt: string };
    }>(
      `mutation InitiateDeposit($input: DepositInput!) {
         initiateDeposit(input: $input) {
           depositId
           amountCents
           currency
           status
           initiatedAt
         }
       }`,
      { input: { amountCents: 500_000, currency: 'USD' } },
    );

    expect(deposit.initiateDeposit.status).toBe('INITIATED');
    expect(deposit.initiateDeposit.amountCents).toBe(500_000);

    // ASSERT: activity feed eventually contains a deposit entry
    const dashboard = await waitForGraphQL<{
      getRecentActivity: Array<{ activityType: string; description: string; timestamp: string; metadata: string | null }>;
    }>(
      bff.dashboard,
      `query RecentActivity { getRecentActivity(limit: 20) { activityType description timestamp metadata } }`,
      {},
      (r) => r.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('DEPOSIT')),
      { timeoutMs: 90_000 },
    );
    expect(dashboard.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('DEPOSIT'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=fund-account`

Expected: PASS (1 test, may take up to 90 s while CDC projects). If the `DEPOSIT` activity entry doesn't surface, check CloudWatch logs for `dev-investor-bff-egress`, `dev-dashboard-bff-ingress` — do not attempt to "fix" the test by relaxing the predicate.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/funding/fund-account.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 1 — fund account

Initiates a deposit via investor-bff and asserts the activity feed on
dashboard-bff surfaces a deposit entry.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Scenario 2 — Withdraw cash

**Files:**
- Create: `libs/e2e-feature-tests/test/funding/withdraw-cash.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/funding/withdraw-cash.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 2 — investor withdraws cash', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
    ]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('requestWithdrawal surfaces a withdrawal entry on the activity feed', async () => {
    const bff = bffClient(ctx, tenant);

    const withdrawal = await bff.investor.mutate<{
      requestWithdrawal: { withdrawalId: string; amountCents: number; currency: string; status: string; requestedAt: string };
    }>(
      `mutation RequestWithdrawal($input: WithdrawalInput!) {
         requestWithdrawal(input: $input) {
           withdrawalId
           amountCents
           currency
           status
           requestedAt
         }
       }`,
      { input: { amountCents: 250_000, currency: 'USD' } },
    );

    expect(withdrawal.requestWithdrawal.status).toBe('REQUESTED');
    expect(withdrawal.requestWithdrawal.amountCents).toBe(250_000);

    const dashboard = await waitForGraphQL<{
      getRecentActivity: Array<{ activityType: string; description: string; timestamp: string; metadata: string | null }>;
    }>(
      bff.dashboard,
      `query RecentActivity { getRecentActivity(limit: 20) { activityType description timestamp metadata } }`,
      {},
      (r) => r.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('WITHDRAWAL')),
      { timeoutMs: 90_000 },
    );
    expect(dashboard.getRecentActivity.some((e) => e.activityType.toUpperCase().includes('WITHDRAWAL'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=withdraw-cash`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/funding/withdraw-cash.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 2 — withdraw cash

Seeds cash balance via funded fixture, requests a withdrawal, asserts
activity feed on dashboard-bff surfaces a withdrawal entry.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Scenario 3 — Update goal

**Files:**
- Create: `libs/e2e-feature-tests/test/profile/update-goal.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/profile/update-goal.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 3 — investor updates investment goal', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('updateGoal reflects new values in getGoals', async () => {
    const bff = bffClient(ctx, tenant);

    // Read the onboarded Goal so we have its ID.
    const initial = await waitForGraphQL<{
      getGoals: Array<{
        goalId: string;
        tenantId: string;
        objective: string;
        targetAmountCents: number;
        currency: string;
        timeHorizonMonths: number;
        targetReturn: number;
      }>;
    }>(
      bff.investor,
      `query Goals { getGoals { goalId tenantId objective targetAmountCents currency timeHorizonMonths targetReturn } }`,
      {},
      (r) => r.getGoals.length >= 1,
      { timeoutMs: 90_000 },
    );
    const goalId = initial.getGoals[0].goalId;

    const mutation = await bff.investor.mutate<{
      updateGoal: { goalId: string; objective: string; targetAmountCents: number; timeHorizonMonths: number; targetReturn: number };
    }>(
      `mutation UpdateGoal($goalId: ID!, $input: GoalInput!) {
         updateGoal(goalId: $goalId, input: $input) {
           goalId
           objective
           targetAmountCents
           currency
           timeHorizonMonths
           targetReturn
         }
       }`,
      {
        goalId,
        input: {
          objective: 'RETIREMENT',
          targetAmountCents: 10_000_000,
          currency: 'USD',
          timeHorizonMonths: 240,
          targetReturn: 0.065,
        },
      },
    );
    expect(mutation.updateGoal.objective).toBe('RETIREMENT');
    expect(mutation.updateGoal.targetAmountCents).toBe(10_000_000);

    // Read-back through the list query
    const readback = await waitForGraphQL<{
      getGoals: Array<{ goalId: string; objective: string; targetAmountCents: number }>;
    }>(
      bff.investor,
      `query Goals { getGoals { goalId objective targetAmountCents } }`,
      {},
      (r) => r.getGoals.some((g) => g.goalId === goalId && g.objective === 'RETIREMENT' && g.targetAmountCents === 10_000_000),
      { timeoutMs: 60_000 },
    );
    expect(readback.getGoals.find((g) => g.goalId === goalId)?.objective).toBe('RETIREMENT');
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=update-goal`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/profile/update-goal.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 3 — update goal

Onboards a tenant, reads goalId via getGoals, updates the goal, asserts
the change is readable through getGoals.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Scenario 4 — Update mandate

**Files:**
- Create: `libs/e2e-feature-tests/test/profile/update-mandate.e2e.test.ts`

Note: the investor-bff schema exposes no `getMandate` query — mandate state is only returned from the mutation itself. We assert by inspecting the mutation result and by running `revokeMandate` on the already-updated record to prove round-trip persistence (since `revokeMandate` also returns the full `Mandate!` including `effectiveDate` fields set during the update).

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/profile/update-mandate.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 4 — investor updates advisory mandate', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('updateMandate returns the new terms and persists across a second round trip', async () => {
    const bff = bffClient(ctx, tenant);

    const first = await bff.investor.mutate<{
      updateMandate: {
        mandateId: string;
        level: string;
        monthlyTurnoverCapPercent: number;
        maxSingleTradePercent: number;
        coolDownDays: number;
        rebalanceCadence: string;
        version: number;
      };
    }>(
      `mutation UpdateMandate($input: MandateInput!) {
         updateMandate(input: $input) {
           mandateId
           level
           monthlyTurnoverCapPercent
           maxSingleTradePercent
           coolDownDays
           rebalanceCadence
           version
         }
       }`,
      {
        input: {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 15,
          maxSingleTradePercent: 5,
          coolDownDays: 2,
          rebalanceCadence: 'MONTHLY',
        },
      },
    );
    expect(first.updateMandate.level).toBe('DISCRETIONARY');
    expect(first.updateMandate.rebalanceCadence).toBe('MONTHLY');
    expect(first.updateMandate.monthlyTurnoverCapPercent).toBe(15);

    // Second update on the same tenant proves the first persisted (version bumps, terms retained where unchanged).
    const second = await bff.investor.mutate<{
      updateMandate: { mandateId: string; level: string; coolDownDays: number; version: number };
    }>(
      `mutation UpdateMandate($input: MandateInput!) {
         updateMandate(input: $input) {
           mandateId
           level
           coolDownDays
           version
         }
       }`,
      {
        input: {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 15,
          maxSingleTradePercent: 5,
          coolDownDays: 3,
          rebalanceCadence: 'MONTHLY',
        },
      },
    );
    expect(second.updateMandate.mandateId).toBe(first.updateMandate.mandateId);
    expect(second.updateMandate.coolDownDays).toBe(3);
    expect(second.updateMandate.version).toBeGreaterThan(first.updateMandate.version);
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=update-mandate`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/profile/update-mandate.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 4 — update mandate

Two sequential updateMandate calls prove version bumps + field
persistence without needing a read query (investor-bff has no
getMandate).

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Scenario 5 — Revoke mandate

**Files:**
- Create: `libs/e2e-feature-tests/test/profile/revoke-mandate.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/profile/revoke-mandate.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 5 — investor revokes advisory mandate', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('revokeMandate returns a mandate with revokedAt set', async () => {
    const bff = bffClient(ctx, tenant);

    const result = await bff.investor.mutate<{
      revokeMandate: { mandateId: string; revokedAt: string | null; version: number };
    }>(
      `mutation RevokeMandate { revokeMandate { mandateId revokedAt version } }`,
      {},
    );

    expect(result.revokeMandate.mandateId).toBeTruthy();
    expect(result.revokeMandate.revokedAt).toBeTruthy();
    expect(new Date(result.revokeMandate.revokedAt as string).toString()).not.toBe('Invalid Date');
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=revoke-mandate`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/profile/revoke-mandate.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 5 — revoke mandate

Onboards a tenant, calls revokeMandate, asserts revokedAt is a valid
timestamp on the returned Mandate.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Scenario 6 — Accept decision (multi-step)

**Files:**
- Create: `libs/e2e-feature-tests/test/advisory/accept-decision.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/advisory/accept-decision.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withDecision,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 6 — investor accepts decision and sees it executed', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 1_000_000 }),
      withDecision({
        trigger: 'INITIAL_ALLOCATION',
        proposedTrades: [{ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 500_000 }],
      }),
    ]);
    decisionId = result.decisionId as string;
  }, 180_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('confirmed decision surfaces as CONFIRMED; downstream fill surfaces in ledger portfolio', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // TRIGGER 1: user confirms
    const confirm = await bff.advisory.mutate<{
      confirmDecision: { decisionId: string; status: string; confirmedAt: string; version: number };
    }>(
      `mutation ConfirmDecision($decisionId: ID!) {
         confirmDecision(decisionId: $decisionId) {
           decisionId
           status
           confirmedAt
           version
         }
       }`,
      { decisionId },
    );
    expect(confirm.confirmDecision.status).toBe('CONFIRMED');

    // TRIGGER 2: simulate the downstream fill (bypass broker pipeline)
    await eb.putEvent({
      bus: 'execution',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        orderId: `e2e-order-${Date.now()}`,
        decisionId,
        symbol: 'VTI',
        quantity: 10,
        fillPriceCents: 20_000,
        side: 'BUY',
      },
    });

    // ASSERT: ledger-bff portfolio eventually reflects the fill
    const portfolio = await waitForGraphQL<{
      getPortfolio: { cashBalanceCents: number; positions: Array<{ symbol: string; quantity: number }>; totalValueCents: number | null };
    }>(
      bff.ledger,
      `query Portfolio { getPortfolio { cashBalanceCents positions { symbol quantity } totalValueCents } }`,
      {},
      (r) => (r.getPortfolio?.positions ?? []).some((p) => p.symbol === 'VTI' && p.quantity > 0),
      { timeoutMs: 120_000 },
    );
    expect(portfolio.getPortfolio.positions.find((p) => p.symbol === 'VTI')?.quantity).toBeGreaterThan(0);

    // ASSERT: advisory-bff getDecision status is CONFIRMED
    const decision = await bff.advisory.query<{ getDecision: { decisionId: string; status: string } | null }>(
      `query GetDecision($decisionId: ID!) { getDecision(decisionId: $decisionId) { decisionId status } }`,
      { decisionId },
    );
    expect(decision.getDecision?.status).toBe('CONFIRMED');
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=accept-decision`

Expected: PASS (may take up to 3 minutes — decision fixture + CDC + fill projection).

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/advisory/accept-decision.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 6 — accept decision (multi-step)

Mutation + synthetic ORDER_FILLED event chained, asserts both
advisory-bff decision status and ledger-bff portfolio holdings reflect
the execution outcome.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Scenario 7 — Reject decision

**Files:**
- Create: `libs/e2e-feature-tests/test/advisory/reject-decision.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/advisory/reject-decision.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withDecision,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 7 — investor rejects decision', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      withDecision({ trigger: 'REBALANCE' }),
    ]);
    decisionId = result.decisionId as string;
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('rejectDecision transitions status to REJECTED and persists the reason', async () => {
    const bff = bffClient(ctx, tenant);

    const reject = await bff.advisory.mutate<{
      rejectDecision: { decisionId: string; status: string; rejectedAt: string; rejectionReason: string };
    }>(
      `mutation RejectDecision($decisionId: ID!, $reason: String!) {
         rejectDecision(decisionId: $decisionId, reason: $reason) {
           decisionId
           status
           rejectedAt
           rejectionReason
         }
       }`,
      { decisionId, reason: 'E2E rejection test' },
    );
    expect(reject.rejectDecision.status).toBe('REJECTED');
    expect(reject.rejectDecision.rejectionReason).toBe('E2E rejection test');

    const readback = await waitForGraphQL<{
      getDecision: { decisionId: string; status: string; rejectionReason: string | null } | null;
    }>(
      bff.advisory,
      `query GetDecision($decisionId: ID!) { getDecision(decisionId: $decisionId) { decisionId status rejectionReason } }`,
      { decisionId },
      (r) => r.getDecision?.status === 'REJECTED',
      { timeoutMs: 60_000 },
    );
    expect(readback.getDecision?.rejectionReason).toBe('E2E rejection test');
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=reject-decision`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/advisory/reject-decision.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 7 — reject decision

Synthetic decision, user rejects, read-back via getDecision confirms
REJECTED status + rejection reason persists.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Scenario 8 — View decision explanation

**Files:**
- Create: `libs/e2e-feature-tests/test/advisory/view-decision-explanation.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/advisory/view-decision-explanation.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withDecision,
  bffClient,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 8 — investor views decision explanation', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      withDecision({ trigger: 'INITIAL_ALLOCATION' }),
    ]);
    decisionId = result.decisionId as string;
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('recordExplanationView returns a ViewReceipt with viewedAt set', async () => {
    const bff = bffClient(ctx, tenant);

    const receipt = await bff.advisory.mutate<{
      recordExplanationView: { decisionId: string; viewedAt: string };
    }>(
      `mutation RecordView($decisionId: ID!) {
         recordExplanationView(decisionId: $decisionId) {
           decisionId
           viewedAt
         }
       }`,
      { decisionId },
    );

    expect(receipt.recordExplanationView.decisionId).toBe(decisionId);
    expect(receipt.recordExplanationView.viewedAt).toBeTruthy();
    expect(new Date(receipt.recordExplanationView.viewedAt).toString()).not.toBe('Invalid Date');
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=view-decision-explanation`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/advisory/view-decision-explanation.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 8 — view decision explanation

Records an explanation view, asserts the returned ViewReceipt has a
valid viewedAt timestamp.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Scenario 9 — Mark notification read

**Files:**
- Create: `libs/e2e-feature-tests/test/notifications/mark-notification-read.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/notifications/mark-notification-read.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  withNotification,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 9 — investor marks notification as read', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;
  let notificationId: string;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      withNotification({ title: 'E2E notification', body: 'hello' }),
    ]);
    notificationId = result.notificationId as string;
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('markNotificationRead transitions status to READ in getNotifications', async () => {
    const bff = bffClient(ctx, tenant);

    // Wait for the seeded notification to be readable.
    await waitForGraphQL<{
      getNotifications: { items: Array<{ notificationId: string; status: string }>; nextCursor: string | null };
    }>(
      bff.investor,
      `query Notifications { getNotifications(limit: 20) { items { notificationId status } nextCursor } }`,
      {},
      (r) => r.getNotifications.items.some((n) => n.notificationId === notificationId),
      { timeoutMs: 90_000 },
    );

    const mark = await bff.investor.mutate<{
      markNotificationRead: { notificationId: string; status: string; readAt: string | null };
    }>(
      `mutation MarkRead($notificationId: ID!) {
         markNotificationRead(notificationId: $notificationId) {
           notificationId
           status
           readAt
         }
       }`,
      { notificationId },
    );
    expect(mark.markNotificationRead.status).toBe('READ');
    expect(mark.markNotificationRead.readAt).toBeTruthy();

    const readback = await waitForGraphQL<{
      getNotifications: { items: Array<{ notificationId: string; status: string }> };
    }>(
      bff.investor,
      `query Notifications { getNotifications(limit: 20) { items { notificationId status } } }`,
      {},
      (r) => r.getNotifications.items.find((n) => n.notificationId === notificationId)?.status === 'READ',
      { timeoutMs: 60_000 },
    );
    expect(readback.getNotifications.items.find((n) => n.notificationId === notificationId)?.status).toBe('READ');
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=mark-notification-read`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/notifications/mark-notification-read.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 9 — mark notification read

Seeds a notification, marks it read, confirms status=READ on read-back
through getNotifications.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Scenario 10 — Request account closure

**Files:**
- Create: `libs/e2e-feature-tests/test/account/request-closure.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/account/request-closure.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  bffClient,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 10 — investor requests account closure', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 500_000 }),
    ]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('requestAccountClosure returns a closure request with a timestamp', async () => {
    const bff = bffClient(ctx, tenant);

    const closure = await bff.investor.mutate<{
      requestAccountClosure: { closureId: string; status: string; requestedAt: string };
    }>(
      `mutation RequestClosure { requestAccountClosure { closureId status requestedAt } }`,
      {},
    );

    expect(closure.requestAccountClosure.closureId).toBeTruthy();
    expect(closure.requestAccountClosure.status).toBe('REQUESTED');
    expect(new Date(closure.requestAccountClosure.requestedAt).toString()).not.toBe('Invalid Date');
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=request-closure`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/account/request-closure.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 10 — request account closure

Onboards + funds a tenant, calls requestAccountClosure, asserts the
returned closure request has status=REQUESTED and a valid timestamp.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 20: Scenario 11 — First advisory decision (event-triggered)

**Files:**
- Create: `libs/e2e-feature-tests/test/advisory/first-decision.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/advisory/first-decision.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 11 — investor sees first advisory decision after onboarding', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 180_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('MANDATE_CREATED triggers the advisory cycle, decision surfaces in getPendingDecisions', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // TRIGGER: synthetic MANDATE_CREATED
    await eb.putEvent({
      bus: 'investor',
      targetService: 'advisory-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        mandateId: `e2e-mandate-${Date.now()}`,
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        coolDownDays: 1,
        rebalanceCadence: 'MONTHLY',
      },
    });

    // ASSERT: advisory-bff eventually surfaces a pending decision
    const pending = await waitForGraphQL<{
      getPendingDecisions: { items: Array<{ decisionId: string; status: string; trigger: string }>; nextCursor: string | null };
    }>(
      bff.advisory,
      `query Pending { getPendingDecisions(limit: 10) { items { decisionId status trigger } nextCursor } }`,
      {},
      (r) => r.getPendingDecisions.items.length > 0,
      { timeoutMs: 240_000, intervalMs: 5_000 },
    );

    expect(pending.getPendingDecisions.items.length).toBeGreaterThan(0);
    expect(pending.getPendingDecisions.items[0]).toMatchObject({
      decisionId: expect.any(String),
      trigger: expect.any(String),
      status: expect.any(String),
    });
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=first-decision`

Expected: PASS within 4-5 minutes (4 LangGraph agents + compliance check; spec section 7 says ~60-90s cycle but allow margin).

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/advisory/first-decision.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 11 — first advisory decision

Publishes MANDATE_CREATED as the event trigger, polls getPendingDecisions
until the LangGraph cycle completes and a decision surfaces. Uses shape
matchers only since agent output is non-deterministic.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Scenario 12 — Portfolio drift rebalance (event-triggered)

**Files:**
- Create: `libs/e2e-feature-tests/test/advisory/rebalance-on-drift.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/advisory/rebalance-on-drift.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withHoldings,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 12 — portfolio drift surfaces a rebalance decision', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
      withHoldings([
        { symbol: 'VTI', quantity: 50, fillPriceCents: 20_000 },
        { symbol: 'BND', quantity: 10, fillPriceCents: 8_000 },
      ]),
    ]);
  }, 240_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('PORTFOLIO_DRIFT_DETECTED triggers a rebalance decision', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // TRIGGER: synthetic drift detection
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'advisory-adpt',
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        driftPercent: 12.5,
        positionsOutOfBand: [{ symbol: 'VTI', targetWeight: 0.6, actualWeight: 0.75 }],
      },
    });

    // ASSERT: a decision with trigger indicating REBALANCE surfaces
    const pending = await waitForGraphQL<{
      getPendingDecisions: { items: Array<{ decisionId: string; trigger: string; status: string }>; nextCursor: string | null };
    }>(
      bff.advisory,
      `query Pending { getPendingDecisions(limit: 10) { items { decisionId trigger status } nextCursor } }`,
      {},
      (r) => r.getPendingDecisions.items.some((d) => d.trigger.toUpperCase().includes('REBALANCE')),
      { timeoutMs: 240_000, intervalMs: 5_000 },
    );

    const decision = pending.getPendingDecisions.items.find((d) => d.trigger.toUpperCase().includes('REBALANCE'));
    expect(decision).toBeDefined();
    expect(decision!.decisionId).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=rebalance-on-drift`

Expected: PASS within 4-5 minutes.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/advisory/rebalance-on-drift.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 12 — rebalance on drift

Seeds holdings, publishes PORTFOLIO_DRIFT_DETECTED on the ledger bus,
polls advisory-bff until a rebalance-triggered decision surfaces.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Scenario 13 — Reconciliation corrective outcome (event-triggered)

**Files:**
- Create: `libs/e2e-feature-tests/test/advisory/reconciliation-correction.e2e.test.ts`

- [ ] **Step 1: Write the full test file**

Create `libs/e2e-feature-tests/test/advisory/reconciliation-correction.e2e.test.ts`:

```ts
import {
  createIntegrationContext,
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withHoldings,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '@nestfolio/e2e-feature-tests';

describe('scenario 13 — reconciliation discrepancy surfaces corrective outcome', () => {
  let ctx: IntegrationContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createIntegrationContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 2_000_000 }),
      withHoldings([{ symbol: 'VTI', quantity: 25, fillPriceCents: 20_000 }]),
    ]);
  }, 240_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('RECONCILIATION_REQUIRED produces a decision or an investor notification', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    await eb.putEvent({
      bus: 'ledger',
      targetService: 'reconciliation-ctrl',
      detailType: 'RECONCILIATION_REQUIRED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        reason: 'E2E synthetic reconciliation trigger',
        trigger: 'SCHEDULED',
      },
    });

    // Assert: EITHER a corrective decision surfaces OR a notification surfaces.
    // Both are valid user-visible outcomes per spec section 4, scenario 13.
    const deadline = Date.now() + 240_000;
    let observed = false;
    while (Date.now() < deadline) {
      const [pending, notifs] = await Promise.all([
        bff.advisory.query<{
          getPendingDecisions: { items: Array<{ decisionId: string; trigger: string }> };
        }>(
          `query Pending { getPendingDecisions(limit: 10) { items { decisionId trigger } } }`,
          {},
        ),
        bff.investor.query<{
          getNotifications: { items: Array<{ notificationId: string; title: string }> };
        }>(
          `query Notifs { getNotifications(limit: 20) { items { notificationId title } } }`,
          {},
        ),
      ]);

      if (pending.getPendingDecisions.items.length > 0) { observed = true; break; }
      if (notifs.getNotifications.items.length > 0) { observed = true; break; }
      await new Promise((r) => setTimeout(r, 5_000));
    }

    expect(observed).toBe(true);
  });
});
```

- [ ] **Step 2: Run against dev sandbox**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPattern=reconciliation-correction`

Expected: PASS within 4-5 minutes.

- [ ] **Step 3: Commit**

```bash
git add libs/e2e-feature-tests/test/advisory/reconciliation-correction.e2e.test.ts
git commit -m "$(cat <<'EOF'
test(e2e-feature-tests): scenario 13 — reconciliation corrective outcome

Publishes RECONCILIATION_REQUIRED on the ledger bus, polls both
advisory-bff (decisions) and investor-bff (notifications); either
surface counts as a passing user-visible corrective outcome.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Full suite run against dev + final verification

**Files:** none

- [ ] **Step 1: Run the full suite end-to-end**

Run: `NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features`

Expected:
- All 13 scenario tests PASS (plus all helper unit tests).
- Final log line after Jest reports shows either:
  - `[globalTeardown] alpacaPaperReset OK (prefix=dev)`, OR
  - `[globalTeardown] alpacaPaperReset FAILED ...` — investigate the reason in the log; most likely `dev-broker-alpaca-adpt/alpaca-api-keys` isn't provisioned, in which case complete operational setup (spec section 8.2) and re-run.
- Total wall-clock time: ~25-35 minutes (serial execution at `maxWorkers: 1`).

- [ ] **Step 2: Verify Alpaca paper account is clean**

Manually in the Alpaca paper dashboard (or via `curl -H "APCA-API-KEY-ID: ..." https://paper-api.alpaca.markets/v2/orders?status=open`): confirm there are no open orders and no open positions after the suite runs. If any remain, investigate `globalTeardown` output from Step 1 — the helper should have swept them.

- [ ] **Step 3: Verify Nx workspace recognizes the library cleanly**

Run: `pnpm nx show project e2e-feature-tests --json | head -30`

Expected: JSON output with `name`, `sourceRoot`, and `targets.test-e2e-features` fields present. No errors, no lint warnings.

Run: `pnpm nx lint e2e-feature-tests`

Expected: PASS (or lint target skipped if no eslintrc in the lib — both acceptable).

- [ ] **Step 4: Commit any touch-ups from verification**

If the verification run revealed any issues (helper fix, missing export, predicate relaxation), make the smallest possible fix and commit with:

```bash
git add <changed-files>
git commit -m "$(cat <<'EOF'
fix(e2e-feature-tests): <one-line description>

<body if warranted>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

If nothing needs fixing, skip this step — no empty commit.

---

## Self-Review

**Spec coverage:**
- Prerequisite (section 12, section 8) → Task 1 ✓
- Nx library scaffold (section 5) → Task 2 ✓
- `freshTenant` helper (section 5) → Task 3 ✓
- `waitForGraphQL` helper (section 5) → Task 4 ✓
- `bffClient` helper (section 5) → Task 5 ✓
- `applyFixtures` + `onboarded` fixture (section 5) → Task 6 ✓
- `funded` fixture → Task 7 ✓
- `withDecision` / `withNotification` / `withHoldings` fixtures → Task 8 ✓
- `alpacaPaperReset` + `globalTeardown` (section 5, section 10) → Task 9 ✓
- Scenario 1 fund → Task 10 ✓
- Scenario 2 withdraw → Task 11 ✓
- Scenario 3 goal → Task 12 ✓
- Scenario 4 mandate update → Task 13 ✓ (schema constraint resolved in notes)
- Scenario 5 mandate revoke → Task 14 ✓ (schema constraint resolved)
- Scenario 6 accept + execute (multi-step) → Task 15 ✓
- Scenario 7 reject decision → Task 16 ✓
- Scenario 8 view explanation → Task 17 ✓
- Scenario 9 mark notification read → Task 18 ✓
- Scenario 10 request closure → Task 19 ✓
- Scenario 11 first decision (event-triggered) → Task 20 ✓
- Scenario 12 rebalance on drift (event-triggered) → Task 21 ✓
- Scenario 13 reconciliation correction (event-triggered) → Task 22 ✓
- Full suite verification + manual Alpaca clean-up check → Task 23 ✓

Hard constraints check (spec sections 3 + 13):
- No `EventBusTrap` import anywhere ✓ (grep for `EventBusTrap` in Tasks 3-22 returns nothing)
- No `TableAssertions` import anywhere ✓
- No direct DDB reads ✓ (no `@aws-sdk/client-dynamodb` imports in any test file)
- Events only as preconditions (fixtures) or explicit triggers for scenarios 6, 11, 12, 13 ✓
- All assertions through BFF GraphQL via `AppSyncClient` ✓
- `maxWorkers: 1` ✓ (Task 2)
- `testTimeout: 300_000` ✓ (Task 2)

**Placeholder scan:** no TBDs, no "similar to", no "add error handling" — every step contains concrete file content or concrete commands. ✓

**Type consistency:**
- `FreshTenant` defined in Task 3, imported by Tasks 5, 6, 7, 8, 10-22 ✓
- `Fixture` / `FixtureResult` defined in Task 6, extended by Tasks 7, 8 ✓
- `BffClients` defined in Task 5, returned by `bffClient()` in all scenarios ✓
- `WaitOptions` defined in Task 4, used with shape `{ timeoutMs, intervalMs }` consistently ✓
- `bffClient(ctx, tenant)` signature stable across all scenario tasks ✓
- `applyFixtures(ctx, tenant, fixtures[])` signature stable ✓
- Event bus names (`investor`, `advisory`, `execution`, `ledger`) match the convention from `services/execution/broker-ctrl/test/integration/` ✓
