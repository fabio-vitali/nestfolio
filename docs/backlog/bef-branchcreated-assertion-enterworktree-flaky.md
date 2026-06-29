---
id: bef-branchcreated-assertion-enterworktree-flaky
status: parking
type: bug
notes: "bef next-lane-complex (+ likely other branchCreated-asserting scenarios) flakes ~1/4: EnterWorktree/branch adoption under headless claude -p is nondeterministic. Pre-existing on main."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# bef `branchCreated` assertion flaky (EnterWorktree adoption under headless `claude -p`)

**Finding.** The `next-lane-complex` benchmark-backlog scenario asserts `state: { branchCreated: true }`
(the deterministic proxy for "classified Complex → adopted via worktree+branch"). That assertion is
**nondeterministic**: creating an isolation branch+worktree via `EnterWorktree` under headless
`claude -p` does not always happen, so the gate flips. Likely affects other branch-creation-dependent
scenarios too.

**Evidence (surfaced during the `backlog-skills-simplification` epic E6 compare gate, 2026-06-29).**

- An 8-scenario `compare main HEAD --iterations=1` showed `next-lane-complex` gate `1→0` (apparent
  REGRESSION). Diagnostic on the failing run: `invariantFailures: ["branchCreated=false (branches:
  main), expected true"]`, `numTurns=6` (vs 12-13 on a passing run), `rubricScores: …=3`.
- A confirmation `compare main HEAD --scenario=next-lane-complex --iterations=3` showed the flake is
  **pre-existing on `main`**, not introduced by the epic:
  - **A (main):** `gatePassRate=0.667` (2/3), `anyGateFlip=true`, identical `branchCreated=false`
    diagnostic on the failing iteration.
  - **B (HEAD):** `gatePassRate=1.0` (3/3), `anyGateFlip=false`.
  - Aggregate across all 4 HEAD iterations + 4 main iterations: both refs ~3/4 — statistically
    identical. So the epic's restructure did NOT cause or worsen it (the classify/adopt prose is
    byte-identical main↔HEAD; only Step 4.1 backstory was condensed + Step 6.8 became a helper call,
    both off the branch-creation path).

**Why it matters.** A single-iteration `compare`/`regression` run can show a **false REGRESSION**
(flake lands on the new ref) or a **false GREEN** (flake lands on the baseline ref). This undermines
the eval gate's reliability for any scenario whose gate depends on `branchCreated`. Same root-cause
class as the shipped `bef-resume-partial-scenario-flaky` (a bef scenario flaking because the worker's
behavior under headless `claude -p` was nondeterministic, fixed by replacing the fragile assertion
with deterministic call-log teeth).

**Candidate fixes (cheapest next step).**

1. Replace/augment the `branchCreated` end-state proxy with a **deterministic call-log assertion** of
   the Complex-lane adoption (mirroring how `bef-resume-partial-scenario-flaky` swapped a flaky
   `rubricGate` for `callLog` teeth) — e.g. assert the worktree-adoption command fired, not the
   resulting branch end-state.
2. Or stabilize the scenario's worktree-adoption path under headless `claude -p` (the agent
   sometimes stops before Step 4 adopt).
3. Or raise the default `--iterations` for `EnterWorktree`/branch-creation-dependent scenarios so a
   single flake can't flip the gate.

**Suggested clustering (non-blocking — for `/backlog-themes`).** This is a **backlog-eval corpus /
harness reliability** finding, not a backlog-skills change. It shares a root cause with the shipped
`bef-resume-partial-scenario-flaky` and the residual corpus findings in
`backlog-eval-corpus-hardening-leftovers` — a future `/backlog-themes` sweep should cluster these
into a "bef scenario determinism / corpus reliability" theme. Filed as an orphan now (file-and-continue);
the mint/join is the cold-path job.
