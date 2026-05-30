# dashboard-bff

Domain: investor | Bus: investorBus
Stack: services/investor/dashboard-bff/src/service.stack.ts

## State
- DynamoDB table (streams enabled)

## Ingress
- investorBus → dashboard-bff-ingress (SQS → Lambda)
  Subscriptions: BALANCE_UPDATED, PORTFOLIO_UPDATED, RECONCILIATION_COMPLETED, DECISION_PACKET_CREATED, USER_CONFIRMATION_REQUESTED, DECISION_APPROVED, DECISION_BLOCKED, LEDGER_ENTRY_RECORDED, INVESTOR_PROFILE_CREATED, INVESTOR_PROFILE_UPDATED, DEPOSIT_DETECTED, WITHDRAWAL_COMPLETED, ADVISORY_STATUS_UPDATED
  (Workstream 3: removed ORDER_FILLED, ORDER_REJECTED, ORDER_CANCELLED, PORTFOLIO_DRIFT_DETECTED, and MANDATE_ISSUED — these were the accumulate-based trigger events; replaced by ADVISORY_STATUS_UPDATED which receives advisory-bff's authoritative P3 announcement forwarded via investor-adpt.)

## Transforms
- advisory-status.ts — (Workstream 3) P3 projection: on ADVISORY_STATUS_UPDATED, calls `projectVersioned('AdvisoryStatus', { pendingDecisionsCount: subject.inFlightCount }, { version: subject.__version, … })`. Maps producer field `inFlightCount` → read-model field `pendingDecisionsCount`. No `accumulate`. Returns undefined if `__version` is absent.
- recent-activity.ts — dispatches DECISION_PACKET_CREATED and USER_CONFIRMATION_REQUESTED (and other activity-relevant events) to the activity feed; rows are LIVE-broadcast via publishActivityUpdate → onActivityUpdate
- investor-snapshot.ts — reads goal, riskProfile, operatingMode from composite INVESTOR_PROFILE_* payload (still `project()`; P1 migration deferred to w4 — needs investor-bff `__version` + stable `onboardedAt`)
- portfolio-summary.ts — version-guarded P1 projection (`projectVersioned`) from the authoritative ledger snapshot on BALANCE_UPDATED / PORTFOLIO_UPDATED: writes full row `cashBalanceCents`, `positionCount`, `totalValueCents`, keyed on `lastEventSequence` as `__version`
- position-snapshot.ts — version-guarded P1 projection, one `projectVersioned('PositionSnapshot', …)` per holding from `snapshot.positions`
- time-travel-availability.ts — unchanged

## Read model (ownership)
- `ReadModelOwnership` registered in `src/read-model-ownership.ts` (side-effect-imported from `handlers/event-listener.ts`):
  - P1 (versioned snapshots via `projectVersioned`): `PortfolioSummary`, `PositionSnapshot`
  - P2 (append-only log via `record`): `Activity`
  - P3 (deferred projection of advisory-bff's authoritative aggregate via `projectVersioned`): `AdvisoryStatus` (registered in workstream 3; `accumulate` now fails typecheck)
- Intentional carry-overs (NOT registered yet): `InvestorSnapshot` → P1 in w4 (producer `__version`); `TimeTravelAvailability` untouched.
- Dead `SimulationSummary` / `StreamSnapshot` repository writers removed (no callers). The `getSimulationSummary` GraphQL query/resolver remains (returns null via its own GetItem).
- `DashboardRepository.upsertAdvisoryStatus` is now unused dead code (superseded by the P3 projectVersioned path); a follow-up workstream will remove it.

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
- handlers/dashboard-publisher.test.ts
- repositories/dashboard.repository.test.ts
- transforms/advisory-status.test.ts
- transforms/investor-snapshot.test.ts
- transforms/portfolio-summary.test.ts
- transforms/position-snapshot.test.ts
- transforms/recent-activity.test.ts
- transforms/time-travel-availability.test.ts
- test/integration/dashboard-bff.integration.test.ts
- test/integration/read-model-projection.integration.test.ts

## Dependencies
- libs: cdk-constructs (core), event-processor
