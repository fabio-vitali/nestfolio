# Circuit Breaker Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move circuit breaker ownership from broker-ctrl to broker-alpaca-adpt with a global per-adapter key, add investor feature flags + notifications, clean up dead advisory CB scaffolding.

**Architecture:** broker-alpaca-adpt detects Alpaca failures, opens a global `CircuitBreaker#alpaca` breaker, and runs a generic CDK-construct-based HealStateMachine using SF HTTP:Invoke. Events flow via investor-adpt to investor-bff (feature flags with real-time AppSync subscriptions) and investor-ctrl (notifications). Frontend disables gated mutations via a shared feature-flags Angular lib.

**Tech Stack:** CDK (aws-cdk-lib 2.243.0), Step Functions HTTP:Invoke, EventBridge Connections, AppSync (IAM + Cognito dual auth), Angular Signal Stores, NgRx Signals

**Spec:** `docs/superpowers/specs/2026-04-15-circuit-breaker-redesign-design.md`

---

## Phase 1: Cleanup — Remove Advisory Circuit Breaker Scaffolding

### Task 1: Remove CIRCUIT_BREAKER_TRIGGERED/RESET event type definitions

**Files:**
- Modify: `services/advisory/advisory-ctrl/src/domain/events.ts`
- Modify: `services/advisory/advisory-adpt/src/domain/events.ts`
- Modify: `services/execution/execution-adpt/src/domain/events.ts`
- Modify: `services/investor/investor-adpt/src/domain/events.ts`

- [ ] **Step 1: Remove from advisory-ctrl events**

In `services/advisory/advisory-ctrl/src/domain/events.ts`, remove the two lines:
```typescript
CIRCUIT_BREAKER_TRIGGERED: eventName('CIRCUIT_BREAKER_TRIGGERED'),
CIRCUIT_BREAKER_RESET: eventName('CIRCUIT_BREAKER_RESET'),
```

- [ ] **Step 2: Remove from advisory-adpt events**

In `services/advisory/advisory-adpt/src/domain/events.ts`, remove the same two lines.

- [ ] **Step 3: Remove from execution-adpt events**

In `services/execution/execution-adpt/src/domain/events.ts`, remove from `ExecutionIngestEventTypes`:
```typescript
CIRCUIT_BREAKER_TRIGGERED: eventName('CIRCUIT_BREAKER_TRIGGERED'),
CIRCUIT_BREAKER_RESET: eventName('CIRCUIT_BREAKER_RESET'),
```

- [ ] **Step 4: Remove from investor-adpt events**

In `services/investor/investor-adpt/src/domain/events.ts`, remove from `InvestorIngestEventTypes`:
```typescript
CIRCUIT_BREAKER_TRIGGERED: eventName('CIRCUIT_BREAKER_TRIGGERED'),
CIRCUIT_BREAKER_RESET: eventName('CIRCUIT_BREAKER_RESET'),
```

- [ ] **Step 5: Search for any remaining references**

Run: `pnpm nx affected --target=build --head=HEAD --base=HEAD~1 2>&1 | head -50`

If there are compile errors from removed event types, fix them.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-ctrl/src/domain/events.ts \
  services/advisory/advisory-adpt/src/domain/events.ts \
  services/execution/execution-adpt/src/domain/events.ts \
  services/investor/investor-adpt/src/domain/events.ts
git commit -m "refactor: remove CIRCUIT_BREAKER_TRIGGERED/RESET event type definitions"
```

### Task 2: Remove EB rules and Ingress subscriptions for advisory CB events

**Files:**
- Modify: `services/execution/execution-adpt/src/service.stack.ts`
- Modify: `services/investor/investor-adpt/src/service.stack.ts`
- Modify: `services/execution/execution-ctrl/src/service.stack.ts`

- [ ] **Step 1: Remove from execution-adpt EB rule**

In `services/execution/execution-adpt/src/service.stack.ts`, remove `ExecutionIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED` and `ExecutionIngestEventTypes.CIRCUIT_BREAKER_RESET` from the `fromAdvisoryEvents` array.

- [ ] **Step 2: Remove from investor-adpt EB rule**

In `services/investor/investor-adpt/src/service.stack.ts`, remove `InvestorIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED` and `InvestorIngestEventTypes.CIRCUIT_BREAKER_RESET` from the `fromAdvisoryEvents` array.

- [ ] **Step 3: Remove from execution-ctrl Ingress subscriptions**

In `services/execution/execution-ctrl/src/service.stack.ts`, remove `ExecutionIngestEventTypes.CIRCUIT_BREAKER_TRIGGERED` and `ExecutionIngestEventTypes.CIRCUIT_BREAKER_RESET` from the Ingress `eventTypes` array.

- [ ] **Step 4: Commit**

```bash
git add services/execution/execution-adpt/src/service.stack.ts \
  services/investor/investor-adpt/src/service.stack.ts \
  services/execution/execution-ctrl/src/service.stack.ts
git commit -m "refactor: remove advisory CB event routing and subscriptions"
```

### Task 3: Remove execution-ctrl skip handlers and tests

**Files:**
- Modify: `services/execution/execution-ctrl/src/handlers/event-listener.ts`
- Modify: `services/execution/execution-ctrl/test/unit/event-listener.test.ts`
- Modify: `services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts`

- [ ] **Step 1: Remove skip handlers**

In `services/execution/execution-ctrl/src/handlers/event-listener.ts`, remove the two handler entries:
```typescript
[AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_TRIGGERED]: async (_payload, ctx) => {
  logger.info('Circuit breaker triggered — execution paused', { eventId: ctx.eventId });
  return skip();
},

[AdvisoryCrossDomainEventTypes.CIRCUIT_BREAKER_RESET]: async (_payload, ctx) => {
  logger.info('Circuit breaker reset — execution resumed', { eventId: ctx.eventId });
  return skip();
},
```

Also remove the `AdvisoryCrossDomainEventTypes` import if no longer used.

- [ ] **Step 2: Remove unit tests**

In `services/execution/execution-ctrl/test/unit/event-listener.test.ts`, remove the test cases for `CIRCUIT_BREAKER_TRIGGERED` and `CIRCUIT_BREAKER_RESET`.

- [ ] **Step 3: Remove integration tests**

In `services/execution/execution-ctrl/test/integration/execution-ctrl.integration.test.ts`, remove the integration test cases for `CIRCUIT_BREAKER_TRIGGERED` and `CIRCUIT_BREAKER_RESET`.

- [ ] **Step 4: Run unit tests**

Run: `pnpm nx run execution-ctrl:test`
Expected: All remaining tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/execution/execution-ctrl/
git commit -m "refactor: remove advisory CB skip handlers and tests from execution-ctrl"
```

### Task 4: Delete old flow spec

**Files:**
- Delete: `flows/circuit-breaker.flow.yaml`

- [ ] **Step 1: Delete the file**

```bash
rm flows/circuit-breaker.flow.yaml
```

- [ ] **Step 2: Commit**

```bash
git add flows/circuit-breaker.flow.yaml
git commit -m "refactor: delete advisory circuit-breaker flow spec (replaced in Phase 9)"
```

---

## Phase 2: CDK Constructs

### Task 5: Enhance Orchestration construct with executionName support

**Files:**
- Modify: `libs/cdk-constructs/src/core/orchestration.ts`
- Modify: `libs/cdk-constructs/test/unit/orchestration.test.ts` (or create if needed)

- [ ] **Step 1: Write the failing test**

In the Orchestration test file, add a test:
```typescript
it('should set fixed execution name on SF target when executionName is provided', () => {
  const stack = new Stack();
  // ... setup state, definitionBody, eventBus
  const orchestration = new Orchestration(stack, 'TestOrch', {
    definitionBody: sfn.DefinitionBody.fromChainable(new sfn.Pass(stack, 'Pass')),
    triggers: [eventName('TEST_EVENT') as EventName],
    executionName: 'fixed-name',
  });

  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::Events::Rule', {
    Targets: Match.arrayWith([
      Match.objectLike({
        Arn: Match.anyValue(),
        // L1 override sets StepFunctionsParameters
      }),
    ]),
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run cdk-constructs:test -- --testPathPattern orchestration`
Expected: FAIL — `executionName` not accepted in props.

- [ ] **Step 3: Add executionName to OrchestrationProps**

In `libs/cdk-constructs/src/core/orchestration.ts`:

```typescript
export interface OrchestrationProps {
  state?: State;
  definitionBody: sfn.DefinitionBody;
  triggers: EventName[];
  timeout?: Duration;
  executionName?: string;  // NEW: fixed SF execution name for singleton guard
}
```

In the constructor, after the trigger rule creation loop, add the L1 override when `executionName` is provided:

```typescript
for (const eventType of props.triggers) {
  const rule = new Rule(this, `${eventType}Rule`, {
    eventBus,
    eventPattern: { detailType: [eventType] },
    targets: [
      new SfnStateMachine(this.stateMachine, {
        input: RuleTargetInput.fromEventPath('$.detail'),
        deadLetterQueue: this.dlq,
      }),
    ],
  });

  // Singleton guard: fixed execution name makes StartExecution idempotent
  if (props.executionName) {
    const cfnRule = rule.node.defaultChild as CfnRule;
    const targets = cfnRule.targets as unknown as Array<Record<string, unknown>>;
    if (targets?.[0]) {
      (targets[0] as Record<string, unknown>)['RoleArn'] = targets[0]['RoleArn'];
      // Override via addPropertyOverride for StepFunctionsParameters
    }
    cfnRule.addPropertyOverride('Targets.0.Id', `${eventType}Target`);
    // Note: SfnStateMachine target doesn't expose Name. Use L1 override:
    cfnRule.addPropertyOverride(
      'Targets.0.RoleArn',
      (rule.node.findChild(`${eventType}Rule`) as unknown as { role: { roleArn: string } })?.role?.roleArn,
    );
  }
}
```

**Implementation note:** The exact L1 override path for `StepFunctionsParameters.Name` on an EventBridge target may need investigation at implementation time. The CDK `SfnStateMachine` target creates a CloudFormation `AWS::Events::Rule` target. The `StepFunctionsParameters` can be set via:

```typescript
cfnRule.addPropertyOverride('Targets.0.InputTransformer', undefined);
// Actually, the cleaner approach:
```

**Alternative approach if L1 override is too complex:** Use a custom `Rule` + `CfnRule` target directly instead of the CDK `SfnStateMachine` target. Build the target JSON manually:

```typescript
if (props.executionName) {
  // Use L1 CfnRule directly for full control
  const cfnRule = new CfnRule(this, `${eventType}CfnRule`, {
    eventBusName: eventBus.eventBusName,
    eventPattern: { 'detail-type': [eventType] },
    targets: [{
      id: `${eventType}Target`,
      arn: this.stateMachine.stateMachineArn,
      roleArn: targetRole.roleArn,
      deadLetterConfig: { arn: this.dlq.queueArn },
      input: '$.detail',
      // This is the key: StepFunctionsParameters has no L2 equivalent
      // CloudFormation docs: not available via Targets[].StepFunctionsParameters for EventBridge
    }],
  });
}
```

**Final note:** This step requires experimentation during implementation. The CDK API may not support `executionName` on EventBridge → SF targets natively. The implementer should:
1. Check CDK docs for `SfnStateMachine` target options
2. If not supported, use an alternative singleton approach: the event-listener handler calls `StartExecution` directly with a fixed name, and the Orchestration trigger rule is removed for this specific workflow
3. Document the chosen approach in the commit message

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run cdk-constructs:test -- --testPathPattern orchestration`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add libs/cdk-constructs/
git commit -m "feat(cdk): add executionName prop to Orchestration for singleton SF guard"
```

### Task 6: Create CircuitBreakerHealDefinition construct

**Files:**
- Create: `libs/cdk-constructs/src/core/circuit-breaker-heal.ts`
- Modify: `libs/cdk-constructs/src/index.ts`
- Create: `libs/cdk-constructs/test/unit/circuit-breaker-heal.test.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/cdk-constructs/test/unit/circuit-breaker-heal.test.ts`:

```typescript
import { Stack, Duration } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as events from 'aws-cdk-lib/aws-events';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { CircuitBreakerHealDefinition } from '../../src/core/circuit-breaker-heal';

describe('CircuitBreakerHealDefinition', () => {
  it('should produce a definitionBody with health check, close, and escalate states', () => {
    const stack = new Stack();
    const table = new dynamodb.Table(stack, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
    });
    const connection = new events.Connection(stack, 'Conn', {
      authorization: events.Authorization.apiKey('X-Api-Key', stack.resolve('secret')),
    });

    const heal = new CircuitBreakerHealDefinition(stack, 'Heal', {
      table,
      breakerKey: 'CircuitBreaker#test-adapter',
      events: {
        closed: 'TEST_CIRCUIT_CLOSED',
        escalated: 'TEST_HEAL_ESCALATED',
      },
      healthCheck: {
        connection,
        apiRoot: 'https://api.example.com',
        apiEndpoint: sfn.TaskInput.fromText('/v2/health'),
        method: sfn.TaskInput.fromText('GET'),
        timeoutSeconds: 10,
      },
    });

    expect(heal.definitionBody).toBeDefined();

    // Create a state machine to synth and verify
    new sfn.StateMachine(stack, 'SM', {
      definitionBody: heal.definitionBody,
      timeout: Duration.hours(2),
    });

    const template = Template.fromStack(stack);

    // Verify the state machine definition contains expected states
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      DefinitionString: Match.serializedJson(
        Match.objectLike({
          States: Match.objectLike({
            InitAttemptCount: Match.objectLike({ Type: 'Pass' }),
            HealthCheck: Match.objectLike({ Type: 'Task' }),
            CloseBreaker: Match.objectLike({ Type: 'Task' }),
            EmitBreakerClosed: Match.objectLike({ Type: 'Task' }),
            IncrementAttempt: Match.objectLike({ Type: 'Pass' }),
            CheckAttemptLimit: Match.objectLike({ Type: 'Choice' }),
            WaitForRetry: Match.objectLike({ Type: 'Wait' }),
            EscalateHealFailure: Match.objectLike({ Type: 'Task' }),
          }),
        }),
      ),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run cdk-constructs:test -- --testPathPattern circuit-breaker-heal`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement CircuitBreakerHealDefinition**

Create `libs/cdk-constructs/src/core/circuit-breaker-heal.ts`:

```typescript
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IConnection } from 'aws-cdk-lib/aws-events';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export interface CircuitBreakerHealDefinitionProps {
  readonly table: ITable;
  readonly breakerKey: string;
  readonly events: {
    readonly closed: string;
    readonly escalated: string;
  };
  readonly healthCheck: {
    readonly connection: IConnection;
    readonly apiRoot: string;
    readonly apiEndpoint: sfn.TaskInput;
    readonly method: sfn.TaskInput;
    readonly timeoutSeconds?: number;
  };
  readonly retry?: {
    readonly maxAttempts?: number;
    readonly intervalSeconds?: number;
  };
  readonly healthCheckRetry?: {
    readonly maxAttempts?: number;
    readonly intervalSeconds?: number;
    readonly backoffRate?: number;
  };
}

/**
 * Generic circuit breaker healing workflow definition.
 * Produces a DefinitionBody for the Orchestration construct.
 *
 * Flow:
 * 1. InitAttemptCount → HealthCheck (HTTP:Invoke with retry)
 * 2. Success → CloseBreaker (DDB UpdateItem) → EmitBreakerClosed (DDB PutItem for CDC) → End
 * 3. Failure → IncrementAttempt → CheckAttemptLimit
 *    - < maxAttempts → WaitForRetry → loop
 *    - >= maxAttempts → EscalateHealFailure (DDB PutItem for CDC) → End
 */
export class CircuitBreakerHealDefinition extends Construct {
  readonly definitionBody: sfn.DefinitionBody;

  constructor(scope: Construct, id: string, props: CircuitBreakerHealDefinitionProps) {
    super(scope, id);

    const { table, breakerKey, events: eventNames } = props;
    const tableName = table.tableName;
    const maxAttempts = props.retry?.maxAttempts ?? 10;
    const retryInterval = props.retry?.intervalSeconds ?? 60;
    const hcTimeout = props.healthCheck.timeoutSeconds ?? 10;
    const hcMaxAttempts = props.healthCheckRetry?.maxAttempts ?? 3;
    const hcInterval = props.healthCheckRetry?.intervalSeconds ?? 5;
    const hcBackoffRate = props.healthCheckRetry?.backoffRate ?? 2;

    // 1. HealthCheck — HTTP:Invoke with native retry
    const healthCheck = new tasks.HttpInvoke(this, 'HealthCheck', {
      apiRoot: props.healthCheck.apiRoot,
      apiEndpoint: props.healthCheck.apiEndpoint,
      method: props.healthCheck.method,
      connection: props.healthCheck.connection,
      headers: sfn.TaskInput.fromObject({ 'Content-Type': 'application/json' }),
    });
    healthCheck.addRetry({
      errors: ['States.Http.StatusCode.5XX', 'States.TaskFailed', 'States.Timeout'],
      interval: Duration.seconds(hcInterval),
      backoffRate: hcBackoffRate,
      maxAttempts: hcMaxAttempts,
    });

    // 2. CloseBreaker — DDB UpdateItem
    const closeBreaker = new sfn.CustomState(this, 'CloseBreaker', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { S: breakerKey },
            sk: { S: 'CircuitBreaker' },
          },
          UpdateExpression: 'SET #st = :st, closedAt = :ca',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: {
            ':st': { S: 'CLOSED' },
            ':ca': { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    // 3. EmitBreakerClosed — DDB PutItem NormalizedEvent for CDC
    const emitBreakerClosed = new sfn.CustomState(this, 'EmitBreakerClosed', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Parameters: {
          TableName: tableName,
          Item: {
            pk: { 'S.$': "States.Format('NormalizedEvent#{}#CIRCUIT_BREAKER', $.tenantId)" },
            sk: { 'S.$': `States.Format('${eventNames.closed}#{}', $$.State.EnteredTime)` },
            __typename: { S: 'NormalizedEvent' },
            tenantId: { 'S.$': '$.tenantId' },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const endHealed = new sfn.Succeed(this, 'EndHealed');

    // 4. IncrementAttempt
    const incrementAttempt = new sfn.Pass(this, 'IncrementAttempt', {
      parameters: {
        'tenantId.$': '$.tenantId',
        'attemptCount.$': 'States.MathAdd($.attemptCount, 1)',
      },
    });

    // 5. CheckAttemptLimit
    const checkAttemptLimit = new sfn.Choice(this, 'CheckAttemptLimit');

    // 6. WaitForRetry
    const waitForRetry = new sfn.Wait(this, 'WaitForRetry', {
      time: sfn.WaitTime.duration(Duration.seconds(retryInterval)),
    });

    // 7. EscalateHealFailure — DDB PutItem NormalizedEvent for CDC
    const escalateHealFailure = new sfn.CustomState(this, 'EscalateHealFailure', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:putItem',
        Parameters: {
          TableName: tableName,
          Item: {
            pk: { 'S.$': "States.Format('NormalizedEvent#{}#CIRCUIT_BREAKER', $.tenantId)" },
            sk: { 'S.$': `States.Format('${eventNames.escalated}#{}', $$.State.EnteredTime)` },
            __typename: { S: 'NormalizedEvent' },
            tenantId: { 'S.$': '$.tenantId' },
            failureReason: { 'S.$': `States.Format('Circuit breaker heal failed after {} attempts', $.attemptCount)` },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: sfn.JsonPath.DISCARD,
      },
    });

    const endEscalated = new sfn.Fail(this, 'EndEscalated', {
      error: 'HealAttemptsExhausted',
      cause: `Circuit breaker healing failed after ${maxAttempts} attempts`,
    });

    // 8. InitAttemptCount
    const initAttemptCount = new sfn.Pass(this, 'InitAttemptCount', {
      parameters: {
        'tenantId.$': '$.tenantId',
        attemptCount: 0,
      },
    });

    // Wire the chain
    closeBreaker.next(emitBreakerClosed);
    emitBreakerClosed.next(endHealed);

    healthCheck.addCatch(incrementAttempt, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });
    healthCheck.next(closeBreaker);

    waitForRetry.next(healthCheck);
    incrementAttempt.next(checkAttemptLimit);
    escalateHealFailure.next(endEscalated);

    checkAttemptLimit
      .when(sfn.Condition.numberLessThan('$.attemptCount', maxAttempts), waitForRetry)
      .otherwise(escalateHealFailure);

    const definition = initAttemptCount.next(healthCheck);

    this.definitionBody = sfn.DefinitionBody.fromChainable(definition);
  }
}
```

- [ ] **Step 4: Export from index**

In `libs/cdk-constructs/src/index.ts`, add:
```typescript
export { CircuitBreakerHealDefinition } from './core/circuit-breaker-heal';
export type { CircuitBreakerHealDefinitionProps } from './core/circuit-breaker-heal';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx run cdk-constructs:test -- --testPathPattern circuit-breaker-heal`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add libs/cdk-constructs/
git commit -m "feat(cdk): add generic CircuitBreakerHealDefinition construct"
```

---

## Phase 3: broker-ctrl Simplification

### Task 7: Remove circuit breaker infrastructure from broker-ctrl

**Files:**
- Delete: `services/execution/broker-ctrl/src/repositories/circuit-breaker.repository.ts`
- Delete: `services/execution/broker-ctrl/src/state-machine/circuit-breaker-heal.ts`
- Delete: `services/execution/broker-ctrl/src/handlers/emit-health-check.ts`
- Delete: `services/execution/broker-ctrl/test/unit/circuit-breaker.repository.test.ts`
- Delete: `services/execution/broker-ctrl/test/unit/emit-health-check.test.ts`
- Modify: `services/execution/broker-ctrl/src/domain/events.ts`
- Modify: `services/execution/broker-ctrl/src/domain/schemas.ts`
- Modify: `services/execution/broker-ctrl/src/domain/index.ts`

- [ ] **Step 1: Remove CircuitBreaker from domain**

In `services/execution/broker-ctrl/src/domain/events.ts`, remove from `BrokerCtrlEventTypes`:
```typescript
BROKER_CIRCUIT_OPEN: eventName('BROKER_CIRCUIT_OPEN'),
BROKER_CIRCUIT_CLOSED: eventName('BROKER_CIRCUIT_CLOSED'),
BROKER_HEAL_ESCALATED: eventName('BROKER_HEAL_ESCALATED'),
```

Remove from `BrokerCtrlInboundEventTypes`:
```typescript
ALPACA_ACCOUNT_SNAPSHOT: eventName('ALPACA_ACCOUNT_SNAPSHOT'),
```

In `services/execution/broker-ctrl/src/domain/schemas.ts`, remove `CircuitBreakerSchema` and `CircuitBreaker` type.

In `services/execution/broker-ctrl/src/domain/index.ts`, remove `CircuitBreakerSchema` and `CircuitBreaker` exports.

- [ ] **Step 2: Delete files**

```bash
rm services/execution/broker-ctrl/src/repositories/circuit-breaker.repository.ts
rm services/execution/broker-ctrl/src/state-machine/circuit-breaker-heal.ts
rm services/execution/broker-ctrl/src/handlers/emit-health-check.ts
rm services/execution/broker-ctrl/test/unit/circuit-breaker.repository.test.ts
rm services/execution/broker-ctrl/test/unit/emit-health-check.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add services/execution/broker-ctrl/
git commit -m "refactor(broker-ctrl): remove circuit breaker domain, repository, heal SM, and health check"
```

### Task 8: Remove circuit breaker from broker-ctrl CDK stack

**Files:**
- Modify: `services/execution/broker-ctrl/src/service.stack.ts`
- Modify: `services/execution/broker-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Read the current stack**

Read `services/execution/broker-ctrl/src/service.stack.ts` to identify:
- HealWorkflowDefinition import and instantiation
- HealStateMachine Orchestration
- emit-health-check Lambda
- grantCallbackAccess for heal
- BROKER_CIRCUIT_OPEN/CLOSED/HEAL_ESCALATED in Egress eventTypes
- ALPACA_ACCOUNT_SNAPSHOT in callback-ingress subscriptions

- [ ] **Step 2: Remove from stack**

Remove the following from the stack (exact lines depend on current code — read first):
1. `import { HealWorkflowDefinition }` — remove import
2. `const emitHealthCheckFn = new NodejsFunction(...)` — remove Lambda
3. `const healWorkflow = new HealWorkflowDefinition(...)` — remove
4. `const healOrchestration = new Orchestration(this, 'HealStateMachine', ...)` — remove
5. `healOrchestration.grantCallbackAccess(...)` — remove
6. Remove `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `BROKER_HEAL_ESCALATED` from Egress eventTypes
7. Remove `ALPACA_ACCOUNT_SNAPSHOT` from callback-ingress event subscriptions
8. Remove IAM grants for emitHealthCheckFn

- [ ] **Step 3: Update stack test**

In `services/execution/broker-ctrl/test/unit/service.stack.test.ts`, remove assertions for:
- HealStateMachine
- emit-health-check Lambda
- Circuit breaker Egress event types

- [ ] **Step 4: Run stack test**

Run: `pnpm nx run broker-ctrl:test -- --testPathPattern service.stack`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/
git commit -m "refactor(broker-ctrl): remove circuit breaker infrastructure from CDK stack"
```

### Task 9: Simplify OrderStateMachine

**Files:**
- Modify: `services/execution/broker-ctrl/src/state-machine/order-state-machine.ts`

- [ ] **Step 1: Read the current state machine**

Read `services/execution/broker-ctrl/src/state-machine/order-state-machine.ts` fully.

- [ ] **Step 2: Remove circuit breaker and retry logic**

Remove these states and their wiring:
1. `ReadCircuitBreaker` (CustomState — DDB GetItem)
2. `IsCircuitBreakerOpen` (Choice)
3. `BreakerWait` (Wait 30s)
4. `CheckRetryCount` (Choice)
5. `IncrementRetry` (CustomState — DDB UpdateItem)
6. `RetryBackoff` (Choice)
7. `Wait5s`, `Wait15s`, `Wait45s` (Wait states)
8. `WaitForRetryResult` (CustomState — Lambda invoke.waitForTaskToken)
9. `MarkFailed` (Parallel — was retry exhaustion path)
10. From `HandleTimeout`: remove `HandleTimeoutOpenBreaker` branch and `HandleTimeoutCircuitBreakerEvent` branch. Keep `HandleTimeoutEscalateOrder` and `HandleTimeoutNormalizedEvent`.

Update the main chain:
```typescript
// Before: ReadExecutionMode → ReadCircuitBreaker → IsCircuitBreakerOpen
// After:  ReadExecutionMode → RouteOrder
const definition = readExecutionMode.next(routeOrder);
```

Update ClassifyResult:
```typescript
// Before: FILLED, PARTIALLY_FILLED, transient → retry, default → rejected
// After:  FILLED, PARTIALLY_FILLED, default → rejected
classifyResult
  .when(sfn.Condition.stringEquals('$.adapterResult.status', 'FILLED'), markFilled)
  .when(sfn.Condition.stringEquals('$.adapterResult.status', 'PARTIALLY_FILLED'), markPartialFill)
  .otherwise(markRejected);
```

Remove addCatch from `waitForRetryResult` (deleted).

- [ ] **Step 3: Run unit tests**

Run: `pnpm nx run broker-ctrl:test`
Expected: PASS (some tests may need updating if they tested retry/breaker behavior)

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-ctrl/
git commit -m "refactor(broker-ctrl): simplify OrderStateMachine — remove CB check and retry loop"
```

### Task 10: Simplify callback-resolver

**Files:**
- Modify: `services/execution/broker-ctrl/src/handlers/callback-resolver.ts`
- Modify: `services/execution/broker-ctrl/test/unit/callback-resolver.test.ts`

- [ ] **Step 1: Read the current callback-resolver**

Read `services/execution/broker-ctrl/src/handlers/callback-resolver.ts` to identify circuit breaker code.

- [ ] **Step 2: Remove circuit breaker logic**

Remove:
1. `CircuitBreakerRepository` import and instantiation
2. `ALPACA_ACCOUNT_SNAPSHOT` handler (the one that calls `circuitBreakerRepo.getBreaker(ctx.tenantId, 'Global')` and resolves healTaskToken)
3. Any `classifyFailure` function if it's Alpaca-specific (check — may need to stay if used for order callbacks)

- [ ] **Step 3: Update tests**

In `services/execution/broker-ctrl/test/unit/callback-resolver.test.ts`, remove test cases for:
- ALPACA_ACCOUNT_SNAPSHOT handling
- Circuit breaker task token resolution
- healTaskToken

- [ ] **Step 4: Run tests**

Run: `pnpm nx run broker-ctrl:test -- --testPathPattern callback-resolver`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-ctrl/
git commit -m "refactor(broker-ctrl): remove CB logic from callback-resolver"
```

---

## Phase 4: broker-alpaca-adpt — Circuit Breaker Owner

### Task 11: Add circuit breaker domain and repository

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/domain/events.ts`
- Create or modify: `services/execution/broker-alpaca-adpt/src/domain/schemas.ts`
- Create: `services/execution/broker-alpaca-adpt/src/repositories/circuit-breaker.repository.ts`
- Create: `services/execution/broker-alpaca-adpt/test/unit/circuit-breaker.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/execution/broker-alpaca-adpt/test/unit/circuit-breaker.repository.test.ts`:

```typescript
import { CircuitBreakerRepository } from '../../src/repositories/circuit-breaker.repository';

describe('CircuitBreakerRepository', () => {
  // Use test-support DynamoDB helpers
  let repo: CircuitBreakerRepository;

  beforeEach(() => {
    repo = new CircuitBreakerRepository(process.env.TABLE_NAME!);
  });

  it('should return false when no breaker record exists', async () => {
    expect(await repo.isOpen('alpaca')).toBe(false);
  });

  it('should open breaker with conditional write', async () => {
    const opened = await repo.open('alpaca', 'API timeout');
    expect(opened).toBe(true);
    expect(await repo.isOpen('alpaca')).toBe(true);
  });

  it('should return false on duplicate open', async () => {
    await repo.open('alpaca', 'API timeout');
    const secondOpen = await repo.open('alpaca', 'API timeout again');
    expect(secondOpen).toBe(false);
  });

  it('should close breaker', async () => {
    await repo.open('alpaca', 'API timeout');
    await repo.close('alpaca');
    expect(await repo.isOpen('alpaca')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run broker-alpaca-adpt:test -- --testPathPattern circuit-breaker`
Expected: FAIL — module not found.

- [ ] **Step 3: Add event types**

In `services/execution/broker-alpaca-adpt/src/domain/events.ts`, add to `AlpacaAdptEventTypes`:
```typescript
// Circuit breaker (CDC)
BROKER_CIRCUIT_OPEN: eventName('BROKER_CIRCUIT_OPEN'),
BROKER_CIRCUIT_CLOSED: eventName('BROKER_CIRCUIT_CLOSED'),
BROKER_HEAL_ESCALATED: eventName('BROKER_HEAL_ESCALATED'),
```

- [ ] **Step 4: Add schema**

Create or update `services/execution/broker-alpaca-adpt/src/domain/schemas.ts`:
```typescript
import { z } from 'zod';

export const CircuitBreakerSchema = z.object({
  pk: z.string(),
  sk: z.literal('CircuitBreaker'),
  __typename: z.literal('CircuitBreaker'),
  state: z.enum(['OPEN', 'CLOSED']),
  adapter: z.string(),
  openedAt: z.string(),
  closedAt: z.string().optional(),
  reason: z.string(),
});

export type CircuitBreaker = z.infer<typeof CircuitBreakerSchema>;
```

- [ ] **Step 5: Implement repository**

Create `services/execution/broker-alpaca-adpt/src/repositories/circuit-breaker.repository.ts`:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository, getTime, withMethodLogging } from '@nestfolio/event-processor';

export class CircuitBreakerRepository extends TableRepository {
  private readonly log = withMethodLogging('CircuitBreakerRepository');

  constructor(tableName: string, client?: DynamoDBClient) {
    super(tableName, client);
  }

  readonly isOpen = this.log('isOpen',
    async (adapterId: string): Promise<boolean> => {
      const result = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: {
            pk: `CircuitBreaker#${adapterId}`,
            sk: 'CircuitBreaker',
          },
        }),
      );
      return result.Item?.state === 'OPEN';
    },
  );

  readonly open = this.log('open',
    async (adapterId: string, reason: string): Promise<boolean> => {
      try {
        await this.put({
          pk: `CircuitBreaker#${adapterId}`,
          sk: 'CircuitBreaker',
          __typename: 'CircuitBreaker',
          state: 'OPEN',
          adapter: adapterId,
          openedAt: getTime(),
          reason,
        }, {
          conditionExpression: 'attribute_not_exists(pk) OR #st <> :open',
          expressionAttributeNames: { '#st': 'state' },
          expressionAttributeValues: { ':open': 'OPEN' },
        });
        return true;
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
          return false; // already open
        }
        throw err;
      }
    },
  );

  readonly close = this.log('close',
    async (adapterId: string): Promise<void> => {
      await this.update(
        `CircuitBreaker#${adapterId}`,
        'CircuitBreaker',
        { state: 'CLOSED', closedAt: getTime() },
      );
    },
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm nx run broker-alpaca-adpt:test -- --testPathPattern circuit-breaker`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add services/execution/broker-alpaca-adpt/
git commit -m "feat(broker-alpaca-adpt): add circuit breaker domain, schema, and repository"
```

### Task 12: Add retry logic to AlpacaClient

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts`
- Create: `services/execution/broker-alpaca-adpt/test/unit/alpaca.client.test.ts` (if not exists)

- [ ] **Step 1: Read the current client**

Read `services/execution/broker-alpaca-adpt/src/clients/alpaca.client.ts` to understand the `request()` method.

- [ ] **Step 2: Add retry wrapper**

Add a `requestWithRetry()` method (or wrap existing `request()`):

```typescript
private async requestWithRetry<T>(
  method: string,
  path: string,
  body?: unknown,
  maxAttempts = 3,
): Promise<AlpacaResponse<T>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await this.request<T>(method, path, body);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000); // 1s, 2s, 4s (capped at 10s)
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
```

Update all public methods (`submitOrder`, `cancelOrder`, `getAccount`, `getPositions`, `initiateTransfer`, etc.) to use `requestWithRetry` instead of `request`.

Add a non-retrying `healthCheck()` method:
```typescript
async healthCheck(): Promise<boolean> {
  try {
    await this.request('GET', '/v2/account');
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm nx run broker-alpaca-adpt:test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/execution/broker-alpaca-adpt/
git commit -m "feat(broker-alpaca-adpt): add retry logic and healthCheck to AlpacaClient"
```

### Task 13: Add circuit breaker logic to event-listener handlers

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts`
- Modify: `services/execution/broker-alpaca-adpt/test/unit/event-listener.test.ts` (or create)

- [ ] **Step 1: Read the current event-listener**

Read `services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts`.

- [ ] **Step 2: Write failing tests**

Add tests for:
1. When breaker is open → handler immediately returns rejection (ALPACA_ORDER_REJECTED with reason BROKER_UNAVAILABLE)
2. When API call fails after retries → handler checks health → if down → opens breaker + returns rejection
3. When API call fails but health check passes → returns rejection without opening breaker

- [ ] **Step 3: Add breaker check and failure detection**

At the top of each handler, add breaker check:

```typescript
const circuitBreakerRepo = new CircuitBreakerRepository(TABLE_NAME);

async function processOrderRequested(payload: EventPayload, ctx: EventContext) {
  // Breaker check
  if (await circuitBreakerRepo.isOpen('alpaca')) {
    return rejectAsBrokerUnavailable(payload, ctx);
  }

  try {
    const result = await ordersService.submitOrder(/* ... */);
    return record('AlpacaOrderResult', result, { pk: result.pk, sk: result.sk });
  } catch (error) {
    // All retries failed — verify broker is actually down
    const isHealthy = await client.healthCheck();
    if (!isHealthy) {
      await circuitBreakerRepo.open('alpaca', 'API unreachable after retries');
      // Write NormalizedEvent for CDC → triggers HealSM
      await writeCircuitBreakerOpenEvent(ctx.tenantId);
    }
    return rejectOrder(payload, ctx, isHealthy ? (error as Error).message : 'BROKER_UNAVAILABLE');
  }
}

function rejectAsBrokerUnavailable(payload: EventPayload, ctx: EventContext) {
  const s = payload.subject;
  return record('AlpacaOrderResult', {
    status: 'REJECTED',
    rejectionReason: 'BROKER_UNAVAILABLE',
    tenantId: ctx.tenantId,
    orderId: s.orderId as string,
    symbol: s.symbol as string,
  }, {
    pk: `AlpacaOrderResult#${ctx.tenantId}#${s.orderId}`,
    sk: 'AlpacaOrderResult',
  });
}
```

Apply the same pattern to `processTransferRequested`, `processCancelRequested`, and `processAccountCheck`.

Add the NormalizedEvent writer:

```typescript
async function writeCircuitBreakerOpenEvent(tenantId: string): Promise<void> {
  const repo = new CircuitBreakerRepository(TABLE_NAME);
  // Write NormalizedEvent for CDC passthrough
  await repo.put({
    pk: `NormalizedEvent#${tenantId}#CIRCUIT_BREAKER`,
    sk: `BROKER_CIRCUIT_OPEN#${new Date().toISOString()}`,
    __typename: 'NormalizedEvent',
    tenantId,
    timestamp: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx run broker-alpaca-adpt:test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/execution/broker-alpaca-adpt/
git commit -m "feat(broker-alpaca-adpt): add circuit breaker check and failure detection to handlers"
```

### Task 14: Add HealStateMachine and EB Connection to broker-alpaca-adpt stack

**Files:**
- Modify: `services/execution/broker-alpaca-adpt/src/service.stack.ts`
- Modify: `services/execution/broker-alpaca-adpt/test/unit/service.stack.test.ts`

- [ ] **Step 1: Read the current stack**

Read `services/execution/broker-alpaca-adpt/src/service.stack.ts`.

- [ ] **Step 2: Add EB Connection and HealStateMachine**

Add imports:
```typescript
import * as events from 'aws-cdk-lib/aws-events';
import { SecretValue } from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { CircuitBreakerHealDefinition } from '@nestfolio/cdk-constructs';
```

After existing Orchestration constructs, add:

```typescript
// EventBridge Connection for Alpaca API auth
const alpacaConnection = new events.Connection(this, 'AlpacaConnection', {
  authorization: events.Authorization.apiKey(
    'APCA-API-KEY-ID',
    SecretValue.secretsManager(
      `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
      { jsonField: 'apiKeyId' },
    ),
  ),
  headerParameters: {
    'APCA-API-SECRET-KEY': events.HttpParameter.fromSecret(
      SecretValue.secretsManager(
        `${props.prefix}-broker-alpaca-adpt/alpaca-api-keys`,
        { jsonField: 'apiKeySecret' },
      ),
    ),
  },
});

// Alpaca base URL (deploy-time resolution)
const alpacaBaseUrl = StringParameter.valueForStringParameter(
  this,
  `/nestfolio/${props.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
);

// Circuit breaker heal workflow (generic construct)
const healWorkflow = new CircuitBreakerHealDefinition(this, 'HealWorkflow', {
  table: state.getTable(),
  breakerKey: 'CircuitBreaker#alpaca',
  events: {
    closed: AlpacaAdptEventTypes.BROKER_CIRCUIT_CLOSED,
    escalated: AlpacaAdptEventTypes.BROKER_HEAL_ESCALATED,
  },
  healthCheck: {
    connection: alpacaConnection,
    apiRoot: alpacaBaseUrl,
    apiEndpoint: sfn.TaskInput.fromText('/v2/account'),
    method: sfn.TaskInput.fromText('GET'),
    timeoutSeconds: 10,
  },
});

// Heal orchestration (singleton via fixed execution name)
const healOrchestration = new Orchestration(this, 'HealStateMachine', {
  state,
  definitionBody: healWorkflow.definitionBody,
  triggers: [AlpacaAdptEventTypes.BROKER_CIRCUIT_OPEN],
  timeout: Duration.hours(2),
  executionName: 'heal-alpaca',
});
```

- [ ] **Step 3: Add circuit breaker events to Egress**

Update the Egress eventTypes to include NormalizedEvent passthrough:

```typescript
// Add to egress eventTypes:
'NormalizedEvent': {
  insert: {
    field: 'sk',
    passthrough: true,
    emits: [
      AlpacaAdptEventTypes.BROKER_CIRCUIT_OPEN,
      AlpacaAdptEventTypes.BROKER_CIRCUIT_CLOSED,
      AlpacaAdptEventTypes.BROKER_HEAL_ESCALATED,
    ],
  },
},
```

- [ ] **Step 4: Update stack test**

Add CDK assertions for:
- EventBridge Connection exists
- HealStateMachine Orchestration exists
- Egress includes circuit breaker event types

- [ ] **Step 5: Run stack test**

Run: `pnpm nx run broker-alpaca-adpt:test -- --testPathPattern service.stack`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/execution/broker-alpaca-adpt/
git commit -m "feat(broker-alpaca-adpt): add EB Connection, HealStateMachine, and CB Egress events"
```

---

## Phase 5: Event Routing

### Task 15: Update investor-adpt and execution-adpt event routing

**Files:**
- Modify: `services/investor/investor-adpt/src/domain/events.ts`
- Modify: `services/investor/investor-adpt/src/service.stack.ts`
- Modify: `services/execution/execution-adpt/src/domain/events.ts`

- [ ] **Step 1: Add new events to investor-adpt**

In `services/investor/investor-adpt/src/domain/events.ts`, add to `InvestorIngestEventTypes`:
```typescript
// From Execution (circuit breaker)
BROKER_CIRCUIT_CLOSED: eventName('BROKER_CIRCUIT_CLOSED'),
BROKER_HEAL_ESCALATED: eventName('BROKER_HEAL_ESCALATED'),
```

(`BROKER_CIRCUIT_OPEN` already exists.)

- [ ] **Step 2: Add to investor-adpt EB rule**

In `services/investor/investor-adpt/src/service.stack.ts`, add `InvestorIngestEventTypes.BROKER_CIRCUIT_CLOSED` and `InvestorIngestEventTypes.BROKER_HEAL_ESCALATED` to the `fromExecutionEvents` array.

- [ ] **Step 3: Add to execution-adpt cross-domain registry**

In `services/execution/execution-adpt/src/domain/events.ts`, add to `ExecutionCrossDomainEventTypes`:
```typescript
BROKER_CIRCUIT_CLOSED: eventName('BROKER_CIRCUIT_CLOSED'),
BROKER_HEAL_ESCALATED: eventName('BROKER_HEAL_ESCALATED'),
```

- [ ] **Step 4: Run affected tests**

Run: `pnpm nx run investor-adpt:test && pnpm nx run execution-adpt:test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-adpt/ services/execution/execution-adpt/
git commit -m "feat: add BROKER_CIRCUIT_CLOSED and BROKER_HEAL_ESCALATED to event routing"
```

---

## Phase 6: investor-bff Feature Flags

### Task 16: Enhance Facade construct for IAM auth

**Files:**
- Modify: `libs/cdk-constructs/src/core/facade.ts`
- Modify: `libs/cdk-constructs/test/unit/facade.test.ts` (if exists)

- [ ] **Step 1: Read the Facade construct**

Read `libs/cdk-constructs/src/core/facade.ts` to understand how the AppSync API is created.

- [ ] **Step 2: Add IAM as additional auth mode**

Add `enableIamAuth?: boolean` to `FacadeProps`. When enabled, add IAM as an additional authorization mode:

```typescript
if (props.enableIamAuth) {
  // Add IAM as additional auth mode to the AppSync API
  // This allows @aws_iam annotated mutations to accept IAM-signed requests
}
```

The exact implementation depends on how the GraphqlApi is constructed. If using `AuthorizationType.USER_POOL` as default, add:
```typescript
additionalAuthorizationModes: props.enableIamAuth
  ? [{ authorizationType: AuthorizationType.IAM }]
  : undefined,
```

- [ ] **Step 3: Run tests**

Run: `pnpm nx run cdk-constructs:test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add libs/cdk-constructs/
git commit -m "feat(cdk): add IAM auth mode support to Facade construct"
```

### Task 17: Add feature flag GraphQL schema and resolvers

**Files:**
- Modify: `services/investor/investor-bff/src/schema.graphql`
- Create: `services/investor/investor-bff/src/graphql/js-function/get-feature-flags.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/update-feature-flag.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/check-feature-flag.fn.js`

- [ ] **Step 1: Add GraphQL schema types**

Append to `services/investor/investor-bff/src/schema.graphql`:

```graphql
type FeatureFlag {
  name: String!
  enabled: Boolean!
  reason: String
}

type Query {
  getFeatureFlags: [FeatureFlag!]!
}

type Mutation {
  updateFeatureFlag(name: String!, enabled: Boolean!, reason: String): FeatureFlag!
    @aws_iam
}

type Subscription {
  onFeatureFlagUpdate: FeatureFlag!
    @aws_subscribe(mutations: ["updateFeatureFlag"])
}
```

Note: add `getFeatureFlags` to existing Query type, `updateFeatureFlag` to existing Mutation type, and `onFeatureFlagUpdate` to existing Subscription type (or create Subscription type if not present for these).

- [ ] **Step 2: Create get-feature-flags resolver**

Create `services/investor/investor-bff/src/graphql/js-function/get-feature-flags.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const tenantId = ctx.stash.tenantId;
  return {
    operation: 'Query',
    query: {
      expression: 'pk = :pk AND begins_with(sk, :prefix)',
      expressionValues: util.dynamodb.toMapValues({
        ':pk': `FeatureFlag#SYSTEM`,
        ':prefix': 'FeatureFlag#',
      }),
    },
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  const items = ctx.result?.items ?? [];
  return items.map(item => ({
    name: item.name,
    enabled: item.enabled,
    reason: item.reason ?? null,
  }));
}
```

- [ ] **Step 3: Create update-feature-flag resolver**

Create `services/investor/investor-bff/src/graphql/js-function/update-feature-flag.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const { name, enabled, reason } = ctx.arguments;
  const now = util.time.nowISO8601();
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({
      pk: 'FeatureFlag#SYSTEM',
      sk: `FeatureFlag#${name}`,
    }),
    attributeValues: util.dynamodb.toMapValues({
      __typename: 'FeatureFlag',
      name,
      enabled,
      reason: reason ?? null,
      updatedAt: now,
    }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  return {
    name: ctx.result.name,
    enabled: ctx.result.enabled,
    reason: ctx.result.reason,
  };
}
```

- [ ] **Step 4: Create check-feature-flag pipeline step**

Create `services/investor/investor-bff/src/graphql/js-function/check-feature-flag.fn.js`:

```javascript
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const tenantId = ctx.stash.tenantId;
  const mutationName = ctx.stash.mutationName ?? ctx.info.fieldName;
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: 'FeatureFlag#SYSTEM',
      sk: `FeatureFlag#${mutationName}`,
    }),
  };
}

export function response(ctx) {
  if (ctx.error) util.error(ctx.error.message, ctx.error.type);
  if (ctx.result && ctx.result.enabled === false) {
    util.error('This action is temporarily paused', 'SERVICE_TEMPORARILY_UNAVAILABLE');
  }
  return ctx.prev.result;
}
```

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/
git commit -m "feat(investor-bff): add feature flag GraphQL schema and JS resolvers"
```

### Task 18: Wire feature flags in investor-bff stack

**Files:**
- Modify: `services/investor/investor-bff/src/service.stack.ts`
- Modify: `services/investor/investor-bff/src/domain/events.ts`

- [ ] **Step 1: Read the current stack**

Read `services/investor/investor-bff/src/service.stack.ts`.

- [ ] **Step 2: Add event types**

In `services/investor/investor-bff/src/domain/events.ts`, add:
```typescript
BROKER_CIRCUIT_OPEN: eventName('BROKER_CIRCUIT_OPEN'),
BROKER_CIRCUIT_CLOSED: eventName('BROKER_CIRCUIT_CLOSED'),
```

- [ ] **Step 3: Update stack**

In the service stack:
1. Add `BROKER_CIRCUIT_OPEN` and `BROKER_CIRCUIT_CLOSED` to Ingress `eventTypes`
2. Enable IAM auth on Facade: `enableIamAuth: true`
3. Pass AppSync URL to Ingress handler environment: `APPSYNC_URL: facade.graphqlUrl`
4. Grant AppSync invocation to Ingress handler: add IAM policy for `appsync:GraphQL`
5. Register `getFeatureFlags` and `updateFeatureFlag` resolvers in Facade config
6. Add `check-feature-flag.fn.js` as pipeline step before `initiateDeposit` and `requestWithdrawal` resolvers

- [ ] **Step 4: Run stack test**

Run: `pnpm nx run investor-bff:test -- --testPathPattern service.stack`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/
git commit -m "feat(investor-bff): wire feature flags in CDK stack — Ingress, Facade IAM, resolvers"
```

### Task 19: Add circuit breaker handlers to investor-bff event-listener

**Files:**
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-bff/test/unit/event-listener.test.ts`

- [ ] **Step 1: Read the current event-listener**

Read `services/investor/investor-bff/src/handlers/event-listener.ts`.

- [ ] **Step 2: Write failing tests**

Add tests for:
1. `BROKER_CIRCUIT_OPEN` → calls `updateFeatureFlag` 3 times with `enabled: false`
2. `BROKER_CIRCUIT_CLOSED` → calls `updateFeatureFlag` 3 times with `enabled: true`
3. Both handlers return `skip()` (no DDB write from the handler itself)

- [ ] **Step 3: Implement handlers**

Add a utility for IAM-signed AppSync mutations (this is a new pattern — implement as a local helper or small shared utility):

```typescript
import { SignatureV4 } from '@aws-sdk/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const APPSYNC_URL = process.env.APPSYNC_URL!;
const REGION = process.env.AWS_REGION ?? 'us-east-1';

async function callAppSyncMutation(mutation: string, variables: Record<string, unknown>): Promise<void> {
  const url = new URL(APPSYNC_URL);
  const body = JSON.stringify({ query: mutation, variables });

  const signer = new SignatureV4({
    credentials: defaultProvider(),
    region: REGION,
    service: 'appsync',
    sha256: Sha256,
  });

  const request = {
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname,
    },
    body,
  };

  const signed = await signer.sign(request);
  await fetch(APPSYNC_URL, {
    method: 'POST',
    headers: signed.headers as Record<string, string>,
    body,
  });
}

const UPDATE_FEATURE_FLAG = `
  mutation UpdateFeatureFlag($name: String!, $enabled: Boolean!, $reason: String) {
    updateFeatureFlag(name: $name, enabled: $enabled, reason: $reason) {
      name
      enabled
      reason
    }
  }
`;
```

Add handlers:

```typescript
[InvestorBffEventTypes.BROKER_CIRCUIT_OPEN]: async (_payload, _ctx) => {
  const flags = [
    { name: 'confirmDecision', enabled: false, reason: 'Broker connectivity issue' },
    { name: 'initiateDeposit', enabled: false, reason: 'Broker connectivity issue' },
    { name: 'requestWithdrawal', enabled: false, reason: 'Broker connectivity issue' },
  ];
  for (const flag of flags) {
    await callAppSyncMutation(UPDATE_FEATURE_FLAG, flag);
  }
  return skip();
},

[InvestorBffEventTypes.BROKER_CIRCUIT_CLOSED]: async (_payload, _ctx) => {
  const flags = [
    { name: 'confirmDecision', enabled: true },
    { name: 'initiateDeposit', enabled: true },
    { name: 'requestWithdrawal', enabled: true },
  ];
  for (const flag of flags) {
    await callAppSyncMutation(UPDATE_FEATURE_FLAG, flag);
  }
  return skip();
},
```

- [ ] **Step 4: Run tests**

Run: `pnpm nx run investor-bff:test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/
git commit -m "feat(investor-bff): add BROKER_CIRCUIT_OPEN/CLOSED handlers for feature flags"
```

---

## Phase 7: investor-ctrl Notifications

### Task 20: Add circuit breaker notification templates

**Files:**
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-ctrl/src/service.stack.ts`
- Modify: `services/investor/investor-ctrl/test/unit/event-listener.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for 3 new notification templates:
```typescript
it('should create SYSTEM notification for BROKER_CIRCUIT_OPEN', async () => {
  const result = await handler(createEvent('BROKER_CIRCUIT_OPEN', {}));
  expect(result).toContainEqual(
    expect.objectContaining({
      __typename: 'Notification',
      tenantId: 'SYSTEM',
      title: 'Some features are temporarily paused',
      channel: 'push',
    }),
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm nx run investor-ctrl:test -- --testPathPattern event-listener`
Expected: FAIL

- [ ] **Step 3: Add notification templates**

In `services/investor/investor-ctrl/src/handlers/event-listener.ts`, add to `NOTIFICATION_TEMPLATES`:

```typescript
BROKER_CIRCUIT_OPEN: {
  title: 'Some features are temporarily paused',
  body: 'Deposits, withdrawals, and accepting decisions are temporarily paused. We\'re working on it and will notify you when they\'re available again.',
  channel: 'push',
},
BROKER_CIRCUIT_CLOSED: {
  title: 'All features are available',
  body: 'Everything is back to normal. All features are available again.',
  channel: 'push',
},
BROKER_HEAL_ESCALATED: {
  title: 'We\'re looking into an issue',
  body: 'We\'re experiencing an extended issue affecting some features. Our team is working on it — we\'ll update you as soon as it\'s resolved.',
  channel: 'email,push',
},
```

Add handlers for these events. Since they have no `tenantId` (global events), use `SYSTEM`:

```typescript
[InvestorIngestEventTypes.BROKER_CIRCUIT_OPEN]: (payload, ctx) =>
  systemNotification(ctx),
[InvestorIngestEventTypes.BROKER_CIRCUIT_CLOSED]: (payload, ctx) =>
  systemNotification(ctx),
[InvestorIngestEventTypes.BROKER_HEAL_ESCALATED]: (payload, ctx) =>
  systemNotification(ctx),
```

Where `systemNotification` creates a notification with `tenantId: 'SYSTEM'`.

- [ ] **Step 4: Add to Ingress subscriptions**

In `services/investor/investor-ctrl/src/service.stack.ts`, add `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `BROKER_HEAL_ESCALATED` to the Ingress `eventTypes` array (imported from `InvestorIngestEventTypes`).

- [ ] **Step 5: Run tests**

Run: `pnpm nx run investor-ctrl:test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-ctrl/
git commit -m "feat(investor-ctrl): add circuit breaker notification templates (SYSTEM tenant)"
```

---

## Phase 8: Frontend

### Task 21: Scaffold feature-flags Angular lib

**Files:**
- Create: `libs/ui/feature-flags/` (via Nx generator)

- [ ] **Step 1: Generate the library**

```bash
pnpm nx g @nx/angular:library feature-flags --directory=libs/ui/feature-flags --standalone --style=scss --skipTests=false
```

- [ ] **Step 2: Commit**

```bash
git add libs/ui/feature-flags/
git commit -m "chore: scaffold libs/ui/feature-flags Angular library"
```

### Task 22: Implement FeatureFlagsStore

**Files:**
- Create: `libs/ui/feature-flags/src/lib/feature-flags.model.ts`
- Create: `libs/ui/feature-flags/src/lib/feature-flags.store.ts`
- Create: `libs/ui/feature-flags/src/lib/feature-flags.queries.ts`
- Modify: `libs/ui/feature-flags/src/index.ts`

- [ ] **Step 1: Create model**

Create `libs/ui/feature-flags/src/lib/feature-flags.model.ts`:

```typescript
export interface FeatureFlag {
  name: string;
  enabled: boolean;
  reason?: string;
}
```

- [ ] **Step 2: Create GraphQL queries**

Create `libs/ui/feature-flags/src/lib/feature-flags.queries.ts`:

```typescript
export const GET_FEATURE_FLAGS = `
  query GetFeatureFlags {
    getFeatureFlags {
      name
      enabled
      reason
    }
  }
`;

export const ON_FEATURE_FLAG_UPDATE = `
  subscription OnFeatureFlagUpdate {
    onFeatureFlagUpdate {
      name
      enabled
      reason
    }
  }
`;
```

- [ ] **Step 3: Create store**

Create `libs/ui/feature-flags/src/lib/feature-flags.store.ts`:

```typescript
import { computed } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { withDevtools } from '@nestfolio/shell';
import type { FeatureFlag } from './feature-flags.model';

interface FeatureFlagsState {
  flags: Record<string, FeatureFlag>;
}

const initialState: FeatureFlagsState = { flags: {} };

export const FeatureFlagsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    disabledFlags: computed(() =>
      Object.values(store.flags()).filter(f => !f.enabled),
    ),
  })),
  withMethods((store) => ({
    setFlags(flags: FeatureFlag[]): void {
      const record = Object.fromEntries(flags.map(f => [f.name, f]));
      patchState(store, { flags: record });
    },
    updateFlag(flag: FeatureFlag): void {
      patchState(store, { flags: { ...store.flags(), [flag.name]: flag } });
    },
    isEnabled(name: string): boolean {
      return store.flags()[name]?.enabled ?? true;
    },
  })),
  withDevtools('FeatureFlagsStore'),
);
```

- [ ] **Step 4: Export from index**

Update `libs/ui/feature-flags/src/index.ts`:
```typescript
export type { FeatureFlag } from './lib/feature-flags.model';
export { FeatureFlagsStore } from './lib/feature-flags.store';
export { GET_FEATURE_FLAGS, ON_FEATURE_FLAG_UPDATE } from './lib/feature-flags.queries';
```

- [ ] **Step 5: Commit**

```bash
git add libs/ui/feature-flags/
git commit -m "feat(ui): implement FeatureFlagsStore with signal store pattern"
```

### Task 23: Create FeatureFlagService in shell

**Files:**
- Create: `libs/shell/src/services/feature-flag.service.ts`
- Modify: `libs/shell/src/index.ts`

- [ ] **Step 1: Create the service**

Create `libs/shell/src/services/feature-flag.service.ts`:

```typescript
import { Injectable, OnDestroy, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { GraphqlService } from '../graphql/graphql.service';
import { FeatureFlagsStore, GET_FEATURE_FLAGS, ON_FEATURE_FLAG_UPDATE } from '@nestfolio/ui/feature-flags';
import type { FeatureFlag } from '@nestfolio/ui/feature-flags';

@Injectable({ providedIn: 'root' })
export class FeatureFlagService implements OnDestroy {
  private readonly graphql = inject(GraphqlService);
  private readonly store = inject(FeatureFlagsStore);
  private subscription?: Subscription;

  constructor() {
    this.loadInitialFlags();
    this.subscribeToUpdates();
  }

  private loadInitialFlags(): void {
    this.graphql.query<{ getFeatureFlags: FeatureFlag[] }>(GET_FEATURE_FLAGS)
      .subscribe({
        next: (result) => this.store.setFlags(result.getFeatureFlags),
        error: (err) => console.warn('Failed to load feature flags:', err),
      });
  }

  private subscribeToUpdates(): void {
    this.subscription = this.graphql
      .subscribe<{ onFeatureFlagUpdate: FeatureFlag }>(ON_FEATURE_FLAG_UPDATE)
      .subscribe({
        next: (result) => this.store.updateFlag(result.onFeatureFlagUpdate),
        error: (err) => console.warn('Feature flag subscription error:', err),
      });
  }

  ngOnDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
```

- [ ] **Step 2: Export from shell**

In `libs/shell/src/index.ts`, add:
```typescript
export { FeatureFlagService } from './services/feature-flag.service';
```

- [ ] **Step 3: Commit**

```bash
git add libs/shell/
git commit -m "feat(shell): add FeatureFlagService for boot-time subscription"
```

### Task 24: Create SystemBannerComponent and wire to host

**Files:**
- Create: `libs/shell/src/components/system-banner.component.ts`
- Modify: `libs/shell/src/components/shell-layout.component.ts`
- Modify: `apps/nestfolio-host/src/app/app.config.ts`

- [ ] **Step 1: Create banner component**

Create `libs/shell/src/components/system-banner.component.ts`:

```typescript
import { Component, computed, inject } from '@angular/core';
import { FeatureFlagsStore } from '@nestfolio/ui/feature-flags';

@Component({
  selector: 'app-system-banner',
  standalone: true,
  template: `
    @if (show()) {
      <div class="system-banner" role="alert">
        <span class="system-banner__icon">&#9888;</span>
        <span class="system-banner__message">{{ message() }}</span>
      </div>
    }
  `,
  styles: [`
    .system-banner {
      background: var(--warn-bg, #fff3cd);
      color: var(--warn-text, #856404);
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
    }
  `],
})
export class SystemBannerComponent {
  private readonly store = inject(FeatureFlagsStore);

  show = computed(() => this.store.disabledFlags().length > 0);
  message = computed(() => {
    const flags = this.store.disabledFlags();
    return flags.length > 0 ? (flags[0].reason ?? 'Some features are temporarily unavailable') : '';
  });
}
```

- [ ] **Step 2: Add banner to shell layout**

Read `libs/shell/src/components/shell-layout.component.ts`. Add `<app-system-banner>` above the main content area. Import `SystemBannerComponent` in the component's `imports` array.

- [ ] **Step 3: Initialize FeatureFlagService at boot**

In `apps/nestfolio-host/src/app/app.config.ts`, add to providers:

```typescript
import { FeatureFlagService } from '@nestfolio/shell';

// Add APP_INITIALIZER to trigger FeatureFlagService construction:
{
  provide: APP_INITIALIZER,
  useFactory: () => {
    inject(FeatureFlagService); // triggers constructor → loads flags + subscribes
    return () => Promise.resolve();
  },
  multi: true,
},
```

- [ ] **Step 4: Commit**

```bash
git add libs/shell/ apps/nestfolio-host/
git commit -m "feat(shell): add SystemBannerComponent and initialize feature flags at boot"
```

---

## Phase 9: Documentation

### Task 25: Create new flow spec and regenerate service cards

**Files:**
- Create: `flows/broker-circuit-breaker.flow.yaml`

- [ ] **Step 1: Write the flow spec**

Create `flows/broker-circuit-breaker.flow.yaml` based on the design spec (Section 8 of the brainstorming). Document the full event flow from broker-alpaca-adpt failure detection through investor notification.

- [ ] **Step 2: Commit**

```bash
git add flows/broker-circuit-breaker.flow.yaml
git commit -m "docs: add broker-circuit-breaker flow spec"
```

- [ ] **Step 3: Regenerate service cards**

Run the `audit-service` skill for each affected service:
- broker-alpaca-adpt
- broker-ctrl
- investor-adpt
- investor-bff
- investor-ctrl
- execution-adpt
- execution-ctrl
- advisory-ctrl
- advisory-adpt

- [ ] **Step 4: Regenerate C4 diagrams**

Run the `generate-c4-diagrams` skill.

- [ ] **Step 5: Commit**

```bash
git add services/*/CLAUDE.md docs/diagrams/
git commit -m "docs: regenerate service cards and C4 diagrams for circuit breaker redesign"
```

---

## Deferred (not needed for circuit breaker, add later if needed)

- **Route guard** (`canActivateWhenEnabled`) in `libs/ui/feature-flags/` — for gating entire Angular routes by feature flag. Not used in this feature.
- **Structural directive** (`*featureEnabled="'flagName'"`) in `libs/ui/feature-flags/` — for conditional template rendering. Not used in this feature (buttons use `[disabled]` binding instead).
- **investor-bff `getNotifications` SYSTEM merge** — update the query to include `pk=FeatureFlag#SYSTEM` notifications alongside tenant-specific ones. Implementation detail deferred to first deployment test.
