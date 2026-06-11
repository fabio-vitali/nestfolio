# CDC publisher typed row → DRY subject (WS-2) — Design

- **Date:** 2026-06-11
- **Status:** design (approved decisions; ready for writing-plans)
- **Backlog:** `docs/backlog/cdc-publisher-typed-subjects.md`
- **Program:** WS-2 of the typed-subject program — strategy `docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md` § "WS-2"
- **Depends on:** WS-1 (`typed-subject-producer-contracts`, shipped) + phase-0 (`typed-subject-platform-context-taxonomy`, shipped)

## Problem

Every producer now exports a DRY zod subject contract (WS-1, `@nestfolio/<svc>/contracts`)
that types both the persisted row (`TableEntry<Subject>`) and the emitted event
(`BusEvent<Subject>`). But the CDC publisher path does not use them.

All 21 `*-egress` services run a single shared pipeline — `changeDataCapture()` in
`libs/event-processor/src/pipelines/change-data-capture.ts` — invoked as a bare one-liner
in each `services/*/src/handlers/event-publisher.ts`. That pipeline emits the **whole
DynamoDB stream row as the event subject** (`buildEntry`, change-data-capture.ts:129:
`subject: transform ? transform(record, eventType) : record`). `StreamRecord` types every
business field as `unknown` (`[key: string]: unknown`), so:

- the publisher emits an **untyped, un-validated superset** of the contract — envelope
  fields (`pk`/`sk`/`__typename`/`createdAt`/`ttl`/`version`) and identity (`tenantId`/
  `userId`/`region`, already carried in `context`) leak onto every event;
- there is **no compile-time coupling** between what a producer persists and the contract
  WS-3 consumers will parse against — a producer payload change does not break the publisher;
- there is **no runtime verification** that a real persisted row actually satisfies its
  contract (the program's #1 risk: schema-vs-reality drift).

No service currently passes any `changeDataCapture()` config (verified: 0 of 21 use
`transform` or `groupBy` on egress).

## Goal

Every CDC publisher works with **strictly-typed subjects**: it types each stream row as
`TableEntry<Subject>`, **parses/validates** it against the producer's WS-1 contract keyed by
`__typename`, and **emits the DRY parsed subject** — no `as Record` on rows or emitted
subjects, and a producer schema change breaks the publisher build.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where parsing lives | **Declarative `schemas` registry** in the shared pipeline. Each handler passes `changeDataCapture({ schemas: { <__typename>: <Schema> } })`; all parse logic stays once in `event-processor`. |
| 2 | Emitted wire shape | **Exact DRY** — `subject = Schema.parse(row)`. The subject **is** the contract; envelope/identity/internal fields are dropped. |
| 3 | Workstream shape | **One workstream, phased internally by domain** (Ledger → Investor → Execution → Advisory); shared-lib change lands once; one closing deploy + scoped e2e. |
| 4 | §6 consumer policy | WS-2 stays consumer-code-free **by default**. Only if the closing e2e gate reveals a **critical trigger-chain** consumer hard-breaking on the DRY wire does a **minimal surgical read-fix** (e.g. `subject.tenantId` → `context.tenantId`) travel with WS-2 as a blocker-fix; the full `parseSubject` conversion stays in WS-3. |
| 5 | WS-1 coverage gap | **Exempt + file** (see § "WS-1 coverage gap & exemptions"). WS-1 left ~14 advisory-core agent-internal `__typename`s with no row-level zod contract. WS-2 types every covered `__typename` and registers the uncovered ones in a per-handler `exemptTypenames` set (they emit the status-quo fat row, no crash, no regression). Authoring those contracts is the filed `advisory-agent-event-contract-coverage` item (rank 7), **not** WS-2. |

## Architecture

### 1. The shared-library change (lands once)

`libs/event-processor/src/pipelines/change-data-capture.ts`:

```ts
import type { ZodType } from 'zod';

export interface ChangeDataCaptureConfig {
  groupBy?: { key: (record: StreamRecord) => string; pick?: 'first' | 'last' };
  bus?: string;
  concurrency?: number;
  schemas?: Record<string, ZodType>;   // keyed by __typename → producer WS-1 contract
  exemptTypenames?: string[];          // emitted __typenames knowingly without a contract (Decision 5)
}
```

- The existing `transform?` seam is **removed** (no service uses it; `schemas` supersedes it —
  [[no-deprecation]]).
- `buildEntry` changes its one subject line. A covered `__typename` emits the DRY parsed
  subject; an **exempt** `__typename` (no schema, listed in `exemptTypenames`) emits the
  status-quo fat row unchanged. The cold-start guard (§3) guarantees a `__typename` reaches the
  `: record` branch *only* if it is explicitly exempt — a forgotten schema crashes at init, it
  does not silently emit fat.

  ```ts
  // before: subject: transform ? transform(record, eventType) : record
  // after:
  const schema = schemas[record.__typename];
  const subject = schema ? schema.parse(record) : record;     // covered → DRY (throws on drift); exempt → fat row
  // detail.subject = subject
  // detail.previousSubject:
  //   emission.previousSubject
  //     ? (schema ? schema.parse(emission.previousSubject) : emission.previousSubject)
  //     : undefined
  ```

  Both the `processRecord` and `processGroup` (groupBy) code paths route through `buildEntry`,
  so both are covered with the one change. `context` is still built separately from
  `record.tenantId/userId/region` — **unchanged**.

- `StreamRecord` reads inside `resolveEmissions` (the `passthrough`/`fieldDispatch` field
  lookups at lines 85/112) stay as-is — they read the *routing* field (e.g. an event-name
  discriminator), not the subject payload; they are not the `as Record` casts WS-2 targets.
  WS-2's casts-of-interest are the **emitted subject** (now typed via `schema.parse`) and the
  per-service row typing (below).

### 2. The per-service change (×21, the only repetitive part)

Each `services/*/src/handlers/event-publisher.ts` goes from:

```ts
import { changeDataCapture } from '@nestfolio/event-processor';
export const handler = changeDataCapture();
```

to (worked example — ledger-ctrl, whose egress emits `BalanceEvent`/`PortfolioEvent`/
`LedgerEntryEvent` rows):

```ts
import { changeDataCapture } from '@nestfolio/event-processor';
import {
  BalanceUpdatedSchema, PortfolioUpdatedSchema, LedgerEntryRecordedSchema,
} from '@nestfolio/ledger-ctrl/contracts';

// Exported (not just inlined) so the per-service unit test can assert registry completeness.
export const subjectSchemas = {
  BalanceEvent: BalanceUpdatedSchema,
  PortfolioEvent: PortfolioUpdatedSchema,
  LedgerEntryEvent: LedgerEntryRecordedSchema,
};
export const handler = changeDataCapture({ schemas: subjectSchemas });
```

An advisory-core service that also has exempt `__typename`s additionally exports + passes an
`exemptTypenames` array, e.g. portfolio-engine-ctrl:

```ts
export const subjectSchemas = {};                              // no row-level contract covers any emitted type yet
export const exemptTypenames = ['AgentInvocation', 'ReasoningOutput', 'AgentCompletion', 'AgentFailure'];
export const handler = changeDataCapture({ schemas: subjectSchemas, exemptTypenames });
```

The `schemas` map keys are the **same `__typename` keyspace** as the CDK `Egress` construct's
existing `eventTypes` map (build-time event-name mapping ‖ runtime subject validation). The
**imports create the compile-time coupling**: a producer contract change breaks this handler's
build.

**Home rule (corrected):** a publisher emits its *own* service's rows, so it imports the
**producer-owned** contract for each — which lives either in the service's own
`@nestfolio/<svc>/contracts` (the common case) **or** in the service's **own domain adapter**
for cross-domain-consumed events (e.g. investor-bff imports `Mandate`/`DepositIntent`/
`WithdrawalIntent`/`ExecutionModeChange` schemas from `@nestfolio/investor-adpt/contracts`;
broker-ctrl imports `FundingSnapshotSchema` from `@nestfolio/execution-adpt/domain`). Both are
**intra-domain** (same domain, different service) — so **WS-2 introduces no cross-*domain*
imports and no project-cycle risk** (unlike consumers in WS-3).

### 3. Registry completeness guard

Forgetting a schema for a mapped row type must fail loudly, never silently emit untyped. A
`__typename` may be emitted only if it has a registered schema **or** is explicitly exempt
(Decision 5) — anything else is a registration bug. Two layers enforce this:

- **Cold-start assertion (authoritative, runtime):** at handler init, derive the distinct
  `__typename` set from the `EVENT_TYPE_MAP` env var keys (`${__typename}:${ACTION}`) and assert
  each is in `schemas` **or** in `exemptTypenames`; throw at init otherwise. A forgotten schema
  crashes the Lambda cold-start (caught by deploy smoke / e2e), so the `: record` fat-emit branch
  in §1 is reachable *only* for a deliberately-exempt type.
- **Per-service unit test (pre-deploy):** the handler exports `subjectSchemas` (and
  `exemptTypenames` where present). The test asserts
  `Object.keys(subjectSchemas) ∪ exemptTypenames` equals the service's emitted `__typename` set
  (written explicitly in the test, mirroring the CDK `eventTypes` keys) — catching a
  forgotten / extra / mis-keyed schema at test time, before a deploy cycle.

### 4. Error handling — parse failure is non-retryable poison → DLQ

A row that fails its schema parse is deterministic drift (won't fix on retry). The `schema.parse`
throw is wrapped as a **`NotRetryableError`** with a clear message
(`publisher subject contract violation: <__typename>`), so the engine's existing
bisect/retry/DLQ machinery routes it **straight to the egress DLQ** without wasted retries, and
isolates it to the offending record (the batch continues). **This throw is the program's
#1-risk verification:** a real row that drifts from its contract emits nothing and surfaces
loudly. (Plan verifies `EgestionEngine` honors `NotRetryableError` for per-record isolation.)

## Data flow (after WS-2)

```
DDB stream record (TableEntry<Subject> + envelope)
  → EgestionEngine unmarshals → StreamRecord
  → resolveEmissions(record, ...) → [{ eventType, previousSubject? }]   (routing only; unchanged)
  → buildEntry:
       schema   = schemas[record.__typename]                            (cold-start-guaranteed present)
       subject  = schema.parse(record)                                  (DRY; throws→NotRetryable→DLQ)
       context  = { tenantId, userId, region }  from record             (unchanged)
       → EventBridge PutEvents { subject: <DRY>, context }
```

## Validation strategy

The contract is **validate against the REAL emission, not fixtures** ([[event-subject-contracts]]
— a schema co-wrong with its fixture passed integration; only e2e caught it).

- **Unit (comprehensive — every `__typename`, fast, no deploy):** drive
  `changeDataCapture({ schemas, exemptTypenames })` per service with a realistic row fixture and
  assert: (a) a **covered** `__typename`'s emitted `subject` **strict-equals** `Schema.parse(row)`
  and carries **no envelope keys** (`pk`/`sk`/`__typename`/identity absent); (b) a drifted row
  throws `NotRetryableError`; (c) an **exempt** `__typename` emits the fat row unchanged; (d) the
  registry-completeness cross-check (covered ∪ exempt = emitted set). Unit tests prove the DRY
  transform *mechanics* deterministically.

- **e2e #1-risk gate (reuse + execute the existing 4 `*-contract-emission.e2e.test.ts`):** these
  already drive **real producer flows** (e.g. `onboarded()` + `withHoldings()` → real
  `ORDER_FILLED` → ledger CDC) and assert the **real persisted row** parses against the
  contract. Under DRY-by-construction emission, *a real row that parses ⟹ the emitted DRY subject
  is well-formed*, so these remain the right real-row-vs-contract gate. WS-2:
  1. **executes** them against deployed dev at the closing phase (they are currently typecheck-only
     stubs — "*gated by the closing task*", ledger gate header line 26);
  2. **updates their now-false semantics** — the "*the CDC publisher emits the whole DDB row as the
     event subject*" comment (in each gate + in `helpers/contract-assert.ts`) becomes
     "*the publisher emits `schema.parse(row)`; a row that parses proves the emitted DRY subject is
     well-formed*".

- **End-to-end DRY-wire proof (one representative event per domain):** to honor the strategy's
  literal "real row → real **emitted event**" wording and prove the wire is DRY end-to-end (not
  just by construction), capture the **actual emitted EventBridge event** for one representative
  event per domain and **strict-assert** its `subject` matches the contract (no envelope keys).
  Reuse the existing e2e trap pattern (`apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts`,
  already used by the profile e2e scenarios) — generalize it to a small per-domain emission
  capture rather than building new infrastructure.

## WS-1 coverage gap & exemptions (Decision 5)

The `__typename` → WS-1-schema mapping extraction (2026-06-11) found that **most** emitted
`__typename`s have a row-level contract — all of Ledger, the advisory feed adapters,
onboarding-bff, investor-ctrl, execution-ctrl, the primary advisory subjects — but the **WS-1
advisory slice left ~14 advisory-core agent-internal / projection `__typename`s with no
row-level zod contract**: `AgentInvocation`, `ReasoningOutput`, `AgentCompletion`,
`AgentFailure`, `AgentOutput`, `AuditArtifact`, `AdvisoryStatus`, `UserInteraction` (across the
7 advisory-core services). `AgentCompletion` is the subtle case — `PortfolioAgentOutputSchema`/
`NarrativeAgentOutputSchema` type the `agentOutput` *field*, not the row, so they cannot parse
the `AgentCompletion` row subject.

Per **Decision 5 (exempt + file)**: WS-2 registers each uncovered `__typename` in its service
handler's `exemptTypenames` (emits the status-quo fat row, no crash, no regression) and does
**not** author the missing contracts. Authoring them is the filed, top-of-QUEUED
`advisory-agent-event-contract-coverage` item (6 consumer-having events to type as priority; 8
consumer-less telemetry to type-or-stop-emitting). The exemption is **transitional**: the wire
is mixed (most events DRY, the exempted advisory-core ones still fat) until that follow-up
drains the registry. The exact exemption list is **finalised during execution** — each advisory
candidate row is parse-tested against any existing schema; if it does not cleanly type the row,
it is exempted and confirmed present in the filed item.

## Phasing (one workstream, internal commits)

1. **Shared-lib change** (`change-data-capture.ts` `schemas` + `exemptTypenames` params + DRY
   `buildEntry` + completeness guard + `NotRetryableError`) + its unit tests. Lands once.
2. **Ledger** (2 publishers): `ledger-ctrl`, `reconciliation-ctrl`. Smallest, fully covered —
   proves the per-service pattern end-to-end. Run the ledger contract-emission gate.
3. **Investor** (3): `investor-ctrl`, `investor-bff` (imports 4 schemas from
   `investor-adpt/contracts`), `onboarding-bff`.
4. **Execution** (4): `execution-ctrl`, `broker-ctrl` (imports `FundingSnapshotSchema` from
   `execution-adpt/domain`), `broker-alpaca-adpt`, `broker-sim-adpt` (live-money path — validate
   against the real broker emissions).
5. **Advisory** (12): the 5 feed adapters + the 7 advisory-core services. The feeds +
   advisory-bff/decision-workflow-ctrl/compliance-ctrl/IP/MI primary subjects get schemas; the
   ~14 agent-internal `__typename`s get `exemptTypenames`. Richest slice (`RegionContext`,
   bare-global feeds, the exemption set).
6. **Closing deploy + scoped e2e** (the 4 contract-emission gates + representative DRY-wire
   captures + a representative full-flow smoke per domain to surface §6 hard-breaks).

The plan enumerates each service's exact `eventTypes`-`__typename` → WS-1-schema (or exempt)
mapping (from each `service.stack.ts` Egress config + the service's `contracts.ts`).

## Risks

1. **§6 — WS-2→WS-3 wire-shape window (the one real risk).** Emitting DRY before consumers
   migrate (WS-3) breaks any not-yet-migrated consumer that reads an **envelope field off the
   subject** (`subject.tenantId`, `subject.__typename`, …), including **trigger-chain** consumers
   inside the e2e flows. Bounded: most consumers read identity from `context`, not subject; dev is
   disposable; the gate (not assumption) decides. **Mitigation:** the per-domain phasing runs each
   domain's gate + smoke right after its publishers go DRY; per Decision 4, a minimal surgical
   consumer read-fix travels with WS-2 only when a critical-path consumer hard-breaks (honors
   [[feedback-e2e-gaps-queued-not-parking]] — an e2e-blocking break can't be parked).
2. **Schema-vs-reality** — mitigated by the real-emission gate above, not fixtures.
3. **`NotRetryableError` per-record isolation** — plan confirms `EgestionEngine` routes a single
   record's `NotRetryableError` to DLQ without failing the whole batch.
4. **Missing/extra contract (RESOLVED — Decision 5).** ~14 advisory-core `__typename`s have no
   row-level WS-1 contract → exempted via `exemptTypenames` + filed as
   `advisory-agent-event-contract-coverage` (rank 7). Correcting a contract that demonstrably
   does not match the real row remains in scope (WS-2's verification purpose); authoring net-new
   contracts is the filed item, not WS-2.

## Out of scope

(Mirrors the backlog `out_of_scope:`.)

- WS-3 consumer-side `parseSubject` conversions (event-listener handlers, BFF transforms,
  agent-services reading `event.subject`) — the `consumer-parse-subject` workstream. Exception:
  the Decision-4 minimal surgical read-fix when a critical-path consumer hard-breaks the gate.
- The enforcement capstone (lint rule / `tools/` check-script / `create-*`/`audit-*` skill +
  arch-doc updates) — `typing-convention-enforcement-skills-docs`.
- Fixing the latent producer/normalizer/consumer drift **bugs** the program surfaced
  (`broker-funding-completed-normalization-drift`, `dwc-sfn-callback-reason-blockreason-gap`, …) —
  WS-2 types only the publisher emission path; file-and-continue if more surface.
- Re-designing or net-new-authoring WS-1 contracts (the ~14 advisory-core gaps → filed
  `advisory-agent-event-contract-coverage`, Decision 5).
- Unrelated QUEUED items (`nx-affected-true-affected-resolver`,
  `dashboard-live-push-position-snapshots`, …).

## Done

Every CDC publisher imports its producer contracts and emits the **DRY parsed subject** for every
**covered** `__typename`; the ~14 uncovered advisory-core `__typename`s are registered in
`exemptTypenames` (emit fat, tracked in the filed coverage item) and every emitted `__typename` is
either covered or exempt (completeness guard green); no generic `Record` casts in the publisher
path; a producer schema change breaks the publisher build; the `NotRetryableError` drift-to-DLQ is
in place; publisher unit tests + the executed contract-emission e2e gates (with representative
DRY-wire captures) are green against deployed dev.
