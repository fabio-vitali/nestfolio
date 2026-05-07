---
id: advisory-bff-on-decision-update-wss-closes-early
status: shipped
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
validation_gate: "new-investor-happy-path Playwright e2e green in 2.2 min on deployed dev WITHOUT the 60s waitForTimeout+reload workaround; trace shows 9 start_acks, 0 error frames, 6 onDecisionUpdate data frames with AWAITING_CONFIRMATION → CONFIRMED transitions."
notes: "WSS closes prematurely; e2e test hides bug via reload — must remove on fix."
---

# advisory-bff `onDecisionUpdate` WSS subscription closes prematurely

**SHIPPED 2026-05-07.** Root cause: `onDecisionUpdate(tenantId: ID!): DecisionPacket!` (non-null) in `services/advisory/advisory-bff/src/schema.graphql`. AppSync resolves the subscription field on subscription start (and on the implicit duplicate-subscribe coalesce when `decision-list` and `decision-detail` both subscribe with identical tenantId variables) using the implicit `@aws_subscribe` resolver, which returns null prior to any broadcast. The non-null modifier raised `"Cannot return null for non-nullable type: 'DecisionPacket' within parent 'Subscription' (/onDecisionUpdate)"`, emitted as a graphql-ws `error` frame; Apollo translated it to `next(data:null) + complete`. dashboard-bff already documents this exact constraint on its `Dashboard` return type — the comment is now mirrored on advisory-bff.

**Fix:** schema change `DecisionPacket!` → `DecisionPacket` (one line). The Angular client already null-guards `data.onDecisionUpdate` at `advisory.service.ts:68` and `:114`, so the nullable type carries no consumer change.

**Diagnostic infrastructure landed alongside the fix** (kept as opt-in long-term): `libs/shell/src/graphql/wss-debug-probe.ts` patches `globalThis.WebSocket` on construction to log raw graphql-ws frames when `globalThis.__nfWssDebug` is true. Activated by `apps/nestfolio-e2e/src/fixtures/seed-amplify-tokens.ts` so every Playwright run captures wire-level subscription frames in the trace. Production cost is zero (flag never set).

**How it was diagnosed (2026-05-05 → 2026-05-07):** The bug card listed three unverified hypotheses (a) Apollo dedup, (b) non-null type, (c) auth directives. Static analysis ruled out the trivial filter-arg-mismatch failure mode (filter contract intact: `tenantId` present on schema return type, in JS resolver response, and in publisher mutation selection). The probe captured the actual AppSync error frame on the e2e first-failing window, which read verbatim `"Cannot return null for non-nullable type: 'DecisionPacket'..."` — collapsing the three hypotheses to (b) only.

**Validation:** `apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` had a 60s `waitForTimeout` + `page.reload()` block in Step 9-10 to mask the bug. The block is now removed — `advisory.confirm()`'s 120s click-poll covers compliance latency without forcing a refresh. Playwright e2e green in 2.2 min on deployed dev. Probe trace: 9 `start_ack`, 0 `error`, 6 `onDecisionUpdate` `data` frames carrying `AWAITING_CONFIRMATION` → `CONFIRMED`.

**Workspace search 2026-05-05 confirmed this was the ONLY `page.reload()` in `apps/nestfolio-e2e` and `apps/e2e-feature-tests`** — no other hidden-via-reload subscription bugs exist. Diagnostic probe stays committed for future WSS regressions.
