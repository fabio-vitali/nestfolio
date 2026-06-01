---
id: read-model-ownership-producer-aggregates
status: queued
rank: 1
type: design
notes: "Successor program to bff-read-model-materialization-redesign. w0-w5 applied the single-writer ownership model ONLY to the BFF read surface; the producer/cross-service surface is ungoverned. Extend the model + the ReadModelOwnership registry to every governed state row, so the w6 drift-checker can run green over the WHOLE system. Needs a design pass (cross-domain __version carriage is an event-contract change across 3 domains)."
references:
  - "docs/architecture/READ-MODEL-OWNERSHIP.md"
  - "docs/superpowers/specs/2026-05-29-bff-read-model-materialization-redesign-design.md"
spec: null
plan: null
topic_memory: [project_read_model_redesign.md]
out_of_scope:
  - "Live-push transport (the deferred dashboard-live-push-* items) — a separate feature concern, not read-model consistency."
  - "Real-broker (ALPACA) funding rails — see broker-ctrl-alpaca-funding-carrier-pk-divergence (parking; out of scope until real-money funding is picked up)."
  - "Outbox / event-carrier rows (AgentOutput, AgentInvocation, BalanceEvent, etc.) and external-feed adapter caches — verified NOT governed by the ownership model."
validation_gate: null
---

# Read-model ownership — extend to producer aggregates (consistency closure)

## Why this exists

`bff-read-model-materialization-redesign` (w0–w6) applied the single-writer
aggregate-ownership model — and the `ReadModelOwnership` type registry — to the
**BFF read surface only** (≈20 rows across ledger/dashboard/investor/advisory
BFFs). That work is correct and shipped. But the model is **universal**: it
governs *any* DynamoDB row written through an `@nestfolio/event-processor`
intent factory. The producer/cross-service surface was never registered, and a
2026-06-01 w6 audit (file:line evidence) found real drift there. The w6
drift-checker cannot run green over the whole system until this surface is made
consistent. This program closes that gap so that **completing the QUEUE = a
fully clean, fully enforced model.**

## Scope (from the w6 audit GAPS SUMMARY)

Sequenced producers-first; each tier becomes its own implementation workstream
after the design pass.

**Tier 0 — zero-dependency version-guard fixes (no upstream work, do first).**
- `dashboard-bff` `TimeTravelAvailability`: `project()` → `projectVersioned()`,
  register `Projection<'P1'>` (ledger `lastEventSequence` already in payload).
  A genuine missed migration inside the already-shipped dashboard-bff (w2).
- `decision-workflow-ctrl` `LedgerSnapshot`: `update()` → `projectVersioned()`
  keyed on the `lastEventSequence` already present; register `Projection<'P1'>`.

**Tier 1 — safe registrations (factory already matches the correct tag; type-only,
no behavior change).** Register in each service's `ReadModelOwnership`
augmentation: `execution-ctrl` `Order`/`StagedOrder` → `CommandOwned`;
`compliance-ctrl` `ComplianceCheck`/`AuditArtifact` → `Projection<'P2'>`;
`market-intelligence-ctrl` `MarketSnapshot` (own aggregate) → `CommandOwned`;
`investor-profile-ctrl` `InvestorProfileSnapshot` (own aggregate) → `CommandOwned`;
`decision-workflow-ctrl` `DecisionPacket` → `CommandOwned`; `investor-ctrl`
`Notification`/`MonthlyReport` → `CommandOwned`; `advisory-bff`
`UserConfirmation`/`UserRejection`/`UserInteraction` → `CommandOwned` (inert but
documents ownership).

**Tier 2 — producer `__version` carriage (cross-domain event-contract change; the
unblocker).** Make the snapshot producers stamp + carry a monotonic `__version`
on their emitted events (the convention canonical doc §3 anticipated but that was
never delivered): `investor-bff` Mandate sibling row + `MANDATE_ISSUED` /
`OPERATING_MODE_CHANGED`; `investor-profile-ctrl` + `INVESTOR_PROFILE_SNAPSHOT_*`;
`market-intelligence-ctrl` + `MARKET_SNAPSHOT_UPDATED`. Deploy + e2e; touches the
advisory decision pipeline.

**Tier 3 — consumer conversions (depend on Tier 2).** Once a version source
exists: `decision-workflow-ctrl` mirrors `InvestorProfileSnapshot` /
`MarketSnapshot` / `MandateSnapshot` and `compliance-ctrl` `MandateSnapshot`:
`record()`/`update()` → `projectVersioned()`, register `Projection<'P1'>`.
Resolve the two-services-project-the-same-logical-row shape (compliance + DWC
both mirror investor-bff's Mandate) into one documented projection contract.

**Tier 4 — low-priority.** `broker-ctrl` `ExecutionMode` (single-field cache via
`record()`; needs a version on `EXECUTION_MODE_CHANGED` to become P1).

## Done-definition

Every governed state row is registered with its correct ownership tag and uses
the factory that matches it; no P1 row is written without a version guard; the
w6 drift-checker runs green across **all** services (not just BFFs); the
canonical doc §9 per-row table is extended to the producer surface.

## Process

This is a `type: design` item: route through `superpowers:brainstorming` →
spec → decomposition into the tiered implementation workstreams above (each its
own backlog file + worktree + deploy/e2e gate). Tier 0 can ship immediately;
Tiers 2→3 are the sequenced cross-domain core. See [[project_read_model_redesign]].
