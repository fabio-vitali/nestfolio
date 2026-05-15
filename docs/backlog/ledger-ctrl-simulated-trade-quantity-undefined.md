---
id: ledger-ctrl-simulated-trade-quantity-undefined
status: shipped
type: bug
notes: "100% failure rate on simulated ORDER_FILLED writes in ledger-ctrl. Root cause: schema mismatch between advisory's DECISION_PACKET_CREATED wire-shape (`proposedTrades[].quantityOrAmountCents`) and ledger-ctrl's `ProposedTrade.quantity` reader. `trade.quantity` is undefined at runtime, DocumentClient marshaller throws. Surfaced 2026-05-15 during Bug 2 investigation."
references:
  - services/ledger/ledger-ctrl/src/handlers/event-listener.ts
  - services/ledger/ledger-ctrl/src/services/shadow-fill.service.ts
  - services/advisory/decision-workflow-ctrl/src
out_of_scope:
  - "Redesigning the quantityOrAmountCents OR-encoded shape into two explicit fields (separate refactor, orthogonal to closing the 100% failure rate)"
  - "Adding a simulated-portfolio e2e assertion (filed separately if needed)"
  - "Touching the actual-stream path (already healthy, distinct code path)"
spec: null
plan: docs/superpowers/plans/2026-05-15-ledger-ctrl-simulated-trade-quantity.md
topic_memory: [project_event_wiring_gaps.md]
validation_gate: "Pre-deploy: 72 `removeUndefinedValues` marshaller errors in the 30-min window before deploy on dev. Post-deploy: 0 marshaller errors in the 5-min window covering a fresh accept-decision e2e run (which PASSED at 128.7s). DDB verification: simulated LedgerEntry rows now carry both `quantity` (derived shares) and `amountCents` (source cents) with the math checking out (BND: 22 cents / $72.30 = 0.00304 shares; EFA: 10 cents / $78.90 = 0.00127 shares). Unit suite: 16 suites / 100 tests all green (was 15/98 baseline + 2 new shadow-fill tests)."
---

# ledger-ctrl simulated ORDER_FILLED — `trade.quantity` undefined

## Resolution (SHIPPED 2026-05-15)

Two-file fix in ledger-ctrl: aligned `ProposedTrade.quantity` → `quantityOrAmountCents` (the canonical wire shape used by 5 other services: `decision-workflow-ctrl/assemble-packet`, `decision-packet.repository`, `compliance-ctrl/rule-engine` + 3 rule modules, and the e2e fixture). Added `derivedQuantity = (amountCents / 100) / fillPrice` to `ShadowFillService.simulateFill`. `processSimulationEvent` now persists both `quantity` (derived shares) and `amountCents` (source cents) on the LedgerEntry payload for audit-trail clarity.

**Validated against deployed dev:** pre-deploy 72 marshaller errors in 30-min window → 0 errors in the 5-min window post-deploy covering a fresh `accept-decision` e2e run. DDB inspection confirms the new payload shape with consistent math (e.g. BND: 22 cents / $72.30 = 0.00304 shares).

**Side-finding (filed separately):** `tsc --noEmit` on `services/ledger/ledger-ctrl/tsconfig.json` surfaces 2 pre-existing latent errors in `repositories/ledger.repository.ts:79,185` (`'timestamp' does not exist in type 'TableEntry'`). Not introduced by this fix; not blocking deploy (esbuild + ts-jest are lenient). Same class as [[investor-bff-13-latent-tsc-errors]] — should be filed as a similar parking item if not already covered.

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
