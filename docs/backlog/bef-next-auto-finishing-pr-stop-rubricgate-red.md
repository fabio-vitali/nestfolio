---
id: bef-next-auto-finishing-pr-stop-rubricgate-red
status: parking
type: bug
notes: "Surfaced by the parity oracle's live bring-up (2026-07-06): legacy next-auto-finishing-pr-stop failed its own rubricGate:4 in 2/2 independent runs (judge 2/5 then 1/5 — 'auto-resolved decisions recorded in the workstream file on the branch' judged missing). Either the legacy --auto decision-log behavior regressed since the 2026-06-27 baseline, or the judge is miscalibrated on this rubric, or the committed bef baseline row for this scenario is stale."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
---

# Legacy next-auto-finishing-pr-stop fails its own rubricGate under the parity harness (0/2)

During the parity-oracle live bring-up (workstream `runtime-regression-harness`, 2026-07-06), the
LEGACY side of the `next-auto-finishing-pr-stop` pair failed its `rubricGate: 4` in both of two
independent 1× runs (judge scores 2/5 and 1/5) while all deterministic layers passed (terminal ok,
deploy fired, `gh pr create` called, no self-merge, branch created). The judged deficiency both times:
the run did not visibly record its auto-resolved decisions in the workstream file on the branch.

The runtime side of the same pair passes (gate 1.0), so pair dominance holds and the parity verdict is
unaffected — but 0/2 is not judge noise to dismiss (flake-means-broken). Three hypotheses to separate,
with kept sandboxes/transcripts as the starting evidence:

1. The legacy `/backlog-next --auto` decision-log behavior regressed since the 2026-06-27 baseline
   (its committed bef `baseline.json` row may be stale — the corpus history has seen this class).
2. The judge is miscalibrated on this rubric (branch-diff visibility of the decision-log section).
3. The scenario's rubric wording demands more than the skill ever guaranteed.

Evidence pointers: parity reports `benchmarks/parity-oracle/parity-2026-07-06T09-04-27-190Z.md` and
`parity-2026-07-06T09-20-13-424Z.md` (gitignored, local); kept sandboxes from the `--keep` runs.
