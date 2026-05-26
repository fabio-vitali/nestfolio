---
id: update-operating-mode-e2e-portfolio-value-cents-mismatch
status: shipped
type: bug
notes: "SHIPPED 2026-05-26: schema-field rename `portfolioValue` → `portfolioValueCents` on the e2e-test side of the contract. The compliance-ctrl handler was renamed (likely during the 2026-05-25 units-correction ship in `e2e-test-tolerance-or-agent-constraint-against-suitability-block`) but the two e2e tests that synthesise RECOMMENDATION_PROPOSED directly were never updated. Math was already internally consistent in cents (6000 / 100_000 = 6%); just the field name had drifted. Scope expanded to include `operating-mode-authority.e2e.test.ts:159` (identical drift, same suite, same fix) per [[feedback-e2e-gaps-queued-not-parking]]."
references:
  - apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts
  - apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts
  - services/advisory/compliance-ctrl/src/handlers/event-listener.ts
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: |
  - Pre-fix evidence: 3/3 runs 2026-05-26 (12:39 / 12:44 / 12:48 UTC) of `update-operating-mode.e2e.test.ts` failed at line 224 with `ComplianceCheck row for decisionId=... not found within 120 s`; compliance-ctrl Ingress CW logs showed `NotRetryableError: Missing fields: portfolioValueCents` for every injected RECOMMENDATION_PROPOSED.
  - Fix: rename `portfolioValue` → `portfolioValueCents` at `apps/e2e-feature-tests/src/profile/update-operating-mode.e2e.test.ts:218` AND `apps/e2e-feature-tests/src/advisory/operating-mode-authority.e2e.test.ts:159`.
  - Unit/lint: `pnpm nx affected -t test,lint --base=origin/main` → 3 projects + 1 dep, all green (test suite for nestfolio-host 8/8, 43/43 tests).
  - Deploy: not needed — test-only edits; existing deployed dev already enforces the `portfolioValueCents` contract (detect-deploy-needed → exit 10).
  - E2E `update-operating-mode.e2e.test.ts` against deployed dev: 2/2 consecutive passes (`scenario — investor switches operatingMode CONSERVATIVE → AGGRESSIVE (re-derivation)` in 55s + 65s).
  - E2E `operating-mode-authority.e2e.test.ts` against deployed dev: 3/3 nested scenarios (CONSERVATIVE → L2, BALANCED → L1, AGGRESSIVE → L1) green in 120s.
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
