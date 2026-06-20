---
id: advisory-market-data-adapters-fetch-cdc-empty-buffer
status: active
type: bug
rank: 3
notes: "Surfaced 2026-06-19 by the typed-test-fixtures consolidated integration verify. The advisory market-data adapter integration suites (alpha-vantage-adpt, fred-adpt, sec-edgar-adpt, yahoo-finance-adpt, marketwatch-adpt) fail their FETCH_*_REQUESTED → <PROVIDER>_UPDATED CDC-chain tests with EventBusTrap 'timeout … Captured-but-unmatched buffer: []' (empty buffer). Reproduces SERIALLY (parallel=1), so it is NOT parallel/trap contention. ZERO ZodErrors — NOT a typed-fixture regression (these suites' fixtures were already typed in Phase 2). CloudWatch on fred-adpt during the serial re-run: the FetchTrigger handler log group (dev-fred-adpt-FetchTriggerLogGroup…) had 0 invocations in-window, while its IngressHandler (112) + EgressPublisher (14) were active — i.e. the injected FETCH_FRED_REQUESTED is not triggering the fetch handler, so no provider row is written and no *_UPDATED CDC fires. Other advisory services in the same window PASSED (advisory-bff 10/10, compliance-ctrl 15/15, market-intelligence-ctrl 5/5), so the dev env is delivering CDC generally — this is specific to the market-data adapters' FETCH path. Two adjacent advisory agent-CDC failures observed the same window (advisory-narrative-ctrl NARRATIVE_FAILED trap matched 2 events not 1 — predicate/trap-pollution; portfolio-engine-ctrl PORTFOLIO_COMPLETED empty buffer) likely share the env-window cause. Need: per-adapter CloudWatch on the FetchTrigger invocation to settle env-delivery-degraded vs a real FETCH_* routing/wiring gap. PROMOTED to QUEUED 2026-06-19 (rank 3): the typed-test-fixtures consolidated verify re-scoped/closed on the fixtures-criterion and handed its market-data full-green residual here. A dedicated 2026-06-19 re-probe reproduced ALL 5 *_UPDATED CDC empty-buffer failures (100% across 5 services, 2 runs same day = consistent, NOT a flake per feedback-flake-means-broken); DDB-write tests pass while *_UPDATED never emits → likely a real CDC/FETCH wiring gap, so 'wait for a healthy env window' is the wrong framing. This needs investigation/fix, not waiting."
references:
  - docs/backlog/typed-test-fixtures-consolidated-integration-e2e-verify.md
out_of_scope:
  - "The SYSTEM-tenant CDC source-tagging leak: changeDataCapture keys isTestTenant on tenantId.startsWith('integ-'), so global-aggregate test events (tenantId='SYSTEM') emit with the PRODUCTION source (bus@svc) instead of integration-test:svc, leaking test events to within-advisory production consumers (likely behind the adjacent AN-ctrl/PE-ctrl trap anomalies). Architecturally harder (SYSTEM is test/prod-indistinguishable at the CDC layer) and affects OTHER services' tests, not these 5 — filed separately."
  - "The adjacent advisory agent-CDC failures (advisory-narrative-ctrl NARRATIVE_FAILED trap matched 2 events; portfolio-engine-ctrl PORTFOLIO_COMPLETED empty buffer) — separate items, not the market-data trap-tenant bug."
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Advisory market-data adapter FETCH→*_UPDATED integration tests: empty-buffer CDC timeout on dev

Surfaced by the typed-test-fixtures consolidated verify (2026-06-19) while running the advisory
integration batch against deployed dev.

## Symptom
The 5 market-data adapter suites time out waiting for their CDC output event with an **empty**
EventBusTrap buffer:
- `alpha-vantage-adpt` → `ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED` / `ALPHA_VANTAGE_NEWS_UPDATED`
- `fred-adpt` → `FRED_INDICATORS_UPDATED`
- `sec-edgar-adpt` → `SEC_10K_UPDATED` / `SEC_8K_FILED` / `SEC_PROSPECTUS_UPDATED`
- `yahoo-finance-adpt` → `YAHOO_FINANCE_UPDATED`
- `marketwatch-adpt` → `MARKETWATCH_UPDATED`

Reproduces at `--parallel=1` (serial), so not contention.

## Diagnostic (fred-adpt, serial re-run window)
- `dev-fred-adpt-FetchTriggerLogGroup…`: **0** invocations — the injected `FETCH_FRED_REQUESTED`
  did not trigger the fetch handler.
- `dev-fred-adpt-IngressHandlerLogGroup…`: 112 events; `EgressPublisherLogGroup…`: 14 — the service
  is otherwise active.
- Other advisory services passed in the same window → env delivers CDC generally; the gap is the
  market-data FETCH path specifically.

## Not a typed-fixture regression
Zero ZodErrors across the whole advisory batch. These suites' fixtures were typed in Phase 2 and
are unaffected by the ORDER_* migration.

## 2026-06-19 re-probe (dedicated, `--skip-nx-cache`)

Re-ran the 5 suites against deployed dev to settle env-vs-wiring:
- **All 5** `*_UPDATED`/CDC-emission tests timed out empty-buffer again (alpha-vantage news + econ,
  fred indicators, sec-edgar 8K/prospectus/10K, yahoo, marketwatch) — runtimes 162–405s.
- Every **DDB-write** test PASSED (marketwatch 2/2, yahoo 2/2, fred 1) — writes work; only the
  `*_UPDATED` CDC emission/delivery fails.
- **ZERO ZodError** across all 5 → not a fixture regression.

100% failure across 5 services over 2 same-day runs ⇒ **consistent, not a transient window**. Combined
with the fred FetchTrigger-0-invocations diagnostic, this reads as a real CDC/FETCH wiring gap.

## Next step
CloudWatch the FetchTrigger invocation per adapter (and the DynamoDB-Stream→EventBridge egress for the
`*_UPDATED` events) to localise whether `FETCH_*_REQUESTED` is being routed to the fetch handler and
whether the provider-row CDC is configured to emit `*_UPDATED`. Treat as a real wiring bug, not an env
flake. Was the last full-green blocker handed off from the (now-closed, re-scoped) consolidated verify.
