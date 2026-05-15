---
id: nestfolio-e2e-workflow-no-aws-credentials
status: queued
rank: 1
type: bug
notes: "nestfolio-e2e.yml fails at aws-actions/configure-aws-credentials — no OIDC role or PR-event lacks credentials wiring."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# `nestfolio-e2e.yml` workflow fails — no AWS credentials available

Surfaced 2026-05-08 on `chore/pr-pipeline-rehearsal` PR #1 alongside `pr-audit-workflow-missing-pnpm-install`. The Playwright e2e workflow fails fast at the credentials step:

```
e2e  Run aws-actions/configure-aws-credentials@v4
e2e  ##[error]Credentials could not be loaded, please check your action inputs: Could not load credentials from any providers
```

Run: https://github.com/fabio-vitali/nestfolio/actions/runs/25543485677/job/74974311716

Env shows `NESTFOLIO_INTEG_PREFIX=dev` — the workflow is configured to point Playwright at the deployed dev stack. But the OIDC role assumption is either misconfigured (missing `role-to-assume` input) or the GitHub OIDC trust policy on the role doesn't accept this repo / branch / event combination.

Independent of the active rehearsal: `nestfolio-e2e.yml` runs Playwright e2e against a deployed environment; failure here just means the Playwright check is missing. Does NOT affect `pr-deploy.yml` → `sandbox-integration-test`, which is what the active workstream validates.

Promoted to queued 2026-05-15 per `feedback_e2e_gaps_queued_not_parking` — `apps/nestfolio-e2e` cannot be truly green in CI until this is fixed. Cheapest fix path: copy the OIDC `role-to-assume` block from `pr-deploy.yml` (which works) into `nestfolio-e2e.yml`.
