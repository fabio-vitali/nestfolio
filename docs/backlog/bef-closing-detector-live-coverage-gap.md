---
id: bef-closing-detector-live-coverage-gap
status: active
type: tooling
notes: "The closing-phase ROUTING invariant (a deploy-requiring item routes to the deploy + e2e gate, not a no-deploy doc-derivation close) has no deterministic LIVE corpus scenario — the deterministic deploy.sh/nx-e2e stub call only fires by driving the whole Complex lane headlessly (worktree → implement → close), which a `claude -p` run can't reproduce. The detection PREDICATES are already unit-tested; the orchestrator's routing DECISION is the model-behavior gap. next-closing-detector was dropped (rubricGate:4 swung 3↔5 with no deterministic fallback)."
references: []
spec: null
plan: null
out_of_scope:
  - "The downstream model ROUTING behavior itself (given exit 0 = deploy-needed, does the agent then actually run the deploy + e2e gate before ship) — that is nondeterministic model behavior under headless `claude -p`, accepted as documented-only / informational. It is NOT unit-gateable; we gate the deterministic SEAM the routing reads (the CLI exit-code contract), not the model's reaction to it."
  - "Rebuilding a live corpus scenario for closing-phase routing (the member's option a) — rejected: a `deploy.sh`/`nx-e2e` stub-call fixture still rides a `claude -p` headless drive, re-introducing the exact model-behavior live-drive dependency this epic's done_when exists to eliminate."
topic_memory: [project_backlog_eval_framework.md]
epic: bef-deterministic-coverage-gaps
epic_role: core
---

# Closing-phase deploy-routing: no deterministic live corpus coverage

Surfaced during `backlog-eval-corpus-hardening` E6-recovery. `next-closing-detector` graded whether
`/backlog-next` on a deploy-requiring item (`deploy-gated-fix`, Complex lane) correctly concludes at the
closing phase that it needs a **dev deploy + e2e gate** (not a no-deploy doc-derivation close) and routes
to that validation before any ship/PR.

The scenario was **judgment-only by design**: the deterministic signal (a `deploy.sh` / `nx run
e2e-feature-tests` stub call) only fires if the run drives the entire Complex lane headlessly
(worktree → real CDC-wiring implementation → closing), which is not reliably reproducible in a `claude -p`
run. So it gated purely on `rubricGate: 4` + `terminal: pause`. The rubric **swings 3↔5** on correct
behavior (judge phrasing-variance, terminal + everything else passing), so it could not gate
deterministically and was **dropped** (per the f21-shared / bne-e71 precedent: judgment-only + no
deterministic proxy → drop + unit-cover).

## Where deterministic coverage already lives / should live

- The **detection predicates** are already unit-tested:
  `.claude/skills/backlog-next/test/detect-deploy-resolve.test.mjs` (deploy-needed) and
  `.claude/skills/backlog-next/test/classify-derivation.test.mjs` (doc-derivation). These deterministically
  cover "is a deploy needed? is this a doc-derivation close?" — the inputs to the routing decision.
- The **uncovered part** is the orchestrator's *routing behavior* — given "deploy needed", does the closing
  phase route to the deploy + e2e gate before ship rather than skipping to a PR? That is model behavior the
  unit tests don't capture. Options when picked up: (a) re-scope a live scenario by seeding a runstate/fixture
  that places the item AT the closing phase (skip the unreproducible worktree→implement drive) so a real
  `deploy.sh`/`nx-e2e` stub call fires and can be asserted deterministically (a reusable "closing-phase"
  fixture pattern); or (b) accept the two detection unit tests as sufficient and leave the routing as
  documented-only.

Mirrors [[bef-f21-shared-typecheck-live-coverage-gap]] and [[bne-e71-chained-gate-unit-coverage]] — invariants
whose live elicitation needs a heavy, non-deterministic model drive the corpus's deterministic teeth can't gate.
