---
date: 2026-05-11
topic: integration-suite-lever-1
status: design
workstream: integration-suite-slowness-architecture-levers
---

# Integration suite slowness — Lever 1: predicate primitive + sweep + timeout tightenings

## Context

Dossier at `docs/backlog/integration-suite-slowness-architecture-levers.md` enumerates five distinct levers behind the integration-suite wall-clock (54 m 53 s on the 2026-05-11 baseline). Lever 1 — the absence of a "wait for predicate" primitive in test-support — is the most reusable structural change and is independent of the post-rank-1–6 re-measurement. This spec covers Lever 1 only. Levers 2–5 stay queued as separate workstreams (see § Out of scope).

The dossier's premise is partly stale: `libs/integration-testing/src/fixtures/table-assertions.ts:42` already exposes `match: Record<string, unknown>` for equality. The advisory-bff inline comment "*waitForItem only checks existence, not value*" (`services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts:112`) is incorrect. The actual gap is (a) richer-than-equality predicates ("status in {APPROVED, REJECTED}", "proposedTrades.length > 0") and (b) call-site adoption of either the existing `match:` or the new predicate.

## Goals

1. Extend `waitForItem` with a `predicate` escape hatch for non-equality wait conditions.
2. Lower the default poll cadence from 2 s to 500 ms so synchronous handler writes are detected in ~500 ms instead of ~2 s.
3. Sweep every hand-rolled `while…Date.now…waitForItem` pattern in the repo to a single `waitForItem` call.
4. Apply the three timeout tightenings the dossier explicitly gated on ranks 1–6 closure.
5. Validate via a measured wall-clock delta of `pnpm nx run-many -t test-integration --parallel=2` against a same-session pre-baseline.

## Non-goals (out of scope)

- Lever 2 (adapter Lambda cold-start warmup).
- Lever 3 (`ledger-ctrl` resilience `it.each` consolidation).
- Lever 4 (`--parallel=4`).
- Lever 5 (CDK bundling tax in the unit suite).
- New primitives beyond predicate: no `waitForItemMatching`, no async predicates, no cross-resource waits. Flagged for follow-up if a real need surfaces.
- Behavior changes to production code (handlers, transforms, infra, schemas).
- A re-measure-only PR. Measurement is the validation gate of this PR, not its own workstream.

## Architecture

Three change zones, all under `libs/` and `services/*/test/integration/`. No infrastructure or production-handler changes.

### 1. Primitive — `TableAssertions.waitForItem`

File: `libs/integration-testing/src/fixtures/table-assertions.ts:42`.

Add two optional params to the existing signature:

```ts
async waitForItem(params: {
  table: string;
  pk: string;
  sk?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  match?: Record<string, unknown>;
  predicate?: (item: Record<string, unknown>) => boolean;   // NEW
  description?: string;                                      // NEW — labels predicate in error
}): Promise<Record<string, unknown>>;
```

Inner loop semantics:

1. Fetch item (`GetItem` if `sk` given, else `Query` with `Limit: 1`).
2. If item missing → sleep `pollIntervalMs`, retry.
3. If item present:
   - If `match` given and any key mismatches → sleep, retry (existing behavior).
   - If `predicate` given and returns false → sleep, retry.
   - If both pass (AND) → return item.
4. On deadline: throw including last-observed item and predicate description.

Error message format:

```
TableAssertions: timeout waiting for item pk=<pk> sk=<sk> match=<json>
  predicate=<description or "(unlabeled)">
  in <table> after <timeoutMs>ms.
  Last item: <json or "(never observed)">
```

Predicate signature is **sync only**. Async predicates are explicitly out of scope (see Non-goals).

### 2. Default poll cadence

File: `libs/test-support/src/context.ts:31`. Change:

```ts
pollInterval: overrides?.pollInterval ?? 2_000,
```

to

```ts
pollInterval: overrides?.pollInterval ?? 500,
```

Global default change. Every integration test inherits it; call sites that have already passed `pollIntervalMs` explicitly are unaffected. Per-test overrides (`createTestContext({ pollInterval: 2000 })`) remain available if a specific suite hits DDB throttling.

### 3. Sweep — replace hand-rolled poll loops

Target files (identified by `grep -rln "while.*Date\.now\|while.*deadline"`):

- `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts` (~21 sites)
- `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.integration.test.ts`
- `services/advisory/compliance-ctrl/test/integration/compliance-ctrl.resilience.integration.test.ts`
- `services/advisory/decision-workflow-ctrl/test/integration/decision-workflow-ctrl.integration.test.ts`
- `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`
- `services/investor/investor-bff/test/integration/investor-bff.integration.test.ts`
- `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.integration.test.ts`
- `services/ledger/ledger-ctrl/test/integration/ledger-ctrl.resilience.integration.test.ts`

For each call site, classify:

- **Equality predicate** (e.g. `item.status === 'APPROVED'`) → migrate to existing `match: { status: 'APPROVED' }`.
- **Richer predicate** (set membership, array length, numeric range, etc.) → migrate to `predicate: (i) => …, description: '…'`.
- **Multi-field equality** → pass all fields in `match:`; if any non-equality is mixed in, use `predicate`.

The outer `while…Date.now()` loop disappears entirely; the inner `waitForItem` call with 5 s timeout collapses into a single call with the full outer timeout.

### 4. Tighten-timeouts (three bisectable commits)

Per the dossier's bottom table, gated explicitly on ranks 1–6 closure (now closed).

| File / call site (located during execution) | Current | New | Rationale |
| --- | --- | --- | --- |
| `EventBusTrap` 90 s wait for `NOTIFICATION_CREATED` (rank-6 tests) | 90 s | 30 s | Real CDC converges in 5–15 s |
| advisory-bff outer `waitForItem` defaults | 60 s | 30 s | Observed convergence ≤ 22 s on cold start |
| agent-ctrl `waitForItem` (DDB write synchronous in handler) | 60 s | 20 s | Once event reaches Lambda, row is there |

The dossier's fourth row (inner-poll 5 s → 1 s) collapses into the sweep — once predicate-wait absorbs the outer loop, the inner 5 s value is unused.

Each tightening is its own commit inside the PR so a single revert restores the looser bound.

## Testing strategy

### Unit (new)

Add `libs/integration-testing/test/fixtures/table-assertions.test.ts` (or extend existing) covering:

1. Predicate-only — passes when predicate returns true; throws on timeout including last-observed item.
2. `match` + `predicate` — both must pass (AND); failure in either triggers retry.
3. `description` appears in timeout error.
4. Sync predicate exceptions surface immediately (not swallowed).
5. `pollIntervalMs` honored when caller overrides.

Mock the DDB client via the existing test pattern in the file (see siblings for the established harness).

### Validation gate (the wall-clock delta)

Procedure documented in the implementation plan:

1. **Pre-baseline** (same session, same dev account): `time pnpm nx run-many -t test-integration --parallel=2 2>&1 | tee /tmp/integ-pre-lever-1.log` BEFORE any changes land on the working branch.
2. Implement Lever 1 (primitive, default change, sweep, three tightenings).
3. **Post-baseline**: same command, save to `/tmp/integ-post-lever-1.log`.
4. Report per-suite delta for `advisory-bff`, `ledger-ctrl`, `compliance-ctrl`, `decision-workflow-ctrl`, `dashboard-bff`, `investor-bff` in the workstream's validation gate.
5. Aggregate wall-clock delta + count of suites that improved / regressed / unchanged.

Validation gate criteria for "shipped":

- Aggregate wall-clock improves by ≥ 60 s (sub-scaled dossier estimate of 110 s, conservatively halved).
- No individual suite wall-clock regresses by > 5 s vs pre-baseline.
- All previously passing tests still pass; no new flakes across two consecutive `pnpm nx run-many -t test-integration --parallel=2` runs.

## Risks

- **DDB throttling at 500 ms cadence.** Dev tables are on-demand; sustained 4× call rate is well within burst limits, but a single suite running tight loops could surface throttling. Mitigation: per-test override `createTestContext({ pollInterval: 2000 })` if a specific suite hits it.
- **Tighter timeouts mask intermittent CDC slowness.** The three tightenings were dossier-gated on rank-6 closure (now closed), but real-world EB latency variance can spike. Mitigation: bisectable per-commit tightening so a single `git revert` restores the looser bound for the affected file.
- **Predicate exceptions vs. retries.** A predicate that throws (e.g. accessing `.length` of undefined) surfaces immediately rather than retrying — by design, since a thrown predicate is a programmer error, not a "not yet" signal. Sweep migration must be careful with optional chaining where the field may not have materialized yet.
- **Sweep size.** 8 files, ~25–30 call sites. Mechanical but non-trivial. Implementation plan will batch by file (one commit per file) so reviewer can read diffs in isolation.

## Validation gate (final)

- Unit tests for the new primitive paths green.
- `pnpm nx run-many -t test-integration --parallel=2` green for two consecutive runs.
- Wall-clock delta documented in the workstream's shipping note, with per-suite breakdown.
- `docs/backlog/integration-suite-slowness-architecture-levers.md` updated: status shipped, validation_gate captures the wall-clock numbers.
- On ship: refile Levers 2–5 as new queued backlog entries (one per lever, via `backlog-add`) so each gets its own rank, design, and ship cycle. The original dossier file remains shipped as the diagnostic source.
