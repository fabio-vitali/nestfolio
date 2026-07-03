---
id: runtime-realization
status: shipped
type: epic
notes: "Delivery epic orchestrating the BUILD of the Long-Horizon Engineering Runtime from its three realization specs (derived + shipped in runtime-realization-specs). THREE SEQUENTIAL VERTICAL SLICES in dependency order — SPEC 1 (ring-1 check registry & hybrid atom) → SPEC 2 (backward edge / learning loop, the moat) → SPEC 3 (forward edge & capability seams). Each slice: plan → build → ship as its OWN complex-lane PR; the next slice's plan is then authored against the prior slice's MERGED, battle-tested contract. METHOD (user-decided): plan authoring = INLINE, Opus 4.8 MAX effort, one slice at a time (NEVER batch all 3 plans up front — building SPEC 1 re-freezes schema deltas SPECs 2/3 consume; ≥3 already found); plan review = OPTIONAL ultracode adversarial pass per plan before build; execution = INLINE + visible (user preference + vision legibility law), TDD, isolated worktree per slice; ultracode reserved for execution FAN-OUT only where a plan's tasks are genuinely independent. Members worked INDIVIDUALLY via /backlog-next (per-spec PRs) — deliberately NOT the batched single-branch /backlog-next-epic flow (the frozen-contract dependency forbids building SPEC 2 before SPEC 1 is merged). Precedent for a delivery epic drained via individual member PRs from parking: order-execution-money-path. The first SPEC 1 plan was authored then DELETED (user forgot max-effort); slice 1 restarts with a fresh max-effort plan."
done_when: "All three core build slices shipped. SPEC 1: ring-1 engine (check/item/finding schemas + the six typed helpers loadRegistry/resolveEvaluator/runCheck/findByScope/advanceLifecycle/metaCheck, all §13 golden gates green) + its content-ring proof slice. SPEC 2: the backward-edge learning loop (mint/curate at the floor, provenance/supersession, enforcement-as-memory) dogfooded on the 5 real mechanizable feedback_* lessons. SPEC 3: forward edge + the six capability interfaces + journal + the no-lost-value equivalence map + its proof slice. Each built TDD-first and dev-verified; every §15 re-freeze delta surfaced during a build reconciled back into SPEC 1. Every core member shipped or dropped."
scope: "The three build slices (registry/atom; backward edge; forward edge + seams), each planned (inline, MAX effort) → built (TDD, isolated worktree, per-spec PR) → shipped in strict 1→2→3 order; each slice's first-content-ring proof slice; the contract re-freezes into SPEC 1 §15 the builds surface."
out_of_scope:
  - "Extracting the Runtime into a standalone repo/package — slices build the portable core + Nestfolio as the first content ring IN-PLACE; physical extraction is a later program."
  - "Product name (vision §15.7)."
  - "Migrating ALL 34 live check surfaces / authoring the FULL content ring — each slice ships only a bounded proof slice; full migration is a follow-on."
  - "A second host adapter (proving harness-fungibility on a non-Claude-Code host) — deferred until the first adapter + content ring are dogfooded."
  - "Re-litigating the vision / target-architecture / the three specs (frozen inputs) — slices BUILD them; contract changes only re-freeze via SPEC 1 §15."
references:
  - docs/superpowers/specs/2026-07-01-runtime-spec-1-check-registry-and-atom.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-2-backward-edge-learning-loop.md
  - docs/superpowers/specs/2026-07-01-runtime-spec-3-forward-edge-and-capability-seams.md
  - docs/vision/long-horizon-engineering-runtime.md
spec: null
plan: null
topic_memory: [project_runtime_realization.md]
validation_gate: "All 3 core build slices shipped + dev-verified: SPEC 1/2/3 (runtime-spec-{1,2,3}-*-impl) — 172 runtime node:test + tsc green; backward edge dogfooded on 5 lessons; forward edge + 6 capability seams + journal + §12 no-lost-value map shipped. Every core member terminal; the captured operational-surface member re-homed to runtime-operationalization, where adoption/operationalization continues."
closed: "2026-07-02"
---

# runtime-realization — build the Long-Horizon Engineering Runtime (delivery epic)

Orchestrates the BUILD of the Runtime from the three realization specs (derived + shipped in
`runtime-realization-specs`). The specs settle *what* to build; this epic sequences *building* it.

## The three slices (strict dependency order)

| # | Member | Deliverable | Plan mode | Exec mode | Ships as |
|---|---|---|---|---|---|
| 1 | `runtime-spec-1-check-registry-impl` | ring-1 engine: 3 schemas + 6 typed helpers + content-ring proof slice | inline · **max effort** | inline · visible · TDD · worktree | its own PR |
| 2 | `runtime-spec-2-backward-edge-impl` | the moat: mint/curate at the floor, enforcement-as-memory, dogfooded on 5 real lessons | inline · **max effort** (against MERGED SPEC 1) | inline · visible · TDD · worktree | its own PR |
| 3 | `runtime-spec-3-forward-edge-impl` | forward edge + 6 capability interfaces + journal + equivalence map | inline · **max effort** (against MERGED SPEC 1+2) | inline · visible · TDD · worktree | its own PR |

## Why vertical slices, not batched plans

SPEC 1 **freezes a schema SPECs 2 & 3 consume verbatim.** Authoring SPEC 1's plan already surfaced
≥3 contract deltas; *building* it will surface more. So each downstream plan is written against the
prior slice's **merged, battle-tested** contract — never a paper schema. This is the frozen-contract
dependency, and it is why we do NOT batch-write all three plans up front and do NOT use the
single-branch `/backlog-next-epic` flow. It also honors the vision's own "prove the backward edge
first" (SPEC 2 dogfood) and single-active discipline.

## Working protocol

- **One slice at a time**, via `/backlog-next <member-id>` (complex lane → isolated worktree → single
  PR per slice, `superpowers:finishing-a-development-branch`). NOT `/backlog-next-epic` (batched).
- **Plan** each slice inline at **Opus 4.8 max effort**; optionally run an **ultracode adversarial
  plan-review** before building; **execute** inline + visible (TDD), reserving ultracode for
  execution fan-out only where a plan's tasks are genuinely independent.
- **Re-freeze**: any contract delta a build surfaces goes back into SPEC 1 §15 before the next slice's
  plan is authored.
- **Successors sit in `parking`**, promoted to `active` via `/backlog-next` as each predecessor ships
  (remove the trigger sentence on promotion — backlog rule 8).

Precedent for a delivery epic drained via individual per-member PRs from parking:
`order-execution-money-path`.
