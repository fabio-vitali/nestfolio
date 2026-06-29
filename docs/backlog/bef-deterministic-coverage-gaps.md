---
id: bef-deterministic-coverage-gaps
status: parking
type: epic
notes: "backlog-eval corpus determinism theme (minted 2026-06-29 by backlog-themes): the bef corpus's deterministic teeth — substring callLog matching + end-state proxies — can't reliably gate nondeterministic, multi-step MODEL-BEHAVIOR invariants under headless `claude -p`, producing either a flaky scenario or a dropped scenario whose real coverage must move to unit tests. Theme epic, 4 members."
done_when: "Each in-scope bef invariant has a DETERMINISTIC regression signal that does not depend on nondeterministic model behavior under headless `claude -p` — either a deterministic call-log tooth on an elicitable action (replacing a flaky end-state/rubric proxy) or a unit test of the orchestrator predicate/freshness logic the live corpus cannot gate; all members shipped or dropped."
scope: "bef corpus scenarios/invariants whose deterministic gate fails because the signal rides nondeterministic, multi-step model behavior under headless `claude -p`: (1) an EXISTING scenario whose end-state/rubric proxy flakes because the worker action it proxies is nondeterministic; (2) a DROPPED invariant whose premise is a model judgment or multi-step model execution that substring callLog / end-state proxies cannot assert, so its real coverage belongs at the unit level (predicate routing/execution, freshness logic). Fix pattern: move the deterministic signal off the flaky model-behavior proxy — to a call-log tooth where elicitable, else to a named unit test."
out_of_scope:
  - "bef judge EVIDENCE-completeness bugs (e.g. the orphan bef-judge-blind-to-subworktree-diff) — that is the judge not SEEING the full diff, a distinct cause from deterministic-teeth limits on model-behavior invariants; kept as a standalone orphan, deliberately not folded here."
  - "bef ergonomics / doc-drift findings (scenario tags, stale cost figures) — not a coverage-determinism cause."
  - "Skill-PROSE weaknesses a dropped scenario might expose (e.g. F-21 prominence) — those route to the relevant skill-simplification work, not this corpus-determinism theme."
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

Members (derived from `epic:` pointers):
- `bef-branchcreated-assertion-enterworktree-flaky` (flake face: `branchCreated` end-state proxy flips because EnterWorktree adoption under `claude -p` is nondeterministic; pre-existing on main, ~3/4)
- `bef-closing-detector-live-coverage-gap` (un-gateable: closing-phase deploy-ROUTING decision is model judgment; detection predicates already unit-tested, the routing behavior is not)
- `bef-f21-shared-typecheck-live-coverage-gap` (un-gateable: F-21 POSITIVE needs the orchestrator to reliably execute a multi-step cumulative typecheck on a shared touch; predicate unit-tested, the execution is high-variance model behavior)
- `bne-e71-chained-gate-unit-coverage` (un-gateable: chained-second-gate premise is the E7.1 audit's model judgment + "gate ran twice" is uncountable by substring callLog; belongs at the `runstate.mjs` `e2e-fresh` unit level)

All four cross-reference each other and the shipped precedents (`bef-resume-partial-scenario-flaky`
swapped a flaky `rubricGate` for `callLog` teeth; `bne-resume-partial` / `bne-promote-clean` gated the
elicitable part + kept the judgment as informational). See [[project_backlog_eval_framework]].
