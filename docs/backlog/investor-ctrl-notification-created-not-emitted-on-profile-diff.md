---
id: investor-ctrl-notification-created-not-emitted-on-profile-diff
status: shipped
rank: null
type: bug
notes: "Tests publish synthetic INVESTOR_PROFILE_UPDATED but post-resplit handler subscribes to atomic OPERATING_MODE_CHANGED / GOAL_UPDATED events emitted by investor-bff CDC `onFieldChange`. Direct EB injection bypasses DDB → CDC never fires → notification never emitted."
references: []
out_of_scope:
  - "Cross-service E2E for InvestorProfile update → notification chain (belongs in apps/e2e-feature-tests)"
spec: null
plan: null
topic_memory: []
validation_gate: "investor-ctrl test 42/42 + test-integration 19/19 GREEN on main 2026-05-11. Took Option B: added GOAL_UPDATED + OPERATING_MODE_CHANGED to the existing it.each parametrized block (1 event → 1 notification, same template path as the other 10), deleted the obsolete diff-detect describe block (handler removed in resplit, fallback branch doesn't exist anymore). Wall-clock dropped from 1175s → 276s — ~15 min reclaimed, matches backlog's ~18 min prediction."
---

# `NOTIFICATION_CREATED` never emitted — test injects synthetic event that bypasses CDC

**Failing integration tests (`services/investor/investor-ctrl/test/integration/onboarding-notification.integration.test.ts`):**

- `INVESTOR_PROFILE_UPDATED diff notifications › goal change only → at least 1 GOAL_UPDATED notification fires`
- `INVESTOR_PROFILE_UPDATED diff notifications › operatingMode change only → at least 1 OPERATING_MODE_CHANGED notification fires`
- `INVESTOR_PROFILE_UPDATED diff notifications › both goal AND operatingMode change → 2 notifications fire`
- (4+ more — full count in per-project block)

All fail identically: `EventBusTrap: timeout waiting for event NOTIFICATION_CREATED after 90000ms. Captured-but-unmatched buffer: []`. Empty buffer = never published.

## Root cause

Verified 2026-05-11. The post-resplit topology is:

1. **investor-bff CDC** `change-data-capture.ts:87` emits atomic events on field change via the `mapping.onFieldChange` extension, but **only if `ctx.oldImage` and `ctx.newImage` exist** — which only happens when a DynamoDB Stream record is present.
2. **investor-ctrl** subscribes to the atomic semantic events (`InvestorBffEventTypes.OPERATING_MODE_CHANGED`, `InvestorBffEventTypes.GOAL_UPDATED`) per `services/investor/investor-ctrl/src/handlers/event-listener.ts:19-26` (commit `8062b7aa`, 2026-05-08 resplit).

The test fixture publishes `INVESTOR_PROFILE_UPDATED` **directly to EventBridge** with a synthetic `before/after` payload:

```ts
eb.putEvent({ bus: 'investor', detailType: 'INVESTOR_PROFILE_UPDATED', detail: {...} });
```

→ no DynamoDB write → no Stream record → no CDC → no atomic event → investor-ctrl handler never fires → `NOTIFICATION_CREATED` never emitted.

This is the **carrier vs semantic vs lifecycle** 3-tier topology from `project_investor_profile_collapse`: `INVESTOR_PROFILE_UPDATED` is the carrier (DDB stream), `OPERATING_MODE_CHANGED` / `GOAL_UPDATED` are the semantic events emitted by CDC. The test still encodes the pre-resplit single-event contract.

## Fix shape — two valid paths

**Option A (preferred — closer to production):** drive the flow via a real DDB write that triggers CDC. The test would `PutCommand` an `InvestorProfile` row, then update it, and the natural Stream → CDC → atomic-event chain would deliver to investor-ctrl. This is the most realistic test of the topology.

**Option B (cheaper — bypass CDC):** publish the atomic `OPERATING_MODE_CHANGED` / `GOAL_UPDATED` events directly to the bus. This tests only the notification handler in isolation, not the CDC contract.

Pick Option A unless the per-test cost is unacceptable. No production code changes.

## Bottleneck reclaim

`investor-ctrl:test-integration` ran **1175 s (19.6 min)** wall-clock, dominated by 90 s timeout × jest-retry × 6 tests. Fixing this reclaims **~18 minutes** of integration suite wall-clock and is the single biggest lever.

## Out-of-scope

The 90 s `EventBusTrap` timeout itself is reasonable for an end-to-end CDC chain, but if Option A still runs in <30 s consistently after the fix, tighten to 45 s.

Surfaced 2026-05-11 during full-system test sweep. Third instance of post-ship test-fixture rot in this sweep.
