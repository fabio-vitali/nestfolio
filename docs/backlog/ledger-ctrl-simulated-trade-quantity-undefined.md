---
id: ledger-ctrl-simulated-trade-quantity-undefined
status: parking
type: bug
notes: "100% failure rate on simulated ORDER_FILLED writes in ledger-ctrl. Root cause: schema mismatch between advisory's DECISION_PACKET_CREATED wire-shape (`proposedTrades[].quantityOrAmountCents`) and ledger-ctrl's `ProposedTrade.quantity` reader. `trade.quantity` is undefined at runtime, DocumentClient marshaller throws. Surfaced 2026-05-15 during Bug 2 investigation."
references:
  - services/ledger/ledger-ctrl/src/handlers/event-listener.ts
  - services/ledger/ledger-ctrl/src/services/shadow-fill.service.ts
  - services/advisory/decision-workflow-ctrl/src
spec: null
plan: null
topic_memory: [project_event_wiring_gaps.md]
validation_gate: null
---

# ledger-ctrl simulated ORDER_FILLED — `trade.quantity` undefined

## What surfaced

During investigation of [[accept-decision-e2e-getportfolio-empty-flake]] (2026-05-15), CloudWatch showed **100% failure rate** on simulated writes through `dev-ledger-ctrl-IngressHandler`:

| streamType | total writes | failed | rate |
|---|---|---|---|
| `actual` (test `quantity: 10`) | 26 | 1 | 3.8% |
| `simulated` (advisory DECISION_PACKET_CREATED → shadow fill) | 279 | 279 | 100% |

Error every simulated call:
```
Pass options.removeUndefinedValues=true to remove undefined values from map/array/set.
  at convertToAttr (.../util-dynamodb/dist-cjs/index.js:101:11)
  at marshall  (.../util-dynamodb/dist-cjs/index.js:313:26)
  at marshallFunc (.../lib-dynamodb/dist-cjs/index.js:131:97)
```

Confirmed STILL PRESENT post-redeploy on 2026-05-15 — same error pattern on `DECISION_PACKET_CREATED` events (`retryable: true`, so silent failures).

## Root cause (deeper than the surface "missing removeUndefinedValues")

The dossier of the parent workstream initially framed this as a missing `marshallOptions.removeUndefinedValues: true` on the DDB client. That would only suppress the exception — the row would still persist with `quantity: undefined`, which is useless.

The actual root cause is a **schema mismatch**:

- Advisory emits `DECISION_PACKET_CREATED` with `proposedTrades[].quantityOrAmountCents` (verified in `apps/e2e-feature-tests` `withDecision()` fixture and compliance-ctrl rule tests).
- `services/ledger/ledger-ctrl/src/handlers/event-listener.ts:76` reads `(subject['proposedTrades'] ?? []) as ProposedTrade[]` — typecast hides the runtime divergence.
- `services/ledger/ledger-ctrl/src/services/shadow-fill.service.ts:8` defines `ProposedTrade.quantity: number`.
- `event-listener.ts:97` writes `quantity: trade.quantity` → undefined → marshaller throws.

## Why this doesn't affect scenario 6 (accept-decision)

Scenario 6 publishes an `actual`-stream ORDER_FILLED directly to the ledger bus with a literal `quantity: 10`. The `processActualEvent` path succeeds. The simulation path (`processSimulationEvent`) failing is invisible to scenario 6's assertions (only `getPortfolio` actuals).

It IS visible to anything that compares actual vs simulated portfolios — e.g., the `getSimulationComparison` Lambda resolver, scenario 14 patterns, etc.

## Cheapest fix path (when promoted)

Decide the canonical wire shape:
1. **If `quantityOrAmountCents` is the canonical event field**: rename `ProposedTrade.quantity` → `quantityOrAmountCents` in ledger-ctrl's shadow-fill service and event listener; handle the cents/quantity dimension semantically.
2. **If `quantity` is canonical and advisory is wrong**: fix advisory's emission to use `quantity`; update all consumers (compliance-ctrl rule engine + ledger-ctrl + decision-packet repo + e2e fixtures).

Option 1 is the more honest fix because `quantityOrAmountCents` is already established in 3+ services (compliance-ctrl, e2e fixtures, decision-packet repo). Option 2 would be a wider blast radius.

Add a domain test that publishes a real DECISION_PACKET_CREATED shape and asserts the shadow-fill output is non-degenerate.

## Why parking and not queued

The dossier ranks the parent (accept-decision-e2e-getportfolio-empty-flake) as the e2e-blocker — and the redeploy alone closed that. This bug affects only simulated paths, which no e2e currently asserts on (see `feedback_e2e_gaps_queued_not_parking`: e2e-blocking → queued; non-e2e-blocking latent bugs → parking).

Promote to queued when:
- A new e2e adds simulated-portfolio assertions (scenario for `getSimulationComparison`), OR
- The unreliable shadow-fill data starts producing user-visible artifacts (advisory narratives quoting bogus simulated returns).

## Related

- [[accept-decision-e2e-getportfolio-empty-flake]] — surfaced this during Bug 2 investigation, 2026-05-15.
- Topic memory: [project_event_wiring_gaps](../../memory/project_event_wiring_gaps.md).
