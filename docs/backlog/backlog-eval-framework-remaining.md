---
id: backlog-eval-framework-remaining
status: shipped
closed: 2026-06-25
type: epic
notes: "Remaining work on the backlog-eval-framework (benchmark-backlog) harness after the shipped design + proven core (PR #24) + the backlog-eval-framework-usable milestone: the Phase-6 full corpus + /benchmark-backlog skill surface, plus two core-harness tooling defects. Theme epic, 3 members."
done_when: "The backlog-eval-framework reaches its full spec'd scenario corpus + /benchmark-backlog skill surface AND its two core-harness tooling defects (mis-calibrated firstTurnProseTokens proxy, leaked TMPDIR scratch dirs) are resolved or dropped; all members shipped or dropped."
scope: "Remaining build-out and tooling defects of the backlog-eval-framework (benchmark-backlog) harness: the full ~50-scenario corpus + the /benchmark-backlog skill surface (Phase 6), and correctness/hygiene defects in the shipped core (firstTurnProseTokens calibration, unit-test TMPDIR leaks)."
out_of_scope:
  - "The backlog skills the harness GRADES (backlog-skills-simplification) — that consumer epic is downstream of the harness, not part of it"
references: []
spec: null
plan: null
topic_memory: [project_backlog_eval_framework.md]
validation_gate: "All 3 core members shipped (epic-members exit 10 / rule 9). done_when fully met: full ~50-scenario corpus + /benchmark-backlog skill (backlog-eval-framework-full-corpus), firstTurnProseTokens proxy DEPRECATED in favour of tokens.total (bef-prose-token-proxy-miscalibrated), TMPDIR scratch-dir leak fixed (bef-unit-tests-leak-tmpdirs). E6 batched gate at tip b68bd4dd: cumulative benchmark-backlog node:test suite GREEN 56/56 (collected 56, TRUE_EXIT=0); e2e-fresh exit 0. Application Jest-e2e + Playwright = justified NO-OP — full branch diff is the benchmark-backlog dev-harness + skill/backlog docs only (zero application/service/infra/flow/lib surface, deploy detector exit 10 all-Tier-0), so the app e2e suites validate nothing this epic touched. 1 fork auto-resolved (recalibrate-vs-deprecate → deprecate) logged in run-state decisions[] for the PR body. No captured members."
---

# backlog-eval-framework — remaining build-out + core-harness defects

Root cause / shared trait: all three members are remaining work on the **same harness** — the
`backlog-eval-framework` (a.k.a. `benchmark-backlog`) grader. Its design dossier
[[backlog-eval-framework]] shipped, its proven core shipped in PR #24, and its gate/baseline/teeth
hardening shipped as `backlog-eval-framework-usable` (2026-06-25). What is left splits into the
Phase-6 build-out (full corpus + the user-triggered `/benchmark-backlog` skill) and two
correctness/hygiene defects in the already-shipped core. Honest caveat: the *kind* of work differs
per member (feature build-out vs tooling-defect fix); what they share is the harness they touch and
the `project_backlog_eval_framework` dossier.

Members (derived from `epic:` pointers):
- `backlog-eval-framework-full-corpus` (Phase 6 — full ~50-scenario corpus + `/benchmark-backlog` skill surface; budgeted Opus spend)
- `bef-prose-token-proxy-miscalibrated` (firstTurnProseTokens reads a hardcoded turn index + only the one-time load — recalibrate to the real skill-load turn or lean on `tokens.total`)
- `bef-unit-tests-leak-tmpdirs` (grade/worker/sandbox unit tests mkdtempSync throwaway dirs but never clean them up)
