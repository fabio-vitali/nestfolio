---
id: investor-ctrl-circuit-breaker-notification-flake
status: shipped
type: bug
notes: "investor-ctrl circuit-breaker notification test times out 90s waiting for NOTIFICATION_CREATED at --parallel=8. Trap buffer empty. Same shape as advisory-adpt cross-file-Jest-session flake but in a different service. Surfaced 2026-05-13."
references:
  - "services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts:169"
  - "services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts:194"
  - "services/investor/investor-ctrl/src/handlers/event-listener.ts:200"
  - "libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:38"
  - "libs/event-processor/src/pipelines/change-data-capture.ts:115"
  - "docs/backlog/integration-trap-empty-family-hardening.md"
out_of_scope:
  - "Other investor-ctrl integration tests that aren't the circuit-breaker scenario (those are filed separately if flaky)."
  - "Re-tuning Lever 4 parallel-8 setting or jest.retryTimes — already shipped as separate workstreams."
  - "Refactoring NOTIFICATION_CREATED emission shape across the codebase — fix targets only this scenario's root cause."
spec: null
plan: null
topic_memory: []
validation_gate: |
  Investigation completed 2026-05-13 per the dossier's cheapest-first-read protocol — no code change shipped, classified as INVESTIGATED-AND-ABSORBED.

  Reproductions (deployed dev, NESTFOLIO_INTEG_PREFIX=dev):
  - `pnpm jest --config services/investor/investor-ctrl/jest.integration.config.js --runInBand --testNamePattern="circuit breaker"` — 3/3 pass in 84s
  - `pnpm nx run investor-ctrl:test-integration --skip-nx-cache` (both integration test files in one Jest session, maxWorkers=1) — 19/19 pass in 379s
  - Original failure was at workspace `--parallel=8` (Lever 4 run-1, 2026-05-13), absorbed by jest.retryTimes(1).

  Static analysis confirmed: handler at services/investor/investor-ctrl/src/handlers/event-listener.ts:200-207 builds Notification with hardcoded tenantId='SYSTEM'; CDC at libs/event-processor/src/pipelines/change-data-capture.ts:137-140 emits with prod-source format because tenantId='SYSTEM' doesn't startsWith 'integ-'; trap rule at the fixture filters on detail.context.tenantId only (no source filter), so the emit MUST match. No real wiring/redelivery bug found — the path is correct end-to-end at any reproducible scale.

  Per the just-shipped integration-trap-empty-family-hardening (2026-05-12, partial-win): aggregate trap-empty failures now 2.3/run vs 5-7/run baseline; this case is one of the residual ~2/run absorbed by jest.retryTimes(1) in CI. Eliminating it structurally requires family-hardening candidate D (per-trap rule reuse via fixture API change to support multi-tenantId filters) — out of scope for a single-test bugfix.
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

## Investigation outcome (2026-05-13) — INVESTIGATED-AND-ABSORBED

### Cheapest-first-read step 2 result: PASSES ALONE

| Reproduction | Result |
|---|---|
| `pnpm jest --runInBand --testNamePattern="circuit breaker"` (1 file, 3 tests) | 3/3 pass in 84s |
| `pnpm nx run investor-ctrl:test-integration` (2 files in one Jest session, maxWorkers=1) | 19/19 pass in 379s |

Confirms the dossier's classifier: **cross-workspace Jest-session contamination, same family as `advisory-adpt-from-investor-mandate-issued-sequential-flake`**. Even running both investor-ctrl integration files together in one Jest session does not reproduce the flake — only workspace `--parallel=8` (multi-file × multi-service) does.

### Cheapest-first-read step 3 result: handler + CDC path is clean

`buildNotificationRecord('SYSTEM', ctx)` at `event-listener.ts:200-207` builds the Notification with hardcoded `tenantId='SYSTEM'` and `notificationId=ctx.eventId`. CDC at `change-data-capture.ts:115-148` emits with:
- `detail.context.tenantId = 'SYSTEM'` (from DDB record)
- `source = 'investor@investor-ctrl'` (prod-source format, because `'SYSTEM'.startsWith('integ-') === false`)

The systemTrap rule (test side) filters on `detail.context.tenantId === 'SYSTEM'` AND `detail-type ∈ {NOTIFICATION_CREATED, __INTEG_CANARY}` — no source filter, so the emit MUST match. End-to-end path is correct at any reproducible scale. No `ctx.eventId` idempotency-key footgun (each test invocation has a fresh eventId so the analogous reconciliation-ctrl content-key bug shape doesn't apply here).

### Resolution

Closing as INVESTIGATED-AND-ABSORBED. The flake is a known residual member of the trap-empty family that the just-shipped `integration-trap-empty-family-hardening` (2026-05-12, partial-win, aggregate 2.3/run vs 5-7/run baseline) explicitly accepts as absorbed by `jest.retryTimes(1)` in CI. Eliminating it structurally requires that workstream's candidate D (per-trap rule reuse — fixture API change to support multi-tenantId filters in one EB rule). That's the right place for the structural fix; this single-test bugfix entry stays closed.

If the residual rate climbs back above ~3/run, or if jest.retryTimes(1) is removed for this suite, re-open with the worktree-validation-confirmed `--parallel=8` reproduction as the new evidence baseline.
