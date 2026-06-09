# Typed-Subject Producer Contracts (WS-1) — Design

- **Date:** 2026-06-09
- **Status:** design (umbrella) — decomposes into 1 platform slice + 4 per-domain implementation slices
- **Program:** WS-1 of the typed-subject program (`docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md`)
- **Completes the contract layer begun by:** `event-subject-payload-build-tripwire`
- **Codifies for enforcement by:** `typing-convention-enforcement-skills-docs` (capstone)

## North star

Every event any service publishes or consumes has a **producer-owned zod contract**. The producer
owns **one** schema per aggregate that types **both** the persisted row (`TableEntry<Subject>`) and
the emitted event (`BusEvent<Subject>`). The subject models the **business aggregate only** — all
identity/partition metainfo travels in the context. This is the in-repo equivalent of a schema
registry: the producer-exported zod contract is the registry entry; consumers import it and
`parseSubject(carrier, schema)` at their deserialization seam.

This is the **umbrella** design. It fixes the conventions, the one shared-library change, the
home rule, naming, and the per-domain slicing. It does **not** enumerate every field of every
schema — each per-domain slice does that, validated against the **real** emitted shape.

---

## The conventions (the reusable core)

These are the liftable patterns this whole program exists to define. The capstone lint/skills layer
enforces them; the per-domain slices apply them.

1. **Subjects are read only via `parseSubject`.** A consumer reads `event.subject` exactly once,
   through `parseSubject(carrier, <importedProducerSchema>)` (`libs/event-processor/src/util/parse-subject.ts`).
   Never `event.subject as <LocalType>` / `as Record<string, unknown>`, never a locally re-declared
   payload shape.

2. **Contract-home / import rule.**
   - **Intra-domain** consumer → imports the producer's `@nestfolio/<svc>/contracts`. Service→service
     direct import is fine *within a domain*.
   - **Cross-domain** consumer → imports the **producer domain's adapter** `@nestfolio/<producer-domain>-adpt/domain`.
     The adapter is each domain's outward type-surface; routing cross-domain contracts through it is
     what prevents the service↔service project cycle (the broker-ctrl↔investor-bff cycle the prior
     program hit). **Precedent:** `ProposedTrade` lives in `advisory-adpt/domain` and is imported by
     `execution-ctrl` — advisory *produces* it, so it sits in advisory's adapter.

   > **Correction to the strategy doc.** `2026-06-09-typed-subject-program-strategy.md` says the
   > re-export lives in the *"consuming-direction adapter"*. That is backwards and contradicts the
   > capstone item, which says *"the PRODUCER's domain adapter"*. The code (the ProposedTrade
   > precedent) implements **producer-domain adapter**, and that is the rule here. The strategy doc's
   > wording is corrected as part of shipping this umbrella.

3. **One subject type for row + event.** `BusEvent<T, S>` (`platform/bus.ts`) and `TableEntry<T, S>`
   (`platform/table.ts`) are generic over the **same** `T`. The producer contract types both:
   the event is `BusEvent<Subject>`, the persisted row is `TableEntry<Subject>`. **No hand-rolled row
   interfaces** that re-declare `pk`/`sk`/`__typename` inline.

4. **Clean, event-aligned model names.** `<Name>Schema` + `type <Name> = z.infer<typeof …>`. **No
   `Subject` suffix.** On a name clash, prefer the event-aligned concept (`LedgerEntryRecorded` not
   `LedgerEntry`; `InvestorProfileUpdated` not `InvestorProfile`).

5. **Context generic `S` is carried on both.** Both `BusEvent` and `TableEntry` are parameterised by
   the context type `S`, and it is carried consistently on event and row — never dropped.

6. **Pure aggregates — metainfo lives in the context, never on the subject.** The subject `T` models
   the **business aggregate only**. `tenantId`, `userId`, `region` and any other identity/partition
   metainfo travel in the context `S`, and are **never duplicated on the subject**. The persisted row
   `TableEntry<T, S> = T & {pk, sk, __typename, …} & S` already composes the business fields (`T`)
   with the metainfo (`S`); the `pk`/`sk` are constructed from `S` + the aggregate's business key.
   This is why the inline-row conversions **remove** `tenantId`/`region` from the type — e.g.
   `TaxLot` subject becomes `{lotId, symbol, quantity, costBasisPerShare, acquiredAt, status}` and the
   tenant comes from `S = RequestContext`; `MarketSnapshot` subject drops `region`, taking it from
   `S = RegionContext`. (This was already the latent rule — investor-ctrl's contract notes
   *"identity travels in the event context, not on the subject"* — now made first-class.)

> Conventions 1–5 are the catalogue the capstone already names; **6 is added here** and the capstone
> must pick it up.

---

## The one shared-library change (platform context taxonomy)

Today the two generics are asymmetric: `BusEvent<T, S extends RequestContext>` *constrains* `S`, but
`TableEntry<T, S>` *intersects `S` unconditionally*. And real aggregates split three ways —
tenant-scoped (most), region-scoped (`MarketSnapshot#${region}` — no `tenantId`/`userId`), and global
(`SecFiling` — no identity context). Forcing `RequestContext` everywhere would put fake
`tenantId`/`userId` on market/sec rows.

**Resolution — a small context taxonomy with a constrained base**, in `libs/event-processor`
(`platform/`). Back-compat is **not** a constraint ([[no-deprecation]]), so usage sites are cleaned
up directly rather than relying on the default.

> **Naming correction (phase-0 implementation).** The base is named **`SubjectContext`**, *not*
> `EventContext`. `EventContext` is **already** a public export of `@nestfolio/event-processor`
> (`types/event-context.ts`) with the opposite meaning — the per-invocation **handler context**
> (`RequestContext` + `{eventId, eventType, timestamp, serviceName, record}`), used in handler
> signatures across the workspace. Reusing that name would either collide or force a workspace-wide
> rename of a pervasive symbol (out of scope for the lib-only phase-0). `SubjectContext` also pairs
> cleanly with the program's core noun: `BusEvent<Subject, SubjectContext>` /
> `TableEntry<Subject, SubjectContext>`. (Decision: user, 2026-06-09.)

```ts
/** Base for all event/row context types. Global aggregates use this directly (no identity). */
export type SubjectContext = object;

/** Tenant-scoped aggregates. (Existing type, re-based onto SubjectContext.) */
export interface RequestContext extends SubjectContext {
  tenantId: TenantId;
  userId: UserId;
  region: string;
}

/** Region-scoped aggregates (market data keyed on region). */
export interface RegionContext extends SubjectContext {
  region: string;
}

// Both generics constrained to the same base; RequestContext is the ergonomic default.
export type BusEvent<T = object, S extends SubjectContext = RequestContext> =
  Event & { subject: T; context: S };

export type TableEntry<T extends object = object, S extends SubjectContext = RequestContext> =
  T & { pk: string; sk: string; __typename: string; createdAt: string; updatedAt?: string; ttl?: number } & S;
```

- Tenant-scoped aggregate → `BusEvent<Subject>` / `TableEntry<Subject>` (default `S = RequestContext`).
- Region-scoped aggregate → `…<Subject, RegionContext>`.
- Global aggregate → `…<Subject, SubjectContext>` (the bare base). Use `SubjectContext`, **not**
  `Record<string, never>`: the latter carries an index signature `[k: string]: never`, so any
  undeclared key (e.g. `.tenantId`) resolves to `never` and is silently *accessible* rather than a
  compile error — defeating "no identity". `SubjectContext` (`= object`) adds no fields and keeps the
  row closed, so a stray identity access is caught. (Verified by the phase-0 type-level test.)

This resolves the asymmetry (both constrained to `SubjectContext`), types region/global aggregates
accurately, and makes conventions 5–6 lint-enforceable. Blast radius is small (`RequestContext`
remains the default); the phase-0 slice fixes whatever churn the constraint surfaces.

---

## Per-domain inventory (census)

Producers that **already** export a zod contract (partial coverage, one schema each unless noted):
investor-ctrl, investor-bff, onboarding-bff, investor-adpt (cross-domain), investor-profile-ctrl,
market-intelligence-ctrl, ledger-ctrl (3 schemas), execution-adpt (cross-domain), broker-sim-adpt
(partial).

Producers that **need** new/extended contracts, by domain:

### Ledger (slice 1 — smallest, all tenant-scoped)
- **ledger-ctrl** — extend existing contracts to cover all emitted events; convert inline rows
  **`TaxLot`** (`repositories/ledger.repository.ts`) and **`SnapshotRecord`**
  (`transforms/snapshot-to-events.ts`) to `TableEntry<Subject>` (drop `tenantId` → `S`).
- **reconciliation-ctrl** — new contracts for `PORTFOLIO_DRIFT_DETECTED`, reconciliation lifecycle,
  drift/projection events.

### Investor (slice 2)
- **investor-ctrl** — extend beyond `NotificationCreated` to the rest (notification + monthly-report
  lifecycle).
- **investor-bff** — extend beyond `InvestorProfileUpdated` to the remaining lifecycle CDC events.
- **onboarding-bff** — confirm coverage (already has two).

### Execution (slice 3 — live-money path; verify against the real broker path, [[event-subject-contracts]])
- **broker-ctrl** — order-lifecycle contracts (funding already covered via `execution-adpt/domain`).
- **broker-sim-adpt** — complete (only `SimDepositCompleted` today).
- **broker-alpaca-adpt** — Alpaca order/transfer contracts.
- **execution-ctrl** — `ORDER_CREATED` / `STAGED_ORDER_CREATED`. Continues to import `ProposedTrade`
  cross-domain from `advisory-adpt/domain` (authored/converted in the Advisory slice — see below);
  no change needed here beyond execution's own producer contracts.

### Advisory (slice 4 — richest; exercises RegionContext, the bare base, the stale fix, Tier-3)
- **compliance-ctrl** — the stale-schema fix. `DecisionApprovedSchema` (`domain/schemas.ts`) is
  actually a *consumer-side inbound* validation schema **and** drifted: it declares
  `{decisionId, complianceLevel, approvedAt}` but the real CDC row (the `ComplianceCheck` written in
  `handlers/event-listener.ts`) carries `{decisionId, decisionPacketId, authorityLevel, taskToken,
  mandateSnapshot, result, violations, …}`. Author a **producer** contract for the real
  `DECISION_APPROVED` subject and reconcile/replace the stale schema. The **`ProposedTrade`** plain
  `interface` (`advisory-adpt/domain`) is converted to zod here — it is advisory-produced and nests
  inside the DecisionApproved subject (`proposedTrades: ProposedTrade[]`); `execution-ctrl` imports it
  cross-domain unchanged.
- **decision-workflow-ctrl** — `DECISION_PACKET_CREATED/UPDATED`, `RECOMMENDATION_PROPOSED`,
  `MANDATE_SNAPSHOT_CREATED`, `DECISION_CYCLE_STARTED/FAILED`; convert the DWC projection rows
  **`InvestorProfileSnapshotProjectionRow`** + **`MarketSnapshotProjectionRow`** (`domain/models.ts`)
  to `TableEntry<Subject>` — importing the source contracts to tighten `agentOutput`, and dropping
  `tenantId`/`region` into `S`.
- **investor-profile-ctrl** / **market-intelligence-ctrl** — already have snapshot contracts; convert
  their inline rows **`InvestorProfileSnapshotRow`** (`RequestContext`) and **`MarketSnapshotRow`**
  (`RegionContext` — drop `region`).
- **portfolio-engine-ctrl** + **advisory-narrative-ctrl** — `Portfolio*/Narrative*` contracts; convert
  **`AgentCompletionRow`/`AgentFailureRow`** (structural duplicates differing only in the `agentName`
  literal → a **shared `AgentCompletionRow<A extends string>` generic**, location decided in the
  Advisory slice). Type the `agentOutput` against the existing agent zod schemas
  (`agents/schemas.ts`: `PortfolioConstructionSchema`, `ExplainabilitySchema`, `GoalInterpretationSchema`,
  `RiskEvaluationSchema`, `MarketAnalysisOutputSchema`), removing the `Record<string, unknown>` erasure.
- **Tier-3 inter-agent handoff** — `AssemblePacketEvent`
  (`decision-workflow-ctrl/handlers/assemble-packet.ts`) typed against the agent schemas instead of
  `Record<string, unknown> | null`.
- **advisory-bff** — `DECISION_READ_MODEL_CREATED/UPDATED`, `USER_CONFIRMED/REJECTED` contracts.
- **sec-edgar-adpt / alpha-vantage-adpt / fred-adpt / marketwatch-adpt / yahoo-finance-adpt** —
  convert the plain-`interface` feed payloads (`SecFiling`, `FredIndicator`, `MarketWatchArticle`, …)
  to zod; mostly global / region-scoped (bare base / `RegionContext`).

---

## Slicing & ordering

Each slice is an independently shippable **Complex** workstream (own spec → plan → impl → deploy →
e2e), filed as its own backlog item. Order chosen to prove the reusable pattern cheaply first and
defer the richest domain until the pattern is proven:

0. **`typed-subject-platform-context-taxonomy`** — the shared-library change above. `libs/event-processor`
   only; unit-tested; **no deploy**. Unblocks all 4 domain slices. (Doc-/lib-layer Complex: touches a
   shared lib export, so worktree + PR.)
1. **`typed-subject-contracts-ledger`** — smallest, all tenant-scoped. Proves contract +
   `TableEntry<Subject>` + the validate-against-real-emission e2e gate end-to-end.
2. **`typed-subject-contracts-investor`**.
3. **`typed-subject-contracts-execution`** — live-money path; validate against the **real** broker
   emissions, not fixtures ([[event-subject-contracts]]). Imports `ProposedTrade` cross-domain from
   `advisory-adpt/domain` unchanged (the zod conversion lands in slice 4 — see the inventory above).
4. **`typed-subject-contracts-advisory`** — richest; exercises `RegionContext` (MarketSnapshot), the
   bare-base global (`SecFiling`), the stale-compliance fix, the Tier-3 agent-handoff cluster, and
   the `ProposedTrade` → zod conversion (advisory-produced).

Phase 0 must ship before any domain slice. Domain slices 1–4 are independent of each other and could
be reordered, but this order surfaces the hard cases last by design.

---

## Validation — THE #1 risk

Each contract is validated against the **REAL** emitted shape — the actual persisted DDB row / a
captured CDC subject — **never a fixture**. The `event-subject-contracts` lesson: a schema co-wrong
with its fixture passed integration and only e2e caught it; the stale compliance schema is standing
proof the same drift exists today. Every domain slice's done-definition includes a scoped e2e run
against deployed dev that asserts the producer emits exactly what its contract declares. Producers'
own unit tests + `tsc` green per slice.

## Out of scope (umbrella)

- WS-2 (`cdc-publisher-typed-subjects`), WS-3 (`consumer-parse-subject`), the enforcement capstone.
- The `opaqueSubject` helper deletion (WS-3 terminal step; the helper does not exist on `main`).
- Runtime changes to emitted **context** payloads beyond what typing requires.
- The per-domain contract **implementation** — carried by the phase-0 + 4 domain slices this umbrella
  files. This umbrella delivers the design + the slice decomposition + the strategy-doc correction.

## Decomposition output (backlog items this umbrella files)

`typed-subject-platform-context-taxonomy` (rank 1) → `typed-subject-contracts-ledger` (2) →
`-investor` (3) → `-execution` (4) → `-advisory` (5). WS-2/WS-3/capstone and the remaining
non-typed-subject items re-rank below. `typed-subject-producer-contracts` (this item) closes as the
design umbrella once the spec lands and the slices are filed.
