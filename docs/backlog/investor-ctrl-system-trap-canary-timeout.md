---
id: investor-ctrl-system-trap-canary-timeout
status: shipped
rank: null
type: bug
notes: "30s default canaryTimeout was at the tail of stacked EB+SQS propagation; orphan-rule hypothesis disproved (0 rules across all 4 buses); default bumped 30s→60s + per-test workaround removed."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: "investor-ctrl integration suite 19/19 GREEN 2x against deployed dev (148-187s / 83-90s); fix commit 58c1e3df."
---

# EventBusTrap canary times out for SYSTEM-tenant trap on investor-bus

## What was filed (2026-05-27)

`onboarding-notification.integration.test.ts` failed at 30s canary timeout while deploying the 3rd `EventBusTrap` (SYSTEM-tenant) on `investor-bus`, after `notificationTrap` + `reportTrap` had already deployed. Workaround in commit `d5e0152b`: per-trap `canaryTimeout: 60_000` override.

Working hypothesis: orphan `integ-trap-*` EB rules accumulating on the bus from failed `OrphanReaper` cleanups (visible `ERR_VM_MODULE_NOT_MODULE` during Jest teardown), slowing `PutRule` propagation.

## What measurement showed (2026-05-28)

```bash
AWS_PROFILE=nestfolio-dev aws events list-rules \
  --event-bus-name dev-investor-event-bus --name-prefix integ-trap- \
  --query 'length(Rules)'
```

Result: **0** orphan `integ-trap-*` rules on all 4 dev buses. The investor bus carries only 7 total rules, all legitimate stack-owned (advisory-adpt ingress, dashboard-bff ingress, execution-adpt ingress, investor-bff broadcast + ingress, investor-ctrl trigger, archive). Orphan-accumulation hypothesis disproved.

(Side correction: the dossier called the bus `dev-investor-bus`; the actual SSM-resolved ARN ends in `dev-investor-event-bus`. Not load-bearing for the analysis.)

## Actual root cause

Plain AWS environmental tail latency on two propagation paths that stack inside `EventBusTrap.deploy`:

1. **EB rule activation** after `PutRule` — typical 5-15s, tail can reach 25-45s.
2. **SQS queue-policy propagation** after `SetQueueAttributes` — AWS docs allow up to 60s.

The canary loop at `libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:111-153` correctly resends a fresh canary every poll iteration and only exits on first match. With `canaryTimeout: 30_000`, the p99 of stacked propagation just barely fit — random tail-end runs blew the budget. The "3rd trap" framing was incidental (run-to-run variance, not stacking).

## Fix

`libs/test-support/src/context.ts:33` — default `canaryTimeout` 30_000 → 60_000. Per-trap workaround in `onboarding-notification.integration.test.ts` removed. Outer `beforeAll` timeout 90s → 150s to accommodate worst-case sequential 2-trap deploys at the new ceiling. Happy-path canary still exits early on first match — only the failure cap moved.

## Validation

`NESTFOLIO_INTEG_PREFIX=dev pnpm nx run investor-ctrl:test-integration --skip-nx-cache`

| Run | onboarding-notification | resilience | total |
|---|---|---|---|
| 1   | 187s, 15/15 pass        | 90s, 4/4   | 277s  |
| 2   | 148s, 15/15 pass        | 83s, 4/4   | 232s  |

Two consecutive clean runs, including the 3 SYSTEM-tenant circuit-breaker tests that previously triggered the workaround.

Fix commit: `58c1e3df`.
