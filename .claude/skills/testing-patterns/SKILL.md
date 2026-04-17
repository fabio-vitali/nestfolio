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
