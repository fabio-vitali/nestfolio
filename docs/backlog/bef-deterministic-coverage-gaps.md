---
id: bef-deterministic-coverage-gaps
status: active
type: epic
notes: "ACTIVE delivery epic (promoted 2026-06-29 from theme): resolve the backlog-eval corpus's deterministic-teeth gaps — substring callLog matching + end-state proxies can't reliably gate nondeterministic, multi-step MODEL-BEHAVIOR invariants under headless `claude -p`. 4 CORE members (the determinism cluster) gate done_when; 3 CAPTURED riders (judge-blind harness bug, scenario-tags ergonomics, cost-figures doc nit) ride along for unified one-branch/one-PR context but do NOT gate closure. Work via /backlog-next-epic; captured audit at pre-done."
done_when: "Each in-scope bef invariant has a DETERMINISTIC regression signal that does not depend on nondeterministic model behavior under headless `claude -p` — either a deterministic call-log tooth on an elicitable action (replacing a flaky end-state/rubric proxy) or a unit test of the orchestrator predicate/freshness logic the live corpus cannot gate; all members shipped or dropped."
scope: "bef corpus scenarios/invariants whose deterministic gate fails because the signal rides nondeterministic, multi-step model behavior under headless `claude -p`: (1) an EXISTING scenario whose end-state/rubric proxy flakes because the worker action it proxies is nondeterministic; (2) a DROPPED invariant whose premise is a model judgment or multi-step model execution that substring callLog / end-state proxies cannot assert, so its real coverage belongs at the unit level (predicate routing/execution, freshness logic). Fix pattern: move the deterministic signal off the flaky model-behavior proxy — to a call-log tooth where elicitable, else to a named unit test."
out_of_scope:
  - "bef judge EVIDENCE-completeness bugs (bef-judge-blind-to-subworktree-diff) — the judge not SEEING the full diff, a distinct cause from deterministic-teeth limits on model-behavior invariants. CAPTURED as an orthogonal rider (epic_role: captured): worked in this session/PR for unified context, but NOT gating done_when (the determinism done_when is satisfied whether or not it ships)."
  - "bef ergonomics / doc-drift findings (bef-scenario-tags-reusable-suite, benchmark-backlog-skill-cost-figures-stale) — not a coverage-determinism cause. CAPTURED as orthogonal riders, NOT gating done_when."
  - "Skill-PROSE weaknesses a dropped scenario might expose (e.g. F-21 prominence) — those route to the relevant skill-simplification work, not this corpus-determinism epic."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# bef deterministic coverage gaps — model-behavior invariants vs the corpus's teeth

Root cause: the backlog-eval framework (bef) gates scenarios with **deterministic teeth** —
`grade.mjs` `callLog` substring matching plus end-state proxies (e.g. `branchCreated`, `rubricGate`).
These teeth cannot reliably capture **nondeterministic, multi-step model behavior** elicited under
headless `claude -p`. The failure shows two faces:

- **Flake face** — an existing scenario whose proxy rides a nondeterministic worker action, so the
  gate flips run-to-run (false REGRESSION on a single-iteration compare, or false GREEN when the
  flake lands on the baseline ref).
- **Un-gateable face** — an invariant whose premise is a model judgment or a multi-step model
  execution the substring teeth cannot assert (substring `includes` can't even count occurrences),
  so the live scenario was **dropped** and the real deterministic signal must move to a **unit test**
  of the orchestrator predicate's downstream routing/execution or its freshness logic.

Both faces are the **same** limitation and the **same** fix discipline: move the deterministic signal
off the flaky model-behavior proxy — to a deterministic call-log tooth where the action is elicitable,
otherwise to a named unit test the live corpus can't replace. Draining this theme makes the eval gate
trustworthy for branch-creation / deploy-routing / shared-typecheck / chained-gate invariants at once.

## Core members (gate `done_when` — the determinism cluster)

- `bef-branchcreated-assertion-enterworktree-flaky` (flake face: `branchCreated` end-state proxy flips because EnterWorktree adoption under `claude -p` is nondeterministic; pre-existing on main, ~3/4)
- `bef-closing-detector-live-coverage-gap` (un-gateable: closing-phase deploy-ROUTING decision is model judgment; detection predicates already unit-tested, the routing behavior is not)
- `bef-f21-shared-typecheck-live-coverage-gap` (un-gateable: F-21 POSITIVE needs the orchestrator to reliably execute a multi-step cumulative typecheck on a shared touch; predicate unit-tested, the execution is high-variance model behavior)
- `bne-e71-chained-gate-unit-coverage` (un-gateable: chained-second-gate premise is the E7.1 audit's model judgment + "gate ran twice" is uncountable by substring callLog; belongs at the `runstate.mjs` `e2e-fresh` unit level)

All four cross-reference each other and the shipped precedents (`bef-resume-partial-scenario-flaky`
swapped a flaky `rubricGate` for `callLog` teeth; `bne-resume-partial` / `bne-promote-clean` gated the
elicitable part + kept the judgment as informational). See [[project_backlog_eval_framework]].

## Captured riders (`epic_role: captured` — ride along, do NOT gate `done_when`)

Pulled in (2026-06-29) so the whole backlog-eval outstanding surface is worked in one branch/PR with
unified context. Each is genuinely **orthogonal** to the determinism done_when (different root cause /
fix), so none blocks closure — the **captured audit** at pre-done re-tests each; any that turns out
load-bearing is promoted to core, the rest spin out to `<epic>-leftovers` if still open at ship.

- `bef-judge-blind-to-subworktree-diff` (harness bug: the LLM judge can't see sub-worktree diffs → incomplete grading evidence; latent today. Distinct fix: make the judge see the full diff)
- `bef-scenario-tags-reusable-suite` (ergonomics: self-declaring scenario tags + a `--tag` runner filter for reusable named subsets)
- `benchmark-backlog-skill-cost-figures-stale` (doc nit: `benchmark-backlog/SKILL.md` hardcodes a stale "6 bne scenarios" cost figure vs the live corpus)
