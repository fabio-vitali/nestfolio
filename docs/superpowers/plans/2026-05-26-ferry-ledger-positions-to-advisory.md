# Ferry Ledger Positions to Advisory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plumb ledger positions + cash into the advisory decision SF so `AssemblePacket` produces correct `currentPositions`, `portfolioValueCents`, `isInitialBuild`, and delta-based `proposedTrades` on every trigger.

**Architecture:** Extend the existing `SnapshotProjectorIngress` in `decision-workflow-ctrl` to subscribe to `PORTFOLIO_UPDATED` (already forwarded ledger→advisory). Project a `LedgerSnapshot` row in DWC's state table. Add a `LookupLedgerSnapshot` GetItem branch to the SF `ParallelProjections`. Rewrite `assemble-packet.ts` to compute delta-based BUY/SELL trades from real ledger state.

**Tech Stack:** TypeScript, AWS CDK (Step Functions + DynamoDB + EventBridge), `@nestfolio/event-processor` (`materializeToTable` pipeline + `record()` intent), Angular 21 (advisory MFE), Playwright (e2e scenarios).

**Related spec:** `docs/superpowers/specs/2026-05-26-ferry-ledger-positions-to-advisory-design.md`

---

## File structure

**Modify:**
- `services/advisory/decision-workflow-ctrl/src/repositories/projected-snapshot.repository.ts` — add `LedgerSnapshot` key helpers
- `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts` — add `projectLedgerSnapshot()` + handler registration
- `services/advisory/decision-workflow-ctrl/src/service.stack.ts` — add `PORTFOLIO_UPDATED` to `SnapshotProjectorIngress` subscriptions
- `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts` — branch C in `ParallelProjections` + pass-through + `AssembleDecisionPacket` payload
- `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts` — read from `ledgerSnapshot`; compute delta trades
- `services/advisory/decision-workflow-ctrl/test/unit/snapshot-projector.test.ts` — projector unit test
- `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts` — assert new subscription
- `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts` — assert branch C + pass-through fields
- `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts` — assert rebalance math
- `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts` — projection + SF read coverage
- `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts` — steady-state guardrail firing
- `apps/advisory-mfe/src/app/decision/trades-table.component.ts` — add `data-testid="proposed-trade"` to rows
- `apps/advisory-mfe/src/app/decision/decision-detail.component.ts` — add rebalance-badge element
- `services/advisory/decision-workflow-ctrl/CLAUDE.md` — service card update

**Create:**
- `services/advisory/decision-workflow-ctrl/src/trade-thresholds.ts` — `MICRO_TRADE_EPSILON_BPS` constant
- `apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts` — synthetic EB emit
- `apps/nestfolio-e2e/src/fixtures/wait-for-ledger-snapshot.ts` — DDB poll
- `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts` — UI assertion
- `apps/nestfolio-e2e/CLAUDE.md` — convention doc

---

## Task 1: Add `LedgerSnapshot` key helpers to projected-snapshot.repository.ts

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/repositories/projected-snapshot.repository.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/repositories/projected-snapshot.repository.test.ts` (create if missing)

- [ ] **Step 1: Check whether the repository unit test file exists**

```bash
ls services/advisory/decision-workflow-ctrl/test/unit/repositories/ 2>/dev/null
```

If `projected-snapshot.repository.test.ts` exists, modify it in-place. If not, create it.

- [ ] **Step 2: Write the failing test**

Append to (or create) `test/unit/repositories/projected-snapshot.repository.test.ts`:

```ts
import {
  PROJECTED_LEDGER_SNAPSHOT_SK,
  projectedLedgerSnapshotPk,
} from '../../../src/repositories/projected-snapshot.repository';

describe('projected-snapshot.repository — LedgerSnapshot', () => {
  it('exports the static sk', () => {
    expect(PROJECTED_LEDGER_SNAPSHOT_SK).toBe('LedgerSnapshot');
  });

  it('builds pk from tenantId only', () => {
    expect(projectedLedgerSnapshotPk('tenant-abc')).toBe('LedgerSnapshot#tenant-abc');
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=projected-snapshot.repository
```

Expected: FAIL with `Cannot find name 'PROJECTED_LEDGER_SNAPSHOT_SK'` / `'projectedLedgerSnapshotPk'`.

- [ ] **Step 4: Add the exports**

In `services/advisory/decision-workflow-ctrl/src/repositories/projected-snapshot.repository.ts`, append:

```ts
export const PROJECTED_LEDGER_SNAPSHOT_SK = 'LedgerSnapshot' as const;

export function projectedLedgerSnapshotPk(tenantId: string): string {
  return `LedgerSnapshot#${tenantId}`;
}
```

- [ ] **Step 5: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=projected-snapshot.repository
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/repositories/projected-snapshot.repository.ts \
  services/advisory/decision-workflow-ctrl/test/unit/repositories/projected-snapshot.repository.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): add LedgerSnapshot key helpers

Adds projectedLedgerSnapshotPk + PROJECTED_LEDGER_SNAPSHOT_SK exports
to the projected-snapshot repository. Key is per-tenant
(ledger keys by tenantId only — no userId today).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `projectLedgerSnapshot()` to the snapshot-projector handler

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/snapshot-projector.test.ts`

- [ ] **Step 1: Read the existing test file to find the assertion idiom**

```bash
sed -n '1,40p' services/advisory/decision-workflow-ctrl/test/unit/snapshot-projector.test.ts
```

The existing tests dispatch a single event-type handler from `createHandlers()`. Follow that pattern.

- [ ] **Step 2: Write the failing test**

Append to `test/unit/snapshot-projector.test.ts`:

```ts
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';

describe('snapshot-projector — LedgerSnapshot', () => {
  it('projects PORTFOLIO_UPDATED into a LedgerSnapshot record intent', async () => {
    const handlers = createHandlers();
    const intent = await handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED](
      {
        subject: {
          tenantId: 'tenant-abc',
          snapshot: {
            positions: { VTI: { quantity: 10, lastFillPrice: 200 } },
            cashBalanceCents: 5_000_00,
            lastEventSequence: 7,
          },
        },
      } as never,
      { tenantId: 'tenant-abc', eventId: 'evt-1', eventType: 'PORTFOLIO_UPDATED' } as never,
    );

    expect(intent._tag).toBe('record');
    expect(intent.typename).toBe('LedgerSnapshot');
    expect(intent.overrides).toEqual({
      pk: 'LedgerSnapshot#tenant-abc',
      sk: 'LedgerSnapshot',
    });
    const fields = intent.fields as Record<string, unknown>;
    expect(fields.tenantId).toBe('tenant-abc');
    expect(fields.lastEventSequence).toBe(7);
    expect(typeof fields.state).toBe('string');
    const parsed = JSON.parse(fields.state as string);
    expect(parsed.positions.VTI.quantity).toBe(10);
    expect(parsed.cashBalanceCents).toBe(500_000);
  });

  it('raises NotRetryableError when subject.snapshot is missing', async () => {
    const handlers = createHandlers();
    await expect(
      handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED](
        { subject: { tenantId: 'tenant-abc' } } as never,
        { tenantId: 'tenant-abc', eventId: 'evt-2', eventType: 'PORTFOLIO_UPDATED' } as never,
      ),
    ).rejects.toThrow(/missing subject\.snapshot/);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=snapshot-projector
```

Expected: FAIL — `handlers[LedgerCtrlEventTypes.PORTFOLIO_UPDATED] is not a function`.

- [ ] **Step 4: Add the projector function + handler registration**

In `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts`:

Update the imports — add `LedgerCtrlEventTypes` and the new key helpers:

```ts
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
import {
  PROJECTED_IP_SNAPSHOT_SK,
  PROJECTED_LEDGER_SNAPSHOT_SK,
  PROJECTED_MARKET_SNAPSHOT_SK,
  projectedIpSnapshotPk,
  projectedLedgerSnapshotPk,
  projectedMarketSnapshotPk,
} from '../repositories/projected-snapshot.repository';
```

Add the projector function next to the existing two (above `createHandlers`):

```ts
function projectLedgerSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const snapshot = subject.snapshot as
    | { positions: Record<string, unknown>; cashBalanceCents: number; lastEventSequence: number }
    | undefined;
  if (!snapshot) {
    throw new NotRetryableError(
      `${ctx.eventType} missing subject.snapshot for tenant=${tenantId}`,
    );
  }
  const attrs = {
    tenantId,
    state: JSON.stringify({
      positions: snapshot.positions,
      cashBalanceCents: snapshot.cashBalanceCents,
    }),
    lastEventSequence: snapshot.lastEventSequence,
    sourceEventId: (subject.sourceEventId as string) ?? ctx.eventId,
    updatedAt: new Date().toISOString(),
  };
  return record(
    'LedgerSnapshot',
    attrs,
    {
      pk: projectedLedgerSnapshotPk(tenantId),
      sk: PROJECTED_LEDGER_SNAPSHOT_SK,
    },
  );
}
```

Register the handler — extend the object returned by `createHandlers()`:

```ts
[LedgerCtrlEventTypes.PORTFOLIO_UPDATED]: async (
  p: EventPayload,
  c: EventContext,
) => projectLedgerSnapshot(p, c),
```

- [ ] **Step 5: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=snapshot-projector
```

Expected: PASS for the two new cases; existing IP/Market cases still PASS.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts \
  services/advisory/decision-workflow-ctrl/test/unit/snapshot-projector.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): project LedgerSnapshot from PORTFOLIO_UPDATED

snapshot-projector dispatches PORTFOLIO_UPDATED to project a LedgerSnapshot
record with JSON-stringified positions + cashBalanceCents. Mirrors the
InvestorProfile/Market projection idiom so the SF can States.StringToJson
the value on read.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Subscribe `SnapshotProjectorIngress` to `PORTFOLIO_UPDATED`

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Locate the existing `SnapshotProjectorIngress` block**

```bash
grep -n "SnapshotProjectorIngress\|snapshot-projector-ingress" \
  services/advisory/decision-workflow-ctrl/src/service.stack.ts
```

The Ingress passes a `detailType:` array (or `eventTypes` prop) of subscriptions. The current set is `INVESTOR_PROFILE_SNAPSHOT_CREATED + INVESTOR_PROFILE_SNAPSHOT_UPDATED + MARKET_SNAPSHOT_UPDATED`.

- [ ] **Step 2: Write the failing test**

Append a test case to `test/unit/service.stack.test.ts` in the suite that already asserts SnapshotProjectorIngress subscriptions (search for `SnapshotProjector` in that file):

```ts
it('SnapshotProjectorIngress subscribes to PORTFOLIO_UPDATED', () => {
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::Events::Rule', {
    EventPattern: Match.objectLike({
      'detail-type': Match.arrayWith([
        'PORTFOLIO_UPDATED',
      ]),
    }),
  });
});
```

If the existing tests use a different assertion style (e.g. asserting on the constructed event-types array via a synth-time helper), mirror that style — but the resource-level assertion above is the safest default.

- [ ] **Step 3: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=service.stack
```

Expected: FAIL — no Rule found with `PORTFOLIO_UPDATED` in `detail-type`.

- [ ] **Step 4: Add the subscription**

In `service.stack.ts`, find the array of event types passed to `SnapshotProjectorIngress` and add `LedgerCtrlEventTypes.PORTFOLIO_UPDATED`. Import it at the top if missing:

```ts
import { LedgerCtrlEventTypes } from '@nestfolio/ledger-ctrl/events';
```

Then in the subscriptions array (looks like):

```ts
const snapshotProjectorEvents = [
  InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_CREATED,
  InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_UPDATED,
  MarketIntelligenceEventTypes.MARKET_SNAPSHOT_UPDATED,
  LedgerCtrlEventTypes.PORTFOLIO_UPDATED,   // ← add this line
];
```

- [ ] **Step 5: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=service.stack
```

Expected: PASS for the new case; all previous PASS untouched.

- [ ] **Step 6: Update the service card frontmatter for this subscription**

Edit `services/advisory/decision-workflow-ctrl/CLAUDE.md`. In the `SnapshotProjectorIngress` block under the `## Ingress` section, update the `Subscriptions:` line to add `PORTFOLIO_UPDATED`. Example diff:

```
- Subscriptions: INVESTOR_PROFILE_SNAPSHOT_CREATED, INVESTOR_PROFILE_SNAPSHOT_UPDATED, MARKET_SNAPSHOT_UPDATED
+ Subscriptions: INVESTOR_PROFILE_SNAPSHOT_CREATED, INVESTOR_PROFILE_SNAPSHOT_UPDATED, MARKET_SNAPSHOT_UPDATED, PORTFOLIO_UPDATED
```

- [ ] **Step 7: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts \
  services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts \
  services/advisory/decision-workflow-ctrl/CLAUDE.md
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): subscribe SnapshotProjectorIngress to PORTFOLIO_UPDATED

Adds the fourth subscription so the projector materialises LedgerSnapshot
rows whenever the ledger emits a portfolio update (already forwarded
ledgerBus → advisoryBus by advisory-adpt).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add SF branch C — `LookupLedgerSnapshot`

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`

- [ ] **Step 1: Find where the existing two branches are constructed**

```bash
grep -n "lookupInvestorProfileSnapshot\|lookupMarketSnapshot\|ParallelProjections" \
  services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts
```

Branch A (`resolveInvestorProfile`) and Branch B (`lookupMarketSnapshot.next(checkMarketSnapshotPresent)`) are added via `parallelProjections.branch(...)`. We add a third `parallelProjections.branch(...)` for `LookupLedgerSnapshot`.

- [ ] **Step 2: Write the failing test**

Append to `test/unit/decision-state-machine.test.ts`:

```ts
it('ParallelProjections includes a LookupLedgerSnapshot branch with Choice on isPresent($.ledgerSnapshotResponse.Item.state.S)', () => {
  const template = synthDefinition();   // existing helper in the test file
  // States are flattened in the ASL JSON; find by name
  expect(template.States.LookupLedgerSnapshot).toBeDefined();
  expect(template.States.LookupLedgerSnapshot.Type).toBe('Task');
  expect(template.States.LookupLedgerSnapshot.Resource).toMatch(/dynamodb:getItem/);
  expect(template.States.LookupLedgerSnapshot.ResultPath).toBe('$.ledgerSnapshotResponse');

  expect(template.States.CheckLedgerSnapshotPresent).toBeDefined();
  expect(template.States.CheckLedgerSnapshotPresent.Type).toBe('Choice');
  const choice = template.States.CheckLedgerSnapshotPresent.Choices[0];
  expect(choice.Variable).toBe('$.ledgerSnapshotResponse.Item.state.S');
  expect(choice.IsPresent).toBe(true);

  expect(template.States.ExtractLedgerSnapshot).toBeDefined();
  expect(template.States.ExtractLedgerSnapshot.Parameters['state.$']).toMatch(/States\.StringToJson/);
  expect(template.States.ExtractLedgerSnapshot.ResultPath).toBe('$.ledgerSnapshot');

  expect(template.States.HandleMissingLedgerSnapshot).toBeDefined();
  expect(template.States.HandleMissingLedgerSnapshot.Result).toEqual({
    state: { positions: {}, cashBalanceCents: 0 },
  });
  expect(template.States.HandleMissingLedgerSnapshot.ResultPath).toBe('$.ledgerSnapshot');
});
```

If the existing test file doesn't have a `synthDefinition()` helper, re-use whatever the existing branch-A/B tests use (likely `JSON.parse(stateMachine.definitionBody.toString())` against a synthesized stack). Keep the assertion style consistent.

- [ ] **Step 3: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=decision-state-machine
```

Expected: FAIL — `template.States.LookupLedgerSnapshot is undefined`.

- [ ] **Step 4: Add branch C to the construct**

In `decision-state-machine.ts`, after the existing `extractMarketSnapshot` / `checkMarketSnapshotPresent` block and before `parallelProjections.branch(...)` calls, add:

```ts
const lookupLedgerSnapshot = new sfnTasks.DynamoGetItem(this, 'LookupLedgerSnapshot', {
  table: props.table,
  key: {
    pk: sfnTasks.DynamoAttributeValue.fromString(
      sfn.JsonPath.format('LedgerSnapshot#{}', sfn.JsonPath.stringAt('$.tenantId')),
    ),
    sk: sfnTasks.DynamoAttributeValue.fromString('LedgerSnapshot'),
  },
  resultPath: '$.ledgerSnapshotResponse',
});
const extractLedgerSnapshot = new sfn.Pass(this, 'ExtractLedgerSnapshot', {
  parameters: {
    'state.$':
      'States.StringToJson($.ledgerSnapshotResponse.Item.state.S)',
  },
  resultPath: '$.ledgerSnapshot',
});
const handleMissingLedgerSnapshot = new sfn.Pass(this, 'HandleMissingLedgerSnapshot', {
  result: sfn.Result.fromObject({ state: { positions: {}, cashBalanceCents: 0 } }),
  resultPath: '$.ledgerSnapshot',
});
const checkLedgerSnapshotPresent = new sfn.Choice(this, 'CheckLedgerSnapshotPresent')
  .when(
    sfn.Condition.isPresent('$.ledgerSnapshotResponse.Item.state.S'),
    extractLedgerSnapshot,
  )
  .otherwise(handleMissingLedgerSnapshot);
```

Then add the third branch to `parallelProjections`:

```ts
parallelProjections.branch(lookupLedgerSnapshot.next(checkLedgerSnapshotPresent));
```

(The existing two `branch()` calls are already there; append a third immediately after them.)

- [ ] **Step 5: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=decision-state-machine
```

Expected: PASS for the new case.

- [ ] **Step 6: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts \
  services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): add LookupLedgerSnapshot SF branch

Adds a third branch to ParallelProjections that reads LedgerSnapshot
from the local state table, with Choice-on-isPresent absent-row tolerance
symmetric with the IP/Market branches. Never Catch on States.Runtime
per feedback-states-runtime-uncatchable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Lift `ledgerSnapshot` through `MergeProjections` + pass-through states

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/decision-state-machine.test.ts`:

```ts
it('MergeProjections lifts $.parallelResults[2].ledgerSnapshot.state to $.ledgerSnapshot', () => {
  const template = synthDefinition();
  expect(template.States.MergeProjections.Parameters['ledgerSnapshot.$']).toBe(
    '$.parallelResults[2].ledgerSnapshot.state',
  );
});

it('SetInvestorProfile forwards ledgerSnapshot through', () => {
  const template = synthDefinition();
  expect(template.States.SetInvestorProfile.Parameters['ledgerSnapshot.$']).toBe('$.ledgerSnapshot');
});

it('HoistMandateFromTrigger forwards ledgerSnapshot through', () => {
  const template = synthDefinition();
  expect(template.States.HoistMandateFromTrigger.Parameters['ledgerSnapshot.$']).toBe('$.ledgerSnapshot');
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=decision-state-machine
```

Expected: three FAILs — fields undefined.

- [ ] **Step 3: Add the lift to `MergeProjections`**

In `decision-state-machine.ts`, locate the `mergeProjections` Pass state. Inside its `parameters` object, after the existing `agentResults` lift, add:

```ts
'ledgerSnapshot.$': '$.parallelResults[2].ledgerSnapshot.state',
```

- [ ] **Step 4: Add the pass-through line to `setInvestorProfile`**

Same file. Inside `setInvestorProfile`'s `parameters` object, after `'agentResults.$': '$.agentResults',` add:

```ts
'ledgerSnapshot.$': '$.ledgerSnapshot',
```

- [ ] **Step 5: Add the pass-through line to `hoistMandateFromTrigger`**

Same file. Inside `hoistMandateFromTrigger`'s `parameters` object, after `'agentResults.$': '$.agentResults',` add:

```ts
'ledgerSnapshot.$': '$.ledgerSnapshot',
```

- [ ] **Step 6: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=decision-state-machine
```

Expected: all three new cases PASS; existing pass-through tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts \
  services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): plumb ledgerSnapshot through MergeProjections

Lifts parallel branch C's ledgerSnapshot.state into top-level $.ledgerSnapshot,
then preserves it through SetInvestorProfile + HoistMandateFromTrigger so
it reaches AssemblePacket regardless of which mandate-resolution branch
the SF takes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Pass `ledgerSnapshot` into `AssembleDecisionPacket` Lambda payload

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/decision-state-machine.test.ts`:

```ts
it('AssembleDecisionPacket Payload includes ledgerSnapshot', () => {
  const template = synthDefinition();
  expect(template.States.AssembleDecisionPacket.Parameters.Payload['ledgerSnapshot.$']).toBe(
    '$.ledgerSnapshot',
  );
});

it('AssembleDecisionPacket ResultSelector still flattens proposedTrades + currentPositions', () => {
  const template = synthDefinition();
  // Sanity: existing fields kept after our additions.
  expect(template.States.AssembleDecisionPacket.ResultSelector['proposedTrades.$']).toBe('$.Payload.proposedTrades');
  expect(template.States.AssembleDecisionPacket.ResultSelector['currentPositions.$']).toBe('$.Payload.currentPositions');
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=decision-state-machine
```

Expected: FAIL — first new case; the second passes if you didn't touch ResultSelector.

- [ ] **Step 3: Add `ledgerSnapshot.$` to the Lambda payload**

In `decision-state-machine.ts`, locate `assemblePacket` CustomState. Inside `Parameters.Payload`, after `'narrative.$': '$.agentResults.InvokeAdvisoryNarrative.agentOutput',` add:

```ts
'ledgerSnapshot.$': '$.ledgerSnapshot',
```

- [ ] **Step 4: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=decision-state-machine
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts \
  services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): pass ledgerSnapshot into AssemblePacket Lambda

Adds the ledgerSnapshot field to AssembleDecisionPacket's Payload so the
Lambda reads positions + cashBalanceCents from real ledger state instead
of from the PE agent's never-populated portfolio.currentPositions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add `MICRO_TRADE_EPSILON_BPS` constant

**Files:**
- Create: `services/advisory/decision-workflow-ctrl/src/trade-thresholds.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/trade-thresholds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/trade-thresholds.test.ts`:

```ts
import { MICRO_TRADE_EPSILON_BPS } from '../../src/trade-thresholds';

describe('trade-thresholds', () => {
  it('exports MICRO_TRADE_EPSILON_BPS as 100 (1% of portfolio value)', () => {
    expect(MICRO_TRADE_EPSILON_BPS).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=trade-thresholds
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the constants file**

Write `services/advisory/decision-workflow-ctrl/src/trade-thresholds.ts`:

```ts
/**
 * Thresholds used by AssemblePacket to derive proposedTrades.
 *
 * MICRO_TRADE_EPSILON_BPS is the minimum absolute delta — in basis points
 * of portfolioValueCents — at which a rebalance trade is emitted. Trades
 * below this threshold are dropped to avoid generating broker activity
 * for changes that round to a few dollars. 100 bps = 1%.
 */
export const MICRO_TRADE_EPSILON_BPS = 100 as const;
```

- [ ] **Step 4: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=trade-thresholds
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/trade-thresholds.ts \
  services/advisory/decision-workflow-ctrl/test/unit/trade-thresholds.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): add MICRO_TRADE_EPSILON_BPS constant

Threshold AssemblePacket uses to drop micro-rebalance trades below 1%
of portfolio value. Lives in its own module since agent-budgets.ts is
semantically about Lambda timeouts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: AssemblePacket — read `ledgerSnapshot`, compute `currentPositions` + `portfolioValueCents` + `isInitialBuild`

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/assemble-packet.test.ts`:

```ts
describe('assemble-packet — ledgerSnapshot integration', () => {
  it('computes currentPositions from ledgerSnapshot.positions, dropping zero-quantity entries', async () => {
    const event = baseEvent({
      ledgerSnapshot: {
        positions: {
          VTI: { quantity: 10, lastFillPrice: 200 },     // 200_000c
          BND: { quantity: 50, lastFillPrice: 80 },      //  400_000c
          ZERO: { quantity: 0, lastFillPrice: 100 },     // dropped
        },
        cashBalanceCents: 100_000,
      },
      triggerAmountCents: 0,
      portfolio: { allocations: [] },
    });
    const out = await handler(event);
    expect(out.currentPositions).toEqual([
      { symbol: 'VTI', quantity: 10, marketValueCents: 200_000 },
      { symbol: 'BND', quantity: 50, marketValueCents: 400_000 },
    ]);
    expect(out.portfolioValueCents).toBe(200_000 + 400_000 + 100_000);
    expect(out.isInitialBuild).toBe(false);
  });

  it('treats empty positions as initial build and uses cash + trigger as portfolioValue', async () => {
    const event = baseEvent({
      ledgerSnapshot: { positions: {}, cashBalanceCents: 0 },
      triggerAmountCents: 5_000_000,
      portfolio: { allocations: [] },
    });
    const out = await handler(event);
    expect(out.currentPositions).toEqual([]);
    expect(out.portfolioValueCents).toBe(5_000_000);
    expect(out.isInitialBuild).toBe(true);
  });
});
```

`baseEvent()` is the existing helper in this test file that builds a minimal-but-valid AssemblePacket payload. If it doesn't yet accept a `ledgerSnapshot` field, extend it to spread the override last so the test's value wins.

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=assemble-packet
```

Expected: FAIL — `out.currentPositions` returns the old empty/PE-derived shape.

- [ ] **Step 3: Modify `assemble-packet.ts` to read `ledgerSnapshot`**

In `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`, find the block (around line 60) that currently reads `currentPositions` from `portfolio?.currentPositions` and computes `portfolioValueCents`. Replace it with:

```ts
// LedgerSnapshot is plumbed in by the SF (Branch C of ParallelProjections).
// On absent-row, the SF substitutes { positions: {}, cashBalanceCents: 0 } —
// so we never have to handle `undefined` here.
const ledgerSnapshot = (event.ledgerSnapshot as
  | { positions?: Record<string, { quantity?: number; lastFillPrice?: number }>; cashBalanceCents?: number }
  | undefined) ?? { positions: {}, cashBalanceCents: 0 };

const positionsBySymbol = ledgerSnapshot.positions ?? {};
const cashBalanceCents = ledgerSnapshot.cashBalanceCents ?? 0;

const currentPositions = Object.entries(positionsBySymbol)
  .filter(([, p]) => (p?.quantity ?? 0) > 0)
  .map(([symbol, p]) => ({
    symbol: symbol.trim().toUpperCase(),
    quantity: p.quantity!,
    marketValueCents: Math.round((p.quantity ?? 0) * (p.lastFillPrice ?? 0) * 100),
  }));

const currentPositionsValueCents = currentPositions.reduce(
  (sum, p) => sum + p.marketValueCents,
  0,
);
const portfolioValueCents =
  currentPositionsValueCents + cashBalanceCents + (triggerAmountCents ?? 0);
const isInitialBuild = currentPositions.length === 0;
```

Update the return value's `currentPositions` field to use this new array (the `{ symbol, quantity, marketValueCents }[]` shape) instead of whatever was being returned before.

- [ ] **Step 4: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=assemble-packet
```

Expected: new cases PASS. Some pre-existing tests may still fail until Task 10 (`proposedTrades` shape) lands — that's expected. Note any failures and confirm they involve `proposedTrades`, not `currentPositions` / `portfolioValueCents` / `isInitialBuild`.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts \
  services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): AssemblePacket reads positions + cash from ledger

currentPositions is now derived from ledgerSnapshot (plumbed via the SF
Branch C lookup), zero-quantity entries dropped. portfolioValueCents =
positions + ledger cash + triggerAmountCents (the deposit not-yet-ledgered).
isInitialBuild correctly reflects whether the investor holds anything.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: AssemblePacket — index targets + current by symbol (helper utility)

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts`

This task prepares the indexing helpers used by Task 10. Splitting them out keeps the diff-per-commit small and the test surface clear.

- [ ] **Step 1: Write the failing test**

Append to `test/unit/assemble-packet.test.ts`:

```ts
import { __INTERNAL__ as ap } from '../../src/handlers/assemble-packet';

describe('assemble-packet — indexing helpers', () => {
  it('normalizes target symbols (trim + uppercase) and skips CASH/blank', () => {
    const targets = ap.indexTargets([
      { instrument: 'vti ', assetClass: 'EQUITY', targetWeight: 0.6, rationale: '' },
      { instrument: '  BND', assetClass: 'FIXED_INCOME', targetWeight: 0.4, rationale: '' },
      { instrument: 'CASH', assetClass: 'CASH', targetWeight: 0.1, rationale: '' },  // dropped
      { instrument: '', assetClass: 'EQUITY', targetWeight: 0.1, rationale: '' },    // dropped
    ]);
    expect([...targets.keys()].sort()).toEqual(['BND', 'VTI']);
    expect(targets.get('VTI')?.targetWeight).toBe(0.6);
  });

  it('indexes currentPositions by symbol', () => {
    const current = ap.indexCurrent([
      { symbol: 'VTI', quantity: 10, marketValueCents: 200_000 },
    ]);
    expect(current.get('VTI')?.marketValueCents).toBe(200_000);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=assemble-packet
```

Expected: FAIL — `__INTERNAL__` not exported.

- [ ] **Step 3: Add the indexing helpers + `__INTERNAL__` export**

In `assemble-packet.ts`, above the `handler` function, add:

```ts
interface Allocation {
  instrument: string;
  assetClass: string;
  targetWeight: number;
  rationale: string;
}

interface CurrentPosition {
  symbol: string;
  quantity: number;
  marketValueCents: number;
}

function indexTargets(allocations: ReadonlyArray<Partial<Allocation>>): Map<string, Allocation> {
  const out = new Map<string, Allocation>();
  for (const a of allocations) {
    if (!a.instrument || a.assetClass === 'CASH') continue;
    const symbol = a.instrument.trim().toUpperCase();
    if (!symbol) continue;
    out.set(symbol, {
      instrument: symbol,
      assetClass: (a.assetClass as string) ?? 'OTHER',
      targetWeight: (a.targetWeight as number) ?? 0,
      rationale: (a.rationale as string) ?? '',
    });
  }
  return out;
}

function indexCurrent(currentPositions: ReadonlyArray<CurrentPosition>): Map<string, CurrentPosition> {
  const out = new Map<string, CurrentPosition>();
  for (const p of currentPositions) out.set(p.symbol, p);
  return out;
}

export const __INTERNAL__ = { indexTargets, indexCurrent };
```

- [ ] **Step 4: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=assemble-packet
```

Expected: PASS for the new cases.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts \
  services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): AssemblePacket symbol-indexing helpers

Adds indexTargets + indexCurrent helpers and exposes them via
__INTERNAL__ so the delta-trade logic (next commit) can reuse them
with unit-test coverage at the right granularity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: AssemblePacket — delta-based `proposedTrades` (BUY + SELL)

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/assemble-packet.test.ts`:

```ts
describe('assemble-packet — delta proposedTrades', () => {
  it('BUYs symbols in target but not held, sized at full target', async () => {
    const out = await handler(baseEvent({
      ledgerSnapshot: { positions: {}, cashBalanceCents: 10_000_00 },
      triggerAmountCents: 0,
      portfolio: { allocations: [
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.6, rationale: 'r' },
      ]},
    }));
    expect(out.proposedTrades).toEqual([
      expect.objectContaining({ symbol: 'VTI', side: 'BUY', quantityOrAmountCents: 6_000_00, targetWeightPercent: 60 }),
    ]);
  });

  it('BUYs when target > current and SELLs when target < current', async () => {
    const out = await handler(baseEvent({
      ledgerSnapshot: {
        // 100_00 cash + VTI@200_000c + BND@200_000c = 500_000c portfolio.
        positions: {
          VTI: { quantity: 10, lastFillPrice: 200 },   // currentCents 200_000
          BND: { quantity: 25, lastFillPrice: 80 },    // currentCents 200_000
        },
        cashBalanceCents: 100_000,
      },
      triggerAmountCents: 0,
      portfolio: { allocations: [
        // target VTI 80% = 400_000c → BUY 200_000c
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.8, rationale: '' },
        // target BND 20% = 100_000c → SELL 100_000c
        { instrument: 'BND', assetClass: 'FIXED_INCOME', targetWeight: 0.2, rationale: '' },
      ]},
    }));
    const vti = out.proposedTrades.find(t => t.symbol === 'VTI')!;
    const bnd = out.proposedTrades.find(t => t.symbol === 'BND')!;
    expect(vti).toMatchObject({ side: 'BUY', quantityOrAmountCents: 200_000, targetWeightPercent: 80 });
    expect(bnd).toMatchObject({ side: 'SELL', quantityOrAmountCents: 100_000, targetWeightPercent: 20 });
  });

  it('emits a full SELL for symbols held but not in target', async () => {
    const out = await handler(baseEvent({
      ledgerSnapshot: {
        positions: { OLD: { quantity: 5, lastFillPrice: 100 } },   // 50_000c
        cashBalanceCents: 0,
      },
      triggerAmountCents: 0,
      portfolio: { allocations: [
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 1.0, rationale: '' },
      ]},
    }));
    const old = out.proposedTrades.find(t => t.symbol === 'OLD')!;
    expect(old).toMatchObject({ side: 'SELL', quantityOrAmountCents: 50_000, targetWeightPercent: 0 });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=assemble-packet
```

Expected: FAIL — current code always emits side='BUY' with `targetWeight × portfolioValueCents`.

- [ ] **Step 3: Replace the `proposedTrades` computation**

In `assemble-packet.ts`, replace the existing `const proposedTrades = allocationsArray.map(...)` block with:

```ts
const targets = indexTargets(allocationsArray);
const current = indexCurrent(currentPositions);

interface TradeCandidate {
  symbol: string;
  assetClass: string;
  side: 'BUY' | 'SELL';
  quantityOrAmountCents: number;
  targetWeightPercent: number;
  rationale: string;
}

const candidates: TradeCandidate[] = [];

// Pass 1: every target symbol.
for (const [symbol, target] of targets) {
  const targetCents = Math.round(target.targetWeight * portfolioValueCents);
  const currentCents = current.get(symbol)?.marketValueCents ?? 0;
  const delta = targetCents - currentCents;
  if (delta === 0) continue;
  candidates.push({
    symbol,
    assetClass: target.assetClass,
    side: delta > 0 ? 'BUY' : 'SELL',
    quantityOrAmountCents: Math.abs(delta),
    targetWeightPercent: target.targetWeight * 100,
    rationale: target.rationale,
  });
}

// Pass 2: held symbols not in target → full SELL.
for (const [symbol, pos] of current) {
  if (targets.has(symbol)) continue;
  candidates.push({
    symbol,
    assetClass: 'OTHER',
    side: 'SELL',
    quantityOrAmountCents: pos.marketValueCents,
    targetWeightPercent: 0,
    rationale: 'Liquidating position no longer in target allocation.',
  });
}

const proposedTrades = candidates;   // epsilon filter + ordering applied in Task 11
```

- [ ] **Step 4: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=assemble-packet
```

Expected: PASS for the three new cases.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts \
  services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): AssemblePacket emits delta BUY+SELL trades

Replaces the naive target × portfolioValueCents calculation with a delta
between target and current position market value. SELLs symbols
no longer in target. Initial-build path (currentPositions=[]) remains
correct — every BUY there is targetWeight × portfolioValueCents.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: AssemblePacket — micro-trade filter + deterministic ordering

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/unit/assemble-packet.test.ts`:

```ts
describe('assemble-packet — micro-trade filter + ordering', () => {
  it('drops trades whose quantityOrAmountCents is < 1% of portfolioValueCents', async () => {
    const out = await handler(baseEvent({
      // portfolioValueCents = 100_000_000c ($1M); epsilon = 1_000_000c ($10k).
      ledgerSnapshot: {
        positions: { VTI: { quantity: 1000, lastFillPrice: 200 } },  // 200 * 1000 * 100 = 200_000_000c too big
        cashBalanceCents: 0,
      },
      // Wait — for the test we want a 1M portfolio. Use:
      // 0 cash + 1 share VTI @ $1_000_000 = 100_000_000c portfolio.
      // Easier: explicitly set positions to construct it.
      triggerAmountCents: 0,
      portfolio: { allocations: [
        // VTI target 50.05% of 100M = 50_050_000c; current 100_000_000c.
        // |delta| = |50_050_000 - 100_000_000| = 49_950_000c — easily above epsilon.
        // Bad — this delta is huge. Let's use a smaller drift.
        // Re-target: VTI 99.5% of 100M = 99_500_000c; current 100_000_000c.
        // delta = -500_000c. Epsilon (1% of 100M) = 1_000_000c. Below → drop.
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.995, rationale: '' },
      ]},
    }));
    // VTI position fully drops; output is empty trades array.
    expect(out.proposedTrades).toEqual([]);
  });

  it('orders SELLs before BUYs, then by symbol ascending', async () => {
    const out = await handler(baseEvent({
      ledgerSnapshot: {
        positions: {
          AAA: { quantity: 100, lastFillPrice: 100 },   // 1_000_000c
          ZZZ: { quantity: 100, lastFillPrice: 100 },   // 1_000_000c
        },
        cashBalanceCents: 10_000_000,                   // portfolioValue = 12_000_000c
      },
      triggerAmountCents: 0,
      portfolio: { allocations: [
        // VTI target 50% = 6_000_000c, not held → BUY 6_000_000c (above 1% epsilon=120_000c)
        { instrument: 'VTI', assetClass: 'EQUITY', targetWeight: 0.5, rationale: '' },
        // AAA target 25% = 3_000_000c, currentValue 1_000_000c → BUY 2_000_000c
        { instrument: 'AAA', assetClass: 'EQUITY', targetWeight: 0.25, rationale: '' },
        // ZZZ not in target → full SELL 1_000_000c
      ]},
    }));
    const sides = out.proposedTrades.map((t: any) => `${t.side}:${t.symbol}`);
    expect(sides).toEqual(['SELL:ZZZ', 'BUY:AAA', 'BUY:VTI']);
  });
});
```

The first test's setup is contrived — read it carefully: a 1M-share VTI position at $200/share would be $200M, dwarfing any plausible portfolio. The intent: build a $100M total-portfolio scenario where target VTI = 99.5% leaves a $500k delta — below the $1M epsilon → dropped. If the inline math is confusing, restate the scenario in the test comment.

- [ ] **Step 2: Run the test and verify it fails**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=assemble-packet
```

Expected: FAIL — first new case (no filter); ordering case unknown until run.

- [ ] **Step 3: Add the epsilon filter + sort**

In `assemble-packet.ts`, at the top of the file add:

```ts
import { MICRO_TRADE_EPSILON_BPS } from '../trade-thresholds';
```

Replace the line `const proposedTrades = candidates;` (from Task 10) with:

```ts
const epsilonCents = Math.round(
  (portfolioValueCents * MICRO_TRADE_EPSILON_BPS) / 10_000,
);
const sideRank = (side: 'BUY' | 'SELL') => (side === 'SELL' ? 0 : 1);
const proposedTrades = candidates
  .filter((t) => t.quantityOrAmountCents >= epsilonCents)
  .sort((a, b) => sideRank(a.side) - sideRank(b.side) || a.symbol.localeCompare(b.symbol));
```

- [ ] **Step 4: Re-run the test and verify it passes**

```bash
pnpm nx test decision-workflow-ctrl --testPathPatterns=assemble-packet
```

Expected: both new cases PASS. Re-run the full assemble-packet suite — all earlier cases (Tasks 8-10) should still PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts \
  services/advisory/decision-workflow-ctrl/test/unit/assemble-packet.test.ts
git commit -m "$(cat <<'EOF'
feat(decision-workflow-ctrl): AssemblePacket filters micro-trades + sorts

Drops trades whose absolute delta is < 1% of portfolioValueCents
(MICRO_TRADE_EPSILON_BPS = 100). Sorts SELLs first then BUYs, then by
symbol — gives compliance + integration tests deterministic ordering
to assert against without flake.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: DWC integration test — `LedgerSnapshot` projection materialises

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 1: Locate the existing snapshot-projection test pattern**

```bash
grep -n "SnapshotProjector\|INVESTOR_PROFILE_SNAPSHOT_CREATED\|projectIpSnapshot\|getProjectedSnapshot" \
  services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts | head
```

Note the helpers the file uses to (a) emit synthetic events and (b) poll DDB for the projection. The existing IP snapshot test serves as the template.

- [ ] **Step 2: Add the failing test**

Append after the existing snapshot-projection block:

```ts
describe('LedgerSnapshot projection', () => {
  it('materialises a LedgerSnapshot row from PORTFOLIO_UPDATED', async () => {
    await ctx.eventBridge.publish({
      busName: ctx.busNames.advisory,
      source: 'integration-test:decision-workflow-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        id: 'evt-1',
        type: 'PORTFOLIO_UPDATED',
        timestamp: new Date().toISOString(),
        subject: {
          tenantId: ctx.tenantId,
          streamType: 'CASH',
          snapshot: {
            positions: { VTI: { quantity: 10, lastFillPrice: 200 } },
            cashBalanceCents: 500_000,
            lastEventSequence: 1,
          },
        },
        context: { tenantId: ctx.tenantId, userId: ctx.tenantId, region: 'us-east-1' },
      },
    });

    const row = await ctx.dynamo.waitForItem({
      table: ctx.tables.decisionWorkflowState,
      key: { pk: `LedgerSnapshot#${ctx.tenantId}`, sk: 'LedgerSnapshot' },
      timeoutMs: 60_000,
    });
    expect(row).toBeDefined();
    expect(row!.tenantId).toBe(ctx.tenantId);
    expect(row!.lastEventSequence).toBe(1);
    const parsed = JSON.parse(row!.state);
    expect(parsed.positions.VTI.quantity).toBe(10);
    expect(parsed.cashBalanceCents).toBe(500_000);
  });
});
```

The exact helper names (`ctx.eventBridge.publish`, `ctx.dynamo.waitForItem`, `ctx.busNames.advisory`, `ctx.tables.decisionWorkflowState`) follow the **existing patterns in the same file**. Read the file's top section once and adapt the call shapes to match.

- [ ] **Step 3: Run the test against deployed dev (will fail — code isn't deployed yet)**

```bash
pnpm nx run decision-workflow-ctrl:test-integration --testPathPatterns=decision-workflow-ctrl.integration
```

Expected: FAIL — `waitForItem` times out because dev still runs the pre-deploy code. **This is correct TDD ordering** — we add the test now; the test passes after the deploy in Task 19.

- [ ] **Step 4: Commit the failing test**

```bash
git add services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
git commit -m "$(cat <<'EOF'
test(decision-workflow-ctrl): integration test for LedgerSnapshot projection

Asserts that emitting PORTFOLIO_UPDATED to advisoryBus materialises a
LedgerSnapshot DDB row via the SnapshotProjectorIngress. Will fail
against dev until Task 19's deploy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: DWC integration test — repeated `PORTFOLIO_UPDATED` upserts row

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the same `describe('LedgerSnapshot projection', ...)` block:

```ts
it('repeated PORTFOLIO_UPDATED for the same tenant upserts (last write wins)', async () => {
  // First event — seq=5.
  await ctx.eventBridge.publish({
    busName: ctx.busNames.advisory,
    source: 'integration-test:decision-workflow-ctrl',
    detailType: 'PORTFOLIO_UPDATED',
    detail: {
      id: 'evt-2a',
      type: 'PORTFOLIO_UPDATED',
      timestamp: new Date().toISOString(),
      subject: {
        tenantId: ctx.tenantId,
        snapshot: { positions: { VTI: { quantity: 5, lastFillPrice: 100 } }, cashBalanceCents: 100_000, lastEventSequence: 5 },
      },
      context: { tenantId: ctx.tenantId, userId: ctx.tenantId, region: 'us-east-1' },
    },
  });
  await ctx.dynamo.waitForItem({
    table: ctx.tables.decisionWorkflowState,
    key: { pk: `LedgerSnapshot#${ctx.tenantId}`, sk: 'LedgerSnapshot' },
    predicate: (item) => item.lastEventSequence === 5,
    timeoutMs: 60_000,
  });

  // Second event — seq=7. Last write wins (no late-arrival guard today).
  await ctx.eventBridge.publish({
    busName: ctx.busNames.advisory,
    source: 'integration-test:decision-workflow-ctrl',
    detailType: 'PORTFOLIO_UPDATED',
    detail: {
      id: 'evt-2b',
      type: 'PORTFOLIO_UPDATED',
      timestamp: new Date().toISOString(),
      subject: {
        tenantId: ctx.tenantId,
        snapshot: { positions: { VTI: { quantity: 10, lastFillPrice: 100 } }, cashBalanceCents: 200_000, lastEventSequence: 7 },
      },
      context: { tenantId: ctx.tenantId, userId: ctx.tenantId, region: 'us-east-1' },
    },
  });
  const row = await ctx.dynamo.waitForItem({
    table: ctx.tables.decisionWorkflowState,
    key: { pk: `LedgerSnapshot#${ctx.tenantId}`, sk: 'LedgerSnapshot' },
    predicate: (item) => item.lastEventSequence === 7,
    timeoutMs: 60_000,
  });
  expect(JSON.parse(row!.state).cashBalanceCents).toBe(200_000);
});
```

If `waitForItem` doesn't take a `predicate` callback today, use the existing pattern in the file (likely a poll-then-assert idiom) and adapt.

- [ ] **Step 2: Commit the failing test**

```bash
git add services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
git commit -m "$(cat <<'EOF'
test(decision-workflow-ctrl): assert PORTFOLIO_UPDATED upsert behaviour

Confirms that two PORTFOLIO_UPDATED events for the same tenant result
in last-write-wins. Documents that there is no lastEventSequence guard
today — see ferry-ledger spec §"Late-arrival behaviour".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: DWC integration test — SF carries `ledgerSnapshot` into `AssemblePacket` payload

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 1: Find the existing SF-trigger pattern**

```bash
grep -n "PORTFOLIO_DRIFT_DETECTED\|startsSfOn\|assemblePacket" \
  services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts | head
```

The file already has a test that starts the SF via `PORTFOLIO_DRIFT_DETECTED`. We extend that idiom.

- [ ] **Step 2: Add the failing test**

Append:

```ts
describe('SF reads ledgerSnapshot into AssemblePacket payload', () => {
  it('AssemblePacket Lambda is invoked with ledgerSnapshot from the projection', async () => {
    // 1. Seed projection.
    await ctx.eventBridge.publish({
      busName: ctx.busNames.advisory,
      source: 'integration-test:decision-workflow-ctrl',
      detailType: 'PORTFOLIO_UPDATED',
      detail: {
        id: 'evt-3a',
        type: 'PORTFOLIO_UPDATED',
        timestamp: new Date().toISOString(),
        subject: {
          tenantId: ctx.tenantId,
          snapshot: { positions: { VTI: { quantity: 7, lastFillPrice: 150 } }, cashBalanceCents: 250_000, lastEventSequence: 1 },
        },
        context: { tenantId: ctx.tenantId, userId: ctx.tenantId, region: 'us-east-1' },
      },
    });
    await ctx.dynamo.waitForItem({
      table: ctx.tables.decisionWorkflowState,
      key: { pk: `LedgerSnapshot#${ctx.tenantId}`, sk: 'LedgerSnapshot' },
      timeoutMs: 60_000,
    });

    // 2. Start SF via PORTFOLIO_DRIFT_DETECTED.
    await ctx.eventBridge.publish({
      busName: ctx.busNames.advisory,
      source: 'integration-test:decision-workflow-ctrl',
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
      detail: {
        id: 'evt-3b',
        type: 'PORTFOLIO_DRIFT_DETECTED',
        timestamp: new Date().toISOString(),
        subject: { tenantId: ctx.tenantId, userId: ctx.tenantId },
        context: { tenantId: ctx.tenantId, userId: ctx.tenantId, region: 'us-east-1' },
      },
    });

    // 3. Wait for a DecisionPacket row — AssemblePacket persisted it, which
    //    is downstream proof that the Lambda ran with valid ledgerSnapshot
    //    input (it would have thrown on undefined ledgerSnapshot before this fix).
    const decisionRow = await ctx.dynamo.waitForItem({
      table: ctx.tables.decisionWorkflowState,
      keyPrefix: { pk: `DecisionPacket#${ctx.tenantId}`, sk: 'DecisionPacket#' },
      timeoutMs: 180_000,
    });
    expect(decisionRow).toBeDefined();
    // currentPositions on the packet reflects the projected ledger state.
    const positions = decisionRow!.currentPositions ?? [];
    expect(positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: 'VTI', quantity: 7 }),
    ]));
  });
});
```

If `waitForItem` doesn't natively support `keyPrefix`, fall back to a `scanTable`+filter helper from `@nestfolio/test-support`. Reuse whatever the file already does for DecisionPacket assertions.

- [ ] **Step 2: Commit the failing test**

```bash
git add services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
git commit -m "$(cat <<'EOF'
test(decision-workflow-ctrl): SF threads ledgerSnapshot into AssemblePacket

End-to-end integration assertion that the projection → SF GetItem → Lambda
payload chain carries the LedgerSnapshot through, and that AssemblePacket
persists a DecisionPacket with currentPositions reflecting real ledger state.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: DWC integration test — absent `LedgerSnapshot` tolerated by SF

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`

- [ ] **Step 1: Add the failing test**

Append:

```ts
it('SF treats absent LedgerSnapshot as initial-build (no projection seeded first)', async () => {
  // No PORTFOLIO_UPDATED ahead of time. Trigger the SF directly.
  await ctx.eventBridge.publish({
    busName: ctx.busNames.advisory,
    source: 'integration-test:decision-workflow-ctrl',
    detailType: 'DEPOSIT_DETECTED',
    detail: {
      id: 'evt-4a',
      type: 'DEPOSIT_DETECTED',
      timestamp: new Date().toISOString(),
      subject: { tenantId: ctx.tenantId, userId: ctx.tenantId, amountCents: 100_000 },
      context: { tenantId: ctx.tenantId, userId: ctx.tenantId, region: 'us-east-1' },
    },
  });
  const decisionRow = await ctx.dynamo.waitForItem({
    table: ctx.tables.decisionWorkflowState,
    keyPrefix: { pk: `DecisionPacket#${ctx.tenantId}`, sk: 'DecisionPacket#' },
    timeoutMs: 180_000,
  });
  // currentPositions empty; isInitialBuild true.
  expect(decisionRow!.currentPositions ?? []).toEqual([]);
  expect(decisionRow!.isInitialBuild).toBe(true);
});
```

- [ ] **Step 2: Commit the failing test**

```bash
git add services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts
git commit -m "$(cat <<'EOF'
test(decision-workflow-ctrl): SF tolerates absent LedgerSnapshot row

Proves that a trigger without a prior PORTFOLIO_UPDATED falls through
to HandleMissingLedgerSnapshot and the resulting DecisionPacket reflects
initial-build state. Guards against the regression where uncatchable
States.Runtime is raised on missing item — see feedback-states-runtime-uncatchable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Compliance integration test — `MAX_SINGLE_TRADE` fires in steady state

**Files:**
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

- [ ] **Step 1: Find the existing compliance assertion pattern**

```bash
grep -n "RECOMMENDATION_PROPOSED\|DECISION_BLOCKED\|MAX_SINGLE_TRADE\|isInitialBuild" \
  services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts | head -20
```

Use whatever the file already does to (a) emit `RECOMMENDATION_PROPOSED` with subject fields and (b) trap `DECISION_BLOCKED` / `DECISION_APPROVED` follow-up events.

- [ ] **Step 2: Add the failing test**

Append:

```ts
describe('Steady-state guardrails — MAX_SINGLE_TRADE', () => {
  it('BLOCKS a decision when a single trade exceeds maxSingleTradePercent in steady state', async () => {
    // Seed MandateSnapshot (BALANCED mode → cap 10%) using the file's existing helper.
    await seedMandateSnapshot(ctx, { operatingMode: 'BALANCED' });

    // Emit RECOMMENDATION_PROPOSED with isInitialBuild=false + a 30% trade.
    await ctx.eventBridge.publish({
      busName: ctx.busNames.advisory,
      source: 'integration-test:compliance-ctrl',
      detailType: 'RECOMMENDATION_PROPOSED',
      detail: {
        id: 'rec-1',
        type: 'RECOMMENDATION_PROPOSED',
        timestamp: new Date().toISOString(),
        subject: {
          decisionId: 'd-1',
          tenantId: ctx.tenantId,
          userId: ctx.tenantId,
          taskToken: 'tok-1',
          awaitingCompliance: true,
          isInitialBuild: false,
          portfolioValueCents: 100_000_00,
          riskCategory: 'MODERATE',
          currentPositions: [{ symbol: 'VTI', quantity: 100, marketValueCents: 50_000_00 }],
          proposedTrades: [
            { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 30_000_00, targetWeightPercent: 80, rationale: '' },
          ],
        },
        context: { tenantId: ctx.tenantId, userId: ctx.tenantId, region: 'us-east-1' },
      },
    });

    const blocked = await ctx.eventTrap.waitForEvent({
      detailType: 'DECISION_BLOCKED',
      predicate: (e) => e.subject?.decisionId === 'd-1',
      timeoutMs: 60_000,
    });
    expect(blocked.subject.violatedRules).toEqual(expect.arrayContaining(['MAX_SINGLE_TRADE']));
  });
});
```

Adjust `seedMandateSnapshot` + `ctx.eventTrap.waitForEvent` to the names the file already uses.

- [ ] **Step 3: Commit the failing test**

```bash
git add services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts
git commit -m "$(cat <<'EOF'
test(compliance-ctrl): MAX_SINGLE_TRADE fires under steady-state input

isInitialBuild=false + a trade above the BALANCED 10% cap → DECISION_BLOCKED.
Proves the post-ferry-ledger steady-state regime correctly engages the
guardrails that the initial-build skip path disables today.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Compliance integration test — `TURNOVER_CAP` fires in steady state

**Files:**
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `Steady-state guardrails` describe block:

```ts
it('BLOCKS when sum of trade absolute values exceeds monthlyTurnoverCapPercent', async () => {
  await seedMandateSnapshot(ctx, { operatingMode: 'BALANCED' });   // cap 25%
  await ctx.eventBridge.publish({
    busName: ctx.busNames.advisory,
    source: 'integration-test:compliance-ctrl',
    detailType: 'RECOMMENDATION_PROPOSED',
    detail: {
      id: 'rec-2',
      type: 'RECOMMENDATION_PROPOSED',
      timestamp: new Date().toISOString(),
      subject: {
        decisionId: 'd-2',
        tenantId: ctx.tenantId,
        userId: ctx.tenantId,
        taskToken: 'tok-2',
        awaitingCompliance: true,
        isInitialBuild: false,
        portfolioValueCents: 100_000_00,
        riskCategory: 'MODERATE',
        currentPositions: [{ symbol: 'VTI', quantity: 100, marketValueCents: 50_000_00 }],
        proposedTrades: [
          // Each trade at 9% (below MAX_SINGLE_TRADE). Sum 36% (above 25% turnover cap).
          { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 9_000_00, targetWeightPercent: 59, rationale: '' },
          { symbol: 'BND', assetClass: 'FIXED_INCOME', side: 'SELL', quantityOrAmountCents: 9_000_00, targetWeightPercent: 16, rationale: '' },
          { symbol: 'SHY', assetClass: 'FIXED_INCOME', side: 'BUY', quantityOrAmountCents: 9_000_00, targetWeightPercent: 9, rationale: '' },
          { symbol: 'GLD', assetClass: 'COMMODITY', side: 'BUY', quantityOrAmountCents: 9_000_00, targetWeightPercent: 9, rationale: '' },
        ],
      },
      context: { tenantId: ctx.tenantId, userId: ctx.tenantId, region: 'us-east-1' },
    },
  });

  const blocked = await ctx.eventTrap.waitForEvent({
    detailType: 'DECISION_BLOCKED',
    predicate: (e) => e.subject?.decisionId === 'd-2',
    timeoutMs: 60_000,
  });
  expect(blocked.subject.violatedRules).toEqual(expect.arrayContaining(['TURNOVER_CAP']));
});
```

- [ ] **Step 2: Commit**

```bash
git add services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts
git commit -m "$(cat <<'EOF'
test(compliance-ctrl): TURNOVER_CAP fires under steady-state input

Sum of |trade.quantityOrAmountCents| at 36% of portfolio > 25% BALANCED
turnover cap → DECISION_BLOCKED. Complements the MAX_SINGLE_TRADE case.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Compliance integration test — initial-build skip preserved (regression guard)

**Files:**
- Modify: `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`

- [ ] **Step 1: Add the failing test**

Append:

```ts
it('APPROVES the same oversized trades when isInitialBuild=true (skip path preserved)', async () => {
  await seedMandateSnapshot(ctx, { operatingMode: 'BALANCED' });
  await ctx.eventBridge.publish({
    busName: ctx.busNames.advisory,
    source: 'integration-test:compliance-ctrl',
    detailType: 'RECOMMENDATION_PROPOSED',
    detail: {
      id: 'rec-3',
      type: 'RECOMMENDATION_PROPOSED',
      timestamp: new Date().toISOString(),
      subject: {
        decisionId: 'd-3',
        tenantId: ctx.tenantId,
        userId: ctx.tenantId,
        taskToken: 'tok-3',
        awaitingCompliance: true,
        isInitialBuild: true,
        portfolioValueCents: 100_000_00,
        riskCategory: 'MODERATE',
        currentPositions: [],
        proposedTrades: [
          { symbol: 'VTI', assetClass: 'EQUITY', side: 'BUY', quantityOrAmountCents: 30_000_00, targetWeightPercent: 30, rationale: '' },
        ],
      },
      context: { tenantId: ctx.tenantId, userId: ctx.tenantId, region: 'us-east-1' },
    },
  });

  const approved = await ctx.eventTrap.waitForEvent({
    detailType: 'DECISION_APPROVED',
    predicate: (e) => e.subject?.decisionId === 'd-3',
    timeoutMs: 60_000,
  });
  expect(approved).toBeDefined();
});
```

- [ ] **Step 2: Commit**

```bash
git add services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts
git commit -m "$(cat <<'EOF'
test(compliance-ctrl): initial-build skip path still active (regression guard)

Identical oversized trades that block at isInitialBuild=false ARE approved
at isInitialBuild=true. Preserves the existing first-deposit behaviour
documented in the decision-pipeline-units-calibration-suitability spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 19: Deploy + run integration tests against dev

**Files:** (no source changes — deploy + execute)

- [ ] **Step 1: Run `nx affected` unit + lint as a pre-deploy gate**

```bash
pnpm nx affected -t test,lint --base=origin/main
```

Expected: all PASS.

- [ ] **Step 2: Deploy decision-workflow-ctrl + compliance-ctrl to dev**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,compliance-ctrl | tee /tmp/deploy-ferry-ledger.log
```

Expected: stack updates complete; no Lambda or SF state-machine deploy errors. Capture the log line `✓ Deployed dev-decision-workflow-ctrl` etc.

- [ ] **Step 3: Run the DWC + compliance integration tests against dev**

```bash
pnpm nx run decision-workflow-ctrl:test-integration --testPathPatterns=decision-workflow-ctrl.integration
pnpm nx run compliance-ctrl:test-integration --testPathPatterns=compliance-ctrl.integration
```

Expected: all four new DWC cases + three new compliance cases PASS.

If any fail, **do not band-aid the test** — investigate the actual failure. Common causes: wrong source filter (Tasks 12-15 emit with `source: 'integration-test:decision-workflow-ctrl'`; verify it matches the projector ingress $or); test envelope shape mismatch with what the projector reads (re-check Task 2's projector). Per [[feedback-flake-means-broken]], a rerun-pass after a fail is not evidence of greenness; pull CloudWatch from the failing window.

- [ ] **Step 4: Commit nothing — deploy artefacts are not git-tracked**

Move on to Task 20.

---

## Task 20: Add `data-testid` attributes to advisory-mfe components

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision/trades-table.component.ts`
- Modify: `apps/advisory-mfe/src/app/decision/decision-detail.component.ts`

- [ ] **Step 1: Inspect existing decision-detail template**

```bash
sed -n '1,80p' apps/advisory-mfe/src/app/decision/decision-detail.component.ts
```

Find where the `isInitialBuild` boolean is available — it may already be in the GraphQL response. If not, the Playwright assertion can't depend on this field today; instead add a UI element whose visibility is driven by `isInitialBuild` (which already lands on the `DecisionPacket` per Task 8 + Task 14).

- [ ] **Step 2: Add `data-testid="proposed-trade"` to trade rows**

In `apps/advisory-mfe/src/app/decision/trades-table.component.ts`, modify the `<tr>` inside the `@for (trade of trades(); track trade.symbol)` loop:

```html
<tr [attr.data-testid]="'proposed-trade'">
  <!-- ...existing cells unchanged... -->
</tr>
```

- [ ] **Step 3: Add `rebalance-badge` element to decision-detail**

In `apps/advisory-mfe/src/app/decision/decision-detail.component.ts`, add the element near the top of the detail body, gated on the `isInitialBuild === false` predicate. Example structure (adapt to the file's existing signals + template style):

```html
@if (decision()?.isInitialBuild === false) {
  <span class="rebalance-badge" data-testid="rebalance-badge">
    {{ 'advisory.detail.rebalanceBadge' | translate }}
  </span>
}
```

If `decision().isInitialBuild` is not yet on the GraphQL response shape, **stop and add it**: in `services/advisory/advisory-bff/src/schema.graphql` add `isInitialBuild: Boolean!` to the relevant Decision type; update the JS resolver to project it from the DDB row; regenerate the codegen types under `apps/advisory-mfe/src/generated/`. Treat this as a sub-task — commit it separately with title `feat(advisory-bff): expose isInitialBuild on Decision`.

Add a translation entry (`apps/advisory-mfe/src/assets/i18n/<locale>.json`) for `advisory.detail.rebalanceBadge` — value `"Rebalance"`.

- [ ] **Step 4: Verify the changes locally**

```bash
pnpm nx run advisory-mfe:build
```

Expected: build succeeds.

If you wired the BFF schema change, also redeploy advisory-bff:

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff,advisory-mfe
```

Expected: deploys clean. Skip the BFF step if the field already exists.

- [ ] **Step 5: Commit**

```bash
git add apps/advisory-mfe/src/app/decision/trades-table.component.ts \
  apps/advisory-mfe/src/app/decision/decision-detail.component.ts \
  apps/advisory-mfe/src/assets/i18n
# Plus any BFF + codegen files touched in Step 3.
git commit -m "$(cat <<'EOF'
feat(advisory-mfe): add proposed-trade + rebalance-badge testids

Surfaces a visible rebalance affordance when isInitialBuild=false and
tags every proposed-trade row with data-testid="proposed-trade" so the
Playwright steady-state scenario can assert BUY+SELL coverage and
distinguish rebalance from initial-build decisions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 21: Create Playwright fixtures — `inject-portfolio-updated.ts` + `wait-for-ledger-snapshot.ts`

**Files:**
- Create: `apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts`
- Create: `apps/nestfolio-e2e/src/fixtures/wait-for-ledger-snapshot.ts`

- [ ] **Step 1: Read `inject-advisory-update.ts` for the existing emit pattern**

```bash
sed -n '1,80p' apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts
```

Match its exact shape — same `TestContext`, same SigV4 EventBridge client wiring, same envelope.

- [ ] **Step 2: Write `inject-portfolio-updated.ts`**

```ts
import { type TestContext } from '@nestfolio/test-support';
import { type FreshTenant } from '@nestfolio/e2e-feature-tests';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

interface PortfolioUpdatedShape {
  positions: Record<string, { quantity: number; lastFillPrice: number }>;
  cashBalanceCents: number;
  lastEventSequence?: number;
}

/**
 * Emits a synthetic PORTFOLIO_UPDATED to advisoryBus with
 * `source: 'integration-test:decision-workflow-ctrl'` — matches the
 * SnapshotProjectorIngress $or filter so the projection materialises
 * without going through the real ledger → adapter chain.
 */
export async function injectPortfolioUpdated(
  ctx: TestContext,
  tenant: FreshTenant,
  body: PortfolioUpdatedShape,
): Promise<void> {
  const client = new EventBridgeClient({ region: ctx.region });
  const eventId = `pw-portfolio-updated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await client.send(new PutEventsCommand({
    Entries: [{
      EventBusName: ctx.busNames.advisory,
      Source: 'integration-test:decision-workflow-ctrl',
      DetailType: 'PORTFOLIO_UPDATED',
      Detail: JSON.stringify({
        id: eventId,
        type: 'PORTFOLIO_UPDATED',
        timestamp: new Date().toISOString(),
        subject: {
          tenantId: tenant.tenantId,
          streamType: 'CASH',
          snapshot: {
            positions: body.positions,
            cashBalanceCents: body.cashBalanceCents,
            lastEventSequence: body.lastEventSequence ?? 1,
          },
        },
        context: { tenantId: tenant.tenantId, userId: tenant.userId, region: ctx.region },
      }),
    }],
  }));
}
```

- [ ] **Step 3: Write `wait-for-ledger-snapshot.ts`**

```ts
import { type TestContext } from '@nestfolio/test-support';
import { type FreshTenant } from '@nestfolio/e2e-feature-tests';

const POLL_INTERVAL_MS = 2_000;

interface Options {
  timeoutMs?: number;
}

export async function waitForLedgerSnapshotRow(
  ctx: TestContext,
  tenant: FreshTenant,
  options: Options = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const item = await ctx.dynamo.getItem({
      table: ctx.tables.decisionWorkflowState,
      key: { pk: `LedgerSnapshot#${tenant.tenantId}`, sk: 'LedgerSnapshot' },
    });
    if (item?.state) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `waitForLedgerSnapshotRow: no row for tenant=${tenant.tenantId} after ${timeoutMs}ms`,
  );
}
```

The exact `ctx.dynamo.getItem` / `ctx.tables.decisionWorkflowState` accessor names mirror what `wait-for-advisory-projection.ts` already uses; align with that file's style.

- [ ] **Step 4: Run the e2e app's type-check to catch import drift**

```bash
pnpm nx run nestfolio-e2e:lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/nestfolio-e2e/src/fixtures/inject-portfolio-updated.ts \
  apps/nestfolio-e2e/src/fixtures/wait-for-ledger-snapshot.ts
git commit -m "$(cat <<'EOF'
test(nestfolio-e2e): fixtures for steady-state rebalance scenarios

injectPortfolioUpdated emits a synthetic PORTFOLIO_UPDATED to advisoryBus
so the ferry-ledger projection materialises without driving the real
ledger chain. waitForLedgerSnapshotRow polls DDB to gate downstream
steps on projection completion.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 22: Add Playwright scenario — `rebalance-trades-on-drift.spec.ts`

**Files:**
- Create: `apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts`

- [ ] **Step 1: Read the existing scenario for shape reference**

```bash
sed -n '1,60p' apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts
```

Mirror its overall structure (`test.describe` + `onboardedPage` fixture + inject + assert).

- [ ] **Step 2: Write the scenario**

```ts
import { test, expect } from '../fixtures/test';
import { injectAdvisoryBffTriggerEvent } from '../fixtures/inject-advisory-update';
import { injectPortfolioUpdated } from '../fixtures/inject-portfolio-updated';
import { waitForLedgerSnapshotRow } from '../fixtures/wait-for-ledger-snapshot';

test.describe('steady-state rebalance', () => {
  /**
   * Verify the /advisory page renders BUY+SELL delta trades when the SF
   * runs against a tenant with existing ledger positions (steady state).
   *
   * Scope: this scenario uses synthetic event injection to short-circuit
   * the ledger → adapter chain. The chain itself is covered by the DWC
   * integration tests. The PW scenario exists purely to assert the UI
   * surfaces delta trades + the rebalance badge correctly.
   */
  test('UI renders BUY+SELL delta trades + rebalance badge on PORTFOLIO_DRIFT_DETECTED', async ({
    ctx,
    tenant,
    onboardedPage,
  }) => {
    // 1. Seed LedgerSnapshot projection so the SF reads non-empty positions.
    await injectPortfolioUpdated(ctx, tenant, {
      positions: {
        VTI: { quantity: 100, lastFillPrice: 200 },   // 2_000_000c
        BND: { quantity: 50, lastFillPrice: 80 },     //   400_000c
      },
      cashBalanceCents: 100_000,                       // portfolioValue 2_500_000c
    });
    await waitForLedgerSnapshotRow(ctx, tenant, { timeoutMs: 60_000 });

    // 2. Trigger the SF via PORTFOLIO_DRIFT_DETECTED. AssemblePacket will see
    //    real positions + cash, derive isInitialBuild=false, and emit delta trades.
    await injectAdvisoryBffTriggerEvent(ctx, tenant, {
      detailType: 'PORTFOLIO_DRIFT_DETECTED',
    });

    // 3. Navigate to /advisory; wait for the decision card. Generous timeout
    //    because the agent pipeline (PE + AN) is on the critical path.
    await onboardedPage.goto('/advisory');
    const decisionCard = onboardedPage
      .locator('[data-testid^="decision-"]')
      .first();
    await expect(decisionCard).toBeVisible({ timeout: 120_000 });

    // 4. Assert BUY+SELL trade rows + rebalance badge.
    const tradeRows = onboardedPage.locator('[data-testid="proposed-trade"]');
    await expect(tradeRows).not.toHaveCount(0);
    const sides = await tradeRows.locator('.side-tag').allInnerTexts();
    expect(sides.some((s) => s.trim() === 'BUY')).toBe(true);
    expect(sides.some((s) => s.trim() === 'SELL')).toBe(true);
    await expect(onboardedPage.locator('[data-testid="rebalance-badge"]')).toBeVisible();
  });
});
```

If the file's existing scenarios use a different selector style for trades (e.g. they target specific text content), follow that idiom — but the `data-testid` approach from Task 20 is the canonical one.

- [ ] **Step 3: Lint the file**

```bash
pnpm nx run nestfolio-e2e:lint
```

Expected: clean.

- [ ] **Step 4: Run the scenario against deployed dev TWICE (per `feedback-flake-means-broken`)**

```bash
pnpm nx run nestfolio-e2e:e2e --testNamePattern="rebalance-trades-on-drift"
pnpm nx run nestfolio-e2e:e2e --testNamePattern="rebalance-trades-on-drift"
```

Expected: PASS both runs.

If the first run passes but the second fails (or vice versa), do NOT proceed — pull CloudWatch logs from the failing window for `dev-decision-workflow-ctrl-snapshot-projector-ingress` + the SF execution history, identify the root cause, and either fix the code or surface it as a backlog item per [[feedback-flake-means-broken]]. A single passing run is not evidence of greenness.

- [ ] **Step 5: Commit**

```bash
git add apps/nestfolio-e2e/src/scenarios/rebalance-trades-on-drift.spec.ts
git commit -m "$(cat <<'EOF'
test(nestfolio-e2e): steady-state rebalance UI scenario

PW scenario asserts the /advisory page renders BUY+SELL delta trade
rows and a rebalance-badge when the decision-workflow SF runs against
non-empty positions. Uses synthetic event injection — the real
ledger → adapter chain is covered by DWC integration tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Add `apps/nestfolio-e2e/CLAUDE.md` convention doc

**Files:**
- Create: `apps/nestfolio-e2e/CLAUDE.md`

- [ ] **Step 1: Write the convention doc**

Write `apps/nestfolio-e2e/CLAUDE.md`:

```markdown
# nestfolio-e2e — Playwright conventions

This app holds the Playwright end-to-end suite for the investor PWA.
It is **complementary** to `apps/e2e-feature-tests` (which exercises
per-domain backend flows via GraphQL); Playwright only proves
assertions that require a real browser driving the real UI.

## Folder split

- `journeys/` — flows where the *user-driven sequence itself* is what's
  being tested (today: the onboarding wizard). Each journey pays the
  wizard-driving cost (≈30–60 s of agent calls). Use `authedPage` and
  drive the wizard end-to-end.
- `scenarios/` — narrow UX/state assertions for any surface *post*
  onboarding. Use `onboardedPage` (skips the wizard via
  localStorage seed) and inject events synthetically via
  `fixtures/inject-*.ts`. Each scenario should run in seconds, not minutes.

**Default to `scenarios/`.** Only put a test in `journeys/` if the
wizard or a multi-feature user-driven sequence IS the test surface.

## Fixture choices

| Fixture | When |
|---------|------|
| `authedPage` | Wizard test or anywhere onboarding must run for real. |
| `onboardedPage` | Anything after onboarding — dashboard, advisory, ledger surfaces. |

## What backend state-setup belongs in PW

Only the state that's hard or slow to reach via direct API.
Default: inject the carrier event via `fixtures/inject-*.ts` rather
than driving the full user-facing chain.

What does NOT belong in PW:
- Asserting "EventBridge delivered the event" — that's an integration
  test in the producing service.
- Asserting "this DDB write happened" — same.
- Asserting "compliance fired rule X" — same.

PW is for: "given the system has reached state X, does the UI render Y."

## Event-injection $or filter

Synthetic events sent to a domain bus must carry
`source: 'integration-test:<consumer-service>'` so they pass the consumer's
$or filter (see `services/*/src/service.stack.ts` for the
`integration-test:` prefix handling). Reuse `inject-advisory-update.ts`
as the canonical reference.

## Anti-flake discipline

Every scenario must pass twice consecutively on `nestfolio-e2e:e2e`
before being declared green. A rerun-pass after a fail is not evidence
of greenness — see `feedback_flake_means_broken.md`. Pull
CloudWatch logs from the failing window before parking.

## Adding a new scenario

1. Decide: does this need the wizard? If yes → `journeys/`. If no →
   `scenarios/`.
2. Pick the fixture (`authedPage` or `onboardedPage`).
3. If a state setup helper doesn't exist, add it under `fixtures/`.
4. Add the test file under the chosen folder.
5. Run it twice; do not rely on a single passing run.
```

- [ ] **Step 2: Commit**

```bash
git add apps/nestfolio-e2e/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(nestfolio-e2e): codify journeys/ vs scenarios/ convention

Documents the split between flow-driven journeys and inject-and-assert
scenarios, the fixture rules, and the anti-flake discipline so future
PW work picks the right shape without re-deriving from existing files.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 24: Service card regen + LedgerSnapshot row documentation

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/CLAUDE.md`

- [ ] **Step 1: Add `LedgerSnapshot` to the State section**

Open the file. Under `## State`, after the `MarketSnapshot row` bullet, add:

```markdown
  - LedgerSnapshot row (added by SnapshotProjectorIngress). DWC-local mirror of the ledger's per-tenant positions + cashBalanceCents,
    pk=`LedgerSnapshot#{tenantId}`, sk='LedgerSnapshot'. `state` is JSON-stringified to mirror IP/Market projections so the SF parses
    via `States.StringToJson` on read. Used by AssemblePacket to compute portfolioValueCents + delta-based proposedTrades.
```

- [ ] **Step 2: Confirm the Ingress section already lists `PORTFOLIO_UPDATED`** (added in Task 3 Step 6)

```bash
grep -A2 "SnapshotProjectorIngress" services/advisory/decision-workflow-ctrl/CLAUDE.md
```

If `PORTFOLIO_UPDATED` is missing, add it now. If present, skip ahead.

- [ ] **Step 3: Run `backlog-lint` (sanity)**

```bash
node .claude/skills/backlog-lint/lint.mjs
```

Expected: green.

- [ ] **Step 4: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(decision-workflow-ctrl): document LedgerSnapshot state row

Adds the LedgerSnapshot projection row to the service card State
section and confirms the SnapshotProjectorIngress subscription list
includes PORTFOLIO_UPDATED.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 25: Ship the backlog file

**Files:**
- Modify: `docs/backlog/ferry-ledger-positions-to-advisory-steady-state-decisions.md`
- Modify: `docs/BACKLOG.md` (auto-regenerated)

- [ ] **Step 1: Set status + validation_gate**

In the backlog file's frontmatter, change `status: active` → `status: shipped` and fill `validation_gate:`. The validation gate must be **specific, observable evidence** — commit SHAs of the deploy + the runs of the integration tests and the PW scenario (both runs).

Example:

```yaml
status: shipped
validation_gate: |
  - Deploy: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,compliance-ctrl,advisory-bff,advisory-mfe` succeeded (commit <SHA>).
  - DWC integration: `pnpm nx run decision-workflow-ctrl:test-integration --testPathPatterns=decision-workflow-ctrl.integration` → all 4 new cases PASS.
  - Compliance integration: `pnpm nx run compliance-ctrl:test-integration --testPathPatterns=compliance-ctrl.integration` → all 3 new cases PASS.
  - PW scenario: `pnpm nx run nestfolio-e2e:e2e --testNamePattern="rebalance-trades-on-drift"` PASSED on two consecutive runs.
```

Replace `<SHA>` with the actual commit SHA after the deploy.

- [ ] **Step 2: Regen `BACKLOG.md`**

```bash
node .claude/skills/backlog-lint/lint.mjs --fix
```

Expected: green; `docs/BACKLOG.md` regenerated.

- [ ] **Step 3: Commit**

```bash
git add docs/backlog/ferry-ledger-positions-to-advisory-steady-state-decisions.md docs/BACKLOG.md
git commit -m "$(cat <<'EOF'
docs(backlog): ship ferry-ledger-positions-to-advisory

Status active → shipped with validation_gate documenting deploy
commit + integration + PW scenario evidence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Spec coverage:**

- §"Mechanism A" → Tasks 1-6 (data layer + SF state).
- §"Event topology" → consumed (Task 3 subscription).
- §"Projection" → Tasks 1-3.
- §"SF state machine changes" → Tasks 4-6.
- §"AssemblePacket rebalance math" → Tasks 7-11.
- §"Test strategy / DWC integration" → Tasks 12-15.
- §"Test strategy / compliance integration" → Tasks 16-18.
- §"Test strategy / Playwright scenario" → Tasks 20-22.
- §"Convention doc" → Task 23.
- §"Rollout" → Task 19 (deploy gate) + Task 25 (ship gate).
- §"Done definition" → covered across Tasks 11 (math), 14-15 (SF read + tolerance), 16-18 (compliance), 22 (PW).
- §"OQ1 (source filter)" → resolved by Task 21 (`source: 'integration-test:decision-workflow-ctrl'`).
- §"OQ2 (UI testids)" → resolved by Task 20.
- §"OQ3 (constant location)" → resolved by Task 7 (new `trade-thresholds.ts` file).

**Placeholders:** None — every step has explicit code or commands.

**Type consistency:** `currentPositions` shape `{ symbol, quantity, marketValueCents }[]` is used in Tasks 8-11 + 14-18 consistently. `LedgerSnapshot` row stores `state` (JSON-stringified `{positions, cashBalanceCents}`) — consistent across projector (Task 2), SF branch (Task 4), and integration tests (Tasks 12-13). `proposedTrade.side` is `'BUY' | 'SELL'` everywhere. `MICRO_TRADE_EPSILON_BPS = 100` referenced consistently.

**Spec requirement → task mapping (one final pass):**

| Spec requirement | Task |
|---|---|
| `LedgerSnapshot` projection key helpers | 1 |
| Projector function + handler registration | 2 |
| Ingress subscribes to `PORTFOLIO_UPDATED` | 3 |
| SF branch C with absent-row tolerance | 4 |
| `MergeProjections` + pass-through plumbing | 5 |
| `AssembleDecisionPacket` payload carries `ledgerSnapshot` | 6 |
| `MICRO_TRADE_EPSILON_BPS` constant | 7 |
| AssemblePacket reads from `ledgerSnapshot` | 8 |
| Indexing helpers (`indexTargets` + `indexCurrent`) | 9 |
| Delta-based `proposedTrades` (BUY/SELL) | 10 |
| Micro-trade filter + deterministic ordering | 11 |
| DWC integration: projection materialises | 12 |
| DWC integration: upsert behaviour | 13 |
| DWC integration: SF reads + threads | 14 |
| DWC integration: absent-row tolerance | 15 |
| Compliance integration: `MAX_SINGLE_TRADE` | 16 |
| Compliance integration: `TURNOVER_CAP` | 17 |
| Compliance integration: initial-build regression | 18 |
| Deploy + integration validation | 19 |
| UI `data-testid` attributes + rebalance badge | 20 |
| PW fixtures | 21 |
| PW scenario (2× consecutive) | 22 |
| `apps/nestfolio-e2e/CLAUDE.md` convention doc | 23 |
| Service card update | 24 |
| Ship the backlog file | 25 |

No gaps.
