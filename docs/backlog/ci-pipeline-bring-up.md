---
id: ci-pipeline-bring-up
status: parking
epic: ci-pipeline
epic_role: core
type: infra
notes: "Bring all 5 GitHub workflows green for the first time — OIDC role deploy, secrets, charter check, security policy, no-Pro gating model."
references:
  - .github/workflows/deploy.yml
  - .github/workflows/pr-deploy.yml
  - .github/workflows/pr-cleanup.yml
  - .github/workflows/pr-audit.yml
  - .github/workflows/nestfolio-e2e.yml
  - infrastructure/pipeline/src/github-role.stack.ts
  - infrastructure/pipeline/src/github-role.app.ts
  - tools/check-no-appsync-literals.mjs
out_of_scope: []
spec: null
plan: null
topic_memory:
  - project_ci_pipeline.md
validation_gate: null
---

# CI pipeline bring-up

Filed 2026-05-08 after a systematic audit of all five GitHub Actions workflows triggered by attempting the `pr-pipeline-required-status-check` rehearsal on PR #1. The rehearsal premise — "the pipeline works, just prove it" — turned out to be wrong: **zero successful workflow runs have ever happened on this repo**, going back to the first commit on 2026-03-07. CI has been theatre.

User direction (2026-05-08): target end-state is comprehensive PR-time + post-merge automation (option C of the brainstorm), but **park for now** and continue the direct-deploy-to-dev development loop. Promote when CI gates become genuinely needed (multi-developer, public release, or staging/prod separation).

## Findings — per workflow

### `deploy.yml` (push to main → staging → production)

Stages: `staging.{checkout, pnpm setup, node 24, install, validate-pipeline-configs.sh, nx-set-shas, detect-affected, lint+test, [OIDC commented], [deploy commented]}` → `production.{checkout, pnpm, install, [OIDC commented], [deploy commented]}`.

Failure mode: `Resource not accessible by integration` — protected `staging` environment binding rejects without configured reviewers / no auth wired. Deploy commands explicitly commented out (`infrastructure/scripts/deploy.sh staging --services=…` is the live target when ready). Workflow currently echoes only.

To bring online: deploy OIDC role → set `AWS_ROLE_ARN` secret → uncomment OIDC + deploy steps → decide on environment protection rules (manual approval for `staging` / `production`?).

### `pr-deploy.yml` (PR open/sync → sandbox-pr-N)

Topology: `detect-affected → [security-scan, build-and-test] → sandbox-deploy → sandbox-integration-test`.

- `security-scan` — `pnpm audit` (88 vulns: 3 low / 53 moderate / 31 high / 1 critical) + `trivy fs --security-checks secret`. **Real failure** — needs policy decision (gate, warn-only, allowlist).
- `build-and-test` — `validate-pipeline-configs.sh` + `nx affected -t lint` + `nx affected -t test`. Blocked by `nestfolio-host:check-charter-invariants` → `check-no-appsync-literals` flagging 28 false-positives in:
  - `apps/nestfolio-host/public/assets/config.json` (runtime config — file LITERALLY exists to carry the URL)
  - `apps/nestfolio-host/src/app/app.config.ts:16-17` + `libs/shell/src/graphql/mfe-domain.token.ts:11,13` (comments explaining the `appsync-api`→`appsync-realtime-api` transform)
  - 6 test files with stub URLs (`*.spec.ts` / `*.test.ts`)
  - `libs/shell/src/graphql/wss-debug-probe.ts:23` (the regex that DETECTS the literal)
- `sandbox-deploy` — needs OIDC `AWS_ROLE_ARN` (empty)
- `sandbox-integration-test` — needs OIDC, runs `pnpm nx run-many -t test-integration` with `NESTFOLIO_INTEG_PREFIX=sandbox-pr-${PR_NUMBER}`

To bring online: fix charter check (refine `tools/check-no-appsync-literals.mjs` to allowlist comments / runtime config / test fixtures / detector OR rebuild as proper AST scan) + decide security-scan policy + deploy OIDC role + set `AWS_ROLE_ARN`.

### `pr-cleanup.yml` (PR close)

Single job: validate PR # → install pnpm → OIDC → `infrastructure/scripts/teardown.sh sandbox-pr-${PR_NUMBER}`.

Failure mode (verified on PR #1 close 2026-05-08): `Credentials could not be loaded`. Same OIDC gap as the deploy jobs.

**Operational consequence:** any closed PR that successfully reached `sandbox-deploy` will leave a stuck `sandbox-pr-${N}` stack in AWS. Mitigation today: stuck stacks must be torn down manually with `bash infrastructure/scripts/teardown.sh sandbox-pr-${N}` after refreshing Leapp creds. PR #1 specifically is fine — its `sandbox-deploy` was skipped because `build-and-test` failed first, so no stack was ever created.

### `pr-audit.yml` (PR open)

Missing `pnpm/action-setup` step. `actions/setup-node@v4` runs but `pnpm install` immediately fails with `pnpm: command not found`. Filed as separate parking item: `pr-audit-workflow-missing-pnpm-install`. One-line fix.

### `nestfolio-e2e.yml` (PR + nightly cron + manual)

Stages: checkout → pnpm setup → node 24 → install → OIDC → `pnpm nx run nestfolio-host:config --prefix=dev` → `playwright install --with-deps chromium` → `pnpm nx run nestfolio-e2e:e2e` → upload artifacts on failure.

Failure mode: `Credentials could not be loaded`. Same OIDC gap. Filed as separate parking item: `nestfolio-e2e-workflow-no-aws-credentials`.

Note: nightly cron has been silently failing every morning since 2026-04-29 (`b344c32d`). 9 consecutive nightly fails before today's audit.

## The keystone: OIDC role + secret

`infrastructure/pipeline/src/github-role.stack.ts` already defines:

- `OpenIdConnectProvider` for `https://token.actions.githubusercontent.com`
- IAM `Role` named `nestfolio-github-actions-role`
- Trust policy: `StringLike` on `repo:${repo}:*` (accepts any ref on the configured repo)
- Managed policy: `AdministratorAccess` ⚠️ **overscoped — to revisit**

`infrastructure/pipeline/src/github-role.app.ts` requires `-c repo=fabio-vitali/nestfolio` context. Deploys via standard `cdk deploy`.

This stack has never been deployed. Once deployed, `CfnOutput RoleArn` provides the value to set as `AWS_ROLE_ARN` (recommended at the `sandbox` environment level, not repo-wide, so `staging` / `production` can have separate roles later).

## No-Pro gating decision (deferred)

This is a private repo on a personal GitHub account. Branch protection rules require GitHub Pro (HTTP 403 from `branches/main/protection` API). Step 6 of the original rehearsal (mark `sandbox-integration-test` as a required status check) is structurally impossible without one of:

1. **Make repo public** — free Pro features, but exposes code
2. **Pay for GitHub Pro** ($4/mo individual) — keeps repo private
3. **Environment protection rules** — work on private repos free; can require manual approval for deploys, gate on specific branches, but cannot enforce CI green for merge
4. **CODEOWNERS** — works on private repos free; enforces review requirements but not status check requirements
5. **Self-discipline** — rely on visible PR check status + sole-dev awareness; no automated enforcement

User context: sole developer, dev account is disposable, repo is currently private. Likely answer is (3) + (5) for most of dev life, escalate when team grows.

## Bring-up scope (when promoted)

Sequenced minimum:

1. Deploy `nestfolio-github-role` stack to AWS account 771924376645 → capture role ARN
2. Set `AWS_ROLE_ARN` secret on `sandbox` environment (and later `staging` / `production`)
3. Refine OIDC trust policy: scope `sub` from `repo:${repo}:*` to specific refs (e.g. `repo:${repo}:ref:refs/heads/main`, `repo:${repo}:pull_request`) and tighten managed policy from `AdministratorAccess` to a pruned set
4. Fix `tools/check-no-appsync-literals.mjs` — categorical allowlists (runtime config / comments / test fixtures / detector) or AST-aware scan
5. Decide security-scan policy and adjust `pr-deploy.yml` — gate on critical+high only? Allowlist transitive deps? Schedule weekly remediation pass?
6. Add `pnpm/action-setup@v4` step to `pr-audit.yml` (1-line fix)
7. Uncomment OIDC + deploy steps in `deploy.yml`; configure `staging` / `production` environment protection rules (manual approval gate?)
8. Smoke: trigger `nestfolio-e2e.yml` via `workflow_dispatch` → confirm green
9. Smoke: open a throwaway PR → confirm `pr-deploy.yml` reaches `sandbox-integration-test` green (this finally exercises the original `pr-pipeline-required-status-check` rehearsal Steps 1-5)
10. Close decision on no-Pro gating model; if going public or paying for Pro, do Step 6 of the original rehearsal

Estimated 1-2 days focused work, predominantly AWS + GitHub configuration.

## Related parking items

- `pr-pipeline-required-status-check` — the original rehearsal, BLOCKED on this
- `pr-audit-workflow-missing-pnpm-install` — sub-finding, 1-line fix, can be done independently
- `nestfolio-e2e-workflow-no-aws-credentials` — sub-finding, blocked on the same OIDC keystone as everything else

## Promote when

- A second developer joins (CI gates become essential for collaboration)
- A real staging environment is set up that needs auto-deploy
- A regression slips through that nightly e2e would have caught
- An external code review or security audit forces the security-scan question
