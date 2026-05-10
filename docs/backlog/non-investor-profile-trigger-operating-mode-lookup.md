---
id: non-investor-profile-trigger-operating-mode-lookup
status: shipped
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
plan: docs/superpowers/plans/2026-05-10-non-investor-profile-trigger-operating-mode-lookup.md
topic_memory: []
validation_gate: "Shipped 2026-05-10 on `feat/operating-mode-lookup`. Dev SF SUCCEEDED rate jumped 23/50 → 40/50 post-deploy (with 7 RUNNING expected to land green); chain materialises end-to-end (MANDATE_ISSUED → mandate-projector → MandateSnapshot:INSERT → CDC MANDATE_SNAPSHOT_CREATED → SF starts → LookupMandateSnapshot Direct DDB GetItem → SetInvestorProfile → ParallelProfiling). decision-workflow-ctrl 51/51 unit + service.stack assertions PASS. e2e `operating-mode-recommendation-shape` GREEN (all 3 modes hit envelope: CONSERVATIVE 5/0.15/0.08, BALANCED 8/0.50/0.15, AGGRESSIVE 8/0.85/0.20). e2e `operating-mode-authority` + `view-decision-explanation` + `reject-decision` GREEN. e2e gate 30/33 PASS — 3 failures are pre-existing flakes unrelated to this workstream (2 narrative-latency budget overshoots ~4% over, 1 revoke-mandate timeout in different subsystem). + Post-ship topology cleanup 2026-05-11 (commits `095973d8` + `aadca562`, pre-push amend): renamed ADVISORY_PIPELINE_READY → MANDATE_SNAPSHOT_CREATED so the event name reflects the producer's local state change rather than the cross-service purpose; dashboard-bff retargeted from MANDATE_SNAPSHOT_CREATED to MANDATE_ISSUED so the in-flight badge stays inside the investor domain (cross-domain forwarding via investor-adpt dropped). Same 4-project unit suite (49/49) green post-cleanup."
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

## Shipped 2026-05-10 — Option 2 + projection-based first-decision trigger

Branch `feat/operating-mode-lookup` (8 commits). The cheapest fix turned out to be a fuller architectural simplification: own the operatingMode projection in decision-workflow-ctrl itself, drive the first decision off it, and unconditionally read it in the SF.

**Architecture shipped:**
- `decision-workflow-ctrl` owns a service-private `MandateSnapshot` row keyed `MandateSnapshot#{tenantId}#{userId}` with sk='MandateSnapshot' (operatingMode + level + status='ACTIVE'), materialised by a new `MandateProjectorIngress` (`materializeToTable` over MANDATE_ISSUED + OPERATING_MODE_CHANGED).
- DDB Streams CDC on MandateSnapshot:INSERT emits a NEW event `ADVISORY_PIPELINE_READY` on advisoryBus (declarative `eventTypes` mapping on the existing Egress).
- `TRIGGER_EVENT_TYPES` swap: `INVESTOR_PROFILE_CREATED` → `ADVISORY_PIPELINE_READY`. `INVESTOR_PROFILE_UPDATED` stays for re-decisions.
- The SF inserts `LookupMandateSnapshot` (`arn:aws:states:::dynamodb:getItem` CustomState using `States.Format('MandateSnapshot#{}#{}', $.tenantId, $.userId)`) + `SetInvestorProfile` (Pass synthesizing `subject.investorProfile = { operatingMode }`) between `UnpackTriggerEnvelope` and `ParallelProfiling`. Single-path; no Choice branch; no Lambda hop. `invokeInvestorProfile.subject.investorProfile.$` switched from `$.triggerContext` to `$.investorProfile`.
- `advisory-adpt`: dropped INVESTOR_PROFILE_CREATED forwarding (zero advisoryBus consumers post-migration).
- `dashboard-bff` + `investor-adpt`: ADVISORY_PIPELINE_READY plumbed cross-domain (investor-adpt forwards advisoryBus → investorBus; dashboard-bff ingress subscribes; advisory-status transform `TRIGGER_TYPES` Set swap so `pendingDecisionsCount` tracks the new first-decision trigger).
- Plan said only fixture data needed for advisory-bff + dashboard-bff; in fact dashboard-bff's transform hardcoded its own Set (does NOT spread `TRIGGER_EVENT_TYPES`). Production code was updated alongside fixtures.

**Read-your-write guarantee.** ADVISORY_PIPELINE_READY is the CDC of THIS service's own MandateSnapshot:INSERT, so by the time the SF starts the row is already committed in the local table. INVESTOR_PROFILE_UPDATED + non-PROFILE triggers (DEPOSIT_DETECTED, ORDER_*) hit a long-since-materialised projection (onboarding's MANDATE_ISSUED ran during phase 6).

**Validation gate**: see frontmatter `validation_gate`. Headline: 23/50 → 40/50 SUCCEEDED rate, all 3 operating-mode envelopes green for the first time on a non-flaky run. The 3 e2e flakes (narrative latency overshoots, revoke-mandate timeout) pre-exist and are filed separately if not.

**Side-effect fixed.** Five service-level `jest.config.js` files needed `@nestfolio/investor-bff/events` added to `moduleNameMapper` because Task 3 added the `InvestorBffEventTypes` import to `decision-workflow-ctrl/src/domain/events.ts` (transitive resolution through any consumer of decision-workflow-ctrl/events).

## Post-ship topology cleanup 2026-05-11 (pre-push amend)

Two follow-up commits applied locally before pushing the workstream to origin (every event should ONLY make sense in its producing service's context — the flow spec links events for cross-service purpose, the event NAME describes a local state change):

1. **Rename `ADVISORY_PIPELINE_READY` → `MANDATE_SNAPSHOT_CREATED`** (commit `095973d8`). The MandateSnapshot Egress was emitting an event named for the cross-service purpose (the SF first-decision trigger) instead of the local state change. The new name aligns with the sibling Egress mappings in the same construct (`DecisionPacket` → `DECISION_PACKET_CREATED`, `AgentOutput` → `AGENT_OUTPUT_CREATED`). Touched: events.ts (DWC + investor-adpt), service.stack.ts (DWC Egress + dashboard-bff/investor-adpt Ingress lists), unit tests (DWC stack + advisory-bff/dashboard-bff transforms), integration tests, e2e fixtures + first-decision scenario, both flow yamls, 5 service cards.

2. **dashboard-bff retargets to `MANDATE_ISSUED`, drop cross-domain forwarding** (commit `aadca562`). After the rename, dashboard-bff's `pendingDecisionsCount` was still incrementing on an advisory-domain event (`MANDATE_SNAPSHOT_CREATED`) plumbed cross-domain via investor-adpt. Switched dashboard-bff to subscribe to investor-bff's `MANDATE_ISSUED` directly — same in-flight badge semantics, no cross-domain coupling. Trade-off: badge increments ~50-200ms earlier than before (MANDATE_ISSUED fires before mandate-projector materialises the projection), and on rare SF-start failure the badge will not auto-decrement. Acceptable for an in-flight badge. Drops: investor-adpt fromAdvisoryEvents entry + `InvestorIngestEventTypes.MANDATE_SNAPSHOT_CREATED` const + dashboard-bff Ingress entry on the cross-domain forwarded event.

The MandateSnapshot projection + LookupMandateSnapshot Direct DDB GetItem in decision-workflow-ctrl remain — they're what makes the chain work for non-PROFILE triggers and are not affected by either change.
