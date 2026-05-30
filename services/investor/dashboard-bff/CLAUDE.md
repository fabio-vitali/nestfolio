# dashboard-bff

Domain: investor | Bus: investorBus
Stack: services/investor/dashboard-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- investorBus → dashboard-bff-ingress (SQS → Lambda)
  Subscriptions: BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED, LEDGER_ENTRY_RECORDED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, MANDATE_ISSUED
  + Phase 2 additions: ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, PORTFOLIO_DRIFT_DETECTED, DEPOSIT_DETECTED

The post-collapse subscription list replaces the legacy 6 per-entity events (GOAL_*, RISK_PROFILE_*, OPERATING_MODE_*) with the 2 composite events. The investor-snapshot transform reads goal, riskProfile, and operatingMode from the composite payload of INVESTOR_PROFILE_CREATED / INVESTOR_PROFILE_UPDATED. INVESTOR_PROFILE_CREATED stays subscribed for InvestorSnapshot materialization but no longer increments pendingDecisionsCount — the trigger-counting transform now uses MANDATE_ISSUED (the local investor-domain mandate-lifecycle signal). dashboard-bff intentionally tracks MANDATE_ISSUED rather than the advisory-domain MANDATE_SNAPSHOT_CREATED so the in-flight badge stays inside the investor domain (no cross-domain forwarding required).

## Transforms
- advisory-status.ts — maintains AdvisoryStatus.pendingDecisionsCount:
  - Increments (+1) on trigger events: MANDATE_ISSUED, INVESTOR_PROFILE_UPDATED, PORTFOLIO_DRIFT_DETECTED, ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, DEPOSIT_DETECTED
  - Decrements (−1) on DECISION_APPROVED, DECISION_BLOCKED
  - DECISION_PACKET_CREATED and USER_CONFIRMATION_REQUESTED no longer affect pendingDecisionsCount (repurposed to recent-activity.ts)
- recent-activity.ts — dispatches DECISION_PACKET_CREATED and USER_CONFIRMATION_REQUESTED (and other activity-relevant events) to the activity feed; rows are LIVE-broadcast via publishActivityUpdate → onActivityUpdate (phase 2 dispatch)
- investor-snapshot.ts — reads goal, riskProfile, operatingMode from composite INVESTOR_PROFILE_* payload (still `project()`; P1 migration deferred to w4 — needs investor-bff `__version` + stable `onboardedAt`)
- portfolio-summary.ts — version-guarded P1 projection (`projectVersioned`) from the authoritative ledger snapshot on BALANCE_UPDATED / PORTFOLIO_UPDATED: writes full row `cashBalanceCents`, `positionCount = Object.keys(positions).length`, `totalValueCents = cashBalanceCents + Σ round(quantity*lastFillPrice*100)`, keyed on `lastEventSequence` as `__version`. Replaced the old order-fill `accumulate`/`project` reconstruction — fixes the cashBalanceCents/positionCount structural zeros + totalValueCents double-count by construction. `driftPercent` removed (not in the ledger snapshot; single-producer P1).
- position-snapshot.ts — version-guarded P1 projection, one `projectVersioned('PositionSnapshot', …)` per holding from `snapshot.positions` (cents computed from the dollar-denominated snapshot fields; `weightPercent` = share of total market value; `assetClass` defaults EQUITY). Handler spreads the per-position array.
- time-travel-availability.ts — unchanged

## Read model (ownership)
- `ReadModelOwnership` registered in `src/read-model-ownership.ts` (side-effect-imported from `handlers/event-listener.ts`):
  - P1 (versioned snapshots via `projectVersioned`, keyed on `lastEventSequence`): `PortfolioSummary`, `PositionSnapshot`
  - P2 (append-only log via `record`): `Activity`
- Intentional carry-overs (NOT registered yet): `InvestorSnapshot` → P1 in w4 (producer `__version`); `AdvisoryStatus` count → P3 in w3 (needs authoritative decision rows, stays `accumulate` for now); `TimeTravelAvailability` untouched.
- Dead `SimulationSummary` / `StreamSnapshot` repository writers removed (no callers). The `getSimulationSummary` GraphQL query/resolver remains (returns null via its own GetItem).

## Facade
- AppSync GraphQL API (JS Resolvers via discoverJsResolvers)

## MFE Hosting
- MfeBucket (mfeKey=dashboard): S3 bucket "{account}-{prefix}-nestfolio-mfe-dashboard"
  - CloudFront OAC bucket policy (scoped via AWS:SourceArn to investor-web distribution)
  - SSM exports: mfe/bucketName, mfe/key

## SSM Parameters Published
- api/graphqlUrl
- api/realtimeUrl
- mfe/bucketName
- mfe/key

## Handlers
- event-listener.ts — Ingress event handler
- dashboard-publisher.ts — DDB-stream-driven broadcaster: fires publishDashboardUpdate on AdvisoryStatus mutation and publishActivityUpdate on Activity insert (keyed by __typename)

## Tests
- handlers/event-listener.test.ts
- repositories/dashboard.repository.test.ts
- transforms/advisory-status.test.ts
- transforms/investor-snapshot.test.ts
- transforms/portfolio-summary.test.ts
- transforms/position-snapshot.test.ts
- transforms/recent-activity.test.ts
- transforms/time-travel-availability.test.ts

## Dependencies
- libs: cdk-constructs (core), event-processor
