---
id: accept-decision-e2e-getportfolio-empty-flake
status: parking
type: bug
notes: "accept-decision.e2e scenario 6: full-suite run 2026-05-15 timed out waiting for ledger-bff getPortfolio to surface VTI position (705s overall, last result empty); isolated rerun PASSED in 110s — flake on the ORDER_FILLED → ledger-ctrl Reducer → ledger-bff path."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_e2e_feature_tests.md]
validation_gate: null
---

# accept-decision e2e flake — getPortfolio empty after 120s

## Evidence

`apps/e2e-feature-tests/src/advisory/accept-decision.e2e.test.ts` scenario 6 "investor accepts decision and sees it executed".

Full-suite run 2026-05-15 (NESTFOLIO_INTEG_PREFIX=dev, --runInBand) — **FAIL** after 705.038s:

```
waitForGraphQL timed out after 120000ms. Last result:
  {"getPortfolio":{"cashBalanceCents":0,"positions":[],"totalValueCents":0}}
  at src/advisory/accept-decision.e2e.test.ts:95:23
```

The assertion expects `getPortfolio.positions` to contain `{ symbol: 'VTI', quantity: > 0 }` after the test publishes `ORDER_FILLED` directly on the ledger bus. The position never appeared within the 120s wait.

Isolated rerun against the same dev account a few minutes later — **PASS in 109.989s**. Same code, same deploy, opposite result → flake.

## What was running

- Ledger Lambdas (`dev-ledger-{ctrl,bff}-*`) last deployed 2026-04-25 — untouched by today's advisory-side work; not deploy-skew.
- Path under test (the test bypasses the broker, publishes ORDER_FILLED directly to ledger):
  ```
  EB(ledger bus) → ledger-ctrl IngressHandler (SQS → Lambda)
    → record OrderFill in DDB
    → CDC → ledger-ctrl ReducerFn (DynamoDB Stream → Lambda)
    → portfolio projection row update
    → CDC → ledger-bff IngressHandler
    → ledger-bff DecisionReadModel row
    → ledger-bff GraphQL getPortfolio (AppSync resolver)
  ```
- 6 hops, each with its own propagation window. 120s is normally generous.

## Hypothesis (priority order)

1. **Ledger CDC stream lag spike.** DDB streams batch processing can stall under high concurrent activity. The flaky run was inside a 33-test --runInBand suite that ran for 30 minutes total — neighbouring tests may have warmed/hot-spotted the ledger stream consumer. The isolated rerun had no neighbours.
2. **Ledger-bff IngressHandler cold start** under the same suite-wide pressure — but a single cold start is ~200-1500ms per `feedback_node_lambda_cold_starts`, nowhere near 120s on its own.
3. **Test fixture / waitForGraphQL polling interval** — default polling vs. CDC arrival timing; not a real bug, but the gate is too tight relative to the worst-case end-to-end ledger lag.

## Cheapest next step (when this resurfaces)

Pull CloudWatch logs for the failing test's tenant ID — search for that tenant in `/aws/lambda/dev-ledger-ctrl-ReducerFn*` to confirm whether the Reducer fired at all on the ORDER_FILLED, and how long after putEvent it landed. If Reducer fired but ledger-bff projection lagged, scope is the BFF side; if Reducer never fired, scope is upstream.

Promote to QUEUED only on second sighting — single-occurrence flake doesn't justify pivoting.

## Related

- Topic memory: [project_e2e_feature_tests](../../memory/project_e2e_feature_tests.md) — scenario 6 baseline is GREEN.
- Suite context: e2e gate 32/33 GREEN on 2026-05-15 (this was the lone failure); originally part of a 4-failure run that was diagnosed + fixed by [[e2e-advisory-pipeline-empty-outputs-post-phase-b]].
