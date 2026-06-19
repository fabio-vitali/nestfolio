---
id: wss-subscription-test-harness-test-support
status: parking
type: tooling
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "For integration tests that need to assert AppSync @aws_subscribe broadcasts deliver."
epic: live-push-broadcast-coverage
epic_role: core
---

# WSS subscription test harness in `libs/test-support`

For integration tests that need to assert AppSync `@aws_subscribe` broadcasts actually deliver. Today's integration tests use `EventBridgeClient.putEvent` + `TableAssertions.waitForItem` against deployed dev (HTTP-only); no subscription client exists. This blocked Task 9 of Spec 5 (decision-update broadcast) — coverage for the broadcast path now relies entirely on per-handler unit tests + the 5-run e2e gate. Promote when a SECOND subscription needs integration coverage (advisory-bff `publishDecisionUpdate` is the first; dashboard-bff `publishDashboardUpdate` already shipped with no harness either). Pattern likely: a thin wrapper around AppSync SubscriptionClient + Cognito tokens, plus an awaitable frame collector.
