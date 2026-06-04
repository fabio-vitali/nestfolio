# WS-2 — advisory-bff cycle-status projection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** advisory-bff subscribes to the two SF-direct cycle-lifecycle events from WS-1 (`DECISION_CYCLE_STARTED`, `DECISION_CYCLE_FAILED`) and projects a version-guarded `GENERATING`/`FAILED` status onto the `DecisionReadModel` P1 row, so the `/advisory` UI (WS-3) and dashboard (WS-4) gain a correct generating/failed signal before any DecisionPacket exists.

**Architecture:** A new minimal transform (`decision-cycle-status.ts`) maps each cycle event's subject `{ decisionId, tenantId, status, __version }` into `projectVersioned('DecisionReadModel', …)` — `STARTED → GENERATING` (`version 0`), `FAILED → FAILED` (`version 1`). `DecisionReadModel` stays `Projection<'P1'>` (no read-model-ownership change — same typename + intent, only new status *values*). The version guard (`#__version < :version`) makes it order-agnostic + idempotent: the content `DECISION_PACKET_CREATED` CDC (which seeds `__version:1`) cleanly overwrites the `GENERATING` (`v0`) row; a late `STARTED` (`v0`) arriving after a real decision (`v1`) is dropped. The minimal row omits `explanation`/`proposedTrades` by design (a generating/failed cycle has no content yet); the existing `decision-snapshot.ts` degraded-drop defense is untouched and applies only to the content-packet path.

**Tech Stack:** TypeScript, `@nestfolio/event-processor` (`projectVersioned`, `toUow`, `materializeToTable`), AWS CDK (`Ingress` construct), AppSync GraphQL SDL, Jest + `aws-cdk-lib/assertions` `Template`, `@nestfolio/integration-testing` + `@nestfolio/test-support`, Nx.

**Spec:** `docs/superpowers/specs/2026-06-04-advisory-generating-state-design.md` §4, §7.1, §10.

---

## Pre-flight facts (verified against code 2026-06-04)

- **WS-1's events exist and are exported.** `DecisionWorkflowEventTypes.DECISION_CYCLE_STARTED` / `DECISION_CYCLE_FAILED` are in `services/advisory/decision-workflow-ctrl/src/domain/events.ts:20-21`, imported into advisory-bff via the existing `@nestfolio/decision-workflow-ctrl/events` import (already used in `event-listener.ts` + `service.stack.ts`). No new import path.
- **Emitted subject shape (WS-1, `decision-state-machine.ts:344-359` / `716-731`):** `subject = { decisionId, tenantId, status: 'GENERATING'|'FAILED', __version: 0|1 }`; envelope carries `id`, `type`, `timestamp` (`$$.State.EnteredTime`), `context = { tenantId, userId, region }`. **The subject carries NO `createdAt`/`updatedAt`** — the row timestamps must come from the envelope `timestamp` (`uow.event.timestamp`), NOT from `p.timestamp` (the spec §4.2 sketch's `p.timestamp` is wrong: `p` is the subject, which has no `timestamp`).
- **`createdAt` must be supplied in `fields`; `updatedAt` is auto-stamped.** `IntentExecutor.executeProjectVersioned` (`intent-executor.ts:99-105`) builds the item as `{ …pickRequestContext(ctx), …intent.fields, __version: intent.version, updatedAt: ctx.timestamp }`. So `updatedAt` is always overwritten by `ctx.timestamp` (no need to set it, but harmless to include), while `createdAt` is taken from `intent.fields` only. Set `createdAt: uow.event.timestamp` in the transform. (`toUow` sets `event.timestamp = ctx.timestamp`, so `uow.event.timestamp === ctx.timestamp` — both are the envelope timestamp.)
- **The Ingress source filter already accepts SF-direct events.** `Ingress` (`libs/cdk-constructs/src/core/ingress.ts:156-167`) overrides the rule `EventPattern` to `{ $or: [ { 'detail-type': eventTypes, source: [{ 'anything-but': { prefix: 'integration-test:' } }] }, { 'detail-type': eventTypes, source: [{ prefix: 'integration-test:<service>' }] } ] }`. WS-1 emits with `Source: serviceName` (bare `decision-workflow-ctrl`), which matches the first clause (not prefixed `integration-test:`). So **adding the two detail-types to `eventTypes` is sufficient** — no source change. Resolves spec §10's last bullet.
- **`service.stack.test.ts` top-level `detail-type` assertion works** because `addPropertyOverride('EventPattern', { $or: … })` deep-MERGES with the L2-generated `{ 'detail-type': eventTypes }`, so the rendered `EventPattern` contains BOTH a top-level `detail-type: eventTypes` AND `$or`. Updating `eventTypes` to 4 members updates the top-level array; the existing assertion must be widened to the 4-member array (in `eventTypes` order).
- **The DecisionPacket row seeds `__version:1` on insert** (`decision-packet.repository.ts:48`), so the content `DECISION_PACKET_CREATED` CDC carries `version 1` and overwrites `GENERATING` (`v0`); `0 < 1` passes the guard. Resolves the spec §10 version-ladder risk.
- **`FAILED` and content `DECISION_PACKET_CREATED` are mutually exclusive at `v1`** (pre-packet failure ⇒ no packet row), so the `v1` overlap never materializes; if it ever did, the strict guard `#__version < :version` keeps the first writer — never corrupt.
- **SPEC GAP — `DecisionStatus` enum is missing `GENERATING`.** `src/schema.graphql:56-70` lists `…PENDING…FAILED` but NOT `GENERATING`. `decision-publisher.ts` broadcasts every `DecisionReadModel` change via `publishDecisionUpdate($status: DecisionStatus!)`. `broadcastFromStream` **rethrows** on mutation failure (`broadcast-from-stream.ts:52`, at-least-once). A `GENERATING` row would fail AppSync enum validation → poison the `decision-publisher` DDB-stream record (retry 3× via `DynamoEventSource retryAttempts:3`, CloudWatch error flood, shard stall; advisory-bff's `decision-publisher` is a raw `NodejsFunction`, NOT the Broadcaster construct, so no DLQ). **WS-2 MUST add `GENERATING` to the enum** (`FAILED` is already present). This is Task 1.
- **`decision-publisher.mapImage` tolerates a minimal row** (`decision-publisher.ts:91-105`): `explanation: String(item['explanation'] ?? '')`, `proposedTrades: Array.isArray(...) ? ... : []`. A `GENERATING`/`FAILED` row (no explanation/trades) maps to `''`/`[]` — satisfies the non-null `$explanation: String!` / `$proposedTrades: [ProposedTradeInput!]!`. No mapper crash; the ONLY blocker is the enum (Task 1).
- **No `inFlightCount` regression.** `AdvisoryRepository.IN_FLIGHT_STATUSES = ['PENDING','AWAITING_CONFIRMATION']` (`advisory.repository.ts:105`). `GENERATING`/`FAILED` are not in that set, so the `advisory-status-projector` P3 recompute ignores them. Whether the dashboard should *count* generating cycles is explicitly WS-4's decision (spec §6) — **do NOT touch `IN_FLIGHT_STATUSES` here.**
- **No read-model-ownership change.** `DecisionReadModel: Projection<'P1'>` (`read-model-ownership.ts`) already permits `projectVersioned`. The type-test (`test/types/read-model-ownership.type-test.ts`) stays green. The ~6 latent advisory-bff tsc errors were fixed in `dashboard-advisory-readmodel-fixes` (shipped 2026-06-04, on main), so `:typecheck` is clean on this base.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `services/advisory/advisory-bff/src/schema.graphql` | `DecisionStatus` enum | Add `GENERATING` (line 56-70 block) |
| `services/advisory/advisory-bff/src/transforms/decision-cycle-status.ts` | Cycle event → minimal versioned `GENERATING`/`FAILED` row | **Create** |
| `services/advisory/advisory-bff/src/handlers/event-listener.ts` | Wire `CYCLE_STARTED`/`CYCLE_FAILED` → cycle transform | Modify |
| `services/advisory/advisory-bff/src/service.stack.ts` | Add 2 detail-types to Ingress `eventTypes` | Modify (lines 20-31) |
| `services/advisory/advisory-bff/test/unit/transforms/decision-cycle-status.test.ts` | Transform unit test | **Create** |
| `services/advisory/advisory-bff/test/unit/handlers/event-listener.test.ts` | 4 handlers + cycle dispatch | Modify |
| `services/advisory/advisory-bff/test/unit/service.stack.test.ts` | Ingress now 4 detail-types | Modify |
| `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts` | Cycle-status integration tests + header comment | Modify |
| `services/advisory/advisory-bff/CLAUDE.md` | Service card — Ingress + Transforms sections | Modify |

No change to `egress` (DecisionReadModel insert/modify already mapped), `advisory-status-projector`, `decision-publisher` (beyond the enum it consumes), or `read-model-ownership.ts`.

---

## Task 1: Add `GENERATING` to the `DecisionStatus` enum (unblocks the broadcast)

**Why first:** every `GENERATING` row WS-2 writes is broadcast by `decision-publisher` via `publishDecisionUpdate($status: DecisionStatus!)`. Without the enum value the mutation fails AppSync validation and poisons the stream (see pre-flight). There is no `.graphql` unit-test harness; this value is exercised by the Task 5 integration test (a `GENERATING` row materializes AND its broadcast does not error). `FAILED` is already in the enum.

**Files:**
- Modify: `services/advisory/advisory-bff/src/schema.graphql:56-70`

- [ ] **Step 1: Add the enum member**

In `src/schema.graphql`, add `GENERATING` as the first member of `enum DecisionStatus` (it is the pre-packet lifecycle state):

```graphql
enum DecisionStatus {
  GENERATING
  PENDING
  DRAFT
  PROPOSED
  COMPLIANCE_REVIEW
  APPROVED
  BLOCKED
  CONFIRMATION_REQUIRED
  AWAITING_CONFIRMATION
  CONFIRMED
  REJECTED
  EXECUTING
  FILLED
  FAILED
}
```

- [ ] **Step 2: Verify the enum now contains both lifecycle values**

Run: `grep -nE '^\s+(GENERATING|FAILED)$' services/advisory/advisory-bff/src/schema.graphql`
Expected: two matching lines (`GENERATING` and `FAILED`).

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-bff/src/schema.graphql
git commit --no-verify -m "feat(advisory-bff): add GENERATING to DecisionStatus enum (cycle-status broadcast)"
```

---

## Task 2: Create the `decision-cycle-status` transform (TDD)

**Files:**
- Create: `services/advisory/advisory-bff/src/transforms/decision-cycle-status.ts`
- Test: `services/advisory/advisory-bff/test/unit/transforms/decision-cycle-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `services/advisory/advisory-bff/test/unit/transforms/decision-cycle-status.test.ts` (mirrors `decision-snapshot.test.ts`'s `makeUow` helper; the cycle subject is minimal and the row timestamps come from the envelope `timestamp`):

```ts
import { projectVersioned } from '@nestfolio/event-processor';
import { decisionCycleStatus } from '../../../src/transforms/decision-cycle-status';

const TS = '2026-01-01T00:00:00.000Z';
const makeUow = (type: string, subject: Record<string, unknown>, timestamp = TS) => ({
  event: { id: 'e1', type, timestamp, subject, context: { tenantId: 't1' } },
  payload: {}, record: {},
});

describe('decisionCycleStatus transform', () => {
  it('projects GENERATING (v0) from DECISION_CYCLE_STARTED', () => {
    expect(
      decisionCycleStatus(
        makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd1', tenantId: 't1', status: 'GENERATING', __version: 0 }) as any,
      ),
    ).toEqual(
      projectVersioned('DecisionReadModel', {
        decisionId: 'd1', tenantId: 't1', status: 'GENERATING', createdAt: TS, updatedAt: TS,
      }, { version: 0, overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' } }),
    );
  });

  it('projects FAILED (v1) from DECISION_CYCLE_FAILED', () => {
    expect(
      decisionCycleStatus(
        makeUow('DECISION_CYCLE_FAILED', { decisionId: 'd1', tenantId: 't1', status: 'FAILED', __version: 1 }) as any,
      ),
    ).toEqual(
      projectVersioned('DecisionReadModel', {
        decisionId: 'd1', tenantId: 't1', status: 'FAILED', createdAt: TS, updatedAt: TS,
      }, { version: 1, overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' } }),
    );
  });

  it('carries the subject __version into the intent version (the DDB ordering guard input)', () => {
    const intent = decisionCycleStatus(
      makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd9', tenantId: 't9', status: 'GENERATING', __version: 0 }) as any,
    ) as { _tag: string; typename: string; version: number };
    expect(intent._tag).toBe('projectVersioned');
    expect(intent.typename).toBe('DecisionReadModel');
    expect(intent.version).toBe(0);
  });

  it('uses the envelope timestamp (not a subject field) for createdAt', () => {
    const intent = decisionCycleStatus(
      makeUow('DECISION_CYCLE_STARTED', { decisionId: 'd2', tenantId: 't2', status: 'GENERATING', __version: 0 }, '2030-09-09T09:09:09.000Z') as any,
    ) as { fields: Record<string, unknown> };
    expect(intent.fields['createdAt']).toBe('2030-09-09T09:09:09.000Z');
  });
});
```

> NOTE: the spec §7.1 "content overwrites GENERATING / late STARTED dropped" behavior is a property of `projectVersioned`'s DDB conditional write, not of the transform (which only emits the intent). It is asserted at the integration level in Task 5, not here.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run advisory-bff:test --testFile=test/unit/transforms/decision-cycle-status.test.ts`
Expected: FAIL — `Cannot find module '../../../src/transforms/decision-cycle-status'`.

- [ ] **Step 3: Write the transform**

Create `services/advisory/advisory-bff/src/transforms/decision-cycle-status.ts`:

```ts
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type CycleStatusSubject = {
  decisionId: string;
  tenantId: string;
  status: 'GENERATING' | 'FAILED';
  __version: number;
  [k: string]: unknown;
};

// WS-2: project the SF-direct cycle-lifecycle events onto the versioned
// DecisionReadModel P1 row BEFORE any DecisionPacket exists.
//   DECISION_CYCLE_STARTED → GENERATING (v0)
//   DECISION_CYCLE_FAILED  → FAILED      (v1)
// The subject is minimal ({ decisionId, tenantId, status, __version }); there is
// no content yet (explanation/proposedTrades are intentionally omitted). createdAt
// comes from the envelope timestamp (uow.event.timestamp) — the subject carries
// none; projectVersioned auto-stamps updatedAt from ctx.timestamp. The version
// guard (#__version < :version) makes this order-agnostic + idempotent: a content
// DECISION_PACKET_CREATED (v1) overwrites GENERATING (v0); a late STARTED (v0)
// after a real decision (v1) is dropped. DecisionReadModel stays Projection<'P1'>
// (same typename + projectVersioned intent — only new status values).
export const decisionCycleStatus = (
  uow: UnitOfWork<BusEvent<CycleStatusSubject>>,
): WriteIntent => {
  const p = uow.event.subject;
  return projectVersioned('DecisionReadModel', {
    decisionId: p.decisionId,
    tenantId: p.tenantId,
    status: p.status,
    createdAt: uow.event.timestamp,
    updatedAt: uow.event.timestamp,
  }, {
    version: p.__version,
    overrides: { pk: `Decision#${p.tenantId}#${p.decisionId}`, sk: 'DecisionReadModel' },
  });
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run advisory-bff:test --testFile=test/unit/transforms/decision-cycle-status.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/transforms/decision-cycle-status.ts services/advisory/advisory-bff/test/unit/transforms/decision-cycle-status.test.ts
git commit --no-verify -m "feat(advisory-bff): decision-cycle-status transform (GENERATING/FAILED projection)"
```

---

## Task 3: Wire the cycle transform into the event-listener (TDD)

**Files:**
- Modify: `services/advisory/advisory-bff/src/handlers/event-listener.ts`
- Test: `services/advisory/advisory-bff/test/unit/handlers/event-listener.test.ts`

- [ ] **Step 1: Update the failing test**

Replace the first test in `services/advisory/advisory-bff/test/unit/handlers/event-listener.test.ts` (the `'subscribes to ONLY the two DecisionPacket snapshot events'` block, lines 5-11) with the 4-handler assertion, and ADD a cycle-dispatch test. Keep the existing CREATED/UPDATED dispatch test and the degraded-skip test unchanged. The first two tests become:

```ts
  it('subscribes to the two DecisionPacket snapshot events AND the two cycle-lifecycle events', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(4);
    expect(handlers).toHaveProperty(DecisionWorkflowEventTypes.DECISION_PACKET_CREATED);
    expect(handlers).toHaveProperty(DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED);
    expect(handlers).toHaveProperty(DecisionWorkflowEventTypes.DECISION_CYCLE_STARTED);
    expect(handlers).toHaveProperty(DecisionWorkflowEventTypes.DECISION_CYCLE_FAILED);
  });

  it('cycle events dispatch the decisionCycleStatus transform (GENERATING v0 / FAILED v1)', () => {
    const handlers = createHandlers();
    const cases = [
      { eventType: DecisionWorkflowEventTypes.DECISION_CYCLE_STARTED, status: 'GENERATING', version: 0 },
      { eventType: DecisionWorkflowEventTypes.DECISION_CYCLE_FAILED, status: 'FAILED', version: 1 },
    ];
    for (const c of cases) {
      const subject = { decisionId: 'd1', tenantId: 't1', status: c.status, __version: c.version };
      const ctx = { tenantId: 't1', eventId: 'e1', eventType: c.eventType, timestamp: '2026-01-01T00:00:00.000Z' };
      const intent = handlers[c.eventType]({ subject } as never, ctx as never) as {
        _tag: string; typename: string; version: number; fields: Record<string, unknown>;
      };
      expect(intent._tag).toBe('projectVersioned');
      expect(intent.typename).toBe('DecisionReadModel');
      expect(intent.version).toBe(c.version);
      expect(intent.fields['status']).toBe(c.status);
    }
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run advisory-bff:test --testFile=test/unit/handlers/event-listener.test.ts`
Expected: FAIL — `expect(Object.keys(handlers)).toHaveLength(4)` receives 2; `DECISION_CYCLE_STARTED` handler is `undefined`.

- [ ] **Step 3: Wire the transform**

Edit `services/advisory/advisory-bff/src/handlers/event-listener.ts`. Add the import and a `cycleStatus` adapter, and register both cycle event types. The full file becomes:

```ts
import '../read-model-ownership';
import { materializeToTable, toUow, skip, type WriteIntent } from '@nestfolio/event-processor';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { decisionSnapshot } from '../transforms/decision-snapshot';
import { decisionCycleStatus } from '../transforms/decision-cycle-status';

// decisionSnapshot returns undefined for degraded snapshots (no explanation + no
// trades). materializeToTable's HandlerFn must return a WriteIntent, so coerce the
// drop to a skip() intent (terminal no-op) rather than undefined.
const project = (payload: unknown, ctx: unknown): WriteIntent =>
  decisionSnapshot(toUow(payload as never, ctx as never) as never) ?? skip();

// WS-2: cycle-lifecycle events project a minimal versioned GENERATING/FAILED row.
// decisionCycleStatus never degrades (it always emits a projectVersioned intent),
// so no skip() coercion is needed here.
const cycleStatus = (payload: unknown, ctx: unknown): WriteIntent =>
  decisionCycleStatus(toUow(payload as never, ctx as never) as never);

export function createHandlers() {
  return {
    [DecisionWorkflowEventTypes.DECISION_PACKET_CREATED]: project,
    [DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED]: project,
    [DecisionWorkflowEventTypes.DECISION_CYCLE_STARTED]: cycleStatus,
    [DecisionWorkflowEventTypes.DECISION_CYCLE_FAILED]: cycleStatus,
  };
}

export const handler = materializeToTable({
  serviceName: 'advisory-bff',
  handlers: createHandlers(),
  errorEventType: 'ADVISORY_BFF_FAILED',
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run advisory-bff:test --testFile=test/unit/handlers/event-listener.test.ts`
Expected: PASS (4 tests: 4-handler, cycle-dispatch, CREATED/UPDATED dispatch, degraded-skip).

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/handlers/event-listener.ts services/advisory/advisory-bff/test/unit/handlers/event-listener.test.ts
git commit --no-verify -m "feat(advisory-bff): dispatch cycle events to decisionCycleStatus"
```

---

## Task 4: Add the two cycle detail-types to the Ingress (TDD)

**Files:**
- Modify: `services/advisory/advisory-bff/src/service.stack.ts:19-31`
- Test: `services/advisory/advisory-bff/test/unit/service.stack.test.ts:39-46`

- [ ] **Step 1: Update the failing test**

Replace the `'Ingress subscribes to ONLY the two DecisionPacket snapshot events'` test (`test/unit/service.stack.test.ts:39-46`) with the 4-detail-type assertion. Order MUST match `eventTypes` order (CDK renders the top-level `detail-type` array in declaration order; `hasResourceProperties` matches it positionally):

```ts
  it('Ingress subscribes to the two DecisionPacket snapshot events AND the two cycle-lifecycle events', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        'detail-type': [
          'DECISION_PACKET_CREATED',
          'DECISION_PACKET_UPDATED',
          'DECISION_CYCLE_STARTED',
          'DECISION_CYCLE_FAILED',
        ],
      },
    });
  });
```

Leave the `'Ingress no longer subscribes to status / trigger events (races removed)'` test unchanged — `DECISION_CYCLE_*` are not in its removed-list, so it still passes.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run advisory-bff:test --testFile=test/unit/service.stack.test.ts`
Expected: FAIL — the rendered `detail-type` is `['DECISION_PACKET_CREATED','DECISION_PACKET_UPDATED']` (2 entries), not the asserted 4.

- [ ] **Step 3: Add the cycle detail-types to the Ingress `eventTypes`**

In `services/advisory/advisory-bff/src/service.stack.ts`, replace the `Ingress` block (lines 19-31) with (updated comment + 2 new entries, in this order so the test array matches):

```ts
    const ingress = new Ingress(this, 'Ingress', {
      state,
      // advisory-bff is a P1 versioned projection of the single authoritative
      // DecisionPacket producer: it subscribes to the full-row CDC snapshots
      // (CREATED + UPDATED), whose effects arrive inside the versioned snapshot.
      // WS-2 adds the two SF-direct cycle-lifecycle events (emitted by
      // decision-workflow-ctrl BEFORE any DecisionPacket exists): STARTED →
      // GENERATING (v0), FAILED → FAILED (v1), projected onto the same
      // DecisionReadModel row via the version guard. The Ingress $or source
      // filter already accepts the SF-direct source (bare serviceName).
      eventTypes: [
        DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
        DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
        DecisionWorkflowEventTypes.DECISION_CYCLE_STARTED,
        DecisionWorkflowEventTypes.DECISION_CYCLE_FAILED,
      ],
    });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run advisory-bff:test --testFile=test/unit/service.stack.test.ts`
Expected: PASS (all stack tests, including the table/stream-consumer tests, still green).

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/service.stack.ts services/advisory/advisory-bff/test/unit/service.stack.test.ts
git commit --no-verify -m "feat(advisory-bff): Ingress subscribes to DECISION_CYCLE_STARTED/FAILED"
```

---

## Task 5: Add cycle-status integration tests (validate on dev)

These run against deployed dev in the validation gate (Task 8). They follow the existing file's pattern exactly: `eb.putEvent({ targetService: 'advisory-bff', detail })` wraps `detail` as the event SUBJECT; the envelope `timestamp` is set by the test client. They cover the spec §7.1 behaviors that are NOT unit-testable (the DDB version guard): `GENERATING` materializes, the content packet overwrites it, `FAILED` lands, and a late `STARTED` is dropped.

**Files:**
- Modify: `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`

- [ ] **Step 1: Update the header contract comment**

In the file header comment block (lines 13-43), update the Ingress bullet to include the cycle events. Replace the line:

```
//  * Ingress subscribes ONLY DECISION_PACKET_CREATED + DECISION_PACKET_UPDATED.
```

with:

```
//  * Ingress subscribes DECISION_PACKET_CREATED + DECISION_PACKET_UPDATED (full-row
//    CDC snapshots) AND the WS-2 SF-direct cycle-lifecycle events
//    DECISION_CYCLE_STARTED (→ GENERATING, v0) + DECISION_CYCLE_FAILED (→ FAILED, v1),
//    projected onto the same versioned DecisionReadModel row.
```

- [ ] **Step 2: Add the integration describe block**

Insert this `describe` block inside the top-level `describe('advisory-bff', …)`, immediately after the closing `});` of the `describe('DecisionReadModel (versioned P1 projection)', …)` block (after line 302):

```ts
  // ── DecisionReadModel: cycle-lifecycle status (WS-2) ─────────────────
  //
  // SF-direct cycle events project a MINIMAL versioned row before any packet
  // exists. The version guard makes this order-agnostic: STARTED(v0)→GENERATING,
  // content CREATED(v1) overwrites, FAILED(v1)→FAILED, late STARTED(v0) dropped.

  describe('DecisionReadModel cycle-status (GENERATING/FAILED, WS-2)', () => {
    it('projects GENERATING (v0) from DECISION_CYCLE_STARTED before any packet exists', async () => {
      const decisionId = `integ-gen-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory',
        targetService: 'advisory-bff',
        detailType: 'DECISION_CYCLE_STARTED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'GENERATING', __version: 0 },
      });

      const item = await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel',
        timeoutMs: 30_000, match: { status: 'GENERATING' },
      });
      expect(item['__typename']).toBe('DecisionReadModel');
      expect(item['status']).toBe('GENERATING');
      expect(Number(item['version'])).toBe(0);
    }, 120_000);

    it('a content DECISION_PACKET_CREATED (v1) overwrites the GENERATING (v0) row', async () => {
      const decisionId = `integ-gen-overwrite-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_CYCLE_STARTED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'GENERATING', __version: 0 },
      });
      await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000, match: { status: 'GENERATING' },
      });

      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_PACKET_CREATED',
        detail: {
          __version: 1, tenantId: ctx.tenantId, decisionId, trigger: 'REBALANCE', status: 'PENDING',
          proposedTrades: [{ symbol: 'AAPL', action: 'BUY', quantity: 1 }],
          explanation: 'real decision overwrites generating', confirmationRequired: true,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      });

      const item = await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000, match: { status: 'PENDING' },
      });
      expect(item['status']).toBe('PENDING');
      expect(Number(item['version'])).toBe(1);
      expect(item['explanation']).toBe('real decision overwrites generating');
    }, 120_000);

    it('DECISION_CYCLE_FAILED (v1) projects FAILED; a late STARTED (v0) is dropped by the guard', async () => {
      const decisionId = `integ-failed-${Date.now()}`;
      const pk = `Decision#${ctx.tenantId}#${decisionId}`;

      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_CYCLE_STARTED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'GENERATING', __version: 0 },
      });
      await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000, match: { status: 'GENERATING' },
      });

      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_CYCLE_FAILED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'FAILED', __version: 1 },
      });
      await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 30_000, match: { status: 'FAILED' },
      });

      // Late STARTED (v0) after FAILED (v1): the guard (#__version < :version) drops it.
      await eb.putEvent({
        bus: 'advisory', targetService: 'advisory-bff', detailType: 'DECISION_CYCLE_STARTED',
        detail: { decisionId, tenantId: ctx.tenantId, status: 'GENERATING', __version: 0 },
      });
      await new Promise((r) => setTimeout(r, 8_000));

      const item = await table.waitForItem({
        table: 'advisory-bff', pk, sk: 'DecisionReadModel', timeoutMs: 5_000,
      });
      expect(item['status']).toBe('FAILED');
      expect(Number(item['version'])).toBe(1);
    }, 120_000);
  });
```

- [ ] **Step 3: Type-check the integration test compiles**

Run: `pnpm nx run advisory-bff:typecheck`
Expected: PASS (no tsc errors — the new block uses only existing `eb`/`table`/`ctx` fixtures).

- [ ] **Step 4: Commit**

```bash
git add services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts
git commit --no-verify -m "test(advisory-bff): integration coverage for cycle-status projection"
```

---

## Task 6: Update the service card

**Files:**
- Modify: `services/advisory/advisory-bff/CLAUDE.md`

- [ ] **Step 1: Update the Ingress + Transforms sections**

In `services/advisory/advisory-bff/CLAUDE.md`:

Replace the Ingress `Subscriptions:` line:

```
  Subscriptions: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED
```

with:

```
  Subscriptions: DECISION_PACKET_CREATED, DECISION_PACKET_UPDATED, DECISION_CYCLE_STARTED, DECISION_CYCLE_FAILED
  (WS-2: the two SF-direct cycle-lifecycle events project GENERATING/FAILED onto the DecisionReadModel
  row before any packet exists; the Ingress $or source filter accepts the bare serviceName source.)
```

Add to the `## Transforms` section, after the `decision-snapshot.ts` bullet:

```
- decision-cycle-status.ts — WS-2 transform for DECISION_CYCLE_STARTED + DECISION_CYCLE_FAILED; projects a MINIMAL versioned DecisionReadModel P1 row (decisionId/tenantId/status/createdAt/updatedAt) via projectVersioned — STARTED→GENERATING (v0), FAILED→FAILED (v1). createdAt/updatedAt come from the envelope timestamp. The version guard lets a content DECISION_PACKET_CREATED (v1) overwrite GENERATING (v0) and drops a late STARTED.
```

In the `## GraphQL Surface` (or enum) note, record that `DecisionStatus` now includes `GENERATING` (added so the decision-publisher broadcast of a generating row passes AppSync enum validation). Add under the schema notes:

```
- DecisionStatus enum includes GENERATING (WS-2) + FAILED so cycle-status rows broadcast via publishDecisionUpdate without enum-validation failure.
```

- [ ] **Step 2: Commit**

```bash
git add services/advisory/advisory-bff/CLAUDE.md
git commit --no-verify -m "docs(advisory-bff): document cycle-status subscriptions + transform"
```

> The `/backlog-next` closing phase runs `detect-doc-derivation.mjs`; if it flags `audit-service advisory-bff`, run it and reconcile any drift against this manual edit in the same workstream.

---

## Task 7: Full local verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full advisory-bff unit suite**

Run: `pnpm nx run advisory-bff:test`
Expected: PASS — all unit suites green (transforms, handlers, service.stack, repository, graphql, types).

- [ ] **Step 2: Typecheck (read-model-ownership type-test included)**

Run: `pnpm nx run advisory-bff:typecheck`
Expected: PASS — `DecisionReadModel: Projection<'P1'>` still permits `projectVersioned`; no new tsc errors.

- [ ] **Step 3: Lint**

Run: `pnpm nx run advisory-bff:lint`
Expected: PASS.

- [ ] **Step 4: Affected gate (pre-deploy)**

Run: `pnpm nx affected -t test,lint --base=origin/main`
Expected: PASS for all affected projects (advisory-bff + any consumer of its schema/types).

---

## Task 8: Validation gate — deploy + scoped integration (closing phase)

> Executed in the `/backlog-next` closing phase (Steps 6.2-6.4). Documented here so the commands are exact. Dev-account ops need no confirmation ([[feedback-sole-dev-no-shared-caution]]); integration tests use mocked agents and auto-run ([[feedback-integration-tests-auto-run]]).

- [ ] **Step 1: Deploy advisory-bff to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff`
Expected: stack `dev-advisory-bff` updates cleanly (new Ingress detail-types + GENERATING enum in the AppSync schema).

- [ ] **Step 2: Run the scoped integration suite**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run advisory-bff:test-integration`
Expected: PASS — including the new `DecisionReadModel cycle-status (GENERATING/FAILED, WS-2)` block (GENERATING materializes, content overwrites, FAILED lands, late STARTED dropped). If any scenario fails-then-passes on rerun, pull CloudWatch evidence from the failing window before continuing ([[feedback-flake-means-broken]]).

- [ ] **Step 3: Confirm the GENERATING broadcast did not poison decision-publisher**

The Task 1 enum fix is exercised when the GENERATING integration row is broadcast. Confirm no enum-validation errors in the publisher after the suite:

Run: `AWS_PROFILE=nestfolio-dev aws logs filter-log-events --log-group-name /aws/lambda/dev-advisory-bff-DecisionPublisher --start-time $(node -e 'console.log(Date.now()-600000)') --filter-pattern '?GENERATING ?ValidationException ?"not a valid"' --region us-east-1 --max-items 20`
Expected: no matching events (the broadcast of the `GENERATING` row succeeded — the enum value is now valid). If matches appear, the enum fix did not deploy; re-check Task 1 + the deployed schema.

> The `/advisory` + dashboard UI rendering and the Playwright scenario are WS-3 / WS-4 (out of scope here). WS-2's gate is: unit + lint + typecheck green, deploy clean, integration green, no broadcast poison.

---

## Self-review

**1. Spec coverage (§4, §7.1, §10):**
- §4.1 Ingress subscriptions → Task 4. ✓
- §4.2 transform `projectVersioned('DecisionReadModel', …)` STARTED→GENERATING(v0)/FAILED→FAILED(v1), minimal row, P1 unchanged, degraded-drop untouched → Task 2 + Task 3. ✓
- §7.1 unit (STARTED→GENERATING v0, FAILED→FAILED v1) → Task 2; (content overwrites GENERATING / late STARTED dropped — DDB-guard behavior) → Task 5 integration. ✓
- §10 version-ladder (content seeds v1) + source-path confirmation → pre-flight facts (verified) + Task 5. ✓
- **Beyond spec (gap found):** `DecisionStatus` enum missing `GENERATING` would poison the broadcast → Task 1. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code step shows full content. ✓

**3. Type consistency:** transform exported as `decisionCycleStatus` and imported under that exact name in `event-listener.ts` + both test files; `CycleStatusSubject.status` is `'GENERATING' | 'FAILED'`; intent fields use `decisionId/tenantId/status/createdAt/updatedAt` consistently across transform, unit test, and `decision-publisher.mapImage` reads; `eventTypes` order (CREATED, UPDATED, CYCLE_STARTED, CYCLE_FAILED) matches the `service.stack.test.ts` assertion array order. ✓

**4. Out-of-scope honored** (per the backlog `out_of_scope`): no advisory-mfe change, no `get-pending-decisions.fn.js` filter change, no dashboard change, no `IN_FLIGHT_STATUSES` change, no e2e/Playwright. The only schema touch is the `GENERATING` enum value (required by WS-2's own broadcast path, not by the MFE query). ✓
