# dashboard-bff + advisory read-model fixes — design

> Backlog: `docs/backlog/dashboard-advisory-readmodel-fixes.md` (status: active)
> Topic: read-model redesign — BFF-surface residual tail (`project_read_model_redesign`).
> Date: 2026-06-03

## Summary

Four read-model residuals across `dashboard-bff` (Investor, w2), the ledger read
surface (`ledger-bff`), and the advisory decision pipeline (`advisory-bff` +
`decision-workflow-ctrl`, w3), fixed together because they share adjacent surface.
**No new event contracts; no producer behavior change.** All four parts are
read-side / type / dead-code corrections.

This is part of the read-model program's BFF-surface tail. Per the program's
validation-cadence decision (topic dossier, 2026-06-02), the expensive real-LLM
e2e is **not** run per residual workstream — this item is gated on the cheap
gates only (`nx affected -t test,lint`, per-service typecheck,
`event-processor:read-model-drift`, `nx affected -t test-integration` with mocked
agents, + the dev deploy). See [Validation gate](#validation-gate).

## Decisions (settled with the user 2026-06-03)

| # | Decision | Chosen approach |
|---|----------|-----------------|
| A | Suppress `quantity:0` ghost holdings | **Read-side filter `quantity > 0`** (+ one write-side `positionCount` fix). No lib delete-intent. |
| B2 | `lastRecommendationAt` / `lastDecisionStatus` structural zeros | **Drop both fields** from schema + publisher + resolver + MFE. |
| C1 | AdvisoryStatus P3 version source | **Max DynamoDB-stream `SequenceNumber`** of the tenant's records in the batch. |
| D | `'timestamp' does not exist in type TableEntry` (8 errors) | **Add `timestamp?: string` to the shared `TableEntry`** in event-processor. |

## Reframing vs the backlog ticket (verified against code)

The ticket's Part A mechanism is **wrong**, and three other scope points are
off. Corrections folded into this design:

1. **Part A is not a stale orphan.** The ledger reducer (`record-fill.ts:52-63`)
   keeps a fully-sold symbol in the positions map at `quantity:0` (it does *not*
   delete it), and `snapshot-to-events.ts` forwards positions unchanged. So both
   `dashboard-bff/position-snapshot.ts` and `ledger-bff/portfolio-updated.ts`
   faithfully re-write the symbol as a **version-correct `quantity:0` row** — and
   the read resolvers return it unfiltered. The producer "already emits a zeroed
   entry" (the ticket's own suggested fix); the gap is purely downstream display.
2. **Part B1 has TWO dead methods**, not one: `upsertAdvisoryStatus` *and*
   `guardedUpsertAdvisoryStatus` (both in `dashboard.repository.ts`, no `src`
   callers). The ticket names only the first.
3. **Part C4 applies to BOTH** `portfolio-summary.ts` *and* `position-snapshot.ts`
   — both use the `Number(... ?? 0)` no-drop fallback. The ticket wrongly lists
   position-snapshot among the "strict drop" transforms.
4. **Part D's shared fix also clears** `ledger-ctrl-2-latent-tsc-errors` (LATER,
   2 errors, identical root cause). That item will be marked `dropped` with a
   forward-pointer at ship.

There is **no delete/remove `WriteIntent`** in event-processor, and a delete could
not be version-guarded (a late older snapshot would resurrect the row via the
`projectVersioned` guard's `attribute_not_exists(pk)` clause) — which is why
Decision A is read-side, not a new intent.

## Part A — suppress `quantity:0` ghost holdings

Holdings are a presentation concept = `quantity > 0`. The materialized
`quantity:0` rows are *correct* projections ("you hold 0 shares of X") and stay in
the table; we filter them at the read boundary. Same fix on both the Investor
(dashboard) and Ledger holdings surfaces — this resolves the backlog
`out_of_scope` ledger-bff note by construction.

**Read-side filters (`quantity > 0`):**
- `services/investor/dashboard-bff/src/graphql/js-function/get-position-snapshots.fn.js`
  — filter in `response`.
- `services/ledger/ledger-bff/src/graphql/js-function/get-positions.fn.js`
  — filter the **all-positions list** branch only (leave the explicit
  single-symbol `get(symbol)` lookup as-is: asking for a specific exited symbol
  legitimately returns a 0-quantity record).
- `services/ledger/ledger-bff/src/graphql/js-function/get-portfolio.fn.js`
  — filter the `positions` array **before** the `totalValueCents` loop (zeroed
  rows contribute `0`, so totals are unchanged either way; the filter only cleans
  the returned list).

**Write-side count fix:**
- `services/investor/dashboard-bff/src/transforms/portfolio-summary.ts`
  — `positionCount` must count only `quantity > 0`
  (`Object.values(positions).filter(p => (p.quantity ?? 0) > 0).length`),
  otherwise the dashboard position-count KPI over-counts exited symbols.

**Deliberately unchanged (documented):**
- `services/ledger/ledger-bff/src/graphql/js-function/get-performance.fn.js`
  — aggregates only; a zeroed position has `totalCostBasis:0` and `quantity:0`,
  contributing `0` to every aggregate. No correctness impact.

## Part B — AdvisoryStatus dead code + structural-zero fields

**B1 — remove both dead repo methods + their tests:**
- `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts`
  — delete `upsertAdvisoryStatus` (L287) and `guardedUpsertAdvisoryStatus` (L345).
- `services/investor/dashboard-bff/test/unit/repositories/dashboard.repository.test.ts`
  — delete the `upsertAdvisoryStatus` describe block (L207-235).
  `guardedUpsertAdvisoryStatus` has no tests.

**B2 — drop `lastRecommendationAt` + `lastDecisionStatus`** (never written by any
producer; the P3 projection only writes `pendingDecisionsCount`). Remove from:
- `services/investor/dashboard-bff/src/schema.graphql` — both type sites (L31-32,
  L78-79).
- `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` — the
  subscription selection (L13-14), the `whenChanged` array (L51), and the
  broadcast payload (L58-59).
- `services/investor/dashboard-bff/src/graphql/js-function/get-dashboard.fn.js`
  (L32-33).
- `apps/dashboard-mfe/src/app/stores/dashboard.store.ts` (L40-41),
  `apps/dashboard-mfe/src/app/dashboard/advisory-alert-bar.component.ts` (the
  `@if (advisoryStatus?.lastDecisionStatus)` block, L19-21, + its `i18n`
  `dashboard.advisory.lastStatus` key), and
  `apps/dashboard-mfe/src/app/graphql/dashboard-bff.queries.ts` (L39-40).
- Test fixtures: `dashboard-publisher.test.ts` (L47-95 reference the fields),
  `apps/dashboard-mfe/test/.../dashboard.store.spec.ts` (L33-34),
  `advisory-alert-bar.component.spec.ts` (L28-29).

The alert bar keeps the pending-decisions count.

**B3 — no-op.** Only `dashboard-bff/CLAUDE.md` references `MANDATE_ISSUED` (a
documentation note); the Ingress is already clean.

## Part C — w3 versioned-packet hardening nits

**C1 — monotonic AdvisoryStatus version.**
`services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts` — while
iterating stream records, track the **max `rec.dynamodb.SequenceNumber`** per
tenant (replace the `Set<tenantId>` with a `Map<tenantId, maxSeq>`); use
`Number(maxSeq)` as the version instead of `Date.now()`. SequenceNumbers are
strictly increasing within a shard and a tenant's rows share a `pk` → same shard,
so this is strictly monotonic across invocations. *Caveat (documented in code):*
SequenceNumbers exceed `2^53`, so `Number()` is lossy in the low digits; this is
acceptable because distinct invocations are temporally separated enough that their
max SequenceNumbers differ well above the precision floor — strictly better than
the `Date.now()` same-ms collision it replaces.

**C2 — drop terminal `taskToken`.**
`services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts` — the
USER_RESPONSE handler (terminal CONFIRMED/REJECTED) must add `removes:
['taskToken']` to its `update('DecisionPacket', …)` options. (Scope is correct as
CONFIRMED/REJECTED only: the L2 `waitForTaskToken` SF state writes the token,
these handlers consume it; the compliance L1/BLOCKED path is pre-token.) Confirm
`update`'s options type supports `removes` during planning.

**C3 — narrow `WorkflowStatus`.**
`services/advisory/decision-workflow-ctrl/src/domain/models.ts` — narrow the union
to the 6 reachable values: `PENDING | AWAITING_CONFIRMATION | APPROVED | BLOCKED |
CONFIRMED | REJECTED`. Confirm during planning that no code constructs the removed
members (`INITIATED`/`PROFILING`/`CONSTRUCTING`/`NARRATING`/`PROPOSED`/
`COMPLIANCE_REVIEW`/`FAILED`).

**C4 — align to strict drop-on-absent.** Both
`services/investor/dashboard-bff/src/transforms/portfolio-summary.ts` and
`.../position-snapshot.ts` — replace `Number(... ?? 0)` with the strict guard
(`const v = snapshot?.lastEventSequence; if (typeof v !== 'number') return …`),
matching `investor-snapshot.ts` / `time-travel-availability.ts`. portfolio-summary
returns `undefined`; position-snapshot returns `[]`.

## Part D — clean typecheck via dropping redundant `TableEntry` annotations (D3)

**Revised during implementation (2026-06-03).** The original plan added
`timestamp?: string` to the shared `TableEntry`, on the premise that `timestamp`
was the only missing field. That premise was wrong: `TS2353` reports only the
*first* excess property per literal, so adding `timestamp` merely unmasked the
next ones (`decisionId`, `streamType`, `status`, …). These repos write several
domain fields **directly** onto a bare-`TableEntry`-annotated literal, and
crucially `TableRepository.put()` / `putIfNotExists()` take
`Record<string, unknown>` — so the `const item: TableEntry = {…}` annotation is
**not load-bearing**; it exists only to trip the excess-property check.

**Chosen approach (user, 2026-06-03): D3 — drop the redundant annotations.**
Remove `: TableEntry` from the 6 `advisory-bff/advisory.repository.ts` literals
and the 2 `ledger-ctrl/ledger.repository.ts` literals (plus the now-unused
`TableEntry` imports). No shared-lib change; the `put(Record<string,unknown>)`
contract already implies it; type rigor preserved everywhere else.

Result: advisory-bff full-spec tsc 6→0, ledger-ctrl 2→0. Then:
- Repoint `services/advisory/advisory-bff`'s `typecheck` nx target from the
  isolated `tsconfig.type-test.json` (WS-A workaround) to the full
  `tsconfig.spec.json` for a genuinely clean service-wide typecheck.
- At ship: mark `docs/backlog/ledger-ctrl-2-latent-tsc-errors.md` `dropped` with a
  forward-pointer to this workstream's validation_gate (resolved by construction).

## Testing

- **Unit:** update `position-snapshot.test.ts` (strict-drop + zero-row behavior),
  `portfolio-summary.test.ts` (`positionCount` excludes zero), the
  advisory-status-projector test (version = max SequenceNumber), `sfn-callback`
  test (taskToken removal on CONFIRMED/REJECTED). Remove the deleted-method and
  dropped-field tests. Add a **regression test** asserting the read resolvers /
  count exclude `quantity:0` (per [[feedback-regression-tests]]).
- **Integration:** the `.fn.js` resolver + schema changes are exercised by the
  dashboard-bff and ledger-bff integration suites (mocked agents).
- **Type:** `event-processor:typecheck`, `event-processor:read-model-drift`
  (expect 0 new drift — no projection-shape change), and the repointed
  advisory-bff `typecheck`.

## Validation gate

Cheap gates only (program cadence — real-LLM e2e deferred to program end):
1. `pnpm nx affected -t test,lint --base=origin/main`
2. Per-service `typecheck`: dashboard-bff, advisory-bff, decision-workflow-ctrl,
   event-processor, ledger-bff, ledger-ctrl.
3. `pnpm nx run event-processor:read-model-drift` → 0 drift.
4. `pnpm nx affected -t test-integration --base=origin/main` (mocked agents).
5. Dev deploy of the behavior-affecting services: **dashboard-bff, ledger-bff,
   advisory-bff, decision-workflow-ctrl** (schema/resolver/handler changes).
   event-processor + ledger-ctrl are type-only (esbuild strips types) — recompiled
   by `nx affected` but no runtime change.

## Out of scope

- The ledger-bff Position orphan is **resolved here** (Part A covers both
  surfaces), superseding the backlog `out_of_scope` deferral.
- No new event contracts, no producer (reducer / snapshot-to-events) change.
- A periodic reconcile/prune of long-`quantity:0` rows (storage hygiene) — not
  needed; rows are bounded by distinct symbols ever traded and are read-filtered.
