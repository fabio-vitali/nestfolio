---
id: investor-ctrl-circuit-breaker-notification-flake
status: queued
rank: 4
type: bug
notes: "investor-ctrl circuit-breaker notification test times out 90s waiting for NOTIFICATION_CREATED at --parallel=8. Trap buffer empty. Same shape as advisory-adpt cross-file-Jest-session flake but in a different service. Surfaced 2026-05-13."
references:
  - "services/investor/investor-ctrl/test/integration/"
  - "libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:255"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# investor-ctrl circuit-breaker NOTIFICATION_CREATED test: trap-empty flake

## Symptom

`investor-ctrl circuit breaker notifications should create SYSTEM Notification on BROKER_CIRCUIT_OPEN and emit NOTIFICATION_CREATED via CDC` failed initial attempt during the `--parallel=8` Lever 4 run-1 with:

```
EventBusTrap: timeout waiting for event NOTIFICATION_CREATED after 90000ms.
Captured-but-unmatched buffer: []
```

Passed on `jest.retryTimes(1)`.

## Why same shape as advisory-adpt parking-lot entry

Trap-empty timeout on an EB-rule forwarding/CDC path. Could be:

- The same Nx-multi-file-Jest-session race that affects advisory-adpt (test-infra rot).
- An at-least-once redelivery issue similar to ledger-ctrl version drift / reconciliation-ctrl content-key.
- A real CDC wiring gap that only fires under load.

Needs its own investigation; not enough evidence to classify.

## Cheapest first read

1. Find the test file: `services/investor/investor-ctrl/test/integration/` — locate the circuit-breaker scenario.
2. Reproduce via direct jest (`pnpm jest --config services/investor/investor-ctrl/jest.integration.config.js --runInBand --testNamePattern="circuit breaker"`). If passes alone, it's the cross-file Jest session pattern (same family as advisory-adpt). If fails alone, it's a real wiring/redelivery issue.
3. Check `services/investor/investor-ctrl/src/handlers/` for the NOTIFICATION_CREATED emission path. Look for `ctx.eventId` usage in idempotency keys (same shape as reconciliation-ctrl bug).

## Why parking, not active

Lever 4 ship is unblocked by the reconciliation-ctrl fix landing. Other retries are filed as parking entries to be picked up in sequence. P3 because no evidence yet of impact severity.
