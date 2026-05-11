---
id: integration-suite-lever-2-adapter-warmup
status: dropped
type: refactor
notes: "Dossier estimated ~87s reclaim from a beforeAll warmHandler() pattern in 4 adapter suites. On scoping the work (2026-05-12) the mechanism doesn't actually reduce per-suite wall-clock — warmHandler() in beforeAll just relocates the cold-start cost from it() to beforeAll, leaving suite total unchanged. The only mechanism that would actually save wall-clock is global pre-warm before any worker boots — which requires either handler cooperation (no-op warmup payload, out of scope) or provisioned concurrency (real-money cost, inappropriate for tests). Dropped without implementation."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
closed: "2026-05-12"
---

# Lever 2 — adapter warmHandler() — dropped, mechanism doesn't help

The dossier `docs/backlog/integration-suite-slowness-architecture-levers.md` enumerated Lever 2 as:

> Add a `warmHandler()` step to `beforeAll` of the adapter suites — invoke the Lambda once before the first real assertion to pay the cold-start outside the timed test. Estimated reclaim: **~87 s wall-clock** spread across 4 adapter suites.

On scoping the work during integration-suite Lever 1 ship, the mechanism was found to not actually save wall-clock:

- `beforeAll` is part of the suite's wall-clock. Pushing the cold-start from `it()` into `beforeAll` reduces the `it()` time visible in Jest's reporter, but the *suite total* — `beforeAll + sum(it) + afterAll` — stays the same.
- The only way to truly skip the cold-start cost is to pre-warm the Lambda before any test worker enters its `beforeAll`. That requires either:
  - The handler accepting a no-op "warmup" payload that skips its production-side effects. This is a handler change (out of scope for a test-infrastructure workstream) and adds risk of test-only code paths in production.
  - Provisioned concurrency on the Lambda. Real money cost; inappropriate to enable for tests only; also doesn't fully eliminate cold-start under burst-above-provisioned load.

Dropped without implementation. The dossier's reclaim estimate was based on a faulty mental model of where the time was being measured.
