---
id: integration-test-ssm-cleanup-hardening-on-abort
status: queued
rank: 6
type: refactor
notes: "Class of test-cleanup leak: when a test's body throws (or its Jest deadline expires) before reaching afterAll, SsmOverrideFixture's restore step is skipped — leaving the canonical SSM pointed at a mock URL. Next test run's beforeAll then fails the ARN-prefix check. Seen across investor-profile-ctrl, advisory-narrative-ctrl, portfolio-engine-ctrl during Lever 1 work."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
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
