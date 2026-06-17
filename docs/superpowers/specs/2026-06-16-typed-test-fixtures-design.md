# Typed Test Fixtures — Design

- **Date:** 2026-06-16
- **Status:** Approved (design); implementation pending plan
- **Epic:** `typed-test-fixtures` (new delivery epic)
- **Topic dossier:** `project_event_subject_contracts.md` (this is the test-layer completion of the typed-subject program)

## 1. Motivation

The typed-subject program (shipped 2026-06-08) made production code type-safe against
**producer-owned zod contracts**: producers emit `BusEvent<T, S>` where `T` is the DRY subject
and identity lives in `context: S` (`RequestContext`); consumers read the subject via
`parseSubject(payload, ProducerSchema)`. Rows are `TableEntry<T, S>`.

The **test fixtures were left untyped.** `EventBridgeClient.putEvent({ detail: Record<string, unknown> })`
and `TableAssertions.waitForItem({ match: Record<string, unknown> })` bypass the producer
contracts entirely, so a fixture whose subject does not match the producer's schema **compiles
and passes integration, only failing against the real producer** — exactly the standing lesson
recorded in `project_event_subject_contracts.md` ("validate contracts vs the REAL producer, NOT
fixtures — schema+fixture co-wrong passed integration, e2e caught it").

Two concrete instances of this class surfaced while validating the
`compliance-ctrl-mandate-snapshot-parse-subject` workstream (member 2 of the
`typed-subject-consumer-contract-gaps` epic), both **pre-existing** (proven identical on
`origin/main`, not caused by that change):

- **Bug A — identity in the subject (integration).** The compliance-ctrl integration mandate
  fixtures put a per-test `userId` in the event **subject** (`detail`) and poll the MandateSnapshot
  row keyed by it. But the handler correctly keys by `ctx.userId` (the **context**, per the DRY-subject
  design — commit `c043f043` "key MandateSnapshot by ctx.userId not tenantId; DRY subject lacks
  userId; e2e-found"). `putEvent` builds the event context from the shared suite `ctx` with no
  per-call override, so every test writes one shared-userId row and polls for per-test-userId rows
  that never exist. The whole suite has been red since the DRY-subject migration, undetected because
  integration runs against deployed dev manually, not in the unit gate.

- **Bug B — missing required subject fields (e2e).** The `update-operating-mode` e2e emits a
  synthetic `RECOMMENDATION_PROPOSED` whose subject omits `isInitialBuild` (boolean) and
  `riskCategory` (string), both **required** by `RecommendationProposedSchema` since WS-3
  (`6ea8b86b`). `parseSubject` throws `ZodError` at runtime → no `ComplianceCheck` → e2e timeout.

Had the fixtures been typed against the producer schemas, **both bugs would have been compile
errors.** This program closes that gap workspace-wide.

## 2. Goal & non-goals

**Goal.** Every test fixture (unit / integration / e2e) is type-checked against the producer-owned
zod contracts so that, at **compile time**:

- a missing/extra/mistyped subject field is an error (catches Bug B),
- an identity field placed in the subject is an excess-property error, and per-test identity is
  forced into a typed context parameter (catches Bug A),
- an unknown/misspelled event name is an error,

with a **runtime `schema.parse()` backstop** in the harness so any dynamic/cast escape still throws.

**Non-goals.**

- Changing any production contract, producer emission, or consumer (`parseSubject`) code. This
  program types the **test layer only**; if a co-wrong fixture turns out to hide a real
  producer/consumer contract bug, that bug is filed separately, not fixed under this program's
  mechanism work.
- Replacing the existing typed-subject capstone gate (`check-typed-subjects.mjs`). This program is
  its test-layer sibling.

## 3. Mechanism (Phase 0 — the reusable core)

### 3.1 Producer-owned event→schema maps

Each producer service exports a typed map from **event name (detailType) → producer subject schema**,
co-located with its existing contracts and extending the 21 existing `publisher-schemas`
(`__typename → schema`) registries down to the event-name level:

```ts
// services/investor/investor-bff/src/contracts/event-subjects.ts  (exported via @nestfolio/investor-bff/contracts)
export const investorBffEventSubjects = {
  MANDATE_ISSUED:        MandateSchema,
  OPERATING_MODE_CHANGED: MandateSchema,
  MANDATE_REVOKED:       MandateSchema,
  MANDATE_REAFFIRMED:    MandateSchema,
  // … one entry per emitted detailType
} as const satisfies Record<string, ZodTypeAny>;
```

The source of truth stays with the producer (DRY), consistent with the producer-owned-contracts
architecture. Intra-domain producers export via `@nestfolio/<svc>/contracts`; cross-domain consumers
compose via the producer-domain adapter `@nestfolio/<svc>-adpt/domain` re-export (the same home rule
the production code follows). Both import patterns are already allowlisted by nx boundaries (§5).

### 3.2 Composed registry

A new small test lib (`libs/test-contracts`, `scope:platform`/`scope:shared` so every test may depend
on it) composes the producer maps into one typed registry:

```ts
export const EventSubjects = {
  ...investorBffEventSubjects,
  ...decisionWorkflowEventSubjects,
  ...complianceEventSubjects,
  // … all producers
} as const;

export type EventName = keyof typeof EventSubjects;
export type SubjectOf<K extends EventName> = z.infer<(typeof EventSubjects)[K]>;
```

### 3.3 Typed `putEvent`

`EventBridgeClient.putEvent` becomes generic over the event name:

```ts
async putEvent<K extends EventName>(params: {
  bus: string;
  targetService: string | string[];
  detailType: K;
  subject: SubjectOf<K>;                 // DRY producer type — identity-in-subject is an excess-property error
  context?: Partial<RequestContext>;     // typed per-test identity override (fixes Bug A)
  eventId?: string;
}): Promise<void>
```

- `subject: SubjectOf<K>` makes missing/extra/wrong subject fields and bad event names compile errors.
- `context?` lets a test set per-test `userId`/`tenantId` in the event **context** (where the handler
  reads identity), eliminating the "identity in the subject" anti-pattern.
- Runtime backstop: `putEvent` runs `EventSubjects[detailType].parse(subject)` before sending, so any
  dynamic or `as`-cast caller still throws.

The constructed envelope is exactly the existing `BusEvent<SubjectOf<K>, RequestContext>` — no new
shape; the context merges `ctx` defaults with the per-call `context` override.

### 3.4 Typed read side

`TableAssertions.waitForItem`/`assertItem` become generic over the row type:

```ts
async waitForItem<T extends object>(params: {
  table: string; pk: string; sk: string;
  match?: Partial<TableEntry<T>>;        // typed against the row contract
  predicate?: (item: TableEntry<T>) => boolean;
  timeoutMs?: number;
}): Promise<TableEntry<T>>
```

This makes wrong-shaped row assertions compile errors. (Bug A's root fix is the §3.3 context param;
the typed read side is the complementary protection on the assertion side.)

## 4. Phasing (full workspace retrofit)

| Phase | Scope | Notes |
|-------|-------|-------|
| **0** | Mechanism (§3) + **compliance-ctrl** fixtures retrofit | Proof of mechanism; **fixes Bug A + Bug B**. |
| **1** | Investor domain fixtures | per-producer maps + fixture migration |
| **2** | Advisory domain fixtures | (compliance-ctrl already done in Phase 0; remaining advisory services) |
| **3** | Execution domain fixtures | |
| **4** | Ledger domain fixtures | |

~290 `putEvent` call-sites across 48 files total. Each phase is an epic member: add that domain's
producer event-subject maps, migrate its fixtures to the typed API, and fix every co-wrong fixture the
compiler surfaces.

## 5. Compatibility verification (done before approval)

- **nx module boundaries:** `eslint.config.js` `@nx/enforce-module-boundaries` has a global `allow`
  list containing `@nestfolio/.+/contracts` and `@nestfolio/.+-adpt/domain` — these import patterns
  bypass the tag-based `depConstraints`, so `test-contracts`/`test-support` (libs) and service test
  files may import producer schemas with no violation. Precedent: 11 test files already import
  `@nestfolio/<svc>/{contracts,domain}` and lint clean.
  - **CORRECTION (Phase 0, 2026-06-17):** this analysis covered the tag-based `depConstraints` but
    **missed the separate circular-dependency rule**. Because `test-support` depends on `test-contracts`,
    and `test-contracts` imports producer-service `/contracts` whose *tests* import `test-support` (and
    producers reference each other, e.g. `decision-workflow-ctrl` ← `compliance-ctrl`), nx flags a
    **test-only** cycle (production graph is acyclic — these libs are never bundled). Resolved once for
    all phases with `ignoredCircularDependencies: [['test-contracts', '*']]` in `eslint.config.js`. NB:
    the nx cache masks this — verify fixture-touching lint with `--skip-nx-cache`.
- **typed-subject C2 gate:** `check-typed-subjects.mjs` is scoped to `services/**/src + libs/**/src`
  and excludes `.test.ts`/`.spec.ts` + test dirs, so fixtures importing producer schemas cross-domain
  do not trip cross-domain-import. (Consequence: the home rule in fixtures is convention-only unless
  the gate is extended — see §6.)
- **Recent typings refactoring:** the typed `putEvent` builds the existing `BusEvent<T, RequestContext>`
  using the **same** producer schemas `parseSubject` consumes (single source of truth), with the DRY
  subject and identity-in-context — it reinforces, not conflicts with, the event-subject-contracts model.

## 6. Regression lock-in

Once a domain is migrated, add a gate forbidding raw/untyped `putEvent` payloads (`detail:
Record<string, unknown>` or `as`-cast subjects) in that domain's fixtures — the test-layer analogue of
the typed-subject capstone. Optionally extend the cross-domain-import check to **test fixtures** so the
home rule (intra-domain `/contracts` vs cross-domain `-adpt/domain`) is enforced rather than convention.

## 7. Bug-triage strategy

The retrofit will surface many co-wrong fixtures as compile errors. Each is classified:

- **(a) fixture-only** — the fixture was wrong; correct it to satisfy the producer contract (expected
  majority).
- **(b) latent contract bug** — the co-wrong fixture was hiding a real producer/consumer mismatch
  (e.g. Bug B *iff* the real decision producer also omits `isInitialBuild`/`riskCategory`). File via
  `backlog-add`; fix or queue separately. This program's mechanism work does not change production code.

Each phase **logs the count + (a)/(b) split** — no silent truncation of surfaced issues.

## 8. Testing

- The mechanism is TDD'd: a fixture omitting a required subject field must **fail to compile** —
  pinned with an `@ts-expect-error` type-test (or `tsd`) asserting the negative; the runtime
  `parse()` backstop is unit-tested for the throw path.
- Each retrofit phase is validated by that domain's existing integration/e2e suites going green
  (the typed fixtures make "green" trustworthy for the first time).

## 9. Out of scope

- Production contract/producer/consumer changes (test layer only — see §2 non-goals).
- The `ledger-ctrl-live-tax-lot-missing-order-fields` member of the `typed-subject-consumer-contract-gaps`
  epic (a genuine producer/consumer fork — separate workstream).
- The `dwc-sfn-callback-reason-blockreason-gap` behavioral residual (re-homed; separate).

## 10. Relationship to prior work & epic structure

- `compliance-ctrl-mandate-snapshot-parse-subject` (member 2) shipped independently on 2026-06-16
  (`ca14120a`); its `parseSubject` conversion is validated. Bugs A + B were discovered during its
  validation and are owned by **Phase 0** of this program.
- New delivery epic `typed-test-fixtures`: members = Phase 0 (mechanism + compliance-ctrl, fixes A+B)
  and the four domain retrofit waves.
- The `typed-subject-consumer-contract-gaps` epic continues with its remaining open core member
  (`ledger-ctrl-live-tax-lot-missing-order-fields`).
