---
id: nx-affected-true-affected-resolver
status: queued
rank: 9
type: tooling
notes: "Replace `nx affected` (which over-approximates) with a custom tools/affected-projects.mjs that computes the TRUE affected set via reverse-reachability over the `nx graph --file` JSON — which IS correct. Root cause (investigation 2026-06-07): nx 22.5.4 `affected` returns event-processor's entire dependent closure (28) for ANY backend service change, regardless of that service's real dependents. Proven NOT the cross-service contract design, NOT cycles, NOT deep-subpath imports. Latest nx 22.7.5 does not fix it (known limitation, discussion #5580 / issue #1169); the projectsAffectedByDependencyUpdates config has no effect. The custom resolver gives correct bounded results (dashboard-bff→1, yahoo→10, ui→6, event-processor→28). Wire into /backlog-next 6.2/6.4 + the 5 CI workflows. Split 2026-06-07 from (and supersedes) the disproven nx-affected-overbroad-cyclic-service-graph item."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# nx affected over-reports — replace with a true-affected resolver

## Problem

`nx affected -t test-integration` (and `nx show projects --affected`) report **28
projects affected for ANY single backend service change** — blasting ~23 integration
suites for a one-service edit. The over-report inflates CI cost, flake surface, and
wasted runs. The operational mitigation (scope to the changed service:
`nx run <svc>:test-integration`) already works and unblocked the 2026-06-05 ship.

## Root cause (investigation 2026-06-07, all on clean `main`, nx 22.5.4)

The over-report is an **nx `affected` over-approximation**, NOT the repo's design.
Evidence:

- **The dependency graph is correct.** `nx graph --file` gives a bounded, accurate
  graph. Control: my reverse-reachability of `ui` = `[advisory-mfe, dashboard-mfe,
  investor-mfe, ledger-mfe, nestfolio-host]` → **6**, exactly matching the real
  `nx affected` for a `ui` edit. So the graph (and my reverse-reachability) is
  authoritative.
- **Yet `nx affected` ignores it for the backend.** Same method says `dashboard-bff`
  has **0** dependents (it's a read-model sink — nothing imports it), but
  `nx affected` returns **28** for a `dashboard-bff` edit. The affected set is
  character-for-character `event-processor`'s dependent closure, returned for *any*
  project that transitively imports `event-processor`.
- **NOT the cross-service contract design.** `broker-sim-adpt` does **zero**
  cross-service `/events` imports and has **0** dependents, yet still → 28.
- **NOT cycles.** Only 2 small SCCs exist (`{advisory-bff, compliance-ctrl,
  decision-workflow-ctrl, investor-profile-ctrl}` and `investor-bff ↔ investor-ctrl`).
  Temporarily breaking both to 0 SCCs (committed, isolated probe) → still **28**.
- **NOT deep-subpath imports.** `broker-sim-adpt` (no subpath imports) over-reports
  identically.
- **Reproduces** daemon on/off, with `--files` and `--base`, surviving `nx reset`.
- **Not version-fixable.** Latest nx is 22.7.5 (we are on 22.5.4); the 22.6/22.7
  changelogs contain no `affected`/project-graph precision fix. This is a known,
  long-standing limitation: nx discussion #5580 ("All projects too often affected")
  and issue #1169 (shared-library over-approximation). The documented config lever
  `pluginsConfig["@nx/js"].projectsAffectedByDependencyUpdates` was tested
  (committed) and had **no effect** — it targets the dependency-update variant, not
  source-change over-approximation.

## Fix — `tools/affected-projects.mjs`

Compute the true affected set ourselves from the (correct) `nx graph` JSON:

1. **Changed files** ← `git diff --name-only $base...$head` (+ working-tree changes).
2. **Touched projects** ← map each changed file to its owning project via project
   roots (`nx graph` node `data.root`). A small explicit **global-file list**
   (`tsconfig.base.json`, `nx.json`, `package.json`, `pnpm-lock.yaml`, and the
   resolver itself) → marks ALL projects touched (the *legitimate* everything-affected
   case).
3. **Affected** ← touched ∪ **reverse-reachability(touched)** over the graph's
   `dependencies` edges = touched + true transitive dependents (exactly what
   `nx affected` should return).
4. Optional `--with-target <t>` filter (e.g. `test-integration`); output
   newline-separated project names.

**Usage** (replacing the broken `nx affected -t …`):
```
nx run-many -t test-integration -p $(node tools/affected-projects.mjs --base=origin/main --with-target test-integration)
```

## Verification (bake these ground-truth assertions into the tool's tests)

| edited project | true affected | nx affected (broken) |
|---|---|---|
| `dashboard-bff` (sink) | **1** | 28 |
| `yahoo-finance-adpt` | **10** | 28 |
| `ledger-ctrl` | **11** | 28 |
| `ui` (control) | **6** | 6 ✓ |
| `event-processor` (real hub edit) | **28** | 28 ✓ |

## Integration

- `/backlog-next` step **6.2** (`test,lint`) and **6.4** (`test-integration`) switch
  from `nx affected` to the resolver. *(Editing `.claude/skills/**` is auto-mode
  self-mod-guarded → do in an interactive session.)*
- The 5 CI workflows likewise.
- Keep the operational mitigation (scope to changed service) as the interim until
  this ships.

## Relation to other work

Independent of `event-subject-payload-build-tripwire` (the payload-safety design).
Supersedes the dropped `nx-affected-overbroad-cyclic-service-graph` item, whose
"dense cyclic cross-service graph" root cause this investigation **disproved**.
