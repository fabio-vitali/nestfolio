# PR Pipeline Integration Tests — Design

**Date:** 2026-04-10
**Status:** Approved, pending implementation plan
**Scope:** `.github/workflows/pr-deploy.yml` + `libs/integration-testing/src/context.ts`

## Problem

The PR pipeline (`pr-deploy.yml`) deploys every PR to an isolated sandbox prefix (`sandbox-pr-${PR_NUMBER}`) but never runs integration tests against it. `build-and-test` runs only `pnpm nx affected -t lint` and `pnpm nx affected -t test` (unit tests). Zero occurrences of `integration` or `test-integration` across any workflow file.

Net effect: the `test-integration` Nx target — which exists on all 28 services and is the project's canonical integration test convention — is only run manually by developers on their machines against the shared `dev` prefix. PRs can merge with broken cross-service flows that unit tests don't catch.

## Goal

Run integration tests against the freshly-deployed `sandbox-pr-${PR_NUMBER}` stack as a required check on every PR, blocking merge on failure.

## Non-goals

- Running integration tests on the main-merge pipeline (`deploy.yml` → staging/prod). Out of scope. Can be mirrored later.
- Changing the shared `dev` stack usage for local developer runs. The default remains `dev`.
- Adding integration tests to services that don't have them. That's the separate `audit-service` → `audit-integration-test` wiring spec.
- Test observability beyond GitHub Actions log stream (no JUnit artifacts, no PR comments, no log tailing). Add later only if logs prove insufficient.

## Prerequisite: prefix resolution in the integration-testing lib

`libs/integration-testing/src/context.ts:43` currently hardcodes the default prefix:

```ts
const prefix = options?.prefix ?? 'dev';
```

Every existing integration test calls `createIntegrationContext()` with no arguments, so all tests currently target the `dev` prefix. Without a fix, the new CI job would bypass the freshly-deployed sandbox and hit `dev` — worse than not running at all.

**Fix:** add an env var fallback that preserves local behavior:

```ts
const prefix = options?.prefix ?? process.env.NESTFOLIO_INTEG_PREFIX ?? 'dev';
```

**Plus a CI misconfiguration guard:** if `process.env.CI === 'true'` and `NESTFOLIO_INTEG_PREFIX` is unset, throw with a clear message. This makes a CI env var typo loud instead of silently falling back to `dev` and hitting the shared stack.

**Properties:**

- Backward-compatible: local runs with no env var still default to `dev`.
- Zero edits to existing test files — every test picks up the env var transparently.
- CI-only guard: local runs without `CI=true` keep the old ergonomics.
- New unit test at `libs/integration-testing/test/context.test.ts` covering both the env var path and the CI guard. The `test/` directory already exists with `event-bridge-client.test.ts` and `resilience.test.ts`; new file follows the same convention.

## CI job — `sandbox-integration-test`

New job in `.github/workflows/pr-deploy.yml`, inserted after `sandbox-deploy`:

```
detect-affected → [security-scan, build-and-test] → sandbox-deploy → sandbox-integration-test
```

### Job definition

```yaml
sandbox-integration-test:
  needs: [detect-affected, sandbox-deploy]
  if: needs.detect-affected.outputs.is_full_deploy == 'true' || needs.detect-affected.outputs.affected != ''
  runs-on: ubuntu-latest
  environment: sandbox
  timeout-minutes: 30
  permissions:
    id-token: write
    contents: read
  env:
    NESTFOLIO_INTEG_PREFIX: sandbox-pr-${{ github.event.pull_request.number }}
  steps:
    - uses: actions/checkout@v4
      with: { fetch-depth: 0 }
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 24, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - uses: aws-actions/configure-aws-credentials@v4
      with:
        role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
        aws-region: us-east-1
    - name: Run integration tests
      run: |
        IS_FULL="${{ needs.detect-affected.outputs.is_full_deploy }}"
        if [ "$IS_FULL" = "true" ]; then
          pnpm nx run-many -t test-integration --parallel=4
        else
          pnpm nx affected -t test-integration --base=origin/main --parallel=4
        fi
```

### Rationale for each choice

| Choice | Rationale |
|---|---|
| Single `ubuntu-latest` runner (not matrix) | Mirrors local convention exactly (memory: `pnpm nx run-many -t test-integration --parallel=4`). One OIDC exchange, one log stream. Nx handles cross-service parallelism internally. |
| `--parallel=4` | Matches local working configuration. `maxWorkers: 1` per-service jest config stays untouched; cross-service parallelism comes from Nx. |
| `fetch-depth: 0` | Required for `nx affected --base=origin/main` to see commit history. Matches `detect-affected` and `build-and-test`. |
| `timeout-minutes: 30` | Generous ceiling for full-deploy worst case with AWS API latency headroom. Tune down later based on observed runs. |
| `environment: sandbox` | Reuses the same GitHub Environment as `sandbox-deploy`, keeping `AWS_ROLE_ARN` secret scope consistent. |
| Same `if` gate as `sandbox-deploy` | Skip entirely when the PR touches nothing deployable, keeping `detect-affected` as the single source of truth. |
| Mirror deploy scope: `run-many` on `is_full_deploy`, `affected` otherwise | On PR `opened`/`reopened`, the whole sandbox is freshly deployed — validate everything. On `synchronize`, only affected services are redeployed — run affected tests. Matches the mental model "tests cover what was deployed". Nx dep graph catches cross-service test transitivity automatically. |
| Hard fail, no retry | Tests are considered stable (memory: all 28 services pass reliably). If flakes resurface, fix root cause per project convention (`feedback_no_deprecation`-style — no escape hatches). |
| No `continue-on-error` | Hard gate. Required check in branch protection (configured out of band). |
| No explicit `test-integration` target existence check | `nx affected` silently skips projects without the target — correct behavior for services that don't have integration tests. Gap detection lives in the `audit-integration-test` skill, not CI. |
| No explicit `$AFFECTED` passed to `nx affected` | `nx affected -t test-integration` recomputes from `--base=origin/main`. Only the `if` gate uses the string. Contrast with `sandbox-deploy`, which passes `--services=$AFFECTED` because the deploy script needs the explicit list. |

## Failure interaction with `pr-cleanup.yml`

`pr-cleanup.yml` triggers on `pull_request: closed`, not on workflow failure. Therefore:

| Scenario | Result |
|---|---|
| Test failure | Job red, PR blocked from merge, sandbox **stays alive** at `sandbox-pr-${PR_NUMBER}` for dev debugging. |
| Dev pushes a fix | `concurrency: pr-${{ ... }}` (existing) cancels in-flight run; new run deploys incrementally onto the same prefix and re-runs tests. |
| PR closed or merged | `pr-cleanup.yml` (unchanged) tears down the stack regardless of last test outcome. |

No changes to `pr-cleanup.yml` required. The existing cleanup policy already handles failing-test PRs as a subset of "PR still open" — the sandbox costs accrue until the PR closes, which is the project's existing implicit policy.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| `NESTFOLIO_INTEG_PREFIX` typo silently falls back to `dev` and hits the shared dev stack | CI guard in `createIntegrationContext`: throw if `CI=true` and env var unset. Throws loud instead of polluting `dev`. |
| New service added without `test-integration` target | Out of scope for CI. Handled by the separate `audit-service` → `audit-integration-test` wiring spec. |
| Stale sandbox accrues AWS cost while PR sits with failing tests | Existing `pr-cleanup` on PR close. PRs that never close are an existing project-level problem, not a CI-layer concern. |
| Sandbox not fully warm when tests start (Lambda cold start, EB rule propagation) | Existing tests already tolerate this via polling timeouts (memory: `waitForEvent` bumped 90s→120s in commit `93df128`). Not a CI layer concern. |
| Nx `test-integration` target name drift | `test-integration` (hyphen) is the project convention across all 28 services. A rename would surface as `nx affected` running zero targets — which the implementer would catch on verification step 3 (throwaway PR). No CI-layer guard needed. |

## No changes required to

- `pr-cleanup.yml` — already decoupled, fires on PR `closed` regardless of test outcome.
- `pr-audit.yml` — Claude-driven audit is orthogonal to integration tests.
- `deploy.yml` — main-merge pipeline is out of scope.
- Any existing integration test file — the env var fallback is transparent.
- Jest configs — `maxWorkers: 1` per-service stays untouched.

## Verification plan

Implementer "done" means:

1. `libs/integration-testing/src/context.ts` change compiles and existing unit tests pass.
2. New unit test covers both the `NESTFOLIO_INTEG_PREFIX` env var path and the `CI=true` guard throw path.
3. Open a throwaway PR with a no-op change; observe `sandbox-integration-test` job runs after `sandbox-deploy` and passes.
4. Push a commit that intentionally breaks an integration test; observe the job hard-fails, the PR is blocked from merge, and the sandbox at `sandbox-pr-${PR_NUMBER}` is still queryable from AWS console.
5. Push a fix; observe `concurrency` cancels the previous run and the new run deploys incrementally onto the same prefix before re-running tests.
6. Close the PR; observe `pr-cleanup.yml` tears down the `sandbox-pr-${PR_NUMBER}` stack.
7. Confirm the job name `sandbox-integration-test` is stable so branch protection can mark it as a required status check (configuration of branch protection itself is out of scope).

## Out of scope / deferred

- Main-merge pipeline (`deploy.yml`) integration tests.
- JUnit XML artifact upload on failure.
- PR-comment failure summaries.
- CloudWatch log tailing on failure.
- Label-gated full-suite runs (`run-integration-tests-full`).
- Job retry on failure.
- Matrix runner topology.

These are all explicitly rejected in favor of the simplest viable implementation. Revisit only if observed CI behavior proves the minimal version insufficient.
