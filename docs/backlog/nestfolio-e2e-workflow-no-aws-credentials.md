---
id: nestfolio-e2e-workflow-no-aws-credentials
status: parking
type: bug
notes: "Moved to LATER 2026-05-15 — investigation revealed scope is full CI bring-up (OIDC IAM role + secret provisioning), not a workflow YAML edit. Deferred to dedicated CI-pipeline workstream once the system is stable."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: ci-pipeline
epic_role: core
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

Promoted to queued 2026-05-15 per `feedback_e2e_gaps_queued_not_parking`, then moved back to LATER same day after investigation revealed this is not about making `apps/nestfolio-e2e` (the suite) green — the suite runs fine locally against deployed dev. This is about CI pipeline bring-up, a separate workstream deferred until the system is stable. Promote once the broader CI bring-up workstream is opened.

## Rescope 2026-05-15 (investigation)

Original "Cheapest fix path: copy the OIDC `role-to-assume` block from `pr-deploy.yml` (which works) into `nestfolio-e2e.yml`" is **FALSE**. Evidence:

- `gh secret list` (repo) → empty. `gh secret list --env sandbox` → empty. `AWS_ROLE_ARN` is **unset** at every scope.
- `pr-deploy.yml` already has the same `role-to-assume: ${{ secrets.AWS_ROLE_ARN }}` block as `nestfolio-e2e.yml`. No copy-paste asymmetry exists.
- No `pr-deploy.yml` run in the last 20 has executed `sandbox-deploy` to non-skipped state — either earlier-step failures or empty-affected short-circuit. So the OIDC step there has NEVER been exercised successfully.
- `deploy.yml` has the `aws-actions/configure-aws-credentials@v4` step **commented out** with note: *"Uncomment when OIDC role is deployed and AWS_ROLE_ARN secret is set"* (`.github/workflows/deploy.yml:48-52`, :74-77). This is the author's prior acknowledgement.
- Failed run `25907039731` rendered-inputs for the credentials step show only defaults (`audience`, `output-env-credentials`) — `role-to-assume` line absent, confirming empty-string secret resolution.

**Actual gap**: the GitHub-OIDC IAM identity provider + IAM role in AWS account 771924376645 has never been provisioned, and no `AWS_ROLE_ARN` secret has ever been set. This blocks **all three** workflows (`pr-deploy.yml`, `nestfolio-e2e.yml`, `deploy.yml`), not just the Playwright one.

**Corrected scope**:

1. Provision GitHub OIDC provider (`token.actions.githubusercontent.com`) in account 771924376645.
2. Provision IAM role with trust policy scoped to `repo:fabio-vitali/nestfolio:*` (or narrower — `environment:sandbox` only).
3. Decide permission scope: AdminAccess for `sandbox-deploy` (full CDK) vs read-only for `nestfolio-e2e` (Playwright assertions only); same role or split.
4. Set `AWS_ROLE_ARN` repo secret (or sandbox environment secret).
5. Uncomment the credential step in `deploy.yml`.
6. Validate end-to-end: push to a branch, verify `sandbox-deploy` and `nestfolio-e2e` both pass the OIDC step.

This is now an infra-provisioning workstream, not a YAML edit. Architecture: IaC choice (CDK app vs `aws iam` CLI vs Terraform) + permission scope are user decisions.
