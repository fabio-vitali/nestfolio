---
id: nx-affected-overbroad-cyclic-service-graph
status: dropped
type: tooling
notes: "DROPPED 2026-06-07 — premise DISPROVEN by investigation. The stated root cause ('dense cyclic cross-service contract-import graph makes nx affected over-broad') is WRONG: the dependency graph is bounded and correct (ui→6 control matches nx exactly; dashboard-bff has 0 dependents); breaking both SCCs → still 28; broker-sim-adpt (zero cross-service contracts, 0 dependents) → still 28. The 28-affected is an nx 22.5.4 `affected` over-approximation over the event-processor-coupled backend blob, unrelated to the cross-service Subject-import design — which is sound. The proposed 17 per-producer contract libs would NOT fix it. Superseded by two correctly-scoped queued items: nx-affected-true-affected-resolver (the real #2 fix) and event-subject-payload-build-tripwire (the real payload-safety #1). See those for the full evidence."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `nx affected` is over-broad for backend changes (cyclic cross-service graph)

> **DROPPED 2026-06-07 — premise disproven.** Everything below this banner reflects
> the original (incorrect) hypothesis that a cyclic cross-service contract graph
> caused the over-report. A full investigation disproved it: the graph is bounded and
> correct, cycles are not the cause, and a service with zero cross-service contracts
> over-reports identically. The 28-affected is an nx 22.5.4 `affected`
> over-approximation tied to the universal `event-processor` lib. The 17-contract-lib
> plan was aimed at the wrong cause. **Superseded by `nx-affected-true-affected-resolver`
> (the real fix) and `event-subject-payload-build-tripwire` (the real payload-safety
> goal).** Retained for history; do not action.

## Symptom (reproducible, deterministic)

Changing **any single backend service's production `.ts` file** makes `nx affected`
report the **entire backend cluster (28 projects)** affected — all `-ctrl`/`-bff`/`-adpt`
services + the shared libs `event-processor` + `integration-testing`. So
`nx affected -t test-integration --base=origin/main` for a one-service change schedules
~23 services' integration suites (each hits deployed dev, ~1–5 min, surfaces unrelated
cold-start flakes). Surfaced 2026-06-05 during `dashboard-live-push-portfolio-summary`
closing phase — a frontend-lib + single-service change blasted 23 integration suites.

## Evidence (all on clean `main`, nx 22.5.4, `NX_DAEMON=false`, survives `nx reset`)

`nx show projects --affected --files=<F>` counts:

| F | affected |
|---|---|
| `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` | **28** |
| `services/ledger/ledger-ctrl/src/handlers/event-listener.ts` | **28** |
| `services/investor/dashboard-bff/src/service.stack.ts` | **28** |
| `services/investor/dashboard-bff/src/schema.graphql` | 1 |
| `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts` (excluded from the `production` namedInput) | 1 |
| `apps/dashboard-mfe/src/app/stores/dashboard.store.ts` | 2 |
| `libs/ui/src/index.ts` | 6 |

Decisive properties:
- The 28-set is **IDENTICAL regardless of which backend service's `.ts` changes**
  (dashboard-bff change == investor-ctrl change == same 28). Impossible under correct
  dependency-based affected (different services have different dependents).
- The 28-set == `libs/event-processor`'s reverse-dependency closure, and **includes the
  changed service's own UPSTREAM deps** (e.g. a dashboard-bff change lists
  `event-processor`, `investor-bff`, `integration-testing` — all things dashboard-bff
  imports, not things that import it). `dashboard-bff` has **0 in-edges** (nothing imports
  it) yet reports 28 affected.
- Not a cache/daemon/worktree artifact: reproduces after `nx reset`, on `main` with real
  `node_modules`, from the committed range `b3b20fb9..5efabfcb` directly.
  (Initial hypothesis "spurious worktree/symlink artifact" was WRONG — corrected here.)

## Root cause

The nx project graph for the backend is **densely connected and CYCLIC**, built from
**cross-service source imports of the per-service event-contract subpaths**
`@nestfolio/<svc>/events` and `@nestfolio/<svc>/domain` (branded `*EventTypes` value
exports, mapped in `tsconfig.base.json` `paths` — 26 service-like path mappings). These
are intentional type/contract sharing (NOT runtime API calls — consistent with the
events-only rule), but to nx they are static project-graph edges. Confirmed cycles
(`@nx/js` `nx/js/dependencies-and-lockfile` plugin):

- 2-cycles: `compliance-ctrl ↔ decision-workflow-ctrl`, `advisory-bff ↔ decision-workflow-ctrl`, `investor-bff ↔ investor-ctrl`
- SCCs: `{advisory-bff, compliance-ctrl, decision-workflow-ctrl, investor-profile-ctrl}` (size 4), `{investor-bff, investor-ctrl}` (size 2)
- High fan-out importers: `decision-workflow-ctrl` imports 6 other services; `investor-ctrl` 5; `dashboard-bff` 4 (`advisory-adpt`, `investor-adpt`, `investor-bff`, `ledger-adpt`).

With a cyclic graph, `nx affected` cannot isolate a single service and conservatively
marks the whole connected cluster affected. (The `nx graph --file` serialized
`dependencies` only exposes small SCCs and 0 in-edges for sink services like dashboard-bff,
yet `affected` still returns 28 — i.e. nx 22's affected over-approximates over the cyclic
cluster beyond what the serialized one-directional closure shows. The exact nx-internal
propagation rule was not pinned, but the cyclic dense contract-import graph is the cause.)

## Remediation options (pick during a future workstream)

1. **Operational (cheap, do in process docs now):** for single-service validation, scope
   integration to the changed service(s) directly — `nx run <svc>:test-integration` (with
   `NX_DAEMON=false`) — instead of `nx affected -t test-integration`. This is what unblocked
   the 2026-06-05 ship. Worth baking into `/backlog-next` step 6.4 and the integration-test
   skill (note: editing `.claude/skills/**` is auto-mode self-mod-guarded; do in an
   interactive session).
2. **Structural (the real fix):** relocate the cross-domain event CONTRACTS that services
   import from EACH OTHER (`@nestfolio/<svc>/events`, `/domain`) into a neutral **leaf
   contracts library** (extend `@nestfolio/event-types`, or a new `event-contracts` lib),
   so no service imports another service. Removes the cross-service edges + cycles → nx
   affected becomes precise (a service change affects only that service + true dependents).
   Aligns with "contracts are shared types, services communicate via events only."
3. **Narrow:** break just the confirmed cycles (the three 2-cycles + the size-4 SCC) by
   moving the specific mutually-imported contracts into a leaf lib. Smaller blast radius
   than (2) but only partially restores affected precision.

## Cheapest next step

Confirm whether the `@nestfolio/<svc>/events` + `/domain` exports are pure contract
definitions (no service business logic). If so, option (2)/(3) is a mechanical move to a
leaf lib. Pairs with the architecture's stated `event-types` branded-name pattern.

## Decision (2026-06-05) — option (2) STRUCTURAL, **per-producer** granularity LOCKED

Promoted from parking by explicit user direction. The "cheapest next step" above was
executed as a live-code investigation; findings (all from clean `main`):

- **All cross-service edges are contract-only.** Classifying every cross-service alias
  import: the only non-`/events`, non-`-adpt/domain` edge is
  `@nestfolio/decision-workflow-ctrl/agent-budgets` (2 importers) — same class (a shared
  contract subpath, already in the eslint `allow:` list). **Zero** service-code→service-code
  imports. ⇒ extracting contracts to leaf libs **fully** de-couples the service graph.
- **Contracts are pure + self-contained.** `*/events` = branded name-maps depending only on
  `@nestfolio/event-types`. `*-adpt/domain` re-exports names **plus shared payload
  contracts** (`ProposedTrade`, `MandateLevel`, broker-alpaca's `schemas.ts` → only `zod`).
  Hosting these in the contract lib is what extends the compile-time tripwire from
  **names** to **payload shapes**.
- **`libs/event-types` is the template:** `tags: ["scope:platform","type:lib"]`, plain
  `@nx/js:tsc` build, single `src/index.ts`. Every domain scope's `depConstraints` already
  permit depending on `scope:platform`.
- **The eslint allow-list is the team's own evidence** these imports are a special class:
  `@nestfolio/.+/events`, `-adpt/domain`, `agent-budgets` sit in the `allow:` escape-hatch,
  bypassing per-scope `depConstraints`. Silencing the *lint* error did nothing about the
  *nx graph* edge — the disconnect this fix closes (allow-list entries can then be removed).

**Graph (producer → distinct consumer services), 17 cross-consumed producers.** Cycles
confirmed: `investor-bff ↔ investor-ctrl`; size-4 SCC
`{decision-workflow-ctrl, advisory-bff, compliance-ctrl, investor-profile-ctrl}` (via
dwc→investor-profile-ctrl→compliance-ctrl→dwc). All cycles are contract-only → dissolved.

**Granularity decision.** Cyclicity + the non-contract flood (28→1) are fixed at *any*
granularity (the leaf is a leaf); granularity only trades contract-change precision vs
project count. **Per-producer (17 leaf libs) LOCKED** — it delivers the stated strategy
exactly: a contract change breaks *only* that contract's real consumers, names *and*
payloads, nothing spurious. Per-domain (4 libs) and single-lib were the lighter-weight
alternatives, rejected. Lowest-churn migration noted: move the contract file under the new
lib + **repoint the existing `@nestfolio/<svc>/events` path mapping** so consumers don't
change a line (only producers' own relative `./events` imports flip to the alias).

**Deliverable of THIS umbrella:** a design spec in `docs/superpowers/specs/`, decomposing
the migration into a curated set of queued implementation WSs (each Complex/worktree) such
that draining them = graph clean + affected precise + tripwire extended. Open design
questions for the brainstorm: lib layout/naming (`libs/contracts/<producer>` vs under
`event-types`); keep-alias vs rename the import specifier; fold payload schemas in now vs a
follow-up; `agent-budgets` handling; migration batching + per-batch verification (the
`nx show projects --affected` 28→1 assertion); eslint allow-list cleanup sequencing.
