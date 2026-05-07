---
id: deposit-page-pattern-a-to-pattern-b
status: parking
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "deposit-page is the lone Pattern A holdout; ~30 LoC + tiny route-param refactor."
---

# Refactor `deposit-page.component.ts` from subscribe-after-async (Pattern A) to subscribe-on-navigation (Pattern B)

`apps/investor-mfe/src/app/deposit/deposit-page.component.ts:180` attaches `subscribeToDepositEvent(intent.depositId, ...)` only after `initiateDeposit()` returns, with `depositId` in component-local state. Two consequences: (1) page reload mid-flight loses the subscription (depositId gone, form re-rendered empty even though backend is still processing); (2) ~200ms AppSync handshake races a hot-Lambda DETECTED frame on broker-sim cached path → frame delivered to not-yet-attached subscriber, lost. Fix: read `depositId` from URL param or active-intent store on `ngOnInit`, attach subscription before any read, mirror Spec 5's R1 pattern from `apps/advisory-mfe/src/app/decision/decision-detail.component.ts:377`. Three other MFE views already follow Pattern B (dashboard-container, notification-list, decision-detail) — deposit-page is the lone holdout. ~30 LoC + a tiny route-param refactor. Natural pairing with the Step 9 decision-list workstream.
