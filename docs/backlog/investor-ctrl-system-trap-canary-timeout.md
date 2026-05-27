---
id: investor-ctrl-system-trap-canary-timeout
status: queued
rank: 3
type: bug
notes: "SYSTEM-tenant trap canary needs >30s on investor-bus when stacked with 2 other traps — root cause unknown"
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# EventBusTrap canary times out for SYSTEM-tenant trap on investor-bus

When `services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts` (inner `describe('circuit breaker notifications')` beforeAll) deploys a 3rd `EventBusTrap` (the SYSTEM-tenant trap for circuit-breaker notifications) on `investor-bus`, the canary fails to arrive within the default 30s timeout. Two other traps (`notificationTrap` + `reportTrap`) are already active on the same bus from the outer `beforeAll`.

## Symptom (from 2026-05-27 run)

All 3 circuit-breaker `it.each` tests fail at the same line:

```
EventBusTrap: canary event did not arrive after 30000ms — EB rule may not be active
at EventBusTrap.deploy (libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:152:13)
at Object.<anonymous> (test/integration/onboarding-notification.integration.test.ts:182:7)
```

## Workaround applied 2026-05-27

`onboarding-notification.integration.test.ts:181-189` — bump `canaryTimeout` for SYSTEM trap from 30s → 60s via per-trap timings override:

```ts
systemTrap = new EventBusTrap({
  ...ctx,
  tenantId: 'SYSTEM',
  timings: { ...ctx.timings, canaryTimeout: 60_000 },
});
```

Outer `beforeAll` timeout bumped 90s → 120s to accommodate.

## Hypothesis

Suspect orphan EB rule accumulation on investor-bus from failed `OrphanReaper` cleanups. The reaper throws `ERR_VM_MODULE_NOT_MODULE` during Jest teardown (visible in MI + narrative resilience logs from the same run) when a credential-provider import races with Jest VM teardown. Failed reaps leave orphan `integ-trap-*` rules behind. Over many runs, the bus accumulates rules, slowing both `PutRule` propagation and `SetQueueAttributes` policy propagation.

## Cheapest next step

```bash
AWS_PROFILE=nestfolio-dev aws events list-rules --event-bus-name dev-investor-bus --name-prefix integ-trap- --query 'length(Rules)'
```

If the count is large (>100), the working hypothesis is confirmed and the real fix is **fixing OrphanReaper's lifecycle** so it doesn't race with Jest VM teardown — not bumping more test timeouts.

Also worth measuring: is the bottleneck rule activation (`PutRule` → matching pattern) or SQS policy propagation (`SetQueueAttributes` → EB → SQS delivery)? The canary loop sends a fresh event every iteration so it's tolerant of either, but a long enough delay on either side blows the budget.
