# Circuit-breaker feature-flag UI-gating fix — Design

**Workstream:** `circuit-breaker-feature-flags-ui-gating` (backlog)
**Status:** active (promoted 2026-05-13)
**Topic memory:** `project_circuit_breaker_redesign`
**Type:** bug (discovery-driven shape)

## Problem

`apps/e2e-feature-tests/src/account/circuit-breaker-lifecycle.e2e.test.ts` — scenario 14 ("disables gated mutations when breaker opens and re-enables when breaker closes") fails against deployed dev. After `withBreakerOpen()` writes a `CircuitBreaker#alpaca` row (state=OPEN) directly to broker-alpaca-adpt's DDB, the test polls `getFeatureFlags` for up to 120 s expecting `confirmDecision` / `initiateDeposit` / `requestWithdrawal` to flip to `enabled:false`. All three remain `enabled:true`; the gated-mutation block never engages.

## Verified state (before this workstream starts)

- **In-handler logic is correct.** `services/investor/investor-bff/src/handlers/broadcast-listener.ts` registers `BROKER_CIRCUIT_OPEN → updateFeatureFlag × 3 (disabled)` and `BROKER_CIRCUIT_CLOSED → updateFeatureFlag × 3 (enabled)` through `broadcastFromQueue`. The mapPayload-array→N-mutations contract is exercised by `test/unit/handlers/broadcast-listener.test.ts`, which asserts exact `{name, enabled, reason}` for all 3 flags on both transitions.
- **Schema correct.** `updateFeatureFlag` is `@aws_iam`; `FeatureFlag` is `@aws_cognito_user_pools @aws_iam`. Cognito users can read via `getFeatureFlags`; Lambda IAM can write via `updateFeatureFlag`.
- **Cross-domain forwarding is declared.** `services/investor/investor-adpt/src/service.stack.ts` lists `BROKER_CIRCUIT_OPEN`, `BROKER_CIRCUIT_CLOSED`, `BROKER_HEAL_ESCALATED` in its `InvestorIngestEventTypes` subscription set.
- **Resolver shape correct.** `get-feature-flags.fn.js` Queries `pk = 'FeatureFlag#SYSTEM' AND begins_with(sk, 'FeatureFlag#')`. `update-feature-flag.fn.js` PutItem-writes the same key pattern.

Given these are correct, the bug must live in one of the four chain-layers below.

## Investigation framework — the disambiguation table

Walk top-down. Each row has a single concrete observation that conclusively says whether the chain broke there. Stop at the first failing layer, fix it, then re-run and continue.

| # | Layer | Concrete observation against deployed dev | If failing — fix shape |
|---|---|---|---|
| a | **CDC emission** (broker-alpaca-adpt → ExecutionBus) | CloudWatch logs of the broker-alpaca-adpt `event-publisher` Lambda for a 5-minute window starting just before `withBreakerOpen()`. Look for a `BROKER_CIRCUIT_OPEN` envelope being `PutEvents`'d, AND the upstream NormalizedEvent INSERT record that triggered it. | Most-likely root cause. The fixture writes the `CircuitBreaker#alpaca` row directly; it does NOT create a `NormalizedEvent` INSERT. The declarative `eventTypes` map on the Egress construct keys CDC off NormalizedEvent INSERTs, not raw CB-state rows. Fix is one of: (1) make `withBreakerOpen()` write a NormalizedEvent INSERT alongside (or instead of) the CB row, mirroring what `circuit-breaker.repository.ts:open()` does in prod; or (2) extend the eventTypes map to emit `BROKER_CIRCUIT_OPEN` on `CircuitBreaker` row INSERT/MODIFY in addition to NormalizedEvent. (1) is preferred — keeps the prod contract uniform; (2) widens a public surface for a test convenience. |
| b | **EB cross-bus** (ExecutionBus → InvestorBus via investor-adpt) | CloudWatch metric `Events/MatchedEvents` for rule `InvestorIngress-FromExecution` on InvestorBus, for the same window. Should be ≥ 1 if (a) emitted. | Recently-documented eventual-consistency partition drop pattern (memory ref: `advisory-adpt-from-investor-mandate-issued-sequential-flake`). Redeploy the rule, validate `MatchedEvents` rises on retry. Or rule pattern mismatch — diff the deployed rule against `service.stack.ts`. |
| c | **SQS → Lambda → AppSync** (investor-bff-BroadcastIngress) | CloudWatch logs of the `investor-bff-BroadcastIngress` Lambda for the same window. Confirm handler invoked, then look for either the success log line from `broadcastFromQueue` or an error (sig-v4, IAM, region, network). | Missing IAM permission on the broadcast-listener role for `appsync:GraphQL` on `updateFeatureFlag`; or `APPSYNC_URL` env var pointing to wrong region's endpoint; or `@aws-crypto/sha256-js` runtime sig bug. |
| d | **Read path** (AppSync getFeatureFlags resolver → DDB) | AppSync logs for the `getFeatureFlags` resolver invocation made by the e2e poll. Inspect the request mapping evaluatedExpression + the raw response items. | Less likely (resolver is trivially small). If items returned but transformed wrong, fix is in `get-feature-flags.fn.js`. If region drift (writer wrote us-east-1, reader reads elsewhere), fix is in deploy-time SSM resolution. |

## Regression test placement rule

The regression test goes at the **closest reusable layer to the actual root cause**. This rule is enforced before any test is written:

| Root-cause layer | Regression test lives in | Rationale |
|---|---|---|
| (a) fixture vs CDC contract | `services/execution/broker-alpaca-adpt/test/unit/` — assertion on the eventTypes map that `CircuitBreaker:INSERT` (or whichever surface (a) lands on) is wired AND assertion on the fixture path itself if `withBreakerOpen()` is the one that has to change | Closest to the contract that broke. Fast, deterministic, runs on every PR. |
| (b) EB rule pattern | `services/investor/investor-adpt/test/unit/service.stack.test.ts` (CDK snapshot test) | The rule pattern is a CDK-time construct property; a snapshot assertion catches future drift. |
| (c) IAM / runtime call | `services/investor/investor-bff/test/integration/` — implement the deferred Phase 3 from `docs/superpowers/plans/2026-04-15-circuit-breaker-integration-e2e-tests.md`. This becomes the regression coverage for the boundary. | If (c) is the cause, integration-level coverage is the right granularity — unit tests can't catch IAM/region/sig-v4 deltas. |
| (d) resolver bug | `services/investor/investor-bff/test/unit/graphql/get-feature-flags.test.ts` | JS resolvers have unit-test harness; resolver bugs are unit-detectable. |

**The rule's purpose:** prevent drift toward "the e2e is enough." The e2e is the lifecycle check, not the regression guard.

## Validation gate

The workstream may ship as `status: shipped` only when all four hold:

1. `scenario 14 — circuit breaker lifecycle` both `it` blocks (`disables gated mutations...`, `creates system notifications...`) pass against deployed dev **3 consecutive runs** with no retries inside the run. Standard for flake-suspect e2e (memory: `feedback_always_rerun_e2e`).
2. Regression test from the §"Regression test placement rule" added, passing locally and in any nx-affected sweep.
3. Topic memory `project_circuit_breaker_redesign.md` updated with the discovered root-cause layer, the fix, and the regression test path.
4. Service cards (`services/execution/broker-alpaca-adpt/CLAUDE.md`, `services/investor/investor-bff/CLAUDE.md`, `services/investor/investor-adpt/CLAUDE.md`) regenerated **only if** the wiring contract changed — pure-bug fixes that don't move event-type surfaces or rule patterns do NOT trigger card regeneration.

## Out of scope

- **broker-alpaca-adpt CB-rejection integration tests** (Phase 1 of the 2026-04-15 plan) — a separate workstream covering CB OPEN→reject behavior at the adapter boundary. This workstream is about the OPEN→flags propagation path, not the adapter's own rejection logic.
- **HealStateMachine open→close cycle behavior** — the heal SM is a separate concern; scenario 14 forces the close via `closeBreakerFixture()` rather than waiting for the heal cycle.
- **investor-ctrl SYSTEM notification integration tests** (Phase 2 of the prior plan) — the second `it` block of scenario 14 already e2e-covers SYSTEM notification creation; a dedicated integration test is not required unless the disambiguation lands at investor-ctrl's notification handler.
- **`onFeatureFlagUpdate` AppSync subscription real-time delivery** — deferred per the 2026-04-15 plan as too brittle to automate. Manual UI verification only.
- **`SystemBannerComponent` / Playwright UI banner-render test** — Playwright UI suite is separate from the Jest e2e suite; this workstream's validation gate is Jest e2e green only.
- **General Phase 3 investor-bff integration tests for feature-flag toggle** — implemented only IF the disambiguation lands at layer (c). Not preemptively in scope.

## Risks & open questions

- **Risk: 4 layers all fail in sequence.** If fixing (a) reveals (b) still fails, etc. — workstream timeline expands. Mitigation: each layer's fix is independently shippable; we commit + tag each fix separately so even a partial outcome lands measurable progress.
- **Risk: AppSync logs not enabled.** Layer (d) observation requires AppSync request/response logging at INFO level; this may not be on by default. Mitigation: enable on the investor-bff Facade construct before the first diagnostic run; revert if not adopted long-term.
- **Open question: should `withBreakerOpen()` write through the real path always?** If the fix in (a) is "fixture writes a NormalizedEvent INSERT," that's a behavioral change to a shared fixture used by future CB workstreams. Re-confirm with project conventions (`feedback_no_seeder_fixtures` permits fixture writes via events/mutations; raw DDB seeding is the anti-pattern) — the fix likely aligns with the convention by making the fixture more event-shaped.

## Non-goals

- Not redesigning the CB architecture. The 2026-04-15 redesign stands; this is propagation-path correctness only.
- Not adding new feature flags or new gated mutations. The 3 gated flags (`confirmDecision`, `initiateDeposit`, `requestWithdrawal`) are fixed scope.
- Not changing the IAM auth model on the Facade. `enableIamAuth: true` stays; the bug is not at the auth-mode layer.
