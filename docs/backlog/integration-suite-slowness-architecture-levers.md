---
id: integration-suite-slowness-architecture-levers
status: active
type: refactor
notes: "Diagnostic dossier on integration-suite wall-clock. Five distinct levers identified, each with measurable reclaim. Promoted 2026-05-11 after original ranks 1-6 closed (boundary review). Active workstream is Lever 1 only (predicate primitive + sweep + 3 timeout tightenings); Levers 2–5 will be refiled as separate queued entries on ship."
references:
  - docs/superpowers/specs/2026-05-11-integration-suite-lever-1-design.md
out_of_scope:
  - "Lever 2 (adapter Lambda cold-start warmup)"
  - "Lever 3 (ledger-ctrl resilience it.each consolidation)"
  - "Lever 4 (--parallel=4)"
  - "Lever 5 (CDK bundling tax in the unit suite)"
  - "Production handler / transform / infra changes"
  - "Async predicates or cross-resource waits in test-support"
  - "Re-measure-only PR (measurement is the validation gate of this workstream)"
spec: docs/superpowers/specs/2026-05-11-integration-suite-lever-1-design.md
plan: null
topic_memory: []
validation_gate: null
---

# Integration suite wall-clock: distinct levers and measurable reclaim

Survey snapshot 2026-05-11 (`pnpm nx run-many -t test-integration --parallel=2`):

- Wall-clock: **54 m 53 s** across 27 services.
- Sum-CPU: ~108 m (so parallelism-limited, not work-limited).
- 24 individual tests run **≥ 20 s each** (total 880 s across 75 passing tests = ~12 s mean).
- `investor-ctrl` alone = 36 % of wall-clock (1175 s) — failures, see rank 6.
- `ledger-ctrl` = 14 % (867 s) — passing but slow, see Lever 3.

## Lever 1 — eventual-consistency polling has no "wait for predicate" primitive

The dominant pattern in `advisory-bff` integration (6 tests, 22–45 s each):

```ts
await table.waitForItem({ pk, sk, timeoutMs: 60_000 });   // wait for row to appear
let item;
while (Date.now() < deadline) {                            // separately poll for status flip
  item = await table.waitForItem({ pk, sk, timeoutMs: 5_000 });
  if (item['status'] === 'APPROVED') break;
}
```

`waitForItem` checks existence only. Tests must hand-roll a poll loop with 5 s cadence to wait for a specific field value. Each 5 s tick adds latency-to-detect even when the value flipped within milliseconds of the previous read.

**Reclaim:** add a `waitForItemMatching({ pk, sk, predicate, intervalMs })` helper in `@nestfolio/test-support`. With 500 ms cadence + early-exit, advisory-bff's 6 slow tests should converge in ~25 s each instead of 43–45 s. Estimated reclaim: **~110 s wall-clock**, applied to the longest critical path.

## Lever 2 — adapter Lambda cold-start dominates the first test of each suite

Slow first test, fast follow-ups (same suite):

| service | test #1 | test #2 | cold-start tax |
| ------- | ------- | ------- | -------------- |
| alpha-vantage-adpt | 26.4 s | 0.7 s | ~25 s |
| marketwatch-adpt | 24.7 s | 1.3 s | ~23 s |
| yahoo-finance-adpt | 24.7 s | 0.6 s | ~24 s |
| broker-sim-adpt | 24.2 s | 9.3 s | ~15 s |

The external API is already mocked via `SsmOverrideFixture` (e.g. `services/advisory/marketwatch-adpt/test/mocks/mock-marketwatch.ts`), so this is NOT a network bottleneck — it's the Lambda + SQS + EB chain warming up.

**Reclaim:** add a `warmHandler()` step to `beforeAll` of the adapter suites — invoke the Lambda once before the first real assertion to pay the cold-start outside the timed test. Estimated reclaim: **~87 s wall-clock** spread across 4 adapter suites.

## Lever 3 — `ledger-ctrl` resilience suite single-handedly accounts for 8 minutes

`ledger-ctrl.resilience.integration.test.ts` runs 5 tests in 489.7 s (mean 98 s/test). Each test publishes N events on EB, then polls `assertEquivalentState` until two DDB snapshot reads agree. Snapshot stabilization across N CDC roundtrips is genuinely the work, but:

- 5 tests of "duplicate / order-agnostic" assertions is structurally **the same primitive applied to different inputs**. Today it's 5 separate `it()` blocks; could be a single `it.each` with shared setup that amortizes the EB/SQS/Lambda warmup.
- The current "snapshot differs / retry" output suggests the assertion polls with a wide interval. Same `waitForItemMatching` primitive from Lever 1 applies here.

**Reclaim:** consolidating to `it.each` over a shared snapshot fixture, plus tighter poll cadence on the equivalence assertion, could compress to ~300 s. Estimated reclaim: **~190 s**.

## Lever 4 — parallelism is conservative (`--parallel=2`)

Wall-clock 3293 s, sum-CPU 6535 s → effective parallelism ~2.0×. With `--parallel=4`:
- Theoretical wall-clock floor: max(single project) = `investor-ctrl` 1175 s (= 19.6 min). Even at infinite parallelism this is the floor until rank 6 lands.
- After fixing rank 6 (drops `investor-ctrl` to a couple of minutes), next floor is `ledger-ctrl` 867 s (14.4 min).
- So **parallelism = 4 is structurally bounded by the single slowest project, not by box-cores**. Raising parallelism without addressing Levers 1+3 buys < 10 minutes.

**Reclaim sequence (matters):** rank 6 → Lever 3 → `--parallel=4`. Doing them in reverse leaves a long tail dominating the wall-clock.

## Lever 5 — CDK bundling tax (unit suite, not integration)

For completeness: integration tests do NOT bundle Lambdas (no `Bundling asset` lines in the integ log). The bundling tax (104 events in unit log) sits in the unit suite — `cdk-constructs:test` alone bundles 57 assets in 32 s as it synthesizes per-construct stacks in tests. Out of scope for *integration* slowness but worth noting if unit wall-clock becomes a concern.

## Suggested order of work

1. Close ranks 1–6 (frees the failure mask, lets timing numbers stabilise).
2. Re-measure. Many of these "slow" tests are slow *because they retry*; some will collapse on their own.
3. Pick Lever 1 (test-support primitive) — touches 6 tests, ships a reusable primitive that future tests will adopt automatically.
4. Pick Lever 2 (adapter warmup) — 4 suites, surgical change.
5. Lever 3 (`ledger-ctrl` resilience consolidation) — bigger refactor; do last.
6. Only then raise `--parallel=4` and re-measure.

## Tighten-timeout candidates (after ranks 1–6 close)

Once the suite is green and Levers 1+2 land, these timeouts can drop:

| current | likely safe value | rationale |
| ------- | ----------------- | --------- |
| `EventBusTrap` 90 s for `NOTIFICATION_CREATED` (rank 6 tests) | 30 s | a real CDC chain converges in 5–15 s on dev; 90 s only made sense because the test was broken |
| `TableAssertions.waitForItem` 60 s defaults in advisory-bff | 30 s | observed convergence ≤ 22 s on cold start |
| `TableAssertions.waitForItem` 5 s inside poll loops | 1 s | tighten cadence (Lever 1's predicate-wait makes this irrelevant) |
| Agent-ctrl `TableAssertions.waitForItem` 60 s (rank 4) | 20 s | the DDB write is synchronous in the handler — once the event reaches the Lambda, the row is there |

Don't tighten before the 6 failures are fixed — the current values absorb today's flakes.
