---
id: advisory-adpt-from-investor-mandate-issued-sequential-flake
status: queued
rank: 1
type: bug
notes: "Cross-domain adapter forwarding tests time out with `Captured-but-unmatched buffer: []` when subsequent tests run in the same Jest session. Reproduces on advisory-adpt (MANDATE_ISSUED, OPERATING_MODE_CHANGED — fail when from-execution runs first) and re-observed 2026-05-13 on investor-adpt (PORTFOLIO_DRIFT_DETECTED — fails as the 2nd test in from-ledger.test.ts after BALANCE_UPDATED passes). Cross-bus EB-to-EB forwarding rule is verified deployed with the right detail-types; canary verifies trap rule activation but not the upstream forwarding hop."
references:
  - "services/advisory/advisory-adpt/test/integration/from-investor.integration.test.ts:45"
  - "services/advisory/advisory-adpt/test/integration/from-execution.integration.test.ts"
  - "services/advisory/advisory-adpt/test/integration/from-ledger.integration.test.ts"
  - "services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts:54"
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

### 2026-05-13 — Sibling observation: investor-adpt within-file variant

`investor-adpt: Ledger → Investor forwarding › should forward PORTFOLIO_DRIFT_DETECTED from LedgerBus to InvestorBus` times out at 60s with `Captured-but-unmatched buffer: []`. The first test in the same file (`BALANCE_UPDATED`) passes in ~22s. Both traps are deployed in `beforeAll` (two separate `EventBusTrap` instances on InvestorBus), both canaries warm up successfully, so the destination-side rule is verified active. The PORTFOLIO_DRIFT_DETECTED forwarding rule on LedgerBus is confirmed deployed with the correct detail-type list (`aws events describe-rule`). The first `BALANCE_UPDATED` PutEvents and forwarding succeeds; the second `PORTFOLIO_DRIFT_DETECTED` PutEvents lands on LedgerBus but never reaches the destination trap's SQS.

Same family — second cross-domain forwarding hop in a Jest worker fails after the first has succeeded. Different from the advisory-adpt variant only in that the "first" event is in the same file (intra-file) vs. a prior test file (cross-file).

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

## 2026-05-13 promotion to QUEUED rank 1

Re-surfaced 2026-05-13 in a full integration-suite run with the investor-adpt sibling appearing on the same run. The flake class now spans two distinct services (advisory-adpt cross-file, investor-adpt intra-file). The "absorbed by `jest.retryTimes(1)`" mitigation from `integration-trap-empty-family-hardening` (shipped 2026-05-12) failed for these two tests in the 2026-05-13 run — retry also failed. Promotion driven by: (a) growing list of services affected, (b) absorbed-by-retry mitigation no longer reliable, (c) user pivot to "properly fix all integration tests" rather than parking flakes.

## Suggested investigation lanes

1. **Cross-bus canary.** Extend `EventBusTrap.deploy()` to optionally fire a pre-flight canary on the upstream bus and verify it lands at the destination trap — would convert silent forwarding failures into noisy fast-fail diagnostics.
2. **Per-file Jest worker isolation.** Configure `maxWorkers: 1` already implicit in `--parallel=N` at the project level; explore `testEnvironment: 'node'` + `forceExit` semantics + verbose process-level isolation to rule out shared-VM state.
3. **AWS SDK pool inspection.** Capture `node --inspect` heap snapshots before and after the second cross-domain test in a single Jest worker to look at SDK socket-pool state.
4. **EB Rule activation telemetry.** Tail `EventBridge` `MatchedEvents` and `InvocationsDetail` metric streams during the failing test to confirm whether the source-bus rule fired but the target-bus rule didn't (or whether the source-bus PutEvents was accepted but never matched any rule).
