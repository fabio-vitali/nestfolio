---
id: pr-pipeline-integration-tests
status: shipped
type: infra
references:
  - docs/superpowers/specs/2026-04-10-pr-integration-tests-design.md
  - docs/superpowers/plans/2026-04-10-pr-integration-tests.md
out_of_scope:
  - "deploy.yml (main → staging) integration test wiring"
  - "Branch-protection rule update — required-status-check toggle (filed as separate item: pr-pipeline-required-status-check)"
  - "Throwaway PR end-to-end pipeline rehearsal (filed as separate item: pr-pipeline-required-status-check)"
spec: docs/superpowers/specs/2026-04-10-pr-integration-tests-design.md
plan: docs/superpowers/plans/2026-04-10-pr-integration-tests.md
topic_memory:
  - project_ci_pipeline.md
validation_gate: |
  Code shipped on main across three commits:
    1. e981ccb1 (2026-04-10) — ci(pr-deploy): run integration tests against PR sandbox
       — adds sandbox-integration-test job, env NESTFOLIO_INTEG_PREFIX=sandbox-pr-${PR_NUMBER},
         needs=[detect-affected, sandbox-deploy], run-many on full deploy / affected on synchronize.
    2. 66691202 (2026-04-13) — feat(test-support): scaffold library with extracted modules
       — env-var fallback + CI guard moved into libs/test-support/src/context.ts during
         the integration-testing → test-support extraction. Function renamed
         createIntegrationContext → createTestContext.
    3. bd07ef2d (2026-04-16) — fix: resolve pre-existing test and lint issues.
  Lib unit tests: pnpm nx test test-support -- --testPathPatterns=context.test → 7/7 pass
    (3 prefix-resolution + 4 CI-guard cases).
  YAML parse: jobs list = [detect-affected, security-scan, build-and-test, sandbox-deploy,
    sandbox-integration-test] — verified 2026-05-07.
  Stale-ref sweep: zero `createIntegrationContext` references repo-wide; all 3 resilience
    integration tests + bootstrap.ts use createTestContext.
  Deferred to follow-up `pr-pipeline-required-status-check`: throwaway-PR rehearsal of
    Task 4 + GitHub branch-protection toggle (admin action, no code change).
notes: "Closed 2026-05-07 — implementation landed inline with the test-support extraction; backlog file lagged."
---

# PR pipeline integration tests

**Status:** shipped 2026-05-07. Code already landed on main in three commits between
2026-04-10 and 2026-04-16 (see `validation_gate`). The backlog file simply lagged the
implementation; closing it now and filing Task 4 as a separate small item.

**Topic memory:** `project_ci_pipeline.md` — updated 2026-05-07 to reflect shipped state.

**What shipped:**
- `libs/test-support/src/context.ts` — `createTestContext` resolves prefix from
  `options.prefix` → `process.env.NESTFOLIO_INTEG_PREFIX` → `'dev'`, and throws if
  `CI === 'true'` with no prefix in either source.
- `libs/test-support/test/context.test.ts` — 7 unit tests (3 prefix resolution + 4 CI guard).
- `.github/workflows/pr-deploy.yml` — new `sandbox-integration-test` job after
  `sandbox-deploy`, exporting `NESTFOLIO_INTEG_PREFIX=sandbox-pr-${PR_NUMBER}`,
  scope mirrors deploy (run-many on full / affected on synchronize), 30-min timeout.

**Drift from plan:** the plan from 2026-04-10 referenced `libs/integration-testing/src/context.ts`
and `createIntegrationContext`. The 2026-04-13 lib extraction split `integration-testing`
into `integration-testing` + `test-support`; the prefix-resolution machinery moved to
`test-support` and was renamed `createTestContext`. The plan's intent is fully realised
in the new home.

**Follow-up filed:** `pr-pipeline-required-status-check` — throwaway-PR rehearsal +
branch-protection toggle (Task 4 of the original plan).
