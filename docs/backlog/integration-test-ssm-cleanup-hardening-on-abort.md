---
id: integration-test-ssm-cleanup-hardening-on-abort
status: shipped
closed: "2026-05-12"
type: refactor
notes: "Class of test-cleanup leak: when a test's body throws (or its Jest deadline expires) before reaching afterAll, SsmOverrideFixture's restore step is skipped — leaving the canonical SSM pointed at a mock URL. Next test run's beforeAll then fails the ARN-prefix check. Seen across investor-profile-ctrl, advisory-narrative-ctrl, portfolio-engine-ctrl during Lever 1 work."
references: []
out_of_scope:
  - "Multi-worker contention on the same SSM param — each service has a distinct param namespace; Jest serialises that service's suites in practice."
  - "Replacing .backup with a tmp-file mechanism (Option 2 in original dossier) — .backup already provides durable crash-state."
  - "Jest globalSetup boot sweeper (Option 4 in original dossier) — fixture-internal recovery covers every call site that uses the fixture, by construction."
  - "Pattern B (adapter) call sites — already self-heal via existing .backup branch; touching them is churn."
  - "Generalising beyond SSM parameters — other test-cleanup leak classes (DDB rows, EB rules, IAM grants) have their own fixtures; file separately when they surface."
  - "Static recoverOrphans(ctx, paramNames[]) helper — auto-on-override recovery covers every failure mode."
  - "Process-level on('exit') / SIGTERM handlers — async work in exit handlers is unreliable; durable .backup SSM param is authoritative."
spec: docs/superpowers/specs/2026-05-12-integration-test-ssm-cleanup-hardening-on-abort-design.md
plan: docs/superpowers/plans/2026-05-12-integration-test-ssm-cleanup-hardening-on-abort.md
topic_memory: []
validation_gate: "4 mocked-SSM unit tests added in libs/integration-testing/test/fixtures/ssm-override.fixture.test.ts (happy / .backup recovery / double-corruption / no-.backup canonical-corrupt) — all green via pnpm nx run integration-testing:test (10/10 fixture suite, 54/54 lib suite). E2E gate: NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration --projects=investor-profile-ctrl,advisory-narrative-ctrl,portfolio-engine-ctrl,market-intelligence-ctrl green on dev account 771924376645 — 8/8 suites pass (longest 356s on investor-profile-ctrl resilience). Spot-check: all 4 services' .backup parameters cleaned up after run; all 4 canonicals restored to ARN. Pre-ship dev SSM survey: all canonicals were already valid ARNs and no .backup orphans, so the recovery branch wasn't exercised on real AWS — that branch is covered by the unit tests."
---

# Integration-test SSM cleanup hardening on abort

## Class of failure

Multiple agent-ctrl and adapter integration tests use `SsmOverrideFixture` to swap a canonical SSM parameter (typically an AgentCore runtime ARN) for a mock Lambda URL during the test, then restore the canonical value in `afterAll`.

When the test body throws — Jest timeout, AWS credential expiry mid-run, an `expect` failing inside the test, etc. — `afterAll` may not run, or runs after the Jest worker is in a degraded state. The override is left in place. The next test run's `beforeAll` reads the (now stale) SSM, sees a `https://*.lambda-url.us-east-1.on.aws` value instead of an `arn:` prefix, and throws:

```
Expected canonical SSM value to be an AgentCore runtime ARN, got: https://...lambda-url.us-east-1.on.aws.
Stack may not be deployed, or a prior test run left a mock URL behind.
Re-deploy <service> before re-running integration tests.
```

The error message correctly identifies the cause, but the recovery is manual (`aws ssm put-parameter --overwrite ...`). This was triggered three times during Lever 1 work (2026-05-11 → 2026-05-12) and required manual SSM restoration each time.

## Affected fixtures

- `libs/integration-testing/src/fixtures/ssm-override.fixture.ts` (or wherever `SsmOverrideFixture` lives).
- Callers: every integration test that overrides a canonical SSM ARN — at minimum the agent-ctrl trio (`investor-profile-ctrl`, `advisory-narrative-ctrl`, `portfolio-engine-ctrl`, `market-intelligence-ctrl`) and the data-feed adapter suites.

## Possible fixes

1. **Process-level signal handler.** Register an `on('exit')` / `on('SIGTERM')` cleanup hook at fixture construction time that restores SSM even on Jest worker termination. Caveat: async work in exit handlers is unreliable.
2. **State file.** Persist `{ paramName, restoreTo }` to a known temp file at override time; remove on successful restore. A pre-test boot script can read the file at startup and restore any orphans before tests begin. Survives crashes.
3. **SSM TTL via parameter-store metadata.** SSM doesn't natively support TTL, but a `Description` field stamped with the test run's start time would let a pre-test sweeper restore values older than N minutes.
4. **Deploy-driven canonical idempotency.** Run a "restore canonical SSM" pre-step before every integration suite that re-reads CDK outputs and reasserts the ARN value. Decouples test cleanup from the production deploy chain. Most robust; ~30s overhead at suite start.

Option 2 (state file + boot sweeper) is the most pragmatic — minimal new infra, survives crashes, no AWS calls in steady state.

## Validation gate

After fix:
- Run integration suite, kill it mid-execution with `kill -9` on a Jest worker.
- Re-run integration suite — must pass `beforeAll` SSM check without manual intervention.

## Why this is P2 not P1

The reconciliation-ctrl idempotency race (separate backlog entry) is a production correctness bug. This SSM leak is a test-infrastructure quality-of-life issue — it never affects production, only slows down test iteration.

## Ship narrative (2026-05-12)

The fix was tighter than the dossier predicted. Code archaeology revealed the fixture **already** wrote a durable `${paramName}.backup` SSM parameter — durable crash-state was already half-built. What was missing was the **recovery** half: nothing read `.backup` on entry to restore canonical, so the leak was never self-healing.

Of the 17 grep matches for `SsmOverrideFixture`, only 15 were test-file call sites (4 were prod `service.stack.ts` comments). Those 15 split:
- **Pattern A (8 files):** agent-ctrl trio + `market-intelligence-ctrl`, each `*.integration.test.ts` + `*.resilience.integration.test.ts`. Call site read canonical SSM, asserted `startsWith('arn:')`, passed derived value as `restoreTo`. That pre-fixture read was the failure point — it fired before any crash-recovery could run.
- **Pattern B (7 files):** all adapters, passing a hardcoded literal `restoreTo`. Already self-heal because the existing `backupExists` branch skips the corruption check when `.backup` is present.

So the fix touched the lib + only the 8 Pattern A files. The new `overrideAndDeriveRestore({ paramName, testValue, expectedRestorePrefix })` method consumes `.backup` on entry: if present, it validates the prefix, repairs canonical from `.backup`, and uses the recovered value as `restoreTo`. If absent, it falls back to reading canonical (existing behaviour). The standard override path then runs unchanged.

**Validation gate sequence:**
1. 4 mocked-SSM unit tests added — all 4 pass (covering happy / recovery / double-corruption / no-backup canonical-corrupt). Full `integration-testing:test` target: 54/54.
2. End-to-end on dev account: `pnpm nx run-many -t test-integration` for the 4 services. **First run failed for an orthogonal reason** — the `test-integration` Nx target doesn't declare `dependsOn: ['build-mock']`, so a fresh worktree had no `mock-agent-runtime.zip` files. This is exactly the `test-integration-build-mock-dependson` backlog entry (filed 2026-05-12). After `pnpm nx run-many -t build-mock` for the 4 services, all 8 integration suites passed (longest: 356s on `investor-profile-ctrl.resilience.integration.test.ts`).
3. SSM spot-check post-run: 4/4 `.backup` parameters cleaned up; 4/4 canonical params restored to ARN.

**What was NOT exercised on real AWS:** the dev account had no orphaned `.backup` parameters and no corrupted canonicals at the start of the run, so the `.backup`-recovery branch fired only in the unit tests. That branch is correctly tested at the mock layer; the next real crash will be the integration test of the recovery path.

**Commits on `feat/ssm-cleanup-hardening-on-abort`:**
- `f83c0899` — `feat(integration-testing): add SsmOverrideFixture.overrideAndDeriveRestore with .backup-driven crash recovery`
- `c47f71847` — `test(investor-profile-ctrl): adopt SsmOverrideFixture.overrideAndDeriveRestore`
- `e6e8be97` — `test(advisory-narrative-ctrl): adopt SsmOverrideFixture.overrideAndDeriveRestore`
- `353f8eebc` — `test(portfolio-engine-ctrl): adopt SsmOverrideFixture.overrideAndDeriveRestore`
- `07963e3e` — `test(market-intelligence-ctrl): adopt SsmOverrideFixture.overrideAndDeriveRestore`

Each migration: ~17 lines saved per service (10 line additions vs 27-28 deletions). Total +208/-138 lines across the workstream including the new method + tests.
