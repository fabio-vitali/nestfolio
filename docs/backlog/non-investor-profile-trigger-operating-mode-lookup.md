---
id: non-investor-profile-trigger-operating-mode-lookup
status: active
type: bug
notes: "Non-INVESTOR_PROFILE_* SF triggers (DEPOSIT_DETECTED, ORDER_*, PORTFOLIO_DRIFT_DETECTED) reach investor-profile-ctrl without operatingMode. Promoted 2026-05-09 after rank-1 dropped — empirical evidence (50 dev SF executions: 27/50 fast-fail with UnknownOperatingModeError, 0 stuck on WaitForCompliance) shows this is THE blocker for non-PROFILE-triggered decision flows."
references: []
out_of_scope:
  - "INVESTOR_PROFILE_CREATED/UPDATED triggers (already work — 23/50 SUCCEEDED in dev sample today)"
  - "e2e gate semantics changes (the e2e gate already passes on PROFILE-triggered packets; do not couple this fix to the gate)"
  - "Removing the UnknownOperatingModeError throw (the explicit failure is the right contract — fix the upstream propagation)"
  - "Broader trigger payload schema redesign (out-of-scope micro-refactor)"
  - "SF state-machine restructure beyond a single lookup-step OR a single handler-side DDB read"
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# investor-profile-ctrl needs operatingMode lookup for non-INVESTOR_PROFILE_* SF triggers

## Evidence

Surfaced 2026-05-08 while landing the `operating-mode-shape-empty-proposed-trades` fix (replacing silent BALANCED fallbacks with `UnknownOperatingModeError`). After deploy + e2e re-run, CloudWatch shows the throw firing on three deposit-shape payloads:

```
errorName: UnknownOperatingModeError
errorMessage: operatingMode missing for decision <UUID> at
              subject.investorProfile.operatingMode || subject.investorProfile.mandate.operatingMode.
              Available keys=[pk, sk, __typename, tenantId, userId, region, eventName,
                              eventId, depositId, executionMode, createdAt, amountCents,
                              currency, timestamp]
```

`depositId, executionMode, amountCents, currency` are deposit-shape — these are DEPOSIT_DETECTED triggers that the e2e setup generates via `onboarded({ capitalAmount: 100_000 })`.

## Pre-existing — silently defaulted to BALANCED

`services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:82-84` documents the pre-existing silent default:

```ts
// For non-INVESTOR_PROFILE_* triggers (DEPOSIT_DETECTED etc.), triggerContext
// is the deposit/order subject — investor-profile-ctrl handler defaults
// operatingMode to 'BALANCED' on missing field.
```

The 7 SF trigger event types are: INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED. Only the first two carry the investor's operatingMode in their detail.

## Cheapest fix (when picked up)

Two architectural options, brainstorm before picking:

1. **investor-profile-ctrl reads InvestorProfile DDB row** when `subject.investorProfile.operatingMode` is missing. Adds one DDB Query per non-INVESTOR_PROFILE_* trigger but keeps the SF state-passing contract simple.
2. **decision-workflow-ctrl SF resolves operatingMode upfront** as a state-machine step before invoking investor-profile-ctrl. Adds a step to the SF but moves the lookup out of agent code.

Option 2 is cleaner separation of concerns; Option 1 is fewer touched files. The brainstorming skill should pick.

## Why filed not promoted

The current ACTIVE workstream `operating-mode-shape-empty-proposed-trades` cares about INVESTOR_PROFILE_CREATED triggers (the only path the e2e exercises with a declared operatingMode). The deposit-trigger SFs run as collateral noise from the test setup; once the INVESTOR_PROFILE_CREATED-triggered SF produces a correctly-shaped DecisionPacket, the e2e gate is green regardless of what happens to the deposit-triggered SFs in the same window. So this is OUT OF SCOPE for the active workstream and SHOULD be a separate workstream.

If the e2e starts gating on the deposit-triggered SF outcome (it currently does not — the polling loop only requires *one* packet with non-empty proposedTrades for the test's tenantId), promote this to QUEUED.
