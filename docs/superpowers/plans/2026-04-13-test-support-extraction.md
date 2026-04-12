# Test Support Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract generic AWS test infrastructure from `libs/integration-testing` into `libs/test-support`, rename `IntegrationContext` → `TestContext` / `createIntegrationContext` → `createTestContext`, and update all ~48 consumer files in one shot.

**Architecture:** Move 6 source files (context, cleanup, ssm-cache, event-bridge-client, cognito-fixture, appsync-client) into a new `libs/test-support` Nx library. `libs/integration-testing` keeps its integration-specific tools (`EventBusTrap`, `TableAssertions`, etc.) and imports `TestContext` from the new lib. All consumers get updated imports — no re-exports, no backward-compat shims.

**Tech Stack:** TypeScript, Nx, Jest, `@aws-sdk/client-*`

---

## File Structure

### New: `libs/test-support/`

```
libs/test-support/
├── project.json
├── tsconfig.json
├── tsconfig.spec.json
└── src/
    ├── index.ts
    ├── context.ts              ← moved from integration-testing, renamed exports
    ├── cleanup.ts              ← moved from integration-testing
    ├── ssm-cache.ts            ← moved from integration-testing
    └── fixtures/
        ├── event-bridge-client.ts  ← moved, IntegrationContext→TestContext
        ├── cognito.fixture.ts      ← moved, IntegrationContext→TestContext
        └── appsync-client.ts       ← moved, IntegrationContext→TestContext
```

### Modified: `libs/integration-testing/`

```
libs/integration-testing/
├── src/
│   ├── index.ts                ← stripped of moved exports, re-exports nothing from test-support
│   ├── resilience.ts           ← unchanged
│   └── fixtures/
│       ├── event-bus-trap.fixture.ts     ← IntegrationContext→TestContext import
│       ├── table-assertions.ts           ← IntegrationContext→TestContext import
│       ├── ssm-override.fixture.ts       ← IntegrationContext→TestContext import
│       ├── mock-api.fixture.ts           ← IntegrationContext→TestContext import
│       ├── account-seeding.fixture.ts    ← IntegrationContext→TestContext import
│       └── ddb-seed.fixture.ts           ← IntegrationContext→TestContext import
```

Deleted from integration-testing: `src/context.ts`, `src/cleanup.ts`, `src/ssm-cache.ts`, `src/fixtures/event-bridge-client.ts`, `src/fixtures/cognito.fixture.ts`, `src/fixtures/appsync-client.ts`

### Modified: ~48 consumer files

All imports of `createIntegrationContext`, `IntegrationContext`, `EventBridgeClient`, `CognitoFixture`, `CognitoTokens`, `AppSyncClient`, `CleanupRegistry`, `SsmCache` change from `@nestfolio/integration-testing` to `@nestfolio/test-support`, with type renames.

---

## Task 1: Scaffold `libs/test-support`

**Files:**
- Create: `libs/test-support/project.json`
- Create: `libs/test-support/tsconfig.json`
- Create: `libs/test-support/tsconfig.spec.json`
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Create project.json**

Create `libs/test-support/project.json`:

```json
{
  "name": "test-support",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "sourceRoot": "libs/test-support/src",
  "projectType": "library",
  "targets": {
    "lint": {
      "executor": "@nx/eslint:lint"
    }
  },
  "tags": ["scope:platform", "type:lib"]
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `libs/test-support/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ES2022",
    "target": "ES2022",
    "outDir": "../../dist/libs/test-support",
    "declaration": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 3: Create tsconfig.spec.json**

Create `libs/test-support/tsconfig.spec.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "types": ["jest", "node"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Add path alias to tsconfig.base.json**

In `tsconfig.base.json`, add a new entry in `compilerOptions.paths` (before the `@nestfolio/integration-testing` entries):

```json
"@nestfolio/test-support": ["libs/test-support/src/index.ts"],
"@nestfolio/test-support/*": ["libs/test-support/src/*"],
```

- [ ] **Step 5: Verify Nx sees the project**

Run: `pnpm nx show project test-support --json`

Expected: JSON output with `"name": "test-support"`, `"sourceRoot": "libs/test-support/src"`.

- [ ] **Step 6: Commit**

```bash
git add libs/test-support/project.json libs/test-support/tsconfig.json libs/test-support/tsconfig.spec.json tsconfig.base.json
git commit -m "chore: scaffold libs/test-support Nx library"
```

---

## Task 2: Move core modules to test-support

**Files:**
- Create: `libs/test-support/src/cleanup.ts`
- Create: `libs/test-support/src/ssm-cache.ts`
- Create: `libs/test-support/src/context.ts`
- Create: `libs/test-support/src/index.ts`

- [ ] **Step 1: Copy cleanup.ts verbatim**

Copy `libs/integration-testing/src/cleanup.ts` → `libs/test-support/src/cleanup.ts` with no changes. The file is self-contained (no imports from other integration-testing modules).

```ts
export class CleanupRegistry {
  private readonly actions: { name: string; fn: () => Promise<void> }[] = [];

  register(name: string, fn: () => Promise<void>): void {
    this.actions.push({ name, fn });
  }

  async runAll(): Promise<void> {
    // LIFO order — most recently registered first
    const reversed = [...this.actions].reverse();
    for (const { name, fn } of reversed) {
      try {
        await fn();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Cleanup failed: ${name}`, err);
      }
    }
  }
}
```

- [ ] **Step 2: Copy ssm-cache.ts verbatim**

Copy `libs/integration-testing/src/ssm-cache.ts` → `libs/test-support/src/ssm-cache.ts` with no changes. The file is self-contained (only imports from `@aws-sdk`).

- [ ] **Step 3: Create context.ts with renames**

Create `libs/test-support/src/context.ts`. This is a copy of `libs/integration-testing/src/context.ts` with:
- `IntegrationContext` → `TestContext`
- `createIntegrationContext` → `createTestContext`

```ts
import { CleanupRegistry } from './cleanup';
import { SsmCache } from './ssm-cache';

export interface TimingConfig {
  /** Default timeout for waitForEvent / waitForItem (ms) */
  eventTimeout: number;
  /** Poll interval for SQS / DDB polling (ms) */
  pollInterval: number;
  /** Canary warmup timeout (ms) */
  canaryTimeout: number;
  /** Number of retries for putEvent */
  putEventRetries: number;
  /** Base backoff for putEvent retries (ms) */
  putEventBackoffMs: number;
}

export interface TestContext {
  tenantId: string;
  userId: string;
  prefix: string;
  region: string;
  ssm: SsmCache;
  cleanup: CleanupRegistry;
  timings: TimingConfig;
}

function createTimingConfig(overrides?: Partial<TimingConfig>): TimingConfig {
  const multiplier = Number(process.env.INTEG_TIMEOUT_MULTIPLIER) || 1;
  return {
    eventTimeout: overrides?.eventTimeout ?? 45_000 * multiplier,
    pollInterval: overrides?.pollInterval ?? 2_000,
    canaryTimeout: overrides?.canaryTimeout ?? 30_000 * multiplier,
    putEventRetries: overrides?.putEventRetries ?? 3,
    putEventBackoffMs: overrides?.putEventBackoffMs ?? 500,
  };
}

export async function createTestContext(options?: {
  prefix?: string;
  region?: string;
  timings?: Partial<TimingConfig>;
}): Promise<TestContext> {
  if (
    process.env.CI === 'true' &&
    !options?.prefix &&
    !process.env.NESTFOLIO_INTEG_PREFIX
  ) {
    throw new Error(
      'createTestContext: running in CI (CI=true) but NESTFOLIO_INTEG_PREFIX is unset. ' +
        'Refusing to fall back to the shared "dev" prefix. ' +
        'Set NESTFOLIO_INTEG_PREFIX in the CI job env (e.g. sandbox-pr-${PR_NUMBER}) or pass options.prefix explicitly.',
    );
  }
  const prefix = options?.prefix ?? process.env.NESTFOLIO_INTEG_PREFIX ?? 'dev';
  const region = options?.region ?? 'us-east-1';
  const timestamp = Date.now();
  const cleanup = new CleanupRegistry();
  const ssm = new SsmCache(prefix, region);

  cleanup.register('SsmCache', () => {
    ssm.destroy();
    return Promise.resolve();
  });

  return {
    tenantId: `integ-${timestamp}`,
    userId: `integ-user-${timestamp}`,
    prefix,
    region,
    ssm,
    cleanup,
    timings: createTimingConfig(options?.timings),
  };
}
```

- [ ] **Step 4: Create index.ts**

Create `libs/test-support/src/index.ts`:

```ts
export { CleanupRegistry } from './cleanup';
export { SsmCache } from './ssm-cache';
export { createTestContext, type TestContext, type TimingConfig } from './context';
export { EventBridgeClient } from './fixtures/event-bridge-client';
export { CognitoFixture, type CognitoTokens } from './fixtures/cognito.fixture';
export { AppSyncClient } from './fixtures/appsync-client';
```

Note: this will not compile yet — the `fixtures/` files don't exist until Task 3.

- [ ] **Step 5: Commit**

```bash
git add libs/test-support/src/
git commit -m "feat(test-support): add core modules (context, cleanup, ssm-cache)"
```

---

## Task 3: Move fixture files to test-support

**Files:**
- Create: `libs/test-support/src/fixtures/event-bridge-client.ts`
- Create: `libs/test-support/src/fixtures/cognito.fixture.ts`
- Create: `libs/test-support/src/fixtures/appsync-client.ts`

- [ ] **Step 1: Create event-bridge-client.ts**

Copy `libs/integration-testing/src/fixtures/event-bridge-client.ts` → `libs/test-support/src/fixtures/event-bridge-client.ts` with one change: the import of `IntegrationContext` becomes `TestContext` from the local context module.

Change the import line from:
```ts
import type { IntegrationContext } from '../context';
```
to:
```ts
import type { TestContext } from '../context';
```

And rename all usages of `IntegrationContext` to `TestContext` in the file body:
- `private readonly ctx: IntegrationContext;` → `private readonly ctx: TestContext;`
- `constructor(ctx: IntegrationContext)` → `constructor(ctx: TestContext)`

- [ ] **Step 2: Create cognito.fixture.ts**

Copy `libs/integration-testing/src/fixtures/cognito.fixture.ts` → `libs/test-support/src/fixtures/cognito.fixture.ts` with the same `IntegrationContext` → `TestContext` rename:

Change import:
```ts
import type { IntegrationContext } from '../context';
```
to:
```ts
import type { TestContext } from '../context';
```

Rename in body:
- `private readonly ctx: IntegrationContext;` → `private readonly ctx: TestContext;`
- `constructor(ctx: IntegrationContext)` → `constructor(ctx: TestContext)`

- [ ] **Step 3: Create appsync-client.ts**

Copy `libs/integration-testing/src/fixtures/appsync-client.ts` → `libs/test-support/src/fixtures/appsync-client.ts` with the same rename:

Change import:
```ts
import type { IntegrationContext } from '../context';
```
to:
```ts
import type { TestContext } from '../context';
```

Rename in body:
- `constructor(ctx: IntegrationContext, tokens: CognitoTokens, service: string)` → `constructor(ctx: TestContext, tokens: CognitoTokens, service: string)`

- [ ] **Step 4: Verify test-support compiles**

Run: `pnpm nx run test-support:lint`

Expected: PASS (no lint errors).

- [ ] **Step 5: Commit**

```bash
git add libs/test-support/src/fixtures/
git commit -m "feat(test-support): add fixture modules (EventBridgeClient, CognitoFixture, AppSyncClient)"
```

---

## Task 4: Update integration-testing to import from test-support

**Files:**
- Modify: `libs/integration-testing/src/index.ts`
- Delete: `libs/integration-testing/src/context.ts`
- Delete: `libs/integration-testing/src/cleanup.ts`
- Delete: `libs/integration-testing/src/ssm-cache.ts`
- Delete: `libs/integration-testing/src/fixtures/event-bridge-client.ts`
- Delete: `libs/integration-testing/src/fixtures/cognito.fixture.ts`
- Delete: `libs/integration-testing/src/fixtures/appsync-client.ts`
- Modify: `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`
- Modify: `libs/integration-testing/src/fixtures/table-assertions.ts`
- Modify: `libs/integration-testing/src/fixtures/ssm-override.fixture.ts`
- Modify: `libs/integration-testing/src/fixtures/mock-api.fixture.ts`
- Modify: `libs/integration-testing/src/fixtures/account-seeding.fixture.ts`
- Modify: `libs/integration-testing/src/fixtures/ddb-seed.fixture.ts`

- [ ] **Step 1: Delete moved files**

```bash
rm libs/integration-testing/src/context.ts \
   libs/integration-testing/src/cleanup.ts \
   libs/integration-testing/src/ssm-cache.ts \
   libs/integration-testing/src/fixtures/event-bridge-client.ts \
   libs/integration-testing/src/fixtures/cognito.fixture.ts \
   libs/integration-testing/src/fixtures/appsync-client.ts
```

- [ ] **Step 2: Update remaining fixture imports**

In each of the following 6 files, replace the `IntegrationContext` import:

**Old pattern** (in all 6 files):
```ts
import type { IntegrationContext } from '../context';
```

**New pattern** (in all 6 files):
```ts
import type { TestContext } from '@nestfolio/test-support';
```

Also rename all usages of `IntegrationContext` → `TestContext` in each file body (field types, constructor parameters, etc.).

Files to update:
1. `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts`
2. `libs/integration-testing/src/fixtures/table-assertions.ts`
3. `libs/integration-testing/src/fixtures/ssm-override.fixture.ts`
4. `libs/integration-testing/src/fixtures/mock-api.fixture.ts`
5. `libs/integration-testing/src/fixtures/account-seeding.fixture.ts`
6. `libs/integration-testing/src/fixtures/ddb-seed.fixture.ts`

- [ ] **Step 3: Rewrite index.ts**

Replace `libs/integration-testing/src/index.ts` with:

```ts
export { EventBusTrap, type CapturedEvent } from './fixtures/event-bus-trap.fixture';
export type { BusEventPayload } from '@nestfolio/event-processor';
export { TableAssertions } from './fixtures/table-assertions';
export { MockApiFixture } from './fixtures/mock-api.fixture';
export { SsmOverrideFixture } from './fixtures/ssm-override.fixture';
export { AccountSeedingFixture, type AccountSeedOptions } from './fixtures/account-seeding.fixture';
export { DdbSeedFixture } from './fixtures/ddb-seed.fixture';
export { snapshotState, assertEquivalentState, countItems, stripDynamicFields, sortSnapshot } from './resilience';
```

No re-exports from `@nestfolio/test-support`. Clean break.

- [ ] **Step 4: Verify integration-testing compiles**

Run: `pnpm nx run integration-testing:lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/integration-testing/
git commit -m "refactor(integration-testing): remove moved modules, import TestContext from test-support"
```

---

## Task 5: Migrate e2e-feature-tests imports (9 files)

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/bff-client.ts`
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts`
- Modify: `apps/e2e-feature-tests/src/helpers/fresh-tenant.ts`
- Modify: `apps/e2e-feature-tests/src/helpers/wait-for-graphql.ts`
- Modify: `apps/e2e-feature-tests/test/funding/fund-account.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/test/funding/withdraw-cash.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/test/helpers/bff-client.test.ts`
- Modify: `apps/e2e-feature-tests/test/helpers/fixtures.test.ts`
- Modify: `apps/e2e-feature-tests/test/helpers/fresh-tenant.test.ts`
- Modify: `apps/e2e-feature-tests/jest.config.js`

- [ ] **Step 1: Update jest.config.js moduleNameMapper**

In `apps/e2e-feature-tests/jest.config.js`, replace the `@nestfolio/integration-testing` mapper:

**Old:**
```js
moduleNameMapper: {
  '^@nestfolio/integration-testing$': '<rootDir>/../../libs/integration-testing/src/index.ts',
  '^@nestfolio/event-types$': '<rootDir>/../../libs/event-types/src/index.ts',
},
```

**New:**
```js
moduleNameMapper: {
  '^@nestfolio/test-support$': '<rootDir>/../../libs/test-support/src/index.ts',
  '^@nestfolio/event-types$': '<rootDir>/../../libs/event-types/src/index.ts',
},
```

- [ ] **Step 2: Update src/helpers/bff-client.ts**

**Old imports:**
```ts
import {
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
```

**New imports:**
```ts
import {
  AppSyncClient,
  type TestContext,
} from '@nestfolio/test-support';
```

Rename all `IntegrationContext` → `TestContext` in the file body.

- [ ] **Step 3: Update src/helpers/fixtures.ts**

**Old imports:**
```ts
import {
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
```

**New imports:**
```ts
import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
```

Rename all `IntegrationContext` → `TestContext` in the file body (the `Fixture` type signature, `applyFixtures` parameter).

- [ ] **Step 4: Update src/helpers/fresh-tenant.ts**

**Old imports:**
```ts
import {
  CognitoFixture,
  type CognitoTokens,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
```

**New imports:**
```ts
import {
  CognitoFixture,
  type CognitoTokens,
  type TestContext,
} from '@nestfolio/test-support';
```

Rename `IntegrationContext` → `TestContext` in the function signature.

- [ ] **Step 5: Update src/helpers/wait-for-graphql.ts**

**Old import:**
```ts
import type { AppSyncClient } from '@nestfolio/integration-testing';
```

**New import:**
```ts
import type { AppSyncClient } from '@nestfolio/test-support';
```

- [ ] **Step 6: Update test/funding/fund-account.e2e.test.ts**

**Old imports:**
```ts
import {
  createIntegrationContext,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
```

**New imports:**
```ts
import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
```

Rename in body: `let ctx: IntegrationContext` → `let ctx: TestContext`, `createIntegrationContext()` → `createTestContext()`.

- [ ] **Step 7: Update test/funding/withdraw-cash.e2e.test.ts**

**Old imports:**
```ts
import {
  createIntegrationContext,
  EventBridgeClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
```

**New imports:**
```ts
import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
```

Rename in body: `let ctx: IntegrationContext` → `let ctx: TestContext`, `createIntegrationContext()` → `createTestContext()`.

- [ ] **Step 8: Update test helper test files**

For each of these 3 files, change `from '@nestfolio/integration-testing'` to `from '@nestfolio/test-support'`:

1. `apps/e2e-feature-tests/test/helpers/bff-client.test.ts` — imports `AppSyncClient`
2. `apps/e2e-feature-tests/test/helpers/fixtures.test.ts` — imports `EventBridgeClient`
3. `apps/e2e-feature-tests/test/helpers/fresh-tenant.test.ts` — imports `CognitoFixture`

- [ ] **Step 9: Run e2e unit tests**

Run: `NODE_OPTIONS=--experimental-vm-modules pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=helpers`

Expected: All 5 helper test suites PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/e2e-feature-tests/
git commit -m "refactor(e2e-feature-tests): import from test-support instead of integration-testing"
```

---

## Task 6: Migrate service integration test imports

**Files:** ~39 integration test files across 4 domains.

Every service integration test file follows the same pattern. The import line:

```ts
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';
```

Gets split into two imports:

```ts
import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';
```

The exact split depends on which symbols each file uses. Generic symbols (`createTestContext`, `TestContext`, `EventBridgeClient`, `CognitoFixture`, `AppSyncClient`, `CognitoTokens`, `CleanupRegistry`, `SsmCache`, `TimingConfig`) come from `@nestfolio/test-support`. Integration-specific symbols (`EventBusTrap`, `CapturedEvent`, `TableAssertions`, `MockApiFixture`, `SsmOverrideFixture`, `AccountSeedingFixture`, `AccountSeedOptions`, `DdbSeedFixture`, `snapshotState`, `assertEquivalentState`, `countItems`, `stripDynamicFields`, `sortSnapshot`, `BusEventPayload`) come from `@nestfolio/integration-testing`.

In every file, also rename in the body:
- `IntegrationContext` → `TestContext`
- `createIntegrationContext` → `createTestContext`

- [ ] **Step 1: Migrate investor domain tests (7 files)**

Files:
1. `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`
2. `services/investor/investor-adpt/test/integration/from-advisory.integration.test.ts`
3. `services/investor/investor-adpt/test/integration/from-execution.integration.test.ts`
4. `services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts`
5. `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`
6. `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts`
7. `services/investor/onboarding-bff/test/integration/onboarding-bff.integration.test.ts`

Apply the import split and rename pattern described above to each file.

- [ ] **Step 2: Migrate ledger domain tests (6 files)**

Files:
1. `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts`
2. `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts`
3. `services/ledger/ledger-adpt/test/integration/ledger-adpt.integration.test.ts`
4. `services/ledger/ledger-bff/test/integration/ledger-bff.integration.test.ts`
5. `services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.integration.test.ts`
6. `services/ledger/reconciliation-ctrl/test/integration/reconciliation-ctrl.resilience.integration.test.ts`

- [ ] **Step 3: Migrate execution domain tests (7 files)**

Files:
1. `services/execution/broker-sim-adpt/test/integration/broker-sim-adpt.integration.test.ts`
2. `services/execution/broker-ctrl/test/integration/broker-ctrl.integration.test.ts`
3. `services/execution/broker-ctrl/test/integration/broker-ctrl.resilience.integration.test.ts`
4. `services/execution/broker-alpaca-adpt/test/integration/broker-alpaca-adpt.integration.test.ts`
5. `services/execution/execution-adpt/test/integration/from-advisory.integration.test.ts`
6. `services/execution/execution-adpt/test/integration/from-investor.integration.test.ts`
7. `services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts`

Plus any resilience variants in the same directories.

- [ ] **Step 4: Migrate advisory domain tests (~19 files)**

Files:
1. `services/advisory/advisory-adpt/test/integration/from-execution.integration.test.ts`
2. `services/advisory/advisory-adpt/test/integration/from-investor.integration.test.ts`
3. `services/advisory/advisory-adpt/test/integration/from-ledger.integration.test.ts`
4. `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`
5. `services/advisory/advisory-ctrl/test/integration/advisory-ctrl.integration.test.ts`
6. `services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.integration.test.ts`
7. `services/advisory/alpha-vantage-adpt/test/integration/alpha-vantage-adpt.integration.test.ts`
8. `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`
9. `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`
10. `services/advisory/fred-adpt/test/integration/fred-adpt.integration.test.ts`
11. `services/advisory/investor-profile-ctrl/test/integration/investor-profile-ctrl.integration.test.ts`
12. `services/advisory/market-intelligence-ctrl/test/integration/market-intelligence-ctrl.integration.test.ts`
13. `services/advisory/marketwatch-adpt/test/integration/marketwatch-adpt.integration.test.ts`
14. `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.integration.test.ts`
15. `services/advisory/portfolio-engine-ctrl/test/integration/portfolio-engine-ctrl.resilience.integration.test.ts`
16. `services/advisory/sec-edgar-adpt/test/integration/sec-edgar-adpt.integration.test.ts`
17. `services/advisory/yahoo-finance-adpt/test/integration/yahoo-finance-adpt.integration.test.ts`

Plus any resilience variants.

- [ ] **Step 5: Commit**

```bash
git add services/
git commit -m "refactor: migrate all integration tests to import from test-support"
```

---

## Task 7: Add moduleNameMapper for test-support to service jest configs

**Files:** Service `jest.config.js` files that run integration tests may need a `moduleNameMapper` for `@nestfolio/test-support` if they already have one for `@nestfolio/integration-testing`.

- [ ] **Step 1: Check if service jest configs need updating**

Run: `grep -r "integration-testing" services/*/jest.config.js services/*/*/jest.config.js --files-with-matches`

If any service jest.config.js files have a `moduleNameMapper` for `@nestfolio/integration-testing`, add a corresponding entry for `@nestfolio/test-support`:

```js
'^@nestfolio/test-support$': '<rootDir>/../../libs/test-support/src/index.ts',
```

Note: most services resolve `@nestfolio/*` via `tsconfig.base.json` paths, not jest moduleNameMapper. Only files that override resolution (like `apps/e2e-feature-tests`) need explicit mappers.

- [ ] **Step 2: Commit if any changes**

```bash
git add -A
git commit -m "chore: add test-support moduleNameMapper where needed"
```

---

## Task 8: Verify everything compiles and tests pass

- [ ] **Step 1: Run lint across affected projects**

Run: `pnpm nx run-many -t lint --projects=test-support,integration-testing,e2e-feature-tests`

Expected: All PASS.

- [ ] **Step 2: Run e2e helper unit tests**

Run: `NODE_OPTIONS=--experimental-vm-modules pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern=helpers`

Expected: All 5 helper suites PASS (11 tests).

- [ ] **Step 3: Run one integration test to verify imports**

Pick one representative integration test and run it:

Run: `pnpm nx run dashboard-bff:test-integration`

Expected: PASS. If this passes, the import split works end-to-end.

- [ ] **Step 4: Verify no stale references**

Run: `grep -r "from '@nestfolio/integration-testing'" apps/e2e-feature-tests/`

Expected: No matches (e2e tests should no longer import from integration-testing).

Run: `grep -r "IntegrationContext\|createIntegrationContext" libs/test-support/ libs/integration-testing/src/ apps/e2e-feature-tests/ services/`

Expected: No matches (all renamed to `TestContext` / `createTestContext`).

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: fixup any remaining stale references"
```
