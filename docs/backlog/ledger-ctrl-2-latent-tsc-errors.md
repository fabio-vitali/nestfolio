---
id: ledger-ctrl-2-latent-tsc-errors
status: dropped
type: bug
dropped_reason: "Resolved by construction in dashboard-advisory-readmodel-fixes Part D (D3, 2026-06-03): the two `'timestamp' does not exist in type TableEntry` errors were the first-reported excess properties on bare-TableEntry literals; dropping the redundant `: TableEntry` annotation (put() takes Record<string,unknown>, so the annotation was non-load-bearing) cleared them — ledger-ctrl full-spec tsc 2→0. See dashboard-advisory-readmodel-fixes validation_gate."
notes: "Two latent tsc --noEmit errors in services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts:79 and :185 — `'timestamp' does not exist in type 'TableEntry'`. Surfaced 2026-05-15 during the ledger-ctrl-simulated-trade-quantity-undefined ship. Not a deploy or test blocker (esbuild strips types; ts-jest is lenient on excess-property in nested generics). Same class as investor-bff-13-latent-tsc-errors."
references:
  - services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts
  - libs/event-processor/src
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# 2 latent `tsc --noEmit` errors in ledger-ctrl repositories

Running `pnpm tsc --noEmit -p services/ledger/ledger-ctrl` on 2026-05-15 (post-Bug-1 ship at commit `268701d1`) yields:

```
services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts(79,9): error TS2353: Object literal may only specify known properties, and 'timestamp' does not exist in type 'TableEntry'.
services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts(185,9): error TS2353: Object literal may only specify known properties, and 'timestamp' does not exist in type 'TableEntry'.
```

Both locations build `TableEntry`-typed items that set a `timestamp` field; `TableEntry` (from `libs/event-processor/src`) evidently doesn't include `timestamp` in its definition any more, but the items DO get written to DDB and DDB doesn't care about the structural mismatch.

## Why this stays parking (not queued)

Per the `feedback_e2e_gaps_queued_not_parking` litmus: does this affect whether `apps/e2e-feature-tests` or `apps/nestfolio-e2e` passes today?

- **esbuild** strips types, so the production bundle is fine — the Lambdas run.
- **ts-jest** with the ledger-ctrl test setup doesn't surface this error (the in-memory test compile is more lenient than `tsc --noEmit -p`).
- **The full ledger-ctrl unit suite is green** (16 suites / 100 tests pass on `main` at commit `268701d1`).
- **Scenario 6 e2e passes** consistently after the redeploys.

Same diagnostic, same class, same disposition as [[investor-bff-13-latent-tsc-errors]].

## Cheapest fix path (when promoted)

Either:
1. Add `timestamp?: string` to the `TableEntry` type in `libs/event-processor/src` so it accepts what every repository already writes. (Cleanest — likely intent of the original type.)
2. Move the `timestamp` field outside the `TableEntry`-typed literal at both call sites (line 79 saveSnapshot; line 185 saveCheckpoint) and assign it via cast or partial-type widening.

Option 1 is the right call if other repositories around the codebase already write `timestamp` onto `TableEntry`-typed items (they almost certainly do — `timestamp` is a near-universal column).

Promote when:
- A CI gate enforces `tsc --noEmit` workspace-wide (likely part of [[ci-pipeline-bring-up]]), OR
- Bundling all latent tsc errors into a single sweep alongside [[investor-bff-13-latent-tsc-errors]].
