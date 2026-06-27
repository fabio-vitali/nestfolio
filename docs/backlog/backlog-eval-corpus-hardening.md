---
id: backlog-eval-corpus-hardening
status: active
type: epic
notes: "The backlog-eval-framework corpus shipped structurally but is not yet live-validated/hardened — the regression reference backlog-skills-simplification will diff against. Theme epic, 3 members."
done_when: "The corpus has a committed live full-corpus baseline, every scenario gates deterministically (no flaky rubric swings), and the drive-to-ship scenarios route to a stubbed finishing skill instead of self-merging; all members shipped or dropped."
scope: "Live validation and scenario/sandbox hardening of the backlog-eval-framework corpus — the deferred budgeted baseline run, the missing finishing-a-development-branch sandbox stub, and the flaky resume scenario — i.e. everything needed to make the corpus a trustworthy regression reference."
out_of_scope:
  - "The backlog-skills-simplification consumer epic itself (doc-restructuring of the skills; this theme produces the reference it diffs against, it is not that work)."
  - "Adding NEW scenarios or expanding corpus coverage — this theme hardens the existing corpus, not its breadth."
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: null
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
