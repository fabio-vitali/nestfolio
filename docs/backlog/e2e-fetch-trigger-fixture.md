---
id: e2e-fetch-trigger-fixture
status: dropped
type: tooling
notes: "Dropped 2026-05-17 — premature abstraction. Publishing FETCH_REQUESTED is a 6-line inline PutEvents call using the existing EventBridgeClient; each adapter's payload differs (FRED series vs AV symbols vs SEC CIKs vs ticker arrays), so any generic helper degenerates to Record<string, unknown>. Rule-of-three not met (zero callers). When a fresh-feed-data scenario gets written, the author inlines putEvent."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# E2E fetch-trigger fixture for the 5 feed-hook adapters

## Problem

All 5 feed-hook adapter `FetchSchedule`s are deployed `DISABLED` in dev (zero cost), and e2e doesn't mock externals (see `feedback_e2e_no_external_mocks`). Today the adapters' DDB state is therefore empty in dev — any future e2e scenario whose agents depend on fresh FRED indicators, Alpha Vantage news / fundamentals, MarketWatch headlines, SEC EDGAR filings, or Yahoo Finance quotes runs against agents with no context to reason over.

Verified via `aws scheduler list-schedules`:

```
dev-fred-adpt-FetchSchedule           DISABLED
dev-marketwatch-adpt-FetchSchedule    DISABLED
dev-sec-edgar-adpt-FetchSchedule      DISABLED
dev-alpha-vantage-adpt-FetchSchedule  DISABLED
dev-yahoo-finance-adpt-FetchSchedule  DISABLED
```

Zero invocations on the corresponding `FetchTrigger` Lambdas over the past 7 days.

## Architecture handle

Each adapter stack uses the same shape (verified `fred-adpt/src/service.stack.ts:79`, `alpha-vantage-adpt/src/service.stack.ts:84`):

```
EB Scheduler → FetchTrigger Lambda → publishes FETCH_REQUESTED to advisory bus
                                       ↓
                            Ingress handler → external API → DDB
                                       ↓
                            Egress (CDC) → *_UPDATED events
```

The schedule is just a clock that emits `FETCH_REQUESTED`. A fixture replaces the clock with one `PutEvents` call. The downstream path (real external API, real DDB write, real CDC, real *_UPDATED event) is identical to production.

## Existing pattern to extend

Both e2e apps already publish synthetic trigger events through `integration-test:<consumer>`:

- `@nestfolio/test-support` exports `EventBridgeClient.putEvent()` (`libs/test-support/src/fixtures/event-bridge-client.ts:5`).
- `apps/e2e-feature-tests` uses it in `accept-decision`, `rebalance-on-drift`, `operating-mode-authority`, `reconciliation-correction`, `withdraw-cash`, `update-operating-mode`.
- `apps/nestfolio-e2e` has `src/fixtures/inject-advisory-update.ts` with three `inject*TriggerEvent` helpers using `@aws-sdk/client-eventbridge` directly (not the test-support wrapper).

## Proposed work

1. Add `triggerFetch(ctx, adapter, opts?)` to `@nestfolio/test-support` so both Jest e2e and Playwright e2e share it.
2. Use `integration-test:<adapter>` as the event source so each adapter's own `Ingress` `$or` filter passes it. Verify the rule shape against one adapter before generalizing.
3. Resolve `FETCH_REQUESTED` detail-type per adapter from the existing `*AdptEventTypes` exports — no string literals in the helper.
4. Return a promise that resolves on the corresponding `*_UPDATED` egress event (or after a caller-tunable wait) so tests can `await triggerFetch(...)` and then assert against agent output.
5. Convert `nestfolio-e2e`'s `inject-advisory-update.ts` helpers to use the same `EventBridgeClient` wrapper at the same time — currently the Playwright app duplicates the SDK plumbing.

## Out of scope

(none — this is a tooling-only addition, no schedule changes, no adapter changes)

## Notes

- This is NOT about enabling the schedules in dev. They stay disabled. The fixture replaces the schedule for test purposes only.
- Real external APIs (FRED, Alpha Vantage, etc.) get called. Real API keys (already in dev SSM) get used. Real rate limits apply — the helper should rate-limit/cache per test session if needed.
- Existing scenarios don't depend on this; it unblocks new agent-with-fresh-info scenarios.
