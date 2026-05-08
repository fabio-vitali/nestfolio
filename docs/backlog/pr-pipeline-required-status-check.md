---
id: pr-pipeline-required-status-check
status: active
type: infra
notes: "Throwaway-PR rehearsal of sandbox-integration-test + flip required-status-check on main."
references:
  - docs/superpowers/plans/2026-04-10-pr-integration-tests.md#task-4-end-to-end-verification
  - .github/workflows/pr-deploy.yml
out_of_scope:
  - "Modifying pr-deploy.yml — the rehearsal is pure verification + an admin toggle, no code change."
  - "Touching deploy.yml (main → staging) integration test wiring — explicitly out of scope per parent ship's out_of_scope."
  - "Tuning sandbox-pr-${PR_NUMBER} naming, prefix conventions, or NESTFOLIO_INTEG_PREFIX rename (separate item: rename-nestfolio-integ-prefix-to-prefix)."
  - "Investigating any pre-existing test flakes the rehearsal surfaces — file via backlog-add and continue."
  - "Cost optimization of the run-many-on-open behaviour (full deploy on first push). Defer until post-rehearsal review surfaces it as load-bearing."
spec: null
plan: docs/superpowers/plans/2026-04-10-pr-integration-tests.md
topic_memory:
  - project_ci_pipeline.md
validation_gate: null
---

# Rehearse PR pipeline + flip required-status-check

Follow-up to `pr-pipeline-integration-tests` (shipped 2026-05-07). The `sandbox-integration-test` job has been on `main` since 2026-04-10 (`e981ccb1`) but no real PR has exercised it end-to-end yet, and `main` branch protection does not list it as a required check.

Task 4 of `docs/superpowers/plans/2026-04-10-pr-integration-tests.md` defines the rehearsal:

1. Open a throwaway PR with a no-op change (whitespace edit in a service README).
2. Observe `detect-affected → [security-scan, build-and-test] → sandbox-deploy → sandbox-integration-test` runs green.
3. Locally introduce a failing assertion in one affected service's integration test, push, observe `sandbox-integration-test` hard-fails and PR is merge-blocked.
4. Revert, push, observe concurrency cancels the previous run and the new run passes.
5. Close the PR, observe `pr-cleanup.yml` tears down `sandbox-pr-${PR_NUMBER}`.
6. (Admin action) Mark `sandbox-integration-test` as a required status check on `main` branch protection.

**Why parked:** rehearsal consumes ~15-30 min of CI + an AWS sandbox tear-up/teardown cycle. Not blocking — current PR-on-main behaviour already exercises the job; absence of required-status-check just means a red `sandbox-integration-test` doesn't auto-block merge today.

**Cheapest next step:** the next legitimate PR on this repo (not a throwaway) will provide steps 1-2 for free. After that, only the branch-protection toggle remains, which is a 30-second admin action.
