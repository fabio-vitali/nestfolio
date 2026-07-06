# Work-Driver Re-Platform — Strangler Migration Strategy

- **Date:** 2026-07-06
- **Status:** design (strategy spec; decomposes into implementation workstreams — this doc itself ships doc-layer)
- **Backlog item:** `runtime-work-driver-replatform` (core member of epic `runtime-operationalization`)
- **Supersedes the monolithic item:** yes — this spec splits it into 6 homogeneous-closure members (§9)
- **Depends on (all SHIPPED):** `runtime-seam-probe`, `runtime-backward-edge-live`, `runtime-item-schema-reconciliation`, `runtime-regression-harness`
- **Related specs:** `2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md`, `2026-07-03-runtime-seam-probe-design.md`, `2026-07-04-runtime-backward-edge-live-design.md`, `2026-07-06-runtime-regression-harness-design.md`

---

## 1. Context & motivation

`runtime-realization` shipped the Long-Horizon Engineering Runtime as a tested, harness-agnostic **library** (SPEC 1 registry/atom + SPEC 2 backward edge + SPEC 3 forward edge & capability seams). `runtime-operationalization` then made it **fire**: the diff-scoped commit gate is live, ~34 checks are migrated into `runtime/content/checks`, the backward edge has minted real lessons through a real floor, the item schema is reconciled and validated on read, and the **parity oracle** (`scripts/parity-oracle/`) grades the runtime loop against the legacy backlog skills.

What remains is the epic's headline `done_when` clause (5): **the runtime becomes the project's work-driver, not only its enforcement.** Today the four backlog *skills* — `backlog-lint`, `backlog-add`, `backlog-next`, `backlog-next-epic` — are still the authoritative procedures. The engine loop that would replace them (`runWorker`, `runOrchestrator`, `intake`) is built and unit-tested but is **not** what drives real workstreams.

This spec defines the **strategy** for closing that gap via a strangler-fig migration: re-platform the skills onto the engine one at a time, each individually revertable, with the legacy body retained behind a flag until a binding soak gate passes. It is a **strategy spec** — it establishes the reusable migration mechanism and decomposes the buildable work into sequenced implementation workstreams (§9), each of which gets its own plan later.

## 2. Architectural invariants (what de-risks this)

- **No data migration.** `docs/backlog/*.md` remains the one item store; the runtime reads it directly via `readItems()` (`runtime/engine/lib/scope-gate.mjs:36`), fail-closed on invalid items. Only *procedures* move. **Rollback at any point = stop calling the runtime path.**
- **The engine is already built.** `runWorker` (`runtime/engine/loop/worker.mjs:11`) and `runOrchestrator` (`runtime/engine/loop/orchestrator.mjs:11`) spines are live and CLI-drivable for the worker (`runtime/adapters/claude-code/run-item.mjs`); `intake` (`runtime/engine/lib/intake.mjs`) implements the epic-aware router; the journal is fully live (git-native NDJSON, writer lease, park/fulfil/replay). This migration is **wiring**, not engine construction.
- **The re-frozen seam contract is sufficient.** The seam probe (`docs/backlog/runtime-seam-probe.md`) verified the `Task`/`TaskResult`(paused+decision)/`choices`/`locus` contract survived real use with no structural type gaps; the four measured gaps were all filed forward and non-structural.
- **The doc store is materialized by side-cars, not the engine.** `lint.mjs --fix` regenerating `docs/BACKLOG.md` (`renderIndex`) and dossier `related_workstreams:` (`syncDossiers`) is doc-store materialization — the migration moves procedures, so these **stay** as skill/adapter side-cars.

## 3. Strategy overview

Three moving parts, then the migration itself:

1. **A flag** (`RUNTIME_ENGINE`) that selects runtime-path vs legacy-path per skill, with **hard cutover** semantics and **instrumented** deliberate fallback (§4).
2. **A soak observer** — the one genuinely-new instrument — that reads the git journal across real workstreams and proves the binding soak clause the parity oracle structurally cannot see (§5).
3. **A parity-oracle extension** — map the 42 `unmapped:'P5'` scenarios into the graded set as each skill migrates; a scenario going `unmapped → dominant` is the per-workstream acceptance signal (§6).

Plus **three shared prerequisite fixes** (the red-team parity-map holes, §7) that must land before `add` can claim router parity.

Then the **four skills** are strangled closest-parity-first: `add → lint → next → next-epic` (§8), each a standalone member PR (per epic decision D1, which wound the orchestrator down to standalone member draining because the ≥5-workstream soak gate deadlocks under one-branch/one-PR).

## 4. Section A — The strangler flag & path-provenance

**One flag, mirroring the existing idiom.** `RUNTIME_ENGINE` gates which path runs, using the `Boolean(process.env.X)` shape already proven for `RUNTIME_GATE_SKIP` at `runtime/adapters/git/pre-commit-gate.mjs:19`. No per-skill bespoke flags.

**Toggle sites = the adapter CLIs, not SKILL.md prose.** Each skill's entry / closing-phase step branches: flag on → call `run-intake.mjs` / `run-item.mjs` / `run-watch` / (`run-epic.mjs`); flag off → the legacy body. The legacy body stays byte-for-byte intact throughout soak (no-cleanup-during-migration rule; legacy deletion is P6, user-triggered).

**Hard cutover, not silent fallback.** When the flag is on, the runtime path is *authoritative*: on failure it **pauses at the floor** (fix-forward), it does **not** silently drop to legacy. A legacy fallback is only ever a *deliberate human act* — re-running the legacy skill because the runtime path is blocked — and that act journals a `path:legacy-fallback` record to a dedicated ledger. This makes fallbacks **loud and countable**, which is exactly what the soak gate requires. Every runtime-path run journals a `path:runtime` provenance record keyed to the workstream id.

**Rationale (decision D-A):** a soft auto-fallback would hide runtime bugs and make the "zero fallbacks" clause perpetually noisy; hard-cutover-with-loud-fallback keeps the signal honest and reuses the established skip-with-accountability pattern.

## 5. Section B — The soak observer (the missing go/no-go instrument)

The parity oracle proves the runtime *can* dominate on synthetic scenarios, but its runtime sandbox seeds **no `.claude/skills/`** at all (`scripts/parity-oracle/runtime-sandbox.mjs`), so a legacy fallback is *physically impossible in-sandbox* — the oracle **structurally cannot observe a real-workstream fallback**. That instrument gap is what this section fills.

**New:** `scripts/parity-oracle/soak-observer.mjs` — reads the git journal across real (non-sandbox) workstreams and computes the soak verdict:

- **≥5 distinct workstreams** each carry a `path:runtime` provenance record end-to-end, **AND**
- **zero `path:legacy-fallback`** records exist in that observation window, **AND**
- the parity oracle is **green** (all mapped pairs dominant per `scripts/parity-oracle/verdict.mjs`, including the scenarios newly mapped by §6).

Because §4 instruments fallbacks, the "zero legacy fallbacks" clause is **provable from the journal**, not asserted. The observer is the closure evidence for the terminal soak-gate item (§9.3). It lives under `scripts/parity-oracle/` next to the oracle it consumes (decision D-B).

## 6. Section C — Parity-oracle extension

The oracle has **42 scenarios tagged `unmapped:'P5'`** in `scripts/parity-oracle/mapping.mjs` (all 34 `bne-*` orchestrator scenarios, 2 `themes-*`, lane-classification, id-collision/notes-prose). **That list is the migration acceptance checklist.**

- **Rule:** each per-skill workstream (§8) maps its slice of the 42 into the graded set as it lands. A scenario moving `unmapped → dominant` (per `pairVerdict`, `scripts/parity-oracle/verdict.mjs:14`) is the per-workstream acceptance signal. No skill re-platform is "done" until its scenarios are mapped and green.
- **Guard against a hollow green:** extend the journal-invariants layer (`scripts/parity-oracle/runtime-grade.mjs`) with a **`path:runtime` assertion**, so a scenario only passes if the runtime path actually drove it.
- **Cadence:** the deterministic greenfield adoption e2e (`runtime/eval/e2e/greenfield.test.mjs`) is **already** in `nx runtime:test`. The live LLM parity sweep stays **on-demand** (cost-gated) — run at each workstream's ship and once at the soak gate — not per-commit CI.

## 7. Section D — The three parity-hole fixes (shared prerequisites)

These are the red-team parity-map holes; they land in the first workstream (§9.1) because `add` router parity depends on hole #1, and holes #2/#3 are legacy behaviors the soak gate would otherwise miss.

### Hole #1 — `Finding.check` is required
`FindingSchema.check` is `z.string().min(1)` (`runtime/engine/schema/finding.schema.ts:12`) — required, non-empty. But the dominant real `backlog-add` source is an agent-*observed* side-finding with **no originating check**. `check` is load-bearing twice in intake: the item id is `from-${finding.check}` and `provenance.from_check = finding.check` (`runtime/engine/lib/intake.mjs`). So a check-less finding cannot even be constructed today.
- **Fix:** make `check` **optional** in `FindingSchema` (the Item schema already has `from_check` optional — `runtime/engine/schema/item.schema.ts:28`); introduce a reserved provenance sentinel `agent-observed`, mirroring SPEC 3 §13's `starter-pack` sentinel precedent. `slug` falls back to a finding-id-derived slug when `check` is absent; `from_check` is omitted. (Decision D-D1: reserved sentinel over a broader schema redesign — smallest change that preserves the id/provenance contract.)

### Hole #2 — themes cold-path clustering + `<epic>-leftovers` spin-out (MISSING)
The runtime has only the single-finding hot-path `mint-aggregation` suggestion inside `shapeItems`. There is no all-vs-all cold-path clustering and no captured-audit leftovers spin-out.
- **Fix:** a **batch clustering procedure** over `readItems(backlogDir)` (parking orphans + `*-leftovers`) that mints/extends theme epics by shared root cause — the runtime home for `backlog-themes` — plus the **epic-close captured-audit** that auto-spins-out genuinely-orthogonal members into `<epic>-leftovers`. Judgment via the same `execute`/procedure seam intake already uses. **Classed as a procedure, not a check** (decision D-D2).

### Hole #3 — MEMORY↔backlog dossier-sync (`related_workstreams` regen, MISSING)
Legacy `lint --fix` regenerates dossier `related_workstreams:` from each item's `topic_memory:`. The backward edge already implements the *parallel* `mints:` reciprocal (`runtime/engine/backward/reconcile-lesson.mjs`) — that is the template.
- **Fix:** a reconcile pass keyed off `Item.topic_memory` writing dossier `related_workstreams:`, mirroring `reconcileLesson`'s bidirectional writer. **Classed as a side-car** (like `lint --fix` index regen), **not a check** — it materializes the doc store, which the migration does not move (decision D-D2).

## 8. Section E — The four per-skill re-platform workstreams (sequenced)

Closest-parity-first, so the loop is proven on cheap wins before the expensive build. Each is a standalone `/backlog-next` member PR, lands its oracle scenarios green (§6), and flips `RUNTIME_ENGINE` for its slice.

- **WS-1 · `add` → `intake.mjs`** (nearest parity — router already ported). Port the procedural context-loading the raw judge prompt skips (grep the active epic, read its `done_when:`/`scope:`, run the closure-predicate test) into `selectRoute` (`runtime/engine/lib/intake.mjs:27`); wire the `lint --fix` index-regen **side-car** after `writeItemFile`. Depends on Hole #1. Maps the 7 `rt-add-*` + atomicity/discard scenarios.
- **WS-2 · `lint` → registry gates.** Rules already migrated via check-migration; wire the flag so `preflight`/`postflight` call `run-gate`/`run-watch`; add the **rule-3 anchor-resolution evaluator** (a `module:` check — the one rule with no scheme, cf. `lint.mjs` `extractHeadings`); leave `renderIndex`/`syncDossiers` as the untouched side-car.
- **WS-3 · `next` → `runWorker`** (the big build). The **deploy-gate evaluator** modeled as a **sha-conditional expensive `runWatch`** at the ship boundary — reusing the exact pattern the orchestrator already uses for its epic-pre-done e2e batch (`runtime/engine/loop/orchestrator.mjs:34`: `cost_ceiling:'expensive'`, `e2eIsFresh` sha-pinning, evidence via `journal.record`). The runtime owns *when* it fires (skips if sha unchanged) and blocks ship on the recorded verdict; the actual `deploy.sh`/nx/e2e invocation sits behind an `execute`/procedure seam supplied by the host adapter (`detect-deploy-needed.mjs`'s `resolveDeployServices` true-affected resolver becomes that runner). Plus: lane → `contexts`/`cost_ceiling` mapping; `preflight`/`postflight`/`detect-*` become `gate`/`audit` checks; decision-log append = the `--auto` journaled floor answers. (Decision D-C.)
- **WS-4 · `next-epic` → `runOrchestrator`** (thin, last). A `run-epic.mjs` CLI driver (does not exist today — the orchestrator spine has no adapter) wrapping the live spine + member-selection/rule-11/e2e-freshness. **Defer** the gh-PR-state probe (`resume-gate.mjs`) and worktree-ops binding (host git stays; epics are drained standalone per D1).

## 9. Section F — Atomicity split (backlog restructuring this design authorizes)

`runtime-work-driver-replatform` bundles buildable work with a soak gate that only closes after ≥5 future workstreams — non-atomic per the CLAUDE.md atomicity rule. It is replaced by homogeneous-closure items, **all `core` members of `runtime-operationalization`** (parking theme epic), drained as standalone member PRs:

1. **`runtime-replatform-prereqs`** — Sections A–D: the `RUNTIME_ENGINE` flag + path-provenance, the `soak-observer.mjs`, the parity-oracle extension mechanism, and the 3 parity-hole fixes. Ships first (everything else depends on it).
2. **`runtime-replatform-add`** — WS-1.
3. **`runtime-replatform-lint`** — WS-2.
4. **`runtime-replatform-next`** — WS-3.
5. **`runtime-replatform-next-epic`** — WS-4.
6. **`runtime-replatform-soak-gate`** — the **terminal tracking item**; closes *only* when `soak-observer.mjs` reports ≥5 fallback-free runtime workstreams + oracle green. The one item whose closure verdict is legitimately deferred across future workstreams.

The original `runtime-work-driver-replatform` is **retired into a design-umbrella**: shipped as this strategy design, its `validation_gate` citing the committed spec + the 6 spawned members. The epic's `done_when` clause (5) is carried forward by items 2–6 (all core members), so shipping the design does not falsely close it. (Decision D-F.)

## 10. Section G — Out of scope

- Legacy-path **deletion** (P6, user-triggered) — the legacy bodies stay green throughout soak.
- `runtime-operational-surface` (the §14 view+executor — a separate epic member).
- Re-designing frozen ring-1 contracts (schemas/helpers) — a build-reconciliation delta re-freezes into SPEC 1, not here.
- Authoring **net-new** checks beyond migrating existing enforcement — new lessons flow through the backward edge / intake.
- The `fanOut` and `onTrigger` capability stubs — not needed for the work-driver.
- The epic orchestrator's gh-PR-state probe and worktree-ops binding — deferred within WS-4.

## 11. Sequencing & dependencies

```
runtime-replatform-prereqs  (flag + soak observer + oracle extension + 3 parity holes)
        │
        ├──> runtime-replatform-add     (needs Hole #1)
        ├──> runtime-replatform-lint
        ├──> runtime-replatform-next    (deploy-gate evaluator)
        └──> runtime-replatform-next-epic (thin run-epic.mjs)
                        │
                        ▼
        runtime-replatform-soak-gate  (≥5 fallback-free workstreams + oracle green)
```

`add`/`lint`/`next`/`next-epic` are independently revertable and may be re-ordered, but `prereqs` precedes all and `soak-gate` follows all. Each of the four skills, once flipped, contributes real workstreams toward the soak count.

## 12. Success criteria (the binding soak gate)

The re-platform is **done** when `soak-observer.mjs` reports:
1. ≥5 distinct real workstreams driven end-to-end by the runtime loop (`path:runtime`), **and**
2. zero `path:legacy-fallback` records in that window, **and**
3. the parity oracle green — every mapped pair dominant (`runtime.gatePassRate ≥ legacy` and zero new failure classes), including the scenarios each skill workstream mapped out of the 42.

Legacy-path deletion is a **separate, user-triggered act (P6)**, never bundled with hitting this gate.

## 13. Decisions made during brainstorming

| id | Decision | Chosen | Rejected |
|----|----------|--------|----------|
| D-shape | Design-doc shape | Strategy spec + per-skill workstreams | Monolithic spec; separate spec per concern |
| D-seq | Migration order + next-epic treatment | Closest-parity-first; next-epic last & thin | Highest-value-first; descope next-epic |
| D-C | Deploy-gate model | Runtime owns gating (sha-conditional expensive watch), host runs it | Host side-car outside loop; per-wake gate check |
| D-A | Flag semantics | Hard cutover + loud instrumented fallback | Soft auto-fallback |
| D-B | Soak observer location | `scripts/parity-oracle/` | `runtime/eval/` |
| D-D1 | Hole #1 fix | Optional `check` + `agent-observed` sentinel | Broader schema redesign |
| D-D2 | Holes #2/#3 classification | Procedure (themes) / side-car (dossier-sync) | Model as checks |
| D-F | Original item disposition | Retire into design-umbrella (ship as design, spawn 6 members) | Keep as one of the items |

## 14. Risks & open questions

- **The deploy-gate evaluator is the highest-effort, highest-risk slice** (WS-3). It is a real evaluator over a real AWS deploy + e2e; the sha-conditional expensive-watch pattern bounds cost but the runner binding is new work.
- **Soak duration is unbounded by calendar** — the gate needs ≥5 *fallback-free* runtime workstreams; early fallbacks (loud, per §4) reset confidence and are the honest signal that a skill isn't ready.
- **The procedural context-loading in WS-1** (grep active epic, closure-predicate) is currently the raw judge's job; porting it deterministically vs. trusting the judge is a WS-1 plan-level decision, not resolved here.
