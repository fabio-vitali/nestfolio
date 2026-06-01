---
name: testing-patterns
description: Test conventions — directory layout, event-processor harness, CDK assertions, naming. Use when writing or modifying tests.
---

## When This Skill Applies
- Writing tests for a new handler
- Adding CDK infrastructure tests
- Fixing or extending existing tests

## Directory Convention
```
services/{domain}/{service}/
  test/                          <- ALL tests here, NOT src/__tests__/
    unit/                        <- unit tests (mirrors src/ structure)
      handlers/
        my-handler.test.ts       <- handler unit test
      service.stack.test.ts      <- CDK assertion test
    integration/                 <- integration tests (see create-integration-test skill)
```

## Handler Tests

```typescript
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { handlers } from '../../src/handlers/my-handler';

describe('my-handler', () => {
  const harness = createTestHarness({ serviceName: 'my-service', handlers });

  it('processes EVENT_TYPE_A', async () => {
    const result = await harness.process([
      fakeSqsRecord('EVENT_TYPE_A', { id: '123', tenantId: 't1', status: 'ACTIVE' }),
    ]);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      _tag: 'record',
      typename: expect.any(String),
      fields: expect.objectContaining({ id: '123' }),
    });
    expect(result.errors).toHaveLength(0);
  });

  it('skips unknown events', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN', {}),
    ]);
    expect(result.skipped).toBe(1);
  });
});
```

## Version-Guard & Stale-Drop Tests (P1 projections)

Any `Projection<'P1'>` written via `projectVersioned` must be tested for BOTH the
fresh-write and the stale-drop path — a stale/equal `__version` is dropped as
deduplicated (terminal), NOT redriven (see `docs/architecture/READ-MODEL-OWNERSHIP.md`
§5). Use the helpers from `@nestfolio/test-support`:

```typescript
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { expectVersionedWrite, expectStaleDrop } from '@nestfolio/test-support';
import { handlers } from '../../src/handlers/my-projection';

describe('my-projection (P1 version guard)', () => {
  const harness = createTestHarness({ serviceName: 'my-bff', handlers });

  it('applies a fresh (higher-version) event', async () => {
    const r = await harness.process([
      fakeSqsRecord('SNAPSHOT_UPDATED', { tenantId: 't1', lastEventSequence: 5 /* ... */ }),
    ]);
    expectVersionedWrite(r.intents[0]); // success, not deduplicated
  });

  it('drops a stale (lower-or-equal version) event without redrive', async () => {
    await harness.process([fakeSqsRecord('SNAPSHOT_UPDATED', { tenantId: 't1', lastEventSequence: 5 })]);
    const r = await harness.process([
      fakeSqsRecord('SNAPSHOT_UPDATED', { tenantId: 't1', lastEventSequence: 3 }),
    ]);
    expectStaleDrop(r.intents[0]); // success + deduplicated === true
  });
});
```

`expectVersionedWrite(result)` asserts `success && !deduplicated`; `expectStaleDrop(result)`
asserts `success && deduplicated === true`. A P1 projection without a stale-drop test
is a gap the `event-processor:read-model-drift` gate cannot catch (it is a behavioral,
not structural, check).

## CDK Assertion Tests

```typescript
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MyStack } from '../../src/service.stack';

describe('MyStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new MyStack(app, 'Test', { prefix: 'test', service: 'my-svc', subsystem: '{domain}' });
    template = Template.fromStack(stack);
  });

  it('creates DynamoDB table', () => template.resourceCountIs('AWS::DynamoDB::Table', 1));
  it('creates SQS queues', () => template.hasResourceProperties('AWS::SQS::Queue', {}));
  it('creates EventBridge rules', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: expect.objectContaining({ 'detail-type': expect.arrayContaining(['EVENT_TYPE_A']) }),
    });
  });
});
```

## Running Tests
```bash
pnpm nx test {service}                           # all tests
pnpm nx test {service} -- --testPathPattern=foo   # specific test
```

## Integration Tests
For integration tests (real AWS, deployed services), use the dedicated skills:
- `create-integration-test` — scaffold config, write test files with correct fixtures
- `audit-integration-test` — verify coverage and convention compliance

**Required fixtures for all integration tests:**
- `OrphanReaper` — clean leaked AWS resources from crashed runs (call in `beforeAll`)
- `StateResetFixture` — clear stale global-key DDB items (when service uses singleton keys)
- Agent services (Pattern E) must use `MockApiFixture` + `SsmOverrideFixture` for mock agent runtime

## E2E Feature Tests
For end-to-end feature tests (cross-domain, black-box via BFF GraphQL), use the dedicated skills:
- `create-e2e-test` — scaffold scenarios with composable fixtures and GraphQL assertions
- `audit-e2e-test` — verify coverage across feature domains and convention compliance

## Anti-Patterns
- NEVER put tests in `src/__tests__/`
- NEVER test handlers without the event-processor harness
- NEVER mock pipeline internals — test through the harness
- NEVER skip CDK assertion tests for stack changes

## Trap-fixture cleanup pattern

When using `EventBusTrap`, follow **one** of these two patterns:

### Pattern A — shared trap (preferred for read-only assertions)

```ts
let ctx: TestContext;
let trap: EventBusTrap;

beforeAll(async () => {
  ctx = await createTestContext();
  trap = new EventBusTrap(ctx);
  await trap.deploy({ bus: 'advisory', detailType: 'MANDATE_ISSUED' });
});

afterAll(async () => {
  await ctx.cleanup.runAll();
});
```

### Pattern B — fresh ctx per test (preferred for resilience / idempotency assertions)

```ts
it('handles redelivery idempotently', async () => {
  const ctx = await createTestContext();
  try {
    const trap = new EventBusTrap(ctx);
    await trap.deploy({ bus: 'advisory', detailType: 'MANDATE_ISSUED' });
    // ... test body
  } finally {
    await ctx.cleanup.runAll();
  }
});
```

### Never `beforeEach`+`afterAll`

`beforeEach`-created traps leak their EB rule + SQS queue on `jest.retryTimes(1)` retries until `OrphanReaper` runs (1+ hour later). Each retry roughly doubles rule churn on the bus.
