---
id: bef-closing-detector-live-coverage-gap
status: shipped
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
validation_gate: "Deterministic signal moved off the dropped model-behavior live scenario onto a unit test of the orchestrator predicate's exit-code SEAM (epic done_when's sanctioned resolution). Refactor + test in commit 62b28bb6: detect-deploy-needed.mjs / detect-doc-derivation.mjs export pure deployExitCode/derivationExitCode + DEPLOY_EXIT/DERIVATION_EXIT; .claude/skills/backlog-next/test/detect-cli-exit-contract.test.mjs (9 cases) gates polarity (deploy/derivation → 0 = act, 10 = skip), the specific value 10 (not 1), and a --base=HEAD CLI wiring smoke proving main() honors the contract. `node --test .claude/skills/backlog-next/test/*.test.mjs` → 49 pass / 0 fail (40 pre-existing + 9 new; refactor behavior-preserving). Closing-phase detectors (6.1/6.3) self-report Tier-0/no-op for this skill-tooling change: derivation=false exit 10, deploy=false exit 10; true-affected (6.2) = no nx projects. No deploy / no e2e (test-only skill tooling)."
closed: 2026-06-30
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

## Resolution (shipped 2026-06-30)

Chose **option (c)** (a refinement of option b): gate the deterministic SEAM the routing reads — the
detectors' CLI **exit-code contract** — rather than rebuild a live scenario (option a, rejected: a
`deploy.sh`/`nx-e2e` stub fixture still rides a `claude -p` headless drive, re-introducing the
model-behavior dependency the epic eliminates) or leave it documented-only (option b, weaker: the
exit-code mapping was untested).

The existing unit tests (`classify-changes`, `detect-deploy-resolve`, `classify-derivation`) cover the
pure classifier functions but **not** the boolean→exit-code mapping the orchestrator's `/backlog-next`
closing phase actually routes on (Step 6.1/6.3: `exit 0` = act, `exit 10` = skip). That polarity — and
the specific value `10`, not `1` — was the load-bearing-yet-untested seam.

- `detect-deploy-needed.mjs` / `detect-doc-derivation.mjs` now export pure `deployExitCode` /
  `derivationExitCode` + `DEPLOY_EXIT` / `DERIVATION_EXIT`; `main()` routes both exit points through
  them (behavior-preserving — the exit code never depended on the nx-graph resolver, whose failure is
  caught without changing it, so the contract is unit-gateable with no git/nx).
- `test/detect-cli-exit-contract.test.mjs` (9 cases): real-classifier→real-mapping for both polarities
  of both detectors + a `--base=HEAD` CLI wiring smoke proving `main()` honors the contract end-to-end.

The downstream **model routing behavior** (given `exit 0`, does the agent then run the deploy + e2e
gate before ship) stays informational/documented-only — un-unit-testable model behavior, per the
sibling discipline (gate the elicitable/deterministic part, keep the judgment as informational).
