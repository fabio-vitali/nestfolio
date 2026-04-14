---
name: create-e2e-test
description: Scaffold a new E2E feature test scenario — choose domain, compose fixtures, write test file, add GraphQL types. Use when adding end-to-end scenarios to apps/e2e-feature-tests.
---

## When This Skill Applies
- Adding a new user-facing scenario to E2E feature tests
- Expanding coverage for an existing feature domain
- Writing a regression test for a cross-domain bug discovered in production

## Prerequisites

Before writing a new scenario:

1. Read `apps/e2e-feature-tests/src/helpers/fixtures.ts` — understand available fixtures and the `Fixture` type
2. Read `apps/e2e-feature-tests/src/helpers/graphql-types.ts` — check if response types already exist
3. Scan existing scenarios in the target domain folder — avoid duplicating coverage
4. Identify which BFF GraphQL queries/mutations the scenario exercises — read the relevant BFF's `src/facade/resolvers/` to confirm field names

## Checklist

- [ ] 1. **Choose feature domain folder** — one of: `funding/`, `profile/`, `advisory/`, `account/`, `notifications/`, or create a new domain folder if none fits
- [ ] 2. **Determine test pattern** (A, B, or C — see below)
- [ ] 3. **Compose fixture chain** — reuse existing fixtures (`onboarded()`, `funded()`, `withDecision()`, `withNotification()`, `withHoldings()`); author new ones only if needed
- [ ] 4. **Add GraphQL response types** to `helpers/graphql-types.ts` if the scenario uses new queries/mutations
- [ ] 5. **Write the test file** at `src/{domain}/{scenario-name}.e2e.test.ts`
- [ ] 6. **Update moduleNameMapper** in `jest.config.js` if importing event types from a service not yet mapped
- [ ] 7. **Run the scenario** — `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern={domain}/{scenario-name}`
- [ ] 8. **Add helper unit tests** — if you authored a new fixture or helper, add a corresponding test in `test/helpers/`

## Test Patterns

### Pattern A — Mutation-Triggered

User performs a BFF mutation; assert the downstream effect via GraphQL polling.

**Use when:** the scenario starts with a user action (deposit, withdraw, confirm, mark-read).

```typescript
import {
  createTestContext,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario N — {user action description}', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('{mutation} surfaces {expected effect} via {query}', async () => {
    const bff = bffClient(ctx, tenant);

    // TRIGGER: execute the mutation
    const result = await bff.{service}.mutate<{ {mutationName}: { field: string } }>(
      `mutation M($input: InputType!) {
         {mutationName}(input: $input) { field }
       }`,
      { input: { /* ... */ } },
    );
    expect(result.{mutationName}.field).toBe('EXPECTED');

    // ASSERT: poll a read-model query until the downstream effect materializes
    await waitForGraphQL<{ {queryName}: { /* ... */ } }>(
      bff.{readService},
      `query Q { {queryName} { field } }`,
      {},
      (r) => /* predicate */,
      { timeoutMs: 120_000 },
    );
  });
});
```

**Exemplary:** `src/funding/fund-account.e2e.test.ts`, `src/notifications/mark-notification-read.e2e.test.ts`

### Pattern B — Event-Triggered

Publish a synthetic event on a domain bus; assert the downstream effect via GraphQL polling.

**Use when:** the scenario starts with a system event (mandate created, drift detected, balance updated).

```typescript
import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario N — {event-driven description}', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    await applyFixtures(ctx, tenant, [onboarded()]);
  }, 180_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('{EVENT_TYPE} triggers {downstream effect} visible in {query}', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // TRIGGER: publish synthetic event on domain bus
    await eb.putEvent({
      bus: '{domain}',
      targetService: '{consuming-service}',
      detailType: '{EVENT_TYPE}',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        // ... event-specific fields
      },
    });

    // ASSERT: poll BFF query until effect materializes
    const result = await waitForGraphQL<{ {queryName}: { /* ... */ } }>(
      bff.{service},
      `query Q { {queryName} { field } }`,
      {},
      (r) => /* predicate */,
      { timeoutMs: 240_000, intervalMs: 5_000 },
    );
    expect(result.{queryName}).toMatchObject({ /* ... */ });
  });
});
```

**Exemplary:** `src/advisory/first-decision.e2e.test.ts`, `src/advisory/rebalance-on-drift.e2e.test.ts`

### Pattern C — Multi-Step (Fixture Chain + Mutation + Cross-Domain)

Compose a fixture chain to reach a precondition, trigger via mutation, then publish a synthetic downstream event to simulate a cross-domain effect.

**Use when:** the scenario spans multiple domains (e.g., confirm decision → simulate fill → check portfolio).

```typescript
import {
  createTestContext,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  freshTenant,
  applyFixtures,
  onboarded,
  funded,
  withDecision,
  bffClient,
  waitForGraphQL,
  type FreshTenant,
} from '..';

describe('scenario N — {multi-step description}', () => {
  let ctx: TestContext;
  let tenant: FreshTenant;
  let decisionId: string;

  beforeEach(async () => {
    ctx = await createTestContext();
    tenant = await freshTenant(ctx);
    const result = await applyFixtures(ctx, tenant, [
      onboarded(),
      funded({ cashBalanceCents: 1_000_000 }),
      withDecision({ trigger: 'INITIAL_ALLOCATION' }),
    ]);
    decisionId = result.decisionId as string;
  }, 120_000);

  afterEach(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  it('{action} followed by {downstream event} surfaces in {cross-domain query}', async () => {
    const bff = bffClient(ctx, tenant);
    const eb = new EventBridgeClient(ctx);

    // STEP 1: Wait for fixture to materialize before acting
    await waitForGraphQL<{ getDecision: { decisionId: string } | null }>(
      bff.advisory,
      `query Q($id: ID!) { getDecision(decisionId: $id) { decisionId } }`,
      { decisionId },
      (r) => r.getDecision != null,
      { timeoutMs: 60_000 },
    );

    // STEP 2: User action (mutation)
    const confirm = await bff.advisory.mutate<{
      confirmDecision: { decisionId: string; status: string };
    }>(
      `mutation Confirm($id: ID!) { confirmDecision(decisionId: $id) { decisionId status } }`,
      { decisionId },
    );
    expect(confirm.confirmDecision.status).toBe('CONFIRMED');

    // STEP 3: Simulate cross-domain downstream event
    await eb.putEvent({
      bus: 'ledger',
      targetService: 'ledger-ctrl',
      detailType: 'ORDER_FILLED',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        orderId: `e2e-order-${Date.now()}`,
        decisionId,
        symbol: 'VTI',
        side: 'BUY',
        quantity: 10,
        fillPrice: 200,
        filledAt: new Date().toISOString(),
      },
    });

    // ASSERT: cross-domain read-model reflects the effect
    await waitForGraphQL<{
      getPortfolio: { positions: Array<{ symbol: string; quantity: number }> };
    }>(
      bff.ledger,
      `query P { getPortfolio { positions { symbol quantity } } }`,
      {},
      (r) => (r.getPortfolio?.positions ?? []).some((p) => p.symbol === 'VTI'),
      { timeoutMs: 120_000 },
    );
  });
});
```

**Exemplary:** `src/advisory/accept-decision.e2e.test.ts`

## Authoring New Fixtures

When existing fixtures don't cover your precondition, author a new one:

```typescript
// In helpers/fixtures.ts

export function withMyPrecondition(opts: { field: string }): Fixture {
  return async (_ctx, tenant, eb, bff) => {
    const id = `e2e-thing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // 1. Publish the event that creates the precondition
    await eb.putEvent({
      bus: '{domain}',
      targetService: '{service}',
      detailType: '{EVENT_TYPE}',
      detail: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        id,
        ...opts,
      },
    });

    // 2. OPTIONAL: poll GraphQL to confirm materialization before returning
    //    Do this if downstream fixtures or the test depend on this being visible.
    await waitForGraphQL<{ getMyThing: { id: string } | null }>(
      bff.{service},
      `query Q($id: ID!) { getMyThing(id: $id) { id } }`,
      { id },
      (r) => r.getMyThing != null,
      { timeoutMs: 60_000 },
    );

    return { myThingId: id };
  };
}
```

**Rules:**
- Fixtures receive `(ctx, tenant, eb, bff)` — use them, don't construct your own clients
- Return identifiers as `FixtureResult` so downstream fixtures/tests can reference them
- Add a materialization gate (`waitForGraphQL`) if downstream code depends on the precondition being visible
- Export the new fixture from `src/index.ts`

## Event Publishing Rules

- **Bus targeting:** publish on the bus whose Ingress subscription matches the event. Check the consuming service's `service.stack.ts` Ingress construct.
- **Cross-domain shortcut:** when a real cross-domain event would require adapter forwarding (which doesn't match `e2e-` source), publish directly on the destination domain bus with `targetService` set to the destination service.
- **Standard envelope:** `EventBridgeClient.putEvent()` embeds `tenantId`/`userId`/`region` automatically — don't duplicate them in `detail`.
- **Field names:** match the consuming handler's schema exactly. E.g., `fillPrice` is per-share dollars (not cents), `filledAt` is ISO timestamp.

## Timeout Hierarchy

| Phase | Timeout | Rationale |
|-------|---------|-----------|
| `beforeEach` | 120_000–180_000 ms | Fixture chain: Cognito user + event publishing + materialization polling |
| Test body (`it`) | 300_000 ms (jest.config) | Cross-domain CDC lag can be 60–240s |
| `afterEach` | 60_000 ms | Cognito user deletion + client cleanup |
| `waitForGraphQL` default | 60_000 ms | Single CDC hop |
| `waitForGraphQL` cross-domain | 120_000–240_000 ms | Multiple CDC hops, SF orchestration |

## Running

```bash
# Single scenario
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPattern={domain}/{scenario}

# All scenarios
NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features
```

## Anti-Patterns

- **NEVER assert via DynamoDB** — E2E tests are black-box; all assertions go through BFF GraphQL queries. Use `waitForGraphQL`, never `GetCommand`/`QueryCommand` in test bodies.
- **NEVER use EventBusTrap or TableAssertions** — those are integration test fixtures. E2E tests verify user-visible effects only.
- **NEVER wrap waitForGraphQL in try/catch** — let timeouts surface as test failures. Swallowing them hides broken CDC chains.
- **NEVER hardcode tenant/user IDs** — always use `freshTenant()` which creates a unique Cognito user per test run.
- **NEVER use `integ-` prefix** — `freshTenant()` replaces it with `e2e-` to route through prod source format. Don't override this.
- **NEVER skip materialization gates in fixtures** — if a downstream fixture or test depends on a precondition being visible, the producing fixture must poll until it materializes. The `onboarded()` fixture's `waitForGraphQL` for `getProfile` is the canonical example.
- **NEVER put fixture setup inside `it()` blocks** — all preconditions go in `beforeEach` via `applyFixtures()`. The test body contains only triggers and assertions.
- **NEVER use `describe.skip` without a documented reason** — add a comment explaining why and link to the blocking issue.
- **NEVER import from `@nestfolio/integration-testing`** — E2E tests use `@nestfolio/test-support` exclusively.
- **NEVER use `fillPrice` in cents** — broker events use per-share dollars. This was a real bug (scenario 6).
- **NEVER publish on a domain bus expecting adapter forwarding** — adapters filter on source prefix; `e2e-` source bypasses this. Publish directly on the destination bus with the correct `targetService`.
