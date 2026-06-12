# Typed-Subject Convention Enforcement — design

- **Date:** 2026-06-12
- **Status:** design (approved in brainstorming 2026-06-12)
- **Backlog:** `docs/backlog/typing-convention-enforcement-skills-docs.md` (ACTIVE)
- **Strategy:** `docs/superpowers/specs/2026-06-09-typed-subject-program-strategy.md` (this is the **capstone**, runs after WS-1/2/3, all shipped)
- **Source-of-truth dossier:** project memory `project_event_subject_contracts.md`

## Problem

The typed-subject program (WS-1 producer contracts → WS-2 publishers → WS-3 consumers,
all shipped) established five conventions but nothing **prevents** future code from
regressing them. Two real regressions already happened *during* that program and had to
be caught by hand: a cross-domain **project cycle** (broker-ctrl↔investor-bff, from two
services importing each other's `/contracts`) and the original untyped
`event.subject as <LocalType>` anti-pattern. This capstone makes the conventions
self-enforcing against an already-compliant codebase — with one honest exception: the
**cross-domain import channel** is *not* currently clean (12 live cross-domain
`/contracts`+`/events` import statements across 11 production files leak through an
over-permissive nx `allow` list), so part
of this workstream is making it clean so the gate can run green.

## The five conventions (settled — catalogued in the backlog item)

1. **Event subjects → `parseSubject` + imported producer contract.** No
   `event.subject as <LocalType>` / `as Record<string,unknown>` with a locally
   re-declared payload type. (Genuinely-polymorphic readers use a documented
   consumer-owned view + a registered exception.)
2. **Contract-home / import channel (unified, domain-aware).**
   - **Intra-domain:** consumer imports the producer's `@nestfolio/<svc>/contracts`
     (payloads) and `@nestfolio/<svc>/events` (names) **directly**.
   - **Cross-domain:** consumer imports **both** payloads and names from the
     producer-domain's **`@nestfolio/<domain>-adpt/domain`** re-export. Never reach into
     another domain's `/contracts` or `/events`. (The `advisory-adpt`/`ProposedTrade`
     precedent; the adapter `/domain` index already re-exports both names and schemas.)
3. **One subject type → `BusEvent<T>` and `TableEntry<T>`.** Rows are
   `TableEntry<Subject>`, not hand-rolled `pk`/`sk`/`__typename` interfaces.
4. **Clean model names — no `Subject` suffix.** `<Name>Schema` + `<Name>`;
   event-aligned name on clash (`LedgerEntryRecorded`, `InvestorProfileUpdated`).
5. **Context generic `S` = `RequestContext`** (or a domain extension) on **both**
   `BusEvent<T,S>` and `TableEntry<T,S>`; never dropped.

## Decisions (locked in brainstorming 2026-06-12)

1. **Enforcement = hard gate + skills/docs** (not prose-only). Generalises the proven
   `tools/check-read-model-drift.mjs` + exclusion-registry + nx-target pattern.
2. **CLAUDE.md service-card-drift gate → split out** to its own backlog item (it is a
   distinct checker: `service.stack.ts` AST → card-section diff; subsumes
   `service-card-funding-event-type-drift`). Not built here.
3. **Convention 2 → enforced by nx `@nx/enforce-module-boundaries`, strict + fix the live
   violations.** The boundary config already encodes domain scopes; only its
   over-permissive `allow` list lets cross-domain `/contracts`+`/events` through. Tighten
   it and fix the violations so the codebase genuinely complies.
4. **The channel rule covers payloads AND event names**, uniformly. Test code is exempt
   (contract-validation tests legitimately import real producer contracts cross-domain).

## Architecture

The mechanism splits by what each tool can express:

| Convention | Enforced by | How |
|---|---|---|
| **2** (import channel) | **nx `@nx/enforce-module-boundaries`** | tighten `allow` + scope tags + test-exempt override |
| **1** (subject casts) | `tools/check-typed-subjects.mjs` | forbid `.subject as Record/<Type>` in `src/` (registry-excluded; platform seams path-excluded) |
| **4** (naming) | `tools/check-typed-subjects.mjs` | forbid `…SubjectSchema` / `…Subject` in `**/domain/contracts.ts`, `**/domain/events.ts` |
| **opaqueSubject** absent | `tools/check-typed-subjects.mjs` | forbid the identifier anywhere in `src/` |
| **3** (TableEntry rows) | `tools/check-typed-subjects.mjs` (heuristic) **+ skills/docs** | flag inline `interface`/`type` declaring `pk`+`sk`+`__typename` outside `TableEntry<>` |
| **5** (context generic) | **skills/docs only** | not cleanly mechanizable |

### 1. Convention 2 via nx enforce-module-boundaries

**Current state** (`eslint.config.js`): the rule's `allow` list contains
`@nestfolio/.+/events`, `@nestfolio/.+/contracts`, `@nestfolio/.+-adpt/domain`,
`@nestfolio/event-processor`, `@nestfolio/.+/agent-budgets`,
`@nestfolio/e2e-feature-tests`. `depConstraints` already restrict each
`scope:<domain>` to `[its scope, scope:platform, scope:shared]`. Every service is tagged
`scope:<domain>` + `type:<suffix>`.

**Change:**
- **Remove** `@nestfolio/.+/events` and `@nestfolio/.+/contracts` from `allow`. Keep
  `@nestfolio/.+-adpt/domain` (the cross-domain channel). Result: intra-domain
  `/contracts`+`/events` imports pass (same scope tag), cross-domain ones become lint
  errors, cross-domain `*-adpt/domain` passes.
- **Add a test-code override block** (flat-config) for
  `**/*.test.ts`, `**/*.spec.ts`, `**/test/**`, `apps/e2e-feature-tests/**`,
  `libs/integration-testing/**`, `libs/test-support/**` that retains the broad
  `/contracts`+`/events` allow (contract-validation tests must import real producer
  contracts directly). Production `src/` stays constrained.

**Tag-aware simulation** of the tightened rule across the whole repo (services + apps +
libs) found exactly:
- 66 intra-scope `/contracts`+`/events` imports → **stay green**.
- ~11 production-`src/` cross-domain violations (the fix set, below).
- 44 `apps/e2e-feature-tests` (`scope:platform`) cross-domain imports → **exempted** by
  the test override.
- 0 unconstrained legitimate importers left exposed.

Why nx and not the bespoke script: import-graph constraints are exactly what
enforce-module-boundaries is for — it is graph-aware, transitive, already wired into
`nx lint`, and the idiomatic home. A hand-rolled grep would re-implement it worse.

### 2. Fix the 11 production-src cross-domain violations (type-only)

Re-export the cross-consumed symbols through the **producer-domain adapter `/domain`**
and repoint the importers. Behavior-identical (re-exports resolve to the same runtime
values/types).

**`ledger-adpt/domain`** re-exports (producer = `ledger-ctrl`, scope:ledger):
- names: `LedgerCtrlEventTypes` (the subset cross-consumers reference)
- schemas: `PortfolioUpdatedSchema`, `LedgerSnapshotSchema`, `LedgerEntryRecordedSchema`,
  `BalanceUpdatedSchema` (+ their inferred types)

**`investor-adpt/domain`** re-exports (producer = `investor-bff`, scope:investor):
- the investor event-name group(s) cross-consumers reference (currently they import
  `InvestorBffEventTypes` directly; reconcile against the adapter's existing
  `InvestorCrossDomainEventTypes` / `InvestorIngestEventTypes` re-exports — extend or
  add as needed). `InvestorProfileUpdatedSchema` is already re-exported.

**Repoint (production `src/` only):**
- `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` (investor names)
- `services/advisory/compliance-ctrl/src/service.stack.ts` (investor names)
- `services/advisory/decision-workflow-ctrl/src/domain/events.ts` (investor names)
- `services/advisory/decision-workflow-ctrl/src/handlers/mandate-projector.ts` (investor names)
- `services/advisory/decision-workflow-ctrl/src/handlers/snapshot-projector.ts` (ledger names + `LedgerSnapshotSchema`)
- `services/advisory/decision-workflow-ctrl/src/service.stack.ts` (ledger names)
- `services/advisory/investor-profile-ctrl/src/service.stack.ts` (investor names)
- `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts` (`PortfolioUpdatedSchema`)
- `services/investor/dashboard-bff/src/transforms/position-snapshot.ts` (`LedgerSnapshotSchema`)
- `services/investor/dashboard-bff/src/transforms/time-travel-availability.ts` (`LedgerEntryRecordedSchema`)
- `services/investor/investor-bff/src/transforms/balance-updated.ts` (`BalanceUpdatedSchema`)

The one service **test** file the simulation flagged
(`decision-workflow-ctrl/test/unit/snapshot-projector.test.ts`) is covered by the test
override → no change.

Verify `advisory-adpt/domain` and `execution-adpt/domain` are already complete (the 23
existing correct `*-adpt/domain` imports indicate yes).

### 3. The syntactic gate — `tools/check-typed-subjects.mjs`

Pure Node (no nx, no LLM), mirroring `tools/check-read-model-drift.mjs`. Scans
`services/**/src` + relevant `libs`. Fails on:
- **C1:** `\.subject\b.*\bas (Record<string,\s*unknown>|<PascalType>)` reads in
  consumer/transform `src/` — excluding (a) platform seams **by path**
  (`libs/event-processor/src/util/to-uow.ts`, `internal/sqs-parser.ts`,
  `engine/ingestion-engine.ts`, `testing/test-harness.ts` — the `parseSubject` carrier
  itself), (b) registry entries.
- **C4:** `export (const \w+SubjectSchema|type \w+Subject\b)` in `**/domain/contracts.ts`
  and `**/domain/events.ts`.
- **opaqueSubject:** the identifier anywhere in `src/`.
- **C3 (heuristic):** a `type`/`interface` declaring all of `pk`, `sk`, `__typename`
  inline (i.e. not via `TableEntry<>`), excluding registry entries and the zod
  CDC-carrier schemas (event-Subject schemas that legitimately carry `pk`/`sk` for CDC
  are not rows — see the backlog note).

Output mirrors the read-model checker: a list of `file:line — rule — message`, non-zero
exit on any unexcused violation, a teaching message per rule (e.g. C2-adjacent guidance
points at the adapter `/domain` channel).

### 4. The exclusion registry — `tools/typed-subject-exclusions.json`

Mirrors `read-model-exclusions.json`. Each entry `{ file, rule, reason, backlogRef? }`.
Seeded from the current documented-exception casts (audited 2026-06-12):
- `services/execution/broker-ctrl/src/handlers/deposit-withdrawal-normalizer.ts` ×4 —
  shared sim/alpaca funding path; owned by `broker-funding-completed-normalization-drift`.
- `services/advisory/market-intelligence-ctrl/src/handlers/kb-ingestion-handler.ts` —
  KB-stringify polymorphic fan-in (consumer view).
- `services/ledger/ledger-ctrl/src/handlers/event-listener.ts` — ORDER_FILLED boundary;
  owned by `ledger-ctrl-live-tax-lot-missing-order-fields`.
- the advisory agent fan-in reads (`portfolio-engine-ctrl` /
  `advisory-narrative-ctrl` event-listener `subject.investorProfile/marketAnalysis/...`
  + the `agent-service.ts` `(event.subject ?? event)` entry shims +
  `graph.ts` `upstreamOutputs`) — genuinely-polymorphic upstream-agent-output reads.

Every remaining non-platform subject cast must be either converted (not in this
workstream's scope) or registered with a reason — so the gate runs green at ship without
silently hiding a real bug. Any cast that is a latent bug rather than a legitimate
exception is registered **with** a `backlogRef` to its tracking item (most already
exist).

### 5. The test — `tools/check-typed-subjects.test.mjs`

Mirrors `check-read-model-drift.test.mjs`: a synthetic violation per rule is flagged, a
compliant fixture passes, and a registry-excluded violation passes.

### 6. Wiring

- **nx target** `typed-subject-drift` on `libs/event-processor/project.json`
  (`nx:run-commands`, `cache: true`, explicit `inputs` globs for the scanned `src` +
  `tools/check-typed-subjects.mjs` + `tools/typed-subject-exclusions.json`,
  `command: node tools/check-typed-subjects.mjs`) — mirrors `read-model-drift`.
- **pre-commit:** add a pure-node line to `scripts/verify-structure.sh`
  (`node tools/check-typed-subjects.mjs`) — daemon-free, so it dodges the
  `precommit-hook-fatal-on-nx-daemon-failure` trap that afflicts the nx-affected check.
- Convention 2 needs **no extra wiring** — it rides `nx lint`, already run in
  pre-commit-adjacent flows and CI.

### 7. Skill updates

Mirror the cross-reference set where `read-model-drift` already appears
(`create-event`, `create-service`, `create-feature`, `audit-service`, `audit-domain`,
`audit-system`, `event-processor-patterns`, `testing-patterns`).
- **`create-event` / `create-service` / `create-feature`:** scaffold a producer-owned
  zod contract (clean name, no `Subject` suffix) typing both `BusEvent<Subject>` and
  `TableEntry<Subject>`; place it per the home rule; for cross-consumed events, add the
  `*-adpt/domain` re-export; scaffold the consumer `parseSubject` branch.
- **`audit-service` / `audit-domain`:** flag the syntactic violations and **run the
  gate** (`node tools/check-typed-subjects.mjs`); call out cross-domain
  `/contracts`+`/events` imports (now also caught by `nx lint`).

### 8. Architecture-doc updates

Document conventions 1–5 + the unified channel rule (intra → producer `/contracts`+
`/events`; cross → `*-adpt/domain`), each pointing to the dossier
`project_event_subject_contracts.md`:
- `docs/architecture/SYSTEM-ARCHITECTURE.md`
- `docs/agent-system.md`
- `.claude/skills/cdk-patterns/SKILL.md`
- `create-service` / `create-event` `SKILL.md` (overlaps §7)

### 9. Card-drift gate → own backlog item

File `service-card-drift-gate` (subsumes `service-card-funding-event-type-drift`) via
`backlog-add`, ranked next. Not built here.

## Testing / validation

- `tools/check-typed-subjects.test.mjs` green (unit).
- `node tools/check-typed-subjects.mjs` against the repo → **green** (proves codebase
  compliant for C1/C3/C4/opaqueSubject + the gate works).
- `nx run-many -t lint` (or `nx lint` on affected) → **green** after the boundary tighten
  + the 11 re-export fixes (this is convention 2's gate).
- `nx run-many -t build,lint` green across affected.

## Deploy

The 11 src fixes are **type-only re-export repointing** (behavior-identical: same
event-name values, same schemas, same CDK rules). No functional change. Validation is by
`build`+`lint`+gate-green, not e2e. `detect-deploy-needed.mjs` will false-positive on the
`services/**/src` edits (and on the new `tools/*.mjs`, per the known
`detect-deploy-tools-path-no-deploy` bug). Resolution at closing: either skip deploy with
the behavior-identical rationale, **or** a type-only redeploy + light smoke of the ≤5
touched services (`compliance-ctrl`, `decision-workflow-ctrl`, `investor-profile-ctrl`,
`dashboard-bff`, `investor-bff`) — dev sandbox, pre-authorized. **No e2e behavior to
assert** (no behavior changed).

## Out of scope

- Re-converting the 8 already-`TableEntry` rows (done by WS-1/2/3; verified 2026-06-12).
- Rewriting documented-exception casts (registered, not fixed — owned by their items).
- The CLAUDE.md service-card-drift gate (split to its own item).
- Boundary adapters' own pull-subscription event-name imports, if any surface — handled
  as an exception class (the test override / a targeted allow), not a forced reroute.
- Convention 5 mechanical enforcement (skills/docs only — not cleanly mechanizable).

## Open items for the plan

- Confirm the exact `InvestorBffEventTypes` subset cross-consumers need vs the adapter's
  existing `InvestorCrossDomainEventTypes`/`InvestorIngestEventTypes` groupings; decide
  re-export vs alias.
- Confirm `advisory-adpt/domain` + `execution-adpt/domain` need no additions.
- Decide the precise eslint test-override shape (retain `allow` for test globs vs rule
  `off`) — prefer retaining the `allow` so tests still can't violate *other* boundaries.
- Final exclusion-registry entries (each remaining cast classified at implementation
  time, each with a reason / backlogRef).
