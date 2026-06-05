---
id: nx-affected-overbroad-cyclic-service-graph
status: parking
type: tooling
notes: "nx affected marks ALL 28 backend projects affected for ANY single backend src .ts change (deterministic, survives nx reset). Root: dense + CYCLIC nx project graph from cross-service /events + /domain contract imports. Makes `nx affected -t test-integration` blast the whole backend; CI cost + flake-surface + wasted runs. Operational mitigation: scope to the changed service directly."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `nx affected` is over-broad for backend changes (cyclic cross-service graph)

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
