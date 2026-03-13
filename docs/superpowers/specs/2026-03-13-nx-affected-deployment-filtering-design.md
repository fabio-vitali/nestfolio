# NX Affected Deployment Filtering

## Problem

All deployment paths (manual, PR, staging, production) currently deploy all 16 services regardless of what changed. This wastes time and compute, especially for incremental changes that only affect 1-2 services.

## Goal

Each deployment trigger should deploy only the services affected by the change, using NX's project graph to determine the minimum set. Full deploys remain available for first-time environments and manual use.

## Deployment Triggers

| Trigger | Affected strategy | Mechanism |
|---------|------------------|-----------|
| Manual (`deploy-all.sh dev`) | Deploy all (default) | No `--services` flag |
| PR created (`opened`/`reopened`) | Deploy all in sandbox env | `deploy-all.sh sandbox-pr-42` (no filter) |
| PR updated (`synchronize`) | NX affected only | `nx show projects --affected` → `--services=...` |
| Staging (push to main) | NX affected only | `nrwl/nx-set-shas` → `nx show projects --affected --base=$NX_BASE` → `--services=...` |
| Production (after staging) | Same set as staging | Staging job outputs its service list; production job consumes it |

## Architecture

### deploy-all.sh enhancement

Add `--services=svc1,svc2,...` optional flag:

- **When provided:** filter the pipeline.json discovery to only include listed services. Phase ordering still applies within the filtered set. Hub re-deploy (phase 4) only runs if any phase-1 hub is in the filtered set.
- **When omitted:** deploy all services (current behavior, unchanged).
- **Empty list edge case:** if `--services=` is passed with an empty value, skip deployment entirely and exit 0 with a "No affected services" message.

The script has no NX dependency — callers compute the affected list and pass it in.

### destroy-all.sh

No changes. Teardown is always full (you can't partially destroy an environment safely without tracking deployed state).

### PR workflow (pr-deploy.yml)

Split behavior based on `github.event.action`:

**On `opened` or `reopened`:**
- Full deploy: `bash deploy-all.sh "$PREFIX_SANDBOX"`

**On `synchronize` (subsequent pushes):**
- Compute affected: `pnpm nx show projects --affected --base=${{ github.event.before }} --type=app`
- Filter to deployable services (intersection with pipeline.json service names)
- Pass to deploy: `bash deploy-all.sh "$PREFIX_SANDBOX" --services=$AFFECTED`

The `github.event.before` SHA is the correct base for PR updates — it's the commit before the push that triggered the event.

### Staging + Production workflow (deploy.yml, hand-written)

Replaces the CDK-generated deploy.yml.

**Trigger:** `push` to `main`

**Job 1: staging**
1. Use `nrwl/nx-set-shas` to determine `$NX_BASE` (last successful staging deploy commit)
2. Compute affected: `pnpm nx show projects --affected --base=$NX_BASE --type=app`
3. Filter to deployable services
4. If no affected services, skip deploy (exit 0)
5. Deploy: `bash deploy-all.sh staging --services=$AFFECTED`
6. Output the affected service list for the production job

**Job 2: production**
1. `needs: staging`
2. GitHub Environment protection rule: `production` (requires manual approval)
3. Consume the affected service list from staging
4. Deploy: `bash deploy-all.sh prod --services=$AFFECTED`

Production deploys the exact same set as staging — this ensures staging is always a preview of what production will get.

### NX base SHA strategy

| Context | Base SHA | Source |
|---------|----------|--------|
| PR update | `github.event.before` | GitHub event payload (commit before the push) |
| Staging | `$NX_BASE` from `nrwl/nx-set-shas` | Last successful commit on main |
| Production | Same affected list as staging | Passed via job output |
| PR creation | N/A (full deploy) | — |
| Manual | N/A (full deploy) | — |

### Filtering logic (shared)

A small helper script (`.github/scripts/compute-affected-services.sh`) that:

1. Runs `pnpm nx show projects --affected --base=$1 --type=app`
2. Reads all `pipeline.json` files to get the set of deployable service names
3. Outputs the intersection (comma-separated) — only services that are both NX-affected AND have a `pipeline.json`
4. This filters out MFE apps, the shell app, and other non-deployable projects

## What gets removed

The CDK pipeline infrastructure created in the previous plan is replaced by hand-written workflows:

- `infrastructure/pipeline/src/pipeline.app.ts` — replaced by hand-written deploy.yml
- `infrastructure/pipeline/src/discover-services.ts` — no longer needed (deploy-all.sh reads pipeline.json directly)
- `infrastructure/pipeline/test/discover-services.test.ts` — removed with discover-services
- `infrastructure/pipeline/jest.config.ts` — no tests remain
- `libs/cdk-constructs/src/service-stage.ts` + test + index export — only used by pipeline.app.ts
- `infrastructure/pipeline/README.md` — rewritten to cover new workflow structure

## What stays

- `infrastructure/pipeline/src/github-role.stack.ts` + `github-role.app.ts` — OIDC role bootstrap
- `infrastructure/pipeline/project.json` — stripped to `deploy-role` target only
- `infrastructure/pipeline/tsconfig.json` — still needed for github-role compilation
- `cdk-pipelines-github` package — still needed for `GitHubActionRole` in github-role.stack.ts
- All 16 `pipeline.json` files + `.pipeline-schema.json`
- Observability toggle on `ServiceStack` + hub stacks
- `deploy-all.sh` (enhanced with `--services` flag)
- `destroy-all.sh` (unchanged)

## Testing strategy

- **deploy-all.sh:** bash syntax check + dry-run tests (verify filtering output without actual deploys)
- **compute-affected-services.sh:** unit test with mock NX output
- **Workflow YAML:** manual review (no automated test for GitHub Actions YAML)
- **cdk-constructs:** run full test suite after removing ServiceStage (verify no regressions)

## Edge cases

- **Shared lib change (e.g. platform-core):** NX correctly flags all dependent services → potentially full deploy. This is expected and safe.
- **Only MFE/frontend changes:** `compute-affected-services.sh` returns empty list (no deployable services) → deploy is skipped entirely.
- **pipeline.json added for new service:** first deploy must be full (or the new service must be explicitly included). The `--services` filter only includes services with `pipeline.json`, so new services are automatically picked up.
- **First staging deploy ever:** `nrwl/nx-set-shas` falls back to deploying everything when no previous successful run exists.
