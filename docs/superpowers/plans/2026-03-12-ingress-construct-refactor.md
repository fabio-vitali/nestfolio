# Ingress Construct Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Ingress own the event listener Lambda creation — eliminate ~10 lines of boilerplate per service stack and encapsulate State/bus wiring.

**Architecture:** Ingress currently accepts an external `handler: IFunction`. After refactor, it accepts `entry` (handler path) + `state` (State construct) + `serviceName` and creates the Lambda internally — mirroring how Egress already creates its publisher Lambda. The Lambda gets `TABLE_NAME`/`BUCKET_NAME`/`BUS_NAME`/`SERVICE_NAME` env vars and IAM grants automatically based on what State contains.

**Tech Stack:** AWS CDK (TypeScript), NodejsFunction, State construct, EventBridge, SQS, Jest + CDK Template assertions

---

## File Structure

| File | Responsibility | Action |
|------|---------------|--------|
| `libs/cdk-constructs/src/ingress.ts` | Ingress construct — EventBridge→SQS→Lambda wiring | **Modify**: create Lambda internally |
| `libs/cdk-constructs/test/ingress.test.ts` | Ingress CDK template assertions | **Modify**: add Lambda/State/bus tests |
| `services/*/src/service.stack.ts` (11 files) | Service CDK stacks | **Modify**: remove boilerplate, use new Ingress API |

## Chunk 1: Refactor Ingress Construct (TDD)

### Task 1: Write failing tests for new Ingress Lambda creation

**Files:**
- Modify: `libs/cdk-constructs/test/ingress.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace the entire test file. The new `createStack()` helper creates a `State` (which existing tests didn't need). All existing SQS tests are preserved but use the new props.

```ts
import { App, Duration, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { EventBus } from 'aws-cdk-lib/aws-events';
import { Ingress } from '../src/ingress';
import { State } from '../src/state';

describe('Ingress construct', () => {
  function createIngress(overrides: Record<string, unknown> = {}) {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    const bus = new EventBus(stack, 'Bus');
    const state = new State(stack, 'TestState', {
      withBucket: (overrides['withBucket'] as boolean) ?? false,
      withTable: (overrides['withTable'] as boolean) ?? true,
    });

    const ingress = new Ingress(stack, 'TestIngress', {
      eventBus: bus,
      eventTypes: ['TestEvent'],
      entry: '/tmp/handler.ts',
      serviceName: 'test-svc',
      state,
      ...(overrides['ingressOverrides'] as Record<string, unknown> ?? {}),
    });

    return { stack, bus, state, ingress, template: Template.fromStack(stack) };
  }

  describe('Lambda creation', () => {
    it('creates a NodejsFunction with SERVICE_NAME and BUS_NAME env vars', () => {
      const { template } = createIngress();
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            SERVICE_NAME: 'test-svc',
            BUS_NAME: Match.anyValue(),
          }),
        },
      });
    });

    it('sets TABLE_NAME when state has a table', () => {
      const { template } = createIngress();
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({ TABLE_NAME: Match.anyValue() }),
        },
      });
    });

    it('sets BUCKET_NAME when state has a bucket', () => {
      const { template } = createIngress({ withBucket: true });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({ BUCKET_NAME: Match.anyValue() }),
        },
      });
    });

    it('sets both TABLE_NAME and BUCKET_NAME when state has both', () => {
      const { template } = createIngress({ withBucket: true });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            TABLE_NAME: Match.anyValue(),
            BUCKET_NAME: Match.anyValue(),
          }),
        },
      });
    });

    it('omits TABLE_NAME when state has no table', () => {
      const { template } = createIngress({ withTable: false, withBucket: true });
      // Should NOT have TABLE_NAME
      const fns = template.findResources('AWS::Lambda::Function');
      const fnKey = Object.keys(fns).find(k =>
        fns[k].Properties?.Environment?.Variables?.SERVICE_NAME === 'test-svc',
      );
      expect(fnKey).toBeDefined();
      expect(fns[fnKey!].Properties.Environment.Variables.TABLE_NAME).toBeUndefined();
    });

    it('merges extra environment variables', () => {
      const { template } = createIngress({
        ingressOverrides: { environment: { CUSTOM_VAR: 'custom-value' } },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({ CUSTOM_VAR: 'custom-value' }),
        },
      });
    });

    it('applies lambdaProps overrides', () => {
      const { template } = createIngress({
        ingressOverrides: { lambdaProps: { memorySize: 512 } },
      });
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
      });
    });

    it('exposes handler property', () => {
      const { ingress } = createIngress();
      expect(ingress.handler).toBeDefined();
    });
  });

  describe('IAM grants', () => {
    it('grants DynamoDB read/write when state has table', () => {
      const { template } = createIngress();
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['dynamodb:BatchGetItem']),
            }),
          ]),
        },
      });
    });

    it('grants PutEvents on the event bus', () => {
      const { template } = createIngress();
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'events:PutEvents',
            }),
          ]),
        },
      });
    });
  });

  describe('SQS config', () => {
    it('applies custom batchSize and maxRetries', () => {
      const { template } = createIngress({
        ingressOverrides: { batchSize: 5, maxRetries: 2 },
      });
      template.hasResourceProperties('AWS::SQS::Queue', {
        RedrivePolicy: { maxReceiveCount: 2 },
      });
    });

    it('auto-calculates visibilityTimeout from lambdaTimeout (6x)', () => {
      const { template } = createIngress({
        ingressOverrides: { lambdaTimeout: Duration.seconds(30) },
      });
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 180,
      });
    });

    it('explicit visibilityTimeout takes precedence over lambdaTimeout', () => {
      const { template } = createIngress({
        ingressOverrides: {
          lambdaTimeout: Duration.seconds(30),
          visibilityTimeout: Duration.seconds(60),
        },
      });
      template.hasResourceProperties('AWS::SQS::Queue', {
        VisibilityTimeout: 60,
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test cdk-constructs -- --testPathPattern=ingress`
Expected: FAIL — `IngressProps` no longer accepts `entry`/`state`/`serviceName`

- [ ] **Step 3: Commit failing tests**

```bash
git add libs/cdk-constructs/test/ingress.test.ts
git commit -m "test(cdk-constructs): add failing Ingress Lambda creation tests"
```

### Task 2: Implement new Ingress construct

**Files:**
- Modify: `libs/cdk-constructs/src/ingress.ts`

- [ ] **Step 4: Rewrite Ingress to create Lambda internally**

```ts
import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { IEventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { State } from './state';
import { defaultLambdaProps } from './default-lambda-props';

export interface IngressProps {
  eventBus: IEventBus;
  eventTypes: string[];
  /** Path to the event listener handler file */
  entry: string;
  /** Service name — sets SERVICE_NAME env var */
  serviceName: string;
  /** State construct — auto-wires TABLE_NAME/BUCKET_NAME env vars and IAM grants */
  state: State;
  /** Extra environment variables merged into the Lambda */
  environment?: Record<string, string>;
  /** Override defaultLambdaProps (e.g. timeout, memorySize) */
  lambdaProps?: Partial<NodejsFunctionProps>;
  batchSize?: number;
  maxBatchingWindowMs?: number;
  /** Maximum batching window as CDK Duration. Takes precedence over maxBatchingWindowMs. */
  maxBatchingWindow?: Duration;
  maxRetries?: number;
  /** Visibility timeout for the SQS queue. If not set but lambdaTimeout is provided, auto-calculated as 6x lambdaTimeout. */
  visibilityTimeout?: Duration;
  /** Lambda timeout. Used to auto-calculate visibilityTimeout = 6 x lambdaTimeout when visibilityTimeout is not set. */
  lambdaTimeout?: Duration;
}

export class Ingress extends Construct {
  readonly handler: NodejsFunction;
  readonly queue: Queue;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: IngressProps) {
    super(scope, id);

    // Build environment from State + bus + extras
    const env: Record<string, string> = {
      SERVICE_NAME: props.serviceName,
      BUS_NAME: props.eventBus.eventBusName,
    };
    if (props.state.table) {
      env['TABLE_NAME'] = props.state.getTable().tableName;
    }
    if (props.state.bucket) {
      env['BUCKET_NAME'] = props.state.getBucket().bucketName;
    }
    if (props.environment) {
      Object.assign(env, props.environment);
    }

    // Create Lambda
    this.handler = new NodejsFunction(this, 'Handler', {
      ...defaultLambdaProps(this),
      ...props.lambdaProps,
      entry: props.entry,
      environment: env,
    });

    // IAM: State grants
    if (props.state.table) {
      props.state.getTable().grantReadWriteData(this.handler);
    }
    if (props.state.bucket) {
      props.state.getBucket().grantReadWrite(this.handler);
    }

    // IAM: PutEvents for publishErrorEvent
    this.handler.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [
        `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${props.eventBus.eventBusName}`,
      ],
    }));

    // SQS: DLQ + Queue
    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    const visibilityTimeout = props.visibilityTimeout
      ?? (props.lambdaTimeout
        ? Duration.seconds(6 * props.lambdaTimeout.toSeconds())
        : Duration.seconds(180));

    this.queue = new Queue(this, 'Queue', {
      visibilityTimeout,
      encryption: QueueEncryption.KMS_MANAGED,
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: props.maxRetries ?? 10,
      },
    });

    // EventBridge Rule → SQS
    new Rule(this, 'Rule', {
      eventBus: props.eventBus,
      eventPattern: { detailType: props.eventTypes },
      targets: [new SqsQueue(this.queue)],
    });

    // SQS → Lambda
    const batchingWindow = props.maxBatchingWindow
      ?? Duration.millis(props.maxBatchingWindowMs ?? 1000);

    this.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize: props.batchSize ?? 10,
      maxBatchingWindow: batchingWindow,
      reportBatchItemFailures: true,
    }));
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx nx test cdk-constructs -- --testPathPattern=ingress`
Expected: PASS — all tests green

- [ ] **Step 6: Run full cdk-constructs suite to check no regressions**

Run: `npx nx test cdk-constructs`
Expected: PASS — all 77+ tests green

- [ ] **Step 7: Commit**

```bash
git add libs/cdk-constructs/src/ingress.ts libs/cdk-constructs/test/ingress.test.ts
git commit -m "feat(cdk-constructs): Ingress creates event listener Lambda internally"
```

## Chunk 2: Simplify Service Stacks

All 11 stacks follow the same transformation. For each: remove manual Lambda creation, PolicyStatement, and use new Ingress API. Replace `eventListener` references with `ingress.handler`.

### Task 3: Simplify investor-domain stacks (3 stacks)

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`
- Modify: `services/investor/investor-ctrl/src/service.stack.ts`
- Modify: `services/investor/dashboard-bff/src/service.stack.ts`

- [ ] **Step 8: Simplify investor-bff stack**

In `services/investor/investor-bff/src/service.stack.ts`:

Remove from imports: `NodejsFunction`, `PolicyStatement`, `defaultLambdaProps`.

Replace lines 37–58 (event listener + ingress creation):

```ts
    // Ingress: EventBridge -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'InvestorBus', naming.eventBusName()),
      eventTypes: [
        'USER_REGISTERED',
        'NOTIFICATION_CREATED',
        'BALANCE_UPDATED',
      ],
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      serviceName: 'investor-bff',
      state,
    });
```

Replace all remaining `eventListener` → `ingress.handler` (Monitoring + ServiceDashboard).

- [ ] **Step 9: Simplify investor-ctrl stack**

Same pattern. Remove `NodejsFunction`, `PolicyStatement`, `defaultLambdaProps` imports. Replace event listener + ingress with single Ingress block. Replace `eventListener` → `ingress.handler`.

- [ ] **Step 10: Simplify dashboard-bff stack**

Same pattern. Note: dashboard-bff has no Egress (pure read model) — simpler stack.

- [ ] **Step 11: Run investor-domain tests**

Run: `npx nx run-many -t test -p investor-bff investor-ctrl dashboard-bff`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add services/investor/*/src/service.stack.ts
git commit -m "refactor(investor): simplify stacks to use new Ingress API"
```

### Task 4: Simplify advisory-domain stacks (3 stacks)

**Files:**
- Modify: `services/advisory/advisory-bff/src/service.stack.ts`
- Modify: `services/advisory/advisory-ctrl/src/service.stack.ts` (special case: extra env vars)
- Modify: `services/advisory/compliance-ctrl/src/service.stack.ts`

- [ ] **Step 13: Simplify advisory-bff stack**

Same pattern as investor-bff.

- [ ] **Step 14: Simplify advisory-ctrl stack (special case)**

This stack needs `MODEL_*_SSM` env vars added after Ingress creation. Use `ingress.handler.addEnvironment()`:

```ts
    // Ingress: advisory EventBridge bus -> SQS -> event-listener
    const ingress = new Ingress(this, 'Ingress', {
      eventBus: EventBus.fromEventBusName(this, 'AdvisoryBus', naming.eventBusName()),
      eventTypes: [
        'MANDATE_GRANTED', 'GOAL_UPDATED', 'RISK_PROFILE_UPDATED',
        'OPERATING_MODE_CHANGED', 'PORTFOLIO_DRIFT_DETECTED',
        'ORDER_FILLED', 'ORDER_REJECTED', 'ORDER_CANCELLED',
        'DEPOSIT_DETECTED', 'DECISION_APPROVED', 'DECISION_BLOCKED',
        'USER_CONFIRMED', 'USER_REJECTED',
      ],
      entry: join(__dirname, 'handlers', 'event-listener.ts'),
      serviceName: 'advisory-ctrl',
      state,
    });

    // ... SSM parameter reads stay as-is ...

    // Pass model SSM parameter names as env vars for runtime Lambda resolution
    ingress.handler.addEnvironment('MODEL_OPUS_SSM', hubNaming.ssmParameterPath('models/opus'));
    ingress.handler.addEnvironment('MODEL_SONNET_SSM', hubNaming.ssmParameterPath('models/sonnet'));
    ingress.handler.addEnvironment('MODEL_HAIKU_SSM', hubNaming.ssmParameterPath('models/haiku'));
```

Keep `NodejsFunction` and `defaultLambdaProps` imports — still needed for tool target Lambdas (portfolioLookupFn, etc.).
Keep `PolicyStatement` import — still needed for eventPublisherFn.
Replace `eventListener` → `ingress.handler` in Monitoring + ServiceDashboard.

- [ ] **Step 15: Simplify compliance-ctrl stack**

Same standard pattern.

- [ ] **Step 16: Run advisory-domain tests**

Run: `npx nx run-many -t test -p advisory-bff advisory-ctrl compliance-ctrl`
Expected: PASS

- [ ] **Step 17: Commit**

```bash
git add services/advisory/*/src/service.stack.ts
git commit -m "refactor(advisory): simplify stacks to use new Ingress API"
```

### Task 5: Simplify execution-domain stacks (2 stacks)

**Files:**
- Modify: `services/execution/execution-ctrl/src/service.stack.ts`
- Modify: `services/execution/execution-adpt/src/service.stack.ts`

- [ ] **Step 18: Simplify execution-ctrl stack**

Standard pattern.

- [ ] **Step 19: Simplify execution-adpt stack**

Standard pattern.

- [ ] **Step 20: Run execution-domain tests**

Run: `npx nx run-many -t test -p execution-ctrl execution-adpt`
Expected: PASS

- [ ] **Step 21: Commit**

```bash
git add services/execution/*/src/service.stack.ts
git commit -m "refactor(execution): simplify stacks to use new Ingress API"
```

### Task 6: Simplify ledger-domain stacks (3 stacks)

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/service.stack.ts` (special case: keeps reducerFn)
- Modify: `services/ledger/ledger-bff/src/service.stack.ts` (special case: keeps resolver Lambda)
- Modify: `services/ledger/reconciliation-ctrl/src/service.stack.ts`

- [ ] **Step 22: Simplify ledger-ctrl stack**

Standard Ingress pattern. The `reducerFn` (DDB Stream consumer) stays as-is — it's a separate Lambda that reads from `state.getTable()` directly, not an Ingress concern.

Note: uses `EventBus.fromEventBusArn()` — passes into `eventBus` prop same as before.

Keep `NodejsFunction`, `defaultLambdaProps` imports — needed for `reducerFn`.
Keep `PolicyStatement` — needed for `reducerFn` if applicable. Check if removable.
Replace `eventListener` → `ingress.handler` in Monitoring + ServiceDashboard.

- [ ] **Step 23: Simplify ledger-bff stack**

Standard Ingress pattern. The `resolver` Lambda (for `getPortfolioAt`/`getSimulationComparison`) stays as-is — separate Lambda for Facade `lambdaResolvers`.

Keep `NodejsFunction`, `defaultLambdaProps` imports — needed for `resolver`.
Keep `PolicyStatement` — needed for `resolver`.

- [ ] **Step 24: Simplify reconciliation-ctrl stack**

Standard pattern. Cleanest of the ledger stacks.

- [ ] **Step 25: Run ledger-domain tests**

Run: `npx nx run-many -t test -p ledger-ctrl ledger-bff reconciliation-ctrl`
Expected: PASS

- [ ] **Step 26: Commit**

```bash
git add services/ledger/*/src/service.stack.ts
git commit -m "refactor(ledger): simplify stacks to use new Ingress API"
```

### Task 7: Full verification

- [ ] **Step 27: Run all project tests**

Run: `npx nx run-many -t test --all`
Expected: All 31 projects PASS

- [ ] **Step 28: Verify no leftover references to old pattern**

Run: `grep -r "handler: eventListener" services/` — should return nothing
Run: `grep -r "state.getTable().grantReadWriteData(eventListener)" services/` — should return nothing