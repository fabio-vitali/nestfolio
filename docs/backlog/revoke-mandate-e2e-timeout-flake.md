---
id: revoke-mandate-e2e-timeout-flake
status: shipped
type: bug
notes: "SHIPPED 2026-05-14. Trap-side EB rule-evaluation partition propagation race (`Captured-but-unmatched buffer: []`). Resolved via `jest.retryTimes(1)` — same precedent as circuit-breaker-feature-flags-ui-gating + advisory-adpt-from-investor-mandate-issued-sequential-flake (both 2026-05-13)."
references:
  - "apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts"
out_of_scope:
  - "Refactoring the revokeMandate mutation shape or response contract"
  - "Other profile e2e scenarios (mandate update, double-revoke, etc.)"
  - "Onboarding fixture latency improvements unless this scenario's beforeEach is implicated by the captured evidence"
  - "Cross-domain MANDATE_REVOKED consumer side-effects beyond the trap assertion"
  - "Systemic EB-rule-propagation remedies (already absorbed elsewhere) unless this scenario's failure mode is uniquely traceable to it"
spec: null
plan: null
topic_memory: []
validation_gate: "Pre-fix: 1/11 reproductions (~9%) against deployed dev with the exact `Captured-but-unmatched buffer: []` shape. Post-fix: 15/15 PASS against deployed dev (durations 14-35s, no retry-triggered runs observed — flake did not fire in this batch but compound failure probability now ~0.8%, matching scenario-14 precedent)."
---

# `revoke-mandate.e2e.test.ts` intermittent timeout

Surfaced 2026-05-10 in the validation_gate of `non-investor-profile-trigger-operating-mode-lookup` ("30/33 PASS — … 1 revoke-mandate timeout in different subsystem"). Not previously filed; the flake was described as "in a different subsystem" — i.e. unrelated to the operating-mode lookup work that surfaced it.

Distinct from the resolved `investor-bff-double-revoke-assertion-mismatch` (shipped 2026-05-11) which addressed an assertion regex mismatch on the double-revoke path — this is a wall-clock timeout on the single happy-path scenario.

## Reproduction

11-run batch against deployed dev (2026-05-14) reproduced 1/11 (~9%, consistent with the historical ~3% rate). Failure signature on run 8:

```
EventBusTrap: timeout waiting for event MANDATE_REVOKED after 60000ms.
Captured-but-unmatched buffer: []
```

The captured buffer was empty at the 60s deadline — the trap saw zero events during the window. The `revokeMandate` mutation succeeded (the test asserts `result.revokeMandate.status === 'REVOKED'` *before* `waitForEvent`), so the DDB UpdateItem on the Mandate row landed and the egress Lambda observed the MODIFY record. CloudWatch logs on `EgressPublisherDB741A6E` show normal invocation cadence in the failure window with no app-level error output.

## Root cause

Trap-side EB rule-evaluation partition propagation race. `EventBusTrap.deploy()` creates a per-test EB rule on `investor-event-bus` and runs a canary warmup that confirms activation on **one** EB internal partition. The CDC-emitted `MANDATE_REVOKED` `PutEvents` (different Lambda invocation, potentially different connection) may evaluate against a **different** partition that hasn't yet seen the new rule, dropping the event silently. The original dossier hypothesis ("SQS-to-DDB lag on `MANDATE_REVOKED` projection in `investor-bff`") was a mis-direction — `MANDATE_REVOKED` is *emitted* by investor-bff via CDC, not projected.

Same failure class as:
- `advisory-adpt-from-investor-mandate-issued-sequential-flake` (shipped 2026-05-13, integration; resolved by deleting pure-forwarder tests).
- `circuit-breaker-feature-flags-ui-gating` (shipped 2026-05-13, e2e scenario 14; resolved by `jest.retryTimes(1)`).

## Resolution

Added `jest.retryTimes(1)` to `apps/e2e-feature-tests/src/profile/revoke-mandate.e2e.test.ts` with a comment matching the 2026-05-13 precedent. A retry creates a fresh trap whose new rule has had ≥30s longer to propagate before its CDC event fires; compound failure probability drops from ~9% to ~0.8%. Same shape as the scenario-14 fix.

Not in scope: a stable pre-deployed `EventBusTrap` pool that would eliminate the rule-creation race class entirely — left in the parking lot as a future refactor target.
