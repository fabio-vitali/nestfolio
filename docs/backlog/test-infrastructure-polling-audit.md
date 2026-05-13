---
id: test-infrastructure-polling-audit
status: queued
rank: 5
type: refactor
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
notes: "App code clean; test infra has 98 justified + 12 should-replace + 126 lower-priority polls."
---

# Test infrastructure polling audit (2026-05-05)

System-wide audit triggered by user pushback on the e2e fixture polling pattern in `apps/e2e-feature-tests/src/helpers/fixtures.ts`. Findings: **app code is clean** — zero polling in any frontend MFE (no `setInterval` / `pollInterval` / manual refetch loops; all UI updates flow through AppSync `@aws_subscribe`) and zero polling in any backend service (the only `setTimeout` instances are abort-signal fetch timeouts; the sole Step-Functions polling is `services/execution/broker-alpaca-adpt/src/constructs/transfer-polling-definition.ts` against the broker bank-transfer API which has no webhook surface — justified). **All polling lives in test infrastructure**, in three buckets:

- **Justified (98 calls)**: `EventBusTrap.waitForEvent()` (`libs/integration-testing/src/fixtures/event-bus-trap.fixture.ts:144` — 91 callers across integration tests) + `AgentTraceTrap.waitFor()` (`apps/e2e-feature-tests/src/helpers/agent-trace-trap.ts:67` — 7 callers). EventBridge has no per-test subscription surface; SQS-buffer polling is the test-only mechanism.
- **Should replace with AppSync subscription where one exists (12 calls)**: `apps/e2e-feature-tests/src/helpers/wait-for-graphql.ts:15` — 11 callers in `profile/`, `account/`, `advisory/` Jest e2e tests + 1 Playwright fixture caller (`apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts:48`). For BFFs that already expose `@aws_subscribe` (investor-bff `onNotification` + `onFeatureFlagUpdate`, dashboard-bff `onDashboardUpdate`, advisory-bff `onDecisionUpdate`), tests can attach a subscription instead of polling. Where no subscription exists (e.g. compliance-ctrl has no AppSync facade — see `services/advisory/compliance-ctrl/CLAUDE.md` Egress section), polling is the only option until a facade ships. Blocks for adoption: (a) need a `WSS subscription test harness in libs/test-support` (already filed as separate PARKING LOT entry — promotion of THIS audit will likely promote that one too); (b) Apollo subscription cleanup bug on advisory-bff blocks the `onDecisionUpdate` migration today (see WSS PARKING LOT entry).
- **DDB polling, lower priority (126 calls)**: `TableAssertions.waitForItem()` (`libs/integration-testing/src/fixtures/table-assertions.ts:42` — `setTimeout` loop on `GetItem` / `Query`). Used by integration tests to verify event-handler wrote a row. Principled alternative: subscribe to the downstream CDC event via EventBusTrap instead — proves both the write AND the CDC emit, closer to production semantics. ~126 callers across services means this is a deep refactor; defer until other migrations prove out the pattern.
- **Bandaid (1)**: `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts:184-185` — `waitForTimeout(60s) + page.reload()`. Already filed in detail as separate PARKING LOT entry (advisory-bff `onDecisionUpdate` WSS subscription closes prematurely). The WSS root-cause fix unblocks deletion of this bandaid.
- **Topology takeaway**: the user's premise ("polling should never be used — implementations should subscribe, Playwright doesn't need it") is **correct for app code today** — zero violations. The remaining work is in test infrastructure, which is hidden plumbing but matters because polling tests can pass while the subscription surface is silently broken (exactly what happened in the Step 8/Step 10 saga). Promote when the WSS test harness lands or when a second silent-subscription-bug surfaces.
