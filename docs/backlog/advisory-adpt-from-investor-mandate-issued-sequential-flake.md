---
id: advisory-adpt-from-investor-mandate-issued-sequential-flake
status: parking
type: bug
notes: "advisory-adpt from-investor.integration.test.ts MANDATE_ISSUED forwarding times out when Nx runs all 3 advisory-adpt integration test files in one Jest session; passes when from-investor runs alone via direct jest. Parallelism-independent."
references:
  - "services/advisory/advisory-adpt/test/integration/from-investor.integration.test.ts:45"
  - "services/advisory/advisory-adpt/test/integration/from-execution.integration.test.ts"
  - "services/advisory/advisory-adpt/test/integration/from-ledger.integration.test.ts"
  - "libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:255"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# advisory-adpt from-investor MANDATE_ISSUED forwarding: cross-file Jest-session flake

## Symptom

`advisory-adpt: Investor → Advisory forwarding › should forward MANDATE_ISSUED from InvestorBus to AdvisoryBus` times out at `EventBusTrap.waitForEvent` with `Captured-but-unmatched buffer: []` — the trap saw zero events. `OPERATING_MODE_CHANGED` exhibits the same pattern intermittently. `INVESTOR_PROFILE_UPDATED` and `MANDATE_REVOKED` in the same file pass.

## Trustworthy evidence (2026-05-13)

| Run | Result |
|---|---|
| Lever 4 full suite `--parallel=4` run 1 | 27/27 green; advisory-adpt passed on `jest.retryTimes(1)` |
| Lever 4 full suite `--parallel=4` run 2 | advisory-adpt failed cleanly, no network errors |
| `nx run advisory-adpt:test-integration --skip-nx-cache` (3 files, maxWorkers=1) | 5 passed, 1 failed (MANDATE_ISSUED, retries also failed) |
| `pnpm jest --testPathPatterns=from-investor --runInBand` (1 file, 4 it() blocks) | 4/4 passed in 99s |
| `pnpm jest --testNamePattern=MANDATE_ISSUED --runInBand` | passed in 8s |
| `pnpm jest --testNamePattern="(INVESTOR_PROFILE_UPDATED\|MANDATE_ISSUED)" --runInBand` | both passed in 16s |

## What's ruled out

- **Parallelism.** Repros with `--runInBand` and `maxWorkers=1`. `--parallel=4` is incidental.
- **Stale dev rule.** Deployed advisory-adpt FromInvestor rule has the current detail-type list including MANDATE_ISSUED and OPERATING_MODE_CHANGED (verified via `aws events describe-rule`).
- **Failed forwarding to AdvisoryBus.** CloudWatch `Invocations` on the FromInvestor rule shows non-zero counts during test runs; `FailedInvocations` is 0; DLQ depth 0.
- **EB Rule pattern logic.** When run alone the same publish path delivers the event in <8s.

## Active hypothesis

Some sequencing dependency across the 3 advisory-adpt integration test files (`from-execution`, `from-investor`, `from-ledger`) when Jest runs them serially in one process. The reproduction window is "from-execution runs first, then from-investor in same Jest session". Possibilities:

- AWS SDK connection-pool state leaking from prior test file's destroyed clients.
- EB rule churn on AdvisoryBus from prior trap teardowns leaving brief inconsistency.
- Shared global state in test infra (CleanupRegistry, SsmCache) that resets imperfectly.

## Cheapest next step

Reproduce cleanly with explicit `console.log` instrumentation of `EventBusTrap.consumeMessages` showing what SQS receives, plus `aws events describe-rule` immediately after the failing test's `trap.deploy()` to confirm the rule is healthy. This requires network stability that was unavailable during the original investigation window.

## Why this is parking, not active

Lever 4's ratification of `--parallel=4` (and the user's pivot to test `--parallel=8`) does not depend on this fix — the flake is parallelism-independent. Pre-existing test-infra rot; can be picked up when there's a clear hour for investigation.
