---
id: bff-read-model-materialization-redesign
status: active
type: design
notes: "Systemic redesign of BFF read-model materialization across investor/ledger/advisory/dashboard BFFs. Replace field-by-field projection from overlapping event types (no version guard) with a canonical versioned atomic snapshot projection. Dissolves the structural-zero, totalValueCents double-count, out-of-order field clobber, and sparse-item-race bug class at the source. Dev-phase, breaking changes free."
references:
  - "services/investor/dashboard-bff/src/transforms/portfolio-summary.ts"
  - "services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js"
  - "services/ledger/ledger-ctrl/src/transforms/snapshot-to-events.ts"
  - "services/advisory/advisory-bff/src/transforms/decision-status-changed.ts"
out_of_scope:
  - "Live-push TRANSPORT (broadcast/subscription/client-merge/shared subscribe-then-reconcile helper) — deferred to the re-scoped dashboard-live-push-portfolio-summary + dashboard-live-push-position-snapshots items; this workstream fixes materialization correctness only, on top of which transport is later rebuilt."
  - "Per-BFF IMPLEMENTATION commits — this item's done-definition is the design + decomposition spec (canonical pattern + rollout order). Each BFF's migration becomes its own Complex implementation workstream with its own worktree."
  - "Client-side weightPercent recomputation — a transport-item concern, not a materialization-pattern concern."
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Systemic BFF read-model materialization redesign

## The weakness

Every BFF read model (investor/ledger/advisory/dashboard) is a CQRS read side
reconstructed **field-by-field from a stream of partially-overlapping event
types, with no version/sequence guard**. Concretely in dashboard-bff:
`BALANCE_UPDATED` writes cash+total, `PORTFOLIO_UPDATED` writes total+count,
`RECONCILIATION_COMPLETED` writes drift — each event projects a *subset* of the
row's fields. Three fragilities fall out of that pattern:

1. **Structural zeros — missing-field events leave fields unwritten.** Verified:
   `cashBalanceCents` and `positionCount` are *never written* to the
   `PortfolioSummary` row by any transform (only the unrelated `StreamSnapshot`
   simulation row carries those names). `get-dashboard.fn.js` papers over it with
   `|| 0` and a comment — "read models are sparse … lacks fields the schema
   declares non-null." The architecture is apologizing for itself.
2. **No version guard — out-of-order clobber + double-count.** `totalValueCents`
   is written by *both* events one fill emits (`BALANCE_UPDATED` cash-down +
   `PORTFOLIO_UPDATED` position-up); the current `accumulate` model double-counts,
   and even a project-based fix has no "apply only if newer" conditional, so
   out-of-order delivery settles on a stale value.
3. **Same class, already filed elsewhere.** advisory-bff's
   `decision-status-changed` sparse-item race (`DECISION_PACKET_UPDATED` before
   `CREATED`) is patched with an ad-hoc `attribute_exists(pk)` condition
   (`:56`) — the same ordering/sparsity hole, locally band-aided. This is not a
   dashboard-bff bug; it is a missing read-model materialization *convention*.

## The intended clean design (to be refined in brainstorming)

A canonical **versioned atomic snapshot projection**: each read-model row is a
faithful mirror of a single authoritative upstream snapshot, projected whole and
guarded by a monotonic version / `lastEventSequence` conditional write — not
reconstructed from overlapping partial events. ledger-ctrl already computes and
emits exactly such an authoritative snapshot
(`snapshot-to-events.ts:39-66` — `cashBalanceCents`, `totalValueCents`,
`positions`, `lastEventSequence`), so the source-of-truth exists; the BFFs just
need to consume it correctly and consistently. Likely shape: a shared
convention/helper in `event-processor` (or `cdk-constructs`) plus a per-BFF
migration.

## Scope (chosen 2026-05-29): full systemic, all BFFs

Decided in brainstorming: design ONE canonical pattern and apply it across
investor/ledger/advisory/dashboard BFFs, rather than fixing dashboard-bff in
isolation. Rationale: dev-phase (no prod, no other devs, breaking changes free)
makes this the cheapest it will ever be, and the user's goal is a very clean,
well-architected read-model layer. Brainstorming's first job is **decomposition**
— establish the canonical pattern, then a rollout order across BFFs as separate
implementation workstreams. This design item is doc-layer (produces the spec on
`main`); implementation is downstream Complex work.

## What this dissolves vs. what it does not

**Dissolves:** structural-zero cash/positionCount; totalValueCents double-count;
out-of-order field clobber; server-side `weightPercent` inconsistency;
advisory-bff sparse-item race (retires its ad-hoc `attribute_exists` guard); the
defensive `|| 0` sprinkled through read resolvers.

**Does not dissolve (orthogonal, stays with the deferred transport items):**
live-push broadcast wiring, AppSync subscriptions, client-side merge reducers,
subscribe-before-query + reconnect, and the per-symbol-delta `weightPercent`
flicker. Those sit *on top of* the read model and are rebuilt on the clean
foundation afterward.

## On ship — promote deferred dependents (closing step)

`dashboard-live-push-portfolio-summary` and `dashboard-live-push-position-snapshots`
are committed-but-blocked: they are parked only because this redesign is their
hard predecessor (live-push must be rebuilt on the clean read model, not the
fragile one). When this workstream ships, the boundary review MUST promote both
from `parking` → `queued` (remove the "after the refactoring" trigger sentence,
assign ranks) so they re-enter the ready queue. This is part of this item's
done-definition, not a separate decision.
