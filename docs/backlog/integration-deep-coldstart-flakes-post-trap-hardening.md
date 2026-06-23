---
id: integration-deep-coldstart-flakes-post-trap-hardening
status: parking
type: bug
notes: "Trap-empty hardening reduced lockstep-polling flakes from 5-7/run baseline to ~2/run average. Residual flakes have a different signature: cold-start-bound paths whose tests already use explicit `timeoutMs` overrides of 90-300s, and a Jest VM-teardown race in OrphanReaper. Filed as a single umbrella because the cases share the cold-start cause, not because they share a fix."
references:
  - "services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts:477"
  - "services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts:239"
  - "services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts:385"
  - "services/advisory/advisory-narrative-ctrl/test/integration/advisory-narrative-ctrl.resilience.integration.test.ts:208"
  - "libs/integration-testing/src/fixtures/orphan-reaper.ts"
  - "docs/backlog/integration-trap-empty-family-hardening.md"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
epic: integration-test-timing-fragility
epic_role: core
---

# Deep cold-start flakes residual after trap-empty hardening

## Symptom

After the 2026-05-12 trap-empty-family-hardening ship (eventTimeout 45→90s + jitter), the remaining `--parallel=8` integration flakes have a different shape than the lockstep-polling family the hardening targeted. Across 3 validation runs (run #1b, #2, #3) the residual cases were:

### A. `ledger-ctrl CDC chain ORDER_REJECTED → LEDGER_ENTRY_RECORDED`

```
EventBusTrap: timeout waiting for event after 120000ms. Captured-but-unmatched buffer: []
```

The test (`ledger-ctrl.integration.test.ts:477`) already passes `timeoutMs: 120_000`. Two full minutes and no event observed. Retry-passed. Suggests Lambda cold-start of the CDC consumer chain beyond 2 minutes under elevated parallelism.

### B. `ledger-ctrl resilience pairwise — DEPOSIT_DETECTED then ORDER_FILLED vs reverse`

```
Exceeded timeout of 300000 ms for a test.
```

Test sets jest `it(..., 300_000)`. Hits the 5-minute test-level limit. Run #3 hard-fail (not retry-passed).

**Investigated 2026-05-28 under `ledger-ctrl-resilience-pairwise-timeout` (shipped).** Empirical CloudWatch evidence (14d Duration/IteratorAge/Errors on `dev-ledger-ctrl-ReducerFnB8BFD8FF-wCVIOafQsvir`) ruled out reducer logic regression and reserved-concurrency starvation. The failure day was actually one of the lower-lag IteratorAge days in the window. Per-invocation Duration is stable (45-150ms avg). Cause is environmental noise outside the reducer (test-context setup, EB rule propagation, OrphanReaper churn). Workaround (480s test budget, commit `d5e0152b`) is the correct fix. See `docs/backlog/ledger-ctrl-resilience-pairwise-timeout.md` for the measurements table.

### C. `ledger-ctrl resilience full-shuffle — 3 events shuffled order`

```
waitForEntryCount: timeout waiting for 2 entries
```

Custom helper times out waiting for DDB row count. Run #3 hard-fail.

### D. `advisory-narrative-ctrl resilience — OrphanReaper VM-teardown race`

```
ERR_VM_MODULE_NOT_MODULE
  at importModuleDynamicallyWrapper (node:internal/vm/module:531:13)
  at @aws-sdk+credential-provider-node/dist-cjs/index.js:127:29
  at OrphanReaper.reapLambdas (libs/integration-testing/src/fixtures/orphan-reaper.ts:48:24)
  at createIntegrationTestContext (libs/integration-testing/src/bootstrap.ts:23:3)
```

Tests run `OrphanReaper.cleanup()` inside `createIntegrationTestContext`. When the AWS SDK credential provider lazy-imports its node-credential chain DURING the test, but Jest has already begun environment teardown for an earlier `it`, the dynamic `import()` resolves to a value that fails the VM-module instanceof check. Net result: cleanup throws, the next test's setup runs against partially-cleaned state.

## Possible causes (each case needs its own investigation)

- **A, B, C:** Lambda cold-start tail under high parallelism. AgentCore-backed advisory paths cold start in 20-30s; CDC stream batching adds polling latency; under `--parallel=8` AWS may briefly throttle DDB stream poll workers. Test-side fixes (warmup invocations, longer `timeoutMs`) treat the symptom. Real fix is either: (a) keep handlers warm via scheduled pings during integration suite, (b) provision higher concurrency, or (c) accept these tests as `--parallel=4`-only.
- **D:** Race between Jest worker shutdown and lazy AWS SDK module import. Two candidate fixes:
  - Eagerly import the AWS credential chain at module load (defeats lazy-loading)
  - Use a synchronous credential provider (e.g. `defaultProvider` with eager init) in `OrphanReaper`
  - Move `OrphanReaper.cleanup()` out of `createIntegrationTestContext`'s constructor path (let suites opt in)

## Fix scope

Three independent workstreams (or possibly four):
1. Triage cases A/B/C individually — confirm each is cold-start vs. logic vs. parallelism throttling.
2. Fix the OrphanReaper VM-teardown race (case D) — independent and self-contained.
3. (Maybe) Document the `--parallel=8` failure modes and decide whether the suite should drop to `--parallel=4` for cold-start-heavy services.

## Out of scope

- Reverting the trap-empty hardening (eventTimeout 90s + jitter). The reduction from 5-7/run to ~2/run is real.
- Increasing `--parallel` beyond 8. Lever 4 measured this and 8 is the ceiling.
- Removing `jest.retryTimes(1)` while these residual flakes exist.
