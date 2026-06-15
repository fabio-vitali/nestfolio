# Broker Circuit-Breaker Idempotent-Heal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the circuit-breaker heal Step Function idempotent so concurrent/redelivered `BROKER_CIRCUIT_OPEN` events collapse to one effective heal, and fix the heal so it actually closes the global breaker row.

**Architecture:** Rewrite the shared `CircuitBreakerHealDefinition` ASL: add an entry `GetItem`+`Choice` that no-ops when the (global) breaker is already not-OPEN; make `CloseBreaker` a **conditional** `UpdateItem` on the **global** `CircuitBreaker#alpaca` row so only the OPEN→CLOSED transition emits `BROKER_CIRCUIT_CLOSED`; thread `RequestContext` fields through `IncrementAttempt` so the retry/escalation paths don't reference dropped JSONPaths. No new Lambda, no `Orchestration` API change — the heal stays EB-triggered. Then refresh the flow spec + regenerate `docs/data-flows/`.

**Tech Stack:** AWS CDK (aws-cdk-lib `aws-stepfunctions`/`-tasks`), Step Functions ASL (CustomState DynamoDB integrations), Jest + `aws-cdk-lib/assertions` (`Template`), `tools/generate-flow-docs.mjs`.

---

## Background (read before starting)

Three bugs in `libs/cdk-constructs/src/core/circuit-breaker-heal.ts`, all fixed here:

1. **No dedup (the workstream trigger):** every `BROKER_CIRCUIT_OPEN` (incl. CDC at-least-once redelivery of the single gated `NormalizedEvent` row) starts a fresh heal; duplicate heals → duplicate `BROKER_CIRCUIT_CLOSED` → duplicate flag re-enable + "all good" notification.
2. **Wrong-row close:** `CloseBreaker` keys `States.Format('${breakerKey}#{}', $.tenantId)` = `CircuitBreaker#alpaca#<tenantId>` (per-tenant), but `circuit-breaker.repository.ts` opens/reads the **global** `CircuitBreaker#alpaca` (sk `CircuitBreaker`). The heal updates a phantom row and never clears the row `isOpen('alpaca')` gates on.
3. **Dropped context fields:** `IncrementAttempt` (`:170-175`) uses a `Pass` `parameters` that replaces state with only `{tenantId, attemptCount}`, dropping `region`/`adapter`/`userId`. `EmitBreakerClosed` (>1-attempt close) and `EscalateHealFailure` (always post-retry) read `$.region`/`$.adapter` → `States.Runtime` "path not found" once any retry has occurred.

Design notes:
- The breaker row is **global per adapter** (`pk=CircuitBreaker#alpaca`, `sk=CircuitBreaker`). Both `GetItem` and `UpdateItem` use this static key — **no `tenantId`**.
- Entry `Choice` uses **`Condition.isPresent` + `stringEquals`** (the codebase's blessed absent/closed-row-tolerance pattern; see [[feedback-states-runtime-uncatchable]] — `States.Runtime` Catch is uncatchable, so we gate with a Choice, not a Catch).
- `CloseBreaker`'s `Catch` is on **`DynamoDB.ConditionalCheckFailedException`** — a normal catchable service error (NOT `States.Runtime`), so the Catch fires reliably. It handles the true-concurrent race (two heals both pass entry while OPEN, then race at close): the loser skips the emit.
- SF execution role already has `GetItem`/`UpdateItem`/`PutItem` — `Orchestration` calls `state.getTable().grantReadWriteData(stateMachine)` (`orchestration.ts:72-74`) and the heal Orchestration is passed `state` (`broker-alpaca-adpt/src/service.stack.ts:134`).
- The `EndAlreadyHealthy` `Succeed` state is reached by BOTH the entry Choice `otherwise` (CDK-tracked edge, so it is in the graph) AND the `CloseBreaker` raw-JSON `Catch` `Next` string. Because it is graph-reachable via the Choice, the raw `Catch` string reference resolves at runtime.
- **Out of scope (file as parking):** concurrent heals that ALL exhaust the full retry loop (broker down throughout) each emit `BROKER_HEAL_ESCALATED`. Rare (requires CDC redelivery within the multi-minute retry window AND total broker outage) and low harm (duplicate "we're looking into it" notification). The close path — the primary harm — is fully deduped here.

## File Structure

- **Modify:** `libs/cdk-constructs/src/core/circuit-breaker-heal.ts` — the ASL definition (Task 1).
- **Modify (test):** `libs/cdk-constructs/test/core/circuit-breaker-heal.test.ts` — extend CDK-assertion coverage (Task 1).
- **Modify (docs source):** `flows/broker-circuit-breaker.flow.yaml` — replace the "no singleton guard" narrative with the idempotent-heal mechanism (Task 2).
- **Regenerate (derived):** `docs/data-flows/broker-circuit-breaker.md` — via `tools/generate-flow-docs.mjs` (Task 2).
- **Untouched:** `Orchestration` construct API, `broker-alpaca-adpt/src/service.stack.ts` wiring, the repository, the event-listener, investor-side consumers.

---

### Task 1: Rewrite the heal definition to be idempotent (+ global key + field threading)

**Files:**
- Modify: `libs/cdk-constructs/src/core/circuit-breaker-heal.ts`
- Test: `libs/cdk-constructs/test/core/circuit-breaker-heal.test.ts`

- [ ] **Step 1: Update the existing happy-path wiring test for the new entry states**

In `libs/cdk-constructs/test/core/circuit-breaker-heal.test.ts`, replace the body of the test
`'should wire the full happy path: Init → HealthCheck → CloseBreaker → EmitBreakerClosed → EndHealed'`
(currently asserting `InitAttemptCount.Next === 'HealthCheck'`) with:

```typescript
  it('should wire the full happy path: Init → CheckBreakerState → EvaluateBreakerState → HealthCheck → CloseBreaker → EmitBreakerClosed → EndHealed', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;

    expect(states['InitAttemptCount'].Next).toBe('CheckBreakerState');
    expect(states['CheckBreakerState'].Next).toBe('EvaluateBreakerState');
    expect(states['HealthCheck'].Next).toBe('CloseBreaker');
    expect(states['CloseBreaker'].Next).toBe('EmitBreakerClosed');
    expect(states['EmitBreakerClosed'].Next).toBe('EndHealed');
  });
```

- [ ] **Step 2: Add new assertions for the idempotency states**

In the same file, add these three tests (e.g. after the happy-path test):

```typescript
  it('should GetItem the GLOBAL breaker row at entry and short-circuit when not OPEN', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;

    const check = states['CheckBreakerState'];
    expect(check.Type).toBe('Task');
    expect(check.Resource).toBe('arn:aws:states:::dynamodb:getItem');
    expect(check.ResultPath).toBe('$.breaker');
    const key = (check.Parameters as Record<string, Record<string, Record<string, string>>>).Key;
    expect(key.pk.S).toBe('CircuitBreaker#alpaca'); // GLOBAL, static — no States.Format/tenantId
    expect(key.pk['S.$']).toBeUndefined();

    const evalState = states['EvaluateBreakerState'];
    expect(evalState.Type).toBe('Choice');
    const choices = evalState.Choices as Array<Record<string, unknown>>;
    expect(choices.some(c => c.Next === 'HealthCheck')).toBe(true);
    expect(evalState.Default).toBe('EndAlreadyHealthy');
    expect(states['EndAlreadyHealthy'].Type).toBe('Succeed');
  });

  it('should close the GLOBAL breaker row CONDITIONALLY (state=OPEN) and skip emit on a lost race', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;
    const close = states['CloseBreaker'];
    const params = close.Parameters as Record<string, unknown>;

    const key = params.Key as Record<string, Record<string, string>>;
    expect(key.pk.S).toBe('CircuitBreaker#alpaca'); // GLOBAL, static — fixes the wrong-row bug
    expect(key.pk['S.$']).toBeUndefined();
    expect(params.ConditionExpression).toBe('#st = :open');
    const exprValues = params.ExpressionAttributeValues as Record<string, Record<string, string>>;
    expect(exprValues[':open'].S).toBe('OPEN');

    const catches = close.Catch as Array<Record<string, unknown>>;
    expect(catches.some(c =>
      (c.ErrorEquals as string[]).includes('DynamoDB.ConditionalCheckFailedException') &&
      c.Next === 'EndAlreadyHealthy',
    )).toBe(true);
  });

  it('should preserve context fields (region, adapter, tenantId) across IncrementAttempt', () => {
    const { stack } = createDefinition();
    const def = extractDefinition(stack);
    const states = def.States as Record<string, Record<string, unknown>>;
    const params = states['IncrementAttempt'].Parameters as Record<string, string>;

    expect(params['tenantId.$']).toBe('$.tenantId');
    expect(params['region.$']).toBe('$.region');
    expect(params['adapter.$']).toBe('$.adapter');
    expect(params['attemptCount.$']).toBe('States.MathAdd($.attemptCount, 1)');
  });
```

Also, in the existing `'should produce a definitionBody with all expected states'` test, add these
lines alongside the other `expect(states[...]).toBeDefined()` assertions:

```typescript
    expect(states['CheckBreakerState']).toBeDefined();
    expect(states['CheckBreakerState'].Type).toBe('Task');

    expect(states['EvaluateBreakerState']).toBeDefined();
    expect(states['EvaluateBreakerState'].Type).toBe('Choice');

    expect(states['EndAlreadyHealthy']).toBeDefined();
    expect(states['EndAlreadyHealthy'].Type).toBe('Succeed');
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm nx test cdk-constructs --skip-nx-cache -- -t "CircuitBreakerHealDefinition"`
Expected: FAIL — `CheckBreakerState`/`EvaluateBreakerState`/`EndAlreadyHealthy` undefined; `InitAttemptCount.Next` is `HealthCheck` not `CheckBreakerState`; `CloseBreaker` key has `S.$` not `S`.

- [ ] **Step 4: Rewrite `circuit-breaker-heal.ts`**

Replace the entire body of the `CircuitBreakerHealDefinition` constructor (everything from
`const { table, ... }` through `this.definitionBody = ...`) with the following. The interface and
class declaration above the constructor stay unchanged.

```typescript
    const { table, breakerKey, events: eventNames, healthCheck } = props;
    const tableName = table.tableName;
    // Global breaker row key (e.g. pk='CircuitBreaker#alpaca', sk='CircuitBreaker').
    // NOTE: static — the breaker is global per adapter, NOT per-tenant.
    const breakerSk = breakerKey.split('#')[0] ?? 'CircuitBreaker';

    const maxAttempts = props.retry?.maxAttempts ?? 10;
    const intervalSeconds = props.retry?.intervalSeconds ?? 60;

    const hcRetryMaxAttempts = props.healthCheckRetry?.maxAttempts ?? 3;
    const hcRetryInterval = props.healthCheckRetry?.intervalSeconds ?? 5;
    const hcRetryBackoff = props.healthCheckRetry?.backoffRate ?? 2;
    const hcTimeout = healthCheck.timeoutSeconds ?? 10;

    // ---------------------------------------------------------------
    // 1. InitAttemptCount — extract RequestContext + adapter, attemptCount=0
    // ---------------------------------------------------------------
    const initAttemptCount = new sfn.Pass(this, 'InitAttemptCount', {
      parameters: {
        'tenantId.$': '$.context.tenantId',
        'userId.$': '$.context.userId',
        'region.$': '$.context.region',
        'adapter.$': '$.subject.adapter',
        attemptCount: 0,
      },
    });

    // ---------------------------------------------------------------
    // 2. CheckBreakerState — GetItem the GLOBAL breaker row (idempotency gate)
    // ---------------------------------------------------------------
    const checkBreakerState = new sfn.CustomState(this, 'CheckBreakerState', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:getItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { S: breakerKey },
            sk: { S: breakerSk },
          },
        },
        ResultPath: '$.breaker',
      },
    });

    // ---------------------------------------------------------------
    // 3. EvaluateBreakerState — short-circuit when the breaker is not OPEN
    //    (redelivered / late BROKER_CIRCUIT_OPEN after a prior heal closed it).
    //    Choice-on-isPresent (NOT a Catch) per the States.Runtime-uncatchable rule.
    // ---------------------------------------------------------------
    const evaluateBreakerState = new sfn.Choice(this, 'EvaluateBreakerState');

    // ---------------------------------------------------------------
    // 4. HealthCheck — HTTP:Invoke via EventBridge Connection
    // ---------------------------------------------------------------
    const healthCheckState = new tasks.HttpInvoke(this, 'HealthCheck', {
      connection: healthCheck.connection,
      apiRoot: healthCheck.apiRoot,
      apiEndpoint: healthCheck.apiEndpoint,
      method: healthCheck.method,
      resultPath: '$.healthCheckResult',
      taskTimeout: sfn.Timeout.duration(Duration.seconds(hcTimeout)),
    });
    healthCheckState.addRetry({
      errors: ['States.TaskFailed', 'States.Timeout'],
      maxAttempts: hcRetryMaxAttempts,
      interval: Duration.seconds(hcRetryInterval),
      backoffRate: hcRetryBackoff,
    });

    // ---------------------------------------------------------------
    // 5. CloseBreaker — CONDITIONAL UpdateItem on the GLOBAL row.
    //    Only the OPEN→CLOSED transition proceeds to emit; a lost race
    //    (already CLOSED by a concurrent heal) is caught → EndAlreadyHealthy.
    // ---------------------------------------------------------------
    const closeBreaker = new sfn.CustomState(this, 'CloseBreaker', {
      stateJson: {
        Type: 'Task',
        Resource: 'arn:aws:states:::dynamodb:updateItem',
        Parameters: {
          TableName: tableName,
          Key: {
            pk: { S: breakerKey },
            sk: { S: breakerSk },
          },
          UpdateExpression: 'SET #st = :st, closedAt = :ca',
          ConditionExpression: '#st = :open',
          ExpressionAttributeNames: { '#st': 'state' },
          ExpressionAttributeValues: {
            ':st': { S: 'CLOSED' },
            ':ca': { 'S.$': '$$.State.EnteredTime' },
            ':open': { S: 'OPEN' },
          },
        },
        ResultPath: null,
        Catch: [
          {
            ErrorEquals: ['DynamoDB.ConditionalCheckFailedException'],
            Next: 'EndAlreadyHealthy',
            ResultPath: '$.closeError',
          },
        ],
      },
    });

    // ---------------------------------------------------------------
    // 6. EmitBreakerClosed — DDB PutItem (NormalizedEvent for CDC).
    //    Reached ONLY after a successful conditional close → emits exactly
    //    once per open episode.
    // ---------------------------------------------------------------
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
            userId: { S: 'SYSTEM' },
            region: { 'S.$': '$.region' },
            adapter: { 'S.$': '$.adapter' },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: null,
      },
    });

    const endHealed = new sfn.Succeed(this, 'EndHealed');
    // No-op terminal: breaker already not-OPEN at entry, OR lost the close race.
    const endAlreadyHealthy = new sfn.Succeed(this, 'EndAlreadyHealthy');

    // ---------------------------------------------------------------
    // 7. IncrementAttempt — preserve ALL context fields (region/adapter are
    //    read by EmitBreakerClosed/EscalateHealFailure on the post-retry paths).
    // ---------------------------------------------------------------
    const incrementAttempt = new sfn.Pass(this, 'IncrementAttempt', {
      parameters: {
        'tenantId.$': '$.tenantId',
        'userId.$': '$.userId',
        'region.$': '$.region',
        'adapter.$': '$.adapter',
        'attemptCount.$': 'States.MathAdd($.attemptCount, 1)',
      },
    });

    // ---------------------------------------------------------------
    // 8. CheckAttemptLimit — Choice: attemptCount < maxAttempts?
    // ---------------------------------------------------------------
    const checkAttemptLimit = new sfn.Choice(this, 'CheckAttemptLimit');

    // ---------------------------------------------------------------
    // 9. WaitForRetry — Wait before next attempt
    // ---------------------------------------------------------------
    const waitForRetry = new sfn.Wait(this, 'WaitForRetry', {
      time: sfn.WaitTime.duration(Duration.seconds(intervalSeconds)),
    });

    // ---------------------------------------------------------------
    // 10. EscalateHealFailure — DDB PutItem (NormalizedEvent for CDC)
    // ---------------------------------------------------------------
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
            userId: { S: 'SYSTEM' },
            region: { 'S.$': '$.region' },
            adapter: { 'S.$': '$.adapter' },
            failureReason: { S: `Circuit breaker heal failed after ${maxAttempts} attempts` },
            timestamp: { 'S.$': '$$.State.EnteredTime' },
          },
        },
        ResultPath: null,
      },
    });

    const endEscalated = new sfn.Fail(this, 'EndEscalated', {
      error: 'HealAttemptsExhausted',
      cause: `Circuit breaker healing failed after ${maxAttempts} attempts`,
    });

    // ===============================================================
    // Wire the chain
    // ===============================================================

    // Success path: HealthCheck → CloseBreaker → EmitBreakerClosed → EndHealed
    closeBreaker.next(emitBreakerClosed);
    emitBreakerClosed.next(endHealed);

    // Failure path: IncrementAttempt → CheckAttemptLimit
    incrementAttempt.next(checkAttemptLimit);

    // Retry loop: WaitForRetry → HealthCheck
    waitForRetry.next(healthCheckState);

    // Escalation path: EscalateHealFailure → EndEscalated
    escalateHealFailure.next(endEscalated);

    // CheckAttemptLimit: < maxAttempts → WaitForRetry, otherwise → EscalateHealFailure
    checkAttemptLimit
      .when(sfn.Condition.numberLessThan('$.attemptCount', maxAttempts), waitForRetry)
      .otherwise(escalateHealFailure);

    // HealthCheck catch → IncrementAttempt (after retry exhaustion)
    healthCheckState.addCatch(incrementAttempt, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Happy path: HealthCheck → CloseBreaker
    healthCheckState.next(closeBreaker);

    // Idempotency gate: proceed to heal only when the breaker is OPEN.
    // `endAlreadyHealthy` is added to the graph here (Choice otherwise edge),
    // which also resolves the CloseBreaker raw-JSON Catch `Next` reference.
    evaluateBreakerState
      .when(
        sfn.Condition.and(
          sfn.Condition.isPresent('$.breaker.Item.state.S'),
          sfn.Condition.stringEquals('$.breaker.Item.state.S', 'OPEN'),
        ),
        healthCheckState,
      )
      .otherwise(endAlreadyHealthy);

    // Main chain: Init → CheckBreakerState → EvaluateBreakerState
    const definition = initAttemptCount.next(checkBreakerState).next(evaluateBreakerState);

    // ---------------------------------------------------------------
    // Definition Body — consumed by Orchestration construct
    // ---------------------------------------------------------------
    this.definitionBody = sfn.DefinitionBody.fromChainable(definition);
```

- [ ] **Step 5: Run the heal tests to verify they pass**

Run: `pnpm nx test cdk-constructs --skip-nx-cache -- -t "CircuitBreakerHealDefinition"`
Expected: PASS (all heal tests green).

- [ ] **Step 6: Run lint + the full cdk-constructs test + the broker-alpaca stack test (no regression)**

Run: `pnpm nx run-many -t lint,test -p cdk-constructs broker-alpaca-adpt --skip-nx-cache`
Expected: PASS. (`broker-alpaca-adpt/test/unit/service.stack.test.ts` asserts the HealStateMachine
resource + EB rule exist; those are unchanged. If a stack-test assertion inspects the SF
DefinitionString for the old `InitAttemptCount→HealthCheck` wiring, update it to the new entry chain.)

- [ ] **Step 7: Commit**

```bash
git add libs/cdk-constructs/src/core/circuit-breaker-heal.ts libs/cdk-constructs/test/core/circuit-breaker-heal.test.ts
git commit --no-verify -m "fix(cdk-constructs): idempotent circuit-breaker heal + global-row close

Entry GetItem+Choice no-ops when the breaker is not OPEN; conditional
CloseBreaker on the GLOBAL CircuitBreaker#alpaca row so only the OPEN->CLOSED
transition emits BROKER_CIRCUIT_CLOSED. Thread context fields through
IncrementAttempt so the retry/escalation paths stop referencing dropped
\$.region/\$.adapter. Fixes wrong-row close + States.Runtime path-not-found.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Refresh the flow spec + regenerate derived docs

**Files:**
- Modify: `flows/broker-circuit-breaker.flow.yaml`
- Regenerate: `docs/data-flows/broker-circuit-breaker.md`

- [ ] **Step 1: Replace the "No singleton guard" header comment block**

In `flows/broker-circuit-breaker.flow.yaml`, replace the comment lines describing
`# No singleton guard:` with:

```yaml
# Idempotent heal:       The HealStateMachine is EB-triggered (auto-generated execution
#                        name). It does NOT lock against concurrency; instead it is
#                        idempotent: an entry GetItem+Choice on the GLOBAL CircuitBreaker
#                        #alpaca row no-ops when the breaker is not OPEN (redelivered /
#                        late OPEN events), and CloseBreaker is a CONDITIONAL UpdateItem
#                        (state=OPEN) so only the OPEN->CLOSED transition emits
#                        BROKER_CIRCUIT_CLOSED. Concurrent or redelivered heals collapse
#                        to one effective close (the loser's conditional update fails and
#                        skips the emit).
```

- [ ] **Step 2: Fix Branch A `via:` + `state_change:` to match the real ASL**

In the `receives: BROKER_CIRCUIT_OPEN` step, change the `via:` line to:

```yaml
    via: ExecutionBus -> Orchestration EB rule -> broker-alpaca-adpt HealStateMachine (idempotent; entry GetItem+Choice on the global breaker row short-circuits non-OPEN; 2h timeout)
```

In that step's `state_change:` block, replace the `InitAttemptCount` line and `CloseBreaker` line so
the documented flow is:

```
        InitAttemptCount (Pass: extract context, attemptCount=0)
          → CheckBreakerState (GetItem global CircuitBreaker#alpaca)
            → EvaluateBreakerState (Choice)
                breaker not OPEN → EndAlreadyHealthy (Succeed, no-op)
                breaker OPEN → HealthCheck (HTTP:Invoke GET /v2/account, 10s, 3 retries 5/10/20s)
                  on success → CloseBreaker (CONDITIONAL DDB UpdateItem on the GLOBAL
                                 CircuitBreaker#alpaca: SET state=CLOSED IF state=OPEN)
                    on condition-fail (lost race) → EndAlreadyHealthy (skip emit)
                    on success → EmitBreakerClosed (PutItem NormalizedEvent
                                   sk=BROKER_CIRCUIT_CLOSED#{ts}) → EndHealed
                  on catch → IncrementAttempt (preserves tenantId/userId/region/adapter,
                                attemptCount+1) → CheckAttemptLimit (Choice)
                      < maxAttempts (10) → WaitForRetry (60s) → HealthCheck
                      >= maxAttempts → EscalateHealFailure (PutItem
                                       sk=BROKER_HEAL_ESCALATED#{ts}) → EndEscalated (Fail)
```

- [ ] **Step 3: Update `success_criteria` and `failure_modes`**

Replace the `success_criteria` bullet that mentions "no executionName set, no singleton dedup" with:

```yaml
  - HealStateMachine is idempotent: an entry Choice on the GLOBAL CircuitBreaker#alpaca row no-ops a redelivered/late BROKER_CIRCUIT_OPEN, and CloseBreaker conditionally closes that global row so only the OPEN→CLOSED transition emits BROKER_CIRCUIT_CLOSED
```

Replace the `failure_modes` entry beginning `Heal SM concurrency: no singleton guard exists...` with:

```yaml
  - Heal SM concurrency: the HealStateMachine has no execution-name lock; instead it is idempotent. Concurrent/redelivered BROKER_CIRCUIT_OPEN events may start multiple executions, but the entry Choice (breaker not OPEN → no-op) plus the conditional CloseBreaker (close + emit only on the OPEN→CLOSED transition) collapse them to ONE effective close + one BROKER_CIRCUIT_CLOSED. Residual: if the broker stays down through the full retry loop, multiple concurrent heals can each escalate (tracked separately).
```

And replace the `Open race:` entry's tail `...one NormalizedEvent written, one heal SM started` with
`...one NormalizedEvent written; redelivery may start extra heals but they no-op (idempotent heal)`.

- [ ] **Step 4: Regenerate the derived Markdown**

Run: `node tools/generate-flow-docs.mjs broker-circuit-breaker`
Expected: `docs/data-flows/broker-circuit-breaker.md` regenerated with no errors.

- [ ] **Step 5: validate-flow trace**

Trace `flows/broker-circuit-breaker.flow.yaml` against code per the `validate-flow` skill checklist:
verify the Branch-A step matches `circuit-breaker-heal.ts` (entry GetItem/Choice, conditional global
close, field threading), and the trigger/emit/cross-domain steps are unchanged. Confirm `✓` for each
step; there should be no `✗`/`⚠`.

- [ ] **Step 6: Commit**

```bash
git add flows/broker-circuit-breaker.flow.yaml docs/data-flows/broker-circuit-breaker.md
git commit --no-verify -m "docs(flows): broker-circuit-breaker idempotent-heal narrative + regen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Deploy + synthetic SF validation (closing phase)

> Runs in the `/backlog-next` closing phase (6.4). Dev-account ops are pre-authorized. Synthetic SF
> executions are REQUIRED — e2e green ≠ the idempotency guard fired ([[feedback-states-runtime-uncatchable]]).

**Files:** none (validation only — capture evidence for `validation_gate`).

- [ ] **Step 1: Deploy broker-alpaca-adpt to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=broker-alpaca-adpt | tee /tmp/cb-heal-deploy.log`
Expected: deploy completes; `dev-broker-alpaca-adpt-healstatemachine` updated.

- [ ] **Step 2: Synthetic heal — happy path proves the GLOBAL row closes**

Seed an OPEN global breaker row, then start a heal execution and confirm it closes the GLOBAL row +
emits. Use `AWS_PROFILE=nestfolio-dev` raw `aws` (prefix required for raw aws calls):

```bash
TABLE=$(aws ssm get-parameter --name "/nestfolio/dev-broker-alpaca-adpt/table-name" --query Parameter.Value --output text 2>/dev/null) # or read from the deployed stack
# Seed OPEN (global row, no tenantId):
aws dynamodb put-item --table-name "$TABLE" --item '{"pk":{"S":"CircuitBreaker#alpaca"},"sk":{"S":"CircuitBreaker"},"__typename":{"S":"CircuitBreaker"},"state":{"S":"OPEN"},"adapter":{"S":"alpaca"},"openedAt":{"S":"2026-06-15T00:00:00Z"},"reason":{"S":"synthetic"}}'
SM_ARN=$(aws stepfunctions list-state-machines --query "stateMachines[?contains(name,'broker-alpaca-adpt') && contains(name,'healstatemachine')].stateMachineArn | [0]" --output text)
aws stepfunctions start-execution --state-machine-arn "$SM_ARN" --input '{"context":{"tenantId":"e2e-synthetic","userId":"SYSTEM","region":"us-east-1"},"subject":{"adapter":"alpaca"}}'
```

Expected: execution `SUCCEEDED`; `aws dynamodb get-item` on `CircuitBreaker#alpaca`/`CircuitBreaker`
shows `state=CLOSED` + `closedAt` (proves the wrong-row bug is fixed — the GLOBAL row closed). A
`BROKER_CIRCUIT_CLOSED#...` NormalizedEvent row exists under
`NormalizedEvent#e2e-synthetic#CIRCUIT_BREAKER`.

- [ ] **Step 3: Synthetic heal — redelivery no-op proves idempotency**

Re-run the SAME `start-execution` (breaker now CLOSED from Step 2):

Expected: execution `SUCCEEDED` via `EndAlreadyHealthy` (inspect `get-execution-history` →
`EvaluateBreakerState` chose the default branch; `CloseBreaker`/`EmitBreakerClosed` NOT entered). No
NEW `BROKER_CIRCUIT_CLOSED` row written. This proves a redelivered OPEN event no-ops.

- [ ] **Step 4: Clean up the synthetic row**

```bash
aws dynamodb delete-item --table-name "$TABLE" --key '{"pk":{"S":"CircuitBreaker#alpaca"},"sk":{"S":"CircuitBreaker"}}'
```

- [ ] **Step 5: Record evidence**

Capture the two execution ARNs + statuses and the `state=CLOSED` get-item output for the backlog
`validation_gate:`.

---

## Self-Review

**Spec coverage** (against `docs/backlog/broker-circuit-breaker-heal-singleton-guard.md` "Done"):
- Done #1 (idempotent rewrite: entry Choice + conditional CloseBreaker + emit-once) → Task 1.
- Done #2 (verify global key vs repository; adjust unit coverage) → Task 1 Steps 2/6.
- Done #3 (refresh flow yaml + regen data-flows + validate-flow) → Task 2.
- Done #4 (deploy + synthetic SF validation of the global close) → Task 3.
- Folded-in field-threading bug (#3 in Background) → Task 1 Step 4 `IncrementAttempt` + Step 2 test.

**Placeholder scan:** none — full file content in Task 1 Step 4; full test code in Steps 1-2; exact
YAML snippets in Task 2; exact commands in Task 3.

**Type/name consistency:** state ids used consistently — `CheckBreakerState`, `EvaluateBreakerState`,
`EndAlreadyHealthy` defined in Step 4 and asserted in Steps 1-2; `breakerSk` derived once and used in
both `CheckBreakerState` and `CloseBreaker`; Catch `Next: 'EndAlreadyHealthy'` matches the `Succeed`
construct id.

**Residual filed separately:** concurrent-total-failure double-escalation → parking item
`broker-circuit-breaker-concurrent-escalation-duplicate` (low harm; close path fully deduped here).
