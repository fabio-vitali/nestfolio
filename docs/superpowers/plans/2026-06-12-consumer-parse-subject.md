# Consumer parseSubject Conversion (WS-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every consumer subject read in the repo is `parseSubject(carrier, <importedProducerSchema>)` — zero generic `as Record<string, unknown>` (or `event.subject ?? event`) subject reads in consumers, modulo the documented boundaries below.

**Architecture:** Consumers import the producer's exported zod contract (intra-domain: `@nestfolio/<svc>/contracts`; cross-domain: the producer-domain adapter's `/domain` re-export) and parse each handled event's subject through the existing `parseSubject` seam (`libs/event-processor/src/util/parse-subject.ts`). Multi-event handlers that share one closure are split so each branch parses a single producer schema (the handler map is the dispatch). No new lib primitive is introduced; no new producer contracts are authored (that was WS-1). Reads of events with no CDC producer contract (external broker webhooks, broker→adapter internal routing events, SF-direct agent-invocation payloads, AppSync-mutation feedback, signal-only events) stay as explicitly-commented boundaries.

**Tech Stack:** TypeScript, zod, `@nestfolio/event-processor` (`parseSubject`, `materializeToTable`/`materializeToBucket`, `WriteIntent`), Jest + ts-jest, nx, AWS (DynamoDB CDC → EventBridge), Bedrock AgentCore (advisory agents).

---

## Decisions locked (from planning)

1. **Fan-in mechanism = per-branch inline `parseSubject`.** No `parseSubjectByType` lib primitive. Each shared multi-event closure is split so every event type has its own branch calling `parseSubject(carrier, ItsSchema)`. Shared post-parse boilerplate stays in a helper that takes already-extracted typed scalars (not a bag).
2. **Boundary policy = contract-backed only.** Convert every read whose event has a producer CDC contract (add adapter `/domain` re-exports as needed). Leave genuinely-external reads as explicitly-commented boundaries; author no new contracts.

## Out of scope (mirrors backlog `out_of_scope`)

- The 4 `broker-ctrl/deposit-withdrawal-normalizer.ts` `as Record` casts (~lines 26/58/88/96) — deferred to `broker-funding-completed-normalization-drift` (rank 6); they are shared across sim+alpaca funding paths and need a canonical funding-completed shape first.
- The enforcement layer (lint rule / `tools/` check-script / skill+doc updates) — that is the capstone `typing-convention-enforcement-skills-docs` (rank 4).
- WS-1 producer contracts + WS-2 publisher typing (shipped). We import WS-1 contracts; we do not re-author them.
- Any behavioral change beyond the single captured execution-ctrl USER_CONFIRMED `decisionId` fallback. Conversion is read-typing only.

## Documented boundaries (NOT converted — add a one-line comment at each site)

| Site | Event(s) | Why boundary |
|---|---|---|
| `execution-ctrl/event-listener.ts` | `ACCOUNT_CLOSURE_REQUESTED` | signal-only handler returns `skip()`, no subject read |
| `broker-ctrl/callback-resolver.ts` | `SIM_ORDER_*`, `ALPACA_ORDER_*` | internal adapter results; no exported nestfolio CDC contract |
| `broker-sim-adpt/event-listener.ts` | `SIM_ORDER_REQUESTED`, `SIM_WITHDRAWAL_REQUESTED` | broker-ctrl internal routing events, no contract |
| `broker-alpaca-adpt/event-listener.ts` | `ALPACA_ORDER_REQUESTED`, `ALPACA_ORDER_CANCEL_REQUESTED`, `ALPACA_ACCOUNT_CHECK` | broker-ctrl internal routing + external Alpaca webhooks, no contract |
| IP/MI/PE/AN `agent-service.ts` (`runPipeline`) | SF-direct invocation payload | invoked directly by the decision-workflow SF with a synthetic `{subject?, context?}` payload — no CDC producer. The `event.subject ?? event` fallback is the tell. |
| PE/AN `event-listener.ts` `CONSTRUCT_PORTFOLIO` / `GENERATE_NARRATIVE` branches | those events | SF-direct orchestration putEvents, no row contract |
| `advisory-narrative-ctrl/feedback-correlator.ts` + AN `event-listener.ts` `DECISION_FEEDBACK` | `DECISION_FEEDBACK` | AppSync-mutation-sourced, no producer CDC contract |
| `decision-workflow-ctrl/sfn-callback.ts` `USER_RESPONSE` branch | `USER_CONFIRMED`/`USER_REJECTED` *when read only for taskToken via the get-decision-readback pre-step* | see Task 4.6 — these DO have advisory-bff contracts and ARE converted; listed here only to flag the taskToken-from-readback nuance |
| `investor-ctrl/event-listener.ts` system events | `BROKER_CIRCUIT_OPEN/CLOSED`, `BROKER_HEAL_ESCALATED` | no subject payload; id is `ctx.eventId` |

> When in doubt at execution time: if `grep`-ing the producer service's `src/domain/contracts.ts` yields no schema for the event, AND the event is from the list above, it is a boundary — add the comment, do not invent a contract.

---

## Canonical pattern (every conversion task follows this)

`parseSubject` signature (do not modify):

```typescript
// libs/event-processor/src/util/parse-subject.ts
export function parseSubject<S extends ZodTypeAny>(
  carrier: UnitOfWork<BusEvent<unknown>> | EventPayload,
  schema: S,
): z.infer<S>
```

It accepts EITHER a `UnitOfWork` (`uow.event.subject`) OR an `EventPayload` (`payload.subject`), runs `schema.parse`, and returns the inferred type. ZodError on mismatch flows to the event-processor poison-pill/DLQ path.

**Reference (already-converted, ledger-bff/transforms/balance-updated.ts):**

```typescript
import { projectVersioned, record, parseSubject, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { BalanceUpdatedSchema } from '@nestfolio/ledger-ctrl/contracts';

export const balanceUpdated = (uow: UnitOfWork<BusEvent<Record<string, unknown>>>): WriteIntent | WriteIntent[] => {
  const { event } = uow;
  const { tenantId, userId, region } = event.context;          // identity from CONTEXT
  const payload = parseSubject(uow, BalanceUpdatedSchema);       // typed subject
  const balanceCents = payload.cashBalanceCents;                 // typed field reads
  // ...
};
```

**Before → after (the universal transformation):**

```typescript
// BEFORE (event-listener handler form)
const subject = (payload.subject ?? {}) as Record<string, unknown>;
const id = subject['someId'] as string;

// AFTER
import { parseSubject } from '@nestfolio/event-processor';
import { SomeSchema } from '@nestfolio/<producer>/contracts';   // or .../<producer>-adpt/domain (cross-domain)
const subject = parseSubject(payload, SomeSchema);              // payload OR uow both work
const id = subject.someId;                                      // typed
```

**Splitting a shared multi-event closure (the fan-in rule):** when one handler body services multiple event types reading an untyped bag, give each event type its own branch (its own handler-map entry, or an explicit `switch`/`if` on `ctx.eventType`) that calls `parseSubject` with that event's single producer schema. Shared post-parse work moves into a helper taking typed scalars.

**Identity reminder:** `tenantId`/`userId`/`region`/`userId`-as-entity-id live in `event.context` / `ctx`, NOT the subject (DRY subjects). Only read genuine payload fields from the parsed subject.

**Import home rule:** intra-domain consumer → `@nestfolio/<producerSvc>/contracts`. Cross-domain consumer → `@nestfolio/<producerDomain>-adpt/domain`. Domains: investor / advisory / execution / ledger.

**TDD note for conversions:** most of these files already have unit tests. The "failing test" is typically: (a) add/adjust a test asserting the handler still produces the same `WriteIntent` from a contract-valid subject, AND (b) add a test that a contract-INVALID subject (missing a required field) throws `ZodError`. The build-tripwire (Phase 5) proves the compile-time half.

---

## Phase 0 — Cross-domain adapter `/domain` re-exports

The home rule requires cross-domain consumers to import from the producer-domain adapter `/domain`. Today those re-exports are mostly missing. Add them FIRST so consumer tasks can import without hitting a missing export mid-conversion.

### Task 0.1: Confirm `<svc>/contracts` subpaths resolve

**Files:**
- Read: `tsconfig.base.json` (the `compilerOptions.paths` map)

- [ ] **Step 1: Verify the producer contract subpaths exist**

Run: `grep -nE '"@nestfolio/(compliance-ctrl|advisory-bff|broker-ctrl|ledger-ctrl|investor-bff)/contracts"' tsconfig.base.json`
Expected: a `paths` entry for each, mapping to the service's `src/domain/contracts.ts`. If any is MISSING, add it mirroring an existing `<svc>/contracts` entry, AND add the matching `exports`/`typesVersions` entry in that service's `package.json` (copy the shape from `services/ledger/ledger-ctrl/package.json`).

- [ ] **Step 2: Commit only if a subpath had to be added**

```bash
git add tsconfig.base.json services/*/*/package.json
git commit -m "build: declare missing <svc>/contracts subpaths for WS-3 re-exports"
```

### Task 0.2: advisory-adpt/domain re-exports

**Files:**
- Modify: `services/advisory/advisory-adpt/src/domain/index.ts`

- [ ] **Step 1: Add the re-exports**

```typescript
// append to services/advisory/advisory-adpt/src/domain/index.ts
export { ComplianceCheckSchema } from '@nestfolio/compliance-ctrl/contracts';
export type { ComplianceCheck } from '@nestfolio/compliance-ctrl/contracts';
export { UserConfirmationSchema, UserRejectionSchema } from '@nestfolio/advisory-bff/contracts';
export type { UserConfirmation, UserRejection } from '@nestfolio/advisory-bff/contracts';
```

- [ ] **Step 2: Typecheck the adapter**

Run: `pnpm nx typecheck advisory-adpt` (or `pnpm nx build advisory-adpt`)
Expected: PASS. If it fails on a project-dependency boundary, add `compliance-ctrl` / `advisory-bff` to `advisory-adpt`'s `project.json` `implicitDependencies` only if nx requires it — the import is intra-domain (advisory→advisory) and allowed by the import-boundary hook.

- [ ] **Step 3: Commit**

```bash
git add services/advisory/advisory-adpt/src/domain/index.ts
git commit -m "feat(advisory-adpt): re-export ComplianceCheck + UserConfirmation/Rejection contracts (WS-3 home rule)"
```

### Task 0.3: execution-adpt/domain re-export

**Files:**
- Modify: `services/execution/execution-adpt/src/domain/index.ts`

- [ ] **Step 1: Add the NormalizedOrderEvent re-export** (FundingSnapshot is already exported)

```typescript
// append to services/execution/execution-adpt/src/domain/index.ts
export { NormalizedOrderEventSchema } from '@nestfolio/broker-ctrl/contracts';
export type { NormalizedOrderEvent } from '@nestfolio/broker-ctrl/contracts';
```

- [ ] **Step 2: Typecheck** — Run: `pnpm nx typecheck execution-adpt` — Expected: PASS
- [ ] **Step 3: Commit**

```bash
git add services/execution/execution-adpt/src/domain/index.ts
git commit -m "feat(execution-adpt): re-export NormalizedOrderEvent contract (WS-3 home rule)"
```

### Task 0.4: ledger-adpt/domain re-export

**Files:**
- Modify: `services/ledger/ledger-adpt/src/domain/index.ts`

- [ ] **Step 1: Add the BalanceUpdated re-export**

```typescript
// append to services/ledger/ledger-adpt/src/domain/index.ts
export { BalanceUpdatedSchema } from '@nestfolio/ledger-ctrl/contracts';
export type { BalanceUpdated } from '@nestfolio/ledger-ctrl/contracts';
```

- [ ] **Step 2: Typecheck** — Run: `pnpm nx typecheck ledger-adpt` — Expected: PASS
- [ ] **Step 3: Commit**

```bash
git add services/ledger/ledger-adpt/src/domain/index.ts
git commit -m "feat(ledger-adpt): re-export BalanceUpdated contract (WS-3 home rule)"
```

> investor-adpt/domain already re-exports `DepositInitiated`, `WithdrawalInitiated`, `Mandate`, `ExecutionModeChanged` — no Phase 0 task needed for it.

---

## Phase 1 — Ledger consumers (smallest; proves the loop)

### Task 1.1: ledger-ctrl/event-listener.ts

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`
- Test: `services/ledger/ledger-ctrl/test/unit/event-listener.test.ts` (or the existing handler test)

- [ ] **Step 1: Read the file + map each handled event to its schema**

Read the handler dispatch map and the two `const subject = payload.subject ?? {}` sites (~lines 22, 74). Map:
- `ORDER_FILLED` / `ORDER_PARTIALLY_FILLED` / `ORDER_REJECTED` / `ORDER_CANCELLED` → `NormalizedOrderEventSchema` from `@nestfolio/execution-adpt/domain` (cross-domain: ledger←execution).
- `DECISION_APPROVED` → `ComplianceCheckSchema` from `@nestfolio/advisory-adpt/domain` (ledger-ctrl reads only `subject.decisionId` → typed as `ComplianceCheck.decisionId`).
- `DEPOSIT_DETECTED` / `DEPOSIT_SETTLED` / `DEPOSIT_FAILED` / `WITHDRAWAL_SETTLED` / `WITHDRAWAL_FAILED` → `FundingSnapshotSchema` from `@nestfolio/execution-adpt/domain`.

- [ ] **Step 2: Add a failing ZodError test**

```typescript
it('rejects an ORDER_FILLED subject missing required fields (contract enforcement)', async () => {
  const badPayload = { subject: { /* missing orderId etc. */ }, context: ctx };
  await expect(handlers.ORDER_FILLED(badPayload, eventCtx)).rejects.toThrow(); // ZodError
});
```

Run: the new test. Expected: FAIL (currently the untyped read tolerates the bad subject).

- [ ] **Step 3: Convert each branch**

Split any shared closure so each event type parses its single schema. Replace `const subject = payload.subject ?? {}` + casts with `const subject = parseSubject(payload, <Schema>)` per branch, reading typed fields. Add `import { parseSubject } from '@nestfolio/event-processor'` and the schema imports.

- [ ] **Step 4: Run tests** — Run: `pnpm nx test ledger-ctrl` — Expected: PASS (existing assertions hold; new ZodError test passes)
- [ ] **Step 5: Commit**

```bash
git add services/ledger/ledger-ctrl
git commit -m "refactor(ledger-ctrl): parseSubject all event-listener subject reads (WS-3)"
```

### Task 1.2: reconciliation-ctrl/event-listener.ts

**Files:**
- Modify: `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`
- Test: existing reconciliation-ctrl unit test

- [ ] **Step 1: Read + map.** `PORTFOLIO_UPDATED` → `PortfolioUpdatedSchema` from `@nestfolio/ledger-ctrl/contracts` (intra-domain). `ORDER_FILLED` → `NormalizedOrderEventSchema` from `@nestfolio/execution-adpt/domain`. `ALPACA_ACCOUNT_SNAPSHOT` → **boundary** (internal alpaca result, no contract — comment it). The `subject.positions` reads (~lines 178, 185) come from `PortfolioUpdatedSchema.positions` (typed `Record<string, LedgerPosition>`).
- [ ] **Step 2: Failing ZodError test** for the `PORTFOLIO_UPDATED` branch (missing `positions`). Run → FAIL.
- [ ] **Step 3: Convert** the contract-backed branches; annotate the `ALPACA_ACCOUNT_SNAPSHOT` boundary.
- [ ] **Step 4: Run** — `pnpm nx test reconciliation-ctrl` — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "refactor(reconciliation-ctrl): parseSubject contract-backed subject reads; document alpaca-snapshot boundary (WS-3)"`

---

## Phase 2 — Investor consumers

### Task 2.1: investor-ctrl/event-listener.ts — notification fan-in split (largest restructure)

**Files:**
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`
- Test: `services/investor/investor-ctrl/test/unit/event-listener.test.ts`

Current shape: one `EVENT_TYPES.map(...)` closure + one `SYSTEM_EVENT_TYPES.map(...)` closure, both reading `(payload.subject ?? {}) as Record`, then `buildNotificationRecord(tenantId, ctx, subject)` reading `subject[idField]`.

Target: `buildNotificationRecord` takes the already-extracted `relatedEntityId: string` (typed scalar). Each event type gets its own handler-map entry that parses its producer schema, extracts the id, and calls the helper. Events whose id comes from context (`userId`) or that have no contract use `ctx` fields directly.

- [ ] **Step 1: Map each event → schema + id source** (verify against producer contracts before coding):

| Event | Schema (import) | relatedEntityId |
|---|---|---|
| `DECISION_APPROVED`, `DECISION_BLOCKED` | `ComplianceCheckSchema` `@nestfolio/advisory-adpt/domain` | `subject.decisionId` |
| `ORDER_FILLED`, `ORDER_REJECTED` | `NormalizedOrderEventSchema` `@nestfolio/execution-adpt/domain` | `subject.orderId` |
| `WITHDRAWAL_SETTLED` | `FundingSnapshotSchema` `@nestfolio/execution-adpt/domain` | `subject.transferId` (verify field name on FundingSnapshot; if named differently use the real field) |
| `DEPOSIT_INITIATED` | `DepositInitiatedSchema` `@nestfolio/investor-adpt/domain` | `subject.depositId` |
| `MANDATE_ISSUED`, `MANDATE_REVOKED` | `MandateSchema` `@nestfolio/investor-adpt/domain` | `subject.mandateId` (verify on MandateSchema) |
| `OPERATING_MODE_CHANGED`, `GOAL_UPDATED`, `ONBOARDING_COMPLETED` | **no subject read** | `ctx.userId` (identity from context, per the existing map comment) |
| `BALANCE_UPDATED` | `BalanceUpdatedSchema` `@nestfolio/ledger-adpt/domain` | `ctx.eventId` (no natural id) |
| `BROKER_CIRCUIT_OPEN/CLOSED`, `BROKER_HEAL_ESCALATED` | **boundary** | `ctx.eventId` |

- [ ] **Step 2: Refactor `buildNotificationRecord` to take a typed id**

```typescript
function buildNotificationRecord(
  tenantId: string,
  ctx: EventContext,
  relatedEntityType: string,
  relatedEntityId: string,
): WriteIntent {
  const notificationId = ctx.eventId;
  const now = getTime();
  const template = getNotificationTemplate(ctx.eventType);
  return record('Notification', {
    __typename: 'Notification', tenantId, notificationId, type: ctx.eventType,
    title: template.title, body: template.body, channel: template.channel,
    status: 'DELIVERED', sourceEventId: ctx.eventId, relatedEntityType, relatedEntityId,
    timestamp: now, createdAt: now, updatedAt: now,
  } satisfies TableEntry & Pick<NotificationCreated, 'relatedEntityType' | 'relatedEntityId'>,
  { pk: `Notification#${tenantId}#${notificationId}`, sk: 'Notification' });
}
```

- [ ] **Step 3: Replace the two `.map(...)` closures with explicit per-event handler entries**

Build the handler map by grouping events that share a schema. Each entry parses its schema and computes the id, e.g.:

```typescript
import { parseSubject } from '@nestfolio/event-processor';
import { ComplianceCheckSchema } from '@nestfolio/advisory-adpt/domain';
import { NormalizedOrderEventSchema, FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';
import { DepositInitiatedSchema, MandateSchema } from '@nestfolio/investor-adpt/domain';
import { BalanceUpdatedSchema } from '@nestfolio/ledger-adpt/domain';

const decisionHandler = async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent> => {
  const subject = parseSubject(payload, ComplianceCheckSchema);
  return buildNotificationRecord(ctx.tenantId, ctx, 'DECISION', subject.decisionId);
};

const orderFilledHandler = async (payload: EventPayload, ctx: EventContext): Promise<WriteIntent | WriteIntent[]> => {
  const subject = parseSubject(payload, NormalizedOrderEventSchema);
  const notification = buildNotificationRecord(ctx.tenantId, ctx, 'ORDER', subject.orderId);
  const now = getTime();
  const reportId = `${ctx.eventId}-report`;
  const monthlyReport = record('MonthlyReport', {
    __typename: 'MonthlyReport', tenantId: ctx.tenantId, reportId,
    period: getCurrentPeriod(), orderDetails: subject,           // now TYPED NormalizedOrderEvent
    sourceEventId: ctx.eventId, status: 'GENERATED', timestamp: now, createdAt: now, updatedAt: now,
  }, { pk: `MonthlyReport#${ctx.tenantId}#${reportId}`, sk: 'MonthlyReport' });
  return [notification, monthlyReport];
};

const profileEventHandler = async (_payload: EventPayload, ctx: EventContext): Promise<WriteIntent> =>
  buildNotificationRecord(ctx.tenantId, ctx, 'PROFILE', ctx.userId);   // identity from context, no subject read

const systemEventHandler = async (_payload: EventPayload, ctx: EventContext): Promise<WriteIntent> =>
  // boundary: BROKER_CIRCUIT_* / BROKER_HEAL_ESCALATED carry no subject payload
  buildNotificationRecord('SYSTEM', ctx, 'SYSTEM', ctx.eventId);

export const createHandlers = (_deps: EventListenerDeps) => ({
  [AdvisoryCrossDomainEventTypes.DECISION_APPROVED]: decisionHandler,
  [AdvisoryCrossDomainEventTypes.DECISION_BLOCKED]: decisionHandler,
  [ExecutionCrossDomainEventTypes.ORDER_FILLED]: orderFilledHandler,
  [ExecutionCrossDomainEventTypes.ORDER_REJECTED]: async (p, c) =>
    buildNotificationRecord(c.tenantId, c, 'ORDER', parseSubject(p, NormalizedOrderEventSchema).orderId),
  [ExecutionCrossDomainEventTypes.WITHDRAWAL_SETTLED]: async (p, c) =>
    buildNotificationRecord(c.tenantId, c, 'WITHDRAWAL', parseSubject(p, FundingSnapshotSchema).transferId),
  [InvestorBffEventTypes.DEPOSIT_INITIATED]: async (p, c) =>
    buildNotificationRecord(c.tenantId, c, 'DEPOSIT', parseSubject(p, DepositInitiatedSchema).depositId),
  [InvestorBffEventTypes.MANDATE_ISSUED]: async (p, c) =>
    buildNotificationRecord(c.tenantId, c, 'MANDATE', parseSubject(p, MandateSchema).mandateId),
  [InvestorBffEventTypes.MANDATE_REVOKED]: async (p, c) =>
    buildNotificationRecord(c.tenantId, c, 'MANDATE', parseSubject(p, MandateSchema).mandateId),
  [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: profileEventHandler,
  [InvestorBffEventTypes.GOAL_UPDATED]: profileEventHandler,
  [InvestorBffEventTypes.ONBOARDING_COMPLETED]: profileEventHandler,
  [LedgerCrossDomainEventTypes.BALANCE_UPDATED]: async (p, c) => {
    parseSubject(p, BalanceUpdatedSchema);                       // validate the contract
    return buildNotificationRecord(c.tenantId, c, 'BALANCE', c.eventId);
  },
  [InvestorIngestEventTypes.BROKER_CIRCUIT_OPEN]: systemEventHandler,
  [InvestorIngestEventTypes.BROKER_CIRCUIT_CLOSED]: systemEventHandler,
  [InvestorIngestEventTypes.BROKER_HEAL_ESCALATED]: systemEventHandler,
});
```

> Verify the exact id field names (`transferId` on FundingSnapshot, `mandateId` on Mandate, `depositId` on DepositInitiated) against each schema before finalizing; use the real field if it differs.

- [ ] **Step 4: Update tests** — keep the existing per-event assertions (each event still yields the same Notification record); add a ZodError test for one cross-domain event (e.g. ORDER_FILLED with a bad subject). Run: `pnpm nx test investor-ctrl` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "refactor(investor-ctrl): split notification fan-in into per-event parseSubject branches (WS-3)"`

### Task 2.2: investor-ctrl/services/notification-lifecycle.service.ts

**Files:**
- Modify: `services/investor/investor-ctrl/src/services/notification-lifecycle.service.ts` (line ~75: `context.triggerEvent.subject as Record`)
- Test: existing notification-lifecycle test

- [ ] **Step 1: Read.** Determine which event(s) reach this service and whether it reads payload fields off `triggerEvent.subject` or just passes it through. If it reads typed fields, parse `context.triggerEvent` (an `EventPayload`-shaped carrier) with the matching producer schema via `parseSubject(context.triggerEvent, <Schema>)`. If it only forwards the bag downstream without field reads, this is a pass-through — keep it but type it against the union of producer schemas it can receive, or document as boundary if the triggering event has no single contract.
- [ ] **Step 2: Failing test** asserting typed read / ZodError as appropriate. Run → FAIL.
- [ ] **Step 3: Convert.** Run → PASS.
- [ ] **Step 4: Commit** — `git commit -m "refactor(investor-ctrl): parseSubject notification-lifecycle trigger read (WS-3)"`

---

## Phase 3 — Execution consumers (the captured-intent path)

### Task 3.1: execution-ctrl/event-listener.ts — split DECISION_APPROVED vs USER_CONFIRMED + decisionId fallback

**Files:**
- Modify: `services/execution/execution-ctrl/src/handlers/event-listener.ts`
- Test: `services/execution/execution-ctrl/test/unit/event-listener.test.ts`

Verified shapes: `DECISION_APPROVED` subject = `ComplianceCheck` (`decisionPacketId` present, `decisionId` present, **no** `proposedTrades`). `USER_CONFIRMED` subject = `UserConfirmation` (`decisionId` present, **no** `decisionPacketId`, **no** `proposedTrades`). Currently both flow through one `extractFromPayload` reading `subject.decisionPacketId` + `subject.proposedTrades` (the latter always `undefined→[]`). The captured intent: USER_CONFIRMED must fall back to `subject.decisionId` for the packet id.

- [ ] **Step 1: Write the failing regression test (the captured intent)**

```typescript
it('USER_CONFIRMED uses subject.decisionId as the packet id (no decisionPacketId on the event)', async () => {
  const payload = { subject: { decisionId: 'dec-123', confirmedAt: 't', confirmedBy: 'u', timestamp: 't' }, context: { tenantId: 'T' } };
  const intents = await handlers[AdvisoryCrossDomainEventTypes.USER_CONFIRMED](payload, { ...eventCtx, tenantId: 'T', eventId: 'ord-1' });
  const order = (Array.isArray(intents) ? intents[0] : intents).item;
  expect(order.decisionPacketId).toBe('dec-123');   // fell back to decisionId
});
```

Run: `pnpm nx test execution-ctrl -- -t "USER_CONFIRMED uses subject.decisionId"` — Expected: FAIL (current code reads `subject.decisionPacketId` which is undefined → `''`).

- [ ] **Step 2: Replace `extractFromPayload` with two typed extractors, dispatched per event type**

```typescript
import { parseSubject } from '@nestfolio/event-processor';
import { ComplianceCheckSchema, UserConfirmationSchema } from '@nestfolio/advisory-adpt/domain';

interface ApprovedDecision { tenantId: string; orderId: string; decisionPacketId: string; proposedTrades: ProposedTrade[]; }

// DECISION_APPROVED = ComplianceCheck. No proposedTrades on this event (they ride
// RECOMMENDATION_PROPOSED) — preserved as [] (behaviour-identical to the prior undefined→[]).
// The empty-trades order path is tracked by broker-ctrl-order-sf-input-contract-gap, out of WS-3 scope.
function fromDecisionApproved(payload: EventPayload, ctx: EventContext): ApprovedDecision {
  const subject = parseSubject(payload, ComplianceCheckSchema);
  return { tenantId: ctx.tenantId ?? '', orderId: ctx.eventId, decisionPacketId: subject.decisionPacketId, proposedTrades: [] };
}

// USER_CONFIRMED = UserConfirmation. Carries decisionId, NOT decisionPacketId — the captured
// id-fallback (the one unique behaviour of the deleted OrderLifecycleService).
function fromUserConfirmed(payload: EventPayload, ctx: EventContext): ApprovedDecision {
  const subject = parseSubject(payload, UserConfirmationSchema);
  return { tenantId: ctx.tenantId ?? '', orderId: ctx.eventId, decisionPacketId: subject.decisionId, proposedTrades: [] };
}
```

Then make `processApprovedDecision` accept an `ApprovedDecision` and wire the two handler-map entries to the two extractors:

```typescript
[AdvisoryCrossDomainEventTypes.DECISION_APPROVED]: (payload, ctx) =>
  processApprovedDecision(deps, fromDecisionApproved(payload, ctx), ctx),
[AdvisoryCrossDomainEventTypes.USER_CONFIRMED]: (payload, ctx) =>
  processApprovedDecision(deps, fromUserConfirmed(payload, ctx), ctx),
```

(`processApprovedDecision` keeps building the `Order` record exactly as before from the extracted fields.) Delete the old `extractFromPayload`.

- [ ] **Step 3: Run the regression test** — Run: `pnpm nx test execution-ctrl -- -t "USER_CONFIRMED uses subject.decisionId"` — Expected: PASS
- [ ] **Step 4: Run the full service suite** — Run: `pnpm nx test execution-ctrl` — Expected: PASS (DECISION_APPROVED tests still pass; `ACCOUNT_CLOSURE_REQUESTED` stays a `skip()` boundary)
- [ ] **Step 5: Commit** — `git commit -m "refactor(execution-ctrl): split DECISION_APPROVED/USER_CONFIRMED extractors; carry decisionId fallback (WS-3)"`

### Task 3.2: broker-ctrl/mode-listener.ts

**Files:** Modify `services/execution/broker-ctrl/src/handlers/mode-listener.ts` (line ~11: `payload.subject.mode as ExecutionMode['mode']`); existing test.

- [ ] **Step 1:** `EXECUTION_MODE_CHANGED` → `ExecutionModeChangedSchema` from `@nestfolio/investor-adpt/domain`. Read `subject.mode` typed.
- [ ] **Step 2:** Failing ZodError test (subject missing `mode`). Run → FAIL.
- [ ] **Step 3:** `const subject = parseSubject(payload, ExecutionModeChangedSchema); const mode = subject.mode;`. Run → PASS.
- [ ] **Step 4: Commit** — `git commit -m "refactor(broker-ctrl): parseSubject mode-listener (WS-3)"`

### Task 3.3: broker-ctrl/callback-resolver.ts — boundary annotations

**Files:** Modify `services/execution/broker-ctrl/src/handlers/callback-resolver.ts` (~lines 42/51/57-60).

- [ ] **Step 1: Confirm boundary.** `SIM_ORDER_*` / `ALPACA_ORDER_*` are internal adapter results with no exported nestfolio CDC contract (the adapters' own `*/contracts.ts` define `AlpacaOrderResult` etc. but do NOT export them cross-domain, and per D3 we author none). Add a one-line comment at each subject read documenting the boundary; leave the reads as-is.
- [ ] **Step 2: No behavior change — confirm tests still pass.** Run: `pnpm nx test broker-ctrl` — Expected: PASS.
- [ ] **Step 3: Commit** — `git commit -m "docs(broker-ctrl): annotate callback-resolver external-result boundaries (WS-3)"`

### Task 3.4: broker-sim-adpt + broker-alpaca-adpt event-listeners — partial convert + boundary annotations

**Files:** Modify `services/execution/broker-sim-adpt/src/handlers/event-listener.ts`, `services/execution/broker-alpaca-adpt/src/handlers/event-listener.ts`.

- [ ] **Step 1: Map.** Convert the contract-backed inbound events: `SIM_DEPOSIT_INITIATED` → `DepositInitiatedSchema` (`@nestfolio/investor-adpt/domain`); `ALPACA_TRANSFER_REQUESTED` → `WithdrawalInitiatedSchema` / `DepositInitiatedSchema` by direction (`@nestfolio/investor-adpt/domain`). Annotate as boundaries: `SIM_ORDER_REQUESTED`, `SIM_WITHDRAWAL_REQUESTED`, `ALPACA_ORDER_REQUESTED`, `ALPACA_ORDER_CANCEL_REQUESTED`, `ALPACA_ACCOUNT_CHECK` (broker-ctrl internal routing + external Alpaca, no contract).
- [ ] **Step 2: Failing ZodError test** for the converted branch(es). Run → FAIL.
- [ ] **Step 3: Convert** the contract-backed branches; comment the boundaries. Run: `pnpm nx test broker-sim-adpt broker-alpaca-adpt` — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "refactor(broker adapters): parseSubject contract-backed inbound events; annotate routing/webhook boundaries (WS-3)"`

> NOTE: `broker-ctrl/deposit-withdrawal-normalizer.ts` (the 4 `as Record` casts) is **out of scope** — do NOT touch it.

---

## Phase 4 — Advisory consumers

### Task 4.1: investor-profile-ctrl — event-listener + agent-service + kb-ingestion

**Files:** Modify `services/advisory/investor-profile-ctrl/src/handlers/event-listener.ts`, `src/agent-service.ts`, `src/handlers/kb-ingestion-handler.ts`; tests.

- [ ] **Step 1: event-listener (line ~46).** `MANDATE_ISSUED` → `MandateSchema` (`@nestfolio/investor-adpt/domain`, cross-domain advisory←investor). `INVESTOR_PROFILE_UPDATED` → check `investor-bff/contracts` (cross-domain → `@nestfolio/investor-adpt/domain`); if no contract for it, it is an intra-system investor snapshot read mostly of `ctx`/`operatingMode` — convert what has a contract, else document boundary. Split per event type.
- [ ] **Step 2: agent-service.ts (line ~45) = BOUNDARY.** `runPipeline` reads the SF-direct invocation payload via `event.subject ?? event` — no CDC producer. Add a one-line boundary comment; leave the read. (Do NOT parse — there is no producer schema for the SF-assembled packet.)
- [ ] **Step 3: kb-ingestion-handler.ts (line ~25) — split DECISION_BLOCKED / DECISION_APPROVED.** Both → `ComplianceCheckSchema` from `@nestfolio/compliance-ctrl/contracts` (intra-domain advisory←advisory). `buildNarrative` currently reads `subject.reason` and `subject.riskCategory` — **these are NOT on ComplianceCheck** (it has `violations`, `authorityLevel`). Typing forces the fix: derive the narrative from the real fields (e.g. summarize `subject.violations` for the blocked case; use `subject.authorityLevel` for approved). This is behaviour-preserving in effect (the old reads were `undefined → 'No reason provided'/'unknown'`). Keep `JSON.stringify(subject)` for the full dump.

```typescript
import { parseSubject } from '@nestfolio/event-processor';
import { ComplianceCheckSchema, type ComplianceCheck } from '@nestfolio/compliance-ctrl/contracts';

function buildNarrative(eventType: string, subject: ComplianceCheck): string {
  if (eventType === 'DECISION_BLOCKED') {
    const reasons = subject.violations.map(v => v.description).join('; ') || 'No reason provided';
    return `Decision ${subject.decisionId} blocked: ${reasons}. Authority: ${subject.authorityLevel}. Details: ${JSON.stringify(subject)}`;
  }
  return `Decision ${subject.decisionId} approved at ${subject.authorityLevel}. Summary: ${JSON.stringify(subject)}`;
}
// handler: const subject = parseSubject(payload, ComplianceCheckSchema); const decisionId = subject.decisionId;
```

- [ ] **Step 4: Tests** — adjust kb-ingestion narrative test to the real ComplianceCheck shape (no fake `reason`); add ZodError test. Run: `pnpm nx test investor-profile-ctrl` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "refactor(investor-profile-ctrl): parseSubject event-listener + kb-ingestion; annotate agent-service SF boundary (WS-3)"`

### Task 4.2: market-intelligence-ctrl — event-listener + agent-service + kb-ingestion

**Files:** Modify the three files under `services/advisory/market-intelligence-ctrl/src/`; tests.

- [ ] **Step 1: Read + map.** event-listener (line ~47): identify its trigger event(s) and contract; convert contract-backed reads, else boundary. agent-service.ts (lines ~34, 62) = **boundary** (SF-direct invocation; `upstreamOutputs` read). kb-ingestion-handler.ts (line ~33): same DECISION_BLOCKED/DECISION_APPROVED → `ComplianceCheckSchema` split as Task 4.1 Step 3.
- [ ] **Step 2-3: Convert + test.** Run: `pnpm nx test market-intelligence-ctrl` — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "refactor(market-intelligence-ctrl): parseSubject kb-ingestion + event-listener; annotate agent-service SF boundary (WS-3)"`

### Task 4.3: portfolio-engine-ctrl — event-listener + agent-service + kb-ingestion

**Files:** Modify the three files under `services/advisory/portfolio-engine-ctrl/src/`; tests.

- [ ] **Step 1: Map.** event-listener (lines ~81-82, 164): `CONSTRUCT_PORTFOLIO` = **boundary** (SF-direct orchestration putEvents, reads `investorProfile`/`marketAnalysis`/`taskToken`); `SEC_PROSPECTUS_UPDATED`/`SEC_10K_UPDATED` KB triggers = **boundary**. agent-service.ts (line ~34) = **boundary** (SF invocation). kb-ingestion: convert DECISION_* against `ComplianceCheckSchema` if present (verify which events this service's KB handler consumes; mirror Task 4.1 Step 3).
- [ ] **Step 2-3: Annotate boundaries; convert any contract-backed reads; test.** Run: `pnpm nx test portfolio-engine-ctrl` — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "refactor(portfolio-engine-ctrl): parseSubject contract-backed reads; annotate SF/KB boundaries (WS-3)"`

### Task 4.4: advisory-narrative-ctrl — event-listener + agent-service + feedback-correlator

**Files:** Modify the three files under `services/advisory/advisory-narrative-ctrl/src/`; tests.

- [ ] **Step 1: Map.** event-listener (lines ~89-91): `GENERATE_NARRATIVE` = **boundary** (SF-direct). agent-service.ts (line ~33) = **boundary**. feedback-correlator.ts (line ~19): `DECISION_FEEDBACK` = **boundary** (AppSync mutation, no producer CDC contract).
- [ ] **Step 2-3: Annotate all three as boundaries** (this service has no contract-backed consumer read). Confirm no behavior change. Run: `pnpm nx test advisory-narrative-ctrl` — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "docs(advisory-narrative-ctrl): annotate SF/AppSync consumer boundaries (WS-3)"`

### Task 4.5: compliance-ctrl/event-listener.ts

**Files:** Modify `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` (lines ~36, 157); test.

- [ ] **Step 1: Map.** `RECOMMENDATION_PROPOSED` → `RecommendationProposedSchema` from `@nestfolio/decision-workflow-ctrl/contracts` (intra-domain). It reads `proposedTrades`, `portfolioValueCents`, `currentPositions`, `riskCategory`, `isInitialBuild`, `taskToken`, `decisionId` — all on the schema.
- [ ] **Step 2: Failing ZodError test** (subject missing `taskToken`/`proposedTrades`). Run → FAIL.
- [ ] **Step 3: Convert** the two read sites via `parseSubject(payload, RecommendationProposedSchema)`. Run: `pnpm nx test compliance-ctrl` — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "refactor(compliance-ctrl): parseSubject RECOMMENDATION_PROPOSED (WS-3)"`

### Task 4.6: decision-workflow-ctrl/sfn-callback.ts

**Files:** Modify `services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts` (~lines 27/49/64/96); test.

- [ ] **Step 1: Map each callback branch** (intra-domain advisory imports):
- `PORTFOLIO_COMPLETED` / `PORTFOLIO_FAILED` → `PortfolioAgentCompletionSchema` / `PortfolioAgentFailureSchema` from `@nestfolio/portfolio-engine-ctrl/contracts` (verify exact exported names; they were shipped by `advisory-agent-event-contract-coverage`).
- `NARRATIVE_COMPLETED` / `NARRATIVE_FAILED` → `Narrative*` schemas from `@nestfolio/advisory-narrative-ctrl/contracts`.
- `DECISION_APPROVED` / `DECISION_BLOCKED` → `ComplianceCheckSchema` from `@nestfolio/compliance-ctrl/contracts`. NOTE: the current code reads `subject.reason` for `blockReason` — `ComplianceCheck` has **no `reason`** (it has `violations`). This is the known `dwc-sfn-callback-reason-blockreason-gap` (LATER). Per out-of-scope "no behavioral changes": type the read against `ComplianceCheckSchema`; where `subject.reason` no longer compiles, set `blockReason` from `violations` (first BLOCKING violation's `description`) to preserve the *intent*, and leave a `// see dwc-sfn-callback-reason-blockreason-gap` comment. If you prefer zero behavior change, set `blockReason` to `undefined`/`null` exactly as the old `undefined` read produced and note it — pick the behaviour-identical option and flag the bug, do not silently "fix" beyond what typing forces.
- `USER_CONFIRMED` / `USER_REJECTED` → `UserConfirmationSchema` / `UserRejectionSchema` from `@nestfolio/advisory-bff/contracts` (intra-domain). taskToken may be absent on the event (lifted from the readback pre-step) — `taskToken: z.string().optional()` already models this.
- [ ] **Step 2: Failing ZodError test** for one completion branch. Run → FAIL.
- [ ] **Step 3: Convert** each branch via `parseSubject`. Run: `pnpm nx test decision-workflow-ctrl` — Expected: PASS.
- [ ] **Step 4: Commit** — `git commit -m "refactor(decision-workflow-ctrl): parseSubject sfn-callback branches per producer schema (WS-3)"`

---

## Phase 5 — Verification

### Task 5.1: Repo-wide residual sweep

- [ ] **Step 1: Confirm zero stray casts in consumers**

Run: `grep -rnE 'subject.*as Record<string,\s*unknown>|\.subject \?\? (event|\{\})' services/*/*/src --include='*.ts' | grep -v test`
Expected: only the 4 out-of-scope `broker-ctrl/deposit-withdrawal-normalizer.ts` lines and the documented-boundary sites (each now carrying a boundary comment). No other matches.

- [ ] **Step 2: Confirm `opaqueSubject` is still absent**

Run: `grep -rn 'opaqueSubject' .` — Expected: NO matches (it must never be (re)introduced).

### Task 5.2: Build-tripwire proof (payload change breaks a consumer build)

- [ ] **Step 1: Temporarily rename a producer field**

In `services/ledger/ledger-ctrl/src/domain/contracts.ts`, rename `BalanceUpdatedSchema`'s `cashBalanceCents` → `cashBalanceCentsX` (temporary).

- [ ] **Step 2: Verify a consumer build breaks**

Run: `pnpm nx typecheck ledger-bff` (the converted balance-updated transform reads `payload.cashBalanceCents`)
Expected: FAIL — `Property 'cashBalanceCents' does not exist`. This proves the tripwire.

- [ ] **Step 3: Revert the rename** and re-run typecheck — Expected: PASS. Do NOT commit the temporary rename.

### Task 5.3: nx affected gate

- [ ] **Step 1:** Run: `pnpm nx affected -t test,lint --base=origin/main` — Expected: PASS across all affected projects.
- [ ] **Step 2: Commit** any lint autofixes if produced.

### Task 5.4: Deploy + scoped e2e (the USER_CONFIRMED order-execution gate)

- [ ] **Step 1: Deploy affected services to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=<affected from detect-deploy-needed>`
(execution-ctrl, investor-ctrl, ledger-ctrl, compliance-ctrl, decision-workflow-ctrl, the advisory agent services, broker adapters, and the 3 adapters whose `/domain` changed — confirm via `node .claude/skills/backlog-next/detect-deploy-needed.mjs`.)

- [ ] **Step 2: Run the involved e2e scenarios only** (NOT the full suite, NOT Playwright)

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features --testPathPatterns='<user-confirmed-order-execution scenario>'`
Expected: PASS — validates `parseSubject(UserConfirmationSchema)` + the `decisionId` fallback against the REAL advisory-bff producer (USER_CONFIRMED → order). If it fails-then-passes on rerun, pull CloudWatch evidence from the failing window and run a confirmation pass before continuing ([[feedback-flake-means-broken]]).

- [ ] **Step 3:** Run any other scenarios touching converted consumers (notification creation, ledger snapshot, compliance). Confirm green.

---

## Self-review checklist (run after drafting, before execution)

- [ ] Every file from the WS-3 inventory has a task (execution-ctrl, broker-ctrl mode/callback/sim/alpaca, ledger-ctrl, reconciliation-ctrl, investor-ctrl listener+lifecycle, IP/MI/PE/AN listener+agent-service+kb-ingestion, AN feedback-correlator, compliance-ctrl, dwc sfn-callback). ✔
- [ ] The 4 broker-ctrl normalizer casts are explicitly NOT touched. ✔
- [ ] Each cross-domain consumer import uses the producer-domain adapter `/domain` (Phase 0 supplies the re-exports). ✔
- [ ] The captured intent (USER_CONFIRMED `decisionId` fallback) has its own regression test (Task 3.1 Step 1). ✔
- [ ] Boundaries are commented, not silently skipped (Task list + boundary table). ✔
- [ ] Build-tripwire is proven (Task 5.2). ✔
- [ ] No `parseSubjectByType` lib primitive was added (per the locked decision). ✔

## Execution dependency order

Phase 0 → (Phases 1–4 are independent of each other, parallelizable per service) → Phase 5. Phase 0 MUST precede any cross-domain consumer task. Within a service, do the listed files together (one commit may cover several when they share imports).
