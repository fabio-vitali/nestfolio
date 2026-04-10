# PR Pipeline Integration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run `test-integration` against the freshly-deployed `sandbox-pr-${PR_NUMBER}` stack as a required PR check.

**Architecture:** Add an env var fallback + CI misconfiguration guard to `createIntegrationContext`, then add a new `sandbox-integration-test` job to `pr-deploy.yml` that runs after `sandbox-deploy`, exporting `NESTFOLIO_INTEG_PREFIX=sandbox-pr-${PR_NUMBER}` so existing tests transparently target the PR's isolated stack.

**Tech Stack:** Nx monorepo (pnpm), Jest (ts-jest), GitHub Actions, AWS OIDC, TypeScript.

**Spec:** `docs/superpowers/specs/2026-04-10-pr-integration-tests-design.md`

---

## Context for the implementer

You're changing two things:

1. **A one-file library change** in `libs/integration-testing/src/context.ts` — the function `createIntegrationContext` currently hardcodes `prefix` to `'dev'`. You'll add an env var fallback plus a guard that throws in CI if the env var is unset (so a typo can't silently hit the shared `dev` stack).

2. **A new GitHub Actions job** in `.github/workflows/pr-deploy.yml` — a `sandbox-integration-test` job that runs after `sandbox-deploy`, uses the same OIDC role, and runs `pnpm nx ... -t test-integration` with the `NESTFOLIO_INTEG_PREFIX` env var set to the PR's sandbox prefix.

**Things that must stay invariant** (these are not bugs to "fix"):
- Local runs without `NESTFOLIO_INTEG_PREFIX` must still default to `'dev'`. Do not change local dev ergonomics.
- Existing integration test files must not need edits. They call `createIntegrationContext()` with no arguments and the env var fallback happens transparently.
- `pr-cleanup.yml` must not change. It already tears down the sandbox on PR close regardless of test outcome.
- Jest `maxWorkers: 1` per-service config stays untouched. Cross-service parallelism comes from Nx `--parallel=4`, which is the existing local convention.

**How to run lib tests:**
```
pnpm nx test integration-testing
```

**How to verify the YAML locally (best-effort):**
```
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/pr-deploy.yml')); print('yaml ok')"
```
(No actionlint requirement — full validation happens when the PR runs the workflow.)

---

## File Structure

**Modify:**
- `libs/integration-testing/src/context.ts` — add env var fallback + CI guard (~4 line edit in `createIntegrationContext`)
- `.github/workflows/pr-deploy.yml` — append new `sandbox-integration-test` job after the existing `sandbox-deploy` job

**Create:**
- `libs/integration-testing/test/context.test.ts` — new unit test file. The `test/` directory already exists with `event-bridge-client.test.ts` and `resilience.test.ts`; follow the same style.

**Do not touch:**
- `.github/workflows/pr-cleanup.yml`
- `.github/workflows/pr-audit.yml`
- `.github/workflows/deploy.yml`
- Any existing integration test file
- Any jest config

---

## Task 1: Add `NESTFOLIO_INTEG_PREFIX` env var fallback to `createIntegrationContext`

**Files:**
- Create: `libs/integration-testing/test/context.test.ts`
- Modify: `libs/integration-testing/src/context.ts:38-63`

### Step 1: Write the failing test

Create `libs/integration-testing/test/context.test.ts` with this exact content:

```typescript
import { createIntegrationContext } from '../src/context';

describe('createIntegrationContext', () => {
  const originalEnv = { ...process.env };

  afterEach(async () => {
    process.env = { ...originalEnv };
  });

  describe('prefix resolution', () => {
    it('defaults to "dev" when no option and no env var', async () => {
      delete process.env.NESTFOLIO_INTEG_PREFIX;
      delete process.env.CI;

      const ctx = await createIntegrationContext();

      expect(ctx.prefix).toBe('dev');
      await ctx.cleanup.runAll();
    });

    it('prefers options.prefix over env var and default', async () => {
      process.env.NESTFOLIO_INTEG_PREFIX = 'sandbox-pr-99';
      delete process.env.CI;

      const ctx = await createIntegrationContext({ prefix: 'explicit' });

      expect(ctx.prefix).toBe('explicit');
      await ctx.cleanup.runAll();
    });

    it('uses NESTFOLIO_INTEG_PREFIX when option omitted', async () => {
      process.env.NESTFOLIO_INTEG_PREFIX = 'sandbox-pr-42';
      delete process.env.CI;

      const ctx = await createIntegrationContext();

      expect(ctx.prefix).toBe('sandbox-pr-42');
      await ctx.cleanup.runAll();
    });
  });
});
```

- [ ] **Step 1 complete:** file created with the three test cases above.

### Step 2: Run the test to verify it fails

Run:

```bash
pnpm nx test integration-testing -- --testPathPattern=context.test
```

Expected:
- First test **passes** (the current `'dev'` default already handles this case — it's included as a regression guard).
- Second test **passes** (explicit option already beats env var — also a regression guard).
- Third test **fails** with `Expected: "sandbox-pr-42", Received: "dev"`. This is the key failing assertion that drives the implementation.

If the third test passes, something is wrong — the env var fallback is already implemented and you should stop and investigate.

- [ ] **Step 2 complete:** confirmed the third test fails as described.

### Step 3: Implement the env var fallback

Open `libs/integration-testing/src/context.ts`. Find this line (currently line 43):

```typescript
  const prefix = options?.prefix ?? 'dev';
```

Replace it with:

```typescript
  const prefix = options?.prefix ?? process.env.NESTFOLIO_INTEG_PREFIX ?? 'dev';
```

No other changes to the file in this step. Do not touch imports, the interface, or other lines.

- [ ] **Step 3 complete:** one-line edit applied.

### Step 4: Run the test to verify it passes

Run:

```bash
pnpm nx test integration-testing -- --testPathPattern=context.test
```

Expected: all three tests **pass**.

If any test fails:
- Check that you edited the correct line (should be inside `createIntegrationContext`, not at module top level).
- Check that you preserved the `'dev'` fallback at the end of the chain.
- Do not move on until all three pass.

- [ ] **Step 4 complete:** all three tests pass.

### Step 5: Commit

```bash
git add libs/integration-testing/src/context.ts libs/integration-testing/test/context.test.ts
git commit -m "$(cat <<'EOF'
feat(integration-testing): add NESTFOLIO_INTEG_PREFIX env var fallback

createIntegrationContext now resolves prefix from options.prefix, then
process.env.NESTFOLIO_INTEG_PREFIX, then the 'dev' default. Enables CI
to target PR-specific sandbox stacks without editing test files.
EOF
)"
```

- [ ] **Step 5 complete:** commit landed.

---

## Task 2: Add CI misconfiguration guard

**Files:**
- Modify: `libs/integration-testing/test/context.test.ts` (append new describe block)
- Modify: `libs/integration-testing/src/context.ts:38-63`

### Step 1: Write the failing test

Open `libs/integration-testing/test/context.test.ts`. Inside the top-level `describe('createIntegrationContext', ...)` block, **after** the `describe('prefix resolution', ...)` block, add this new describe block:

```typescript
  describe('CI misconfiguration guard', () => {
    it('throws when CI=true and no prefix option and no env var', async () => {
      process.env.CI = 'true';
      delete process.env.NESTFOLIO_INTEG_PREFIX;

      await expect(createIntegrationContext()).rejects.toThrow(
        /NESTFOLIO_INTEG_PREFIX/,
      );
    });

    it('does not throw when CI=true and env var is set', async () => {
      process.env.CI = 'true';
      process.env.NESTFOLIO_INTEG_PREFIX = 'sandbox-pr-1';

      const ctx = await createIntegrationContext();

      expect(ctx.prefix).toBe('sandbox-pr-1');
      await ctx.cleanup.runAll();
    });

    it('does not throw when CI=true and explicit prefix option is provided', async () => {
      process.env.CI = 'true';
      delete process.env.NESTFOLIO_INTEG_PREFIX;

      const ctx = await createIntegrationContext({ prefix: 'explicit' });

      expect(ctx.prefix).toBe('explicit');
      await ctx.cleanup.runAll();
    });

    it('does not throw when CI is unset even if no prefix provided', async () => {
      delete process.env.CI;
      delete process.env.NESTFOLIO_INTEG_PREFIX;

      const ctx = await createIntegrationContext();

      expect(ctx.prefix).toBe('dev');
      await ctx.cleanup.runAll();
    });
  });
```

- [ ] **Step 1 complete:** new describe block appended inside the top-level describe.

### Step 2: Run the test to verify it fails

Run:

```bash
pnpm nx test integration-testing -- --testPathPattern=context.test
```

Expected:
- The three "prefix resolution" tests still pass.
- The first "CI misconfiguration guard" test **fails** because `createIntegrationContext` currently never throws — it falls through to `'dev'`.
- The other three CI guard tests pass (they're regression guards to make sure the new guard doesn't false-fire).

If the first CI guard test passes, the guard is already implemented and you should stop and investigate.

- [ ] **Step 2 complete:** confirmed the first CI guard test fails.

### Step 3: Implement the CI guard

Open `libs/integration-testing/src/context.ts`. Find this block (currently lines 38–63):

```typescript
export async function createIntegrationContext(options?: {
  prefix?: string;
  region?: string;
  timings?: Partial<TimingConfig>;
}): Promise<IntegrationContext> {
  const prefix = options?.prefix ?? process.env.NESTFOLIO_INTEG_PREFIX ?? 'dev';
  const region = options?.region ?? 'us-east-1';
```

Insert the CI guard immediately after the opening brace and before the `const prefix` line, so the block becomes:

```typescript
export async function createIntegrationContext(options?: {
  prefix?: string;
  region?: string;
  timings?: Partial<TimingConfig>;
}): Promise<IntegrationContext> {
  if (
    process.env.CI === 'true' &&
    !options?.prefix &&
    !process.env.NESTFOLIO_INTEG_PREFIX
  ) {
    throw new Error(
      'createIntegrationContext: running in CI (CI=true) but NESTFOLIO_INTEG_PREFIX is unset. ' +
        'Refusing to fall back to the shared "dev" prefix. ' +
        'Set NESTFOLIO_INTEG_PREFIX in the CI job env (e.g. sandbox-pr-${PR_NUMBER}) or pass options.prefix explicitly.',
    );
  }
  const prefix = options?.prefix ?? process.env.NESTFOLIO_INTEG_PREFIX ?? 'dev';
  const region = options?.region ?? 'us-east-1';
```

Do not change anything else in the file.

- [ ] **Step 3 complete:** guard inserted.

### Step 4: Run the test to verify it passes

Run:

```bash
pnpm nx test integration-testing -- --testPathPattern=context.test
```

Expected: all seven tests (three prefix resolution + four CI guard) **pass**.

If any test fails:
- Check the guard comes BEFORE the `const prefix` resolution.
- Check the guard condition is `CI === 'true'` (string comparison, not truthy check).
- Check the error message contains the literal substring `NESTFOLIO_INTEG_PREFIX` (the test matches on that regex).

- [ ] **Step 4 complete:** all seven tests pass.

### Step 5: Commit

```bash
git add libs/integration-testing/src/context.ts libs/integration-testing/test/context.test.ts
git commit -m "$(cat <<'EOF'
feat(integration-testing): guard against CI misconfiguration

createIntegrationContext throws when CI=true and NESTFOLIO_INTEG_PREFIX
is unset, preventing a CI typo from silently falling back to the shared
'dev' sandbox. Local runs are unaffected.
EOF
)"
```

- [ ] **Step 5 complete:** commit landed.

---

## Task 3: Add `sandbox-integration-test` job to `pr-deploy.yml`

**Files:**
- Modify: `.github/workflows/pr-deploy.yml` — append a new job after the existing `sandbox-deploy` job (after current line 99).

No TDD for this task — GitHub Actions workflows have no local unit test harness. Verification is YAML parse + manual trace, with the real end-to-end verification happening when the PR opens.

### Step 1: Append the new job to `pr-deploy.yml`

Open `.github/workflows/pr-deploy.yml`. After the last line of the `sandbox-deploy` job (the `fi` closing the inline shell block), add two blank lines and then the following job:

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

**Critical details:**
- Indentation: each job is indented 2 spaces from `jobs:`, and each field inside the job is indented 4 spaces total. Match the existing `sandbox-deploy` job's indentation exactly.
- `needs: [detect-affected, sandbox-deploy]` — the new job runs after both `detect-affected` (to read its outputs) and `sandbox-deploy` (to ensure the stack exists).
- `environment: sandbox` — reuses the existing GitHub Environment so `AWS_ROLE_ARN` is scoped correctly (same as `sandbox-deploy`).
- `fetch-depth: 0` — required for `nx affected --base=origin/main` to see git history.
- The `env:` block sets `NESTFOLIO_INTEG_PREFIX` at the job level so every step inherits it, including the `Run integration tests` step that shells out to `pnpm nx`.

- [ ] **Step 1 complete:** new job appended.

### Step 2: Verify the YAML parses

Run:

```bash
python3 -c "import yaml, sys; d = yaml.safe_load(open('.github/workflows/pr-deploy.yml')); print('yaml ok, jobs:', list(d['jobs'].keys()))"
```

Expected output:

```
yaml ok, jobs: ['detect-affected', 'security-scan', 'build-and-test', 'sandbox-deploy', 'sandbox-integration-test']
```

If the YAML doesn't parse or the new job name isn't in the list:
- Check indentation — every line inside the job must have at least 4 spaces of indent.
- Check you didn't accidentally delete or duplicate the final `fi` from `sandbox-deploy`.
- Do not proceed until the parse succeeds and the job appears in the list.

- [ ] **Step 2 complete:** YAML parses and the new job is present.

### Step 3: Manually trace the job dependencies

Open the file and verify by eye:

1. `detect-affected` has no `needs`.
2. `security-scan` and `build-and-test` both `needs: detect-affected`.
3. `sandbox-deploy` `needs: [detect-affected, build-and-test, security-scan]`.
4. `sandbox-integration-test` (new) `needs: [detect-affected, sandbox-deploy]`.

The topology should be:

```
detect-affected → [security-scan, build-and-test] → sandbox-deploy → sandbox-integration-test
```

- [ ] **Step 3 complete:** dependency graph is correct.

### Step 4: Commit

```bash
git add .github/workflows/pr-deploy.yml
git commit -m "$(cat <<'EOF'
ci(pr-deploy): run integration tests against PR sandbox

New sandbox-integration-test job runs pnpm nx ...-t test-integration
after sandbox-deploy, exporting NESTFOLIO_INTEG_PREFIX=sandbox-pr-N so
existing tests target the PR's isolated stack. Scope mirrors deploy:
run-many on full deploy (PR opened/reopened), affected on synchronize.
Hard fails on test failure; pr-cleanup still fires on PR close.
EOF
)"
```

- [ ] **Step 4 complete:** commit landed.

---

## Task 4: End-to-end verification

**Files:** none (verification task — all code changes are complete).

This task confirms the spec's verification plan. It is post-merge work; the implementer runs these steps on a throwaway PR to prove the pipeline works end-to-end.

- [ ] **Step 1:** Open a throwaway PR with a no-op change (e.g., a whitespace edit in a service's README). Push.

- [ ] **Step 2:** Observe `pr-deploy.yml` runs `detect-affected` → `security-scan` + `build-and-test` → `sandbox-deploy` → `sandbox-integration-test`. The new job should appear in the PR's Checks tab.

- [ ] **Step 3:** Confirm `sandbox-integration-test` passes. If it fails, inspect the logs — the `Run integration tests` step will show which service's tests failed.

- [ ] **Step 4:** Locally introduce a failing integration test in one affected service (e.g., temporarily add `expect(true).toBe(false)` at the top of an existing test's `it()` block). Push.

- [ ] **Step 5:** Observe `sandbox-integration-test` hard-fails. Confirm the PR is blocked from merge. Confirm the sandbox at `sandbox-pr-${PR_NUMBER}` is still reachable in AWS console.

- [ ] **Step 6:** Revert the failing test, push. Observe the previous run gets cancelled by `concurrency: pr-${{ ... }}` and the new run passes.

- [ ] **Step 7:** Close the PR. Observe `pr-cleanup.yml` tears down the `sandbox-pr-${PR_NUMBER}` stack.

- [ ] **Step 8:** (Out of band, admin action) Update branch protection on `main` to mark `sandbox-integration-test` as a required status check.

---

## Rollback plan

If the new job misbehaves in a way that blocks legitimate PRs:

1. Revert the commit from Task 3 (the CI job addition). This restores the previous pipeline topology; sandbox still deploys, integration tests just don't run in CI.
2. The lib changes from Tasks 1–2 are safe to keep — they're backward-compatible and unused outside CI.
3. Investigate and re-apply Task 3 with the fix.

---

## Summary of commits

1. `feat(integration-testing): add NESTFOLIO_INTEG_PREFIX env var fallback`
2. `feat(integration-testing): guard against CI misconfiguration`
3. `ci(pr-deploy): run integration tests against PR sandbox`

Three small commits, all landing on the same PR. The PR that adds the job will itself be tested by the job — perfect dogfooding.
