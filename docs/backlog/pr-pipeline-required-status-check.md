---
id: pr-pipeline-required-status-check
status: parking
type: infra
notes: "Throwaway-PR rehearsal + branch-protection toggle. BLOCKED on ci-pipeline-bring-up — pipeline has never produced a green run."
references:
  - docs/superpowers/plans/2026-04-10-pr-integration-tests.md#task-4-end-to-end-verification
  - .github/workflows/pr-deploy.yml
out_of_scope: []
spec: null
plan: docs/superpowers/plans/2026-04-10-pr-integration-tests.md
topic_memory:
  - project_ci_pipeline.md
validation_gate: null
---

# Rehearse PR pipeline + flip required-status-check

**Status:** parked 2026-05-08 after rehearsal attempt (PR #1) surfaced that the entire CI pipeline has never run successfully. This rehearsal is the LAST step of a much larger bring-up workstream — see `ci-pipeline-bring-up`.

## Original rehearsal scope (preserved for when bring-up is done)

Follow-up to `pr-pipeline-integration-tests` (shipped 2026-05-07). Task 4 of `docs/superpowers/plans/2026-04-10-pr-integration-tests.md`:

1. Open a throwaway PR with a no-op change (whitespace edit in a service README).
2. Observe `detect-affected → [security-scan, build-and-test] → sandbox-deploy → sandbox-integration-test` runs green.
3. Locally introduce a failing assertion in one affected service's integration test, push, observe `sandbox-integration-test` hard-fails and PR is merge-blocked.
4. Revert, push, observe concurrency cancels the previous run and the new run passes.
5. Close the PR, observe `pr-cleanup.yml` tears down `sandbox-pr-${PR_NUMBER}`.
6. (Admin action) Mark `sandbox-integration-test` as a required status check on `main` branch protection.

## Why blocked

The 2026-05-08 rehearsal attempt opened PR #1 (closed) and revealed:

- **0 successful workflow runs ever** — `gh run list --status success` returns empty across all 5 workflows
- **No `AWS_ROLE_ARN` secret** — repo + sandbox + staging environments all have empty secret stores
- **OIDC IAM role exists in CDK** (`infrastructure/pipeline/src/github-role.stack.ts`) **but never deployed**
- **Step 6 not possible without GitHub Pro** — branch protection on private repos is a Pro feature; API returns HTTP 403
- **`build-and-test` blocked by charter check false-positives** — `tools/check-no-appsync-literals.mjs` flags 28 legitimate strings (runtime config, comments, test fixtures, the detector itself)
- **`security-scan` reports 88 real `pnpm audit` vulns** (1 critical) — needs policy decision before it can ever go green
- **`pr-audit.yml` missing `pnpm/action-setup`** — separate parking item: `pr-audit-workflow-missing-pnpm-install`
- **`nestfolio-e2e.yml` blocked on same OIDC gap** — separate parking item: `nestfolio-e2e-workflow-no-aws-credentials`

## Cheapest next step

When `ci-pipeline-bring-up` ships (deploys `nestfolio-github-role`, sets `AWS_ROLE_ARN`, fixes charter check, decides security-scan policy), this rehearsal becomes the natural validation: the next legitimate PR on the repo provides steps 1-2 for free. Step 6 stays parked separately pending the GitHub Pro / make-public / CODEOWNERS-only decision in `ci-pipeline-bring-up`.
