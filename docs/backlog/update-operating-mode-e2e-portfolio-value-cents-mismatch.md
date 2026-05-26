---
id: update-operating-mode-e2e-portfolio-value-cents-mismatch
status: queued
type: bug
rank: 2
notes: "3/3 runs 2026-05-26: update-operating-mode.e2e.test.ts:224 times out waiting for ComplianceCheck row because compliance-ctrl rejects the directly-injected RECOMMENDATION_PROPOSED with `Missing fields: portfolioValueCents`. Test sends `portfolioValue` (line 218); compliance-ctrl expects `portfolioValueCents`. Schema contract mismatch — fix on whichever side has drifted."
references:
  - apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
  - services/advisory/compliance-ctrl/src/handlers/event-listener.ts
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# update-operating-mode e2e: portfolioValue / portfolioValueCents schema mismatch

## Evidence

Surfaced 2026-05-26 during investigation of `update-operating-mode-cdc-silent`. After the dossier's expected failure (carrier-loss at line 182) failed to reproduce in 3/3 runs (observer confirmed both events arrive cleanly), the test consistently fails one step later at line 224:

```
ComplianceCheck row for decisionId=e2e-decision-<ts>-<rand> not found within 120 s
  at waitForComplianceCheck (src/profile/update-operating-mode.e2e.test.ts:93:9)
  at Object.<anonymous> (src/profile/update-operating-mode.e2e.test.ts:224:19)
```

`/aws/lambda/dev-compliance-ctrl-IngressHandler...` logs from the 3 runs (12:39:16, 12:45:06, 12:48:45):

```
{"level":"ERROR","message":"record processing failed",
 "eventType":"RECOMMENDATION_PROPOSED",
 "errorName":"A","errorMessage":"Missing fields: portfolioValueCents",
 "retryable":false}
```

Compliance-ctrl IS receiving the event (so the EB rule is correctly accepting `integration-test:compliance-ctrl` source — verified the rule pattern manually), but rejecting at the application layer because `portfolioValueCents` is absent.

The test publishes (line 218):
```ts
portfolioValue: CAPITAL_AMOUNT,   // 100_000 — units ambiguous (cents? dollars?)
```

The handler expects `portfolioValueCents`. One side has drifted from the contract.

## Cheapest next step

Read `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` validation, find the field name + units it expects, and align the test payload. If compliance-ctrl is the side that recently renamed (likely — units-correction work shipped 2026-05-25 in `e2e-test-tolerance-or-agent-constraint-against-suitability-block`), the test is stale; fix the test. If the test was always correct and compliance-ctrl tightened, decide whether to relax compliance-ctrl or update the test contract.

Also align: `quantityOrAmountCents` on `proposedTrades[]` — the test sends `Math.round((CAPITAL_AMOUNT * TRADE_PERCENT) / 100)` (= 6000, ambiguous units) which is likely the same class of bug.

## Why queued (not parking)

Per `feedback_e2e_gaps_queued_not_parking.md`: anything required to make `apps/e2e-feature-tests` truly green is `status: queued`. This bug is the sole remaining failure mode on `update-operating-mode.e2e.test.ts` after the dossier's carrier-loss bug closed as no-repro.

## Related

- [[update-operating-mode-cdc-silent]] — predecessor workstream. Carrier-loss didn't reproduce; this is the downstream blocker that surfaced instead.
- [[e2e-test-tolerance-or-agent-constraint-against-suitability-block]] — shipped 2026-05-25, fixed AssemblePacket→GuardrailEvaluator units mismatch in production. Likely renamed `portfolioValue` → `portfolioValueCents` somewhere along the chain; the e2e test wasn't updated.
