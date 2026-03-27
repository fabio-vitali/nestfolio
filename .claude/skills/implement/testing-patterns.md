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
    my-handler.test.ts           <- handler unit test
    service.stack.test.ts        <- CDK assertion test
```

## Handler Tests

```typescript
import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor/testing';
import { handlers } from '../src/handlers/my-handler';

describe('my-handler', () => {
  const harness = createTestHarness({ serviceName: 'my-service', handlers });

  it('processes EVENT_TYPE_A', async () => {
    const result = await harness.process([
      fakeSqsRecord({
        detailType: 'EVENT_TYPE_A',
        detail: { subject: { id: '123', tenantId: 't1', status: 'ACTIVE' } },
      }),
    ]);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ type: 'record', item: expect.objectContaining({ pk: '123' }) });
    expect(result.errors).toHaveLength(0);
  });

  it('skips unknown events', async () => {
    const result = await harness.process([
      fakeSqsRecord({ detailType: 'UNKNOWN', detail: { subject: {} } }),
    ]);
    expect(result.skipped).toBe(1);
  });
});
```

## CDK Assertion Tests

```typescript
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { MyStack } from '../src/service.stack';

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

## Anti-Patterns
- NEVER put tests in `src/__tests__/`
- NEVER test handlers without the event-processor harness
- NEVER mock pipeline internals — test through the harness
- NEVER skip CDK assertion tests for stack changes
