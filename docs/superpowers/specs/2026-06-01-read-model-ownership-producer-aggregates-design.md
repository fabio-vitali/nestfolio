# Read-model ownership — extend to producer aggregates (consistency closure)

**Date:** 2026-06-01
**Backlog:** `read-model-ownership-producer-aggregates` (`type: design`)
**Status:** design, pending plan
**Predecessor:** `bff-read-model-materialization-redesign` (w0–w6, shipped) —
`docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md`
**Canonical model:** `docs/architecture/READ-MODEL-OWNERSHIP.md`

## Problem

`bff-read-model-materialization-redesign` applied the single-writer
aggregate-ownership model — and the `ReadModelOwnership` type registry — to the
**BFF read surface only**. Four services carry a `read-model-ownership.ts`
augmentation today (advisory-bff, dashboard-bff, investor-bff, ledger-bff); **no
producer service (`-ctrl`/`-adpt`) does.** The model is universal — it governs
*any* DynamoDB row written through an `@nestfolio/event-processor` intent factory
— so the producer/cross-service surface is currently ungoverned.

The w6 drift-checker (`tools/check-read-model-drift.mjs`, nx target
`event-processor:read-model-drift`) already scans **all** services, but it treats
an unregistered governed typename as **INFO, not error** — so it is trivially
"green" today while the producer surface is unregistered and partly inconsistent.
This program registers that surface, converts the projections that need a version
guard, and **upgrades the checker to a mandatory gate**, so that completing the
queue means a fully clean, fully enforced model across the whole system.

## What the design pass corrected (verified against code, file:line)

The originating backlog item proposed a five-tier plan. A code verification
sweep (2026-06-01) **refuted several of its premises**; this spec supersedes the
backlog body's tier assignments.

1. **"Tier 0 zero-dependency" is not uniform.**
   - `decision-workflow-ctrl` `LedgerSnapshot` (`snapshot-projector.ts:93`) uses
     `update()` and **does** carry `lastEventSequence` (line 86) → a genuine
     zero-dependency `projectVersioned` conversion.
   - `dashboard-bff` `TimeTravelAvailability` (`time-travel-availability.ts:14`)
     uses `project()` but its source event `LEDGER_ENTRY_RECORDED` carries **no**
     version (only `snapshotAt`). The backlog's "lastEventSequence already in
     payload" is **wrong**. This needs a producer version source first, so it
     moves out of the "freebie" bucket.

2. **"Tier 1 safe registrations" mostly are not type-only.** Registering a row as
   `Projection<'P1'>` activates drift rule **R2** (P1-without-version-guard),
   which *forces* a `projectVersioned` conversion, which *forces* a version
   source. Only **CommandOwned** and **P2** registrations are genuinely
   behavior-free (`record`/`update`/`accumulate`-excluded are allowed for them).
   Concretely:
   - **CONFIRMED safe** (P2/CommandOwned, factory already matches):
     `compliance-ctrl` `ComplianceCheck`/`AuditArtifact` (P2, `record()`);
     `investor-ctrl` `Notification`/`MonthlyReport` (CommandOwned, `record()` —
     `MonthlyReport` row confirmed to exist, conditional on `ORDER_FILLED`).
   - **Refuted as "type-only":** `execution-ctrl` `Order`/`StagedOrder` are
     `record()` (append-style, not obviously CommandOwned); `market-intelligence-ctrl`
     `MarketSnapshot` is `update()`; `investor-profile-ctrl`
     `InvestorProfileSnapshot` is `record()`; `decision-workflow-ctrl`
     `DecisionPacket` is `update()` and **already self-increments `__version`**.
     These are classification decisions, not no-ops.
   - **Documentary only:** `advisory-bff` `UserConfirmation`/`UserRejection`/
     `UserInteraction` are written by AppSync `fn.js` PutItems, *outside*
     event-processor; registering them never activates a type constraint.

3. **No version source exists at any non-ledger producer.** `investor-bff`
   Mandate, `investor-profile-ctrl` `InvestorProfileSnapshot`, and
   `market-intelligence-ctrl` `MarketSnapshot` carry no monotonic field (only
   timestamps). `investor-bff`'s `InvestorProfile` composite row carries a
   **hardcoded `__version: 1`** that never increments — a latent footgun.

4. **Dual-projection of Mandate confirmed.** `decision-workflow-ctrl`
   (`pk=MandateSnapshot#…`) and `compliance-ctrl`
   (`pk=GuardrailPolicy#…, sk=MandateSnapshot`) keep **two independent copies** of
   investor-bff's Mandate, both via `update()`.

## The mechanism (settled)

**Version stamping — atomic per-row counter carried by CDC.** Every governed
**owned** row stamps a reserved `__version` attribute, incremented with a
DynamoDB `ADD #__version :1` on every update-path write (`=1` on the seed write).
Because emissions are CDC-as-outbox, the DynamoDB-stream new image already
contains `__version`, so the emitted event carries it **top-level with no extra
publish code**. `decision-workflow-ctrl`'s `DecisionPacket` already does exactly
this (`add: { __version: 1 }`); the convention generalises. Projecting consumers
read `payload.__version` and pass it to `projectVersioned` as the `version`
parameter.

This is the convention the canonical doc §3 anticipated ("the owning producer
stamps it on every write and carries it top-level in every emitted event") but
that was never delivered for non-ledger producers. Rejected alternatives:
per-producer heterogeneous "natural fields" (no single convention; high consumer
cognitive load) and event-timestamp-as-version (not strictly monotonic under
same-millisecond writes or clock skew; unsafe for MarketSnapshot fast-tier).

## Corrected classification — per row

An aggregate is **CommandOwned in the service that owns it** and
**`Projection<'P1'>` in any service that mirrors it.** This resolves the
"CommandOwned vs P1" tension the verification surfaced: a typename can legitimately
hold *different tags in different services*.

| Service | Typename | Tag | Current intent | Workstream |
|---|---|---|---|---|
| decision-workflow-ctrl | `LedgerSnapshot` | `Projection<'P1'>` | `update()` (`lastEventSequence` present) | WS-C (version-present; no WS-B dependency) |
| compliance-ctrl | `ComplianceCheck`, `AuditArtifact` | `Projection<'P2'>` | `record()` ✓ | WS-A |
| investor-ctrl | `Notification`, `MonthlyReport` | `CommandOwned` | `record()` ✓ | WS-A |
| execution-ctrl | `Order`, `StagedOrder` | `CommandOwned`* | `record()` | WS-A (*confirm no status-update path; else `Projection<'P2'>`) |
| market-intelligence-ctrl | `MarketSnapshot` (own) | `CommandOwned` | `update()` ✓ | WS-A register; WS-B carriage |
| investor-profile-ctrl | `InvestorProfileSnapshot` (own) | `CommandOwned` | `record()` | WS-A register; WS-B carriage |
| decision-workflow-ctrl | `DecisionPacket` | `CommandOwned` | `update()` + `__version` ✓ | WS-A |
| advisory-bff | `UserConfirmation`/`UserRejection`/`UserInteraction` | `CommandOwned` | AppSync `fn.js` (documentary) | WS-A |
| investor-bff | `Mandate` sibling | `CommandOwned` (owner) | transactWrite Put | WS-B (stamp `__version`) |
| dashboard-bff | `TimeTravelAvailability` | `Projection<'P1'>` | `project()` | WS-B (event version) + WS-C (convert) |
| decision-workflow-ctrl | `MandateSnapshot`, `InvestorProfileSnapshot` (mirror), `MarketSnapshot` (mirror) | `Projection<'P1'>` | `record()`/`update()` | WS-C |
| compliance-ctrl | `MandateSnapshot` (mirror) | `Projection<'P1'>` | `update()` | WS-C |
| broker-ctrl | `ExecutionMode` | `CommandOwned` | `record()` | WS-D (register; `__version` only if a P1 consumer appears) |

## Same typename, two roles — R4 must be per-service scoped

The drift-checker's **R4** errors when a typename is registered with different
tags across files. `MarketSnapshot` (MI-ctrl `CommandOwned` vs DWC mirror `P1`)
and `InvestorProfileSnapshot` (IP-ctrl `CommandOwned` vs DWC mirror `P1`) use the
**same typename in both the owner and the projector** — correct CQRS, yet global
R4 would flag it. (`Mandate`→`MandateSnapshot` and `DecisionPacket`→
`DecisionReadModel` avoid this by using distinct names; these two do not.)

**Resolution: scope R4 per-service** — the registry key is *(service, typename)*,
not typename alone. Within-service R4 still catches the genuine bug (one service
tagging a typename two ways). This refinement is a **prerequisite for WS-C** (it
must land before/with the moment DWC registers those two typenames as P1).
Rejected alternative: rename DWC's mirror typenames (data-model churn for no
benefit).

## Dual-projection contract (Mandate fan-out)

investor-bff is the **single owner** of Mandate. It publishes one versioned
Mandate event stream (`MANDATE_ISSUED`/`MANDATE_REVOKED`/`OPERATING_MODE_CHANGED`,
each carrying `__version`). compliance-ctrl and decision-workflow-ctrl each keep
their **own** physical copy and project independently via `projectVersioned`
keyed on that same `__version`. **Two physical copies, one logical version line;
no service reads another's table.** This is documented in canonical doc §9 as the
producer-surface fan-out pattern.

## Enforcement (settled — mandatory gate + exclusion registry)

The drift-checker is upgraded so that **every typename written via an
event-processor intent factory must be EITHER registered in a
`ReadModelOwnership` augmentation OR listed in an explicit exclusion registry** —
otherwise it is an **ERROR** (today it is INFO). The exclusion registry is a
single committed file (`tools/read-model-exclusions.json`) listing the verified
**non-governed** rows with a one-line justification each: outbox/carrier rows
(`AgentOutput`, `AgentInvocation`, `BalanceEvent`, …) and external-feed adapter
caches. This makes the registry permanent and self-policing — a new unregistered
governed row fails CI. (The existing R1–R4 rules are retained; R4 is refined to
per-service scope per above.)

## Decomposition — four implementation workstreams

Each workstream gets its own `docs/backlog/<id>.md`, is Complex-lane (worktree +
own spec/plan + deploy/e2e gate where it touches event contracts), and ships
independently.

### WS-A — Registrations (type-only; no runtime change, no deploy)
- Add a `read-model-ownership.ts` augmentation to each producer service for all
  **CommandOwned** and **P2** rows in the table above. These are
  `declare module` type augmentations + static drift-checker input — they emit no
  runtime code and need no deploy.
- Confirm whether `execution-ctrl` `Order`/`StagedOrder` have a status-update
  path. If yes → `CommandOwned`; if they are write-once immutable records →
  `Projection<'P2'>`. Register accordingly. (Either tag is `record()`-compatible,
  so this is classification/documentation, not a behavior change.)
- **Validation gate:** `pnpm nx affected -t test,lint` + per-service typecheck +
  `pnpm nx run event-processor:read-model-drift` green. No deploy.

### WS-B — `__version` carriage (cross-domain event-contract change)
- `investor-bff` `Mandate` sibling row: stamp `__version` (atomic), carry it on
  `MANDATE_ISSUED`/`MANDATE_REVOKED`/`OPERATING_MODE_CHANGED`. Fix the hardcoded
  `InvestorProfile.__version: 1` to actually increment.
- `investor-profile-ctrl` `InvestorProfileSnapshot`: stamp `__version`, carry on
  `INVESTOR_PROFILE_SNAPSHOT_CREATED`/`_UPDATED`. Confirm rebuild semantics — it is
  `record()` (create-only) today; if the snapshot is rebuilt per decision cycle
  the intent must become an upsert with `ADD #__version :1`, otherwise the version
  is pinned at 1 and useless as a guard.
- `market-intelligence-ctrl` `MarketSnapshot`: stamp `__version`, carry on
  `MARKET_SNAPSHOT_UPDATED`.
- `ledger-ctrl` `LEDGER_ENTRY_RECORDED`: carry `lastEventSequence` (or a stamped
  `__version`) so dashboard-bff `TimeTravelAvailability` can become P1.
- **Validation gate:** deploy dev (`--services=` for the touched producers) +
  `pnpm nx affected -t test-integration` + involved e2e (advisory decision
  pipeline, onboarding, ledger flows).

### WS-C — Consumer `projectVersioned` conversions (depends on WS-B)
- `decision-workflow-ctrl` `LedgerSnapshot`: `update()` → `projectVersioned` keyed
  on the `lastEventSequence` already present; register `Projection<'P1'>`. (No
  WS-B dependency — its version source already exists — but it deploys DWC, so it
  rides with the other DWC conversions here rather than the type-only WS-A.)
- `decision-workflow-ctrl` mirrors (`MandateSnapshot`, `InvestorProfileSnapshot`,
  `MarketSnapshot`): `record()`/`update()` → `projectVersioned` keyed on upstream
  `__version`; register `Projection<'P1'>`.
- `compliance-ctrl` `MandateSnapshot`: `update()` → `projectVersioned`; register
  `Projection<'P1'>`.
- `dashboard-bff` `TimeTravelAvailability`: `project()` → `projectVersioned`;
  register `Projection<'P1'>`.
- **R4 per-service scoping refinement** to the drift-checker (prerequisite for the
  MarketSnapshot/InvestorProfileSnapshot P1 registrations to pass).
- Document the Mandate fan-out contract in canonical doc §9.
- **Validation gate:** deploy dev + integration + advisory/dashboard involved e2e.

### WS-D — Tier-4 + governance capstone (depends on WS-A/B/C)
- `broker-ctrl` `ExecutionMode`: register `CommandOwned` (add `__version` only if
  a P1 consumer is introduced).
- Upgrade the drift-checker to the **mandatory-error gate + exclusion registry**
  (`tools/read-model-exclusions.json`).
- Extend canonical doc §9 per-row table to cover the producer surface.
- Update `CLAUDE.md` router / `event-processor-patterns` / audit-skill pointers if
  any reference the BFF-only scope.
- **Validation gate:** `pnpm nx run event-processor:read-model-drift` green as a
  mandatory gate across **all** services; `backlog-lint` green.

## Out of scope

- Live-push transport (the deferred `dashboard-live-push-*` items) — a separate
  feature concern, not read-model consistency.
- Real-broker (ALPACA) funding rails — see
  `broker-ctrl-alpaca-funding-carrier-pk-divergence` (parking).
- Outbox/event-carrier rows (`AgentOutput`, `AgentInvocation`, `BalanceEvent`, …)
  and external-feed adapter caches — verified NOT governed by the ownership
  model; they go in the **exclusion** registry, not the ownership registry.
- Event-sourcing on the write side — the system stays state-stored-aggregate +
  CDC-outbox.

## Done-definition

Every governed state row is registered with its correct ownership tag in its
owning and/or projecting service; no `Projection<'P1'>` row is written without a
version guard; the drift-checker runs green **as a mandatory gate** across all
services, with the exclusion registry covering the verified non-governed rows;
the canonical doc §9 per-row table is extended to the producer surface.

This design item's own done-definition is **this spec + the four-workstream
decomposition** (Doc-layer, ships on `main`). The four numbered workstreams are
downstream Complex work, each with its own backlog file, worktree, and
deploy/e2e gate.
