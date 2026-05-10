# non-investor-profile-trigger-operating-mode-lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the decision-workflow-ctrl Step Function single-path for `operatingMode` resolution. Stop fast-failing at `InvokeInvestorProfile` with `UnknownOperatingModeError` for non-INVESTOR_PROFILE_* triggers AND eliminate the structural race between the mandate projection and the SF kickoff.

**Architecture:** decision-workflow-ctrl owns a local `MandateSnapshot` projection materialised from `MANDATE_ISSUED` + `OPERATING_MODE_CHANGED`. CDC of `MandateSnapshot:INSERT` emits a new `ADVISORY_PIPELINE_READY` event that *replaces* `INVESTOR_PROFILE_CREATED` as the first-decision trigger — read-your-write within service guarantees the projection is committed before the SF starts. The SF unconditionally reads `MandateSnapshot` via Direct DynamoDB GetItem (no Lambda, no Choice branch) and synthesises `subject.investorProfile = { operatingMode }`. INVESTOR_PROFILE_UPDATED stays as a trigger for re-decisions; the projection is guaranteed materialised by then. advisory-adpt's `INVESTOR_PROFILE_CREATED` forwarding rule is dropped (zero advisoryBus consumers post-change). The recently-shipped advisory-in-flight projection (advisory-bff + dashboard-bff) re-imports `TRIGGER_EVENT_TYPES` automatically — only fixture data updates needed. e2e fixtures + 2 e2e tests that hardcode `INVESTOR_PROFILE_CREATED` are migrated to the natural MANDATE_ISSUED path.

**Tech Stack:** AWS CDK (`sfn.CustomState`, `Ingress`, `Egress`, `Orchestration`), `@nestfolio/event-processor` (`materializeToTable`, `update`, `record`), AWS Step Functions Direct AWS-SDK integrations (`arn:aws:states:::dynamodb:getItem`).

---

## Out of scope

Mirrors `docs/backlog/non-investor-profile-trigger-operating-mode-lookup.md`:

- INVESTOR_PROFILE_UPDATED as trigger — kept; covers re-decisions on profile edits, projection guaranteed materialised by then.
- e2e gate semantic redesign — fix is decoupled from any test-gate redesign.
- Removing the `UnknownOperatingModeError` throw — explicit failure stays as the contract; we fix the upstream propagation, not the downstream guard.
- Producer-side enrichment of trigger events (broker-ctrl, ledger-adpt, etc.) — declined.
- AdvisoryStatus.inFlightCount semantics — preserved verbatim (transform inputs change names; counter behavior identical).
- compliance-ctrl's MandateSnapshot projection — kept (independent local copy in compliance-ctrl table); we add a SECOND, decision-workflow-ctrl-private copy. Each service owns its own projection per pattern.

## File structure (~21 files)

**Production code — CREATE (2):**

- `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts` — `materializeToTable` handler for MANDATE_ISSUED + OPERATING_MODE_CHANGED.
- `services/advisory/decision-workflow-ctrl/src/repositories/mandate-snapshot.repository.ts` — pk helper.

**Production code — MODIFY (5):**

- `services/advisory/decision-workflow-ctrl/src/domain/events.ts` — drop `INVESTOR_PROFILE_CREATED` from `TRIGGER_EVENT_TYPES`; add `ADVISORY_PIPELINE_READY` to `DecisionWorkflowEventTypes` AND to `TRIGGER_EVENT_TYPES`; add `MANDATE_LIFECYCLE_EVENT_TYPES`.
- `services/advisory/decision-workflow-ctrl/src/service.stack.ts` — add `MandateProjectorIngress` for MANDATE_LIFECYCLE_EVENT_TYPES; add `MandateSnapshot:insert` → `ADVISORY_PIPELINE_READY` to Egress; grant SF read access to State table; (no other changes — TRIGGER_EVENT_TYPES already spread into Orchestration triggers).
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` — accept `tableName` prop; insert single `LookupMandateSnapshot` (Task: `dynamodb:getItem`) + `SetInvestorProfile` (Pass) between `UnpackTriggerEnvelope` and `ParallelProfiling`; change `invokeInvestorProfile.subject.investorProfile.$` to `$.investorProfile`.
- `services/advisory/advisory-adpt/src/service.stack.ts:39` — drop `AdvisoryIngestEventTypes.INVESTOR_PROFILE_CREATED` from `fromInvestorEvents` array.
- `services/advisory/advisory-adpt/src/domain/events.ts:28` — keep `INVESTOR_PROFILE_CREATED` in `AdvisoryIngestEventTypes` const for type symmetry (used by tests + libs); only drop from the rule's array. Verify no other consumer.

**Tests — MODIFY (10):**

- `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts:117-126` — replace "starts SF on INVESTOR_PROFILE_CREATED" with "starts SF on ADVISORY_PIPELINE_READY"; add MANDATE_ISSUED → MandateSnapshot:INSERT → ADVISORY_PIPELINE_READY full-chain test.
- `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.resilience.integration.test.ts:31` — comment update only.
- `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts:45,66` — assertion: triggers contain `ADVISORY_PIPELINE_READY` not `INVESTOR_PROFILE_CREATED`; new MandateProjectorIngress wired; SF role has dynamodb:GetItem on State table.
- `services/advisory/advisory-adpt/test/integration/from-investor.integration.test.ts:24-41` — delete the `INVESTOR_PROFILE_CREATED` forwarding test (event no longer forwarded).
- `services/advisory/advisory-adpt/test/unit/service.stack.test.ts:26` — drop `INVESTOR_PROFILE_CREATED` from expected detailType list.
- `services/advisory/advisory-bff/test/unit/transforms/decision-trigger-received.test.ts:8` — replace `'INVESTOR_PROFILE_CREATED'` with `'ADVISORY_PIPELINE_READY'` in the test fixture trigger list.
- `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts` (if referenced) — replace any direct INVESTOR_PROFILE_CREATED emission for inFlightCount with ADVISORY_PIPELINE_READY.
- `services/investor/dashboard-bff/test/unit/transforms/advisory-status.test.ts:8` — same replacement.
- `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts` — replace any direct INVESTOR_PROFILE_CREATED-as-trigger emission with ADVISORY_PIPELINE_READY (inFlightCount scenarios).
- `services/advisory/decision-workflow-ctrl/test/unit/mandate-projector.test.ts` — NEW (in Task 2 below).
- `services/advisory/decision-workflow-ctrl/test/unit/mandate-snapshot.repository.test.ts` — NEW (in Task 1 below).

**E2E tests / fixtures — MODIFY (5):**

- `apps/e2e-feature-tests/src/helpers/fixtures.ts:202-260` — `withLiveDecision` switches default from publishing `INVESTOR_PROFILE_CREATED` to publishing `MANDATE_ISSUED` (which projects → CDC → ADVISORY_PIPELINE_READY → SF). Type union updated to `'ADVISORY_PIPELINE_READY' | 'INVESTOR_PROFILE_UPDATED'`.
- `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts:39-41` — comment + test name update; the fixture call `withLiveDecision({ trigger: 'INVESTOR_PROFILE_CREATED' })` becomes `withLiveDecision()` (default = ADVISORY_PIPELINE_READY).
- `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts:114` — replace inline `detailType: 'INVESTOR_PROFILE_CREATED'` with the natural path: emit MANDATE_ISSUED with the desired operatingMode; assert SF reaches expected state (or use the updated `withLiveDecision({ operatingMode: 'CONSERVATIVE'|'BALANCED'|'AGGRESSIVE' })` if/when the parking-lot fixture refactor is done — for now, inline the MANDATE_ISSUED publish).
- `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts:24` — comment update only.
- `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts:134` — comment update only.

**Flows — MODIFY (1-2):**

- `flows/investor-onboarding.flow.yaml` — kickoff: ONBOARDING_COMPLETED → investor-bff → MANDATE_ISSUED → decision-workflow-ctrl-mandate-projector → MandateSnapshot:INSERT → ADVISORY_PIPELINE_READY → SF.
- `flows/advisory-cycle.flow.yaml` (if present) — same chain.

**Backlog file:**

- `docs/backlog/non-investor-profile-trigger-operating-mode-lookup.md` — set `status: shipped`, fill `validation_gate`.

---

## Task 1: MandateSnapshot pk helper

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/repositories/mandate-snapshot.repository.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/mandate-snapshot.repository.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/mandate-snapshot.repository.test.ts
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../../src/repositories/mandate-snapshot.repository';

describe('mandate-snapshot.repository', () => {
  it('builds a deterministic composite pk from tenantId + userId', () => {
    expect(mandateSnapshotPk('t', 'u')).toBe('MandateSnapshot#t#u');
  });
  it('does not collide across tenants for the same userId', () => {
    expect(mandateSnapshotPk('a', 'shared')).not.toBe(mandateSnapshotPk('b', 'shared'));
  });
  it('exports the canonical sk', () => {
    expect(MANDATE_SNAPSHOT_SK).toBe('MandateSnapshot');
  });
});
```

- [ ] **Step 2: Run test → expect FAIL**
```
pnpm nx test decision-workflow-ctrl --testPathPatterns=mandate-snapshot.repository.test
```

- [ ] **Step 3: Implement**
```ts
// src/repositories/mandate-snapshot.repository.ts
export const MANDATE_SNAPSHOT_SK = 'MandateSnapshot' as const;
export function mandateSnapshotPk(tenantId: string, userId: string): string {
  return `MandateSnapshot#${tenantId}#${userId}`;
}
```

- [ ] **Step 4: Run test → expect PASS** (3 tests)

- [ ] **Step 5: Commit**
```bash
git add services/advisory/decision-workflow-ctrl/src/repositories/mandate-snapshot.repository.ts \
        services/advisory/decision-workflow-ctrl/test/unit/mandate-snapshot.repository.test.ts
git commit -m "feat(decision-workflow-ctrl): add MandateSnapshot pk helper"
```

---

## Task 2: mandate-projector handler

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/mandate-projector.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/unit/mandate-projector.test.ts
import { createHandlers } from '../../src/handlers/mandate-projector';
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../../src/repositories/mandate-snapshot.repository';
import type { EventContext, EventPayload } from '@nestfolio/event-processor';

const ctx = (eventType: string, overrides: Partial<EventContext> = {}): EventContext => ({
  eventId: 'evt-1', eventType, tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1',
  ...overrides,
} as EventContext);

const payload = (subject: Record<string, unknown>): EventPayload => ({
  subject,
  context: { tenantId: 'tenant-1', userId: 'user-1', region: 'us-east-1' },
} as EventPayload);

describe('mandate-projector', () => {
  const handlers = createHandlers();

  it('MANDATE_ISSUED → record() with operatingMode + level + ACTIVE status', async () => {
    const result = await handlers.MANDATE_ISSUED(payload({
      tenantId: 'tenant-1', userId: 'user-1', operatingMode: 'BALANCED',
      level: 'ADVISORY', mandateId: 'm-1', effectiveDate: '2026-05-10T00:00:00Z',
    }), ctx('MANDATE_ISSUED'));
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent.kind).toBe('record');
    expect(intent.entityType).toBe('MandateSnapshot');
    expect(intent.overrides?.pk).toBe(mandateSnapshotPk('tenant-1', 'user-1'));
    expect(intent.overrides?.sk).toBe(MANDATE_SNAPSHOT_SK);
    expect(intent.payload.operatingMode).toBe('BALANCED');
    expect(intent.payload.status).toBe('ACTIVE');
  });

  it('MANDATE_ISSUED throws NotRetryableError when operatingMode missing', async () => {
    await expect(handlers.MANDATE_ISSUED(payload({
      tenantId: 'tenant-1', userId: 'user-1', level: 'ADVISORY', mandateId: 'm-1',
    }), ctx('MANDATE_ISSUED'))).rejects.toThrow(/operatingMode/);
  });

  it('OPERATING_MODE_CHANGED → update() patching only operatingMode', async () => {
    const result = await handlers.OPERATING_MODE_CHANGED(payload({
      tenantId: 'tenant-1', userId: 'user-1', operatingMode: 'AGGRESSIVE',
    }), ctx('OPERATING_MODE_CHANGED'));
    const intent = Array.isArray(result) ? result[0] : result;
    expect(intent.kind).toBe('update');
    expect(intent.payload.operatingMode).toBe('AGGRESSIVE');
  });
});
```

- [ ] **Step 2: Run → expect FAIL**

- [ ] **Step 3: Implement**

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
  return update('MandateSnapshot', { tenantId, userId, operatingMode }, {
    overrides: { pk: mandateSnapshotPk(tenantId, userId), sk: MANDATE_SNAPSHOT_SK },
  });
}

export const createHandlers = () => ({
  [InvestorBffEventTypes.MANDATE_ISSUED]: (p: EventPayload, c: EventContext) => processMandateIssued(p, c),
  [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: (p: EventPayload, c: EventContext) => processOperatingModeChanged(p, c),
});

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'MANDATE_PROJECTION_FAILED',
});
```

- [ ] **Step 4: Run → expect PASS** (3 tests)

- [ ] **Step 5: Commit**
```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts \
        services/advisory/decision-workflow-ctrl/test/unit/mandate-projector.test.ts
git commit -m "feat(decision-workflow-ctrl): project MandateSnapshot from MANDATE_ISSUED + OPERATING_MODE_CHANGED"
```

---

## Task 3: Update domain/events.ts — events list

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/events.ts`

- [ ] **Step 1: Edit the file**

```ts
import { eventName } from '@nestfolio/event-types';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';

export const DecisionWorkflowEventTypes = {
  DECISION_PACKET_CREATED: eventName('DECISION_PACKET_CREATED'),
  DECISION_PACKET_UPDATED: eventName('DECISION_PACKET_UPDATED'),
  ANALYZE_INVESTOR_PROFILE: eventName('ANALYZE_INVESTOR_PROFILE'),
  ANALYZE_MARKET: eventName('ANALYZE_MARKET'),
  CONSTRUCT_PORTFOLIO: eventName('CONSTRUCT_PORTFOLIO'),
  GENERATE_NARRATIVE: eventName('GENERATE_NARRATIVE'),
  RECOMMENDATION_PROPOSED: eventName('RECOMMENDATION_PROPOSED'),
  USER_CONFIRMATION_REQUESTED: eventName('USER_CONFIRMATION_REQUESTED'),
  DECISION_FEEDBACK: eventName('DECISION_FEEDBACK'),
  DECISION_WORKFLOW_FAILED: eventName('DECISION_WORKFLOW_FAILED'),
  AGENT_OUTPUT_CREATED: eventName('AGENT_OUTPUT_CREATED'),
  AGENT_OUTPUT_UPDATED: eventName('AGENT_OUTPUT_UPDATED'),
  ADVISORY_PIPELINE_READY: eventName('ADVISORY_PIPELINE_READY'), // NEW: CDC of MandateSnapshot:INSERT — first-decision trigger
} as const;

// SF triggers. INVESTOR_PROFILE_CREATED removed: replaced by ADVISORY_PIPELINE_READY
// (CDC of decision-workflow-ctrl-owned MandateSnapshot:INSERT — guarantees the
// projection is committed before the SF starts → SF unconditionally LookupMandateSnapshot).
export const TRIGGER_EVENT_TYPES = [
  eventName('ADVISORY_PIPELINE_READY'),
  eventName('INVESTOR_PROFILE_UPDATED'),
  eventName('PORTFOLIO_DRIFT_DETECTED'),
  eventName('ORDER_FILLED'),
  eventName('ORDER_REJECTED'),
  eventName('ORDER_CANCELLED'),
  eventName('DEPOSIT_DETECTED'),
] as const;

export const MANDATE_LIFECYCLE_EVENT_TYPES = [
  InvestorBffEventTypes.MANDATE_ISSUED,
  InvestorBffEventTypes.OPERATING_MODE_CHANGED,
] as const;

export const AGENT_COMPLETION_EVENT_TYPES = [
  eventName('INVESTOR_PROFILE_COMPLETED'),
  eventName('MARKET_ANALYSIS_COMPLETED'),
  eventName('PORTFOLIO_COMPLETED'),
  eventName('NARRATIVE_COMPLETED'),
] as const;

export const COMPLIANCE_EVENT_TYPES = [
  eventName('DECISION_APPROVED'),
  eventName('DECISION_BLOCKED'),
] as const;

export const USER_RESPONSE_EVENT_TYPES = [
  eventName('USER_CONFIRMED'),
  eventName('USER_REJECTED'),
] as const;

export const ALL_INBOUND_EVENT_TYPES = [
  ...AGENT_COMPLETION_EVENT_TYPES,
  ...COMPLIANCE_EVENT_TYPES,
  ...USER_RESPONSE_EVENT_TYPES,
] as const;
```

- [ ] **Step 2: Verify build**
```
pnpm nx build decision-workflow-ctrl 2>&1 | tail -5
```
Expected: build succeeds.

- [ ] **Step 3: Commit**
```bash
git add services/advisory/decision-workflow-ctrl/src/domain/events.ts
git commit -m "feat(decision-workflow-ctrl): swap INVESTOR_PROFILE_CREATED for ADVISORY_PIPELINE_READY trigger"
```

---

## Task 4: Wire MandateProjectorIngress + Egress + grants in service.stack.ts

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Update unit assertions** (these will FAIL until Step 2 wires the changes)

```ts
// test/unit/service.stack.test.ts — modify the existing expected detailType list (lines ~45, ~66)
// Replace 'INVESTOR_PROFILE_CREATED' with 'ADVISORY_PIPELINE_READY' in expected SF trigger detailTypes.
// Add new assertion blocks:

describe('MandateProjectorIngress', () => {
  it('subscribes to MANDATE_ISSUED + OPERATING_MODE_CHANGED', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['MANDATE_ISSUED', 'OPERATING_MODE_CHANGED']),
      }),
    });
  });
});

describe('Egress emits ADVISORY_PIPELINE_READY on MandateSnapshot:INSERT', () => {
  it('declares MandateSnapshot insert mapping', () => {
    const template = Template.fromStack(stack);
    // Indirect assertion via the egress publisher Lambda env or rule — check the
    // egress Lambda environment carries the mapping (declarative Egress writes it).
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          EVENT_TYPES_MAP: Match.stringLikeRegexp('ADVISORY_PIPELINE_READY'),
        }),
      }),
    });
  });
});

describe('SF role has dynamodb:GetItem on State table', () => {
  it('grants read', () => {
    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(['dynamodb:GetItem']), Effect: 'Allow' }),
        ]),
      }),
    });
  });
});
```

- [ ] **Step 2: Run → expect FAIL**

- [ ] **Step 3: Wire `service.stack.ts`**

Add imports at top:
```ts
import { MANDATE_LIFECYCLE_EVENT_TYPES } from './domain/events';
```

After `callbackIngress` block, before Egress:
```ts
// MandateProjectorIngress — projects MandateSnapshot rows so the SF can resolve
// operatingMode for ALL triggers via Direct DynamoDB GetItem (no Lambda).
const mandateProjectorIngress = new Ingress(this, 'MandateProjectorIngress', {
  state,
  eventTypes: [...MANDATE_LIFECYCLE_EVENT_TYPES],
  entry: join(__dirname, 'handlers', 'mandate-projector.ts'),
});

// SF role: dynamodb:GetItem on the local State table for LookupMandateSnapshot.
state.getTable().grantReadData(orchestration.stateMachine);
```

Extend Egress eventTypes:
```ts
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'DecisionPacket': {
      insert: DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
      modify: DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
    },
    'AgentOutput': {
      insert: DecisionWorkflowEventTypes.AGENT_OUTPUT_CREATED,
      modify: DecisionWorkflowEventTypes.AGENT_OUTPUT_UPDATED,
    },
    'MandateSnapshot': {
      insert: DecisionWorkflowEventTypes.ADVISORY_PIPELINE_READY,
      // No modify entry — operatingMode changes do NOT re-trigger first decision.
    },
  },
});
```

- [ ] **Step 4: Run → expect PASS**

- [ ] **Step 5: Commit**
```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts \
        services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(decision-workflow-ctrl): wire MandateProjector + ADVISORY_PIPELINE_READY egress"
```

---

## Task 5: SF single-path lookup — drop Choice, single Pass

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts` (pass tableName)
- Test: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Add `tableName` prop** to `DecisionWorkflowDefinitionProps`:

```ts
interface DecisionWorkflowDefinitionProps {
  readonly eventBus: IEventBus;
  readonly table: ITable;
  readonly tableName: string; // NEW
  readonly serviceName: string;
  readonly assemblePacketFnArn: string;
}
```

In `service.stack.ts` `DecisionWorkflowDefinition` construction, add `tableName: state.getTable().tableName,`.

- [ ] **Step 2: Add the failing CDK assertion**

```ts
// test/unit/service.stack.test.ts append
it('SF definition contains single dynamodb:getItem step', () => {
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
    DefinitionString: Match.stringLikeRegexp('arn:aws:states:::dynamodb:getItem'),
  });
  template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
    DefinitionString: Match.stringLikeRegexp('LookupMandateSnapshot'),
  });
});
```

- [ ] **Step 3: Edit `decision-state-machine.ts`** — replace the chain start.

After `unpackTriggerEnvelope` is created, add (BEFORE the chain wiring):

```ts
// Single-path operatingMode resolution. Every trigger event reaches this state
// — payload-vs-projection branching is gone. ADVISORY_PIPELINE_READY is the
// CDC of THIS service's own MandateSnapshot:INSERT, so by the time the SF
// starts the row is committed (read-your-write within service). For
// INVESTOR_PROFILE_UPDATED + non-PROFILE triggers (DEPOSIT_DETECTED etc.),
// onboarding has long since materialised the projection.
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

const setInvestorProfile = new sfn.Pass(this, 'SetInvestorProfile', {
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
```

- [ ] **Step 4: Replace the chain start**

From:
```ts
const definition = unpackTriggerEnvelope
  .next(parallelProfiling)
  ...
```

To:
```ts
const definition = unpackTriggerEnvelope
  .next(lookupMandateSnapshot)
  .next(setInvestorProfile)
  .next(parallelProfiling)
  // ... unchanged after this point
```

- [ ] **Step 5: Switch `invokeInvestorProfile` payload**

From:
```ts
'investorProfile.$': '$.triggerContext',
```

To:
```ts
'investorProfile.$': '$.investorProfile',
```

- [ ] **Step 6: Run → expect PASS**

- [ ] **Step 7: Commit**
```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts \
        services/advisory/decision-workflow-ctrl/src/service.stack.ts \
        services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(decision-workflow-ctrl): single-path operatingMode lookup via Direct DynamoDB GetItem"
```

---

## Task 6: advisory-adpt — drop INVESTOR_PROFILE_CREATED forwarding

**Files:**
- Modify: `services/advisory/advisory-adpt/src/service.stack.ts:39`
- Modify: `services/advisory/advisory-adpt/test/unit/service.stack.test.ts:26`
- Modify: `services/advisory/advisory-adpt/test/integration/from-investor.integration.test.ts`

- [ ] **Step 1: Update unit test expected detailType list**

In `test/unit/service.stack.test.ts`, drop `'INVESTOR_PROFILE_CREATED'` from the expected detailType array.

- [ ] **Step 2: Update integration test — delete the forwarding test**

In `test/integration/from-investor.integration.test.ts`, delete the entire `it('should forward INVESTOR_PROFILE_CREATED from InvestorBus to AdvisoryBus', ...)` block (and any specific helper used only by it).

- [ ] **Step 3: Run → expect FAIL**

```
pnpm nx test advisory-adpt --testPathPatterns=service.stack.test
```

- [ ] **Step 4: Edit `service.stack.ts:39`**

```ts
const fromInvestorEvents = [
  // INVESTOR_PROFILE_CREATED removed 2026-05-10 — zero advisoryBus consumers
  // post-migration to ADVISORY_PIPELINE_READY-driven first decision.
  AdvisoryIngestEventTypes.INVESTOR_PROFILE_UPDATED,
  AdvisoryIngestEventTypes.MANDATE_ISSUED,
  AdvisoryIngestEventTypes.MANDATE_REVOKED,
  AdvisoryIngestEventTypes.OPERATING_MODE_CHANGED,
];
```

- [ ] **Step 5: Run → expect PASS**

- [ ] **Step 6: Commit**
```bash
git add services/advisory/advisory-adpt/src/service.stack.ts \
        services/advisory/advisory-adpt/test/unit/service.stack.test.ts \
        services/advisory/advisory-adpt/test/integration/from-investor.integration.test.ts
git commit -m "refactor(advisory-adpt): drop INVESTOR_PROFILE_CREATED forwarding (no advisoryBus consumers)"
```

---

## Task 7: advisory-bff + dashboard-bff transform tests

**Files:**
- Modify: `services/advisory/advisory-bff/test/unit/transforms/decision-trigger-received.test.ts:8`
- Modify: `services/investor/dashboard-bff/test/unit/transforms/advisory-status.test.ts:8`
- Modify: `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts` (only sites that emit INVESTOR_PROFILE_CREATED to test inFlightCount increment)
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts` (same)

- [ ] **Step 1: Find the literal usages**

```
grep -rn "'INVESTOR_PROFILE_CREATED'" services/advisory/advisory-bff/test \
                                       services/investor/dashboard-bff/test
```

- [ ] **Step 2: Replace each occurrence with `'ADVISORY_PIPELINE_READY'`** in test fixtures (NOT in production code — production imports `TRIGGER_EVENT_TYPES` and gets the new list automatically).

- [ ] **Step 3: Run unit + integration tests for both services**

```
pnpm nx test advisory-bff
pnpm nx test dashboard-bff
```
Expected: PASS.

- [ ] **Step 4: Commit**
```bash
git add services/advisory/advisory-bff/test \
        services/investor/dashboard-bff/test
git commit -m "test(advisory-bff,dashboard-bff): retarget inFlightCount fixtures from INVESTOR_PROFILE_CREATED to ADVISORY_PIPELINE_READY"
```

---

## Task 8: e2e fixtures — `withLiveDecision` switches to MANDATE_ISSUED path

**Files:**
- Modify: `apps/e2e-feature-tests/src/helpers/fixtures.ts:202-260`

- [ ] **Step 1: Read the current implementation**

```
sed -n '195,260p' apps/e2e-feature-tests/src/helpers/fixtures.ts
```

- [ ] **Step 2: Update the type union + default + emission**

Replace the type union:
```ts
trigger?: 'ADVISORY_PIPELINE_READY' | 'INVESTOR_PROFILE_UPDATED';
```

Default trigger:
```ts
const trigger = opts?.trigger ?? 'ADVISORY_PIPELINE_READY';
```

For `'ADVISORY_PIPELINE_READY'` triggers, publish `MANDATE_ISSUED` directly on advisoryBus (the natural projection chain). For `'INVESTOR_PROFILE_UPDATED'`, keep current direct emission. Update the `eb.publish` call to switch on trigger:

```ts
if (trigger === 'ADVISORY_PIPELINE_READY') {
  // Natural chain: MANDATE_ISSUED → mandate-projector → MandateSnapshot:INSERT
  // → CDC → ADVISORY_PIPELINE_READY → SF.
  await eb.publish({
    detailType: 'MANDATE_ISSUED',
    source: `integration-test:${tenant.tenantId}`,
    detail: {
      id: crypto.randomUUID(),
      type: 'MANDATE_ISSUED',
      timestamp: new Date().toISOString(),
      subject: {
        tenantId: tenant.tenantId,
        userId: tenant.userId,
        mandateId: `e2e-mandate-${Date.now()}`,
        level: 'ADVISORY',
        operatingMode: 'BALANCED', // override via opts when fixture parking-lot ships
        effectiveDate: new Date().toISOString(),
      },
      context: { tenantId: tenant.tenantId, userId: tenant.userId, region: 'us-east-1' },
    },
  });
} else {
  // INVESTOR_PROFILE_UPDATED — direct emission (projection already materialised post-onboarding).
  await eb.publish({ /* existing INVESTOR_PROFILE_UPDATED emission */ });
}
```

- [ ] **Step 3: Run unit/lint locally**

```
pnpm nx lint e2e-feature-tests 2>&1 | tail -10
pnpm nx build e2e-feature-tests 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add apps/e2e-feature-tests/src/helpers/fixtures.ts
git commit -m "test(e2e): withLiveDecision publishes MANDATE_ISSUED for the natural ADVISORY_PIPELINE_READY chain"
```

---

## Task 9: e2e tests — first-decision + operating-mode-recommendation-shape

**Files:**
- Modify: `apps/e2e-feature-tests/src/advisory/first-decision.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-recommendation-shape.e2e.test.ts`
- Modify: `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts` (comment only)
- Modify: `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts` (comment only)

- [ ] **Step 1: first-decision.e2e.test.ts**

Replace `withLiveDecision({ trigger: 'INVESTOR_PROFILE_CREATED' })` with `withLiveDecision()` (default = ADVISORY_PIPELINE_READY). Update the test name and the comment in line 26: "emits MANDATE_ISSUED → projection → ADVISORY_PIPELINE_READY drives the live advisory cycle".

- [ ] **Step 2: operating-mode-recommendation-shape.e2e.test.ts**

Replace the inline `detailType: 'INVESTOR_PROFILE_CREATED'` publish (line 114) with a `detailType: 'MANDATE_ISSUED'` publish carrying the desired `operatingMode`. The downstream chain remains identical (mandate-projector → MandateSnapshot:INSERT → CDC → ADVISORY_PIPELINE_READY → SF starts). No other test logic changes.

- [ ] **Step 3: operating-mode-authority.e2e.test.ts** — update comment in line 24.
- [ ] **Step 4: profile/update-operating-mode.e2e.test.ts** — update comment in line 134.

- [ ] **Step 5: Run lint/build**

```
pnpm nx lint e2e-feature-tests 2>&1 | tail -10
```

- [ ] **Step 6: Commit**
```bash
git add apps/e2e-feature-tests/src/advisory \
        apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
git commit -m "test(e2e): retarget INVESTOR_PROFILE_CREATED-as-trigger e2es to MANDATE_ISSUED natural chain"
```

---

## Task 10: decision-workflow-ctrl integration test — full chain

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts:117-126`
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.resilience.integration.test.ts:31` (comment)

- [ ] **Step 1: Replace the existing INVESTOR_PROFILE_CREATED scenario**

Old:
```ts
it('starts SF on INVESTOR_PROFILE_CREATED', async () => { ... detailType: 'INVESTOR_PROFILE_CREATED' ... });
```

New:
```ts
it('projects MandateSnapshot from MANDATE_ISSUED → emits ADVISORY_PIPELINE_READY → starts SF', async () => {
  await emitEvent({
    type: 'MANDATE_ISSUED',
    subject: { tenantId, userId, mandateId: 'm-1', level: 'ADVISORY', operatingMode: 'BALANCED', effectiveDate: new Date().toISOString() },
  });
  await waitForCondition(async () =>
    !!(await readTableItem({ pk: `MandateSnapshot#${tenantId}#${userId}`, sk: 'MandateSnapshot' })),
    { timeoutMs: 30_000 },
  );
  // ADVISORY_PIPELINE_READY emitted by Egress → SF starts → reaches InvokeInvestorProfile
  const exec = await waitForSfExecutionByDecisionInput({ trigger: 'ADVISORY_PIPELINE_READY' });
  const history = await getExecutionHistory(exec.executionArn);
  expect(history).toContainEqual(expect.objectContaining({
    type: 'TaskStateEntered',
    stateEnteredEventDetails: expect.objectContaining({ name: 'InvokeInvestorProfile' }),
  }));
});

it('non-PROFILE trigger (DEPOSIT_DETECTED) reaches InvokeInvestorProfile via MandateSnapshot lookup', async () => {
  // Project MandateSnapshot first (one-shot setup — fixture above can be reused via helper)
  await emitEvent({ type: 'MANDATE_ISSUED', subject: { tenantId, userId, mandateId: 'm-1', level: 'ADVISORY', operatingMode: 'AGGRESSIVE', effectiveDate: new Date().toISOString() } });
  await waitForCondition(async () => !!(await readTableItem({ pk: `MandateSnapshot#${tenantId}#${userId}`, sk: 'MandateSnapshot' })));
  await emitEvent({ type: 'DEPOSIT_DETECTED', subject: { tenantId, userId, depositId: 'd-1', amountCents: 10_000_00, currency: 'USD' } });
  const exec = await waitForSfExecutionByDecisionInput({ trigger: 'DEPOSIT_DETECTED' });
  const history = await getExecutionHistory(exec.executionArn);
  expect(history).toContainEqual(expect.objectContaining({
    type: 'TaskStateEntered',
    stateEnteredEventDetails: expect.objectContaining({ name: 'InvokeInvestorProfile' }),
  }));
});
```

- [ ] **Step 2: Update the resilience test comment** in line 31 (no behavior change, just doc).

- [ ] **Step 3: Run integration**

```
NESTFOLIO_INTEG_PREFIX=integ pnpm nx run decision-workflow-ctrl:test-integration
```
Expected: PASS once Tasks 1-5 are deployed.

- [ ] **Step 4: Commit**
```bash
git add services/advisory/decision-workflow-ctrl/test/integration
git commit -m "test(decision-workflow-ctrl): integration scenarios for ADVISORY_PIPELINE_READY + non-PROFILE lookup"
```

---

## Task 11: Flow specs

**Files:**
- Modify: `flows/investor-onboarding.flow.yaml`
- Modify: `flows/advisory-cycle.flow.yaml` (if present)

- [ ] **Step 1: Update kickoff section** — replace the line claiming `INVESTOR_PROFILE_CREATED` triggers the SF with a description of the new chain (MANDATE_ISSUED → mandate-projector → MandateSnapshot:INSERT → CDC → ADVISORY_PIPELINE_READY → SF).

- [ ] **Step 2: validate-flow on the touched specs**

```
node .claude/skills/validate-flow/run.mjs flows/investor-onboarding.flow.yaml 2>&1 | tail -10
```

- [ ] **Step 3: Commit**
```bash
git add flows/investor-onboarding.flow.yaml flows/advisory-cycle.flow.yaml
git commit -m "docs(flows): describe ADVISORY_PIPELINE_READY-driven first decision chain"
```

---

## Task 12: Service card regen

- [ ] **Step 1: Run audit-service for the 3 services with material changes**

```
# Manually invoke audit-service skill via Claude Code for each:
# - decision-workflow-ctrl
# - advisory-adpt
# - advisory-bff (no source change but card mentions TRIGGER_EVENT_TYPES list)
# - dashboard-bff (same)
```

- [ ] **Step 2: Commit regen**

```bash
git add services/**/CLAUDE.md
git commit -m "docs(services): regenerate CLAUDE.md cards for ADVISORY_PIPELINE_READY migration"
```

---

## Task 13: Deploy to dev sandbox + e2e validation

- [ ] **Step 1: Pre-flight — affected**

```
pnpm nx affected --target=build --base=main 2>&1 | tail -20
```
Expected: `decision-workflow-ctrl`, `advisory-adpt`, `advisory-bff`, `dashboard-bff`, `e2e-feature-tests` listed.

- [ ] **Step 2: Deploy**

```
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev \
  --services=decision-workflow-ctrl,advisory-adpt,advisory-bff,dashboard-bff \
  2>&1 | tee /tmp/deploy-adv-pipeline-ready.log
```

- [ ] **Step 3: SF SUCCEEDED rate (50-execution sample)**

```
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:771924376645:stateMachine:dev-decision-workflow-ctrl-decisionstatemachine \
  --max-results 50 --region us-east-1 --output json |
  python3 -c "import json,sys; from collections import Counter; print(Counter(e['status'] for e in json.load(sys.stdin)['executions']))"
```
Expected: SUCCEEDED count strictly > 23 (today's baseline); FAILED ≤ 5.

- [ ] **Step 4: Re-run e2e gates**

```
NESTFOLIO_INTEG_PREFIX=dev NODE_OPTIONS='--experimental-vm-modules' \
  pnpm nx run e2e-feature-tests:test-e2e-features
```
Expected: previously-red advisory + funding scenarios turn green.

- [ ] **Step 5: Sanity-check one execution**

Pick a recent execution with `trigger=ADVISORY_PIPELINE_READY`; confirm history contains `LookupMandateSnapshot` (TaskScheduled / TaskSucceeded) and `SetInvestorProfile` (PassStateExited).

---

## Task 14: Ship the backlog item

- [ ] **Step 1: Update backlog frontmatter**

```yaml
status: shipped
validation_gate: "Dev SF SUCCEEDED rate >23/50 baseline post-deploy 2026-05-10; ADVISORY_PIPELINE_READY chain materialises end-to-end (MANDATE_ISSUED → MandateSnapshot:INSERT → ADVISORY_PIPELINE_READY → SF → InvokeInvestorProfile); decision-workflow-ctrl integration tests PASS; e2e first-decision + rebalance-on-drift PASS"
```

- [ ] **Step 2: backlog-lint --fix**
```
node .claude/skills/backlog-lint/lint.mjs --fix
```

- [ ] **Step 3: Commit**
```bash
git add docs/backlog/non-investor-profile-trigger-operating-mode-lookup.md docs/BACKLOG.md
git commit -m "docs(backlog): ship non-investor-profile-trigger-operating-mode-lookup"
```

---

## Validation gate (composite)

Workstream is shipped when ALL of:

1. `pnpm nx test decision-workflow-ctrl advisory-adpt advisory-bff dashboard-bff e2e-feature-tests` — PASS.
2. Integration scenarios in Task 10 — PASS.
3. Dev SF SUCCEEDED rate (Task 13 Step 3) — strictly > 23/50 baseline; ideally ≥45/50.
4. e2e advisory + funding scenarios — green (Task 13 Step 4).
5. Backlog file `status: shipped` with `validation_gate` filled (Task 14).

## Risks / things to watch

- **Race window for INVESTOR_PROFILE_UPDATED triggers**: a profile edit emitted very rapidly after a mandate is REVOKED could find a REVOKED MandateSnapshot. The lookup will return the row with status=REVOKED but we only read `operatingMode`. The SF would proceed; if the user wanted "no decisions for revoked mandates", that's a separate concern (compliance-ctrl already gates RECOMMENDATION_PROPOSED via MandateValidator).
- **`Item` not found at LookupMandateSnapshot**: shouldn't happen because every trigger event has a sequenced predecessor that materialises MandateSnapshot. If it does, the SF Task fails with a `States.Runtime` error. Defence-in-depth (Catch + DECISION_WORKFLOW_FAILED) is OPTIONAL — out of scope for this workstream; file follow-up if needed.
- **`States.Format` template syntax**: exact string `States.Format('MandateSnapshot#{}#{}', $.tenantId, $.userId)` works inside CustomState raw ASL.
- **Recently-shipped advisory in-flight projection**: rework risk on advisory-bff + dashboard-bff. Mitigation: Task 7 only updates fixture data; production code's `...TRIGGER_EVENT_TYPES` import resolves the new list automatically.
- **e2e test latency**: the natural MANDATE_ISSUED → projection chain adds ~50–200 ms before the SF starts. `withLiveDecision`'s polling loop handles arbitrary latency, so no test timeouts expected.
- **Cross-domain INVESTOR_PROFILE_CREATED forwarding rule drop**: advisory-adpt now forwards 4 events (down from 5). CFN diff will show one rule removed. Confirm via `cdk diff` before deploy.
