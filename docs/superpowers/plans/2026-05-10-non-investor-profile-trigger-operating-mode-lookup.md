# non-investor-profile-trigger-operating-mode-lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `operatingMode` for non-INVESTOR_PROFILE_* SF triggers (DEPOSIT_DETECTED / ORDER_FILLED / ORDER_REJECTED / ORDER_CANCELLED / PORTFOLIO_DRIFT_DETECTED) so the decision-workflow-ctrl Step Function stops fast-failing at `InvokeInvestorProfile` with `UnknownOperatingModeError`.

**Architecture:** decision-workflow-ctrl owns a local `MandateSnapshot` projection materialised from `MANDATE_ISSUED` + `OPERATING_MODE_CHANGED`. The decision Step Function inserts a Choice → `dynamodb:getItem` (Direct DynamoDB integration — no new Lambda) → Pass flow between `UnpackTriggerEnvelope` and `ParallelProfiling`. For PROFILE triggers the SF skips the lookup and reuses `$.triggerContext` (which already carries `operatingMode`); for non-PROFILE triggers it queries the local MandateSnapshot row and synthesises a minimal `investorProfile = { operatingMode }` payload. The downstream `InvokeInvestorProfile` state reads from the new `$.investorProfile` slot — investor-profile-ctrl handler stays unchanged and continues to throw `UnknownOperatingModeError` if the slot is absent (defence intact).

**Tech Stack:** AWS CDK (`sfn.CustomState`, `sfn.Choice`, `Ingress`, `Orchestration`), `@nestfolio/event-processor` (`materializeToTable`, `update`, `record`), AWS Step Functions Direct AWS-SDK integrations (`arn:aws:states:::dynamodb:getItem`).

---

## Out of scope

Mirrors `docs/backlog/non-investor-profile-trigger-operating-mode-lookup.md` frontmatter:

- INVESTOR_PROFILE_CREATED / INVESTOR_PROFILE_UPDATED triggers — already work (23/50 SUCCEEDED in dev sample 2026-05-09); SF Choice keeps existing behaviour for these.
- e2e gate semantics changes — fix is decoupled from any test-gate redesign.
- Removing the `UnknownOperatingModeError` throw — the explicit failure is the right contract; we fix the upstream propagation, not the downstream guard.
- Broader trigger payload schema redesign — no producer-side enrichment touches the 3-5 services that currently emit non-PROFILE triggers.
- SF state-machine restructure beyond a single Choice + Lookup branch.

## File structure

**Create:**

- `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts` — `materializeToTable` handler for MANDATE_ISSUED + OPERATING_MODE_CHANGED; writes `MandateSnapshot` rows.
- `services/advisory/decision-workflow-ctrl/src/repositories/mandate-snapshot.repository.ts` — pk helper (`mandateSnapshotPk(tenantId,userId)`) shared between handler + SF lookup; returns the row for unit tests.
- `services/advisory/decision-workflow-ctrl/test/unit/mandate-projector.test.ts` — unit tests for the new handler.

**Modify:**

- `services/advisory/decision-workflow-ctrl/src/domain/events.ts` — add a `MANDATE_LIFECYCLE_EVENT_TYPES` const referencing `InvestorBffEventTypes.{MANDATE_ISSUED, OPERATING_MODE_CHANGED}`.
- `services/advisory/decision-workflow-ctrl/src/service.stack.ts` — add a new `MandateProjectorIngress` and grant the orchestration role read access to `state.getTable()`.
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` — accept `tableName` prop; insert `CheckTriggerOperatingMode` (Choice) → `LookupMandateSnapshot` (Task: dynamodb:getItem) → `SetInvestorProfileFromMandate` (Pass) and `SetInvestorProfileFromTrigger` (Pass) between `UnpackTriggerEnvelope` and `ParallelProfiling`; change `invokeInvestorProfile.subject.investorProfile.$` from `$.triggerContext` to `$.investorProfile`.
- `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` — add assertions for the new Ingress + grant.
- `docs/backlog/non-investor-profile-trigger-operating-mode-lookup.md` — set `status: shipped`, fill `validation_gate`.

**Reference (read only):**

- `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` (lines 143-203) — pattern for `processMandateIssued` / `processOperatingModeChanged`.
- `services/execution/broker-ctrl/src/state-machine/order-state-machine.ts:43` — proven `arn:aws:states:::dynamodb:getItem` precedent.
- `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts:36` — the throw site (kept intact).

---

## Task 1: Add MandateSnapshot pk helper + repository

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/repositories/mandate-snapshot.repository.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/mandate-snapshot.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/mandate-snapshot.repository.test.ts
import { mandateSnapshotPk } from '../../src/repositories/mandate-snapshot.repository';

describe('mandateSnapshotPk', () => {
  it('builds a deterministic composite pk from tenantId and userId', () => {
    expect(mandateSnapshotPk('tenant-1', 'user-1')).toBe('MandateSnapshot#tenant-1#user-1');
  });

  it('does not collide across tenants for the same userId', () => {
    expect(mandateSnapshotPk('a', 'shared')).not.toBe(mandateSnapshotPk('b', 'shared'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=mandate-snapshot.repository.test
```
Expected: FAIL — `Cannot find module '../../src/repositories/mandate-snapshot.repository'`.

- [ ] **Step 3: Implement minimal helper**

```ts
// src/repositories/mandate-snapshot.repository.ts
export const MANDATE_SNAPSHOT_SK = 'MandateSnapshot' as const;

export function mandateSnapshotPk(tenantId: string, userId: string): string {
  return `MandateSnapshot#${tenantId}#${userId}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=mandate-snapshot.repository.test
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/repositories/mandate-snapshot.repository.ts \
        services/advisory/decision-workflow-ctrl/test/unit/mandate-snapshot.repository.test.ts
git commit -m "feat(decision-workflow-ctrl): add MandateSnapshot pk helper"
```

---

## Task 2: Add mandate-projector handler

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/mandate-projector.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/mandate-projector.test.ts
import { createHandlers } from '../../src/handlers/mandate-projector';
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../../src/repositories/mandate-snapshot.repository';
import type { EventContext, EventPayload } from '@nestfolio/event-processor';

const ctx = (overrides: Partial<EventContext> = {}): EventContext => ({
  eventId: 'evt-1', eventType: 'MANDATE_ISSUED', tenantId: 'tenant-1',
  userId: 'user-1', region: 'us-east-1',
  ...overrides,
} as EventContext);

const payload = (subject: Record<string, unknown>): EventPayload => ({
  subject, context: { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' },
} as EventPayload);

describe('mandate-projector', () => {
  const handlers = createHandlers();

  describe('MANDATE_ISSUED', () => {
    it('writes a MandateSnapshot row keyed by tenantId+userId with operatingMode', async () => {
      const result = await handlers.MANDATE_ISSUED(payload({
        tenantId: 'tenant-1', userId: 'user-1',
        operatingMode: 'BALANCED', level: 'ADVISORY', mandateId: 'm-1',
        effectiveDate: '2026-05-10T00:00:00.000Z',
      }), ctx({ eventType: 'MANDATE_ISSUED' }));

      const intent = Array.isArray(result) ? result[0] : result;
      expect(intent.kind).toBe('record');
      expect(intent.entityType).toBe('MandateSnapshot');
      expect(intent.overrides?.pk).toBe(mandateSnapshotPk('tenant-1', 'user-1'));
      expect(intent.overrides?.sk).toBe(MANDATE_SNAPSHOT_SK);
      expect(intent.payload.operatingMode).toBe('BALANCED');
      expect(intent.payload.level).toBe('ADVISORY');
    });

    it('throws NotRetryableError when operatingMode is missing', async () => {
      await expect(handlers.MANDATE_ISSUED(payload({
        tenantId: 'tenant-1', userId: 'user-1', level: 'ADVISORY', mandateId: 'm-1',
      }), ctx({ eventType: 'MANDATE_ISSUED' }))).rejects.toThrow(/operatingMode/);
    });
  });

  describe('OPERATING_MODE_CHANGED', () => {
    it('updates only operatingMode on the existing snapshot row', async () => {
      const result = await handlers.OPERATING_MODE_CHANGED(payload({
        tenantId: 'tenant-1', userId: 'user-1', operatingMode: 'AGGRESSIVE',
      }), ctx({ eventType: 'OPERATING_MODE_CHANGED' }));

      const intent = Array.isArray(result) ? result[0] : result;
      expect(intent.kind).toBe('update');
      expect(intent.payload.operatingMode).toBe('AGGRESSIVE');
      expect(intent.overrides?.pk).toBe(mandateSnapshotPk('tenant-1', 'user-1'));
      expect(intent.overrides?.sk).toBe(MANDATE_SNAPSHOT_SK);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=mandate-projector.test
```
Expected: FAIL — `Cannot find module '../../src/handlers/mandate-projector'`.

- [ ] **Step 3: Implement the handler**

```ts
// src/handlers/mandate-projector.ts
import {
  materializeToTable, record, update, NotRetryableError,
  type EventPayload, type EventContext, type WriteIntent,
} from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../repositories/mandate-snapshot.repository';

function processMandateIssued(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = subject.operatingMode as string | undefined;
  const level = subject.level as string | undefined;
  const mandateId = subject.mandateId as string | undefined;
  const effectiveDate = subject.effectiveDate as string | undefined;

  if (!operatingMode) {
    throw new NotRetryableError(
      `MANDATE_ISSUED missing operatingMode for tenant=${tenantId} user=${userId}`,
    );
  }

  return record('MandateSnapshot', {
    tenantId, userId, mandateId, level, operatingMode, effectiveDate,
    status: 'ACTIVE',
  }, { pk: mandateSnapshotPk(tenantId, userId), sk: MANDATE_SNAPSHOT_SK });
}

function processOperatingModeChanged(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = subject.operatingMode as string | undefined;

  if (!operatingMode) {
    throw new NotRetryableError(
      `OPERATING_MODE_CHANGED missing operatingMode for tenant=${tenantId} user=${userId}`,
    );
  }

  return update('MandateSnapshot', {
    tenantId, userId, operatingMode,
  }, { overrides: { pk: mandateSnapshotPk(tenantId, userId), sk: MANDATE_SNAPSHOT_SK } });
}

export const createHandlers = () => ({
  [InvestorBffEventTypes.MANDATE_ISSUED]: (p: EventPayload, c: EventContext) =>
    processMandateIssued(p, c),
  [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: (p: EventPayload, c: EventContext) =>
    processOperatingModeChanged(p, c),
});

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'MANDATE_PROJECTION_FAILED',
});
```

- [ ] **Step 4: Run tests to verify they pass**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=mandate-projector.test
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts \
        services/advisory/decision-workflow-ctrl/test/unit/mandate-projector.test.ts
git commit -m "feat(decision-workflow-ctrl): project MandateSnapshot from MANDATE_ISSUED + OPERATING_MODE_CHANGED"
```

---

## Task 3: Wire MandateProjectorIngress + IAM grant in service.stack.ts

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts:9-17` (imports) and after the existing CallbackIngress block (lines ~135-140)
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/events.ts` (add export)
- Test: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Add the events constant**

```ts
// src/domain/events.ts — append at the bottom
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

export const MANDATE_LIFECYCLE_EVENT_TYPES = [
  InvestorBffEventTypes.MANDATE_ISSUED,
  InvestorBffEventTypes.OPERATING_MODE_CHANGED,
] as const;
```

- [ ] **Step 2: Write the failing CDK assertion test**

```ts
// test/unit/service.stack.test.ts — append a new describe block
import { Match, Template } from 'aws-cdk-lib/assertions';
// ... existing imports + setup ...

describe('MandateProjectorIngress', () => {
  it('subscribes the projector handler to MANDATE_ISSUED + OPERATING_MODE_CHANGED', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['MANDATE_ISSUED', 'OPERATING_MODE_CHANGED']),
      }),
    });
  });

  it('grants the orchestration state machine read access to the State table', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(['dynamodb:GetItem']),
            Effect: 'Allow',
          }),
        ]),
      }),
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=service.stack.test
```
Expected: FAIL — assertions don't match (Ingress / grant absent).

- [ ] **Step 4: Wire the Ingress + grant**

In `service.stack.ts`, add to the imports:

```ts
import { MANDATE_LIFECYCLE_EVENT_TYPES } from './domain/events';
```

After the existing `callbackIngress` block (right before `// --- Egress: ...`), insert:

```ts
// MandateProjectorIngress — projects MandateSnapshot rows so the SF can resolve
// operatingMode for non-INVESTOR_PROFILE_* triggers without a cross-service DDB read.
const mandateProjectorIngress = new Ingress(this, 'MandateProjectorIngress', {
  state,
  eventTypes: [...MANDATE_LIFECYCLE_EVENT_TYPES],
  entry: join(__dirname, 'handlers', 'mandate-projector.ts'),
});

// SF needs dynamodb:GetItem on the local State table to look up MandateSnapshot.
state.getTable().grantReadData(orchestration.stateMachine);
```

Also extend `addObservability` (last block) to include the new ingress:

```ts
this.addObservability({
  ingress: callbackIngress,
  // mandateProjectorIngress observability is handled by the Ingress construct itself;
  // no need to pass it through addObservability — the construct is already self-observed.
  egress,
  orchestration,
});
```

- [ ] **Step 5: Run tests to verify they pass**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=service.stack.test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/domain/events.ts \
        services/advisory/decision-workflow-ctrl/src/service.stack.ts \
        services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(decision-workflow-ctrl): wire MandateProjectorIngress + grant SF read access to State"
```

---

## Task 4: Modify decision-state-machine.ts — Choice + Direct DynamoDB lookup

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:7-12` (props), `:331-343` (UnpackTriggerEnvelope), `:347-353` (chain wiring), `:94-126` (InvokeInvestorProfile subject)
- Test: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` (extend)

- [ ] **Step 1: Extend props with `tableName`**

```ts
// constructs/decision-state-machine.ts
interface DecisionWorkflowDefinitionProps {
  readonly eventBus: IEventBus;
  readonly table: ITable;
  readonly serviceName: string;
  readonly assemblePacketFnArn: string;
  readonly tableName: string; // NEW — resolved at synth time
}
```

In `service.stack.ts`, when constructing `DecisionWorkflowDefinition`, add:

```ts
tableName: state.getTable().tableName,
```

- [ ] **Step 2: Write the failing CDK assertion**

```ts
// test/unit/service.stack.test.ts — append
describe('SF resolves operatingMode', () => {
  it('inserts a Choice + dynamodb:getItem state for non-PROFILE triggers', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      DefinitionString: Match.stringLikeRegexp('CheckTriggerOperatingMode'),
    });
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      DefinitionString: Match.stringLikeRegexp('arn:aws:states:::dynamodb:getItem'),
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=service.stack.test
```
Expected: FAIL.

- [ ] **Step 4: Insert the Choice + Lookup + Pass states**

After `unpackTriggerEnvelope` is created (around line 343 in `decision-state-machine.ts`), and BEFORE the chain is wired with `.next(parallelProfiling)`, add:

```ts
// --- Resolve operatingMode for non-INVESTOR_PROFILE_* triggers ---
//
// PROFILE triggers ($.triggerContext.operatingMode present) skip the lookup;
// non-PROFILE triggers (DEPOSIT_DETECTED etc.) query the local MandateSnapshot
// row via Direct DynamoDB integration — no Lambda, no cross-service read.
const setInvestorProfileFromTrigger = new sfn.Pass(this, 'SetInvestorProfileFromTrigger', {
  parameters: {
    'decisionId.$': '$.decisionId',
    'tenantId.$': '$.tenantId',
    'userId.$': '$.userId',
    'region.$': '$.region',
    'trigger.$': '$.trigger',
    'triggerContext.$': '$.triggerContext',
    'investorProfile.$': '$.triggerContext',
  },
});

const lookupMandateSnapshot = new sfn.CustomState(this, 'LookupMandateSnapshot', {
  stateJson: {
    Type: 'Task',
    Resource: 'arn:aws:states:::dynamodb:getItem',
    Parameters: {
      TableName: props.tableName,
      Key: {
        pk: { 'S.$': "States.Format('MandateSnapshot#{}#{}', $.tenantId, $.userId)" },
        sk: { S: 'MandateSnapshot' },
      },
    },
    ResultSelector: {
      'operatingMode.$': '$.Item.operatingMode.S',
    },
    ResultPath: '$.mandateSnapshot',
  },
});

const setInvestorProfileFromMandate = new sfn.Pass(this, 'SetInvestorProfileFromMandate', {
  parameters: {
    'decisionId.$': '$.decisionId',
    'tenantId.$': '$.tenantId',
    'userId.$': '$.userId',
    'region.$': '$.region',
    'trigger.$': '$.trigger',
    'triggerContext.$': '$.triggerContext',
    'investorProfile': {
      'operatingMode.$': '$.mandateSnapshot.operatingMode',
    },
  },
});

const checkTriggerOperatingMode = new sfn.Choice(this, 'CheckTriggerOperatingMode')
  .when(
    sfn.Condition.isPresent('$.triggerContext.operatingMode'),
    setInvestorProfileFromTrigger,
  )
  .otherwise(
    lookupMandateSnapshot.next(setInvestorProfileFromMandate),
  );
```

- [ ] **Step 5: Re-route the chain through the new flow**

Change the `definition` chain from:

```ts
const definition = unpackTriggerEnvelope
  .next(parallelProfiling)
  ...
```

to:

```ts
setInvestorProfileFromTrigger.next(parallelProfiling);
setInvestorProfileFromMandate.next(parallelProfiling);

const definition = unpackTriggerEnvelope
  .next(checkTriggerOperatingMode);
```

- [ ] **Step 6: Switch InvokeInvestorProfile to read `$.investorProfile`**

In the `invokeInvestorProfile` CustomState, change the `subject.investorProfile` field:

From:
```ts
'investorProfile.$': '$.triggerContext',
```

To:
```ts
'investorProfile.$': '$.investorProfile',
```

- [ ] **Step 7: Run tests to verify they pass**

```
pnpm nx test decision-workflow-ctrl --testPathPatterns=service.stack.test
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts \
        services/advisory/decision-workflow-ctrl/src/service.stack.ts \
        services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(decision-workflow-ctrl): resolve operatingMode upfront via Direct DynamoDB GetItem"
```

---

## Task 5: Integration test — projection + SF lookup happy path

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 1: Read the existing integration test for fixture conventions**

```
sed -n '1,80p' services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
```

- [ ] **Step 2: Add a failing integration scenario**

Append a new `it.each([...])` case that:
1. Emits MANDATE_ISSUED with `operatingMode: 'AGGRESSIVE'`.
2. Awaits MandateSnapshot row materialisation (`waitForCondition` polling on the test table).
3. Emits DEPOSIT_DETECTED (no operatingMode) as a trigger.
4. Asserts an SF execution starts AND reaches `InvokeInvestorProfile` with the resolved AGGRESSIVE operatingMode (use the SF execution-history harness, or assert via the AGENT_OUTPUT_CREATED event the agent emits).

```ts
it('resolves operatingMode for non-PROFILE trigger via local MandateSnapshot', async () => {
  await emitEvent({
    type: 'MANDATE_ISSUED',
    subject: {
      tenantId, userId, mandateId: 'm-1', level: 'ADVISORY',
      operatingMode: 'AGGRESSIVE', effectiveDate: new Date().toISOString(),
    },
  });
  await waitForCondition(async () =>
    (await readTableItem({ pk: `MandateSnapshot#${tenantId}#${userId}`, sk: 'MandateSnapshot' }))
      ?.operatingMode === 'AGGRESSIVE',
  );

  await emitEvent({
    type: 'DEPOSIT_DETECTED',
    subject: { tenantId, userId, depositId: 'd-1', amountCents: 10_000_00, currency: 'USD' },
  });

  const exec = await waitForSfExecutionByDecisionInput({ trigger: 'DEPOSIT_DETECTED' });
  const history = await getExecutionHistory(exec.executionArn);
  expect(history).toContainEqual(expect.objectContaining({
    type: 'TaskStateEntered',
    stateEnteredEventDetails: expect.objectContaining({ name: 'InvokeInvestorProfile' }),
  }));
  // Optional stronger assertion: the entered-input carries operatingMode=AGGRESSIVE
  // (depends on test harness — see waitForSfExecutionByDecisionInput contract).
});
```

- [ ] **Step 3: Run the integration test (locally — uses LocalStack/AWS test fixtures)**

```
NESTFOLIO_INTEG_PREFIX=integ pnpm nx run decision-workflow-ctrl:test-integration --testPathPatterns=decision-workflow-ctrl.integration
```
Expected: FAIL (test asserts new behaviour not yet deployed locally).

- [ ] **Step 4: Re-run after Tasks 1-4 are merged on the dev sandbox**

Same command — now expected to PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
git commit -m "test(decision-workflow-ctrl): integration scenario for non-PROFILE trigger operatingMode lookup"
```

---

## Task 6: Deploy to dev + e2e validation

- [ ] **Step 1: Pre-flight — affected check**

```
pnpm nx affected --target=build --base=main 2>&1 | tail -20
```
Expected: `decision-workflow-ctrl` (and any tsc-coupled stacks) listed.

- [ ] **Step 2: Deploy to dev sandbox**

```
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl 2>&1 | tee /tmp/deploy-dwf.log
```
Expected: clean CDK deploy with new MandateProjectorIngress + state machine update.

- [ ] **Step 3: Verify SUCCEEDED rate goes up**

```
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:771924376645:stateMachine:dev-decision-workflow-ctrl-decisionstatemachine \
  --max-results 50 --region us-east-1 --output json |
  python3 -c "import json,sys; from collections import Counter; print(Counter(e['status'] for e in json.load(sys.stdin)['executions']))"
```
Expected: more SUCCEEDED, fewer FAILED than the 23/27 baseline measured 2026-05-09.

- [ ] **Step 4: Re-run e2e gates that exercise non-PROFILE triggers**

```
NESTFOLIO_INTEG_PREFIX=dev NODE_OPTIONS='--experimental-vm-modules' \
  pnpm nx run e2e-feature-tests:test-e2e-features
```
Expected: any deposit-trigger / portfolio-drift / order-event scenarios that were red turn green.

- [ ] **Step 5: Sanity-check a recent FAILED execution post-deploy**

Pick one execution with `trigger=DEPOSIT_DETECTED`; confirm history contains `LookupMandateSnapshot` (TaskScheduled / TaskSucceeded) and `SetInvestorProfileFromMandate` (PassStateExited).

```
aws stepfunctions describe-execution --execution-arn <arn> --region us-east-1 --query 'status' --output text
```
Expected: `SUCCEEDED`.

---

## Task 7: Ship the backlog item

- [ ] **Step 1: Update the backlog file**

Edit `docs/backlog/non-investor-profile-trigger-operating-mode-lookup.md` frontmatter:

```yaml
status: shipped
validation_gate: "decision-workflow-ctrl SF SUCCEEDED rate against deployed dev (50-execution sample) post-deploy 2026-05-10; non-PROFILE triggers (DEPOSIT_DETECTED) reach InvokeInvestorProfile with operatingMode resolved; integration test decision-workflow-ctrl-integ::resolves-operatingMode-for-non-PROFILE-trigger PASS"
```

- [ ] **Step 2: Run backlog-lint --fix**

```
node .claude/skills/backlog-lint/lint.mjs --fix 2>&1 | tail -10
```
Expected: `✓ N backlog files; all 7 rules pass`.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog/non-investor-profile-trigger-operating-mode-lookup.md docs/BACKLOG.md
git commit -m "docs(backlog): ship non-investor-profile-trigger-operating-mode-lookup"
```

---

## Validation gate

The workstream is shipped when ALL of:

1. `pnpm nx test decision-workflow-ctrl` — PASS (Tasks 1-4 unit tests + existing).
2. Integration test in Task 5 — PASS (locally or dev-deployed).
3. Dev SF SUCCEEDED rate (Task 6 Step 3) — strictly higher than the 2026-05-09 baseline of 23/50; ideally ≥45/50.
4. Backlog file `status: shipped` with `validation_gate` filled (Task 7).

## Known risks / things to watch

- **`Item` not found at LookupMandateSnapshot.** If MandateSnapshot row hasn't been projected yet (very tight race after first onboarding), the SF Task fails with `DynamoDB.ResourceNotFoundException`-shaped error. **Mitigation:** the Choice branch only takes the lookup path when `$.triggerContext.operatingMode` is absent; for non-PROFILE triggers (DEPOSIT_DETECTED etc.) the investor must be onboarded → MANDATE_ISSUED has long landed. Race is theoretical.
- **`States.Format` template syntax.** The exact string is `States.Format('MandateSnapshot#{}#{}', $.tenantId, $.userId)`. CDK passes this through without modification because it's inside a CustomState `stateJson`.
- **`grantReadData` scope.** This grants the orchestration role read access to ALL items in the local State table, not just MandateSnapshot rows. That's the same scope compliance-ctrl uses for its own table, and the table is service-private. No cross-service exposure.
