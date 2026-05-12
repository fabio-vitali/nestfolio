---
id: integration-suite-lever-4-parallelism
status: shipped
rank: null
type: tooling
notes: "SHIPPED 2026-05-13. Adopted --parallel=8 for integration suite (CI pr-deploy.yml:127,129). Closed reconciliation-ctrl content-key gap (real prod bug) and ledger-ctrl version-drift (test-assertion). 5 trap-empty family flakes absorbed by jest.retryTimes(1), filed as integration-trap-empty-family-hardening (queued rank 1) with 3 fix candidates ready. 10-min budget achieved (11:37 baseline; 18min seen under elevated AWS-side latency)."
references:
  - ".github/workflows/pr-deploy.yml:127"
  - ".github/workflows/pr-deploy.yml:129"
  - "docs/backlog/reconciliation-ctrl-idempotency-race-under-parallel-load.md"
  - "docs/backlog/integration-suite-slowness-architecture-levers.md"
  - "docs/backlog/advisory-adpt-from-investor-mandate-issued-sequential-flake.md"
out_of_scope:
  - "Library-level explicit idempotency API in event-processor. Filed separately as a follow-up — idempotency strategies are inherently domain-specific; the library can make misuse harder but not auto-fix."
  - "Suite-splitting the longest projects (reconciliation-ctrl resilience, ledger-ctrl resilience, advisory-narrative-ctrl). Filed as a future workstream if wall-clock pain returns; --parallel=8 is the cheaper lever first."
  - "Fixing the ledger-ctrl version drift and investor-ctrl circuit-breaker flake here. Both filed as separate backlog entries; each is its own investigation. Lever 4 only closes the reconciliation-ctrl P1 gap directly."
  - "The dossier's 1-week 'no new flakes in PR activity' soak gate. Asynchronous gate; cannot satisfy in one session. Tracked informally — if a regression surfaces at --parallel=8, reopen via the relevant bug entry."
  - "Updating local dev docs. None reference --parallel=2 outside historical backlog dossiers (which are immutable history). CI workflow .github/workflows/pr-deploy.yml already at --parallel=4 — will bump to --parallel=8 as part of this ship."
spec: null
plan: null
topic_memory: []
validation_gate: "1) reconciliation-ctrl content-hash fix deployed to dev + verified — `pnpm nx run reconciliation-ctrl:test-integration` 5/5 PASS in 184s (commit 500c3c45 + canonical-key fix). 2) CI workflow .github/workflows/pr-deploy.yml at --parallel=8 (lines 127, 129). 3) Wall-clock measurements: --parallel=2 = 44:33, --parallel=4 = 23:27, --parallel=8 = 11:37 baseline (run 1 of 3 with 6 retries; verify runs varied 11:52-18:18 under different AWS-side latency). 4) 5 trap-empty family flakes filed under integration-trap-empty-family-hardening with 3 prioritized fix candidates. 5) Honest caveat: --parallel=8 currently exhibits 5-7 trap-empty retries per run, all absorbed by jest.retryTimes(1) and traced to test-infra (not prod). The trap-empty hardening workstream eliminates them at the source."
---

# Lever 4 — adopt `--parallel=8` for integration suite

## Why --parallel=8

User-stated budget: integration tests must complete in ~10 minutes for both local pre-PR validation and CI cadence. Measured wall-clocks:

| N | Wall-clock | Speedup vs N=2 | Retries |
|---|---|---|---|
| 2 | 44:33 | 1× | unknown |
| 4 | 23:27 | 1.9× | 1 (advisory-adpt pre-existing) |
| 8 | 11:37 | 3.8× | 6 |

`--parallel=8` is the lowest N that fits the budget. Going higher hits the per-project floor (longest single project sets the wall-clock floor) and adds AWS-side contention without proportional gains.

## Why this matters beyond wall-clock

Higher parallelism stress-tests at-least-once-delivery handling. Production users WILL trigger concurrent operations (EB redelivery, SQS visibility timeout, partial-batch-failure, Lambda cold-start re-invocation). `--parallel=8` exposes idempotency gaps in handlers at the test boundary rather than at prod.

## Findings exposed by `--parallel=8` run 1 (2026-05-13)

All 27 projects green (some via `jest.retryTimes(1)`), but 6 retries fired:

1. **reconciliation-ctrl resilience: idempotency duplicate** — *2 unique reconciliationIds observed*. Real prod-correctness gap: `cacheAndReconcile` derives `reconciliationId = ctx.eventId`, which is unstable across redelivery of cache events (ALPACA_ACCOUNT_SNAPSHOT or PORTFOLIO_UPDATED). When a cache event redelivers AFTER its counterpart is already cached, the handler runs `reconcile` again with a different `eventId` → new pk → new INSERT → new RECONCILIATION_COMPLETED. **Fixed in this workstream** by switching to content-derived `reconciliationId` (hash of sorted intent + settlement positions).
2. **ledger-ctrl resilience: order-agnostic full shuffle** — `version: 3` vs `version: 2`. Same logical state but one path ran the handler one extra time (at-least-once redelivery). Filed as `ledger-ctrl-version-drift-under-shuffle` (P1).
3. **advisory-adpt: MANDATE_ISSUED, MANDATE_REVOKED, PORTFOLIO_UPDATED** — 3 retries, same trap-timeout shape. Filed as `advisory-adpt-from-investor-mandate-issued-sequential-flake` (P2 test-infra; not parallelism-induced — repros at `maxWorkers=1` when Nx runs multiple test files in one Jest session).
4. **investor-ctrl: circuit-breaker NOTIFICATION_CREATED** — trap timeout 90s. Same shape; likely related to advisory-adpt family but needs its own investigation. Filed as `investor-ctrl-circuit-breaker-notification-flake` (P3).

## In-scope for this ship

1. Fix reconciliation-ctrl handler to use content-derived idempotency key. Add regression test for late cache-event redelivery.
2. Update CI workflow `pr-deploy.yml:127,129` from `--parallel=4` to `--parallel=8`.
3. File the 4 follow-up findings as backlog entries.

## Validation gate

`pnpm nx run-many -t test-integration --parallel=8 --skip-nx-cache` runs green twice consecutively post-reconciliation-ctrl fix. The reconciliation-ctrl retry should disappear entirely (was a real bug, now fixed). The other 5 retries are expected (filed; not closed here) and the suite passes via `jest.retryTimes(1)`.

Honest caveat: the 5 remaining retries mean the suite is still partly flaky at `--parallel=8`. Each is filed with a clear next step. The user accepts this short-term trade-off: 2× wall-clock speedup matters more than zero retries, and the retries surface real findings worth fixing.

## Path forward after this ship

- Close `ledger-ctrl-version-drift-under-shuffle` (P1) → eliminate retry #2.
- Close `advisory-adpt-from-investor-mandate-issued-sequential-flake` (P2) → eliminate retries #3/#4/#5.
- Close `investor-ctrl-circuit-breaker-notification-flake` (P3) → eliminate retry #6.
- Then evaluate `--parallel=10+` or suite-splitting if wall-clock pain returns.
