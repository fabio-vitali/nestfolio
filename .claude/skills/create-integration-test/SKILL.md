---
name: create-integration-test
description: Add integration tests to a service — determine pattern, scaffold config, write test file with correct fixtures and assertions. Use when adding or creating integration tests.
---

## When This Skill Applies
- Adding integration tests to a service that has none
- Adding a new integration test file to a service
- Converting smoke/schema tests to full-pipeline integration tests

## Prerequisites
- Read the target service's CLAUDE.md card: `services/{domain}/{service}/CLAUDE.md`
- If missing or stale, invoke `audit-service` first
- Read the service stack: `services/{domain}/{service}/src/service.stack.ts`

## Checklist

- [ ] 1. **Determine test pattern** from service type:

  | Service Type | Pattern | Fixtures Needed |
  |-------------|---------|-----------------|
  | Third-party adapter (-adpt with external API) | A: Full-Pipeline | MockApiFixture, SsmOverrideFixture, EventBusTrap, TableAssertions |
  | Ctrl service (-ctrl with DDB + CDC) | B: CDC Chain | EventBusTrap, TableAssertions |
  | BFF service (-bff with Facade) | C: BFF/AppSync | CognitoFixture, AppSyncClient, TableAssertions |
  | Cross-domain adapter (-adpt, stateless) | D: Adapter Forwarding | EventBusTrap only |
  | Agent service (-ctrl with AgentRuntime) | E: Agent Smoke | EventBusTrap, TableAssertions |

- [ ] 2. **Create `jest.integration.config.js`** at service root:
  ```js
  const preset = require('../../../jest.preset');
  module.exports = {
    ...preset,
    displayName: '{service}-integration',
    testEnvironment: 'node',
    testMatch: ['<rootDir>/test/integration/**/*.integration.test.ts'],
    moduleNameMapper: {
      '^@nestfolio/integration-testing$': '<rootDir>/../../../libs/integration-testing/src/index.ts',
      '^@nestfolio/integration-testing/(.*)$': '<rootDir>/../../../libs/integration-testing/src/$1',
    },
    transform: {
      '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: false }],
    },
    transformIgnorePatterns: ['node_modules/(?!.*p-limit/|.*yocto-queue/)'],
    testTimeout: 120_000,
    maxWorkers: 1,
    setupFilesAfterEnv: ['<rootDir>/../../../libs/integration-testing/src/jest.integration.setup.ts'],
  };
  ```

- [ ] 3. **Add `test-integration` target** to `project.json`:
  ```json
  "test-integration": {
    "executor": "nx:run-commands",
    "options": {
      "command": "NODE_OPTIONS=--experimental-vm-modules pnpm jest --config services/{domain}/{service}/jest.integration.config.js --passWithNoTests"
    }
  }
  ```

- [ ] 4. **Add `testPathIgnorePatterns`** to `jest.config.js` (unit tests):
  ```js
  testPathIgnorePatterns: ['<rootDir>/test/integration/'],
  ```

- [ ] 5. **Create test directory**: `services/{domain}/{service}/test/integration/`

- [ ] 6. **Write test file** using the pattern-specific template below

- [ ] 7. **Run the test**: `pnpm nx run {service}:test-integration`

- [ ] 8. **Verify cleanup**: confirm no residual AWS resources after test run

## Pattern A: Full-Pipeline (Third-Party Adapter)

Requires a mock Lambda. Check if `build-mock` target and `test/mocks/` directory exist. If not, scaffold them (see Mock Lambda section below).

```typescript
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('{service} (mocked)', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();

    // Deploy mock external API Lambda
    const mockApi = new MockApiFixture(ctx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-{api-name}.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-{api-name}',
      handlerAsset: readFileSync(zipPath),
    });

    // Override SSM base URL to point to mock
    const ssmOverride = new SsmOverrideFixture(ctx);
    await ssmOverride.override({
      paramName: `/nestfolio/${ctx.prefix}-{service}/{api}/baseUrl`,
      testValue: mockUrl,
    });

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: '{domain}',
      detailType: [/* CDC event types emitted by this service */],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('should process {TRIGGER_EVENT} and emit {CDC_EVENT}', async () => {
    await eb.putEvent({
      bus: '{domain}',
      targetService: '{service}',
      detailType: '{TRIGGER_EVENT}',
      detail: { /* minimal required fields */ },
    });

    // Verify DDB write
    const item = await table.waitForItem({
      table: '{service}',
      pk: '{EntityType}#{id}',
      timeoutMs: 90_000,
    });
    expect(item['fieldName']).toBe('expectedValue');

    // Verify CDC event
    const event = await trap.waitForEvent({ detailType: '{CDC_EVENT}', timeoutMs: 30_000 });
    expect(event.detailType).toBe('{CDC_EVENT}');
  }, 120_000);
});
```

**Exemplary references**: `services/advisory/sec-edgar-adpt/`, `services/advisory/fred-adpt/`, `services/advisory/alpha-vantage-adpt/`

## Pattern B: CDC Chain (Ctrl Service)

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('{service}', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    await trap.deploy({
      bus: '{domain}',
      detailType: [/* all CDC event types */],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── {EVENT_TYPE} ─────────────────────────────────────────────

  it('should process {EVENT_TYPE} and emit CDC event', async () => {
    await eb.putEvent({
      bus: '{domain}',
      targetService: '{service}',
      detailType: '{EVENT_TYPE}',
      detail: { /* required fields */ },
    });

    // CDC event proves: EB -> SQS -> Lambda -> DDB write -> Stream -> CDC Lambda -> EB
    const event = await trap.waitForEvent({ timeoutMs: 90_000 });
    expect(event.detailType).toBe('{EXPECTED_CDC_EVENT}');
  }, 120_000);

  // ── Skip handler ─────────────────────────────────────────────

  it('should process {SKIP_EVENT} without side effects', async () => {
    await eb.putEvent({
      bus: '{domain}',
      targetService: '{service}',
      detailType: '{SKIP_EVENT}',
      detail: { /* required fields */ },
    });

    // Handler calls skip() -- no DDB write, no CDC event expected
    await new Promise(resolve => setTimeout(resolve, 15_000));
    const stray = await trap.drain();
    const relevant = stray.filter(e => e.detailType.includes('{RELATED_PREFIX}'));
    expect(relevant).toHaveLength(0);
  }, 60_000);
});
```

**Exemplary references**: `services/execution/execution-ctrl/`, `services/investor/investor-ctrl/`, `services/execution/broker-ctrl/`

## Pattern C: BFF/AppSync

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  TableAssertions,
  CognitoFixture,
  AppSyncClient,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('{service}', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let appsync: AppSyncClient;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    const cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, '{service}');
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Event Materializations ──────────────────────────────────

  describe('event materializations', () => {
    it('should materialize {TypeName} on {EVENT_TYPE}', async () => {
      await eb.putEvent({
        bus: '{domain}',
        targetService: '{service}',
        detailType: '{EVENT_TYPE}',
        detail: { /* fields */ },
      });

      // project() -> deterministic sk
      const item = await table.waitForItem({
        table: '{service}',
        pk: `T#${ctx.tenantId}`,
        sk: '{TypeName}',
        timeoutMs: 60_000,
      });
      expect(item['__typename']).toBe('{TypeName}');
    }, 120_000);

    it('should materialize {TypeName} record on {EVENT_TYPE}', async () => {
      await eb.putEvent({
        bus: '{domain}',
        targetService: '{service}',
        detailType: '{EVENT_TYPE}',
        detail: { /* fields */ },
      });

      // record() -> non-deterministic sk, query by prefix
      let found: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !found) {
        const items = await table.queryItems({
          table: '{service}',
          pk: `T#${ctx.tenantId}`,
          skPrefix: '{TypeName}#',
        });
        found = items.find(i => i['fieldName'] === 'expectedValue');
        if (!found) await new Promise(r => setTimeout(r, 2_000));
      }
      expect(found).toBeDefined();
      expect(found!['__typename']).toBe('{TypeName}');
    }, 120_000);
  });

  // ── AppSync Queries ─────────────────────────────────────────

  describe('AppSync queries', () => {
    beforeAll(async () => {
      // Publish events to set up query-test state, then poll until materialized
      await eb.putEvent({ /* ... */ });
      // Poll until item appears with expected value
    }, 300_000);

    it('should return data via {queryName}', async () => {
      const result = await appsync.query<{ queryName: { field: string } }>(`
        query { queryName { field } }
      `, {});
      expect(result.queryName).toBeDefined();
    }, 60_000);
  });
});
```

**Exemplary references**: `services/investor/dashboard-bff/`, `services/ledger/ledger-bff/`, `services/investor/investor-bff/`

## Pattern D: Adapter Forwarding (Cross-Domain)

One test file per source bus: `from-{source-domain}.integration.test.ts`

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  type BusEventPayload,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('{service}: {SourceDomain} -> {TargetDomain} forwarding', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);

    // Trap on TARGET bus -- event should arrive here after forwarding
    await trap.deploy({
      bus: '{target-domain}',
      detailType: '{FORWARDED_EVENT}',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should forward {EVENT} from {SourceDomain}Bus to {TargetDomain}Bus', async () => {
    await eb.putEvent({
      bus: '{source-domain}',
      targetService: '{service}',
      detailType: '{EVENT}',
      detail: { /* minimal fields */ },
    });

    const event = await trap.waitForEvent<BusEventPayload>();
    expect(event.detailType).toBe('{EVENT}');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
```

**Exemplary references**: `services/advisory/advisory-adpt/`, `services/investor/investor-adpt/`

## Pattern E: Agent Smoke (Agent Ctrl Service)

```typescript
import {
  createIntegrationContext,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('{service}: {TRIGGER_EVENT} -> AgentInvocation DDB write + CDC', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let table: TableAssertions;
  let trap: EventBusTrap;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    trap = new EventBusTrap(ctx);
    await trap.deploy({
      bus: '{domain}',
      detailType: [/* CDC event types */],
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should write AgentInvocation record to DDB on {TRIGGER_EVENT}', async () => {
    const entityId = `integ-{entity}-${Date.now()}`;

    await eb.putEvent({
      bus: '{domain}',
      targetService: '{service}',
      detailType: '{TRIGGER_EVENT}',
      detail: {
        tenantId: ctx.tenantId,
        {entityIdField}: entityId,
        taskToken: 'integ-task-token',
      },
    });

    // Agent-service writes IN_PROGRESS record before calling agent pipeline
    const item = await table.waitForItem({
      table: '{service}',
      pk: `{ENTITY}#${entityId}`,
      timeoutMs: 60_000,
    });
    expect(item['__typename']).toBe('AgentInvocation');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['agentName']).toBe('{agent-name}');

    // CDC verification
    const cdcEvent = await trap.waitForEvent({
      detailType: '{CDC_EVENT}',
    });
    expect(cdcEvent.detailType).toBe('{CDC_EVENT}');
  }, 120_000);
});
```

**Exemplary references**: `services/advisory/advisory-narrative-ctrl/`, `services/advisory/market-intelligence-ctrl/`

## Mock Lambda (Pattern A only)

If the service needs a `build-mock` target:

1. Create `test/mocks/mock-{api-name}.ts` with a simple HTTP handler
2. Add `build-mock` target to `project.json`:
   ```json
   "build-mock": {
     "executor": "nx:run-commands",
     "options": {
       "commands": [
         "esbuild test/mocks/mock-{api-name}.ts --bundle --platform=node --target=node20 --outfile=test/mocks/mock-{api-name}.js",
         "cd test/mocks && zip mock-{api-name}.zip mock-{api-name}.js"
       ],
       "cwd": "services/{domain}/{service}",
       "parallel": false
     }
   }
   ```
3. Build before running tests: `pnpm nx run {service}:build-mock`

## Ingress Event Coverage

Read the service's Ingress subscriptions from `service.stack.ts` or the CLAUDE.md card. Write at least one test per subscribed event type:
- Events that write to DDB + emit CDC: Pattern B assertions (DDB + EventBusTrap)
- Events that trigger agent invocations: Pattern E assertions (AgentInvocation DDB + CDC)
- Events handled by skip(): drain assertion (wait 15s + drain + assert empty)

## Anti-Patterns
- NEVER use DdbSeedFixture -- all state must be created via events (project convention)
- NEVER wrap CDC assertions in try/catch -- fix the root cause if flaky
- NEVER use `describe.skip` without documenting the reason
- NEVER omit `table.registerCleanup()` -- items accumulate across runs
- NEVER deploy fixtures inside `it()` blocks -- always in `beforeAll`
- NEVER use scan-based DDB assertions -- always pk/sk or pk/skPrefix
- NEVER put integration tests under `src/__tests__/` or `test/` root
- NEVER assert against specific timing -- use polling with timeouts
