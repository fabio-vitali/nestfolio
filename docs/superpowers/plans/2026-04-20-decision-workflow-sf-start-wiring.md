# decision-workflow-ctrl SF-start wiring — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the `WORKFLOW_TRIGGER_CREATED` → `StartExecution` wire so that `dev-decision-workflow-ctrl-decisionstatemachine` actually runs in sandbox when a trigger event (e.g. `MANDATE_CREATED`) is published, unblocking live agent-contract e2e assertions.

**Architecture:** Use the `Orchestration` construct's native `triggers` parameter with the single canonical event `WORKFLOW_TRIGGER_CREATED`. Add one entry `Pass` state in the SF definition to flatten the CDC envelope (`$.subject.{decisionId,tenantId}` → top level) so the existing agent-invocation task states continue to work unchanged. All other pipelines — `materializeToTable` fan-in, `changeDataCapture` CDC, `resumeStateMachine` callback — remain as-is.

**Tech Stack:** AWS CDK (TypeScript), `@nestfolio/cdk-constructs` (`Orchestration`, `Ingress`, `Egress`, `State`), AWS Step Functions (CustomState / Pass / CDK assertions), `@nestfolio/event-processor` (`materializeToTable`, `changeDataCapture`, `resumeStateMachine`), `@nestfolio/test-support` + `@nestfolio/integration-testing` for integration tests, Nx build pipeline (`pnpm nx ...`).

**Design spec:** `docs/superpowers/specs/2026-04-20-decision-workflow-sf-start-wiring-design.md`

**Scope (what this plan changes):**
- `services/advisory/decision-workflow-ctrl/src/service.stack.ts` — one line: `triggers: [...]`
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` — prepend one `Pass` state
- `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts` — fix misleading comment
- `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` — add CDK assertion for the new EB Rule + SfnStateMachine target
- `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts` — add "SF execution started" assertion alongside existing CDC assertion
- `flows/advisory-cycle.flow.yaml` — replace aspirational NOTE with explicit step
- `docs/data-flows/advisory-cycle.md` — regenerated from flow spec
- `services/advisory/decision-workflow-ctrl/CLAUDE.md` — regenerated service card

**Scope (what this plan does NOT change):**
- `TriggerIngress` handler behaviour (`event-listener.ts` logic)
- `CallbackIngress` handler (`sfn-callback.ts`)
- `AssemblePacket` Lambda
- `Egress` CDC configuration
- `AgentCore Memory` configuration
- Any other service, adapter, or cross-domain rule
- `@nestfolio/event-processor` library (no new pipeline primitive)

**Working directory convention:** All file paths in this plan are relative to the nestfolio repo root. When executing inside a worktree (per `superpowers:using-git-worktrees`), the worktree root is the current working directory — paths resolve the same way.

---

## Task 0: Preflight — verify current state

**Why:** Confirm no one else has touched these files since diagnosis, and that the starting state matches assumptions (Defect 1 still present, Defect 2 still present).

**Files:**
- Read: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Read: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
- Read: `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts`

- [ ] **Step 1: Confirm current `triggers: []` in the stack**

Run: `grep -n "triggers:" services/advisory/decision-workflow-ctrl/src/service.stack.ts`
Expected output (exact):
```
123:      triggers: [],  // No direct EB trigger — SF started via CDC chain
```
If the line differs, stop and re-read the file — someone changed it.

- [ ] **Step 2: Confirm no existing `StartExecution` wiring in the service**

Run: `grep -rn "startExecution\|grantStartExecution\|StartExecution" services/advisory/decision-workflow-ctrl/src/ services/advisory/decision-workflow-ctrl/test/`
Expected: no matches (other than possibly in the entry comment we're about to remove). If any file grants `StartExecution`, stop and investigate.

- [ ] **Step 3: Confirm SF definition's first chained state is `parallelProfiling`**

Run: `grep -n "const definition = " services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
Expected output (exact):
```
219:    const definition = parallelProfiling
```
This is the state we will prepend `unpackTriggerEnvelope` in front of. If the entry state has changed, adjust Task 3 accordingly.

- [ ] **Step 4: Confirm CDC envelope shape for `WORKFLOW_TRIGGER_CREATED`**

Read: `libs/event-processor/src/pipelines/change-data-capture.ts` lines 60-78 — confirms that the detail shape is `{id, type, timestamp, subject: <full DDB record>, context: {tenantId, userId, region}}`. For a `WorkflowTrigger` INSERT, `subject` contains the fields written by `record('WorkflowTrigger', {tenantId, decisionId, trigger, triggerEventId, context})`. So SF input after `RuleTargetInput.fromEventPath('$.detail')` has paths `$.subject.tenantId`, `$.subject.decisionId`, `$.subject.trigger`, `$.subject.context`. Note this for Task 3.

Also cross-check the existing integration test: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts:159` asserts `cdcEvent.detail.subject.trigger === 'MANDATE_CREATED'` and `:160` asserts `cdcEvent.detail.subject.tenantId === ctx.tenantId`. This confirms the envelope shape empirically.

- [ ] **Step 5: No commit yet** (read-only preflight)

---

## Task 1: Add failing CDK unit test for the `WORKFLOW_TRIGGER_CREATED` → SF Rule

**Why:** TDD. Lock in the expected output of the stack change before we make it.

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Add the failing test**

Open `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` and append the following test case inside the `describe('DecisionWorkflowCtrlStack', ...)` block (just before the closing `});` at the end of the file):

```typescript
it('wires WORKFLOW_TRIGGER_CREATED from advisory bus to the Decision state machine', () => {
  // There must be an EB Rule on the advisory bus matching WORKFLOW_TRIGGER_CREATED
  // with the Decision state machine as a target (RuleTargetInput.fromEventPath('$.detail')).
  const rules = template.findResources('AWS::Events::Rule');
  const matching = Object.values(rules).filter((r: any) => {
    const pattern = r.Properties?.EventPattern;
    const detailTypes = pattern?.['detail-type'];
    return Array.isArray(detailTypes)
      && detailTypes.includes('WORKFLOW_TRIGGER_CREATED');
  });
  expect(matching.length).toBe(1);

  const rule = matching[0] as any;
  const targets = rule.Properties.Targets ?? [];
  // One of the targets must reference the state machine
  const sfTarget = targets.find((t: any) => {
    const arn = t.Arn;
    // The Arn is a Ref/Fn::GetAtt to the state machine; look for StateMachine-shaped logical ids
    return typeof arn === 'object' && JSON.stringify(arn).includes('StateMachine');
  });
  expect(sfTarget).toBeDefined();
  // Input should be the event detail so the SF sees {id,type,timestamp,subject,context}
  expect(sfTarget.InputPath).toBe('$.detail');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm nx test decision-workflow-ctrl -- -t "wires WORKFLOW_TRIGGER_CREATED"`
Expected: FAIL. Failure message should look like `Expected length: 1 / Received length: 0` — confirms that no rule currently matches `WORKFLOW_TRIGGER_CREATED`.

- [ ] **Step 3: Commit the failing test**

```bash
git add services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "test(decision-workflow-ctrl): failing test for WORKFLOW_TRIGGER_CREATED->SF rule"
```

---

## Task 2: Wire the canonical trigger event into `Orchestration`

**Why:** Single-line stack change that uses the construct's native `triggers` path. This creates the missing EB Rule → `SfnStateMachine` target.

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`

- [ ] **Step 1: Update the stack to declare the trigger**

Edit `services/advisory/decision-workflow-ctrl/src/service.stack.ts`. Replace exactly this block:

```typescript
    const orchestration = new Orchestration(this, 'DecisionStateMachine', {
      state,
      definitionBody: decisionWorkflow.definitionBody,
      triggers: [],  // No direct EB trigger — SF started via CDC chain
      timeout: Duration.hours(72),
    });
```

with:

```typescript
    const orchestration = new Orchestration(this, 'DecisionStateMachine', {
      state,
      definitionBody: decisionWorkflow.definitionBody,
      // Canonical start event: TriggerIngress materializes 11 heterogeneous triggers
      // into a WorkflowTrigger row; Egress CDC emits WORKFLOW_TRIGGER_CREATED on INSERT,
      // which is routed here to StartExecution. See flows/advisory-cycle.flow.yaml.
      triggers: [DecisionWorkflowEventTypes.WORKFLOW_TRIGGER_CREATED],
      timeout: Duration.hours(72),
    });
```

No other imports or lines change in this file — `DecisionWorkflowEventTypes` is already imported at line 10.

- [ ] **Step 2: Run the failing test — expect it to pass now**

Run: `pnpm nx test decision-workflow-ctrl -- -t "wires WORKFLOW_TRIGGER_CREATED"`
Expected: PASS.

- [ ] **Step 3: Run the full unit test suite for this service**

Run: `pnpm nx test decision-workflow-ctrl`
Expected: all tests pass. If the `test-integration` target runs here, it will be skipped without live AWS credentials — that's fine; we exercise it in Task 6.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts
git commit -m "feat(decision-workflow-ctrl): wire WORKFLOW_TRIGGER_CREATED to SF"
```

---

## Task 3: Add the `UnpackTriggerEnvelope` entry state to the SF definition

**Why:** The `Orchestration` construct forwards `$.detail` as SF input. For a CDC-emitted `WORKFLOW_TRIGGER_CREATED`, that detail is `{id, type, timestamp, subject, context}`. Every downstream agent-invocation state already references `$.decisionId` and `$.tenantId` at the top level. Adding one `Pass` state that hoists `subject.{decisionId,tenantId}` to the top level lets the rest of the definition remain unchanged.

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`

- [ ] **Step 1: Add the entry `Pass` state**

Edit `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`. Locate the block (near line 211):

```typescript
    const updateFinalStatus = new sfn.Pass(this, 'UpdateFinalStatus', {
      comment: 'Final status from user response',
    });

    const endSuccess = new sfn.Succeed(this, 'EndSuccess');

    // --- Wire the chain ---

    const definition = parallelProfiling
      .next(mergeParallelOutputs)
```

Insert, immediately after the `endSuccess` declaration and before the `// --- Wire the chain ---` comment, the following:

```typescript
    // --- Entry: unpack CDC envelope ({id,type,timestamp,subject,context}) into
    //     top-level {decisionId, tenantId, trigger, triggerContext} so downstream
    //     states can reference $.decisionId and $.tenantId directly. ---
    const unpackTriggerEnvelope = new sfn.Pass(this, 'UnpackTriggerEnvelope', {
      parameters: {
        'decisionId.$': '$.subject.decisionId',
        'tenantId.$': '$.subject.tenantId',
        'trigger.$': '$.subject.trigger',
        'triggerContext.$': '$.subject.context',
      },
    });
```

Then change the chain's first state from `parallelProfiling` to `unpackTriggerEnvelope`:

Replace:

```typescript
    const definition = parallelProfiling
      .next(mergeParallelOutputs)
```

with:

```typescript
    const definition = unpackTriggerEnvelope
      .next(parallelProfiling)
      .next(mergeParallelOutputs)
```

- [ ] **Step 2: Build the project to catch compile errors**

Run: `pnpm nx build decision-workflow-ctrl`
Expected: build succeeds. If TypeScript complains about `sfn.Pass` imports, verify `* as sfn from 'aws-cdk-lib/aws-stepfunctions'` is already imported (it is, line 5 of the file).

- [ ] **Step 3: Run unit tests again — all existing tests should still pass**

Run: `pnpm nx test decision-workflow-ctrl`
Expected: all tests pass, including the new one from Task 1.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
git commit -m "feat(decision-workflow-ctrl): unpack CDC envelope at SF entry"
```

---

## Task 4: Replace the misleading comment in `event-listener.ts`

**Why:** The current comment (`"CDK EventBridge rule starts Step Functions when CDC publishes WORKFLOW_TRIGGER_CREATED"`) was aspirational. It now describes what actually happens (this handler writes `WorkflowTrigger`; CDC emits `WORKFLOW_TRIGGER_CREATED`; the explicit `triggers` wiring in `service.stack.ts` starts the SF).

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts`

- [ ] **Step 1: Update the docstring**

Edit `services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts`. Replace exactly:

```typescript
/**
 * Trigger handler — writes a WorkflowTrigger record to DDB.
 * CDK EventBridge rule starts Step Functions when CDC publishes WORKFLOW_TRIGGER_CREATED.
 */
```

with:

```typescript
/**
 * Trigger handler — fan-in stage.
 * Subscribes to 11 heterogeneous trigger events and materialises each to a
 * WorkflowTrigger DDB row with a freshly-allocated decisionId. The subsequent
 * DDB stream drives the Egress CDC publisher, which emits WORKFLOW_TRIGGER_CREATED.
 * That canonical event is routed to the Decision state machine via the
 * Orchestration.triggers wiring in service.stack.ts.
 */
```

- [ ] **Step 2: Run unit tests for this handler**

Run: `pnpm nx test decision-workflow-ctrl -- -t "event-listener"`
Expected: PASS (no functional change).

- [ ] **Step 3: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/event-listener.ts
git commit -m "docs(decision-workflow-ctrl): correct event-listener docstring"
```

---

## Task 5: Update the integration test with a "SF execution started" assertion

**Why:** The existing test (`should write WorkflowTrigger on MANDATE_CREATED and emit CDC event`) stops at the CDC emission. Now that the SF actually runs on that emission, the test should also observe one fresh SF execution.

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 1: Confirm current test structure**

Read lines 123-161 of the test file (the `MANDATE_CREATED` test case). It currently:
1. Publishes `MANDATE_CREATED` to advisory bus.
2. Waits for `WorkflowTrigger` DDB row.
3. Waits for `WORKFLOW_TRIGGER_CREATED` CDC event.

We'll add a fourth step: assert that a fresh SF execution appears.

- [ ] **Step 2: Add `SFNClient` import at the top of the file**

After the existing imports block (after line 10 `} from '@nestfolio/integration-testing';`), add:

```typescript
import { SFNClient, ListExecutionsCommand } from '@aws-sdk/client-sfn';
```

- [ ] **Step 3: Add a helper `waitForSfExecution` function**

Below the existing `waitForTriggerRecord` helper function (after its closing `}` around line 80, before the `describe(...)` block at line 82), add:

```typescript
/**
 * Poll Step Functions ListExecutions until an execution started after `since`
 * appears on the given state machine ARN. Returns the execution metadata.
 */
async function waitForSfExecution(
  sfn: SFNClient,
  params: {
    stateMachineArn: string;
    since: Date;
    timeoutMs?: number;
  },
): Promise<{ executionArn: string; startDate: Date; name: string }> {
  const timeout = params.timeoutMs ?? 60_000;
  const pollInterval = 2_000;
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const resp = await sfn.send(new ListExecutionsCommand({
      stateMachineArn: params.stateMachineArn,
      maxResults: 20,
    }));
    const fresh = (resp.executions ?? []).find(
      (e) => e.startDate && new Date(e.startDate) >= params.since,
    );
    if (fresh?.executionArn && fresh.startDate && fresh.name) {
      return {
        executionArn: fresh.executionArn,
        startDate: new Date(fresh.startDate),
        name: fresh.name,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(
    `Timeout: no SF execution on ${params.stateMachineArn} started after ${params.since.toISOString()} within ${timeout}ms`,
  );
}
```

- [ ] **Step 4: Add SFN client instance to the `describe` block**

Inside the `describe('decision-workflow-ctrl', ...)` block, alongside the other client declarations (around line 83-86 where `ctx`, `eb`, `trap`, `table` are declared), add:

```typescript
  let sfn: SFNClient;
  let stateMachineArn: string;
```

Then in `beforeAll` (after the existing `table = new TableAssertions(ctx);` line around line 92), add:

```typescript
    sfn = new SFNClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    const prefix = process.env.NESTFOLIO_INTEG_PREFIX ?? 'integ';
    stateMachineArn = `arn:aws:states:${process.env.AWS_REGION ?? 'us-east-1'}:${ctx.accountId}:stateMachine:${prefix}-decision-workflow-ctrl-decisionstatemachine`;
```

If `ctx.accountId` is not already exposed by `@nestfolio/test-support`, fall back to resolving it via STS:

```typescript
    // ctx.accountId is exposed by createTestContext; if it is not, the line above needs
    // replacement with an STS GetCallerIdentity call.
```

If the fallback is needed, add this replacement block instead:

```typescript
    sfn = new SFNClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
    const prefix = process.env.NESTFOLIO_INTEG_PREFIX ?? 'integ';
    const sts = new (await import('@aws-sdk/client-sts')).STSClient({});
    const ident = await sts.send(new (await import('@aws-sdk/client-sts')).GetCallerIdentityCommand({}));
    stateMachineArn = `arn:aws:states:${process.env.AWS_REGION ?? 'us-east-1'}:${ident.Account}:stateMachine:${prefix}-decision-workflow-ctrl-decisionstatemachine`;
```

(Prefer `ctx.accountId` if it's available — verify by reading `libs/test-support/src/` for the `TestContext` shape. If unavailable, use the STS fallback.)

- [ ] **Step 5: Extend the `MANDATE_CREATED` test to assert SF execution**

In the `it('should write WorkflowTrigger on MANDATE_CREATED and emit CDC event', ...)` block, capture a timestamp before the `putEvent` call, and after the existing assertions on `cdcEvent`, add the SF-execution assertion.

Replace exactly this block:

```typescript
  it('should write WorkflowTrigger on MANDATE_CREATED and emit CDC event', async () => {
    const mandateId = `integ-mandate-${Date.now()}`;

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId,
        tenantId: ctx.tenantId,
        riskTolerance: 'MODERATE',
        investmentHorizon: 'LONG_TERM',
        targetReturn: 0.08,
        createdAt: new Date().toISOString(),
      },
    });

    // Verify: WorkflowTrigger written to DDB
    // record() default keys: pk = T#<tenantId>, sk = WorkflowTrigger#<eventId>
    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'MANDATE_CREATED',
      contextMatch: mandateId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('MANDATE_CREATED');

    // Verify: CDC emits WORKFLOW_TRIGGER_CREATED on advisory bus
    const cdcEvent = await trap.waitForEvent<BusEventPayload>({
      detailType: 'WORKFLOW_TRIGGER_CREATED',
      timeoutMs: 60_000,
    });
    expect(cdcEvent.detail.subject.trigger).toBe('MANDATE_CREATED');
    expect(cdcEvent.detail.subject.tenantId).toBe(ctx.tenantId);
  }, 120_000);
```

with:

```typescript
  it('should write WorkflowTrigger on MANDATE_CREATED, emit CDC, and start SF', async () => {
    const mandateId = `integ-mandate-${Date.now()}`;
    const testStart = new Date();

    await eb.putEvent({
      bus: 'advisory',
      targetService: 'decision-workflow-ctrl',
      detailType: 'MANDATE_CREATED',
      detail: {
        mandateId,
        tenantId: ctx.tenantId,
        riskTolerance: 'MODERATE',
        investmentHorizon: 'LONG_TERM',
        targetReturn: 0.08,
        createdAt: new Date().toISOString(),
      },
    });

    // Verify: WorkflowTrigger written to DDB
    const item = await waitForTriggerRecord(table, {
      table: 'decision-workflow-ctrl',
      pk: `T#${ctx.tenantId}`,
      triggerType: 'MANDATE_CREATED',
      contextMatch: mandateId,
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('WorkflowTrigger');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['trigger']).toBe('MANDATE_CREATED');

    // Verify: CDC emits WORKFLOW_TRIGGER_CREATED on advisory bus
    const cdcEvent = await trap.waitForEvent<BusEventPayload>({
      detailType: 'WORKFLOW_TRIGGER_CREATED',
      timeoutMs: 60_000,
    });
    expect(cdcEvent.detail.subject.trigger).toBe('MANDATE_CREATED');
    expect(cdcEvent.detail.subject.tenantId).toBe(ctx.tenantId);

    // Verify: the canonical event starts an SF execution
    const execution = await waitForSfExecution(sfn, {
      stateMachineArn,
      since: testStart,
      timeoutMs: 90_000,
    });
    expect(execution.executionArn).toContain('decisionstatemachine');
  }, 180_000);
```

- [ ] **Step 6: Do not run the integration test yet**

Integration tests require live AWS creds + a sandbox deploy. We exercise this in Task 6 after deploying.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
git commit -m "test(decision-workflow-ctrl): assert SF execution starts on CDC"
```

---

## Task 6: Run the full per-project gate

**Why:** Before deploying, confirm the entire `decision-workflow-ctrl` project is green.

- [ ] **Step 1: Run test, lint, build, typecheck for this project**

Run: `pnpm nx run-many -t test,lint,build,typecheck -p decision-workflow-ctrl`
Expected: all four targets green.

If `typecheck` fails on an implicit-any for the CFN JSON object in Task 1's test, adjust the `any` casts to match the style already used in the existing `service.stack.test.ts` (`/* eslint-disable @typescript-eslint/no-explicit-any */` at line 1 covers it).

- [ ] **Step 2: Run affected across the repo to catch cross-project ripple**

Run: `pnpm nx affected -t test,build,lint,typecheck --base=HEAD~5`
Expected: only `decision-workflow-ctrl` (and any project that depends on it, likely none) rebuild. All green.

- [ ] **Step 3: No commit** (nothing changed; gate check only)

---

## Task 7: Deploy to sandbox + Defect 1 smoke check

**Why:** Apply the change to AWS and verify that both the new `WORKFLOW_TRIGGER_CREATED` Rule **and** the previously-missing `IngressHandler` Lambdas (Defect 1) appear after redeploy.

**Preconditions:** AWS creds active for account `771924376645` (Leapp, `AdminRole`), region `us-east-1`.

- [ ] **Step 1: Deploy the service**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl`
Expected: `UPDATE_COMPLETE` for `dev-decision-workflow-ctrl`. Deploy typically 3-5 minutes.

- [ ] **Step 2: Verify EB Rules on the advisory bus**

Run: `aws events list-rules --event-bus-name dev-advisory-event-bus --name-prefix dev-decision-workflow-ctrl --region us-east-1 --output json | jq -r '.Rules[].Name'`
Expected output: at least three rule names, e.g.:
- A rule from `TriggerIngress` (subscribing to the 11 trigger events)
- A rule from `CallbackIngress` (subscribing to the 8 completion events)
- A rule named something like `...WORKFLOWTRIGGERCREATEDRule...` with a single-item detail-type `WORKFLOW_TRIGGER_CREATED`

If fewer than three rules appear, Defect 1 is NOT a stale deploy — it is a cdk-constructs `Ingress` bug when instantiated twice against the same `State`. **Stop the plan** and open a separate investigation: (a) run `pnpm nx run decision-workflow-ctrl:synth` (or `cdk synth` via `infrastructure/`) and check the synthesized CFN template directly, (b) if the template also lacks the `IngressHandler*` resources, file the bug against `@nestfolio/cdk-constructs` and do NOT proceed past this task.

- [ ] **Step 3: Verify IngressHandler Lambda log groups exist**

Run: `aws logs describe-log-groups --log-group-name-prefix /aws/lambda/dev-decision-workflow-ctrl --region us-east-1 --output json | jq -r '.logGroups[].logGroupName'`
Expected output: log groups for both the trigger-ingress handler and the callback-ingress handler. Exact names follow CDK's default scheme (hash suffix on the construct path). At minimum, count should be ≥ 4 (Trigger IngressHandler, Callback IngressHandler, AssemblePacket, EgressPublisher).

If fewer than 4 log groups, same escalation path as step 2.

- [ ] **Step 4: Verify the SF target on the new Rule**

Run:
```bash
aws events list-targets-by-rule \
  --event-bus-name dev-advisory-event-bus \
  --rule "$(aws events list-rules --event-bus-name dev-advisory-event-bus --name-prefix dev-decision-workflow-ctrl --region us-east-1 --output json | jq -r '.Rules[] | select(.EventPattern | contains("WORKFLOW_TRIGGER_CREATED")) | .Name')" \
  --region us-east-1
```
Expected: one target whose `Arn` is the Decision state machine ARN (`arn:aws:states:us-east-1:771924376645:stateMachine:dev-decision-workflow-ctrl-decisionstatemachine`) and whose `InputPath` is `$.detail`.

- [ ] **Step 5: No commit** (deploy-only)

---

## Task 8: Run the integration test end-to-end

**Why:** Confirms the full local-path contract (DDB write + CDC + SF execution) works in sandbox.

- [ ] **Step 1: Run the decision-workflow-ctrl integration test**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run decision-workflow-ctrl:test-integration`
Expected: all tests pass; the `MANDATE_CREATED` test completes within 180s and prints a PASS including the new SF execution assertion.

If the SF execution assertion fails with "no SF execution started after <timestamp>", the canonical wiring is not functioning. Debug order: (a) `aws events describe-rule` on the new rule and verify `State=ENABLED`; (b) check the SF's IAM role allows EB `events:StartExecution`; (c) check CloudWatch Logs for the SF's log group for any invocation attempts. Do not proceed to Task 9 until this passes.

- [ ] **Step 2: No commit** (test-only)

---

## Task 9: Run the live e2e exit criterion

**Why:** The plan's **primary** exit criterion — the `first-decision` e2e scenario must drive a real SF execution and invoke all four advisory agents.

- [ ] **Step 1: Run the `first-decision` e2e scenario**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- -t first-decision`
Expected: test passes. (Note: per `project_pipeline_trigger_gap.md`, this test was already "green" because of the advisory-ctrl short-circuit path. Confirm it is still green after the fix. If it breaks because of a race between the advisory-ctrl path and the SF path both writing the DecisionPacket, refer to Risk R4 in the design spec and adjust the scenario fixture — do not weaken the SF path.)

- [ ] **Step 2: Record the test-run window**

Note the `startDate` (UTC) of the test start and the test end. You'll query CloudWatch / SF executions bounded to this window.

- [ ] **Step 3: Verify a fresh SF execution**

Run:
```bash
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:771924376645:stateMachine:dev-decision-workflow-ctrl-decisionstatemachine \
  --max-results 5 \
  --region us-east-1
```
Expected: at least one execution whose `startDate` is within the test-run window.

**This is exit criterion (7) from the design spec. It is MANDATORY.**

- [ ] **Step 4: Verify fresh invocations on all four agents' runtime log groups**

For each of the four agents, verify a fresh log stream exists within the test-run window:

```bash
for agent in investor_profile portfolio_engine market_intelligence advisory_narrative; do
  echo "=== $agent ==="
  aws logs describe-log-streams \
    --log-group-name "/aws/bedrock-agentcore/runtimes/${agent}*" \
    --order-by LastEventTime \
    --descending \
    --max-items 3 \
    --region us-east-1 \
    --output json | jq -r '.logStreams[] | "\(.logStreamName)\t\(.lastEventTimestamp | todate)"'
done
```

Expected: each agent has at least one log stream with `lastEventTimestamp` within the test-run window.

Note: the log group glob pattern `/aws/bedrock-agentcore/runtimes/${agent}*` is indicative; verify the exact naming by running `aws logs describe-log-groups --log-group-name-prefix /aws/bedrock-agentcore/runtimes/ --region us-east-1` once before the loop.

**This is exit criterion (8) from the design spec. It is MANDATORY.**

If either exit criterion fails, do NOT proceed to Task 10. Debug per Risk R5 in the design spec.

- [ ] **Step 5: No commit** (verification-only)

---

## Task 10: Update the flow spec

**Why:** `flows/advisory-cycle.flow.yaml` still carries the aspirational NOTE. Replace it with an explicit step.

**Files:**
- Modify: `flows/advisory-cycle.flow.yaml`

- [ ] **Step 1: Replace the NOTE at lines 30-32**

Edit `flows/advisory-cycle.flow.yaml`. Replace exactly:

```yaml
  # NOTE: The Orchestration construct has `triggers: []` — SF is NOT started
  # by a direct EB rule. The CDC event WORKFLOW_TRIGGER_CREATED starts SF
  # via the Orchestration construct's internal wiring.
```

with:

```yaml
  # -- Phase 1b: Start the state machine --
  - service: decision-workflow-ctrl
    receives: WORKFLOW_TRIGGER_CREATED
    via: AdvisoryBus -> EB Rule -> SfnStateMachine target (Orchestration.triggers)
    handler: Step Functions StartExecution (construct-managed, input = $.detail)
    state_change: New DecisionStateMachine execution starts; entry Pass state unpacks
      {subject.decisionId, subject.tenantId, subject.trigger, subject.context}
      to the top level of SF state.
    emits: (none — SF internal)
    idempotent: false  # duplicate WORKFLOW_TRIGGER_CREATED events start duplicate executions
```

- [ ] **Step 2: Validate the flow spec**

If the repo has a flow-validation target, run: `pnpm nx run docs:validate-flow -- advisory-cycle` (or equivalent; check `package.json` scripts / `nx.json` if unsure). If no such target exists, skip — the spec's correctness is covered by the next step's regeneration.

- [ ] **Step 3: Commit**

```bash
git add flows/advisory-cycle.flow.yaml
git commit -m "docs(flows): make WORKFLOW_TRIGGER_CREATED->SF step explicit"
```

---

## Task 11: Regenerate the data-flow doc

**Why:** `docs/data-flows/advisory-cycle.md` is generated from the flow YAML. Regenerate to keep them in sync.

**Files:**
- Regenerate: `docs/data-flows/advisory-cycle.md`

- [ ] **Step 1: Regenerate**

If the repo has a generator target, run: `pnpm nx run docs:generate-data-flow -- advisory-cycle` (check `project.json` under `docs/` or a `tools/` script). If no automated target, update `docs/data-flows/advisory-cycle.md` manually:
- Add a new section "Step 3b: decision-workflow-ctrl (StartExecution)" with the same content as the new YAML step.
- Keep all existing steps verbatim.

- [ ] **Step 2: Commit**

```bash
git add docs/data-flows/advisory-cycle.md
git commit -m "docs(data-flows): regenerate advisory-cycle after flow update"
```

---

## Task 12: Regenerate the service card

**Why:** `services/advisory/decision-workflow-ctrl/CLAUDE.md` currently states *"Started via CDC chain (no direct EB trigger)"*. Update it.

- [ ] **Step 1: Invoke the `audit-service` skill to regenerate**

Per the CLAUDE.md routing table, task "Audit and regenerate a service's CLAUDE.md card from code" → skill `audit-service`. Invoke it for `decision-workflow-ctrl`.

If regenerating manually, update the **Orchestration** section of `services/advisory/decision-workflow-ctrl/CLAUDE.md`:

Replace exactly:

```markdown
## Orchestration
- DecisionStateMachine: Step Functions state machine (72h timeout)
  Started via CDC chain (no direct EB trigger)
  Callback access granted to CallbackIngress handler
  Invokes assemblePacketFn, publishes to advisoryBus
```

with:

```markdown
## Orchestration
- DecisionStateMachine: Step Functions state machine (72h timeout)
  Started by EB Rule on WORKFLOW_TRIGGER_CREATED (Orchestration.triggers).
  Entry state UnpackTriggerEnvelope flattens {subject.decisionId, subject.tenantId, ...}
  to the top level of SF state.
  Callback access granted to CallbackIngress handler.
  Invokes assemblePacketFn, publishes to advisoryBus.
```

- [ ] **Step 2: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/CLAUDE.md
git commit -m "docs(decision-workflow-ctrl): update service card for SF-start wiring"
```

---

## Task 13: Supersede tracking — update memory + Plan 3 Phase 3.5

**Why:** `memory/project_pipeline_trigger_gap.md` and `docs/superpowers/plans/2026-04-19-agent-contract-tests-03-remaining-services.md` both record this as OPEN. Once merged, mark them as closed.

**Files:**
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/project_pipeline_trigger_gap.md`
- Modify: `docs/superpowers/plans/2026-04-19-agent-contract-tests-03-remaining-services.md`
- Modify: `/Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory/MEMORY.md` (the index line referencing the gap)

- [ ] **Step 1: Update the memory file with the resolution**

Edit `memory/project_pipeline_trigger_gap.md`. After the existing content, append:

```markdown

## Resolution (2026-04-20)

Closed via `docs/superpowers/plans/2026-04-20-decision-workflow-sf-start-wiring.md`.
Fix: set `Orchestration.triggers: [WORKFLOW_TRIGGER_CREATED]` and prepend an
`UnpackTriggerEnvelope` Pass state in the SF definition. Defect 1 was a stale
deploy — redeploy produced the expected IngressHandler log groups + EB rules.

**Verified:** `aws stepfunctions list-executions` shows fresh executions in sandbox;
all four advisory agent runtime log groups show fresh invocations on
`first-decision` e2e runs.

Plan 3 Phase 4 is now unblocked.
```

- [ ] **Step 2: Update the MEMORY.md index line**

Edit `memory/MEMORY.md`. Change the line:

```markdown
- **Sandbox pipeline-trigger gap** — OPEN (2026-04-20): `dev-decision-workflow-ctrl-decisionstatemachine` has never executed; blocks live e2e assertions for all 4 advisory LangGraph agents. See `project_pipeline_trigger_gap.md`. Tracked in Plan 3 Phase 3.5.
```

Move it from "Active / Planned Work" to "Recently Completed Work" and change to:

```markdown
- **Sandbox pipeline-trigger gap** — CLOSED 2026-04-20: SF-start wiring added (WORKFLOW_TRIGGER_CREATED → Orchestration.triggers + UnpackTriggerEnvelope Pass state). See `project_pipeline_trigger_gap.md`.
```

Also update the Topic Files entry accordingly.

- [ ] **Step 3: Supersede the Plan 3 Phase 3.5 block**

Edit `docs/superpowers/plans/2026-04-19-agent-contract-tests-03-remaining-services.md`. At the top of the Phase 3.5 block (around line 97), add a status banner:

```markdown
> **STATUS 2026-04-20:** RESOLVED in
> `docs/superpowers/plans/2026-04-20-decision-workflow-sf-start-wiring.md`.
> Both exit criteria verified green. Phase 4 is now unblocked.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-19-agent-contract-tests-03-remaining-services.md
# Memory files are committed in their own repo (~/.claude/projects/...); commit them there
git commit -m "docs(agent-contract): mark Phase 3.5 resolved by SF-start-wiring plan"
```

For the memory repo:

```bash
git -C /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory add MEMORY.md project_pipeline_trigger_gap.md
git -C /Users/fabiovitali/.claude/projects/-Users-fabiovitali-WebstormProjects-nestfolio/memory commit -m "chore(memory): pipeline-trigger gap resolved"
```

(Skip the memory-repo commit if the memory directory is not a git repo.)

---

## Task 14: Merge the branch to `main`

**Why:** Per the originating prompt: "When complete, merge to main. Only after merge is Prompt 2 unblocked."

**Preconditions:** working on a feature branch in a worktree; both exit criteria (Task 9 steps 3 and 4) have passed.

- [ ] **Step 1: Rebase / fast-forward check**

Run: `git fetch origin main && git log --oneline origin/main..HEAD`
Expected: lists only the commits from this plan (Tasks 1-13). No surprise commits.

- [ ] **Step 2: Merge to main**

If the repo convention is "merge via local fast-forward" (per past main-branch commits):

```bash
git checkout main
git merge --ff-only feat/decision-workflow-sf-start-wiring
```

If the repo convention is "PR-based":

```bash
gh pr create --base main --head feat/decision-workflow-sf-start-wiring \
  --title "feat(decision-workflow-ctrl): wire SF start from WORKFLOW_TRIGGER_CREATED" \
  --body "$(cat <<'EOF'
## Summary
- Set `Orchestration.triggers: [WORKFLOW_TRIGGER_CREATED]` to close the CDC-chain gap
- Add `UnpackTriggerEnvelope` Pass state to flatten the CDC envelope for the SF
- Verify: sandbox SF executions + all four advisory agents fire during `first-decision` e2e

Supersedes Plan 3 Phase 3.5. Closes `project_pipeline_trigger_gap.md`.

## Test plan
- [x] `pnpm nx run-many -t test,lint,build,typecheck -p decision-workflow-ctrl`
- [x] Sandbox redeploy: EB rules + IngressHandler log groups present
- [x] Integration test: WorkflowTrigger + CDC + SF execution all observed
- [x] E2E `first-decision` run: SF execution + 4 agent log groups verified

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Check prior commits on `main` (e.g. `git log --oneline -10 main`) to determine whether the project uses PRs or direct fast-forward merges. Ask the user if ambiguous. **Do not force-push to main under any circumstances.**

- [ ] **Step 3: Verify merge**

Run: `git log --oneline main -5`
Expected: top commit is the most recent plan commit (Task 13 or the merge commit).

- [ ] **Step 4: Clean up the worktree**

Invoke the `superpowers:using-git-worktrees` skill to remove the worktree once the merge is confirmed. Do not delete the branch locally until the worktree is gone.

---

## Summary of commits produced by this plan

1. `test(decision-workflow-ctrl): failing test for WORKFLOW_TRIGGER_CREATED->SF rule`
2. `feat(decision-workflow-ctrl): wire WORKFLOW_TRIGGER_CREATED to SF`
3. `feat(decision-workflow-ctrl): unpack CDC envelope at SF entry`
4. `docs(decision-workflow-ctrl): correct event-listener docstring`
5. `test(decision-workflow-ctrl): assert SF execution starts on CDC`
6. `docs(flows): make WORKFLOW_TRIGGER_CREATED->SF step explicit`
7. `docs(data-flows): regenerate advisory-cycle after flow update`
8. `docs(decision-workflow-ctrl): update service card for SF-start wiring`
9. `docs(agent-contract): mark Phase 3.5 resolved by SF-start-wiring plan`
(10) Merge commit on `main` (if PR-based) or fast-forward.

All commits are small, reviewable, and independently revertable up to the SF-entry-state change (Task 3) which must be paired with Task 2's `triggers` change or the SF fails to resolve `$.decisionId` on the first run.
