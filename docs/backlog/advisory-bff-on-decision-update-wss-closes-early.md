---
id: advisory-bff-on-decision-update-wss-closes-early
status: active
type: bug
references: []
out_of_scope:
  - "Refactoring dashboard-bff onDashboardUpdate (verified working, leave untouched)"
  - "Generalising AppSync subscription patterns across other BFFs (separate workstream)"
  - "Changing AppSync primary auth mode or Cognito/IAM directive strategy beyond what the fix demands"
  - "Adding new e2e reload workarounds elsewhere (search 2026-05-05 confirmed this is the only one)"
  - "Investor-bff/ledger-bff subscriptions"
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "WSS closes prematurely; e2e test hides bug via reload — must remove on fix."
---

# advisory-bff `onDecisionUpdate` WSS subscription closes prematurely

Diagnosed 2026-05-05: when decision-detail.component.ts subscribes via `subscribeToDecisionUpdates(tenantId, decisionId)` against advisory-bff AppSync, the WSS subscription receives a single `apollo next` with `hasData=false` and immediately emits `apollo complete`. No actual decision-update frames are ever delivered. Verified via browser console capture in `apps/nestfolio-e2e/src/fixtures/test.ts` (Step10Diag): the dashboard-bff `onDashboardUpdate` subscription on the SAME page works fine (Step 8 sentinel arrives), so the issue is advisory-bff-specific. Backend is healthy (DDB shows `status='AWAITING_CONFIRMATION'`, decision-publisher Lambda fires broadcasts per CloudWatch — `MODIFY` event for DecisionReadModel). Hypotheses (none verified): (a) Apollo subscription deduplication conflict because decision-list and decision-detail subscribe with identical query+variables (same tenantId, both use ON_DECISION_UPDATE), `aws-appsync-subscription-link` may multiplex incorrectly; (b) schema returns `DecisionPacket!` non-null whereas dashboard returns `Dashboard` (nullable) — AppSync may handle null differently during ack; (c) explicit `@aws_cognito_user_pools @aws_iam` directives on subscription field interact with primary auth mode in a way the implicit dashboard form doesn't. **THE E2E TEST IS HIDING THIS BUG.** `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` Step 9-10 currently does `waitForTimeout(60s) + page.reload()` between rationale and confirm, forcing a fresh `getDecision` query that pulls AWAITING_CONFIRMATION from DDB. This is a deliberate workaround to unblock the green-test goal but it actively masks a real user-facing UX bug — real users land on `/advisory/<id>`, the page never updates from PENDING via WSS, and they have to refresh manually. **Done-when (mandatory for closing this entry):** (1) root-cause + fix the WSS subscription closure on advisory-bff so live frames deliver; (2) **REMOVE the `waitForTimeout(60s) + page.reload()` block** from `new-investor-happy-path.spec.ts` Step 9-10 — replace with a UI-driven wait for the status badge to flip to AWAITING_CONFIRMATION via the WSS path; (3) re-run the e2e WITHOUT the reload and confirm green. **Workspace search 2026-05-05 confirmed this is the ONLY `page.reload()` in `apps/nestfolio-e2e` and `apps/e2e-feature-tests`** — no other hidden-via-reload subscription bugs exist. Promote to QUEUED at the next architectural cleanup pass OR sooner if a real-user UX bug surfaces.
