---
id: backlog-eval-corpus-hardening
status: shipped
type: epic
closed: 2026-06-29
notes: "SHIPPED 2026-06-29. Live-validated + hardened the backlog-eval-framework corpus into a trustworthy regression reference: committed full-corpus baseline (50 scenarios, all green, no flips), every scenario gates deterministically, drive-to-ship routes to the stubbed finishing skill. 5 core members shipped; 3 captured spun out to backlog-eval-corpus-hardening-leftovers."
done_when: "The corpus has a committed live full-corpus baseline, every scenario gates deterministically (no flaky rubric swings), and the drive-to-ship scenarios route to a stubbed finishing skill instead of self-merging; all members shipped or dropped."
scope: "Live validation and scenario/sandbox hardening of the backlog-eval-framework corpus — the deferred budgeted baseline run, the missing finishing-a-development-branch sandbox stub, and the flaky resume scenario — i.e. everything needed to make the corpus a trustworthy regression reference."
out_of_scope:
  - "The backlog-skills-simplification consumer epic itself (doc-restructuring of the skills; this theme produces the reference it diffs against, it is not that work)."
  - "Adding NEW scenarios or expanding corpus coverage — this theme hardens the existing corpus, not its breadth."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: "Committed full-corpus baseline at scripts/benchmark-backlog/baseline.json — 50 scenarios, all gatePassRate=1, anyGateFlip=false (commit 40a0728d, baseline.provenance.json records each row's source run+SHA). Assembled by splice-baseline.mjs from 7 windowed validation runs (the live ~115M-token corpus exceeds one subscription window's ~37-49M cap, so a single conclusive pass is physically impossible); splice is sound because the eval harness (grade/sandbox/runner/cost/stubs/structural-lint) AND skill prose are byte-identical across all source SHAs (4ad94fb7..HEAD) — only scenario files + the next-lanes fixture changed — and the script blocks on any harness drift or stale/missing row. Live validation surfaced 9 scenario-authoring defects (NONE were skill bugs); all fixed: de-flaked bne-e2/bne-e71/bne-resume-pr-open-stop/bne-member-f21-nonshared/next-lane-design-doc/-simple with deterministic teeth, fixed the next-lane-doc-layer fixture; dropped 3 un-gateable/redundant scenarios (bne-e5 unit-covered; bne-member-f21-shared + next-closing-detector judgment-only with no deterministic proxy → unit-coverage parking items). Deterministic pre-gate green throughout: structural-lint clean, 60/60 harness unit tests, backlog-lint 11/11. e2e-fresh check passes (e2e.sha==HEAD). Corpus 53→50."
---

# Backlog-eval corpus hardening

Root cause: the `backlog-eval-framework` corpus + skill surface shipped (deterministic gate green —
structural-lint + fixture-existence + harness unit tests), but the corpus has never been **run
live** at full scale, and two scenarios are not yet trustworthy. Until the corpus is live-validated
and hardened, `backlog-skills-simplification` has no reliable regression reference to diff against.
The shared trigger across these members is "the eval corpus exists but is not yet a trustworthy
regression reference." Fix pattern: run the budgeted baseline, stub the finishing skill so
drive-to-ship scenarios gate faithfully, and de-flake the resume scenario.

Members (derived from `epic:` pointers):
- `backlog-eval-framework-baseline-run` (the deferred budgeted live 3× full-corpus baseline = the regression reference itself; cost-gated)
- `bef-finishing-stub-drive-to-ship` (add a `stubs/finishing/SKILL.md` so drive-to-ship scenarios route to a sanctioned finish instead of self-merging → unlocks a faithful `neverCalled: ['gh pr merge']` assertion)
- `bef-resume-partial-scenario-flaky` (the `bne-resume-partial` scenario swings rubric 1/5↔4/5; `rubricGate:4` correctly exposed it — disambiguate scenario-over-denial vs skill resume-path ambiguity)
