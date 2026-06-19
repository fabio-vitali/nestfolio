---
id: advisory-market-data-adapters-fetch-cdc-empty-buffer
status: parking
type: bug
rank: null
notes: "Surfaced 2026-06-19 by the typed-test-fixtures consolidated integration verify. The advisory market-data adapter integration suites (alpha-vantage-adpt, fred-adpt, sec-edgar-adpt, yahoo-finance-adpt, marketwatch-adpt) fail their FETCH_*_REQUESTED → <PROVIDER>_UPDATED CDC-chain tests with EventBusTrap 'timeout … Captured-but-unmatched buffer: []' (empty buffer). Reproduces SERIALLY (parallel=1), so it is NOT parallel/trap contention. ZERO ZodErrors — NOT a typed-fixture regression (these suites' fixtures were already typed in Phase 2). CloudWatch on fred-adpt during the serial re-run: the FetchTrigger handler log group (dev-fred-adpt-FetchTriggerLogGroup…) had 0 invocations in-window, while its IngressHandler (112) + EgressPublisher (14) were active — i.e. the injected FETCH_FRED_REQUESTED is not triggering the fetch handler, so no provider row is written and no *_UPDATED CDC fires. Other advisory services in the same window PASSED (advisory-bff 10/10, compliance-ctrl 15/15, market-intelligence-ctrl 5/5), so the dev env is delivering CDC generally — this is specific to the market-data adapters' FETCH path. Two adjacent advisory agent-CDC failures observed the same window (advisory-narrative-ctrl NARRATIVE_FAILED trap matched 2 events not 1 — predicate/trap-pollution; portfolio-engine-ctrl PORTFOLIO_COMPLETED empty buffer) likely share the env-window cause. Need: a healthy-window re-run + per-adapter CloudWatch on the FetchTrigger invocation to settle env-delivery-degraded vs a real FETCH_* routing/wiring gap. Litmus (e2e-gaps-queued rule): these are INTEGRATION tests, not e2e-blocking → parking."
references:
  - docs/backlog/typed-test-fixtures-consolidated-integration-e2e-verify.md
out_of_scope: []
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

## Next step
Re-run in a genuinely healthy dev-env window; if still empty-buffer, CloudWatch the FetchTrigger
invocation per adapter to determine whether `FETCH_*_REQUESTED` is being routed/delivered (real
wiring gap) or the env is dropping it (flake). Gates part of the consolidated verify's "all green".
