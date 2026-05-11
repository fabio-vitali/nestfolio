---
id: integration-suite-lever-4-parallelism
status: queued
rank: 3
type: tooling
notes: "Raise nx test-integration parallelism from --parallel=2 to --parallel=4. Empirically validated 21:12 wall-clock (vs 50:20 at --parallel=2) on 2026-05-12. BLOCKED on reconciliation-ctrl-idempotency-race-under-parallel-load: the parallel=4 run exposed a real concurrency bug in reconciliation-ctrl. Cannot adopt --parallel=4 as default CI cadence until that's fixed — otherwise the same race will manifest as a CI flake masking real regressions."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Lever 4 — adopt `--parallel=4` for integration suite

## Empirical result (2026-05-12)

Single full-suite measurement on branch `feat/integ-lever-1` after Levers 1+3 landed:

- `nx run-many -t test-integration --parallel=2`: **44:33** wall-clock (27 projects green).
- `nx run-many -t test-integration --parallel=4`: **21:12** wall-clock — **but 1 suite failed** (`reconciliation-ctrl.resilience.integration.test.ts`).

## Why this is blocked

The `reconciliation-ctrl` failure at `--parallel=4` is a real concurrency race in production code (filed as `reconciliation-ctrl-idempotency-race-under-parallel-load`), not a test-environment flake. Re-running the same project at `--parallel=2` passes; at `--parallel=4` it deterministically fails on the duplicate `RECONCILIATION_COMPLETED` assertion.

Adopting `--parallel=4` as default before fixing that race would:

- Turn a real production correctness bug into a recurring CI flake.
- Mask the same class of bug in future services (developers learn to "retry the CI run").
- Erode confidence in the integration suite as a regression gate.

## Path to adopt

1. **Land** `reconciliation-ctrl-idempotency-race-under-parallel-load` (P1).
2. Re-run `nx run-many -t test-integration --parallel=4` twice consecutively, both green.
3. Update CI config + any local docs to default to `--parallel=4`.
4. Optionally try `--parallel=6` or higher to find the next plateau.

## Validation gate

Two consecutive `--parallel=4` runs green; no new flakes for 1 week of normal PR activity.

## Out of scope here

Setting CI runner sizing or runner-count changes — `--parallel=N` operates within a single runner. Multi-runner sharding is a different mechanism.
